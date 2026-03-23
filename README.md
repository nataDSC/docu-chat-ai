# DocuChat AI

Static frontend for uploads, chat, transcript extraction, transcript history, Supabase auth, and Stripe Pro upgrades.

## Architecture

- Frontend: static HTML, CSS, and vanilla JS
- Auth and data: Supabase
- Billing API: local Node server for development or Netlify Functions for deployment
- Youtube transcript extraction: rapidapi with its Youtube Transcript API
- Workflows: n8n webhooks for upload, chat, and transcript extraction

## Local run

Install dependencies:

```bash
npm install
```

Start the billing API in one terminal:

```bash
npm run start:billing
```

Start the static site in another terminal:

```bash
python3 -m http.server 8080
```

Open:

- http://localhost:8080/index.html
- http://localhost:8080/login.html
- http://localhost:8080/signup.html

Local development uses:

- `APP_ENVIRONMENTS.local` in `supabase-config.js` for local n8n and billing URLs
- `.env` for Stripe and Supabase server-side secrets

Example `.env` values for local billing:

```env
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
BILLING_PORT=4242
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

For local Stripe webhook forwarding:

```bash
stripe listen --forward-to localhost:4242/api/stripe-webhook
```

## Free local transcript service (replace RapidAPI)

If you hit RapidAPI limits, run a free local transcript service and point your local n8n transcript flow to it.

### Option A: run with Python directly

### 1) Start local transcript service

Install Python dependencies:

```bash
python3 -m pip install -r requirements-transcript-service.txt
```

Run service:

```bash
python3 local_transcript_service.py --port 5055
```

Health check:

```bash
curl -s http://localhost:5055/health
```

### 2) Update n8n transcript workflow

In your n8n transcript workflow, replace the RapidAPI call with an HTTP Request node:

- Method: `POST`
- URL (n8n running in Docker Desktop on Mac): `http://host.docker.internal:5055/transcript`
- URL (n8n running directly on host): `http://localhost:5055/transcript`
- Send Body: JSON
- Body fields:
	- `videoUrl`: `{{$json.videoUrl || $json.video_url || $json.url}}`
	- Optional `languages`: `en,en-US`

Expected response shape:

```json
{
	"ok": true,
	"videoId": "dQw4w9WgXcQ",
	"transcript": "...",
	"lineCount": 123,
	"languagesRequested": ["en", "en-US"]
}
```

Use `transcript` from the response as your downstream text output.

### 3) Keep deployed app unchanged

No frontend change is required. Your app still calls n8n webhook endpoints; only the n8n internal transcript step changes.

### Option B (recommended): run transcript service in Docker

This removes the need to keep a separate Python process running manually.

Build and run transcript service container:

```bash
docker build -f Dockerfile.transcript-service -t local-transcript-service .
docker run -d --name transcript-service -p 5055:5055 local-transcript-service
```

If your n8n is also running in Docker Desktop, keep the n8n HTTP Request URL as:

- `http://host.docker.internal:5055/transcript`

If you want Docker to manage both n8n and transcript service together, use:

```bash
docker compose -f docker-compose.local-ai.yml up -d --build
```

Then set the n8n HTTP Request URL to:

- `http://transcript-service:5055/transcript`

Stop stack:

```bash
docker compose -f docker-compose.local-ai.yml down
```

### Optional n8n fail-fast health check pattern

To fail early with a clear message when transcript service is unavailable, add this step before your transcript request node:

- Node: `HTTP Request`
- Name: `Transcript Service Health`
- Method: `GET`
- URL (compose stack): `http://transcript-service:5055/health`
- Response format: `JSON`
- Continue On Fail: `false`

Then connect:

- `Transcript Service Health` -> `Fetch Transcript`

If health check fails, n8n stops at that node and your webhook returns a clear upstream error instead of a vague empty transcript response.

## Netlify deploy

This repo now includes:

- `netlify.toml` to publish the site and route `/api/*` to a Netlify function
- `netlify/functions/api.js` for Stripe checkout, Stripe webhooks, plan sync, and transcript history endpoints

### 1) Update public config

Edit `supabase-config.js` before deploying:

- Keep `SUPABASE_ENVIRONMENTS.cloud` pointed at your production Supabase project
- Set `APP_ENVIRONMENTS.deployed.uploadWebhookUrl` to your public n8n upload webhook
- Set `APP_ENVIRONMENTS.deployed.chatWebhookUrl` to your public n8n chat webhook
- Set `APP_ENVIRONMENTS.deployed.transcriptWebhookUrl` to your public n8n transcript webhook
- Optional: set `APP_ENVIRONMENTS.deployed.*FallbackUrl` values for tunnel failover (ngrok/cloudflared)
- Set `window.BILLING_CONFIG.proPriceId` to your Stripe recurring price id

Leave `billingApiBaseUrl` empty for deployed mode. An empty value makes the frontend use same-origin Netlify Functions at `/api/*`.

### Optional: tunnel failover mode

If your primary cloud n8n endpoint is unavailable, the app can try tunnel URLs automatically.

In `supabase-config.js` under `APP_ENVIRONMENTS.deployed`, set:

