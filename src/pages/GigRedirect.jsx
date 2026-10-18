// src/pages/GigRedirect.jsx
//
// Route: /gig/:gigId — a neutral link to a gig (used by push and bell taps).
// Opens the driver's trip screen if the signed-in user is the gig's driver,
// otherwise the customer's status screen. RLS only lets the customer and the
// assigned driver read the gig, so anyone else sees "not found".

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, supabase } from '@/api/supabaseData';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';

export default function GigRedirect() {
  const { gigId } = useParams();
  const navigate = useNavigate();
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [me, { data, error }] = await Promise.all([
        auth.me(),
        supabase.from('gig_requests').select('id, driver_id, customer_id').eq('id', gigId).maybeSingle(),
      ]);
      if (!alive) return;
      if (error) console.error('[GigRedirect] gig fetch failed:', error);
      if (!data || !me?.id) {
        setNotFound(true);
        return;
      }
      navigate(data.driver_id === me.id ? `/gig-drive/${gigId}` : `/gig-status/${gigId}`, { replace: true });
    })();
    return () => { alive = false; };
  }, [gigId, navigate]);

  if (notFound) {
    return (
      <div className="p-4 lg:p-8 max-w-2xl mx-auto">
        <PageHeader title="Gig" backTo="/gigs" />
        <p className="text-muted-foreground">Gig not found.</p>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto flex items-center justify-center min-h-[50vh]">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}
