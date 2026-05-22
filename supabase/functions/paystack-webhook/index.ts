import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PAYSTACK_SECRET_KEY  = Deno.env.get('PAYSTACK_SECRET_KEY')  ?? '';
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')         ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Verify Paystack HMAC-SHA512 using the built-in Web Crypto API (no external lib).
async function verifySignature(body: string, signature: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(PAYSTACK_SECRET_KEY),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const expected = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return expected === signature;
}

// Keep profiles.wallet_balance in ZAR so the rest of the app shows the correct
// balance without needing a separate wallets query on every page load.
async function syncProfileBalance(userId: string): Promise<void> {
  try {
    const { data } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle();
    if (!data) return;
    await supabase
      .from('profiles')
      .update({ wallet_balance: data.balance / 100 })
      .eq('id', userId);
  } catch (e) {
    console.error('syncProfileBalance error:', String(e));
  }
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body      = await req.text();
    const signature = req.headers.get('x-paystack-signature') ?? '';
    const valid     = await verifySignature(body, signature);

    if (!valid) {
      console.error('Invalid Paystack signature');
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { event, data } = JSON.parse(body);
    console.log('[paystack-webhook] event:', event);

    switch (event) {

      // Successful card / EFT top-up
      case 'charge.success': {
        const userId    = data?.metadata?.user_id as string | undefined;
        const amount    = data?.amount as number;
        const reference = data?.reference as string;

        if (!userId) {
          console.error('charge.success: user_id missing from metadata');
          break;
        }

        const { error } = await supabase.rpc('add_funds', {
          p_user_id:   userId,
          p_amount:    amount,
          p_reference: reference,
        });

        if (error) {
          console.error('add_funds failed:', error.message);
        } else {
          console.log('Wallet topped up for user', userId, '- amount (cents):', amount);
          await syncProfileBalance(userId);
        }
        break;
      }

      // Bank transfer payout succeeded
      case 'transfer.success': {
        // The transaction UUID was stored as the transfer `reason` field
        // in paystack-withdraw.js — NOT data.reference (which is Paystack's own ref).
        const txId = data?.reason as string | undefined;

        if (!txId) {
          console.error('transfer.success: data.reason (transaction UUID) is missing');
          break;
        }

        const { error } = await supabase.rpc('withdraw_complete', {
          p_transaction_id: txId,
        });

        if (error) {
          console.error('withdraw_complete failed:', error.message);
        } else {
          console.log('Withdrawal completed - tx:', txId);
        }
        break;
      }

      // Bank transfer failed or reversed - refund the wallet
      case 'transfer.failed':
      case 'transfer.reversed': {
        const txId   = data?.reason as string | undefined;
        const fromId = data?.recipient?.metadata?.user_id as string | undefined;

        if (!txId) {
          console.error(event + ': data.reason (transaction UUID) is missing');
          break;
        }

        const { error } = await supabase.rpc('withdraw_fail', {
          p_transaction_id: txId,
        });

        if (error) {
          console.error('withdraw_fail failed:', error.message);
        } else {
          console.log('Withdrawal refunded - tx:', txId);
          if (fromId) await syncProfileBalance(fromId);
        }
        break;
      }

      default:
        console.log('Unhandled Paystack event:', event);
    }

    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[paystack-webhook] fatal error:', msg);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
event}: missing reason (transaction UUID)`);
          break;
        }

        const { error } = await supabase.rpc('withdraw_fail', {
          p_transaction_id: txId,
        });

        if (error) {
          console.error('withdraw_fail failed:', error.message);
        } else {
          console.log(`Withdrawal refunded — tx: ${txId}`);
          if (fromId) await syncProfileBalance(fromId);
        }
        break;
      }

      default:
        console.log(`Unhandled event: ${event}`);
    }

    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[paystack-webhook] Error:', msg);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
