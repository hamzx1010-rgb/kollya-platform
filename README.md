# كُلِّيَّة — Koliya

Réseau social privé pour les étudiants universitaires algériens.
Stack : **Neon Postgres** + **Neon Auth** + **Cloudflare R2** + PWA statique.

---

## The one architectural rule

```
Postgres  →  text, numbers, relations, and URLs
R2        →  every image, video, audio file and document
```

The old single-file version converted media to base64 and wrote it into
table rows. A 30 MB video became ~40 MB of text inside `messages`.
Neon's free tier is **0.5 GB** — that is **13 videos** before the whole
app stops working, login included.

`js/core/media.js` enforces this. `assertNotBase64()` throws if any code
ever tries to put a `data:` URL into the database again.

---

## Structure

```
koliya/
├── db/
│   ├── 01_schema.sql        tables (run first)
│   ├── 02_policies.sql      RLS — the real security (run second)
│   └── 03_admin.sql         approve / ban / promote, by hand
├── server/
│   └── upload-worker.js     signs R2 uploads (Cloudflare Worker)
├── tests/
│   ├── run.sh               ./tests/run.sh  →  263 assertions
│   ├── app.test.mjs         boots the app, walks every route
│   ├── core.test.mjs        utils, store, router, icons, ui, shell, sw
│   ├── feed.test.mjs        posts, polls, comments, composer
│   ├── hub-profile.test.mjs xp, badges, quests, leaderboard, profile
│   └── campus.test.mjs      stories, notifications, channels, events, q&a
├── public/
│   ├── index_sm.html        app shell
│   ├── offline_sm.html      shown when the network is gone
│   ├── manifest_sm.json     sw_sm.js · icons/
│   ├── preview_*_sm.html    standalone previews of each screen
│   ├── css/  base · components · layout
│   └── js/
│       ├── core/            utils · store · router · ui · shell · icons
│       └── features/        feed · messages · stories · hub · profile ·
│                            campus · editor · gif · voice · notifications
├── .env.example
└── README.md
```

## Tests

```bash
./tests/run.sh
```

Every assertion runs against real DOM in jsdom — the suite loads the actual
HTML shell and the real modules, so a broken selector or a missing element
fails the build rather than surfacing in someone's browser.

Bugs this suite has already caught:

| Symptom | Cause |
|---|---|
| composer vanished as a chat grew | `.thread-body` had no `min-height:0`, so flex grew instead of scrolling |
| rail and title froze on some routes | `render()` returned early when a view was missing, skipping `route:enter` |
| reactions crashed on some browsers | `CSS.escape` is absent in older Safari and Android webviews |
| a counter span at 100% CPU forever | `countUp` compared two different clocks, so progress never reached 1 |
| whole panel failed to draw | `on()` threw when an optional element was absent |

---

## Setup

### 1. Neon database

1. Create a project at [neon.com](https://neon.com)
2. SQL Editor → paste **`db/01_schema.sql`** → Run
3. SQL Editor → paste **`db/02_policies.sql`** → Run
4. Branch → **Auth** → Enable (gives you Project ID + Publishable Key)
5. Branch → **Data API** → Enable (gives you the REST endpoint)

Copy those three values into `public/js/core/config.js`.

### 2. Cloudflare R2

1. Cloudflare dashboard → **R2** → Create bucket → `koliya-media`
2. Settings → **Public access** → enable, note the public URL
3. **Manage R2 API Tokens** → Create → *Object Read & Write* → save the keys

### 3. Upload worker

```bash
npm install -g wrangler
wrangler login
cd server

wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_BUCKET
wrangler secret put R2_PUBLIC_URL
wrangler secret put NEON_AUTH_JWKS_URL
wrangler secret put ALLOWED_ORIGIN

wrangler deploy
```

Put the resulting `*.workers.dev` URL into `config.js` as `UPLOAD_URL`.

### 4. Make yourself admin

There is **no admin page**, by design. Sign up in the app like any
student, then run once in the Neon SQL Editor:

```sql
UPDATE profiles
SET role = 'admin', status = 'approved'
WHERE username = 'YOUR_USERNAME';
```

Day-to-day moderation lives in `db/03_admin.sql`:

```sql
-- who is waiting?
SELECT username, full_name, faculty FROM profiles WHERE status='pending';

-- approve
UPDATE profiles SET status='approved' WHERE username='sara.b';

-- promote
UPDATE profiles SET role='admin' WHERE username='sara.b';
```

### 5. Deploy the frontend

It is a static site. Netlify, Cloudflare Pages or Vercel — drag the
`public/` folder, or connect the repo. No Node server needed.

### Still needed from you

The UI runs on sample data until these arrive:

| Value | Where it goes |
|---|---|
| Neon Data API URL | `js/core/config_sm.js` |
| Neon Auth project id + publishable key | `js/core/config_sm.js` |
| R2 public URL | `js/core/config_sm.js` + worker secret |
| R2 account id / access key / secret | `wrangler secret put` |
| Tenor or Giphy key | `gif_sm.js` → `useGifProvider()` |

Each feature module exposes `useApi()` so swapping sample data for the real
database touches one function per screen and nothing else.

---

## What RLS fixes

RLS = rules enforced **inside Postgres**. JavaScript can be edited by any
user; these cannot.

| Before | After |
|---|---|
| `select * from messages` returned **every student's DMs** to every browser | you only ever receive your own |
| any user could `update profiles set role='admin'` | blocked; only an existing admin can |
| `approveUser()` was a client function with no server check | `is_admin()` is checked by the database |
| private accounts filtered in JS | `can_view()` enforced in SQL |

Verify it yourself — log in as a normal student and run in the console:

```js
await fetch(`${CONFIG.DATA_API_URL}/messages?select=*`, {
  headers: { Authorization: `Bearer ${token}` }
}).then(r => r.json());
```

You should see only your own conversations.

---

## Storage budget

| Item | Where | Free allowance |
|---|---|---|
| profiles, posts, messages, comments | Neon | 0.5 GB (~500k rows) |
| avatars, photos, videos, audio | R2 | **10 GB, no egress fees** |

Watch the database size with the query at the bottom of `03_admin.sql`.
If `messages` or `posts` grows unexpectedly, someone reintroduced base64.

---

## Media limits

| Kind | Max | Notes |
|---|---|---|
| avatar | 2 MB | compressed to 400px before upload |
| banner | 3 MB | |
| post image | 10 MB | compressed to 1080px |
| story | 15 MB | image or video |
| **video** | **30 MB** | max 60 s |
| audio | 5 MB | voice notes |
| file | 15 MB | pdf, doc, ppt |

Enforced twice: in the browser (fast feedback) and in the worker
(the one that actually counts).
