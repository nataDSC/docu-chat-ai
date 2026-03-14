# n8n File Upload Page

Modern static page for uploading `.txt`, `.pdf`, and `.csv` files to:

`https://maarseek.app.n8n.cloud/webhook-test/upload`

## Run locally

From this folder:

```bash
python3 -m http.server 8080
```

Then open:

- http://localhost:8080

## Stripe upgrade setup

The upgrade button now starts a Stripe Checkout flow through a local billing API.

### 1) Add your Stripe Price ID

In `supabase-config.js`, set:

- `window.BILLING_CONFIG.proPriceId` to your Stripe recurring price (for example `price_...`)

### 2) Install billing dependencies

```bash
npm install
```

### 3) Start the billing API (new terminal)

```bash
npm run start:billing
```

The billing server reads secrets from `.env`:

```env
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
BILLING_PORT=4242
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 3.1) Enable persistent Pro entitlement in Supabase

Create table `user_plans` in Supabase SQL editor:

```sql
create table if not exists public.user_plans (
	user_id uuid primary key references auth.users(id) on delete cascade,
	plan text not null check (plan in ('free', 'pro')),
	updated_at timestamptz not null default now()
);
```

The billing API updates this table after successful Stripe checkout verification.
The app reads this plan at login and applies it automatically.

Transcript history note:

- After each successful transcript extraction, the web app appends a new row through the billing API (`/api/append-transcript-history`) into a dedicated `transcript_history` table so history keeps all runs instead of being affected by n8n writes to `transcripts`.
- The history tab reads through billing API endpoint `/api/get-transcript-history` (authenticated) and treats `transcript_history` as the source of truth.
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

Optional one-off override via terminal env vars:

```bash
STRIPE_SECRET_KEY=your_stripe_secret_key BILLING_PORT=4242 npm run start:billing
```

### 4) Start the web app

```bash
python3 -m http.server 8080
```

Open http://localhost:8080/index.html

### 4.1) Connect Stripe webhook events

In Stripe Dashboard, add a webhook endpoint pointing to your billing server:

- `http://localhost:4242/api/stripe-webhook`

For local Stripe CLI forwarding, you can also use:

```bash
stripe listen --forward-to localhost:4242/api/stripe-webhook
```

Then copy the webhook signing secret into `.env` as `STRIPE_WEBHOOK_SECRET`.

Subscribe the endpoint to at least these events:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

This keeps `user_plans` in sync when subscriptions are canceled or otherwise change state.

### 5) Test upgrade

- Reach free limit (or keep your current locked state)
- Click any action to open the upgrade modal
- Click `Upgrade to Pro`
- Complete Stripe checkout
- You will be redirected back and upgraded to Pro in-app

## Behavior

- Accepts only `.txt`, `.pdf`, `.csv`
- Sends the selected file as `multipart/form-data`
- Uses form field name: `file`
- Also sends metadata fields: `filename`, `size`, `mimeType`, `extension`, `uploadedAt`
- Shows success/error message after upload
- Requires an authenticated Supabase session on `index.html`
- Displays the logged-in user name on the upload page
- Includes a `Log out` button that signs out and redirects to `login.html`

## Supabase auth pages

This project now includes:

- `login.html` for existing users
- `signup.html` for new account creation
- `auth.js` shared auth logic
- `supabase-config.js` for your Supabase URL and anon key

### Configure Supabase

Open `supabase-config.js` and set:

- `activeEnvironment` to `"local"` or `"cloud"`
- `SUPABASE_ENVIRONMENTS.local` values for local stack
- `SUPABASE_ENVIRONMENTS.cloud` values for cloud project

This lets you switch projects by changing one line.

After configuring, open:

- `http://localhost:8080/signup.html` to create account
- `http://localhost:8080/login.html` to log in
