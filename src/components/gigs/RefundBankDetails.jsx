// src/components/gigs/RefundBankDetails.jsx
//
// Shown on the customer's gig screen when PayFast will only pay their refund
// into a bank account (gig_refunds.status = 'needs_bank_details', migration
// 019). The bank list is PayFast's own (gig_refunds.bank_options), because
// PayFast needs its bank codes. Saving refund_bank_accounts releases the
// refund to be sent (database trigger).

import React, { useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const formatRand = (n) => `R ${Number(n || 0).toFixed(2)}`;

export default function RefundBankDetails({ gigId, meId }) {
  const [refund, setRefund] = useState(null);
  const [existing, setExisting] = useState(null);
  const [form, setForm] = useState({ account_holder: '', bank_name: '', branch_code: '', account_number: '', account_type: 'current' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ data: r, error: rErr }, { data: a, error: aErr }] = await Promise.all([
        supabase.from('gig_refunds').select('id, amount, status, bank_options').eq('gig_id', gigId).maybeSingle(),
        supabase.from('refund_bank_accounts').select('*').eq('user_id', meId).maybeSingle(),
      ]);
      if (rErr) console.error('[RefundBankDetails] refund load failed:', rErr);
      if (aErr) console.error('[RefundBankDetails] account load failed:', aErr);
      if (!alive) return;
      setRefund(r || null);
      if (a) {
        setExisting(a);
        setForm({ account_holder: a.account_holder, bank_name: a.bank_name, branch_code: a.branch_code, account_number: a.account_number, account_type: a.account_type });
      }
    })();
    return () => { alive = false; };
  }, [gigId, meId]);

  if (!refund || refund.status !== 'needs_bank_details' || saved) {
    return saved ? (
      <p className="text-sm mb-4 rounded-lg bg-muted p-3">Thanks — we'll send your refund to that account shortly.</p>
    ) : null;
  }

  const banks = Array.isArray(refund.bank_options) ? refund.bank_options : [];
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.account_holder.trim().length >= 2 && form.bank_name
    && /^[0-9]{6}$/.test(form.branch_code) && /^[0-9]{6,12}$/.test(form.account_number);

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    const bank = banks.find((b) => b.bank_name === form.bank_name);
    const { error } = await supabase.from('refund_bank_accounts').upsert({
      user_id: meId,
      account_holder: form.account_holder.trim(),
      bank_name: form.bank_name,
      bank_label: bank?.label || form.bank_name,
      branch_code: form.branch_code,
      account_number: form.account_number,
      account_type: form.account_type,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    setSaving(false);
    if (error) {
      console.error('[RefundBankDetails] save failed:', error);
      toast.error('Could not save your bank details. Please check them and try again.');
      return;
    }
    toast.success('Bank details saved');
    setSaved(true);
  };

  return (
    <div className="mb-4 rounded-xl border border-border/50 p-4 space-y-3">
      <div>
        <p className="font-semibold text-sm">Where should we send your {formatRand(refund.amount)} refund?</p>
        <p className="text-xs text-muted-foreground">
          This refund can't go back to your card, so PayFast pays it into your bank account.
          {existing && ' Please check the details below and pick your bank from the list.'}
        </p>
      </div>
      <div>
        <Label htmlFor="rb-holder">Account holder</Label>
        <Input id="rb-holder" className="mt-1" value={form.account_holder} onChange={set('account_holder')} maxLength={120} />
      </div>
      <div>
        <Label htmlFor="rb-bank">Bank</Label>
        <select id="rb-bank" value={form.bank_name} onChange={set('bank_name')}
          className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Choose your bank</option>
          {banks.map((b) => <option key={b.bank_name} value={b.bank_name}>{b.label || b.bank_name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="rb-acct">Account number</Label>
          <Input id="rb-acct" className="mt-1" inputMode="numeric" value={form.account_number}
            onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value.replace(/\D/g, '').slice(0, 12) }))} />
        </div>
        <div>
          <Label htmlFor="rb-branch">Branch code</Label>
          <Input id="rb-branch" className="mt-1" inputMode="numeric" value={form.branch_code}
            onChange={(e) => setForm((f) => ({ ...f, branch_code: e.target.value.replace(/\D/g, '').slice(0, 6) }))} />
        </div>
      </div>
      <div>
        <Label htmlFor="rb-type">Account type</Label>
        <select id="rb-type" value={form.account_type} onChange={set('account_type')}
          className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="current">Current / cheque</option>
          <option value="savings">Savings</option>
        </select>
      </div>
      <Button className="w-full" onClick={save} disabled={!valid || saving}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save and send my refund'}
      </Button>
    </div>
  );
}
