<div align="center">

# ZeloraFiles

**Lightweight, no-nonsense temporary file hosting.**
Upload a file, get a link, watch it disappear on schedule — automatically.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Framework](https://img.shields.io/badge/Framework-Hono-e36002)](https://hono.dev)
[![Storage](https://img.shields.io/badge/Storage-Supabase-3ecf8e?logo=supabase&logoColor=white)](https://supabase.com)
[![Deploy](https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white)](https://vercel.com)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contribution)

Made by **Hanz** — if this project helped you, consider supporting it via [Saweria](https://saweria.co/hanzreally). ☕

</div>

---

## Table of Contents

- [About](#about)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Supabase Setup](#supabase-setup)
  - [Configuration](#configuration)
  - [Local Development](#local-development)
- [Deployment (Vercel)](#deployment-vercel)
  - [Cron Setup](#cron-setup)
- [Upload Flow](#upload-flow)
- [File Expiration](#file-expiration)
- [API / Endpoint Documentation](#api--endpoint-documentation)
- [Security](#security)
- [Contribution](#contribution)
- [License](#license)

---

## About

**ZeloraFiles** is a minimal, self-hostable file-sharing service. Drop a file in, pick how
long it should live, and share the link. No accounts, no dashboard — just a fast upload
with real, accurate progress and automatic cleanup.

It's built to be **simple, fast, and cheap to run**: a single Hono app on Vercel's
serverless runtime, backed by **Supabase** for both file storage and metadata (expiry,
filename, size).

> **Design principle:** once a file is uploaded, **nobody can delete it manually** —
> not the uploader, not an admin panel, nobody. The only thing that removes a file is
> its own expiration timer. See [Security](#security) for why.

---

## Features

- Drag-and-drop or click-to-browse upload, up to **50 MB** per file
- **Real, byte-accurate** upload progress (0% → 100%) — not a simulated animation
- Clear status stages: **Preparing → Uploading → Processing → Completed**
- Flexible expiration: 1h / 2h / 3h / 24h / **Permanent**
- No manual delete — files can *only* disappear via expiration
- Auto-cleanup via a scheduled Vercel Cron job, plus lazy on-access expiry checks
- Metadata (filename, size, expiry) tracked in a **Supabase Postgres table**;
  the actual bytes live in a **Supabase Storage** bucket
- Blocked executable extensions (`.exe`, `.bat`, `.cmd`, `.sh`, `.ps1`, `.vbs`, `.com`, `.scr`, `.msi`)
- Fully responsive, mobile-first layout
- Dark, high-contrast interface with crisp inline SVG icons — no emoji, no icon fonts

---

## Tech Stack

| Layer         | Technology                                     |
|---------------|-------------------------------------------------|
| Runtime       | Node.js **18+** (ESM, `"type": "module"`)       |
| Web Framework | [Hono](https://hono.dev)                        |
| Storage       | [Supabase Storage](https://supabase.com/storage) |
| Database      | [Supabase Postgres](https://supabase.com/database) |
| Scheduling    | Vercel Cron                                     |
| Frontend      | Vanilla HTML + CSS + JS (no build step)         |
| Hosting       | Vercel Serverless Functions                     |

No React, no bundler, no CSS framework, no ORM. This keeps the app small, fast to cold-start, and easy to audit.

---

## Project Structure

```
zelorafiles/
├── api/
│   └── index.js          # Vercel serverless entry — adapts Node req/res to Hono
├── src/
│   ├── app.js             # Hono app: routing + static file serving
│   ├── lib/
│   │   ├── supabase.js     # Supabase client + storage/database helpers, validation
│   │   ├── icons.js         # Shared inline SVG icons for server-rendered pages
│   │   └── page.js          # Shared HTML shell (navbar/footer) for server-rendered pages
│   └── routes/
│       ├── upload.js        # POST /upload
│       ├── file.js          # GET /f/:id, GET /f/:id/info
│       └── cron.js          # GET /cron/cleanup (protected by CRON_SECRET)
├── public/
│   ├── index.html          # Single-page upload UI (dark theme, inline SVG icons)
│   ├── app.js               # Upload logic: XHR + real progress + status stepper
│   └── style.css            # Dark theme styling, responsive
├── vercel.json              # Rewrites + cron schedule
├── package.json
├── LICENSE
└── README.md
```

---

## Getting Started

### Prerequisites

- Node.js **18** or newer
- A [Supabase](https://supabase.com) account and project (free tier works)
- A [Vercel](https://vercel.com) account (free tier works)
- The [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`

### Installation

```bash
git clone https://github.com/your-org/zelorafiles.git
cd zelorafiles
npm install
```

### Supabase Setup

ZeloraFiles needs one **Storage bucket** and one **Postgres table** in your Supabase project.

**1. Create the storage bucket**

In the Supabase Dashboard → **Storage** → **Create bucket**:

- Name: `zelorafiles`
- Public bucket: **enabled** (so download links resolve directly)

**2. Create the metadata table**

Run this in the Supabase Dashboard → **SQL Editor**:

```sql
create table if not exists public.files (
  id text primary key,
  filename text not null,
  storage_path text not null,
  content_type text,
  size bigint not null,
  expires_at bigint not null default 0, -- 0 = permanent, otherwise unix ms
  created_at timestamptz not null default now()
);

create index if not exists files_expires_at_idx on public.files (expires_at);
```

**3. Allow the app to read/write (RLS policies)**

This project talks to Supabase using the **publishable (anon) key**, so Row Level
Security must explicitly allow the operations the server performs (insert on upload,
select on lookup, delete on expiry). Run:

```sql
alter table public.files enable row level security;

create policy "Allow anon insert" on public.files
  for insert to anon with check (true);

create policy "Allow anon select" on public.files
  for select to anon using (true);

create policy "Allow anon delete" on public.files
  for delete to anon using (true);
```

```sql
-- Storage policies for the `zelorafiles` bucket
create policy "Allow anon upload to zelorafiles"
  on storage.objects for insert to anon
  with check (bucket_id = 'zelorafiles');

create policy "Allow anon read zelorafiles"
  on storage.objects for select to anon
  using (bucket_id = 'zelorafiles');

create policy "Allow anon delete from zelorafiles"
  on storage.objects for delete to anon
  using (bucket_id = 'zelorafiles');
```

> These policies intentionally mirror what the app already enforces at the
> application layer (no manual delete endpoint, ID validation, size limits).
> If you want a stricter setup, swap the anon key for a service-role key kept
> only in server-side environment variables and lock these policies down further.

### Configuration

The Supabase project URL and publishable (anon) key are hardcoded directly in
`src/lib/supabase.js` — no `.env` file is needed for those. They're safe to
keep in source because the publishable/anon key is designed to be exposed
client-side (Supabase enforces access via Row Level Security policies, not by
keeping this key secret).

If you fork this project for your own Supabase instance, just edit the two
constants at the top of `src/lib/supabase.js`:

```js
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_KEY = 'your-publishable-anon-key';
```

#### Environment Variables

| Variable      | Required | Description                                                                 |
|---------------|:--------:|-------------------------------------------------------------------------------|
| `CRON_SECRET` | Yes      | Random secret used to authorize the `/cron/cleanup` endpoint (Bearer token). This one stays a real secret and must be set as an environment variable — never commit it to source. |

Generate a strong `CRON_SECRET`, for example:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Local Development

```bash
vercel link       # link this folder to a Vercel project (one-time)
vercel env pull   # pull CRON_SECRET if you've already set it in the Vercel dashboard
vercel dev         # runs the app locally
```

Then open **http://localhost:3000**.

---

## Deployment (Vercel)

```bash
npm i -g vercel
vercel link
vercel env add CRON_SECRET
vercel --prod
```

### Cron Setup

`vercel.json` already defines the cleanup schedule:

```json
{
  "crons": [
    { "path": "/cron/cleanup", "schedule": "0 0 * * *" }
  ]
}
```

This runs once a day (Vercel Hobby plans are limited to daily cron invocations). This is
just a **sweep** for storage hygiene — it is *not* what enforces expiration for end
users. See [File Expiration](#file-expiration) below.

Don't forget `CRON_SECRET` must be set in **Vercel → Settings → Environment Variables** —
the cron route rejects any request without a matching `Authorization: Bearer <secret>` header.

---

## Upload Flow

The upload UI walks through four real, observable stages — every percentage and stage
transition below is driven by an actual browser/network event, not a timer:

```
┌────────────┐   ┌────────────┐   ┌─────────────┐   ┌────────────┐
│  Preparing │ → │  Uploading │ → │  Processing │ → │  Completed │
└────────────┘   └────────────┘   └─────────────┘   └────────────┘
   build the        xhr.upload         all bytes         server
   request body      'progress'        sent, awaiting     responded
                      events            server response    with ok:true
                      (0% → 100%)       (storage + DB write)
```

1. **Preparing** — the file is validated client-side (size/emptiness) and the
   `FormData` request is assembled.
2. **Uploading** — an `XMLHttpRequest` streams the file; its native
   `xhr.upload.addEventListener('progress', …)` event reports real
   `loaded` / `total` byte counts, converted straight into a percentage.
3. **Processing** — triggered by the browser's `xhr.upload` `load` event
   (all bytes have left the client) while the server validates the file,
   writes it to Supabase Storage, inserts the metadata row, and builds the
   JSON response.
4. **Completed** — the server responds with `{ ok: true, ... }` and the UI reveals
   the shareable link.

On the server, `POST /upload`:

1. Parses the multipart form (`file`, `hours`).
2. Validates size (≤ 50 MB), filename, extension blocklist, and expiry choice.
3. Generates a random alphanumeric ID.
4. Uploads the file to the Supabase Storage bucket at `{id}/{sanitizedFilename}`.
5. Inserts a row into the `files` table with filename, size, storage path, and
   expiry timestamp.
6. Returns the file's public URL, size, and expiration timestamp.

---

## File Expiration

Expiration is stored as a column (`expires_at`) on the `files` table:

- `expires_at` is `0` for permanent files, or a future Unix timestamp (ms) otherwise.
- **On every file access** (`GET /f/:id`), the server checks `expires_at` against the
  current time. If expired, it deletes the storage object **and** the database row
  **immediately** and returns a `410 Gone` page — expiration is enforced in real time,
  independent of the cron job.
- The daily `/cron/cleanup` job is a **backup sweep**: it queries for any row whose
  `expires_at` has already passed and removes both the storage object and the row,
  catching files that were never re-visited.

---

## API / Endpoint Documentation

| Method | Endpoint          | Description                                                        |
|--------|-------------------|----------------------------------------------------------------------|
| `POST` | `/upload`          | Upload a file. `multipart/form-data` with fields `file`, `hours`.   |
| `GET`  | `/f/:id`            | Redirects (302) to the file's public Supabase Storage URL, or `404` / `410` HTML page. |
| `GET`  | `/f/:id/info`        | Returns JSON metadata for a file (no redirect).                     |
| `GET`  | `/cron/cleanup`      | Sweeps expired files. Requires `Authorization: Bearer <CRON_SECRET>`. |

<details>
<summary><strong>POST /upload — request / response</strong></summary>

**Form fields**

| Field   | Type   | Notes                                             |
|---------|--------|-----------------------------------------------------|
| `file`   | File   | Required, ≤ 50 MB, blocked executable extensions rejected |
| `hours`  | string | One of `1`, `2`, `3`, `24`, or `0` (permanent)     |

**Success response — `200`**

```json
{
  "ok": true,
  "id": "aB3xQ9zL2k",
  "filename": "example.pdf",
  "size": 123456,
  "expiresAt": 1893456000000,
  "permanent": false,
  "url": "/f/aB3xQ9zL2k"
}
```

**Error response — `400` / `500`**

```json
{ "error": "File too large. Maximum size is 50 MB." }
```
</details>

<details>
<summary><strong>GET /f/:id/info — response</strong></summary>

```json
{
  "ok": true,
  "id": "aB3xQ9zL2k",
  "filename": "example.pdf",
  "size": 123456,
  "expiresAt": 1893456000000,
  "permanent": false,
  "downloadUrl": "/f/aB3xQ9zL2k"
}
```
</details>

> There is intentionally **no `DELETE` endpoint**. See [Security](#security).

---

## Security

- **No manual deletion, anywhere.** There is no delete button in the UI, no
  client-side delete request, and no `DELETE` route on the server. A file's
  lifecycle is controlled entirely by the expiration time chosen at upload —
  this keeps shared links trustworthy for their stated duration and prevents
  a link recipient (or anyone else) from prematurely destroying a file another
  person is relying on.
- **Filename sanitization** — uploaded filenames are stripped to safe
  characters (`[a-zA-Z0-9._-]`) before being used in the storage path;
  path traversal sequences (`/`, `\`, `..`) are rejected outright.
- **Extension blocklist** — common executable/script extensions are rejected
  at upload time.
- **ID validation** — file IDs are validated against `^[a-zA-Z0-9]{6,20}$`
  before any lookup, on every route that accepts one.
- **Cron protection** — `/cron/cleanup` requires a `Bearer` token matching
  `CRON_SECRET`; without it (or with a wrong value) it returns `401`.
- **Size limits** — 50 MB hard cap enforced both client-side (fast feedback)
  and server-side (authoritative).
- **Row Level Security** — the `files` table and `zelorafiles` storage bucket
  are gated by explicit Postgres RLS policies (see [Supabase Setup](#supabase-setup))
  rather than being wide open by default.

---

## Contribution

Contributions, bug reports, and suggestions are welcome!

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes with a clear message
4. Open a Pull Request describing what changed and why

Please keep changes **small, dependency-light, and consistent with the existing
style** (no build tooling, no client-side frameworks, ESM everywhere).

---

## License

Released under the **MIT License** — see [`LICENSE`](./LICENSE) for the full text.
