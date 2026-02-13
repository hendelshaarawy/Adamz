const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 8080);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET;
const SUPABASE_SIGNED_URL_TTL_SECONDS = Number(process.env.SUPABASE_SIGNED_URL_TTL_SECONDS || 7200);

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

app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true, service: 'adamz-storage-api' });
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
