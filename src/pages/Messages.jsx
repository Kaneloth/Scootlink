import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth, supabase, fetchProfilesByIds } from '@/api/supabaseData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft, Send, MessageCircle, Loader2, Plus,
  Copy, Trash, Trash2, Check, CheckCheck, UserX, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
// ── localStorage helpers ──────────────────────────────────────────────────────
const hiddenKey      = (uid) => `skootlink_hidden_msgs_${uid}`;
const hiddenChatsKey = (uid) => `skootlink_hidden_chats_${uid}`;
const getHidden      = (uid) => { try { return new Set(JSON.parse(localStorage.getItem(hiddenKey(uid))      || '[]')); } catch { return new Set(); } };
const getHiddenChats = (uid) => { try { return new Set(JSON.parse(localStorage.getItem(hiddenChatsKey(uid))|| '[]')); } catch { return new Set(); } };
const addHidden      = (uid, id)  => { const s = getHidden(uid);      s.add(id);  localStorage.setItem(hiddenKey(uid),      JSON.stringify([...s])); };
const addHiddenChat  = (uid, pid) => { const s = getHiddenChats(uid); s.add(pid); localStorage.setItem(hiddenChatsKey(uid), JSON.stringify([...s])); };
// ── Date separator helper ─────────────────────────────────────────────────────
function dateSep(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString())     return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}
function sameDay(a, b) { return new Date(a).toDateString() === new Date(b).toDateString(); }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function fmtThread(iso) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return fmtTime(iso);
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

