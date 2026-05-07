import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '@/api/supabaseData';                // ✅ only auth from here
import { supabase } from '@/api/supabaseclient';           // ✅ supabase from its real home
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Crown, Bike, Users, Shield, Loader2, ArrowRight, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

const PLANS = [
  // … (unchanged) …
];

export default function Subscription() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [selected, setSelected] = useState('owner');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    auth.me().then(u => {
      setUser(u);
      if (u.account_type) setSelected(u.account_type === 'both' ? 'both' : u.account_type);
    }).catch(() => {});
  }, []);

  const handleSubscribe = async () => {
    setProcessing(true);
    try {
      // 1. Update your custom profile data
      await auth.updateMe({
        subscription_active: true,
        subscription_plan: selected,
        subscription_start: new Date().toISOString(),
        subscription_expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      // 2. Update the Supabase Auth metadata so the dashboard sees the change immediately
      const { error } = await supabase.auth.updateUser({
        data: { subscription_plan: selected }
      });

      if (error) {
        console.error('Failed to sync auth metadata', error);
        toast.warning('Plan updated, but you may need to re-login to see changes.');
      }

      toast.success('Subscription activated! Welcome to Scootlink.');
      navigate('/');
    } catch {
      toast.error('Something went wrong. Please try again.');
    }
    setProcessing(false);
  };

  const plan = PLANS.find(p => p.id === selected);

  return (
    // … (unchanged JSX) …
  );
}
