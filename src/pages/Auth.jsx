import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient'; // or @/api/supabaseData if exported there
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Bike, LogIn, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function Auth() {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register fields
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const handleLogin = async () => {
    if (!loginEmail || !loginPassword) {
      toast.error('Please fill in all fields');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });
      if (error) throw error;
      navigate('/');
    } catch (err) {
      toast.error(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!regName || !regEmail || !regPassword) {
      toast.error('Please fill in all required fields');
      return;
    }
    if (regPassword !== regConfirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (!agreedToTerms) {
      toast.error('You must agree to the Terms and Conditions');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: regEmail,
        password: regPassword,
        options: {
          data: {
            full_name: regName,
            account_type: 'driver', // default role; user can upgrade via subscription
          },
        },
      });
      if (error) throw error;
      toast.success('Account created! Please check your email to confirm your address.');
      setIsLogin(true);
    } catch (err) {
      toast.error(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const email = prompt('Enter your email address to reset your password:');
    if (!email) return;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/auth',
      });
      if (error) throw error;
      toast.success('Password reset email sent! Check your inbox.');
    } catch (err) {
      toast.error(err.message || 'Failed to send reset email');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Bike className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Scootlink</h1>
          <p className="text-sm text-muted-foreground mt-1">
            The formal way to connect owners and drivers in the delivery space.
          </p>
        </div>

        <Card className="p-6 border border-border/50">
          {isLogin ? (
            /* ─── Login Form ─── */
            <>
              <h2 className="text-lg font-semibold text-foreground mb-4">Login</h2>
              <div className="space-y-4">
                <div>
                  <Label>Email</Label>
                  <Input
                    type="email"
                    placeholder="your@email.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Password</Label>
                  <Input
                    type="password"
                    placeholder="Enter your password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                  />
                </div>
                <div className="text-left">
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-sm text-primary hover:underline"
                  >
                    Forgot your password?
                  </button>
                </div>
                <Button
                  onClick={handleLogin}
                  className="w-full gap-2"
                  disabled={loading}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                  Sign In
                </Button>
                <p className="text-center text-sm text-muted-foreground">
                  Don't have an account?{' '}
                  <button
                    onClick={() => setIsLogin(false)}
                    className="text-primary hover:underline"
                  >
                    Create one
                  </button>
                </p>
              </div>
            </>
          ) : (
            /* ─── Register Form ─── */
            <>
              <h2 className="text-lg font-semibold text-foreground mb-4">Create Account</h2>
              <div className="space-y-4">
                <div>
                  <Label>Full Name</Label>
                  <Input
                    placeholder="Your full name"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input
                    type="email"
                    placeholder="your@email.com"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Password</Label>
                  <Input
                    type="password"
                    placeholder="Create a password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Confirm Password</Label>
                  <Input
                    type="password"
                    placeholder="Confirm your password"
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
                  />
                </div>

                {/* Terms and Conditions Checkbox */}
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="terms"
                    checked={agreedToTerms}
                    onCheckedChange={(checked) => setAgreedToTerms(checked === true)}
                    className="mt-0.5"
                  />
                  <label htmlFor="terms" className="text-sm text-muted-foreground">
                    I agree to the{' '}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        alert('Terms and Conditions will be available soon.');
                      }}
                      className="text-primary hover:underline"
                    >
                      Terms and Conditions
                    </a>
                  </label>
                </div>

                <Button
                  onClick={handleRegister}
                  className="w-full gap-2"
                  disabled={loading}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  Sign Up
                </Button>
                <p className="text-center text-sm text-muted-foreground">
                  Already have an account?{' '}
                  <button
                    onClick={() => setIsLogin(true)}
                    className="text-primary hover:underline"
                  >
                    Sign in
                  </button>
                </p>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
