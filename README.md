# PostPilot

Write a post once, publish it to Facebook Pages, Instagram and LinkedIn — now or
on a schedule. Runs on free tiers that need no credit card.

## Why it is shaped this way

Three decisions explain most of the codebase:

**A post fans out into one row per destination.** `posts` holds the shared
content; `post_targets` holds the status. Partial success is the normal case —
LinkedIn and Facebook succeed while Instagram hits its daily cap — and status on
the post cannot express that. Retrying then re-publishes what already worked.

**One OAuth grant, many destinations.** A single Meta consent screen returns
every Page the user administers *and* every Instagram Business account linked to
those Pages. So `platform_connections` holds the grant and its tokens, while
`social_accounts` holds each publishable destination. Facebook issues a separate
token per Page, which is why that lives on the account rather than the grant.

**The publisher is a heartbeat, not a resident process.** No free tier gives you
a long-running worker, so an external cron calls `/api/cron/tick` every 60
seconds; each tick claims what is due with `FOR UPDATE SKIP LOCKED` and advances
every target by exactly one step. Postgres is the queue — no Redis. Instagram's
create-container → poll → publish flow is asynchronous anyway, so this is the
design you would want even with servers to spare.

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment

```bash
cp .env.example .env.local
```

Generate the two secrets:

```bash
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
```

```bash
node -e "console.log('CRON_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

Then confirm the key is well-formed before connecting anything:

```bash
npm run smoke
```

### 3. Database — Neon (free, no card)

Create a project at [neon.tech](https://neon.tech), copy the **pooled**
connection string (it ends in `-pooler`) into `DATABASE_URL`, then:

```bash
npm run db:push
```

### 4. Storage — Supabase (free, no card)

Create a project at [supabase.com](https://supabase.com), then a **public**
bucket named `media`. Copy the project URL and the service role key into
`SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.

This is not optional for images: Facebook and Instagram fetch media from a
public URL rather than accepting an upload, so `localhost` paths fail even in
development.

### 5. LinkedIn — start here, no review required

1. Create a LinkedIn **Company Page**. You cannot create a developer app without
   one, even though this posts to personal profiles.
2. At [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps),
   create an app against that Page.
3. **Products** tab → add *Sign In with LinkedIn using OpenID Connect* and
   *Share on LinkedIn*. Both are self-serve; `w_member_social` arrives without a
   review conversation.
4. **Auth** tab → redirect URL:
   `http://localhost:3000/api/connect/linkedin/callback`
5. Copy the client id and secret into `.env.local`.

### 6. Meta — one app for both Facebook and Instagram

1. At [developers.facebook.com/apps](https://developers.facebook.com/apps),
   create a **Business** app.
2. Add the *Facebook Login for Business* and *Instagram* products.
3. **Leave it in Development mode.** Add yourself under App Roles. In
   Development mode, standard access covers your own Page and your own Instagram
   account with no App Review at all — review is only needed to open the app to
   other people.
4. Meta requires HTTPS redirect URIs, so run a tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

   Set `APP_URL` to the tunnel URL, and add
   `https://<tunnel>.trycloudflare.com/api/connect/meta/callback` to the app's
   Valid OAuth Redirect URIs.
5. Your Instagram account must be **Business or Creator** and **linked to a
   Facebook Page**. A personal account cannot be posted to at all.

### 7. Run

```bash
npm run dev
```

Connect an account, write a post, publish. Publishing immediately runs a tick
inline, so you get the result without waiting.

To watch a *scheduled* post go out without setting up cron:

```bash
npm run tick
```

## Scheduling in production

Deploy to Vercel (Hobby is free and needs no card), then point
[cron-job.org](https://cron-job.org) at:

```
https://your-app.vercel.app/api/cron/tick
```

every minute, with the header `Authorization: Bearer <CRON_SECRET>`.

Vercel's own cron is not an option on Hobby: it allows two jobs at most once per
day, firing anywhere inside a one-hour window.

> Vercel's Hobby plan is for non-commercial use. Move to Pro before charging
> anyone.

## Layout

```
src/
  adapters/          the asset — everything platform-specific lives here
    types.ts         PlatformAdapter, Capabilities, PublishOutcome
    capabilities.ts  per-platform limits; the composer renders from this
    validate.ts      one validator, used by the composer AND the dispatcher
    linkedin/        auth + publish
    meta/            shared OAuth, then facebook.ts and instagram.ts
  lib/
    dispatcher.ts    claim, advance one step, persist, back off
    crypto.ts        AES-256-GCM envelope for tokens
    auth-server.ts   better-auth: real accounts, email + password
    auth.ts          maps the signed-in user to their workspace; OAuth state
    gate.ts          shared-password lock over the whole deployment
    storage.ts       Supabase uploads + image dimension probing
  app/api/
    cron/tick/       the publisher
    connect/         OAuth start and callback
```

## Adding a platform

1. Add a row to `CAPABILITIES` in `src/adapters/capabilities.ts`.
2. Add the platform to the `platform` enum in `src/db/schema.ts`.
3. Write an adapter exposing `advance()`.
4. Register it in `src/adapters/index.ts`.

The composer, validator and dispatcher need no changes. Threads is the cheapest
next one — same Meta app, same container flow as Instagram.

## Known gaps

- **No email verification or password reset.** better-auth handles both, but
  neither is wired up because no mail provider is configured. Until one is,
  a forgotten password means editing the database.
- **Images only.** No video, so no Reels and no TikTok.
- **No reconciliation step.** After an ambiguous failure the dispatcher retries.
  Instagram is protected by its stored container id; Facebook and LinkedIn are
  not. Before going multi-user, read back recent posts and check for a match
  inside the attempt window before re-sending.
- **Facebook is capped at one image.** Multi-photo posts need unpublished photo
  ids passed as `attached_media`.
- **No rate-limit budgeting.** Instagram's daily cap is checked before each
  publish, but there is no token bucket across accounts.
