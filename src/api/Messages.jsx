import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth } from '@/api/supabaseData';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Send, MessageCircle, User, Loader2, Plus, Lock } from 'lucide-react';
import { toast } from 'sonner';

// Skeleton row shown while conversations are loading
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

// Skeleton bubbles shown while a conversation's messages are loading
function MessagesSkeleton() {
  return (
    <div className="space-y-3 mb-4">
      {[{ w: '55%', side: 'end' }, { w: '70%', side: 'start' }, { w: '45%', side: 'end' }, { w: '60%', side: 'start' }].map((s, i) => (
        <div key={i} className={`flex justify-${s.side}`}>
          <div
            className="h-10 rounded-xl bg-muted animate-pulse"
            style={{ width: s.w }}
          />
        </div>
      ))}
    </div>
  );
}

export default function Messages() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlUserId = searchParams.get('userId');

  const [user, setUser] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [loading, setLoading] = useState(false);
  const [newChatEmail, setNewChatEmail] = useState('');
  const [startNewChat, setStartNewChat] = useState(false);

  // Loading states
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [chatLoading, setChatLoading] = useState(false);

  const subscriptionRef = useRef(null);

  // Get current user
  useEffect(() => {
    auth.me().then(setUser).catch(() => {});
  }, []);

  // Fetch all messages and group by conversation, then fetch names
  const fetchConversations = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      if (error) {
        console.error(error);
        return;
      }

      // Collect unique other user IDs
      const otherIds = new Set();
      data.forEach((msg) => {
        const otherId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id;
        otherIds.add(otherId);
      });

      // Fetch names of all other users in one query
      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', Array.from(otherIds));

      if (profileError) console.error(profileError);

      const nameMap = {};
      if (profiles) {
        profiles.forEach((p) => {
          nameMap[p.id] = p.full_name || 'User';
        });
      }

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

      setConversations(Object.values(grouped));
    } catch (err) {
      console.error(err);
    } finally {
      setConversationsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Auto-open chat from URL parameter
  useEffect(() => {
    if (urlUserId && user && user.id !== urlUserId) {
      openChat(urlUserId);
    }
  }, [urlUserId, user]);

  // Real-time subscription
  useEffect(() => {
    if (!user) return;

    const subscription = supabase
      .channel('messages-channel')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `sender_id=eq.${user.id}` },
        (payload) => handleRealtimeMessage(payload.new)
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${user.id}` },
        (payload) => handleRealtimeMessage(payload.new)
      )
      .subscribe();

    subscriptionRef.current = subscription;

    return () => {
      supabase.removeChannel(subscription);
    };
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

  const openChat = async (otherUserId) => {
    if (!user) return;
    setChatLoading(true);

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', otherUserId)
      .single();

    const otherUserName = profile?.full_name || profile?.email || 'User';

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${user.id},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${user.id})`)
      .order('created_at', { ascending: true });

    if (error) {
      console.error(error);
      setChatLoading(false);
      return;
    }

    const unreadIds = data
      .filter((m) => m.receiver_id === user.id && !m.read)
      .map((m) => m.id);

    if (unreadIds.length > 0) {
      await supabase.from('messages').update({ read: true }).in('id', unreadIds);
    }

    setSelectedChat({ otherUserId, otherUserName });
    setMessages(data);
    setChatLoading(false);
  };

  const canMessage = user?.subscription_active && user?.verified;

  const handleSend = async () => {
    if (!newMessage.trim() || !selectedChat) return;
    if (!canMessage) {
      toast.warning('You need an active subscription and verification to send messages');
      return;
    }
    setLoading(true);
    const { error } = await supabase.from('messages').insert([
      {
        sender_id: user.id,
        receiver_id: selectedChat.otherUserId,
        subject: subject || null,
        body: newMessage.trim(),
      },
    ]);

    if (error) {
      toast.error('Failed to send message');
    } else {
      setNewMessage('');
      setSubject('');
    }
    setLoading(false);
  };

  const handleNewChat = async () => {
    if (!newChatEmail.trim()) return;
    if (!canMessage) {
      toast.warning('You need an active subscription and verification to start new conversations');
      return;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('email', newChatEmail.trim())
      .single();

    if (error || !data) {
      toast.error('User not found');
      return;
    }

    if (data.id === user.id) {
      toast.error('Cannot message yourself');
      return;
    }

    openChat(data.id);
    setStartNewChat(false);
    setNewChatEmail('');
  };

  const closeChat = () => {
    setSelectedChat(null);
  };

  if (!user) {
    return (
      <div className="p-4 lg:p-8 max-w-5xl mx-auto pb-20 lg:pb-8">
        <ConversationSkeleton />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto pb-20 lg:pb-8">
      {!selectedChat && (
        <button
          onClick={() => {
            if (window.history.length > 1) navigate(-1);
            else navigate('/');
          }}
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
                if (!canMessage) {
                  toast.warning('Subscribe and get verified to start new conversations');
                  return;
                }
                setStartNewChat(!startNewChat);
              }}
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <Plus className="w-4 h-4" /> New
            </button>
          </div>

          {startNewChat && (
            <div className="mb-4 flex gap-2">
              <Input
                placeholder="Enter email address"
                value={newChatEmail}
                onChange={(e) => setNewChatEmail(e.target.value)}
              />
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
                  className={`p-4 cursor-pointer hover:bg-accent transition-colors ${conv.unread ? 'border-primary' : 'border-border/50'}`}
                  onClick={() => openChat(conv.otherUserId)}
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
                      {conv.unread && <span className="w-2 h-2 bg-primary rounded-full"></span>}
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
          </div>

          <div className="space-y-3 mb-4 max-h-[60vh] overflow-y-auto" id="messages-container">
            {chatLoading ? (
              <MessagesSkeleton />
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.sender_id === user.id ? 'justify-end' : 'justify-start'}`}>
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
