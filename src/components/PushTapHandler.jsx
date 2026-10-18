// src/components/PushTapHandler.jsx
//
// Opens the right screen when the user taps a push notification (Android app
// only). Rendered inside <Router> in App.jsx so it can navigate; the push
// registration itself stays in App.jsx.
//
// The Capacitor push plugin keeps a tap that launched the app until a
// listener is added, so cold starts from a notification are handled too.
// Destinations come from routeForNotification (shared with the bell).

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { routeForNotification } from '@/lib/notificationLinks';

export default function PushTapHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let handle = null;
    let cancelled = false;

    (async () => {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const h = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          const data = action?.notification?.data || {};
          const route = routeForNotification(data.type, data);
          if (route) navigate(route);
        });
        if (cancelled) h.remove(); else handle = h;
      } catch (err) {
        console.error('[PushTapHandler] could not listen for push taps:', err);
      }
    })();

    return () => {
      cancelled = true;
      if (handle) handle.remove();
    };
  }, [navigate]);

  return null;
}
