import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { auth } from '@/api/supabaseData';
import { User, Bell, Globe, Shield, FileText, Phone, LogOut, ChevronRight, ShieldCheck, Lock, Crown, RefreshCw } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import SecuritySettings from '@/components/security/SecuritySettings';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const generalItems = [
  { label: 'Account Profile', description: 'Edit your personal details', icon: User, path: '/profile' },
  { label: 'KYC & Verification', description: 'Identity verification status', icon: ShieldCheck, path: '/onboarding' },
  { label: 'Notifications', description: 'Manage push and email alerts', icon: Bell, action: 'toggle' },
  { label: 'Language', description: 'English', icon: Globe, action: 'language' },
  { label: 'Privacy Policy', description: 'How we handle your data', icon: Shield, action: 'privacy' },
  { label: 'Terms of Service', description: 'Our usage terms', icon: FileText, action: 'terms' },
  { label: 'Support', description: 'support@scootlink.co.za', icon: Phone },
];

export default function Settings() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  useEffect(() => {
    auth.me().then(setUser).catch(() => {});
  }, []);

  const handleAction = (action) => {
    switch (action) {
      case 'language': toast.info('Language settings coming soon'); break;
      case 'privacy': toast.info('Privacy policy available on our website'); break;
      case 'terms': toast.info('Terms of service available on our website'); break;
      default: break;
    }
  };

  const subscriptionExpires = user?.subscription_expires
    ? new Date(user.subscription_expires).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <PageHeader title="Settings" subtitle="Manage your account" backTo="/" />

      {user && (
        <Card className="p-5 mb-6 border border-border/50">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-xl font-bold text-primary overflow-hidden">
              {user.selfie_url ? (
                <img src={user.selfie_url} alt="" className="w-full h-full object-cover" />
              ) : (
                user.full_name?.[0] || 'U'
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-foreground">{user.full_name || 'User'}</h3>
                {user.verified && <ShieldCheck className="w-4 h-4 text-primary" />}
              </div>
              <p className="text-sm text-muted-foreground truncate">{user.email}</p>
              <div className="flex gap-2 mt-1.5 flex-wrap">
                <Badge variant="outline" className="text-[10px] capitalize">{user.account_type || 'User'}</Badge>
                {user.subscription_active ? (
                  <Badge className="text-[10px] bg-emerald-500 text-white gap-1">
                    <Crown className="w-2.5 h-2.5" /> Active · {user.subscription_plan}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">No Subscription</Badge>
                )}
                {user.kyc_completed && <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300">KYC Done</Badge>}
              </div>
            </div>
          </div>
          {user.subscription_active && subscriptionExpires && (
            <p className="text-xs text-muted-foreground mt-3 pl-1">Subscription renews: {subscriptionExpires}</p>
          )}
          {!user.subscription_active && (
            <Link to="/subscription">
              <Button size="sm" className="mt-3 w-full gap-2">
                <Crown className="w-3.5 h-3.5" /> Subscribe to Unlock All Features
              </Button>
            </Link>
          )}
        </Card>
      )}

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-4">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="subscription" className="gap-1">
            <Crown className="w-3.5 h-3.5" /> Plan
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-1">
            <Lock className="w-3.5 h-3.5" /> Security
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <div className="space-y-1">
            {generalItems.map((item) => {
              const content = (
                <div className="flex items-center justify-between p-4 rounded-xl hover:bg-accent transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <item.icon className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-foreground">{item.label}</h4>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              );
              if (item.path) return <Link key={item.label} to={item.path}>{content}</Link>;
              return (
                <div key={item.label} onClick={() => item.action && handleAction(item.action)}>
                  {content}
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="subscription">
          <Card className="p-5 border border-border/50 space-y-4">
            <h3 className="font-semibold text-foreground">Subscription & Plan</h3>
            {user?.subscription_active ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium capitalize">{user.subscription_plan} Plan</p>
                    <p className="text-xs text-muted-foreground">
                      {subscriptionExpires ? `Renews: ${subscriptionExpires}` : 'Active subscription'}
                    </p>
                  </div>
                  <Badge className="bg-emerald-500 text-white text-[10px]">Active</Badge>
                </div>
                <div className="border-t pt-4">
                  <p className="text-xs text-muted-foreground mb-3">Want to change your plan?</p>
                  <Link to="/subscription">
                    <Button variant="outline" size="sm" className="gap-2 w-full">
                      <RefreshCw className="w-3.5 h-3.5" /> Change Plan
                    </Button>
                  </Link>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-xl border border-amber-200">
                  <Crown className="w-5 h-5 text-amber-500 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">No active subscription</p>
                    <p className="text-xs text-amber-600">Subscribe to unlock full platform access</p>
                  </div>
                </div>
                <Link to="/subscription">
                  <Button className="w-full gap-2">
                    <Crown className="w-4 h-4" /> View Plans & Subscribe
                  </Button>
                </Link>
                <div className="space-y-2 pt-1">
                  <p className="text-xs font-medium text-muted-foreground">Available plans:</p>
                  {[
                    { name: 'Driver', price: 'R 49/mo', desc: 'Search & rent vehicles' },
                    { name: 'Owner', price: 'R 59/mo', desc: 'List vehicles & find drivers' },
                    { name: 'Fleet Pro', price: 'R 79/mo', desc: 'Full access — owner + driver' },
                  ].map(p => (
                    <div key={p.name} className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-muted">
                      <span className="font-medium">{p.name} <span className="text-muted-foreground font-normal">— {p.desc}</span></span>
                      <span className="font-semibold text-foreground">{p.price}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <Card className="p-5 border border-border/50">
            <SecuritySettings />
          </Card>
        </TabsContent>
      </Tabs>

      <Button
        variant="destructive"
        className="w-full mt-8"
        onClick={() => auth.logout()}
      >
        <LogOut className="w-4 h-4 mr-2" />
        Logout
      </Button>
    </div>
  );
}