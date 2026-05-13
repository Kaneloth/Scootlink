import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth } from '@/api/supabaseData';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Send, MessageCircle, User, Loader2, Plus, Lock, Copy, Trash2, Trash } from 'lucide-react';
import { toast } from 'sonner';

// ── localStorage helpers for client-side "delete for me" ─────────────────────
const HIDDEN_KEY = (userId) => `scootlink_hidden_msgs_${userId}`;
const HIDDEN_CHATS_KEY = (userId) => `scootlink_hidden_chats_${userId}`;

const getHiddenMsgs = (userId) => {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY(userId)) || '[]')); }
  catch { return new Set(); }
};
const addHiddenMsg = (userId, msgId) => {
  const s = getHiddenMsgs(userId);
  s.add(msgId);
  localStorage.setItem(HIDDEN_KEY(userId), JSON.stringify([...s]));
};
const getHiddenChats = (userId) => {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_CHATS_KEY(userId)) || '[]')); }
  catch { return new Set(); }
};
const addHiddenChat = (userId, otherUserId) => {
  const s = getHiddenChats(userId);
  s.add(otherUserId);
  localStorage.setItem(HIDDEN_CHATS_KEY(userId), JSON.stringify([...s]));
};

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
        <div key={i} className={`flex justify-${s.side}`}>
          <div className="h-10 rounded-xl bg-muted animate-pulse" style={{ width: s.w }} />
        </div>
      ))}
    </div>
  );
}

