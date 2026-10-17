// src/components/gigs/GigChat.jsx
//
// Free chat between a gig's customer and driver, shown on the trip screens
// (GigStatus and DriverActiveGig). Migration 014:
//   send_gig_message / get_gig_messages / mark_gig_messages_read.
// Open while the gig is accepted or in progress; afterwards read-only.
// Gig messages never appear in the Messages tab (they're filtered out there).
//
// Live updates: Realtime INSERTs on messages addressed to me, plus a 6s poll
// while the panel is open (same safety net as the trip screens).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/api/supabaseData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MessageCircle, Send, Loader2, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function GigChat({ gigId, meId, otherLabel, canSend }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState(0);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const openRef = useRef(open);
  openRef.current = open;

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_gig_messages', { p_gig_id: gigId });
    if (error) {
      console.error('[GigChat] get_gig_messages failed:', error);
      return;
    }
    const list = data || [];
    setMessages(list);
    if (openRef.current) {
      if (list.some((m) => m.receiver_id === meId && !m.read)) {
        const { error: readErr } = await supabase.rpc('mark_gig_messages_read', { p_gig_id: gigId });
        if (readErr) console.error('[GigChat] mark_gig_messages_read failed:', readErr);
      }
      setUnread(0);
    } else {
      setUnread(list.filter((m) => m.receiver_id === meId && !m.read).length);
    }
  }, [gigId, meId]);

  // Initial load (for the unread count) and live updates
  useEffect(() => {
    if (!gigId || !meId) return undefined;
    load();
    const ch = supabase
      .channel(`gig-chat-${gigId}-${meId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${meId}` },
        (payload) => {
          const m = payload.new;
          if (m.context_type === 'gig' && String(m.context_id) === String(gigId)) load();
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [gigId, meId, load]);

  // While open: mark read now, and poll as a fallback
  useEffect(() => {
    if (!open) return undefined;
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [open, load]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [open, messages.length]);

  const send = async (e) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const { data, error } = await supabase.rpc('send_gig_message', { p_gig_id: gigId, p_body: body });
      if (error) {
        console.error('[GigChat] send_gig_message failed:', error);
        toast.error(error.message || 'Message not sent');
        return;
      }
      setText('');
      if (data) setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
    } catch (err) {
      console.error('[GigChat] send error:', err);
      toast.error('Message not sent. Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <Button variant="outline" className="w-full gap-2" onClick={() => setOpen(true)}>
        <MessageCircle className="w-4 h-4" />
        {canSend ? `Message ${otherLabel}` : `View messages with ${otherLabel}`}
        {unread > 0 && (
          <span className="ml-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
            {unread}
          </span>
        )}
      </Button>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 overflow-hidden">
      <button
        onClick={() => setOpen(false)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted text-sm font-medium"
      >
        <span className="flex items-center gap-2"><MessageCircle className="w-4 h-4" /> Chat with {otherLabel}</span>
        <ChevronDown className="w-4 h-4" />
      </button>

      <div className="max-h-64 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <p className="text-xs text-center text-muted-foreground py-4">No messages yet.</p>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === meId;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`text-[10px] mt-0.5 ${mine ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{fmtTime(m.created_at)}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {canSend ? (
        <form onSubmit={send} className="flex gap-2 p-2 border-t border-border/50">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message"
            maxLength={1000}
          />
          <Button type="submit" size="icon" disabled={sending || !text.trim()} aria-label="Send">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </form>
      ) : (
        <p className="text-xs text-center text-muted-foreground p-2 border-t border-border/50">This chat has ended.</p>
      )}
    </div>
  );
}
