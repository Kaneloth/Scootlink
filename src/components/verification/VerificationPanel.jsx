/**
 * VerificationPanel.jsx
 * Handles ID verification (RSA ID + Passport tabs) and Driver's Licence verification.
 * Verification is a paid service — NOT payable with free credits.
 * Prices: RSA ID = R15, Passport = R35, Driver's Licence = R35
 *
 * On failure: user is credited back in usage credits (based on lowest package rate)
 * and shown a refund request option.
 *
 * Place at: src/components/verification/VerificationPanel.jsx
 */
import React, { useState, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ShieldCheck, Upload, Loader2, X, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { toast } from 'sonner';

// ── Pricing ───────────────────────────────────────────────────────────────────
const PRICES = {
  sa_id:    { label: 'RSA ID Verification',       amount: 15 },
  passport: { label: 'Passport Verification',      amount: 35 },
  licence:  { label: "Driver's Licence Verification", amount: 35 },
};

// Lowest package: R39 / 15 credits = R2.60/cr → refund = Math.floor(price / 2.60)
const PRICE_PER_CREDIT = 39 / 15; // ~R2.60
const creditsForRefund = (priceZar) => Math.floor(priceZar / PRICE_PER_CREDIT);

// ── Image uploader sub-component ──────────────────────────────────────────────
function ImageUpload({ label, hint, file, onChange }) {
  const ref = useRef();
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      {hint && <p className="text-[10px] text-muted-foreground mb-1">{hint}</p>}
      <div
        className={`mt-1 border-2 border-dashed rounded-xl p-3 flex items-center gap-3 cursor-pointer transition-colors ${
          file ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/30'
        }`}
        onClick={() => ref.current?.click()}
      >
        <input ref={ref} type="file" accept="image/*" className="hidden" onChange={e => onChange(e.target.files[0] || null)} />
        {file ? (
          <>
            <img src={URL.createObjectURL(file)} alt="preview" className="w-16 h-12 object-cover rounded-lg shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{file.name}</p>
              <p className="text-[10px] text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
            </div>
            <button className="shrink-0 p-1 rounded hover:bg-muted" onClick={e => { e.stopPropagation(); onChange(null); }}>
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </>
        ) : (
          <>
            <Upload className="w-5 h-5 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">Tap to upload photo</p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Payment modal ─────────────────────────────────────────────────────────────
function PaymentModal({ service, onPay, onCancel, paying }) {
  const price = PRICES[service];
  if (!price) return null;

  const handlePayFast = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { toast.error('Please sign in first.'); return; }

    try {
      const res = await fetch('/.netlify/functions/payfast-initiate-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ service_type: service }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start payment');

      // Build PayFast form and POST
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = data.action_url;
      Object.entries(data.fields).forEach(([k, v]) => {
        const input = document.createElement('input');
        input.type = 'hidden'; input.name = k; input.value = v;
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
    } catch (err) {
      toast.error(err.message || 'Payment could not be started. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card rounded-2xl shadow-xl max-w-sm w-full p-6 border border-border">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-foreground">{price.label}</p>
            <p className="text-xs text-muted-foreground">One-time verification fee</p>
          </div>
        </div>

        <div className="bg-muted rounded-xl p-4 mb-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{price.label}</span>
            <span className="font-bold text-foreground">R{price.amount}.00</span>
          </div>
          <p className="text-[10px] text-muted-foreground border-t border-border pt-2">
            This is a direct payment — free credits cannot be used for verification services.
            If verification fails due to a technical issue on our side before VerifyNow is contacted,
            you will receive {creditsForRefund(price.amount)} usage credits as compensation,
            or you may request a cash refund. If VerifyNow processes your request and returns
            a negative result, no refund is issued as the verification service has been rendered.
          </p>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1 gap-2" onClick={handlePayFast}>
            Pay R{price.amount} via PayFast
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status, message, credits, onRequestRefund }) {
  if (!status) return null;
  if (status === 'verifying') return (
    <div className="flex items-center gap-2 p-3 rounded-xl bg-muted text-muted-foreground text-sm">
      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
      Verifying with VerifyNow...
    </div>
  );
  if (status === 'verified') return (
    <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 text-sm">
      <CheckCircle2 className="w-4 h-4 shrink-0" /> {message || 'Verified successfully!'}
    </div>
  );
  if (status === 'failed') return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <p>{message || 'Verification failed. Please check your details and try again.'}</p>
          {credits > 0 && (
            <p className="text-xs mt-1 opacity-80">
              VerifyNow was not contacted due to a technical issue on our side.
              {credits} usage credits have been added to your account as compensation.
            </p>
          )}
        </div>
      </div>
      {credits > 0 && (
        <button
          className="text-xs text-primary underline underline-offset-2 hover:opacity-80"
          onClick={onRequestRefund}
        >
          Prefer a cash refund instead? Request one here →
        </button>
      )}
    </div>
  );
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function VerificationPanel({ user, accountType, onUserUpdated }) {
  // ID verification state
  const [idTab,              setIdTab]              = useState('sa_id');
  const [saId,               setSaId]               = useState('');
  const [passportNumber,     setPassportNumber]     = useState('');
  const [passportFront,      setPassportFront]      = useState(null);
  const [passportBack,       setPassportBack]       = useState(null);
  const [idStatus,           setIdStatus]           = useState('');
  const [idMsg,              setIdMsg]              = useState('');
  const [idRefundCredits,    setIdRefundCredits]    = useState(0);

  // Licence verification state
  const [licenceNumber,      setLicenceNumber]      = useState(user?.license_number || '');
  const [licenceFront,       setLicenceFront]       = useState(null);
  const [licenceBack,        setLicenceBack]        = useState(null);
  const [licStatus,          setLicStatus]          = useState('');
  const [licMsg,             setLicMsg]             = useState('');
  const [licRefundCredits,   setLicRefundCredits]   = useState(0);

  // Payment modal
  const [paymentModal,       setPaymentModal]       = useState(null); // 'sa_id' | 'passport' | 'licence'
  const [pendingVerify,      setPendingVerify]      = useState(null); // function to call after payment confirmed

  const isDriver = accountType === 'driver' || accountType === 'both';

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const compressImage = (file, maxPx = 1200, quality = 0.8) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = url;
    });

  const hasPaid = async (serviceType) => {
    // Check if user has a recent verified_payment for this service_type
    const { data } = await supabase
      .from('verification_payments')
      .select('id')
      .eq('user_id', user?.id)
      .eq('service_type', serviceType)
      .eq('status', 'paid')
      .eq('used', false)
      .maybeSingle();
    return !!data;
  };

  const refundCredits = async (serviceType, setRefundCredits) => {
    const price = PRICES[serviceType]?.amount || 0;
    const credits = creditsForRefund(price);
    if (credits > 0 && user?.id) {
      await supabase.rpc('add_credits', {
        p_user_id:     user.id,
        p_amount:      credits,
        p_type:        'refund',
        p_description: `Verification refund — ${PRICES[serviceType]?.label}`,
        p_ref_id:      null,
      });
      setRefundCredits(credits);
    }
  };

  const handleRequestRefund = async (serviceType) => {
    toast.info('Refund request submitted. Our team will process it within 3–5 business days.');
    await supabase.from('refund_requests').insert({
      user_id:      user?.id,
      service_type: serviceType,
      amount:       PRICES[serviceType]?.amount,
      reason:       'Verification failed',
      status:       'pending',
    }).catch(() => {});
  };

  // ── Verify RSA ID ────────────────────────────────────────────────────────────
  const doVerifySaId = async () => {
    if (!saId.trim() || saId.replace(/\s/g, '').length !== 13) {
      toast.error('Please enter a valid 13-digit SA ID number'); return;
    }
    const paid = await hasPaid('sa_id');
    if (!paid) { setPaymentModal('sa_id'); setPendingVerify(() => doVerifySaId); return; }

    setIdStatus('verifying'); setIdMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/.netlify/functions/verify-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ documentType: 'sa_id', idNumber: saId.trim() }),
      });
      const data = await res.json();
      if (data.verified) {
        setIdStatus('verified'); setIdMsg(data.message || 'SA ID verified successfully.');
        toast.success('Identity verified! Your ✅ ID Verified badge has been updated.');
        onUserUpdated?.();
      } else {
        // VerifyNow was contacted and returned a negative result — no refund
        setIdStatus('failed'); setIdMsg(data.message || 'Verification failed. Please check your ID number and try again.');
      }
      // Mark payment as used regardless of result — VerifyNow was contacted
      await supabase.from('verification_payments')
        .update({ used: true }).eq('user_id', user?.id).eq('service_type', 'sa_id').eq('status', 'paid').eq('used', false);
    } catch (err) {
      // Our side failed — VerifyNow was never contacted — issue refund
      setIdStatus('failed'); setIdMsg('Verification service unavailable. Please try again later.');
      await refundCredits('sa_id', setIdRefundCredits);
    }
  };

  // ── Verify Passport ──────────────────────────────────────────────────────────
  const doVerifyPassport = async () => {
    if (!passportNumber.trim()) { toast.error('Please enter your passport number'); return; }
    if (!passportFront || !passportBack) { toast.error('Please upload both passport photos as required by VerifyNow'); return; }

    const paid = await hasPaid('passport');
    if (!paid) { setPaymentModal('passport'); setPendingVerify(() => doVerifyPassport); return; }

    setIdStatus('verifying'); setIdMsg('');
    try {
      const [frontB64, backB64] = await Promise.all([
        compressImage(passportFront), compressImage(passportBack),
      ]);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/.netlify/functions/verify-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          documentType:     'passport',
          passportNumber:   passportNumber.trim(),
          frontImageBase64: frontB64,
          backImageBase64:  backB64,
        }),
      });
      const data = await res.json();
      if (data.verified) {
        setIdStatus('verified'); setIdMsg(data.message || 'Passport verified successfully.');
        toast.success('Passport verified! Your ✅ ID Verified badge has been updated.');
        onUserUpdated?.();
      } else {
        // VerifyNow was contacted and returned a negative result — no refund
        setIdStatus('failed'); setIdMsg(data.message || 'Verification failed. Please check your passport details and photos.');
      }
      // Mark payment as used regardless of result — VerifyNow was contacted
      await supabase.from('verification_payments')
        .update({ used: true }).eq('user_id', user?.id).eq('service_type', 'passport').eq('status', 'paid').eq('used', false);
    } catch (err) {
      // Our side failed — VerifyNow was never contacted — issue refund
      setIdStatus('failed'); setIdMsg('Verification service unavailable. Please try again later.');
      await refundCredits('passport', setIdRefundCredits);
    }
  };

  // ── Verify Driver's Licence ──────────────────────────────────────────────────
  const doVerifyLicence = async () => {
    if (!licenceNumber.trim()) { toast.error('Please enter your driver\'s licence number'); return; }
    if (!licenceFront || !licenceBack) { toast.error('Please upload both front and back of your licence'); return; }

    const paid = await hasPaid('licence');
    if (!paid) { setPaymentModal('licence'); setPendingVerify(() => doVerifyLicence); return; }

    setLicStatus('verifying'); setLicMsg('');
    try {
      const [frontB64, backB64] = await Promise.all([
        compressImage(licenceFront), compressImage(licenceBack),
      ]);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/.netlify/functions/verify-licence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          licenceNumber:           licenceNumber.trim(),
          licenceFrontImageBase64: frontB64,
          licenceBackImageBase64:  backB64,
        }),
      });
      const data = await res.json();
      if (data.verified || data.pending) {
        setLicStatus('verified');
        setLicMsg(data.message || (data.pending ? 'Licence submitted — pending review.' : 'Licence verified!'));
        toast.success(data.pending ? 'Licence submitted for review. 🛡️' : 'Licence verified! 🛡️');
        onUserUpdated?.();
      } else {
        // VerifyNow was contacted and returned a negative result — no refund
        setLicStatus('failed'); setLicMsg(data.message || 'Verification failed. Please check your licence details and photos.');
      }
      // Mark payment as used regardless of result — VerifyNow was contacted
      await supabase.from('verification_payments')
        .update({ used: true }).eq('user_id', user?.id).eq('service_type', 'licence').eq('status', 'paid').eq('used', false);
    } catch (err) {
      // Our side failed — VerifyNow was never contacted — issue refund
      setLicStatus('failed'); setLicMsg('Verification service unavailable. Please try again later.');
      await refundCredits('licence', setLicRefundCredits);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Payment modal */}
      {paymentModal && (
        <PaymentModal
          service={paymentModal}
          onCancel={() => { setPaymentModal(null); setPendingVerify(null); }}
          onPay={() => {}}
        />
      )}

      {/* ── ID Verification ─────────────────────────────────────────────────── */}
      <Card className="p-5 border border-border/50">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <p className="font-semibold text-foreground">ID Verification</p>
          {user?.id_verified && (
            <span className="ml-auto text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 px-2 py-0.5 rounded-full">✅ Verified</span>
          )}
        </div>

        <Tabs value={idTab} onValueChange={setIdTab}>
          <TabsList className="mb-4 w-full grid grid-cols-2">
            <TabsTrigger value="sa_id">🇿🇦 RSA ID — R15</TabsTrigger>
            <TabsTrigger value="passport">🛂 Passport — R35</TabsTrigger>
          </TabsList>

          {/* RSA ID tab */}
          <TabsContent value="sa_id" className="space-y-3">
            <div>
              <Label className="text-xs">SA ID Number</Label>
              <p className="text-[10px] text-muted-foreground mb-1">Your 13-digit South African ID number as it appears on your green ID book or smart ID card</p>
              <Input
                className="mt-1 font-mono"
                placeholder="0001010000000"
                maxLength={13}
                value={saId}
                onChange={e => setSaId(e.target.value.replace(/\D/g, ''))}
              />
              {saId.length > 0 && saId.length !== 13 && (
                <p className="text-[10px] text-amber-500 mt-1">{13 - saId.length} more digits needed</p>
              )}
            </div>
            <StatusBadge
              status={idStatus}
              message={idMsg}
              credits={idRefundCredits}
              onRequestRefund={() => handleRequestRefund('sa_id')}
            />
            <Button
              className="w-full gap-2"
              disabled={idStatus === 'verifying' || idStatus === 'verified'}
              onClick={doVerifySaId}
            >
              {idStatus === 'verifying' ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</> :
               idStatus === 'verified'  ? <><CheckCircle2 className="w-4 h-4" /> Verified</> :
               idStatus === 'failed'    ? <><RefreshCw className="w-4 h-4" /> Retry (R15)</> :
               <><ShieldCheck className="w-4 h-4" /> Verify RSA ID — R15</>}
            </Button>
          </TabsContent>

          {/* Passport tab */}
          <TabsContent value="passport" className="space-y-3">
            <div>
              <Label className="text-xs">Passport Number</Label>
              <Input
                className="mt-1 font-mono uppercase"
                placeholder="A12345678"
                value={passportNumber}
                onChange={e => setPassportNumber(e.target.value.toUpperCase())}
              />
            </div>
            <ImageUpload
              label="Passport Photo — Page with photo & details"
              hint="Clear photo of the main data page (photo page). Required by VerifyNow."
              file={passportFront}
              onChange={setPassportFront}
            />
            <ImageUpload
              label="Passport Photo — Back cover or barcode page"
              hint="Clear photo of the back cover or machine-readable zone. Required by VerifyNow."
              file={passportBack}
              onChange={setPassportBack}
            />
            <StatusBadge
              status={idStatus}
              message={idMsg}
              credits={idRefundCredits}
              onRequestRefund={() => handleRequestRefund('passport')}
            />
            <Button
              className="w-full gap-2"
              disabled={idStatus === 'verifying' || idStatus === 'verified'}
              onClick={doVerifyPassport}
            >
              {idStatus === 'verifying' ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</> :
               idStatus === 'verified'  ? <><CheckCircle2 className="w-4 h-4" /> Verified</> :
               idStatus === 'failed'    ? <><RefreshCw className="w-4 h-4" /> Retry (R35)</> :
               <><ShieldCheck className="w-4 h-4" /> Verify Passport — R35</>}
            </Button>
          </TabsContent>
        </Tabs>
      </Card>

      {/* ── Driver's Licence Verification (drivers only) ─────────────────────── */}
      {isDriver && (
        <Card className="p-5 border border-border/50">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <p className="font-semibold text-foreground">Driver's Licence Verification</p>
            {user?.licence_verified && (
              <span className="ml-auto text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 px-2 py-0.5 rounded-full">✅ Verified</span>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <Label className="text-xs">Licence Number</Label>
              <p className="text-[10px] text-muted-foreground mb-1">Your driver's licence number as printed on the card</p>
              <Input
                className="mt-1 font-mono uppercase"
                placeholder="DL123456"
                value={licenceNumber}
                onChange={e => setLicenceNumber(e.target.value.toUpperCase())}
              />
            </div>
            <ImageUpload
              label="Licence Front"
              hint="Photo of the front of your driver's licence card — must show your name, photo, and licence number clearly"
              file={licenceFront}
              onChange={setLicenceFront}
            />
            <ImageUpload
              label="Licence Back"
              hint="Photo of the back of your driver's licence card — must show vehicle categories and expiry date clearly"
              file={licenceBack}
              onChange={setLicenceBack}
            />
            <StatusBadge
              status={licStatus}
              message={licMsg}
              credits={licRefundCredits}
              onRequestRefund={() => handleRequestRefund('licence')}
            />
            <Button
              className="w-full gap-2"
              disabled={licStatus === 'verifying' || licStatus === 'verified'}
              onClick={doVerifyLicence}
            >
              {licStatus === 'verifying' ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</> :
               licStatus === 'verified'  ? <><CheckCircle2 className="w-4 h-4" /> Verified</> :
               licStatus === 'failed'    ? <><RefreshCw className="w-4 h-4" /> Retry (R35)</> :
               <><ShieldCheck className="w-4 h-4" /> Verify Licence — R35</>}
            </Button>
          </div>
        </Card>
      )}

      <p className="text-[10px] text-muted-foreground text-center px-4">
        Verification is powered by VerifyNow. Your documents are processed securely and never stored on Skootlink servers.
        Payments are processed via PayFast and are non-refundable except in the case of technical failure.
      </p>
    </div>
  );
}