// ── Context menu (bottom sheet) ───────────────────────────────────────────────
function ContextMenu({ menu, onClose, onAction }) {
  if (!menu) return null;
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-t-2xl w-full max-w-lg p-2 pb-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {menu.options.map((opt) => (
          <button
            key={opt.action}
            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium transition-colors hover:bg-accent active:bg-accent ${
              opt.destructive ? 'text-destructive' : 'text-foreground'
            }`}
            onClick={() => { onAction(opt.action); onClose(); }}
          >
            {opt.icon}
            {opt.label}
          </button>
        ))}
        <button
          className="w-full mt-1 px-4 py-3.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-accent"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Messages() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlUserId = searchParams.get('userId');

  const [user, setUser]                         = useState(null);
  const [conversations, setConversations]       = useState([]);
  const [selectedChat, setSelectedChat]         = useState(null);
  const [messages, setMessages]                 = useState([]);
  const [newMessage, setNewMessage]             = useState('');
  const [subject, setSubject]                   = useState('');
  const [loading, setLoading]                   = useState(false);
  const [newChatEmail, setNewChatEmail]         = useState('');
  const [startNewChat, setStartNewChat]         = useState(false);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [chatLoading, setChatLoading]           = useState(false);
  const [contextMenu, setContextMenu]           = useState(null); // { options: [], target }
  const [hiddenMsgs, setHiddenMsgs]             = useState(new Set());
  const [hiddenChats, setHiddenChats]           = useState(new Set());

  const subscriptionRef = useRef(null);
  const longPressTimer  = useRef(null);

  // ── Load user + hidden lists ─────────────────────────────────────────────
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
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      if (error) { console.error(error); return; }

      const otherIds = new Set();
      data.forEach((msg) => {
        const otherId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id;
        otherIds.add(otherId);
      });

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', Array.from(otherIds));

      const nameMap = {};
      profiles?.forEach((p) => { nameMap[p.id] = p.full_name || 'User'; });

      const grouped = {};
      data.forEach((msg) => {
        const otherId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id;
        if (!grouped[otherId]) {
          grouped[otherId] = {
            otherUserId: otherId,
            otherUserName: nameMap[otherId] || 'User',
            lastMessage: msg.body,
            unread: !msg.read && msg.receiver_id === user.id,
            lastTime: msg.created_at,
          };
        }
      });

      const currentHiddenChats = getHiddenChats(user.id);
      setConversations(
        Object.values(grouped).filter((c) => !currentHiddenChats.has(c.otherUserId))
      );
    } catch (err) {
      console.error(err);
    } finally {
      setConversationsLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  // Auto-open from URL param
  useEffect(() => {
    if (urlUserId && user && user.id !== urlUserId) openChat(urlUserId);
  }, [urlUserId, user]);

  // ── Realtime ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const subscription = supabase
      .channel('messages-channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `sender_id=eq.${user.id}` },
        (payload) => handleRealtimeMessage(payload.new))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${user.id}` },
        (payload) => handleRealtimeMessage(payload.new))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' },
        () => { fetchConversations(); setMessages((prev) => prev.filter(() => true)); })
      .subscribe();

    subscriptionRef.current = subscription;
    return () => supabase.removeChannel(subscription);
  }, [user]);

  const handleRealtimeMessage = async (msg) => {
    if (selectedChat) {
      if (
        (msg.sender_id === user.id && msg.receiver_id === selectedChat.otherUserId) ||
        (msg.receiver_id === user.id && msg.sender_id === selectedChat.otherUserId)
      ) {
        setMessages((prev) => [...prev, msg]);
        if (msg.receiver_id === user.id) {
          await supabase.from('messages').update({ read: true }).eq('id', msg.id);
        }
      }
    }
    fetchConversations();
  };

  // ── Open chat ────────────────────────────────────────────────────────────
  const openChat = async (otherUserId) => {
    if (!user) return;
    setChatLoading(true);

    const { data: profile } = await supabase
      .from('profiles').select('full_name, email').eq('id', otherUserId).single();

    const otherUserName = profile?.full_name || profile?.email || 'User';

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${user.id},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${user.id})`)
      .order('created_at', { ascending: true });

    if (error) { console.error(error); setChatLoading(false); return; }

    const unreadIds = data.filter((m) => m.receiver_id === user.id && !m.read).map((m) => m.id);
    if (unreadIds.length > 0) {
      await supabase.from('messages').update({ read: true }).in('id', unreadIds);
    }

    setSelectedChat({ otherUserId, otherUserName });
    setMessages(data);
    setChatLoading(false);
  };

  const closeChat = () => setSelectedChat(null);

  // ── Send ─────────────────────────────────────────────────────────────────
  const isAdmin  = ['kanelothelejane@gmail.com'].includes(user?.email);
  const canMessage = isAdmin || (user?.subscription_active && user?.verified);

  const handleSend = async () => {
    if (!newMessage.trim() || !selectedChat) return;
    if (!canMessage) { toast.warning('You need an active subscription and verification to send messages'); return; }
    setLoading(true);
    const { error } = await supabase.from('messages').insert([{
      sender_id: user.id,
      receiver_id: selectedChat.otherUserId,
      subject: subject || null,
      body: newMessage.trim(),
    }]);
    if (error) toast.error('Failed to send message');
    else { setNewMessage(''); setSubject(''); }
    setLoading(false);
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
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    fetchConversations();
    toast.success('Message deleted for everyone.');
  };

  const handleDeleteChat = (otherUserId) => {
    addHiddenChat(user.id, otherUserId);
    setHiddenChats((prev) => new Set([...prev, otherUserId]));
    setConversations((prev) => prev.filter((c) => c.otherUserId !== otherUserId));
    toast.success('Chat removed from your inbox.');
  };

  const handleCopy = (text) => {
    navigator.clipboard?.writeText(text).then(() => toast.success('Copied!')).catch(() => toast.error('Copy failed'));
  };

  // ── Long-press helpers ────────────────────────────────────────────────────
  const startLongPress = (callback) => (e) => {
    e.preventDefault();
    longPressTimer.current = setTimeout(callback, 480);
  };
  const cancelLongPress = () => clearTimeout(longPressTimer.current);

  const showMessageMenu = (msg) => {
    const isMine = msg.sender_id === user.id;
    const options = [
      {
        action: 'copy',
        label: 'Copy message',
        icon: <Copy className="w-4 h-4" />,
        destructive: false,
      },
      {
        action: 'delete_for_me',
        label: 'Delete for me',
        icon: <Trash className="w-4 h-4" />,
        destructive: true,
      },
      ...(isMine ? [{
        action: 'delete_for_everyone',
        label: 'Delete for everyone',
        icon: <Trash2 className="w-4 h-4" />,
        destructive: true,
      }] : []),
    ];
    setContextMenu({ type: 'message', msg, options });
  };

  const showConvMenu = (conv) => {
    const options = [
      {
        action: 'delete_chat',
        label: 'Delete chat',
        icon: <Trash2 className="w-4 h-4" />,
        destructive: true,
      },
    ];
    setContextMenu({ type: 'conversation', conv, options });
  };

  const handleMenuAction = (action) => {
    if (!contextMenu) return;
    if (action === 'copy')               handleCopy(contextMenu.msg?.body);
    if (action === 'delete_for_me')      handleDeleteForMe(contextMenu.msg?.id);
    if (action === 'delete_for_everyone') handleDeleteForEveryone(contextMenu.msg?.id);
    if (action === 'delete_chat')        handleDeleteChat(contextMenu.conv?.otherUserId);
  };

  // ── Visible messages (filter hidden) ─────────────────────────────────────
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
      {/* Context menu bottom sheet */}
      <ContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onAction={handleMenuAction}
      />

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
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{conv.otherUserName}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">{conv.lastMessage}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {conv.unread && <span className="w-2 h-2 bg-primary rounded-full" />}
                      <span className="text-xs text-muted-foreground">{new Date(conv.lastTime).toLocaleDateString()}</span>
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
            <div>
              <h2 className="text-xl font-bold text-foreground">Chat</h2>
              <p className="text-xs text-muted-foreground">{selectedChat.otherUserName}</p>
            </div>
            {/* Delete whole chat from within conversation */}
            <button
              className="ml-auto text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 py-2 px-2 rounded-lg hover:bg-destructive/10"
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

          <div className="space-y-3 mb-4 max-h-[60vh] overflow-y-auto" id="messages-container">
            {chatLoading ? (
              <MessagesSkeleton />
            ) : (
              visibleMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex select-none ${msg.sender_id === user.id ? 'justify-end' : 'justify-start'}`}
                  onContextMenu={(e) => { e.preventDefault(); showMessageMenu(msg); }}
                  onTouchStart={startLongPress(() => showMessageMenu(msg))}
                  onTouchEnd={cancelLongPress}
                  onTouchMove={cancelLongPress}
                >
                  <div className={`max-w-[75%] p-3 rounded-xl ${msg.sender_id === user.id ? 'bg-primary text-primary-foreground' : 'bg-card border border-border/50'}`}>
                    {msg.subject && <p className="text-xs font-medium mb-1">{msg.subject}</p>}
                    <p className="text-sm">{msg.body}</p>
                    <p className="text-[10px] mt-1 opacity-70">{new Date(msg.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          {canMessage ? (
            <div className="border-t border-border pt-4">
              <Input className="mb-2" placeholder="Subject (optional)" value={subject} onChange={(e) => setSubject(e.target.value)} />
              <Textarea placeholder="Type your message…" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} rows={2} className="mb-2" />
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
