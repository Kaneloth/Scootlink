import { createClient } from 'npm:@supabase/supabase-js@2.105.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

Deno.serve(async (req) => {
  try {
    const { email } = await req.json();
    if (!email) {
      return Response.json({ error: 'Email required' }, { status: 400 });
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: user, error } = await adminClient.auth.admin.getUserByEmail(email);
    
    if (error || !user) {
      return Response.json({ biometric_enrolled: false }, { status: 200 });
    }

    return Response.json({
      biometric_enrolled: user.user_metadata?.biometric_enrolled || false,
      biometric_credential_id: user.user_metadata?.biometric_credential_id || null,
      sign_in_method: user.user_metadata?.sign_in_method || 'password',
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});