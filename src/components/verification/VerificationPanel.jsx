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
import { Capacitor } from '@capacitor/core';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ShieldCheck, Upload, Loader2, X, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { toast } from 'sonner';

// ── Pricing ───────────────────────────────────────────────────────────────────
// sa_id: R49 covers the R32.89 real cost (1cr said_verification + 10cr Face
// Match against the Home Affairs photo) with ~49% margin.
// passport: R35 covers the R20.93 real cost (6cr id-document-verify OCR +
// 1cr Face Match Standard) with ~67% margin — see verify-identity.js for
// the passport flow, which now also fixes a previously-undocumented
// reportType by switching to VerifyNow's documented /id-document-verify
// endpoint (the same one already used for driver's licence verification).
const PRICES = {
  sa_id:    { label: 'RSA ID Verification',       amount: 49 },
  passport: { label: 'Passport Verification',      amount: 35 },
  licence:  { label: "Driver's Licence Verification", amount: 35 },
};

// Refund-credit conversion rate — was still referencing the old R39/15cr
// Starter Pack pricing from before the credit packages were repriced.
// Current Starter Pack: R49 / 240 credits = R0.2042/credit.
const PRICE_PER_CREDIT = 49 / 240; // ~R0.2042/credit
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
      const res = await fetch('https://skootlink.co.za/.netlify/functions/payfast-initiate-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ service_type: service }),
      });

      // Guard against HTML error pages (function not found, crashed, etc.)
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        console.error('[payfast-initiate-verification] non-JSON response:', res.status, text.slice(0, 200));
        throw new Error(`Function error (${res.status}). Please ensure the payfast-initiate-verification function is deployed.`);
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start payment');

      if (Capacitor.isNativePlatform()) {
        // Open in a Custom Tab, not the app's own WebView — PayFast's
        // process endpoint accepts the same fields as a GET query string.
        // The return_url the server built always points at our own https
        // bridge page (public/payment-callback.html) regardless of
        // platform, which then triggers the co.za.skootlink.app:// deep
        // link itself — see payfast-initiate-verification.js.
        const qs = new URLSearchParams(data.fields).toString();
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url: `${data.action_url}?${qs}`, presentationStyle: 'popover' });
        return;
      }

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
            <p className="text-xs text-muted-foreground">One-time verification fee — R{price.amount}</p>
          </div>
        </div>

        <div className="bg-muted rounded-xl p-4 mb-4 space-y-2">
          <p className="text-[10px] text-muted-foreground">
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
            Pay Securely — R{price.amount}
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

