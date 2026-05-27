/**
 * requireVerified — call at the top of any action that requires identity verification
 * (sending messages, submitting proposals, contacting owners/drivers, etc.)
 *
 * Usage:
 *   import { requireVerified } from '@/lib/requireVerified';
 *   ...
 *   const handleSendMessage = async () => {
 *     if (!requireVerified(user, navigate)) return;
 *     // proceed with action
 *   };
 */

/**
 * @param {object|null} user  — the current user object from auth.me()
 * @param {function}    navigate — React Router's navigate function
 * @param {function}    [toast]  — optional toast.error function for the message
 * @returns {boolean} true if verified, false if blocked
 */
export function requireVerified(user, navigate, toast) {
  if (!user) {
    navigate?.('/auth');
    return false;
  }
  if (!user.verified) {
    const notify = toast || window.__toastError;
    if (notify) {
      notify(
        'You must verify your identity before contacting other users. Go to Settings → Plan to complete verification.',
        { duration: 5000 }
      );
    }
    navigate?.('/settings');
    return false;
  }
  return true;
}
