# Frontrow Manager

The staff side of **Frontrow**, MKC's client portal platform. Staff add
clients from ClickUp, send setup links, and write and publish the updates,
tasks and guides clients see in their organization's portal (the `frontrow/`
app in this repo).

- Vercel project: `jtg-tools-frontrow-manager`, **Root Directory `frontrow-manager`**
- Suggested domain: `frontrow-manager.jtgworkspace.com`
- Database: Supabase project MKC-Admin (`symbmscaajjmgywbifhv`), schema `frontrow`
  (migration `sql/001_frontrow_foundation.sql`, already applied)

## How Frontrow is organised

| Frontrow | ClickUp | Example |
| --- | --- | --- |
| Organization | Accounts → **Branch** label | Jump Tech Group (`JTG`), MCO, UNY, MKC (`MKC SA`) |
| Branch | Accounts → **Sub-Branch** | Fortune 5 Agency (`F5`), Anvil |
| Client (company) | a task in **Accounts** | Acme Plumbing |
| Contact | a task in **Contacts** (Primary Email) | pat@acme.com |
| Account | — (Frontrow only) | Pat's password login |

- A contact can be linked to several companies (ClickUp's relationship
  fields, read in both directions).
- **Who can sign in:** a contact linked to at least one company whose ClickUp
  **Account Status is Active**. Switch an account off in ClickUp and its
  people lose access at the next sync (nightly, or **Sync from ClickUp**).
- Each organization has its own branded sign-in page:
  `https://frontrow.jtgworkspace.com/jtg`, `/mco`, `/uny`, `/mkc` — or its own
  domain (Organizations → Edit → Custom domain).

## Day to day

- **CRM → "Add to Frontrow"** on a contact or account opens
  `/#/add/<ClickUp task id>` here: it imports the contact (or account) with
  its links and shows whether they can sign in, with **Email setup link** and
  **Copy link** buttons.
- **Client accounts**: everyone who can — or could — sign in, with their
  status. Email a setup link (7 days, works once; a reset link once they
  have a password), link someone to another client, switch an account off
  or on. Every link and change is noted on the ClickUp contact.
  **Copy link** (to send a setup link yourself) is offered only when it can't
  open someone else's account: never for reset links, and for account
  managers only when every client the person belongs to is theirs.
- **Client → People**: who sees this client's portal. Adding someone who isn't
  in ClickUp yet creates their ClickUp contact first. Account managers can't
  add someone who is already a contact on a client they don't manage — a
  manager does that.
- **Sync** (nightly, or **Sync from ClickUp**): people deleted or archived in
  ClickUp, or whose Primary Email was cleared, lose the access their ClickUp
  links gave them; links added by hand in Frontrow stay. If a fetch looks
  partial (under half the known contacts), that step is skipped.
- **Requests**: people who asked for access from a sign-in page and confirmed
  their email (each also lands in ClickUp as a contact with a note). Approve
  links them to an active client and emails a setup link.
- **Organizations**: portal links to share, branding, custom domains, branches.
- **Clients → Composer / Prompt library**: unchanged — Copy prompt, Draft with
  Gemini (paused while there's no key), Preview, Publish.

## Roles

| Role | Clients | Write & publish | Setup links | Clients, sync, requests, orgs | Team |
| --- | --- | --- | --- | --- | --- |
| Super admin | all | ✓ | ✓ | ✓ | ✓ |
| Manager | all | ✓ | ✓ | ✓ | — |
| Account manager | assigned | ✓ | ✓ (their clients) | — | — |
| Supervisor | assigned | read-only | — | — | — |

Enforced on the server (`lib/access.js`); the browser only hides buttons.

## Environment variables (Vercel → Settings → Environment Variables)

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | `https://symbmscaajjmgywbifhv.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key (Supabase → Settings → API) |
| `RESEND_API_KEY`, `FROM_EMAIL` | same as MKC Admin, e.g. `Frontrow <portal@jtgworkspace.com>` |
| `SITE_URL` | this app's URL, e.g. `https://frontrow-manager.jtgworkspace.com` |
| `FRONTROW_URL` | the client app's URL, e.g. `https://frontrow.jtgworkspace.com` |
| `PORTAL_ADMIN_EMAILS` | comma-separated emails that are always super admin |
| `CLICKUP_API_TOKEN` | a **new** ClickUp personal token (see Security) |
| `CRON_SECRET` | a long random string; Vercel sends it to the nightly sync |
| `GEMINI_API_KEY` | optional; leave empty while Gemini is paused |
| `GEMINI_MODEL`, `GEMINI_PAUSED` | optional (`GEMINI_PAUSED=1` forces the paused state) |

ClickUp list and field ids default to the MKC workspace's
(`lib/clickup.js`); override with `CLICKUP_LIST_ACCOUNTS`,
`CLICKUP_LIST_CONTACTS`, `CLICKUP_FIELD_*` or `CLICKUP_ACTIVE_STATUSES` only
if those change.

## One-time setup

1. Supabase → Project Settings → **Data API → Exposed schemas**: add `frontrow`.
2. Vercel project `jtg-tools-frontrow-manager` → Settings → General →
   **Root Directory** `frontrow-manager`; add the variables above; redeploy.
3. Add the domain (Settings → Domains). Until then the `*.vercel.app` URL is
   behind Vercel's login, which is fine for staff.
4. Sign in with a `PORTAL_ADMIN_EMAILS` address, open **Clients → Sync from
   ClickUp**, then Team → give everyone else their role.
5. Organizations → upload/point MCO and UNY logos when you have them
   (`/assets/orgs/<slug>/…` in the `frontrow` app, or an https link).

## Security

- The `frontrow` schema grants nothing to `anon`/`authenticated`; RLS is on
  with no policies. Only these two servers (service role) read or write it.
- Update pages are sanitised when saved and only ever served from `/api/view`
  under a `sandbox` CSP: no scripts, forms or same-origin access.
- Setup/reset links are stored as SHA-256 hashes, sit in the URL fragment
  (never sent to servers or logs), work once and expire. A new link retires
  the previous unused one. They always point at `FRONTROW_URL`, never a
  custom domain.
- Session cookies use the `__Host-` prefix, so other `*.jtgworkspace.com`
  sites can't set or overwrite them.
- Everything is written to `core.audit_log` (tool `frontrow`), which is
  append-only.
- The ClickUp token that was in this repo's history must be revoked in
  ClickUp; give Frontrow its own token in `CLICKUP_API_TOKEN` only.

## Tests

`npm test` (Node 20+, no dependencies) — unit tests plus end-to-end route
tests against a fake PostgREST and a fake ClickUp built from the migration.
