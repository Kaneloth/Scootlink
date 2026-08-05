/**
 * VerificationPanel.jsx
 * Handles ID verification (RSA ID + Passport tabs) and Driver's Licence verification.
 * Verification is a paid service — NOT payable with free credits.
 * Prices: admin-configurable per service (default R25 each) — see
 * AdminIdentityVerification.jsx and app_settings.verification_price_*
 *
 * Documents are reviewed manually by an admin (no third-party verification
 * API) — see submit-verification.js and the admin Identity Verification
 * queue. On approval the badge is granted; on rejection the user can
 * re-submit once for free. If our own upload/submission fails before ever
 * reaching the review queue, the user is credited back in usage credits.
 *
 * Place at: src/components/verification/VerificationPanel.jsx
 */
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ShieldCheck, Upload, Loader2, X, AlertTriangle, CheckCircle2, RefreshCw, Clock } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { toast } from 'sonner';

// ── Pricing ───────────────────────────────────────────────────────────────────
// Labels are fixed; prices are admin-configurable (see AdminIdentityVerification.jsx
// and admin-app-settings.js's update_verification_prices action). FALLBACK_PRICES
// below is used only until the real values load, or if that fetch ever fails.
const SERVICE_LABELS = {
  sa_id:    'RSA ID Verification',
  passport: 'Passport Verification',
  licence:  "Driver's Licence Verification",
};
const FALLBACK_PRICES = { sa_id: 25, passport: 25, licence: 25 };