// ── Selfie capture sub-component ────────────────────────────────────────────
// Uses capture="user" to prefer the front-facing camera on mobile. Required
// for SA ID verification — VerifyNow's Face Match check compares this photo
// against the Home Affairs photo on file for the entered ID number.
function SelfieCapture({ file, onChange }) {
  const ref = useRef();
  return (
    <div>
      <Label className="text-xs">Selfie Photo</Label>
      <p className="text-[10px] text-muted-foreground mb-1">
        A clear, well-lit photo of your face — used to confirm you are the person on the ID
      </p>
      <div
        className="mt-1 flex flex-col items-center gap-2 cursor-pointer"
        onClick={() => ref.current?.click()}
      >
        <input
          ref={ref}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={e => onChange(e.target.files[0] || null)}
        />
        <div className={`w-24 h-24 rounded-full border-2 border-dashed flex items-center justify-center overflow-hidden transition-colors ${
          file ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/30'
        }`}>
          {file ? (
            <img src={URL.createObjectURL(file)} alt="selfie preview" className="w-full h-full object-cover" />
          ) : (
            <Upload className="w-6 h-6 text-muted-foreground" />
          )}
        </div>
        <p className="text-xs text-primary font-medium">{file ? 'Tap to retake' : 'Tap to take a selfie'}</p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function VerificationPanel({ user, accountType, onUserUpdated }) {
  // ID verification state
  const [idTab,              setIdTab]              = useState('sa_id');
  const [saId,               setSaId]               = useState('');
  const [saIdSelfie,         setSaIdSelfie]         = useState(null);
  const [passportNumber,     setPassportNumber]     = useState('');
  const [passportFront,      setPassportFront]      = useState(null);
  const [passportBack,       setPassportBack]       = useState(null);
  const [passportSelfie,     setPassportSelfie]     = useState(null);
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

  // App.jsx's appUrlOpen listener dispatches this directly the instant it
  // parses the co.za.skootlink.app://payment-result deep link — the one
  // mechanism in this whole chain proven reliable (Google sign-in already
  // depends on it). A plain window event listener persists for this
  // component's whole lifetime, so it doesn't matter that this page never
  // unmounts while the Custom Tab is open.
  const handlePaymentResult = React.useCallback((result) => {
    if (!result || result.category !== 'verification') return; // not ours — e.g. a credits purchase

    setPaymentModal(null);
    if (result.status === 'success') {
      toast.success('Payment received! Verifying…');
      setPendingVerify(prevFn => {
        if (prevFn) prevFn(true); // true = justPaid, gives the webhook time to land
        return null;
      });
    } else if (result.status === 'cancelled') {
      toast.info('Payment cancelled — verification was not started.');
      setPendingVerify(null);
    }
  }, []);

  // Reads whatever App.jsx's appUrlOpen handler stashed in sessionStorage —
  // used both on mount and whenever the app resumes to the foreground.
  const checkStoredResult = React.useCallback(() => {
    const raw = sessionStorage.getItem('skootlink_payment_result');
    if (!raw) return;
    sessionStorage.removeItem('skootlink_payment_result');
    try { handlePaymentResult(JSON.parse(raw)); } catch { /* ignore */ }
  }, [handlePaymentResult]);

  React.useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Covers the case where App.jsx's dispatch fired before this component
    // mounted (app process killed while the Custom Tab was open, relaunched
    // fresh) — App.jsx also stashes the same detail here as a fallback.
    checkStoredResult();

    const onEvent = (e) => handlePaymentResult(e.detail);
    window.addEventListener('skootlink:payment-result', onEvent);

    // Second, independent trigger: Capacitor's own "app became active
    // again" event — fires whenever the OS brings the app back to the
    // foreground for any reason, regardless of the exact timing of our
    // custom deep-link event dispatch.
    let appListener;
    (async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app');
        appListener = await CapApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive) checkStoredResult();
        });
      } catch { /* not in Capacitor environment */ }
    })();

    // Third, independent safety net: if the Custom Tab closes for any
    // reason — including the user manually backing out of PayFast's own
    // confirmation screen instead of it auto-redirecting — this guarantees
    // the payment modal never stays stuck open forever. Deliberately leaves
    // pendingVerify untouched: if a real result still arrives shortly after
    // (via the event or appStateChange above), it can still seamlessly
    // continue the verification on success. Worst case, if no result ever
    // arrives, the user just needs to tap Verify again.
    let browserListener;
    (async () => {
      try {
        const { Browser } = await import('@capacitor/browser');
        browserListener = await Browser.addListener('browserFinished', () => {
          setPaymentModal(null);
        });
      } catch { /* not in Capacitor environment */ }
    })();

    return () => {
      window.removeEventListener('skootlink:payment-result', onEvent);
      if (appListener) appListener.remove().catch(() => {});
      if (browserListener) browserListener.remove().catch(() => {});
    };
  }, [handlePaymentResult, checkStoredResult]);

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

  const hasPaid = async (serviceType, { retries = 1, delayMs = 1500 } = {}) => {
    // Check if user has a recent verified_payment for this service_type —
    // and that it actually covers the CURRENT price. A stale unused payment
    // from before a price change (e.g. an old R15 SA ID payment that never
    // got marked `used`) must not silently satisfy a higher new price.
    //
    // retries > 1 is only used right after a payment completes — the ITN
    // webhook (PayFast → Hookdeck → this app → Supabase) can take a few
    // seconds to actually mark the row 'paid', and checking only once right
    // as the user returns from paying could catch it mid-flight and
    // wrongly show the payment prompt again. The normal "user just tapped
    // Verify" path stays a single immediate check, so genuinely-unpaid
    // users see the payment modal right away, not after a multi-second wait.
    for (let attempt = 0; attempt < retries; attempt++) {
      const { data } = await supabase
        .from('verification_payments')
        .select('id, amount')
        .eq('user_id', user?.id)
        .eq('service_type', serviceType)
        .eq('status', 'paid')
        .eq('used', false)
        .maybeSingle();
      if (data) {
        const requiredAmount = PRICES[serviceType]?.amount ?? 0;
        if (data.amount == null || Number(data.amount) >= requiredAmount) return true;
      }
      if (attempt < retries - 1) await new Promise(r => setTimeout(r, delayMs));
    }
    return false;
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
  const doVerifySaId = async (justPaid = false) => {
    if (!saId.trim() || saId.replace(/\s/g, '').length !== 13) {
      toast.error('Please enter a valid 13-digit SA ID number'); return;
    }
    if (!saIdSelfie) {
      toast.error('Please take a selfie — it\'s required to confirm you are the ID holder'); return;
    }
    const paid = await hasPaid('sa_id', justPaid ? { retries: 5, delayMs: 1500 } : {});
    if (!paid) { setPaymentModal('sa_id'); setPendingVerify(() => doVerifySaId); return; }

    setIdStatus('verifying'); setIdMsg('');
    try {
      const selfieB64 = await compressImage(saIdSelfie);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('https://skootlink.co.za/.netlify/functions/verify-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          documentType:      'sa_id',
          idNumber:          saId.trim(),
          selfieImageBase64: selfieB64,
        }),
      });
      const data = await res.json();
      if (data.verified) {
        setIdStatus('verified'); setIdMsg(data.message || 'SA ID verified successfully.');
        toast.success('Identity verified! Your ✅ ID Verified badge has been updated.');
        onUserUpdated?.();
      } else if (data.alreadyVerified) {
        // Locked — identity was already successfully verified previously
        setIdStatus('verified'); setIdMsg(data.message || 'Your identity is already verified.');
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
  const doVerifyPassport = async (justPaid = false) => {
    if (!passportNumber.trim()) { toast.error('Please enter your passport number'); return; }
    if (!passportFront || !passportBack) { toast.error('Please upload both passport photos as required by VerifyNow'); return; }
    if (!passportSelfie) { toast.error('Please take a selfie — it\'s required to confirm you are the passport holder'); return; }

    const paid = await hasPaid('passport', justPaid ? { retries: 5, delayMs: 1500 } : {});
    if (!paid) { setPaymentModal('passport'); setPendingVerify(() => doVerifyPassport); return; }

    setIdStatus('verifying'); setIdMsg('');
    try {
      const [frontB64, backB64, selfieB64] = await Promise.all([
        compressImage(passportFront), compressImage(passportBack), compressImage(passportSelfie),
      ]);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('https://skootlink.co.za/.netlify/functions/verify-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          documentType:      'passport',
          idNumber:          passportNumber.trim(), // verify-identity.js uses idNumber for both types
          frontImageBase64:  frontB64,
          backImageBase64:   backB64,
          selfieImageBase64: selfieB64,
        }),
      });
      const data = await res.json();
      if (data.verified) {
        setIdStatus('verified'); setIdMsg(data.message || 'Passport verified successfully.');
        toast.success('Passport verified! Your ✅ ID Verified badge has been updated.');
        onUserUpdated?.();
      } else if (data.alreadyVerified) {
        // Locked — identity was already successfully verified previously
        setIdStatus('verified'); setIdMsg(data.message || 'Your identity is already verified.');
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
  const doVerifyLicence = async (justPaid = false) => {
    if (!licenceNumber.trim()) { toast.error('Please enter your driver\'s licence number'); return; }
    if (!licenceFront || !licenceBack) { toast.error('Please upload both front and back of your licence'); return; }

    const paid = await hasPaid('licence', justPaid ? { retries: 5, delayMs: 1500 } : {});
    if (!paid) { setPaymentModal('licence'); setPendingVerify(() => doVerifyLicence); return; }

    setLicStatus('verifying'); setLicMsg('');
    try {
      const [frontB64, backB64] = await Promise.all([
        compressImage(licenceFront), compressImage(licenceBack),
      ]);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('https://skootlink.co.za/.netlify/functions/verify-licence', {
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
            <TabsTrigger value="sa_id">🇿🇦 RSA ID</TabsTrigger>
            <TabsTrigger value="passport">🛂 Passport</TabsTrigger>
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
            <SelfieCapture file={saIdSelfie} onChange={setSaIdSelfie} />
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
               idStatus === 'failed'    ? <><RefreshCw className="w-4 h-4" /> Retry</> :
               <><ShieldCheck className="w-4 h-4" /> Verify RSA ID</>}
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
            <SelfieCapture file={passportSelfie} onChange={setPassportSelfie} />
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
               idStatus === 'failed'    ? <><RefreshCw className="w-4 h-4" /> Retry</> :
               <><ShieldCheck className="w-4 h-4" /> Verify Passport</>}
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
               licStatus === 'failed'    ? <><RefreshCw className="w-4 h-4" /> Retry</> :
               <><ShieldCheck className="w-4 h-4" /> Verify Licence</>}
            </Button>
          </div>
        </Card>
      )}

      <p className="text-[10px] text-muted-foreground text-center px-4">
        Verification is powered by VerifyNow. Your documents are processed securely and never stored on Skootlink servers.
        Payments are processed securely and are non-refundable except in the case of technical failure.
      </p>
    </div>
  );
}
