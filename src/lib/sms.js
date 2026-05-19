import { supabase } from '@/api/supabaseData';

/**
 * Normalise any South African phone number to E.164 (+27XXXXXXXXX).
 * Handles: +27XXXXXXXXX, 27XXXXXXXXX, 0XXXXXXXXX (10-digit local), plain 9-digit.
 */
function normaliseSAPhone(raw) {
  if (!raw) return raw;
  const digits = String(raw).replace(/\D/g, '');
  if (raw.startsWith('+') && digits.length >= 10) return raw;
  if (digits.startsWith('27') && digits.length === 11)  return '+' + digits;
  if (digits.startsWith('0')  && digits.length === 10)  return '+27' + digits.slice(1);
  if (digits.length === 9)                               return '+27' + digits;
  return raw;
}

/**
 * Send an SMS via the Supabase Edge Function `send-sms`.
 * Never throws — always returns { success, data?, error? }.
 */
export async function sendSMS(phoneNumber, message) {
  if (!phoneNumber || !message) {
    console.warn('[SMS] sendSMS called without phoneNumber or message — skipped');
    return { success: false, error: 'Missing parameters' };
  }

  const normalisedPhone = normaliseSAPhone(phoneNumber);

  try {
    const { data, error } = await supabase.functions.invoke('send-sms', {
      body: { to: normalisedPhone, message },
    });

    if (error) {
      console.error('[SMS] Edge function error:', error);
      return { success: false, error };
    }

    console.log('[SMS] Sent to', normalisedPhone, '— id:', data?.messageId);
    return { success: true, data };
  } catch (err) {
    console.error('[SMS] Unexpected error:', err);
    return { success: false, error: err };
  }
}
