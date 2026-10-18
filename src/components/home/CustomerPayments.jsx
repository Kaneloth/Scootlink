// src/components/home/CustomerPayments.jsx
//
// The 'Payments' tab for customers (Briefcase slot): card payments for rides
// and deliveries, and any refunds.

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, CreditCard, Undo2 } from 'lucide-react';
import { supabase } from '@/api/supabaseData';
import { rand, shortDate } from './gigLabels';

const REFUND_LABEL = {
  due: 'Refund on its way',
  processing: 'Refund on its way',
  needs_bank_details: 'Refund needs your bank details',
  failed: 'Refund delayed — we\'re on it',
  refunded: 'Refunded',
};

export default function CustomerPayments() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setRows([]); return; }
      const [{ data: pays, error: pErr }, { data: refunds, error: rErr }] = await Promise.all([
        supabase.from('platform_payments')
          .select('id, kind, gig_id, amount, status, paid_at, created_at')
          .eq('user_id', user.id).eq('kind', 'gig_fare').in('status', ['paid', 'refunded'])
          .order('created_at', { ascending: false }).limit(100),
        supabase.from('gig_refunds')
          .select('id, payment_id, gig_id, amount, status, processed_at')
          .eq('customer_id', user.id),
      ]);
      if (pErr) console.error('[CustomerPayments] payments failed:', pErr);
      if (rErr) console.error('[CustomerPayments] refunds failed:', rErr);
      const byPayment = Object.fromEntries((refunds || []).map((r) => [r.payment_id, r]));
      setRows((pays || []).map((p) => ({ ...p, refund: byPayment[p.id] || null })));
    })();
  }, []);

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight mb-1">Payments</h1>
      <p className="text-sm text-muted-foreground mb-5">Card payments for your rides and deliveries. Cash trips are paid to the driver.</p>

      {rows === null && <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
      {rows?.length === 0 && <p className="text-sm text-muted-foreground text-center py-12">No card payments yet.</p>}

      <div className="space-y-2">
        {(rows || []).map((p) => (
          <button
            key={p.id}
            onClick={() => p.gig_id && navigate(`/gig-status/${p.gig_id}`)}
            className="w-full flex items-center gap-3 p-3 rounded-xl border border-border bg-card text-left"
          >
            {p.refund ? <Undo2 className="w-5 h-5 text-muted-foreground shrink-0" /> : <CreditCard className="w-5 h-5 text-muted-foreground shrink-0" />}
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium">Trip #{p.gig_id}</span>
              <span className="block text-xs text-muted-foreground">
                {shortDate(p.paid_at || p.created_at)}
                {p.refund ? ` · ${REFUND_LABEL[p.refund.status] || p.refund.status} (${rand(p.refund.amount)})` : ''}
              </span>
            </span>
            <span className="text-sm font-semibold">{rand(p.amount)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