- `uploadWebhookUrl`, `chatWebhookUrl`, `transcriptWebhookUrl`: primary cloud endpoints
- `uploadWebhookFallbackUrl`, `chatWebhookFallbackUrl`, `transcriptWebhookFallbackUrl`: optional tunnel endpoints

Example fallback values:

```js
uploadWebhookFallbackUrl: "https://your-tunnel-domain/webhook/upload",
chatWebhookFallbackUrl: "https://your-tunnel-domain/webhook/chat",
transcriptWebhookFallbackUrl: "https://your-tunnel-domain/webhook/fetch",
```

Runtime behavior:

- App tries primary URL first
- If it fails, app tries fallback URL
- For each URL, app also auto-tries `/webhook/*` and `/webhook-test/*` variants

### 2) Add Netlify environment variables

In Netlify site settings, add:

```env
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 3) Deploy the site

Deploy this folder to Netlify.

Netlify settings:

- Publish directory: `.`
- Functions directory: `netlify/functions`
- Build command: leave empty

### 4) Point Stripe webhooks at Netlify

In Stripe Dashboard, create a webhook endpoint at:

- `https://<your-netlify-site>/api/stripe-webhook`

Subscribe it to at least:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

### 5) Validate production

- Sign up or log in
- Test upload, chat, and transcript actions against your hosted n8n webhooks
- Reach the free limit and complete Stripe Checkout
- Refresh and sign back in to confirm the Pro plan persists

## Release checklist

Run this checklist before each production deploy:

- Sync n8n changes from local workflow(s) to cloud workflow(s)
- Confirm each cloud workflow is Published/Active
- Verify cloud webhook paths still match `APP_ENVIRONMENTS.deployed` in `supabase-config.js`
- Confirm transcript flow uses create/upsert behavior for new users (not update-only path)
- Redeploy Netlify from the latest GitHub commit
- Run a quick smoke test with both a new user and an existing user

Quick smoke test:

- New user: sign up -> upload -> chat -> transcript -> history
- Existing user: log in -> transcript again -> history shows multiple entries
- Billing: upgrade flow -> return to app -> log out/in -> plan persists

## Supabase tables

Create table `user_plans` in Supabase SQL editor:

```sql
create table if not exists public.user_plans (
	user_id uuid primary key references auth.users(id) on delete cascade,
	plan text not null check (plan in ('free', 'pro')),
	updated_at timestamptz not null default now()
);
```

The billing API updates this table after successful Stripe checkout verification or subscription lifecycle webhook events.
The app reads this plan at login and applies it automatically.

Transcript history note:

- After each successful transcript extraction, the web app appends a new row through the billing API (`/api/append-transcript-history`) into a dedicated `transcript_history` table so history keeps all runs instead of being affected by n8n writes to `transcripts`.
- The history tab reads through billing API endpoint `/api/get-transcript-history` and treats `transcript_history` as the source of truth.
- Empty or failed transcript runs can be stored separately through `/api/append-transcript-failure` so they do not pollute the main `transcripts` table.

Create table `transcript_history` in Supabase SQL editor:

```sql
create table if not exists public.transcript_history (
	id uuid primary key,
	user_id uuid not null references auth.users(id) on delete cascade,
	video_url text not null,
	transcript text not null,
	payload_json jsonb null,
	created_at timestamptz not null default now()
);

create index if not exists idx_transcript_history_user_created_at
on public.transcript_history (user_id, created_at desc);
```

Optional transcript failure audit table:

```sql
create table if not exists public.transcript_failures (
	id uuid primary key,
	user_id uuid not null references auth.users(id) on delete cascade,
	video_url text not null,
	failure_reason text not null,
	raw_response text null,
	created_at timestamptz not null default now()
);
```

Optional audit table for subscription lifecycle debugging:

```sql
create table if not exists public.billing_events (
	event_id text primary key,
	event_type text not null,
	user_id uuid null references auth.users(id) on delete set null,
	derived_plan text null check (derived_plan in ('free', 'pro')),
	payload jsonb not null,
	created_at timestamptz not null default now()
);
```

## Behavior

- Accepts only `.txt`, `.pdf`, `.csv`
- Sends the selected file as `multipart/form-data`
- Uses form field name: `file`
- Also sends metadata fields: `filename`, `size`, `mimeType`, `extension`, `uploadedAt`
- Shows success or error status after upload, chat, transcript, and history actions
- Requires an authenticated Supabase session on `index.html`
- Displays the logged-in user name and current plan tier
- Includes a `Log out` button that signs out and redirects to `login.html`

## Supabase auth pages

This project includes:

- `login.html` for existing users
- `signup.html` for new account creation
- `auth.js` shared auth logic
- `supabase-config.js` for public Supabase and webhook configuration

### Configure Supabase

Open `supabase-config.js` and set:

- `activeEnvironment` to `"local"` or `"cloud"`
- `SUPABASE_ENVIRONMENTS.local` values for local stack
- `SUPABASE_ENVIRONMENTS.cloud` values for cloud project

This lets you switch Supabase projects without changing the deployment-specific webhook and billing settings.

After configuring, open:

- `http://localhost:8080/signup.html` to create account
- `http://localhost:8080/login.html` to log in

Link to the public deployment of the application: [ DocuChatAI ](https://aquamarine-beijinho-44b1d1.netlify.app/)
