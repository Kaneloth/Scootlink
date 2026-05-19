import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://bqugoifzdphclymjfuny.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_9GaQZ9aK2aSNM2OZQJwe7Q_-pwwjMu9';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Detect password recovery ASAP — before React renders any component.
// When the user clicks a reset link, Supabase fires PASSWORD_RECOVERY during
// its async token exchange. Registering here (module load time) guarantees the
// listener is in place before that exchange completes, on both desktop and mobile.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    sessionStorage.setItem('skootlink_recovery', '1');
  }
});