// ── Shared ProfileCard modal ──────────────────────────────────────────────────
// Renders via createPortal so it floats above everything.
function ProfileCard({ partnerId, partnerName, partnerAvatar, onClose }) {
  const [profile,  setProfile]  = useState(null);
  const [vehicles, setVehicles] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        // Use exact columns from original working ChatRoom profile fetch
        // avatar_url excluded — avatar is passed via prop from thread list
        const { data: p, error: pErr } = await supabase
          .from('profiles')
          .select('id, full_name, phone, location, account_type, verified, rating, total_reviews, license_number')
          .eq('id', partnerId)
          .single();
        if (pErr) {
          console.warn('[ProfileCard] profile fetch error:', pErr.message);
          setProfile({ full_name: partnerName, location: '', account_type: null, verified: false, rating: 0, total_reviews: 0 });
          return;
        }
        setProfile(p || { full_name: partnerName, location: '', account_type: null, verified: false, rating: 0, total_reviews: 0 });
        if (p?.account_type === 'owner' || p?.account_type === 'both') {
          const { data: v } = await supabase
            .from('vehicles')
            .select('id, make, model, year, type, plate, price_per_week, deposit, status')
            .eq('owner_id', partnerId)
            .limit(5);
          setVehicles(v || []);
        }
      } catch (err) {
        console.warn('[ProfileCard] unexpected error:', err);
        setProfile({ full_name: partnerName, location: '', account_type: null, verified: false, rating: 0, total_reviews: 0 });
      }
    })();
  }, [partnerId, partnerName]);

  const initials = partnerName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-black/50 flex items-end justify-center p-4"
      onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-sm shadow-xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        {!profile ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-primary opacity-60" />
          </div>
        ) : (
          <>
            {/* Header — avatar, name, location, badges */}
            <div className="bg-primary/10 px-5 pt-5 pb-4 flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden shrink-0 ring-2 ring-white/30">
                {partnerAvatar
                  ? <img src={partnerAvatar} alt="" className="w-full h-full object-cover" />
                  : <span className="text-2xl font-bold text-primary">{initials}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-base text-foreground truncate">{profile.full_name || partnerName}</p>
                {profile.location && (
                  <p className="text-xs text-muted-foreground mt-0.5">📍 {profile.location}</p>
                )}
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize ${
                    profile.account_type === 'owner' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                    profile.account_type === 'both'  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' :
                                                       'bg-primary/10 text-primary'
                  }`}>
                    {profile.account_type === 'both' ? '🚗 Owner & Driver' : profile.account_type === 'owner' ? '🚗 Owner' : '🧑 Driver'}
                  </span>
                  {profile.verified
                    ? <span className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 rounded-full font-semibold">✅ Verified</span>
                    : <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-semibold">⏳ Unverified</span>}
                </div>
              </div>
            </div>

            {/* Stats — rating + reviews */}
            <div className="px-5 py-3 border-b border-border grid grid-cols-2 divide-x divide-border">
              <div className="text-center pr-4">
                <p className="font-bold text-lg text-foreground">
                  {Number(profile.rating || 0) > 0 ? Number(profile.rating).toFixed(1) : '—'}
                </p>
                <p className="text-xs text-muted-foreground">⭐ Rating</p>
              </div>
              <div className="text-center pl-4">
                <p className="font-bold text-lg text-foreground">{profile.total_reviews || 0}</p>
                <p className="text-xs text-muted-foreground">Reviews</p>
              </div>
            </div>

            {/* Contact + license info */}
            {(profile.phone || profile.license_number) && (
              <div className="px-5 py-3 border-b border-border space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Contact Info</p>
                {profile.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">📞</span>
                    <span className="text-foreground">{profile.phone}</span>
                  </div>
                )}
                {profile.license_number && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">🪪</span>
                    <span className="text-foreground font-mono">{profile.license_number}</span>
                  </div>
                )}
              </div>
            )}

            {/* Vehicles — shown for owners and both */}
            {vehicles.length > 0 && (
              <div className="px-5 py-3 border-b border-border">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Listed Vehicles</p>
                <div className="space-y-3">
                  {vehicles.map(v => (
                    <div key={v.id} className="bg-muted/40 rounded-xl px-3 py-2.5 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-foreground">{v.year && `${v.year} `}{v.make} {v.model}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 capitalize">{v.type}</p>
                        {v.deposit > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">Deposit: R{v.deposit}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-primary text-sm">R{v.price_per_week}<span className="text-xs font-normal text-muted-foreground">/wk</span></p>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full mt-1 inline-block ${
                          v.status === 'available'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                        }`}>
                          {v.status === 'available' ? '✅ Available' : '⏸ ' + v.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {vehicles.length === 0 && (profile.account_type === 'owner' || profile.account_type === 'both') && (
              <div className="px-5 py-3 border-b border-border">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Listed Vehicles</p>
                <p className="text-xs text-muted-foreground italic">No vehicles listed yet.</p>
              </div>
            )}

            <div className="px-5 py-4">
              <button onClick={onClose} className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1">Close</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT ROOM — shown when a conversation is open
// ═══════════════════════════════════════════════════════════════════════════════
function ChatRoom({ user, partner, onClose, creditBalance, setCreditBalance }) {
  const [messages,     setMessages]     = useState([]);
  const [text,         setText]         = useState('');
  const [sending,      setSending]      = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [selectedMsg,  setSelectedMsg]  = useState(null);
  const [hiddenMsgs,   setHiddenMsgs]   = useState(() => getHidden(user.id));
  const [showProfile,  setShowProfile]  = useState(false);
  const [partnerLocation, setPartnerLocation] = useState('');
  const bottomRef       = useRef(null);
  const menuRef         = useRef(null);
  const longPressRef    = useRef(null);
  const longTriggered   = useRef(false);
  const broadcastRef    = useRef(null);
  const isAdmin   = ['kanelothelejane@gmail.com', 'kaneloth@skootlink.co.za'].includes(user?.email);
  const canSend   = isAdmin || (creditBalance !== null && creditBalance >= 3);

  // Load partner location for header subtitle
  useEffect(() => {
    supabase.from('profiles').select('location').eq('id', partner.id).single()
      .then(({ data }) => { if (data?.location) setPartnerLocation(data.location); });
  }, [partner.id]);

  // Load messages
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${partner.id}),and(sender_id.eq.${partner.id},receiver_id.eq.${user.id})`)
        .order('created_at', { ascending: true });
      const hidden = getHidden(user.id);
      setHiddenMsgs(hidden);
      setMessages((data || []).filter(m => !hidden.has(m.id)));
      const unread = (data || []).filter(m => m.receiver_id === user.id && !m.read).map(m => m.id);
      if (unread.length) await supabase.from('messages').update({ read: true }).in('id', unread);
      setLoading(false);
    })();
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    const convKey = [user.id, partner.id].sort().join('_');
    const ch = supabase.channel(`chat-${convKey}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages',
        filter: `receiver_id=eq.${user.id}` }, async (payload) => {
          const msg = payload.new;
          if (msg.sender_id !== partner.id) return;
          setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
          await supabase.from('messages').update({ read: true }).eq('id', msg.id);
        })
      .on('broadcast', { event: 'msg_deleted' }, ({ payload }) => {
          if (payload?.id) {
            setMessages(prev => prev.filter(m => m.id !== payload.id));
            addHidden(user.id, payload.id);
          }
        })
      .subscribe();
    broadcastRef.current = ch;
    return () => supabase.removeChannel(ch);
  }, []);

  useEffect(() => {
    const handle = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setSelectedMsg(null);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('touchstart', handle);
    return () => { document.removeEventListener('mousedown', handle); document.removeEventListener('touchstart', handle); };
  }, []);

  const startLongPress = (msg) => {
    longTriggered.current = false;
    longPressRef.current = setTimeout(() => { longTriggered.current = true; setSelectedMsg(msg); }, 400);
  };
  const cancelLongPress = () => { if (longPressRef.current) clearTimeout(longPressRef.current); };
  const handleBubbleClick = (msg) => {
    if (longTriggered.current) { longTriggered.current = false; return; }
    setSelectedMsg(prev => prev?.id === msg.id ? null : msg);
  };

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!text.trim() || sending) return;
    if (!canSend) { toast.warning('You need at least 3 credits to send messages.'); return; }
    const body = text.trim();
    setText('');
    setSending(true);
    if (!isAdmin) {
      const hasSentBefore = messages.some(m => m.sender_id === user.id);
      if (!hasSentBefore) {
        const { error: creditErr } = await supabase.rpc('deduct_credits', {
          p_user_id: user.id, p_amount: 3, p_type: 'spend',
          p_description: `Message to ${partner.name}`, p_ref_id: partner.id,
        });
        if (creditErr?.message?.includes('insufficient_credits')) {
          setText(body); setSending(false);
          toast.error('Not enough credits.');
          return;
        }
        setCreditBalance(prev => Math.max(0, (prev ?? 0) - 3));
      }
    }
    const tempId = `temp-${Date.now()}`;
    const optimistic = { id: tempId, sender_id: user.id, receiver_id: partner.id, body, created_at: new Date().toISOString(), read: false, _temp: true };
    setMessages(prev => [...prev, optimistic]);
    const { data: inserted, error } = await supabase
      .from('messages')
      .insert([{ sender_id: user.id, receiver_id: partner.id, body }])
      .select().single();
    setSending(false);
    if (error) {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setText(body);
      toast.error('Failed to send. Try again.');
    } else {
      setMessages(prev => prev.map(m => m.id === tempId ? inserted : m));
    }
  };

  const handleCopy = (msg) => {
    navigator.clipboard?.writeText(msg.body).then(() => toast.success('Copied!')).catch(() => {});
    setSelectedMsg(null);
  };
  const handleDeleteForMe = (msg) => {
    addHidden(user.id, msg.id);
    setMessages(prev => prev.filter(m => m.id !== msg.id));
    setSelectedMsg(null);
    toast.success('Deleted for you.');
  };
  const handleDeleteForEveryone = async (msg) => {
    const { error } = await supabase.from('messages').delete().eq('id', msg.id).eq('sender_id', user.id);
    if (error) { toast.error('Could not delete.'); return; }
    setMessages(prev => prev.filter(m => m.id !== msg.id));
    addHidden(user.id, msg.id);
    setSelectedMsg(null);
    toast.success('Deleted for everyone.');
    broadcastRef.current?.send({ type: 'broadcast', event: 'msg_deleted', payload: { id: msg.id } });
  };

  const initials = partner.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <div className="fixed inset-0 z-[9999] bg-background flex flex-col" style={{ top: '57px' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted shrink-0">
        <button onClick={onClose} className="p-1.5 -ml-1.5 rounded-full hover:bg-muted transition-colors" style={{ minWidth: 40, minHeight: 40 }}>
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        {/* Avatar — opens profile card */}
        <button onClick={() => setShowProfile(true)} className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0 overflow-hidden hover:ring-2 hover:ring-primary/40 transition-all">
          {partner.avatar
            ? <img src={partner.avatar} alt="" className="w-full h-full object-cover rounded-full" />
            : <span className="text-sm font-bold text-primary">{initials}</span>}
        </button>
        {/* Name — opens profile card */}
        <button onClick={() => setShowProfile(true)} className="flex-1 min-w-0 text-left">
          <p className="font-semibold text-sm text-foreground leading-tight truncate">{partner.name}</p>
          {partnerLocation && <p className="text-xs text-muted-foreground leading-tight truncate">{partnerLocation}</p>}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-background">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary opacity-60" /></div>
        ) : messages.length === 0 ? (
          <div className="flex justify-center py-8">
            <div className="bg-card border border-border rounded-xl px-4 py-3 text-center max-w-xs">
              <p className="text-sm text-muted-foreground">Start the conversation!</p>
            </div>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isMe      = msg.sender_id === user.id;
            const isSelected= selectedMsg?.id === msg.id;
            const showSep   = i === 0 || !sameDay(messages[i - 1].created_at, msg.created_at);
            return (
              <div key={msg.id}>
                {showSep && (
                  <div className="flex justify-center my-3">
                    <span className="bg-muted text-muted-foreground text-[11px] px-3 py-1 rounded-full">{dateSep(msg.created_at)}</span>
                  </div>
                )}
                <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} mb-1 relative`}>
                  {isSelected && (
                    <div ref={menuRef} className={`absolute z-50 top-full mt-1 ${isMe ? 'right-0' : 'left-0'} bg-card border border-border rounded-xl shadow-lg overflow-hidden min-w-[180px]`}>
                      <button onClick={() => handleCopy(msg)} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-foreground hover:bg-muted">
                        <Copy className="w-4 h-4 text-muted-foreground" /> Copy
                      </button>
                      <button onClick={() => handleDeleteForMe(msg)} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-foreground hover:bg-muted">
                        <Trash className="w-4 h-4 text-muted-foreground" /> Delete for me
                      </button>
                      {isMe && !msg._temp && (
                        <button onClick={() => handleDeleteForEveryone(msg)} className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-destructive hover:bg-muted">
                          <Trash2 className="w-4 h-4" /> Delete for everyone
                        </button>
                      )}
                    </div>
                  )}
                  <div
                    onMouseDown={() => !msg._temp && startLongPress(msg)}
                    onMouseUp={cancelLongPress}
                    onMouseLeave={cancelLongPress}
                    onTouchStart={() => !msg._temp && startLongPress(msg)}
                    onTouchEnd={cancelLongPress}
                    onClick={() => !msg._temp && handleBubbleClick(msg)}
                    className={`relative max-w-[72%] rounded-2xl px-3.5 py-2 text-sm cursor-pointer select-none ${
                      isMe
                        ? msg._temp ? 'bg-primary/60 text-white rounded-br-[4px]' : 'bg-primary text-white rounded-br-[4px]'
                        : 'bg-card border border-border text-foreground rounded-bl-[4px]'
                    } ${isSelected ? 'opacity-75' : ''}`}
                  >
                    <p className="leading-snug break-words">{msg.body}</p>
                    <div className="flex items-center gap-1 mt-1 justify-end">
                      <span className={`text-[10px] ${isMe ? 'text-white/70' : 'text-muted-foreground'}`}>{fmtTime(msg.created_at)}</span>
                      {isMe && (
                        msg._temp
                          ? <Check className="w-3.5 h-3.5 text-white/60 shrink-0" />
                          : msg.read
                            ? <CheckCheck className="w-3.5 h-3.5 text-blue-300 shrink-0" />
                            : <CheckCheck className="w-3.5 h-3.5 text-white/60 shrink-0" />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Profile card modal */}
      {showProfile && (
        <ProfileCard
          partnerId={partner.id}
          partnerName={partner.name}
          partnerAvatar={partner.avatar}
          onClose={() => setShowProfile(false)}
        />
      )}

      <form onSubmit={handleSend} className="flex items-center gap-2 px-4 py-3 border-t border-border bg-background shrink-0" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <Input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Type a message…"
          disabled={sending}
          className="rounded-full flex-1 bg-muted/40 border-border"
        />
        <Button type="submit" size="icon" disabled={sending || !text.trim()} className="rounded-full shrink-0 w-10 h-10">
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </form>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHATS LIST — conversation threads
// ═══════════════════════════════════════════════════════════════════════════════
export default function Messages() {
  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();
  const urlUserId      = searchParams.get('userId');
  const [user,          setUser]          = useState(null);
  const [threads,       setThreads]       = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [openPartner,   setOpenPartner]   = useState(null);
  const [creditBalance, setCreditBalance] = useState(null);
  const [newChatEmail,  setNewChatEmail]  = useState('');
  const [showNewChat,   setShowNewChat]   = useState(false);
  const [selectedThread, setSelectedThread] = useState(null);
  const [hiddenChats,   setHiddenChats]   = useState(new Set());
  // Profile card shown from thread list
  const [previewProfile, setPreviewProfile] = useState(null); // { id, name, avatar }
  const menuRef      = useRef(null);
  const longPressRef = useRef(null);
  const longTriggered= useRef(false);

  useEffect(() => {
    auth.me().then(u => {
      setUser(u);
      if (u?.id) {
        setHiddenChats(getHiddenChats(u.id));
        supabase.rpc('get_credit_balance', { p_user_id: u.id }).then(({ data }) => setCreditBalance(data ?? 0));
      }
    }).catch(() => {});
  }, []);

  const fetchThreads = useCallback(async () => {
    if (!user) return;
    try {
      const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order('created_at', { ascending: false })
        .limit(200);
      if (!msgs) { setThreads([]); return; }
      const hidden = getHiddenChats(user.id);
      const seenIds = new Set();
      const unreadCount = new Map();
      for (const m of msgs) {
        if (m.receiver_id === user.id && !m.read) {
          const pid = m.sender_id;
          unreadCount.set(pid, (unreadCount.get(pid) || 0) + 1);
        }
      }
      const raw = [];
      for (const m of msgs) {
        const pid = m.sender_id === user.id ? m.receiver_id : m.sender_id;
        if (hidden.has(pid) || seenIds.has(pid)) continue;
        seenIds.add(pid);
        raw.push({ id: pid, name: pid, avatar: null, lastMsg: m.body, lastTime: m.created_at, unread: unreadCount.get(pid) || 0, isMine: m.sender_id === user.id });
      }
      if (raw.length) {
        const ids = raw.map(t => t.id);
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', ids);
        const nameMap = Object.fromEntries((profiles || []).map(p => [p.id, p.full_name || 'User']));
        try {
          const enriched = await fetchProfilesByIds(ids);
          const avatarMap = Object.fromEntries(enriched.map(p => [p.id, p.avatar_visible !== false ? p.avatar_url : null]));
          raw.forEach(t => { t.name = nameMap[t.id] || 'User'; t.avatar = avatarMap[t.id] || null; });
        } catch {
          raw.forEach(t => { t.name = nameMap[t.id] || 'User'; });
        }
      }
      setThreads(raw);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { if (user) fetchThreads(); }, [user, fetchThreads]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel(`threads-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${user.id}` },
        () => fetchThreads())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [user, fetchThreads]);

  useEffect(() => {
    if (!urlUserId || !user || user.id === urlUserId) return;
    (async () => {
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', urlUserId).single();
      setOpenPartner({ id: urlUserId, name: profile?.full_name || 'User', avatar: null });
    })();
  }, [urlUserId, user]);

  useEffect(() => {
    const handle = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setSelectedThread(null);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('touchstart', handle);
    return () => { document.removeEventListener('mousedown', handle); document.removeEventListener('touchstart', handle); };
  }, []);

  const startLongPress = (pid) => {
    longTriggered.current = false;
    longPressRef.current = setTimeout(() => { longTriggered.current = true; setSelectedThread(pid); }, 400);
  };
  const cancelLongPress = () => { if (longPressRef.current) clearTimeout(longPressRef.current); };

  const openChat = async (pid) => {
    if (longTriggered.current) { longTriggered.current = false; return; }
    if (selectedThread) { setSelectedThread(null); return; }
    const thread = threads.find(t => t.id === pid);
    if (thread) { setOpenPartner({ id: pid, name: thread.name, avatar: thread.avatar }); return; }
    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', pid).single();
    setOpenPartner({ id: pid, name: profile?.full_name || 'User', avatar: null });
  };

  const handleDeleteChat = (pid) => {
    addHiddenChat(user.id, pid);
    setHiddenChats(prev => new Set([...prev, pid]));
    setThreads(prev => prev.filter(t => t.id !== pid));
    setSelectedThread(null);
    toast.success('Chat removed from your inbox.');
  };

  const handleBlockUser = async (pid, name) => {
    try {
      await supabase.from('blocked_users').upsert({ blocker_id: user.id, blocked_id: pid }, { onConflict: 'blocker_id,blocked_id' });
    } catch { /* table may not exist yet */ }
    handleDeleteChat(pid);
    toast.success(`${name || 'User'} has been blocked.`);
  };

  const handleNewChat = async () => {
    if (!newChatEmail.trim()) return;
    const { data, error } = await supabase.from('profiles').select('id, full_name').eq('email', newChatEmail.trim()).single();
    if (error || !data) { toast.error('User not found'); return; }
    if (data.id === user?.id) { toast.error('Cannot message yourself'); return; }
    setShowNewChat(false); setNewChatEmail('');
    setOpenPartner({ id: data.id, name: data.full_name || 'User', avatar: null });
  };

  if (!user) return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary opacity-60" /></div>
    </div>
  );

  return (
    <>
      {openPartner && createPortal(
        <ChatRoom
          user={user}
          partner={openPartner}
          onClose={() => { setOpenPartner(null); fetchThreads(); }}
          creditBalance={creditBalance}
          setCreditBalance={setCreditBalance}
        />,
        document.body
      )}

      {/* Profile card preview from thread list */}
      {previewProfile && (
        <ProfileCard
          partnerId={previewProfile.id}
          partnerName={previewProfile.name}
          partnerAvatar={previewProfile.avatar}
          onClose={() => setPreviewProfile(null)}
        />
      )}

      <div className="max-w-2xl mx-auto pb-28">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <button onClick={() => navigate('/home')} className="p-1.5 -ml-1.5 rounded-full hover:bg-muted transition-colors">
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="text-xl font-bold text-foreground flex-1">Messages</h1>
          <button onClick={async () => { setRefreshing(true); await fetchThreads(); setRefreshing(false); }} className="p-1.5 rounded-full hover:bg-muted transition-colors">
            <RefreshCw className={`w-4 h-4 text-primary ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowNewChat(!showNewChat)} className="p-1.5 rounded-full hover:bg-muted transition-colors">
            <Plus className="w-4 h-4 text-primary" />
          </button>
        </div>

        {showNewChat && (
          <div className="px-4 pb-3 flex gap-2">
            <Input placeholder="Enter email address…" value={newChatEmail} onChange={e => setNewChatEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleNewChat()} className="flex-1" />
            <Button onClick={handleNewChat} size="sm">Start</Button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary opacity-60" /></div>
        ) : threads.length === 0 ? (
          <div className="text-center py-16 px-8 text-muted-foreground">
            <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No conversations yet</p>
            <p className="text-sm mt-1">Tap + to start a new conversation.</p>
          </div>
        ) : (
          <div className="px-4 space-y-2">
            {threads.map(t => {
              const isSelected = selectedThread === t.id;
              const initials   = t.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
              return (
                <div key={t.id} className="relative">
                  <div
                    onMouseDown={() => startLongPress(t.id)}
                    onMouseUp={cancelLongPress}
                    onMouseLeave={cancelLongPress}
                    onTouchStart={() => startLongPress(t.id)}
                    onTouchEnd={cancelLongPress}
                    onClick={() => openChat(t.id)}
                    className={`flex items-center gap-3 bg-card rounded-2xl border px-4 py-3.5 cursor-pointer select-none transition-all hover:shadow-sm ${
                      isSelected ? 'border-primary/40 bg-primary/5' : t.unread > 0 ? 'border-primary/30' : 'border-border'
                    }`}
                  >
                    {/* Avatar — tapping opens profile card, not chat */}
                    <button
                      onClick={e => { e.stopPropagation(); setPreviewProfile({ id: t.id, name: t.name, avatar: t.avatar }); }}
                      className="w-11 h-11 rounded-full bg-primary/15 flex items-center justify-center shrink-0 overflow-hidden hover:ring-2 hover:ring-primary/40 transition-all"
                    >
                      {t.avatar
                        ? <img src={t.avatar} alt="" className="w-full h-full object-cover" />
                        : <span className="text-sm font-bold text-primary">{initials}</span>}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <p className={`text-sm truncate ${t.unread > 0 ? 'font-bold' : 'font-semibold'} text-foreground`}>{t.name}</p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[11px] text-muted-foreground">{fmtThread(t.lastTime)}</span>
                          {t.unread > 0 && (
                            <span className="min-w-[18px] h-[18px] rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center px-1">
                              {t.unread > 99 ? '99+' : t.unread}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {t.isMine && <CheckCheck className="w-3.5 h-3.5 text-primary shrink-0" />}
                        <p className={`text-xs truncate ${t.unread > 0 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{t.lastMsg}</p>
                      </div>
                    </div>
                  </div>
                  {isSelected && (
                    <div ref={menuRef} className="absolute z-50 top-full mt-1 right-4 bg-card border border-border rounded-xl shadow-lg overflow-hidden min-w-[160px]">
                      <button onClick={() => handleDeleteChat(t.id)}
                        className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-destructive hover:bg-muted transition-colors">
                        <Trash2 className="w-4 h-4" /> Delete chat
                      </button>
                      <button onClick={() => handleBlockUser(t.id, t.name)}
                        className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors">
                        <UserX className="w-4 h-4" /> Block user
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
