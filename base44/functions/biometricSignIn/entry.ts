import { createClient } from 'npm:@supabase/supabase-js@2.105.3';
import * as jose from 'npm:jose@5.0.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

Deno.serve(async (req) => {
  try {
    const { email } = await req.json();
    if (!email) {
      return Response.json({ error: 'Email required' }, { status: 400 });
    }

    // Create admin client to fetch user
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: user, error: userError } = await adminClient.auth.admin.getUserByEmail(email);
    
    if (userError || !user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    // Check if biometric is enrolled
    if (!user.user_metadata?.biometric_enrolled) {
      return Response.json({ error: 'Biometric not enrolled for this user' }, { status: 401 });
    }

    // Generate JWT token with jose
    const secret = new TextEncoder().encode(SUPABASE_SERVICE_ROLE_KEY);
    const alg = 'HS256';

    const payload = {
      aud: 'authenticated',
      sub: user.id,
      email: user.email,
      phone: user.phone || '',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      email_confirmed_at: user.email_confirmed_at,
      phone_confirmed_at: user.phone_confirmed_at,
      user_metadata: user.user_metadata,
      app_metadata: user.app_metadata,
    };

    const token = await jose.SignJWT(payload)
      .setProtectedHeader({ alg })
      .setExpirationTime('1h')
      .sign(secret);

    // Generate refresh token (longer expiry)
    const refreshPayload = {
      aud: 'refresh',
      sub: user.id,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 604800, // 7 days
    };

    const refreshToken = await jose.SignJWT(refreshPayload)
      .setProtectedHeader({ alg })
      .setExpirationTime('7d')
      .sign(secret);

    return Response.json({
      access_token: token,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: 3600,
      user: {
        id: user.id,
        email: user.email,
        user_metadata: user.user_metadata,
      },
    });
  } catch (error) {
    console.error('Biometric sign-in error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});