import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { AppUpdate, AppUpdateAvailability, FlexibleUpdateInstallStatus } from '@capawesome/capacitor-app-update';
import { RefreshCw, X } from 'lucide-react';

/**
 * AppUpdateBanner
 * Checks once per app session for a newer Play Store version and, if a
 * flexible update is available, downloads it in the background. Once the
 * download finishes, shows a small banner letting the user restart to
 * apply it — they're never blocked or interrupted before that.
 *
 * Android only — flexible in-app updates are a Play Core feature with no
 * iOS/web equivalent, so this silently does nothing anywhere else.
 *
 * Mount this once near the root of the app (e.g. alongside <Toaster />),
 * not per-page — its check only needs to run once per session.
 */
export default function AppUpdateBanner() {
  const [updateReady, setUpdateReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

    let cancelled = false;
    let listenerHandle;

    (async () => {
      try {
        listenerHandle = await AppUpdate.addListener('onFlexibleUpdateStateChange', (state) => {
          if (state.installStatus === FlexibleUpdateInstallStatus.DOWNLOADED) {
            setUpdateReady(true);
          }
        });

        const info = await AppUpdate.getAppUpdateInfo();
        if (cancelled) return;

        if (info.updateAvailability === AppUpdateAvailability.UPDATE_AVAILABLE && info.flexibleUpdateAllowed) {
          await AppUpdate.startFlexibleUpdate();
        }
      } catch (err) {
        // Non-fatal by design — worst case the user just updates via the
        // Play Store the normal way, same as before this existed.
        console.warn('[AppUpdateBanner] Could not check/start flexible update:', err);
      }
    })();

    return () => {
      cancelled = true;
      listenerHandle?.remove().catch(() => {});
    };
  }, []);

  const handleRestart = async () => {
    try {
      await AppUpdate.completeFlexibleUpdate();
    } catch (err) {
      console.error('[AppUpdateBanner] completeFlexibleUpdate failed:', err);
    }
  };

  if (!updateReady || dismissed) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-[400] bg-primary text-primary-foreground rounded-xl shadow-lg p-3 flex items-center gap-3">
      <RefreshCw className="w-4 h-4 shrink-0" />
      <p className="text-sm flex-1">An update has finished downloading.</p>
      <button
        onClick={handleRestart}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors shrink-0"
      >
        Restart
      </button>
      <button onClick={() => setDismissed(true)} className="shrink-0" aria-label="Dismiss">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
