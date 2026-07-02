import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://bqugoifzdphclymjfuny.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_9GaQZ9aK2aSNM2OZQJwe7Q_-pwwjMu9';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Disable auto URL detection so Supabase doesn't try to exchange the
    // OAuth ?code= itself. App.jsx handles the exchange manually so we have
    // full control over where to redirect after sign-in. Without this,
    // both the client and App.jsx race to consume the same single-use code
    // — whichever loses gets an "invalid code" error and bounces to /auth.
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

// Detect password recovery ASAP — before React renders any component.
// When the user clicks a reset link, Supabase fires PASSWORD_RECOVERY during
// its async token exchange. Registering here (module load time) guarantees the
// listener is in place before that exchange completes, on both desktop and mobile.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    sessionStorage.setItem('skootlink_recovery', '1');
  }
});