// Refund-credit conversion rate: R0.20/credit. Fixed, not admin-configurable —
// only the verification prices themselves are. Since the divisor is applied
// to whatever the current price is, this stays correct regardless of price.
const PRICE_PER_CREDIT = 0.20;
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
function PaymentModal({ service, price, onPay, onCancel, paying }) {
  if (!price) return null;

  const handlePayFast = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { toast.error('Please sign in first.'); return; }

    const isNative = Capacitor.isNativePlatform();

    try {
      const res = await fetch('https://skootlink.co.za/.netlify/functions/payfast-initiate-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ service_type: service, is_native: isNative }),
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

      if (isNative) {
        // Open in a Custom Tab, not the app's own WebView — PayFast's
        // process endpoint accepts the same fields as a GET query string.
        // return_url is a real server-side redirect (payment-redirect
        // function) straight to co.za.skootlink.app://payment-result — see
        // payfast-initiate-verification.js for why that's a server-side
        // redirect rather than a client-side JS one.
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

  return createPortal(
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
            Your documents are reviewed manually by our team. If our system fails to accept
            your submission due to a technical issue on our side, you can choose to try again,
            get usage credits equivalent to your payment, or request a cash refund. If your
            submission is reviewed and rejected, you may re-submit once for free — no
            additional payment required.
          </p>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1 gap-2" onClick={handlePayFast}>
            Pay Securely — R{price.amount}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status, message, credits, resolution, onTryAgain, onRefundCredits, onRequestCashRefund, resolving }) {
  if (!status) return null;
  if (status === 'verifying') return (
    <div className="flex items-center gap-2 p-3 rounded-xl bg-muted text-muted-foreground text-sm">
      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
      Submitting your documents...
    </div>
  );
  if (status === 'pending') return (
    <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm">
      <Clock className="w-4 h-4 shrink-0" />
      {message || 'Submitted — awaiting review. This usually takes a day or two.'}
    </div>
  );
  if (status === 'rejected') return (
    <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <div>
        <p className="font-medium">Your submission was rejected</p>
        <p className="mt-0.5">{message || 'Please review your details and photos, then submit again.'}</p>
        <p className="text-xs mt-1 opacity-80">You can resubmit below at no extra charge.</p>
      </div>
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
          <p>{message || 'Something went wrong on our side while submitting your documents.'}</p>
          {resolution === 'credits' && (
            <p className="text-xs mt-1 opacity-80">
              {credits} usage credits have been added to your account as compensation.
            </p>
          )}
          {resolution === 'cash' && (
            <p className="text-xs mt-1 opacity-80">
              Your cash refund request has been submitted — our team will process it within 3–5 business days.
            </p>
          )}
        </div>
      </div>
      {!resolution && (
        <div className="flex flex-wrap gap-2">
          <button
            disabled={resolving}
            onClick={onTryAgain}
            className="flex-1 min-w-[100px] text-xs font-medium px-3 py-2 rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50"
          >
            Try Again
          </button>
          <button
            disabled={resolving}
            onClick={onRefundCredits}
            className="flex-1 min-w-[100px] text-xs font-medium px-3 py-2 rounded-lg border border-primary/30 text-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
          >
            Get Credits Back
          </button>
          <button
            disabled={resolving}
            onClick={onRequestCashRefund}
            className="flex-1 min-w-[100px] text-xs font-medium px-3 py-2 rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50"
          >
            Request Cash Refund
          </button>
        </div>
      )}
    </div>
  );
  return null;
}

// ── Selfie capture sub-component ────────────────────────────────────────────
// Uses capture="user" to prefer the front-facing camera on mobile. Required
// for every verification type — lets the reviewing admin visually confirm
// the person submitting matches the photo on the uploaded document.
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
  const [saIdFront,          setSaIdFront]          = useState(null);
  const [saIdBack,           setSaIdBack]           = useState(null);
  const [saIdSelfie,         setSaIdSelfie]         = useState(null);
  const [passportNumber,     setPassportNumber]     = useState('');
  const [passportFront,      setPassportFront]      = useState(null);
  const [passportBack,       setPassportBack]       = useState(null);
  const [passportSelfie,     setPassportSelfie]     = useState(null);
  const [idStatus,           setIdStatus]           = useState('');
  const [idMsg,              setIdMsg]              = useState('');
  const [idRefundCredits,    setIdRefundCredits]    = useState(0);
  // null = failure not yet resolved, shows the Try Again / Credits / Cash
  // choice buttons. 'credits' | 'cash' = user has chosen and it's done.
  const [idResolution,       setIdResolution]       = useState(null);

  // Licence verification state
  const [licenceNumber,      setLicenceNumber]      = useState(user?.license_number || '');
  const [licenceFront,       setLicenceFront]       = useState(null);
  const [licenceBack,        setLicenceBack]        = useState(null);
  const [licenceSelfie,      setLicenceSelfie]      = useState(null);
  const [licStatus,          setLicStatus]          = useState('');
  const [licMsg,             setLicMsg]             = useState('');
  const [licRefundCredits,   setLicRefundCredits]   = useState(0);
  const [licResolution,      setLicResolution]      = useState(null);

  // Payment modal
  const [paymentModal,       setPaymentModal]       = useState(null); // 'sa_id' | 'passport' | 'licence'
  const [pendingVerify,      setPendingVerify]      = useState(null); // function to call after payment confirmed

  const [verificationPrices, setVerificationPrices] = useState(FALLBACK_PRICES);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('app_settings')
      .select('verification_price_sa_id, verification_price_passport, verification_price_licence')
      .eq('id', 1)
      .single()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setVerificationPrices({
          sa_id:    Number.isFinite(data.verification_price_sa_id)    ? data.verification_price_sa_id    : FALLBACK_PRICES.sa_id,
          passport: Number.isFinite(data.verification_price_passport) ? data.verification_price_passport : FALLBACK_PRICES.passport,
          licence:  Number.isFinite(data.verification_price_licence)  ? data.verification_price_licence  : FALLBACK_PRICES.licence,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Resolves a service key into the { label, amount } shape PaymentModal
  // and the price-display strings expect, using the live admin-set price.
  const priceFor = (serviceType) => ({
    label:  SERVICE_LABELS[serviceType],
    amount: verificationPrices[serviceType] ?? FALLBACK_PRICES[serviceType],
  });

  const isDriver = accountType === 'driver' || accountType === 'both';

  // Without this, idStatus/licStatus reset to blank on every mount — a
  // pending or rejected submission from an earlier session would otherwise
  // be invisible until the user happens to tap Verify again.
  React.useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data: idSubs } = await supabase
        .from('identity_verification_submissions')
        .select('verification_status, rejection_reason, created_at')
        .eq('user_id', user.id)
        .in('service_type', ['sa_id', 'passport'])
        .order('created_at', { ascending: false })
        .limit(1);
      const idSub = idSubs?.[0];
      if (idSub?.verification_status === 'pending') {
        setIdStatus('pending'); setIdMsg('Submitted — awaiting review. This usually takes a day or two.');
      } else if (idSub?.verification_status === 'rejected') {
        setIdStatus('rejected'); setIdMsg(idSub.rejection_reason || 'Please review your details and photos, then submit again.');
      }

      const { data: licSubs } = await supabase
        .from('identity_verification_submissions')
        .select('verification_status, rejection_reason, created_at')
        .eq('user_id', user.id)
        .eq('service_type', 'licence')
        .order('created_at', { ascending: false })
        .limit(1);
      const licSub = licSubs?.[0];
      if (licSub?.verification_status === 'pending') {
        setLicStatus('pending'); setLicMsg('Submitted — awaiting review. This usually takes a day or two.');
      } else if (licSub?.verification_status === 'rejected') {
        setLicStatus('rejected'); setLicMsg(licSub.rejection_reason || 'Please review your details and photos, then submit again.');
      }
    })();
  }, [user?.id]);

  // App.jsx's appUrlOpen listener dispatches this directly the instant it
  // parses the co.za.skootlink.app://payment-result deep link — the one
  // mechanism in this whole chain proven reliable (Google sign-in already
  // depends on it). A plain window event listener persists for this
  // component's whole lifetime, so it doesn't matter that this page never
  // unmounts while the Custom Tab is open.
  const handlePaymentResult = React.useCallback((result) => {
    if (!result || result.category !== 'verification') {
      return; // not ours — e.g. a credits purchase
    }

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
    try { handlePaymentResult(JSON.parse(raw)); } catch (e) { }
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
      } catch (e) { }
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
      } catch (e) { }
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
        const requiredAmount = verificationPrices[serviceType] ?? 0;
        if (data.amount == null || Number(data.amount) >= requiredAmount) return true;
      }
      if (attempt < retries - 1) await new Promise(r => setTimeout(r, delayMs));
    }
    return false;
  };

  const refundCredits = async (serviceType, setRefundCredits) => {
    const price = verificationPrices[serviceType] || 0;
    const credits = creditsForRefund(price);
    if (credits > 0 && user?.id) {
      const { error } = await supabase.rpc('add_credits', {
        p_user_id:     user.id,
        p_amount:      credits,
        p_type:        'refund',
        p_description: `Verification refund — ${SERVICE_LABELS[serviceType]}`,
        p_ref_id:      null,
      });
      if (error) {
        console.error('[VerificationPanel] add_credits failed:', error);
        return false;
      }
      setRefundCredits(credits);
      return true;
    }
    return false;
  };

  // Previously this always showed a "submitted" toast and swallowed the
  // insert's error entirely — meaning a failed insert (bad columns, RLS,
  // table missing, etc.) looked identical to success to the user, with no
  // way to ever know a request had actually gone nowhere. Now the toast
  // only fires on confirmed success, and the caller gets a real boolean.
  const handleRequestRefund = async (serviceType) => {
    const { error } = await supabase.from('refund_requests').insert({
      user_id:      user?.id,
      service_type: serviceType,
      amount:       verificationPrices[serviceType],
      reason:       'Verification failed',
      status:       'pending',
    });
    if (error) {
      console.error('[VerificationPanel] refund_requests insert failed:', error);
      toast.error('Could not submit your refund request. Please contact support directly.');
      return false;
    }
    toast.success('Refund request submitted. Our team will process it within 3–5 business days.');
    return true;
  };

  // ── Failure resolution (Try Again / Credits / Cash) ─────────────────────────
  const [idResolving,  setIdResolving]  = useState(false);
  const [licResolving, setLicResolving] = useState(false);

  const handleTryAgain = (setStatus, setMsg, setResolution) => {
    setStatus(''); setMsg(''); setResolution(null);
    // Deliberately does not touch verification_payments — it's still
    // `used: false`, so hasPaid() will pass again without charging twice.
  };

  const handleChooseCreditsRefund = async (serviceType, setRefundCreditsState, setResolution, setResolving) => {
    setResolving(true);
    const ok = await refundCredits(serviceType, setRefundCreditsState);
    if (ok) setResolution('credits');
    else toast.error('Could not process your credit refund. Please contact support directly.');
    setResolving(false);
  };

  const handleChooseCashRefund = async (serviceType, setResolution, setResolving) => {
    setResolving(true);
    const ok = await handleRequestRefund(serviceType);
    if (ok) setResolution('cash');
    setResolving(false);
  };

  // ── Verify RSA ID ────────────────────────────────────────────────────────────
  const doVerifySaId = async (justPaid = false) => {
    if (!saId.trim() || saId.replace(/\s/g, '').length !== 13) {
      toast.error('Please enter a valid 13-digit SA ID number'); return;
    }
    if (!saIdFront || !saIdBack) {
      toast.error('Please upload photos of the front and back of your ID'); return;
    }
    if (!saIdSelfie) {
      toast.error('Please take a selfie — it\'s required to confirm you are the ID holder'); return;
    }
    const paid = await hasPaid('sa_id', justPaid ? { retries: 5, delayMs: 1500 } : {});
    if (!paid) { setPaymentModal('sa_id'); setPendingVerify(() => doVerifySaId); return; }

    setIdStatus('verifying'); setIdMsg('');
    try {
      const [frontB64, backB64, selfieB64] = await Promise.all([
        compressImage(saIdFront), compressImage(saIdBack), compressImage(saIdSelfie),
      ]);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('https://skootlink.co.za/.netlify/functions/submit-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          serviceType:       'sa_id',
          idNumber:          saId.trim(),
          frontImageBase64:  frontB64,
          backImageBase64:   backB64,
          selfieImageBase64: selfieB64,
        }),
      });
      const data = await res.json();
      if (data.pending && !data.alreadyPending) {
        setIdStatus('pending'); setIdMsg(data.message || 'Submitted — awaiting review.');
        toast.success('Submitted! We\'ll review your ID shortly.');
      } else if (data.alreadyPending) {
        setIdStatus('pending'); setIdMsg(data.message);
      } else if (data.alreadyVerified) {
        setIdStatus('verified'); setIdMsg(data.message || 'Your identity is already verified.');
      } else {
        // Format/blacklist rejection — caught before payment was even consumed
        setIdStatus('failed'); setIdMsg(data.message || 'Submission failed. Please check your details and try again.');
      }
    } catch (err) {
      // Our side failed before the submission was ever saved — let the user
      // choose how to be made whole (Try Again / Credits / Cash) via the
      // StatusBadge buttons below, rather than deciding for them.
      setIdStatus('failed'); setIdMsg('Something went wrong submitting your documents.');
      setIdResolution(null);
    }
  };

  // ── Verify Passport ──────────────────────────────────────────────────────────
  const doVerifyPassport = async (justPaid = false) => {
    if (!passportNumber.trim()) { toast.error('Please enter your passport number'); return; }
    if (!passportFront || !passportBack) { toast.error('Please upload both passport photos'); return; }
    if (!passportSelfie) { toast.error('Please take a selfie — it\'s required to confirm you are the passport holder'); return; }

    const paid = await hasPaid('passport', justPaid ? { retries: 5, delayMs: 1500 } : {});
    if (!paid) { setPaymentModal('passport'); setPendingVerify(() => doVerifyPassport); return; }

    setIdStatus('verifying'); setIdMsg('');
    try {
      const [frontB64, backB64, selfieB64] = await Promise.all([
        compressImage(passportFront), compressImage(passportBack), compressImage(passportSelfie),
      ]);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('https://skootlink.co.za/.netlify/functions/submit-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          serviceType:       'passport',
          idNumber:          passportNumber.trim(),
          frontImageBase64:  frontB64,
          backImageBase64:   backB64,
          selfieImageBase64: selfieB64,
        }),
      });
      const data = await res.json();
      if (data.pending && !data.alreadyPending) {
        setIdStatus('pending'); setIdMsg(data.message || 'Submitted — awaiting review.');
        toast.success('Submitted! We\'ll review your passport shortly.');
      } else if (data.alreadyPending) {
        setIdStatus('pending'); setIdMsg(data.message);
      } else if (data.alreadyVerified) {
        setIdStatus('verified'); setIdMsg(data.message || 'Your identity is already verified.');
      } else {
        setIdStatus('failed'); setIdMsg(data.message || 'Submission failed. Please check your details and try again.');
      }
    } catch (err) {
      setIdStatus('failed'); setIdMsg('Something went wrong submitting your documents.');
      setIdResolution(null);
    }
  };

  // ── Verify Driver's Licence ──────────────────────────────────────────────────
  const doVerifyLicence = async (justPaid = false) => {
    if (!licenceNumber.trim()) { toast.error('Please enter your driver\'s licence number'); return; }
    if (!licenceFront || !licenceBack) { toast.error('Please upload both front and back of your licence'); return; }
    if (!licenceSelfie) { toast.error('Please take a selfie — it\'s required to confirm you are the licence holder'); return; }

    const paid = await hasPaid('licence', justPaid ? { retries: 5, delayMs: 1500 } : {});
    if (!paid) { setPaymentModal('licence'); setPendingVerify(() => doVerifyLicence); return; }

    setLicStatus('verifying'); setLicMsg('');
    try {
      const [frontB64, backB64, selfieB64] = await Promise.all([
        compressImage(licenceFront), compressImage(licenceBack), compressImage(licenceSelfie),
      ]);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('https://skootlink.co.za/.netlify/functions/submit-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          serviceType:       'licence',
          idNumber:          licenceNumber.trim(),
          frontImageBase64:  frontB64,
          backImageBase64:   backB64,
          selfieImageBase64: selfieB64,
        }),
      });
      const data = await res.json();
      if (data.pending && !data.alreadyPending) {
        setLicStatus('pending'); setLicMsg(data.message || 'Submitted — awaiting review.');
        toast.success('Submitted! We\'ll review your licence shortly.');
      } else if (data.alreadyPending) {
        setLicStatus('pending'); setLicMsg(data.message);
      } else if (data.alreadyVerified) {
        setLicStatus('verified'); setLicMsg(data.message || 'Your licence is already verified.');
      } else {
        setLicStatus('failed'); setLicMsg(data.message || 'Submission failed. Please check your details and try again.');
      }
    } catch (err) {
      setLicStatus('failed'); setLicMsg('Something went wrong submitting your documents.');
      setLicResolution(null);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Payment modal */}
      {paymentModal && (
        <PaymentModal
          service={paymentModal}
          price={priceFor(paymentModal)}
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
            <ImageUpload
              label="ID Front"
              hint="Clear photo of the front of your green ID book page or smart ID card"
              file={saIdFront}
              onChange={setSaIdFront}
            />
            <ImageUpload
              label="ID Back"
              hint="Clear photo of the back — smart ID cards especially, this side often has key details too"
              file={saIdBack}
              onChange={setSaIdBack}
            />
            <SelfieCapture file={saIdSelfie} onChange={setSaIdSelfie} />
            <StatusBadge
              status={idStatus}
              message={idMsg}
              credits={idRefundCredits}
              resolution={idResolution}
              resolving={idResolving}
              onTryAgain={() => handleTryAgain(setIdStatus, setIdMsg, setIdResolution)}
              onRefundCredits={() => handleChooseCreditsRefund('sa_id', setIdRefundCredits, setIdResolution, setIdResolving)}
              onRequestCashRefund={() => handleChooseCashRefund('sa_id', setIdResolution, setIdResolving)}
            />
            <Button
              className="w-full gap-2"
              disabled={idStatus === 'verifying' || idStatus === 'verified' || idStatus === 'pending'}
              onClick={doVerifySaId}
            >
              {idStatus === 'verifying' ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> :
               idStatus === 'pending'   ? <><Clock className="w-4 h-4" /> Awaiting Review</> :
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
              hint="Clear photo of the main data page (photo page)"
              file={passportFront}
              onChange={setPassportFront}
            />
            <ImageUpload
              label="Passport Photo — Back cover or barcode page"
              hint="Clear photo of the back cover or machine-readable zone"
              file={passportBack}
              onChange={setPassportBack}
            />
            <SelfieCapture file={passportSelfie} onChange={setPassportSelfie} />
            <StatusBadge
              status={idStatus}
              message={idMsg}
              credits={idRefundCredits}
              resolution={idResolution}
              resolving={idResolving}
              onTryAgain={() => handleTryAgain(setIdStatus, setIdMsg, setIdResolution)}
              onRefundCredits={() => handleChooseCreditsRefund('passport', setIdRefundCredits, setIdResolution, setIdResolving)}
              onRequestCashRefund={() => handleChooseCashRefund('passport', setIdResolution, setIdResolving)}
            />
            <Button
              className="w-full gap-2"
              disabled={idStatus === 'verifying' || idStatus === 'verified' || idStatus === 'pending'}
              onClick={doVerifyPassport}
            >
              {idStatus === 'verifying' ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> :
               idStatus === 'pending'   ? <><Clock className="w-4 h-4" /> Awaiting Review</> :
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
            <SelfieCapture file={licenceSelfie} onChange={setLicenceSelfie} />
            <StatusBadge
              status={licStatus}
              message={licMsg}
              credits={licRefundCredits}
              resolution={licResolution}
              resolving={licResolving}
              onTryAgain={() => handleTryAgain(setLicStatus, setLicMsg, setLicResolution)}
              onRefundCredits={() => handleChooseCreditsRefund('licence', setLicRefundCredits, setLicResolution, setLicResolving)}
              onRequestCashRefund={() => handleChooseCashRefund('licence', setLicResolution, setLicResolving)}
            />
            <Button
              className="w-full gap-2"
              disabled={licStatus === 'verifying' || licStatus === 'verified' || licStatus === 'pending'}
              onClick={doVerifyLicence}
            >
              {licStatus === 'verifying' ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> :
               licStatus === 'pending'   ? <><Clock className="w-4 h-4" /> Awaiting Review</> :
               licStatus === 'verified'  ? <><CheckCircle2 className="w-4 h-4" /> Verified</> :
               licStatus === 'failed'    ? <><RefreshCw className="w-4 h-4" /> Retry</> :
               <><ShieldCheck className="w-4 h-4" /> Verify Licence</>}
            </Button>
          </div>
        </Card>
      )}

      <p className="text-[10px] text-muted-foreground text-center px-4">
        Verification documents are reviewed manually by our team and are never shared with
        third parties. Photos are deleted once your review is complete.
        Payments are processed securely and are non-refundable except in the case of technical failure.
      </p>
    </div>
  );
}
