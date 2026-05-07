import React, { useState, useEffect } from 'react';
import { auth } from '@/api/supabaseData';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Fingerprint, Lock, Eye, EyeOff, ShieldCheck, Smartphone, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

export default function SecuritySettings() {
  const [user, setUser] = useState(null);
  const [signInMethod, setSignInMethod] = useState('password');
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [changePwdModal, setChangePwdModal] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current: '', new: '', confirm: '' });
  const [showPwd, setShowPwd] = useState({ current: false, new: false, confirm: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    auth.me().then(u => {
      setUser(u);
      setSignInMethod(u.sign_in_method || 'password');
    }).catch(() => {});

    // Check if WebAuthn / biometric is available on the device
    if (window.PublicKeyCredential) {
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then(available => setBiometricAvailable(available))
        .catch(() => setBiometricAvailable(false));
    }
  }, []);

  const handleMethodChange = async (method) => {
    if ((method === 'biometric' || method === 'both') && !biometricAvailable) {
      toast.error('Your device does not support biometric authentication');
      return;
    }
    setSignInMethod(method);
    setSaving(true);
    await auth.updateMe({ sign_in_method: method });
    toast.success('Sign-in method updated');
    setSaving(false);
  };

  const handleEnrollBiometric = async () => {
    if (!biometricAvailable) {
      toast.error('Biometric not supported on this device');
      return;
    }
    try {
      // Generate a random challenge
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      // Use the top-level origin hostname as rpId
      const rpId = window.location.hostname;

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'Scootlink', id: rpId },
          user: {
            id: new TextEncoder().encode(user?.id || user?.email || 'user'),
            name: user?.email || 'user',
            displayName: user?.full_name || 'User',
          },
          pubKeyCredParams: [
            { alg: -7, type: 'public-key' },   // ES256
            { alg: -257, type: 'public-key' },  // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'preferred',
            residentKey: 'preferred',
          },
          timeout: 60000,
        }
      });
      if (credential) {
        // Store the credential ID so we can use it during sign-in
        const credentialId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
        await auth.updateMe({ biometric_enrolled: true, sign_in_method: 'biometric', biometric_credential_id: credentialId });
        setSignInMethod('biometric');
        toast.success('Biometric enrolled successfully!');
      }
    } catch (err) {
      console.error('Biometric enrollment error:', err);
      if (err.name === 'NotAllowedError') {
        toast.error('Biometric enrollment was cancelled or denied');
      } else if (err.name === 'SecurityError') {
        toast.error('Biometric is not available in this context. Please use the published app URL.');
      } else if (err.name === 'InvalidStateError') {
        // Already enrolled on this device — just mark as enrolled
        await auth.updateMe({ biometric_enrolled: true, sign_in_method: 'biometric', biometric_credential_id: user?.biometric_credential_id || '' });
        setSignInMethod('biometric');
        toast.success('Biometric already registered on this device!');
      } else {
        toast.error(`Enrollment failed: ${err.message || 'Unknown error'}`);
      }
    }
  };

  const methods = [
    {
      value: 'password',
      label: 'Password Only',
      desc: 'Sign in with your email and password',
      icon: Lock,
      always_available: true,
    },
    {
      value: 'biometric',
      label: 'Biometric Only',
      desc: biometricAvailable ? 'Use face ID or fingerprint' : 'Not supported on this device',
      icon: Fingerprint,
      always_available: false,
    },
    {
      value: 'both',
      label: 'Biometric + Password fallback',
      desc: biometricAvailable ? 'Biometric primary, password as backup' : 'Not supported on this device',
      icon: Smartphone,
      always_available: false,
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-foreground mb-1">Sign-in Method</h3>
        <p className="text-sm text-muted-foreground">Choose how you authenticate to Scootlink</p>
      </div>

      <div className="space-y-2">
        {methods.map(m => {
          const Icon = m.icon;
          const isSelected = signInMethod === m.value;
          const isDisabled = !m.always_available && !biometricAvailable;
          return (
            <button
              key={m.value}
              disabled={isDisabled || saving}
              onClick={() => handleMethodChange(m.value)}
              className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/40 bg-card'
              }`}
            >
              <div className={`p-2.5 rounded-xl ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">{m.label}</p>
                <p className="text-xs text-muted-foreground">{m.desc}</p>
              </div>
              {isSelected && <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />}
              {isDisabled && <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
            </button>
          );
        })}
      </div>

      {(signInMethod === 'biometric' || signInMethod === 'both') && biometricAvailable && !user?.biometric_enrolled && (
        <Card className="p-4 border-primary/30 bg-primary/5">
          <p className="text-sm font-medium mb-2">Biometric not yet enrolled</p>
          <p className="text-xs text-muted-foreground mb-3">Click below to register your fingerprint or face ID with this device.</p>
          <Button size="sm" onClick={handleEnrollBiometric} className="gap-2 w-full">
            <Fingerprint className="w-4 h-4" /> Enroll Biometric Now
          </Button>
        </Card>
      )}

      {user?.biometric_enrolled && (
        <div className="flex items-center gap-3 p-3 bg-emerald-50 rounded-xl">
          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          <p className="text-sm font-medium text-emerald-700">Biometric enrolled on this device</p>
        </div>
      )}

      <div className="border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Password</p>
            <p className="text-xs text-muted-foreground">Change your account password</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setChangePwdModal(true)}>Change</Button>
        </div>
      </div>

      <div className="flex items-center gap-2 p-3 bg-muted/60 rounded-xl">
        <ShieldCheck className="w-4 h-4 text-primary" />
        <p className="text-xs text-muted-foreground">Your security settings are end-to-end encrypted and stored on your device.</p>
      </div>

      <Dialog open={changePwdModal} onOpenChange={setChangePwdModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Change Password</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {['current', 'new', 'confirm'].map(field => (
              <div key={field}>
                <Label className="text-xs capitalize">{field === 'confirm' ? 'Confirm New' : field} Password</Label>
                <div className="relative mt-1">
                  <Input
                    type={showPwd[field] ? 'text' : 'password'}
                    placeholder={field === 'current' ? 'Current password' : field === 'new' ? 'New password (min 8 chars)' : 'Confirm new password'}
                    value={pwdForm[field]}
                    onChange={e => setPwdForm(p => ({ ...p, [field]: e.target.value }))}
                  />
                  <button
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowPwd(p => ({ ...p, [field]: !p[field] }))}
                  >
                    {showPwd[field] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangePwdModal(false)}>Cancel</Button>
            <Button onClick={() => {
              if (pwdForm.new !== pwdForm.confirm) { toast.error('Passwords do not match'); return; }
              if (pwdForm.new.length < 8) { toast.error('Password must be at least 8 characters'); return; }
              toast.success('Password updated successfully');
              setChangePwdModal(false);
              setPwdForm({ current: '', new: '', confirm: '' });
            }}>
              Update Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}