import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { auth, supabase } from '@/api/supabaseData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import PageHeader from '@/components/layout/PageHeader';
import { toast } from 'sonner';
import { Loader2, Send, CheckCircle2 } from 'lucide-react';

const CATEGORIES = [
  { value: 'bug',     label: 'Bug Report'       },
  { value: 'payment', label: 'Payment Issue'     },
  { value: 'rental',  label: 'Rental Problem'    },
  { value: 'account', label: 'Account Support'   },
  { value: 'other',   label: 'Other'             },
];

export default function ContactUs() {
  const location = useLocation();
  const backTo = location.state?.backTo ?? '/settings';
  const [user,    setUser]    = useState(null);
  const [sending, setSending] = useState(false);
  const [sent,    setSent]    = useState(false);

  const [form, setForm] = useState({
    name:     '',
    email:    '',
    subject:  '',
    category: '',
    message:  '',
  });

  useEffect(() => {
    auth.me().then(u => {
      if (!u) return;
      setUser(u);
      setForm(f => ({
        ...f,
        name:  u.full_name || '',
        email: u.email     || '',
      }));
    }).catch(() => {});
  }, []);

  const update = (field, val) => setForm(p => ({ ...p, [field]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.subject.trim())  { toast.error('Please enter a subject');       return; }
    if (!form.category)        { toast.error('Please select a category');     return; }
    if (!form.message.trim())  { toast.error('Please enter your message');    return; }
    if (!form.email.trim())    { toast.error('Please enter your email');      return; }

    setSending(true);
    try {
      const { error } = await supabase.functions.invoke('send-contact-email', {
        body: {
          from_name:  form.name    || 'Skootlink User',
          from_email: form.email,
          subject:    form.subject,
          category:   form.category,
          message:    form.message,
          user_id:    user?.id ?? null,
        },
      });

      if (error) throw new Error(error.message);

      setSent(true);
    } catch (err) {
      toast.error('Failed to send: ' + (err.message || 'Please try again'));
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="p-4 lg:p-8 max-w-xl mx-auto">
        <PageHeader title="Contact Support" backTo={backTo} />
        <Card className="p-8 border border-border/50 text-center space-y-4">
          <div className="flex justify-center">
            <CheckCircle2 className="w-14 h-14 text-emerald-500" />
          </div>
          <h2 className="text-xl font-semibold">Message sent!</h2>
          <p className="text-muted-foreground text-sm">
            Our support team will get back to you within 24 hours at{' '}
            <span className="font-medium text-foreground">{form.email}</span>.
          </p>
          <Button
            variant="outline"
            className="mt-2"
            onClick={() => {
              setSent(false);
              setForm(f => ({ ...f, subject: '', category: '', message: '' }));
            }}
          >
            Send another message
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-xl mx-auto">
      <PageHeader
        title="Contact Support"
        subtitle="We typically respond within 24 hours"
        backTo={backTo}
      />

      <Card className="p-6 border border-border/50">
        <form onSubmit={handleSubmit} className="space-y-5">

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Your Name</Label>
              <Input
                className="mt-1"
                value={form.name}
                onChange={e => update('name', e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div>
              <Label>Your Email <span className="text-red-500">*</span></Label>
              <Input
                className="mt-1"
                type="email"
                value={form.email}
                onChange={e => update('email', e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
          </div>

          <div>
            <Label>Category <span className="text-red-500">*</span></Label>
            <Select value={form.category} onValueChange={v => update('category', v)}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="What is this about?" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Subject <span className="text-red-500">*</span></Label>
            <Input
              className="mt-1"
              value={form.subject}
              onChange={e => update('subject', e.target.value)}
              placeholder="Brief description of your issue"
            />
          </div>

          <div>
            <Label>Message <span className="text-red-500">*</span></Label>
            <Textarea
              className="mt-1 min-h-[140px] resize-none"
              value={form.message}
              onChange={e => update('message', e.target.value)}
              placeholder="Describe your issue in detail — the more info you provide, the faster we can help."
            />
          </div>

          <Button type="submit" className="w-full gap-2" disabled={sending}>
            {sending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Send className="w-4 h-4" />}
            {sending ? 'Sending…' : 'Send Message'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
