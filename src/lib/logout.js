import { supabase, saveBiometricRefreshToken } from '@/api/supabaseData';

// src/lib/logout.js
// Shared biometric-aware logout (moved from AppLayout so the Home top bar can use it).
// All logout buttons in the layout must go through this helper so that
// biometric users keep their refresh token alive on the server.
export async function logout(navigate) {
  if (localStorage.getItem('scootlink_signin_method') === 'biometric') {
    // Save the current session without calling signOut — signOut (even
    // scope:'local') sends a server-side revocation that invalidates the
    // refresh token, breaking biometric restoration on next login.
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session) saveBiometricRefreshToken(data.session);
    } catch { /* non-fatal */ }
    // The Supabase session is still valid on purpose (see above) — without
    // this flag, Auth.jsx would see that valid session on mount and
    // immediately navigate straight back into the app, making logout look
    // broken. Cleared the moment the user explicitly signs back in.
    sessionStorage.setItem('skootlink_biometric_locked', '1');
    navigate('/auth');
  } else {
    await supabase.auth.signOut();
    navigate('/auth');
  }
}

