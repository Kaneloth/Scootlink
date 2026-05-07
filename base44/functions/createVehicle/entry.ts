import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

    const body = await req.json();
    const { supabaseAccessToken, ...vehicleData } = body;

    if (!supabaseAccessToken) {
      return Response.json({ error: 'Unauthorized: missing token' }, { status: 401 });
    }

    // Verify the user via their JWT
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${supabaseAccessToken}` } }
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Map frontend fields to DB columns
    const dbRow = { ...vehicleData };
    if ('vehicle_type' in dbRow) { dbRow.type = dbRow.vehicle_type; delete dbRow.vehicle_type; }
    if ('price_per_week' in dbRow) { dbRow.price = dbRow.price_per_week; delete dbRow.price_per_week; }
    dbRow.owner_id = user.id;

    // Insert using service role to bypass RLS
    const serviceClient = createClient(supabaseUrl, serviceKey);
    const { data, error } = await serviceClient
      .from('vehicles')
      .insert(dbRow)
      .select()
      .single();

    if (error) {
      return Response.json({ error: error.message, details: error.details, hint: error.hint }, { status: 400 });
    }

    // Map DB columns back to frontend fields
    const result = { ...data };
    if ('type' in result) { result.vehicle_type = result.type; delete result.type; }
    if ('price' in result) { result.price_per_week = result.price; delete result.price; }

    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});