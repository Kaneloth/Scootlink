/**
 * requireVerified — call at the top of any action that involves interacting
 * with another user: sending messages, replying to messages, submitting or
 * responding to proposals, contacting owners/drivers, etc.
 *
 * Searching for vehicles and listing vehicles do NOT require this gate.
 *
 * Rules:
 *  - User must be identity-verified (profiles.verified = true)
 *  - User must have an active subscription (profiles.subscription_active = true)
 *  Both conditions are enforced together because subscription requires verification.
 *
 * Usage:
 *   import { requireVerified } from '@/lib/requireVerified';
 *   ...
 *   const handleSendMessage = async () => {
 *     if (!requireVerified(user, navigate, toast.error)) return;
 *     // proceed
 *   };
 */

/**
 * @param {object|null} user      — current user object from auth.me()
 * @param {function}    navigate  — React Router navigate function
 * @param {function}    [toastFn] — optional toast.error / toast function
 * @returns {boolean} true if allowed, false if blocked
 */
export function requireVerified(user, navigate, toastFn) {
  const notify = toastFn || (() => {});

  if (!user) {
    navigate?.('/auth');
    return false;
  }

  if (!user.verified) {
    notify(
      'You need to verify your identity before you can contact other users. ' +
      'Go to Settings → Plan to complete verification and subscribe.',
      { duration: 6000 }
    );
    navigate?.('/settings');
    return false;
  }

  if (!user.subscription_active) {
    notify(
      'An active subscription is required to contact other users. ' +
      'Go to Settings → Plan to subscribe.',
      { duration: 6000 }
    );
    navigate?.('/settings');
    return false;
  }

  return true;
}
