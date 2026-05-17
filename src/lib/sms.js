import { supabase } from '@/api/supabaseClient';

/**
 * Send an SMS via the Supabase Edge Function.
 * @param {string} phoneNumber - recipient's phone number in international format, e.g. '+27812345678'
 * @param {string} message - the SMS body
 * @returns {Promise<{success: boolean, data?: any, error?: any}>}
 */
export async function sendSMS(phoneNumber, message) {
  if (!phoneNumber || !message) {
    console.error('SMS helper called without phoneNumber or message');
    return { success: false, error: 'Missing parameters' };
  }

  const { data, error } = await supabase.functions.invoke('send-sms', {
    body: { to: phoneNumber, message },
  });

  if (error) {
    console.error('SMS failed:', error);
    return { success: false, error };
  }

  return { success: true, data };
}