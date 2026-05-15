const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }),
    };
  }

  let ids;
  try {
    ({ ids } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'ids must be a non-empty array' }) };
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Step 1: Fetch profiles rows (service role bypasses RLS).
  // Use only columns that are guaranteed to exist. Potentially-missing columns
  // (avatar_url, avatar_visible, residential_address, gender, citizenship) are
  // fetched in a separate query so one bad column never kills the whole result.
  const [safeResult, extraResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, phone, location, license_year, license_number, verified, rating')
      .in('id', ids),
    supabase
      .from('profiles')
      .select('id, avatar_url, avatar_visible, residential_address, gender, citizenship')
      .in('id', ids),
  ]);
  const extraMap = {};
  (extraResult.data || []).forEach(p => { extraMap[p.id] = p; });
  const profiles = (safeResult.data || []).map(p => ({ ...p, ...(extraMap[p.id] || {}) }));

  // Build a map for quick lookup
  const profileMap = {};
  profiles.forEach(p => { profileMap[p.id] = { ...p }; });

  // Step 2: For every requested ID, fetch the auth.users record via Admin API.
  // This is the authoritative source of full_name (stored in user_metadata by auth.updateMe()).
  const authResults = await Promise.all(
    ids.map(async (uid) => {
      try {
        const { data, error } = await supabase.auth.admin.getUserById(uid);
        if (error || !data?.user) return null;
        return data.user;
      } catch {
        return null;
      }
    })
  );

  // Step 3: Merge — auth metadata wins for full_name/email when profile row is empty
  const result = ids.map((uid, i) => {
    const authUser = authResults[i];
    const profile  = profileMap[uid] || { id: uid };

    return {
      ...profile,
      full_name: profile.full_name
                  || authUser?.user_metadata?.full_name
                  || authUser?.email?.split('@')[0]
                  || null,
      email:     profile.email || authUser?.email || null,
      // propagate any extra auth metadata fields that profiles may not have yet
      phone:           profile.phone    || authUser?.user_metadata?.phone    || null,
      location:        profile.location || authUser?.user_metadata?.location || null,
      license_number:  profile.license_number  || authUser?.user_metadata?.license_number  || null,
      license_year:    profile.license_year    || authUser?.user_metadata?.license_year    || null,
      avatar_url:      profile.avatar_url      || authUser?.user_metadata?.avatar_url      || null,
      avatar_visible:  profile.avatar_visible  ?? authUser?.user_metadata?.avatar_visible  ?? true,
      gender:          profile.gender          || authUser?.user_metadata?.gender          || null,
      citizenship:     profile.citizenship     || authUser?.user_metadata?.citizenship     || null,
      residential_address: profile.residential_address || authUser?.user_metadata?.residential_address || null,
      verified:        profile.verified        ?? authUser?.user_metadata?.verified        ?? false,
      rating:          profile.rating          ?? authUser?.user_metadata?.rating          ?? 0,
    };
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  };
};
