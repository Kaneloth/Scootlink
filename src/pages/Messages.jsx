import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth, supabase, fetchProfilesByIds } from '@/api/supabaseData';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  ArrowLeft, Send, MessageCircle, User, Loader2, Plus, Lock,
  Copy, Trash2, Trash, Check, CheckCheck, Clock, AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';

// ── localStorage helpers for client-side "delete for me" ─────────────────────
const HIDDEN_KEY       = (uid) => `scootlink_hidden_msgs_${uid}`;
const HIDDEN_CHATS_KEY = (uid) => `scootlink_hidden_chats_${uid}`;

const getHiddenMsgs   = (uid) => { try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY(uid))       || '[]')); } catch { return new Set(); } };
const getHiddenChats  = (uid) => { try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_CHATS_KEY(uid)) || '[]')); } catch { return new Set(); } };
const addHiddenMsg    = (uid, id)  => { const s = getHiddenMsgs(uid);  s.add(id);  localStorage.setItem(HIDDEN_KEY(uid),       JSON.stringify([...s])); };
const addHiddenChat   = (uid, oid) => { const s = getHiddenChats(uid); s.add(oid); localStorage.setItem(HIDDEN_CHATS_KEY(uid), JSON.stringify([...s])); };

// ── Status icon shown on sent messages ───────────────────────────────────────
// status: 'sending' | 'failed' | undefined (real DB row)
// read:   boolean — whether the recipient has opened the message
function MsgStatus({ status, read }) {
  if (status === 'sending') return <Clock      className="w-3 h-3 opacity-50 inline ml-1" />;
  if (status === 'failed')  return null; // no tick on failed
  // Use opacity only — inherits parent color so ticks stay visible inside
  // primary-colored sent bubbles AND in the muted conversation list preview.
  if (read)  return <CheckCheck className="w-3 h-3 opacity-90 inline ml-1" />;
  return            <Check      className="w-3 h-3 opacity-55 inline ml-1" />;
}

// ── Skeletons ─────────────────────────────────────────────────────────────────
function ConversationSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="p-4 rounded-xl border border-border/50 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-muted rounded w-1/3" />
              <div className="h-3 bg-muted rounded w-2/3" />
            </div>
            <div className="h-3 bg-muted rounded w-10 shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
}

function MessagesSkeleton() {
  return (
    <div className="space-y-3 mb-4">
      {[{ w: '55%', side: 'end' }, { w: '70%', side: 'start' }, { w: '45%', side: 'end' }, { w: '60%', side: 'start' }].map((s, i) => (
        <div key={i} className={`flex w-full justify-${s.side}`}>
          <div className="h-10 rounded-xl bg-muted animate-pulse" style={{ width: s.w }} />
        </div>
      ))}
    </div>
  );
}

