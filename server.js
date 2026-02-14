const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 8080);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET;
const SUPABASE_SIGNED_URL_TTL_SECONDS = Number(process.env.SUPABASE_SIGNED_URL_TTL_SECONDS || 7200);
const HISTORY_USERNAME = process.env.HISTORY_USERNAME || '';
const HISTORY_PASSWORD = process.env.HISTORY_PASSWORD || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

if (!SUPABASE_URL) {
  throw new Error('Missing required environment variable: SUPABASE_URL');
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
}

if (!SUPABASE_BUCKET) {
  throw new Error('Missing required environment variable: SUPABASE_BUCKET');
}

const supabaseBaseUrl = SUPABASE_URL.replace(/\/$/, '');

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('CORS blocked for this origin'));
    }
  })
);

const supabase = createClient(supabaseBaseUrl, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true, service: 'adamz-storage-api' });
});

app.get('/history/auth-check', (req, res) => {
  if (!HISTORY_USERNAME || !HISTORY_PASSWORD) {
    return res.status(503).json({ error: 'History credentials are not configured.' });
  }

  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.slice('Basic '.length).trim();
  let decoded = '';
  try {
    decoded = Buffer.from(token, 'base64').toString('utf8');
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const separatorIndex = decoded.indexOf(':');
  const username = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : '';
  const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';

  if (username !== HISTORY_USERNAME || password !== HISTORY_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return res.status(200).json({ ok: true });
});

app.post('/payments/create-checkout-session', async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });

    const { transactionId, successUrl, cancelUrl } = req.body || {};
    if (!transactionId || !successUrl || !cancelUrl) {
      return res.status(400).json({ error: 'transactionId, successUrl, and cancelUrl are required.' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: 500,
            product_data: { name: 'ADAMZ Single Upload Analysis' }
          }
        }
      ],
      metadata: { transactionId },
      success_url: successUrl,
      cancel_url: cancelUrl
    });

    return res.status(200).json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (error) {
    console.error('create-checkout-session error:', error);
    return res.status(500).json({ error: 'Unable to create checkout session.' });
  }
});

app.get('/payments/confirm-session', async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });

    const sessionId = String(req.query.sessionId || '');
    const transactionId = String(req.query.transactionId || '');
    if (!sessionId || !transactionId) {
      return res.status(400).json({ error: 'sessionId and transactionId are required.' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paid = session.payment_status === 'paid' && session.metadata?.transactionId === transactionId;

    return res.status(200).json({
      paid,
      transactionId,
      sessionId,
      paymentStatus: session.payment_status || 'unpaid'
    });
  } catch (error) {
    console.error('confirm-session error:', error);
    return res.status(500).json({ error: 'Unable to confirm payment session.' });
  }
});

app.post('/storage/create-upload', async (req, res) => {
  try {
    const { transactionId, fileName, contentType } = req.body || {};

    if (!transactionId || !fileName || !contentType) {
      return res.status(400).json({ error: 'transactionId, fileName, and contentType are required.' });
    }

    const safeTx = String(transactionId).replace(/[^a-zA-Z0-9-_]/g, '_');
    const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectPath = `transactions/${safeTx}/${Date.now()}-${safeName}`;

    const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).createSignedUploadUrl(objectPath);

    if (error || !data?.signedUrl) {
      console.error('createSignedUploadUrl error:', error);
      return res.status(500).json({ error: 'Unable to create signed upload URL.' });
    }

    const uploadUrl = data.signedUrl.startsWith('http')
      ? data.signedUrl
      : `${supabaseBaseUrl}${data.signedUrl.startsWith('/') ? '' : '/'}${data.signedUrl}`;

    const publicUrl = `${supabaseBaseUrl}/storage/v1/object/public/${encodeURIComponent(SUPABASE_BUCKET)}/${encodeURI(objectPath)}`;

    return res.status(200).json({
      uploadUrl,
      publicUrl,
      objectPath,
      expiresInSeconds: SUPABASE_SIGNED_URL_TTL_SECONDS
    });
  } catch (error) {
    console.error('create-upload error:', error);
    return res.status(500).json({ error: 'Unable to create signed upload URL.' });
  }
});

app.listen(PORT, () => {
  console.log(`ADAMZ storage API listening on port ${PORT}`);
});
