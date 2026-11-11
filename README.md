# Recovery Lists

Local Next.js (App Router) + SQLite ops console for recovery agents.

**Google Sheets is read-only.** The app never updates, appends, or rewrites Dashboard / Recovery Lists cells. Call attempts live only in SQLite.

## Quick start

```bash
cd apps/recovery-lists
cp .env.example .env.local
npm install
npm run dev
```

Open **http://127.0.0.1:3000**

### First admin (no HTTP setup)

There is no web “create admin” form (disabled for public hosting). Create the first admin offline:

```bash
ADMIN_USERNAME=admin ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='at-least-10-chars' \
  npm run create-admin
```

Accounts created later by an admin must change their password on first sign-in.

## What it does

- **Login** with username/password (bcrypt) and HTTP-only session cookie
- **Agent lists**: tabs for assigned status lists → queue → lead detail + attempt form
- **Admin**: create/disable agents, assign lists, add/remove statuses, sync
- **Attempts**: NG, Cancelled, Recovered, Callback, No Answer, No Answer Voicemail, DNC + notes; auto-stamps timestamp + agent display name
- **Hide rules**: latest attempt Recovered or DNC removes the prospect from all lists; sheet DNC / status DNC never shown
- **History anchor**: cluster by Prospect ID (fallback phone); active row = newest Appointment Date else DATE; older rows display-only

### Seed list statuses

PNS, NPNS, sold, NG, no show, cancelled, pending, reschedule, no answer, FTD, special, second meeting, WC-pending, confirmation pending

Aliases normalized (e.g. Canceled → cancelled, 2nd Meeting → second meeting).

## Google Sheets sync (read-only)

Default spreadsheet (New 2026 Dashboard):

`1G_H_4ETKhtXglDR41c6gYdX6uTJ32ZYmBsz4DTwc7Bw`

Tabs: `Database`, `DNC`. Status membership uses **column W (Status)**.

### Preferred: Apps Script web app (no Cloud billing)

1. Paste Project doc `docs/recovery-lists-apps-script.js` into **Extensions → Apps Script** on the Dashboard
2. Follow `docs/recovery-lists-apps-script-deploy.md` (set Script property `SYNC_TOKEN`, deploy Web app)
3. In `.env.local`:

```env
SHEETS_APPS_SCRIPT_URL=https://script.google.com/macros/s/…/exec
SHEETS_APPS_SCRIPT_TOKEN=same-as-SYNC_TOKEN
```

4. Restart `npm run dev` → Admin → Sync → **Sync now** (mode `apps-script`)

Do **not** make the sheet public. The `/exec` URL + token is the gate.

### Fallbacks

- **CSV paste** on Admin → Sync (always available)
- **Fixtures** when nothing else is configured
- Optional `GOOGLE_SERVICE_ACCOUNT_FILE` (Cloud Console; often hits a billing wall — avoid for Don)

Without Apps Script URL/token, the app loads `data/fixture-database.csv` (Lindor, Esperanza Morales, Maria Martinez) until you paste CSV or configure the web app.

## Product rules (from plan)

1. Never mutate Google Sheets
2. Do not depend on rewriting the Recovery Lists workbook or Apps Script wipe/rebuild
3. Attempts are app-owned only
4. Admin can add statuses (creates lists) and remove (hides lists)

## Scripts

| Command           | Purpose                |
|-------------------|------------------------|
| `npm run dev`     | Dev server :3000       |
| `npm run build`   | Production build       |
| `npm run start`   | Production server      |
| `npm run typecheck` | TypeScript check     |

SQLite file: `data/recovery-lists.db` (created on first run).