// ── Context menu bottom sheet ─────────────────────────────────────────────────
function ContextMenu({ menu, onClose, onAction }) {
  if (!menu) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="bg-card rounded-t-2xl w-full max-w-lg p-2 pb-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {menu.options.map((opt) => (
          <button
            key={opt.action}
            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium transition-colors hover:bg-accent active:bg-accent ${opt.destructive ? 'text-destructive' : 'text-foreground'}`}
            onClick={() => { onAction(opt.action); onClose(); }}
          >
            {opt.icon}
            {opt.label}
          </button>
        ))}
        <button className="w-full mt-1 px-4 py-3.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-accent" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Messages() {
  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();
  const urlUserId      = searchParams.get('userId');

  const [user, setUser]                               = useState(null);
  const [conversations, setConversations]             = useState([]);
  const [selectedChat, setSelectedChat]               = useState(null);
  const [messages, setMessages]                       = useState([]);
  const [newMessage, setNewMessage]                   = useState('');
  const [loading, setLoading]                         = useState(false);
  const [newChatEmail, setNewChatEmail]               = useState('');
  const [startNewChat, setStartNewChat]               = useState(false);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [chatLoading, setChatLoading]                 = useState(false);
  const [contextMenu, setContextMenu]                 = useState(null);
  const [hiddenMsgs, setHiddenMsgs]                   = useState(new Set());
  const [hiddenChats, setHiddenChats]                 = useState(new Set());

  // Refs so realtime callbacks always see the current values (fixes stale closure)
  const userRef         = useRef(null);
  const selectedChatRef = useRef(null);
  const longPressTimer  = useRef(null);
  const messagesEndRef  = useRef(null);
  // Per-conversation broadcast channel — used for "delete for everyone" because
  // Supabase postgres_changes DELETE events are not delivered to the recipient
  // when RLS is enabled with default REPLICA IDENTITY (the row is gone so RLS
  // cannot be evaluated). A broadcast channel shared by both users in the
  // conversation is the reliable alternative.
  const convChannelRef      = useRef(null);
  // Persistent per-user events channel — always active while the user is logged
  // in, regardless of which conversation (if any) is open. "Delete for everyone"
  // broadcasts here so the recipient receives the removal even when they are
  // looking at a different chat or the conversations list.
  const userEventsChannelRef = useRef(null);

  useEffect(() => { userRef.current = user; },         [user]);
  useEffect(() => { selectedChatRef.current = selectedChat; }, [selectedChat]);

  // Persistent per-user events channel.
  // Active for the entire session (not tied to a specific conversation) so
  // "delete for everyone" broadcasts reach the recipient wherever they are.
  useEffect(() => {
    if (!user) return;

    const handleDeletedEvent = ({ payload }) => {
      if (payload?.id) {
        setMessages((prev) => prev.filter((m) => m.id !== payload.id));
        // Persist so the message stays hidden after a reload
        addHiddenMsg(user.id, payload.id);
        setHiddenMsgs((prev) => new Set([...prev, payload.id]));
      }
      fetchConversations();
    };

    const ch = supabase
      .channel(`user-events-${user.id}`)
      .on('broadcast', { event: 'message_deleted' }, handleDeletedEvent)
      .subscribe();

    userEventsChannelRef.current = ch;
    return () => {
      supabase.removeChannel(ch);
      userEventsChannelRef.current = null;
    };
  }, [user]); // fetchConversations omitted: stable useCallback([]) ref, declared later in body

  // Subscribe to a shared broadcast channel whenever a chat is open.
  // Both participants join the same channel (keyed by sorted user IDs) so
  // broadcasts from either side — e.g. "delete for everyone" — are received
  // by both without relying on postgres_changes DELETE (which Supabase drops
  // when RLS + default REPLICA IDENTITY prevents row-level auth on deletes).
  useEffect(() => {
    if (convChannelRef.current) {
      supabase.removeChannel(convChannelRef.current);
      convChannelRef.current = null;
    }
    if (!selectedChat || !user) return;

    const convKey = [user.id, selectedChat.otherUserId].sort().join('_');
    const ch = supabase
      .channel(`conv-broadcast-${convKey}`)
      .on('broadcast', { event: 'message_deleted' }, ({ payload }) => {
        if (payload?.id) {
          setMessages((prev) => prev.filter((m) => m.id !== payload.id));
          // Persist so the message stays hidden after a reload
          addHiddenMsg(user.id, payload.id);
          setHiddenMsgs((prev) => new Set([...prev, payload.id]));
        }
        fetchConversations();
      })
      .subscribe();

    convChannelRef.current = ch;
    return () => {
      supabase.removeChannel(ch);
      convChannelRef.current = null;
    };
  }, [selectedChat, user]); // fetchConversations omitted: stable useCallback([]) ref, declared later in body

  // Auto-scroll to latest message
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ── Load user ────────────────────────────────────────────────────────────
  useEffect(() => {
    auth.me().then((u) => {
      setUser(u);
      if (u?.id) {
        setHiddenMsgs(getHiddenMsgs(u.id));
        setHiddenChats(getHiddenChats(u.id));
      }
    }).catch(() => {});
  }, []);

  // ── Conversations ────────────────────────────────────────────────────────
  const fetchConversations = useCallback(async () => {
    const u = userRef.current;
    if (!u) return;
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(`sender_id.eq.${u.id},receiver_id.eq.${u.id}`)
        .order('created_at', { ascending: false });

      if (error) { console.error(error); return; }

      const otherIds = new Set();
      data.forEach((msg) => {
        otherIds.add(msg.sender_id === u.id ? msg.receiver_id : msg.sender_id);
      });

      // Always fetch names — this query uses only columns that already exist
      const { data: profiles } = await supabase
        .from('profiles').select('id, full_name').in('id', Array.from(otherIds));

      const nameMap   = {};
      const avatarMap = {};
      profiles?.forEach((p) => { nameMap[p.id] = p.full_name || 'User'; });

      // Fetch enriched profiles via the Netlify function (service role) so
      // avatar_url is resolved from auth user_metadata for all users, including
      // those who set a photo before the profiles table had the column.
      try {
        const enriched = await fetchProfilesByIds(Array.from(otherIds));
        enriched.forEach((p) => {
          avatarMap[p.id] = p.avatar_visible !== false ? (p.avatar_url || null) : null;
        });
      } catch { /* non-fatal — conversation list just shows initials */ }

      // Read hidden (deleted-for-everyone) message IDs fresh from localStorage
      // so that deleted messages are never shown as the conversation preview.
      const currentHiddenMsgs = getHiddenMsgs(u.id);

      const grouped = {};
      data.forEach((msg) => {
        const otherId = msg.sender_id === u.id ? msg.receiver_id : msg.sender_id;
        // Always record the conversation so it appears in the list, but only
        // use this message as the preview if it hasn't been deleted.
        if (!grouped[otherId]) {
          grouped[otherId] = {
            otherUserId:     otherId,
            otherUserName:   nameMap[otherId] || 'User',
            otherUserAvatar: avatarMap[otherId] || null,
            lastMessage:     null,
            lastSenderId:    msg.sender_id,
            lastRead:        msg.read,
            unread:          !msg.read && msg.receiver_id === u.id,
            lastTime:        msg.created_at,
          };
        }
        // Fill in lastMessage with the first (most-recent) non-hidden message.
        if (grouped[otherId].lastMessage === null && !currentHiddenMsgs.has(msg.id)) {
          grouped[otherId].lastMessage = msg.body;
        }
      });

      const currentHiddenChats = getHiddenChats(u.id);
      setConversations(Object.values(grouped).filter((c) => !currentHiddenChats.has(c.otherUserId)));
    } catch (err) {
      console.error(err);
    } finally {
      setConversationsLoading(false);
    }
  }, []); // intentionally empty — uses userRef to avoid stale closure

  useEffect(() => { if (user) fetchConversations(); }, [user, fetchConversations]);

  // Auto-open from URL param
  useEffect(() => {
    if (urlUserId && user && user.id !== urlUserId) openChat(urlUserId);
  }, [urlUserId, user]);

  // ── Realtime subscription — uses refs to avoid stale closures ────────────
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`messages-channel-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `sender_id=eq.${user.id}` },
        (payload) => handleRealtimeInsert(payload.new))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${user.id}` },
        (payload) => handleRealtimeInsert(payload.new))
      // When the recipient marks a message as read, flip the tick on the sender's side
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `sender_id=eq.${user.id}` },
        (payload) => {
          if (payload.new?.id) {
            setMessages((prev) =>
              prev.map((m) => m.id === payload.new.id ? { ...m, read: payload.new.read } : m)
            );
          }
          fetchConversations();
        })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' },
        (payload) => {
          // Remove the deleted message from the open chat on both sides.
          // payload.old contains at least the primary key even when
          // REPLICA IDENTITY is not set to FULL.
          if (payload.old?.id) {
            setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
          }
          fetchConversations();
        })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [user]);

  const handleRealtimeInsert = async (msg) => {
    const u    = userRef.current;
    const chat = selectedChatRef.current;

    if (chat) {
      const belongsToChat =
        (msg.sender_id === u?.id && msg.receiver_id === chat.otherUserId) ||
        (msg.receiver_id === u?.id && msg.sender_id === chat.otherUserId);

      if (belongsToChat) {
        setMessages((prev) => {
          // Replace matching optimistic message (same body + no real id yet)
          // or skip if exact id already present (dedup)
          if (prev.some((m) => m.id === msg.id)) return prev;
          // Replace optimistic temp message if it matches
          const tempIdx = prev.findIndex(
            (m) => m._temp && m.sender_id === u?.id && m.body === msg.body && m.receiver_id === chat.otherUserId
          );
          if (tempIdx !== -1) {
            const next = [...prev];
            next[tempIdx] = msg; // swap temp for real
            return next;
          }
          return [...prev, msg];
        });

        // Mark as read if we're the receiver
        if (msg.receiver_id === u?.id) {
          await supabase.from('messages').update({ read: true }).eq('id', msg.id);
        }
      }
    }

    fetchConversations();
  };

  // ── Open chat ────────────────────────────────────────────────────────────
  const openChat = async (otherUserId) => {
    const u = userRef.current;
    if (!u) return;
    setChatLoading(true);

    const { data: profile } = await supabase
      .from('profiles').select('full_name, email').eq('id', otherUserId).single();
    const otherUserName = profile?.full_name || profile?.email || 'User';
    // Fetch avatar via service-role function so auth metadata avatars are included
    let otherUserAvatar = null;
    try {
      const enriched = await fetchProfilesByIds([otherUserId]);
      const ep = enriched[0];
      otherUserAvatar = (ep?.avatar_visible !== false && ep?.avatar_url) ? ep.avatar_url : null;
    } catch { /* non-fatal */ }

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${u.id},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${u.id})`)
      .order('created_at', { ascending: true });

    if (error) { console.error(error); setChatLoading(false); return; }

    const unreadIds = data.filter((m) => m.receiver_id === u.id && !m.read).map((m) => m.id);
    if (unreadIds.length > 0) {
      await supabase.from('messages').update({ read: true }).in('id', unreadIds);
    }

    setSelectedChat({ otherUserId, otherUserName, otherUserAvatar });
    setMessages(data);
    setChatLoading(false);
  };

  const closeChat = () => setSelectedChat(null);

  // ── Send — with optimistic update ────────────────────────────────────────
  const isAdmin    = ['kanelothelejane@gmail.com'].includes(user?.email);
  const canMessage = isAdmin || (user?.subscription_active && user?.verified);

  const handleSend = async () => {
    if (!newMessage.trim() || !selectedChat) return;
    if (!canMessage) { toast.warning('You need an active subscription and verification to send messages'); return; }

    const tempId      = `temp-${Date.now()}`;
    const msgBody     = newMessage.trim();

    // Optimistically add message immediately so the user sees it right away
    const optimistic = {
      id:          tempId,
      _temp:       true,
      _status:     'sending',
      sender_id:   user.id,
      receiver_id: selectedChat.otherUserId,
      body:        msgBody,
      created_at:  new Date().toISOString(),
      read:        false,
    };
    setMessages((prev) => [...prev, optimistic]);
    setNewMessage('');

    setLoading(true);
    const { data: inserted, error } = await supabase
      .from('messages')
      .insert([{ sender_id: user.id, receiver_id: selectedChat.otherUserId, body: msgBody }])
      .select()
      .single();
    setLoading(false);

    if (error) {
      // Mark optimistic as failed
      setMessages((prev) => prev.map((m) => m.id === tempId ? { ...m, _status: 'failed' } : m));
      toast.error('Message failed to send. Check your connection.');
    } else if (inserted) {
      // Replace optimistic with real DB message
      setMessages((prev) => prev.map((m) => m.id === tempId ? inserted : m));
    }
  };

  // Retry a failed message
  const handleRetry = async (failedMsg) => {
    setMessages((prev) => prev.filter((m) => m.id !== failedMsg.id));
    setNewMessage(failedMsg.body);
  };

  // ── New chat ──────────────────────────────────────────────────────────────
  const handleNewChat = async () => {
    if (!newChatEmail.trim()) return;
    if (!canMessage) { toast.warning('Subscribe and get verified to start new conversations'); return; }
    const { data, error } = await supabase
      .from('profiles').select('id, full_name, email').eq('email', newChatEmail.trim()).single();
    if (error || !data) { toast.error('User not found'); return; }
    if (data.id === user.id) { toast.error('Cannot message yourself'); return; }
    openChat(data.id);
    setStartNewChat(false);
    setNewChatEmail('');
  };

  // ── Delete actions ────────────────────────────────────────────────────────
  const handleDeleteForMe = (msgId) => {
    addHiddenMsg(user.id, msgId);
    setHiddenMsgs((prev) => new Set([...prev, msgId]));
    toast.success('Message deleted for you.');
  };

  const handleDeleteForEveryone = async (msgId) => {
    const { error } = await supabase.from('messages').delete().eq('id', msgId).eq('sender_id', user.id);
    if (error) { toast.error('Could not delete message.'); return; }

    // Remove from sender's own view immediately and persist across reloads
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    addHiddenMsg(user.id, msgId);
    setHiddenMsgs((prev) => new Set([...prev, msgId]));
    fetchConversations();
    toast.success('Message deleted for everyone.');

    const deletePayload = { type: 'broadcast', event: 'message_deleted', payload: { id: msgId } };

    // 1. Broadcast on the shared per-conversation channel (catches recipient
    //    when they have this exact chat open).
    convChannelRef.current?.send(deletePayload);

    // 2. Broadcast on the recipient's persistent user-events channel so the
    //    message is removed even when the recipient is on a different page,
    //    viewing a different chat, or on the conversations list.
    const recipientId = selectedChat?.otherUserId;
    if (recipientId) {
      const tmpCh = supabase.channel(`user-events-${recipientId}`);
      tmpCh.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          tmpCh.send(deletePayload);
          // Leave quickly — we only needed to publish, not linger
          setTimeout(() => supabase.removeChannel(tmpCh), 3000);
        }
      });
    }
  };

  const handleDeleteChat = (otherUserId) => {
    addHiddenChat(user.id, otherUserId);
    setHiddenChats((prev) => new Set([...prev, otherUserId]));
    setConversations((prev) => prev.filter((c) => c.otherUserId !== otherUserId));
    toast.success('Chat removed from your inbox.');
  };

  const handleCopy = (text) => {
    navigator.clipboard?.writeText(text)
      .then(() => toast.success('Copied!'))
      .catch(() => toast.error('Copy failed'));
  };

  // ── Long-press helpers ────────────────────────────────────────────────────
  const startLongPress = (cb) => (e) => {
    longPressTimer.current = setTimeout(cb, 480);
  };
  const cancelLongPress = () => clearTimeout(longPressTimer.current);

  const showMessageMenu = (msg) => {
    const isMine = msg.sender_id === user.id;
    setContextMenu({
      type: 'message', msg,
      options: [
        { action: 'copy',                label: 'Copy message',         icon: <Copy     className="w-4 h-4" />, destructive: false },
        { action: 'delete_for_me',       label: 'Delete for me',        icon: <Trash    className="w-4 h-4" />, destructive: true  },
        ...(isMine ? [{ action: 'delete_for_everyone', label: 'Delete for everyone', icon: <Trash2   className="w-4 h-4" />, destructive: true }] : []),
      ],
    });
  };

  const showConvMenu = (conv) => {
    setContextMenu({
      type: 'conversation', conv,
      options: [
        { action: 'delete_chat', label: 'Delete chat', icon: <Trash2 className="w-4 h-4" />, destructive: true },
      ],
    });
  };

  const handleMenuAction = (action) => {
    if (!contextMenu) return;
    if (action === 'copy')                handleCopy(contextMenu.msg?.body);
    if (action === 'delete_for_me')       handleDeleteForMe(contextMenu.msg?.id);
    if (action === 'delete_for_everyone') handleDeleteForEveryone(contextMenu.msg?.id);
    if (action === 'delete_chat')         handleDeleteChat(contextMenu.conv?.otherUserId);
  };

  // ── Visible messages ──────────────────────────────────────────────────────
  const visibleMessages = messages.filter((m) => !hiddenMsgs.has(m.id));

  if (!user) {
    return (
      <div className="p-4 lg:p-8 max-w-5xl mx-auto pb-20 lg:pb-8">
        <ConversationSkeleton />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto pb-20 lg:pb-8">
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} onAction={handleMenuAction} />

      {!selectedChat && (
        <button
          onClick={() => { if (window.history.length > 1) navigate(-1); else navigate('/'); }}
          className="relative z-30 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 py-3 px-2 -ml-2 rounded-lg active:bg-accent"
          style={{ touchAction: 'manipulation', minHeight: '44px' }}
        >
          <ArrowLeft className="w-5 h-5" /> Back
        </button>
      )}

      {!selectedChat ? (
        <>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-foreground">Messages</h2>
            <button
              onClick={() => {
                if (!canMessage) { toast.warning('Subscribe and get verified to start new conversations'); return; }
                setStartNewChat(!startNewChat);
              }}
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <Plus className="w-4 h-4" /> New
            </button>
          </div>

          {startNewChat && (
            <div className="mb-4 flex gap-2">
              <Input placeholder="Enter email address" value={newChatEmail} onChange={(e) => setNewChatEmail(e.target.value)} />
              <Button onClick={handleNewChat} size="sm">Start</Button>
            </div>
          )}

          {conversationsLoading ? (
            <ConversationSkeleton />
          ) : conversations.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MessageCircle className="w-12 h-12 mx-auto mb-3" />
              <p>No messages yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {conversations.map((conv) => (
                <Card
                  key={conv.otherUserId}
                  className={`p-4 cursor-pointer hover:bg-accent transition-colors select-none ${conv.unread ? 'border-primary' : 'border-border/50'}`}
                  onClick={() => openChat(conv.otherUserId)}
                  onContextMenu={(e) => { e.preventDefault(); showConvMenu(conv); }}
                  onTouchStart={startLongPress(() => showConvMenu(conv))}
                  onTouchEnd={cancelLongPress}
                  onTouchMove={cancelLongPress}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0">
                      {conv.otherUserAvatar ? (
                        <img src={conv.otherUserAvatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-5 h-5 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{conv.otherUserName}</p>
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                        {conv.lastSenderId === user?.id && (
                          <MsgStatus status={undefined} read={conv.lastRead} />
                        )}
                        {conv.lastMessage}
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1 ml-2">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(conv.lastTime).toLocaleDateString()}</span>
                      {conv.unread && <span className="w-2 h-2 bg-primary rounded-full" />}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={closeChat}
              className="text-muted-foreground hover:text-foreground active:bg-accent rounded-lg py-2 px-1 -ml-1"
              style={{ touchAction: 'manipulation', minHeight: '44px' }}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0">
              {selectedChat.otherUserAvatar
                ? <img src={selectedChat.otherUserAvatar} alt="" className="w-full h-full object-cover" />
                : <User className="w-4 h-4 text-primary" />}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold text-foreground leading-tight truncate">{selectedChat.otherUserName}</h2>
            </div>
            <button
              className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 py-2 px-2 rounded-lg hover:bg-destructive/10"
              onClick={() => {
                if (window.confirm('Delete this chat from your inbox?')) {
                  handleDeleteChat(selectedChat.otherUserId);
                  closeChat();
                }
              }}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3 mb-4 max-h-[60vh] overflow-y-auto" id="messages-container" style={{ touchAction: 'pan-y' }}>
            {chatLoading ? (
              <MessagesSkeleton />
            ) : (
              visibleMessages.map((msg) => {
                // Defensive: only true when user.id is known AND matches sender
                const userId   = user?.id ?? null;
                const isMine   = userId !== null && msg.sender_id === userId;
                const isFailed = msg._status === 'failed';

                return (
                  <div
                    key={msg.id}
                    className="w-full flex select-none"
                    onContextMenu={(e) => { e.preventDefault(); if (!msg._temp) showMessageMenu(msg); }}
                    onTouchStart={startLongPress(() => { if (!msg._temp) showMessageMenu(msg); })}
                    onTouchEnd={cancelLongPress}
                    onTouchMove={cancelLongPress}
                  >
                    <div className={`max-w-[75%] p-3 rounded-xl ${isMine ? 'ml-auto' : 'mr-auto'} ${
                      isMine
                        ? isFailed
                          ? 'bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700'
                          : msg._status === 'sending'
                            ? 'bg-primary/60 text-primary-foreground'
                            : 'bg-primary text-primary-foreground'
                        : 'bg-card border border-border/50'
                    }`}>
                      <p className="text-sm">{msg.body}</p>
                      <div className="flex items-center justify-end gap-1 mt-1 opacity-70">
                        <span className="text-[10px]">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {/* Status ticks only on messages I sent */}
                        {isMine && <MsgStatus status={msg._status} read={msg.read} />}
                      </div>
                      {isFailed && (
                        <button
                          className="text-[10px] text-red-500 underline mt-1"
                          onClick={() => handleRetry(msg)}
                        >
                          Tap to retry
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {canMessage ? (
            <div className="border-t border-border pt-4">
              <Textarea
                placeholder="Type your message…"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                rows={2}
                className="mb-2"
              />
              <Button onClick={handleSend} disabled={!newMessage.trim() || loading} className="w-full gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {loading ? 'Sending…' : 'Send'}
              </Button>
            </div>
          ) : (
            <div className="border-t border-border pt-5 flex flex-col items-center gap-2 text-center">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <Lock className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">Messaging locked</p>
              <p className="text-xs text-muted-foreground">
                {!user?.subscription_active
                  ? 'You need an active subscription to send messages'
                  : 'Your account is awaiting verification — messaging will unlock once approved'}
              </p>
              <Button size="sm" variant="outline" className="mt-1" onClick={() => navigate('/settings')}>
                View Plans
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
