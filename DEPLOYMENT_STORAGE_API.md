# ADAMZ Storage API (Supabase Storage Signed Upload URLs)

This project includes a Node/Express endpoint:

- `POST /storage/create-upload`

It returns:

- `uploadUrl` (signed upload target)
- `publicUrl` (stable link for later download)
- `objectPath`
- `expiresInSeconds`

---

## Step-by-step: set up Supabase Storage

## 1) Create a Supabase project

1. Go to [https://supabase.com](https://supabase.com) and create/sign in to your account.
2. Create a new project.
3. Wait for project provisioning to complete.

## 2) Create a storage bucket

1. In Supabase dashboard, open **Storage**.
2. Click **Create bucket**.
3. Name it (example: `adamz-artifacts`).
4. Set visibility to **Public** (recommended for direct artifact links).

> Use this bucket name as `SUPABASE_BUCKET` in your backend.

> If you need private artifacts, keep it private and return short-lived signed *download* URLs from backend instead of `publicUrl`.

## 3) Exactly where to copy `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

In Supabase dashboard:

1. Open your project.
2. Click the **gear icon (Project Settings)** in the left sidebar.
3. Click **API**.
4. Copy **Project URL** → this is your `SUPABASE_URL`.
5. In the same API page, under **Project API keys**, copy **service_role** key → this is your `SUPABASE_SERVICE_ROLE_KEY`.

Quick mapping:

- `SUPABASE_URL` = `https://<project-ref>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = long secret JWT from **service_role** row
- `SUPABASE_BUCKET` = bucket name you created in Storage (example `adamz-artifacts`)

⚠️ Never put `SUPABASE_SERVICE_ROLE_KEY` in frontend code (`upload.js` / `upload.html`).

## 4) Exactly where to set backend environment variables

You set these on the server/runtime that runs `node server.js` (not in Supabase dashboard, and not in frontend files).

Required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_BUCKET`

Optional:

- `PORT` (default `8080`)
- `ALLOWED_ORIGINS` (comma-separated, use `*` only for quick testing)
- `SUPABASE_SIGNED_URL_TTL_SECONDS` (response metadata; default `7200`)

### Beginner quick path (recommended)

1. Open terminal in this project folder.
2. Create a `.env` file with your values:

```bash
cat > .env << 'ENVVARS'
PORT=8080
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_BUCKET=adamz-artifacts
ALLOWED_ORIGINS=http://localhost:4173
SUPABASE_SIGNED_URL_TTL_SECONDS=7200
ENVVARS
```

3. Load vars into your current shell and run server:

```bash
set -a
source .env
set +a
node server.js
```

If server starts, your env vars are set correctly.

### Windows PowerShell (if `cat` fails)

If you get `'cat' is not recognized`, use PowerShell:

```powershell
@"
PORT=8080
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_BUCKET=adamz-artifacts
ALLOWED_ORIGINS=http://localhost:4173
SUPABASE_SIGNED_URL_TTL_SECONDS=7200
"@ | Set-Content -Path .env

Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  $name, $value = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($name, $value, 'Process')
}

node server.js
```

### Windows Command Prompt (cmd.exe)

Create `.env` manually in Notepad in your project folder, then run:

```bat
for /f "tokens=1,* delims==" %a in (.env) do @set %a=%b
node server.js
```

> In a `.bat` file, use `%%a` and `%%b` instead of `%a` and `%b`.

### Option A: local terminal inline vars (no `.env` file)

```bash
PORT=8080 \
SUPABASE_URL=https://your-project-id.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
SUPABASE_BUCKET=adamz-artifacts \
ALLOWED_ORIGINS=http://localhost:4173 \
node server.js
```

### Option B: hosting dashboards (production)

Use the provider's environment/secrets page and add the same keys.

- **Render**: Service → **Environment** → add variables → Save/Reploy.
- **Railway**: Project → Service → **Variables** → add variables.
- **Fly.io**:

```bash
fly secrets set \
  SUPABASE_URL=https://your-project-id.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  SUPABASE_BUCKET=adamz-artifacts \
  ALLOWED_ORIGINS=https://your-frontend-domain.com
```

- **Cloud Run** (example):

```bash
gcloud run deploy adamz-storage-api \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars SUPABASE_URL=https://your-project-id.supabase.co,SUPABASE_SERVICE_ROLE_KEY=your-service-role-key,SUPABASE_BUCKET=adamz-artifacts,ALLOWED_ORIGINS=https://your-frontend-domain.com
```

## 5) Install and run the API

```bash
npm install
PORT=8080 \
SUPABASE_URL=https://your-project-id.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
SUPABASE_BUCKET=adamz-artifacts \
ALLOWED_ORIGINS=http://localhost:4173 \
node server.js
```

Health check:

```bash
curl http://localhost:8080/healthz
```

Expected:

```json
{"ok":true,"service":"adamz-storage-api"}
```

## 6) Test signing endpoint manually

```bash
curl -X POST http://localhost:8080/storage/create-upload \
  -H 'Content-Type: application/json' \
  -d '{"transactionId":"TX-123","fileName":"sales_cleaned.csv","contentType":"text/csv"}'
```

Expected JSON shape:

```json
{
  "uploadUrl": "https://<project>.supabase.co/storage/v1/object/upload/sign/...",
  "publicUrl": "https://<project>.supabase.co/storage/v1/object/public/adamz-artifacts/transactions/TX-123/...csv",
  "objectPath": "transactions/TX-123/...csv",
  "expiresInSeconds": 7200
}
```

## 7) Wire frontend to the backend

In `upload.html` you can set:

```html
<script>
  window.ADAMZ_STORAGE_API = "https://your-storage-api.example.com";
</script>
```

Or, in the Upload page UI, paste your Storage API URL in **Storage API URL** and click **Save Storage API URL** (it is stored in browser localStorage).

The frontend flow already implemented in `upload.js`:

1. Calls `POST /storage/create-upload`.
2. Receives `uploadUrl` + `publicUrl`.
3. Uploads bytes using `PUT uploadUrl`.
4. Saves `publicUrl` in transaction artifacts for later download.

## 8) Deploy backend

Deploy this Node API to Render/Railway/Fly.io/VPS/Cloud Run and set environment variables from step 4.

After deployment, set:

- `window.ADAMZ_STORAGE_API = "https://<your-api-url>"`

in your frontend production page.

---


## Troubleshooting: `failed to read dockerfile: open Dockerfile: no such file or directory`

This means your platform is trying to build with Docker, but the repo had no `Dockerfile`.

This project now includes a root `Dockerfile` and `.dockerignore`.

Try again with one of these approaches:

1. **Docker deploy mode** (Render/Railway/etc.): redeploy from repo root.
2. **Native Node deploy mode**: set build `npm install` and start `node server.js` / `npm start`.

Local Docker test:

```bash
docker build -t adamz-storage-api .
docker run --rm -p 8080:8080   -e SUPABASE_URL=https://your-project-id.supabase.co   -e SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   -e SUPABASE_BUCKET=adamz-artifacts   -e ALLOWED_ORIGINS=http://localhost:4173   adamz-storage-api
```

Then verify:

```bash
curl http://localhost:8080/healthz
```

---

## Troubleshooting: `Failed to fetch` in Upload UI

If the Upload page shows `Failed to fetch`, the browser could not reach the Storage API endpoint.

Check these items in order:

1. Confirm Storage API URL is set correctly in Upload page (or `window.ADAMZ_STORAGE_API`).
2. Open `<STORAGE_API_URL>/healthz` in browser. It should return JSON like `{"ok":true,...}`.
3. Ensure backend server is running (`node server.js`) and accessible from your frontend origin.
4. Set `ALLOWED_ORIGINS` on backend to include your frontend URL (for example `http://localhost:4173`).
5. If using HTTPS frontend, use HTTPS Storage API URL (mixed content can block requests).

Quick check with curl:

```bash
curl https://your-storage-api.example.com/healthz
```

If health fails, fix backend deployment/runtime first, then retry upload.

---

## Troubleshooting: `Cannot find module 'express'`

If you see:

```
Error: Cannot find module 'express'
```

it means project dependencies are not installed in the folder where you run `node server.js`.

Fix steps:

1. Open terminal in the same folder as `server.js` and `package.json`.
2. Run:

```bash
npm install
```

3. Verify dependencies are installed:

```bash
npm ls express
```

4. Start server again:

```bash
node server.js
```

Windows tip (path in your error was `E:\adams\dataglow\server.js`):

```bat
cd /d E:\adams\dataglow
npm install
node server.js
```

If it still fails, remove lockfile/modules and reinstall:

```bash
rm -rf node_modules package-lock.json
npm install
```

On Windows Command Prompt use:

```bat
rmdir /s /q node_modules
del package-lock.json
npm install
```

## Troubleshooting: Supabase UI error

If Supabase Storage page shows:

- `Failed to retrieve buckets`
- `Error: {}`

this is usually a temporary dashboard/API issue, browser blocking, or project setup mismatch.

Try this in order:

1. Hard refresh the browser tab (Ctrl/Cmd+Shift+R).
2. Open Supabase in incognito/private window.
3. Disable ad-block/privacy extensions for `supabase.com`.
4. Try another browser.
5. Confirm project region/service status in Supabase status page.
6. Wait 5–10 minutes after project creation (initial provisioning can lag).

If dashboard still fails, verify Storage API directly with your **service role key**:

```bash
curl -sS "https://<project-ref>.supabase.co/storage/v1/bucket" \
  -H "apikey: <service-role-key>" \
  -H "Authorization: Bearer <service-role-key>"
```

- If this returns bucket JSON, the backend can still work even when dashboard is flaky.
- If it returns auth/permission errors, re-check project URL and service role key.

You can also create the bucket via API (without dashboard):

```bash
curl -sS -X POST "https://<project-ref>.supabase.co/storage/v1/bucket" \
  -H "apikey: <service-role-key>" \
  -H "Authorization: Bearer <service-role-key>" \
  -H "Content-Type: application/json" \
  -d '{"id":"adamz-artifacts","name":"adamz-artifacts","public":true}'
```

Then retry your local endpoint test (`POST /storage/create-upload`).

If issue persists for a long time, contact Supabase support and include:

- project ref
- approximate timestamp
- browser + version
- screenshot/error text

---

## Security notes

- Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser code.
- Keep strict `ALLOWED_ORIGINS` in production.
- Sanitize storage object paths (already handled in `server.js`).
