// src/components/chat/ContextChat.jsx
//
// One chat, tied to one rental or one gig. There is no inbox: a chat opens
// from the thing it is about (a rental card, a profile panel, a trip screen).
//
//   contextType 'gig'    -> send_gig_message / get_gig_messages /
//                           mark_gig_messages_read (migration 014)
//   contextType 'rental' -> send_rental_message / get_rental_messages /
//                           mark_rental_messages_read (migration 017)
//
// Both are free. The server checks that the caller is a party to that rental
// or gig and respects blocks.
//
// Live updates: Realtime INSERTs on messages addressed to me, plus a 6s poll
// while the chat is open. After marking messages read it fires
// 'skootlink:chat-read' so unread badges elsewhere refresh straight away.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/api/supabaseData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MessageCircle, Send, Loader2, ChevronDown, MoreVertical, UserX, Flag } from 'lucide-react';
import { toast } from 'sonner';
import ReportUserModal, { blockUser } from '@/components/chat/ReportUserModal';

const fmtTime = (iso) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const CHAT_READ_EVENT = 'skootlink:chat-read';

export default function ContextChat({
  contextType,          // 'gig' | 'rental'
  contextId,
  meId,
  otherId,              // optional: enables Block / Report
  otherLabel,
  canSend = true,
  collapsible = true,   // false = always open, no collapse header button
  maxLength = 1000,
  onClose,              // optional: shown as the header's close action when not collapsible
  bodyClassName = 'max-h-64',
}) {
  const [open, setOpen] = useState(!collapsible);
  const [messages, setMessages] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [unread, setUnread] = useState(0);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const bottomRef = useRef(null);
  const openRef = useRef(open);
  openRef.current = open;

  const rpc = (action) => `${action}_${contextType}_message${action === 'send' ? '' : 's'}`;
  const idParam = `p_${contextType}_id`;
  const tag = `[ContextChat:${contextType}]`;

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc(`get_${contextType}_messages`, { [`p_${contextType}_id`]: contextId });
    if (error) {
      console.error(`[ContextChat:${contextType}] get messages failed:`, error);
      return;
    }
    const list = data || [];
    setMessages(list);
    setLoaded(true);
    const hasUnread = list.some((m) => m.receiver_id === meId && !m.read);
    if (openRef.current) {
      if (hasUnread) {
        const { error: readErr } = await supabase.rpc(`mark_${contextType}_messages_read`, { [`p_${contextType}_id`]: contextId });
        if (readErr) console.error(`[ContextChat:${contextType}] mark read failed:`, readErr);
        else window.dispatchEvent(new CustomEvent(CHAT_READ_EVENT, { detail: { contextType, contextId } }));
      }
      setUnread(0);
    } else {
      setUnread(list.filter((m) => m.receiver_id === meId && !m.read).length);
    }
  }, [contextType, contextId, meId]);

  // Initial load (for the unread count) and live updates
  useEffect(() => {
    if (!contextId || !meId) return undefined;
    load();
    const ch = supabase
      .channel(`chat-${contextType}-${contextId}-${meId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${meId}` },
        (payload) => {
          const m = payload.new;
          if (m.context_type === contextType && String(m.context_id) === String(contextId)) load();
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [contextType, contextId, meId, load]);

  // While open: mark read now, and poll as a fallback
  useEffect(() => {
    if (!open) return undefined;
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [open, load]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [open, messages.length]);

  const send = async (e) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const { data, error } = await supabase.rpc(rpc('send'), { [idParam]: contextId, p_body: body });
      if (error) {
        console.error(`${tag} send failed:`, error);
        toast.error(error.message || 'Message not sent');
        return;
      }
      setText('');
      if (data) setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
    } catch (err) {
      console.error(`${tag} send error:`, err);
      toast.error('Message not sent. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleBlock = async () => {
    setMenuOpen(false);
    if (!window.confirm(`Block ${otherLabel}? They won't be able to message you.`)) return;
    try {
      await blockUser(meId, otherId);
      toast.success(`${otherLabel} has been blocked. You can unblock them in Settings.`);
    } catch (err) {
      console.error(`${tag} block failed:`, err);
      toast.error('Could not block this user. Please try again.');
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
    <div className={`rounded-xl border border-border/50 overflow-hidden bg-background flex flex-col min-h-0 ${collapsible ? '' : 'flex-1'}`}>
      <div className="relative flex items-center justify-between px-3 py-2 bg-muted text-sm font-medium shrink-0">
        <button
          onClick={() => (collapsible ? setOpen(false) : onClose?.())}
          className="flex items-center gap-2 flex-1 text-left"
        >
          <MessageCircle className="w-4 h-4" /> Chat with {otherLabel}
          {(collapsible || onClose) && <ChevronDown className="w-4 h-4 ml-auto" />}
        </button>
        {otherId && (
          <button onClick={() => setMenuOpen((v) => !v)} className="ml-2 p-1 rounded-full hover:bg-background/60" aria-label="Chat options">
            <MoreVertical className="w-4 h-4" />
          </button>
        )}
        {menuOpen && (
          <div className="absolute z-50 top-full right-2 mt-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden min-w-[170px]">
            <button onClick={handleBlock} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm hover:bg-muted">
              <UserX className="w-4 h-4" /> Block user
            </button>
            <button onClick={() => { setMenuOpen(false); setReporting(true); }} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-destructive hover:bg-muted">
              <Flag className="w-4 h-4" /> Report and block
            </button>
          </div>
        )}
      </div>

      <div className={`${bodyClassName} overflow-y-auto p-3 space-y-2 flex-1`}>
        {!loaded && (
          <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
        )}
        {loaded && messages.length === 0 && (
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
        <form onSubmit={send} className="flex gap-2 p-2 border-t border-border/50 shrink-0">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message"
            maxLength={maxLength}
          />
          <Button type="submit" size="icon" disabled={sending || !text.trim()} aria-label="Send">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </form>
      ) : (
        <p className="text-xs text-center text-muted-foreground p-2 border-t border-border/50 shrink-0">This chat has ended.</p>
      )}

      {reporting && (
        <ReportUserModal
          meId={meId}
          user={{ id: otherId, name: otherLabel }}
          onClose={() => setReporting(false)}
        />
      )}
    </div>
  );
}
