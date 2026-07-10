// TEMPORARY diagnostic tool — safe to delete once the payment redirect
// issue is fully resolved. Lets us see what's happening on-device without
// needing USB debugging / ADB access at all.
if (typeof window !== 'undefined' && !window.__skootlinkDebugLog) {
  window.__skootlinkDebugLog = [];
}

export function dlog(msg) {
  if (typeof window === 'undefined') return;
  const entry = { t: new Date().toLocaleTimeString(), msg: String(msg) };
  window.__skootlinkDebugLog.push(entry);
  if (window.__skootlinkDebugLog.length > 150) window.__skootlinkDebugLog.shift();
  window.dispatchEvent(new CustomEvent('skootlink:debuglog'));
}

export function getDebugLog() {
  return (typeof window !== 'undefined' && window.__skootlinkDebugLog) || [];
}

export function clearDebugLog() {
  if (typeof window === 'undefined') return;
  window.__skootlinkDebugLog = [];
  window.dispatchEvent(new CustomEvent('skootlink:debuglog'));
}
