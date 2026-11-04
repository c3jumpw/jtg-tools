# Frontrow (client app)

Where clients sign in to see the updates, tasks and guides their team
publishes from Frontrow Manager (`frontrow-manager/`). One deployment serves
every organization:

| URL | What it is |
| --- | --- |
| `/` | the Frontrow landing page |
| `/jtg`, `/mco`, `/uny`, `/mkc` | each organization's branded sign-in and portal |
| `/signin` | neutral sign-in (sends people to their organization) |
| an organization's own domain | that organization's portal at `/` |

- Vercel project: `jtg-tools-frontrow`, **Root Directory `frontrow`**
- Suggested domain: `frontrow.jtgworkspace.com`
- Database: Supabase MKC-Admin (`symbmscaajjmgywbifhv`), schema `frontrow`

## Accounts

1. **Eligible** = a ClickUp contact linked to at least one company whose
   Account Status is Active (synced into Frontrow).
2. Staff send a setup link from Frontrow Manager (7 days), **or** the client
   uses **First time here? Set up your account** on their sign-in page
   (60-minute link, only if eligible).
3. They choose a password (10+ characters, scrypt-hashed) and get a welcome
   email with Add-to-Home-Screen steps for iPhone and Android. Their ClickUp
   contact gets a note.
4. Not eligible? The same screen emails them a "request access" link instead.
   Only when they confirm (proving the mailbox is theirs) is a ClickUp contact
   created/noted and the request shown in Manager → Requests.

The forms answer the same way, in about the same time, for everyone, so they
can't be used to find out who is a client. Ten wrong passwords in a row pause
sign-in for that account for 15 minutes (every guess is counted, even ones
sent in parallel); setting a new password from a reset link clears it.
Sessions last 30 days in an HTTP-only `__Host-frontrow_sid` cookie; resetting
a password or switching an account off ends them.

Setup and reset links always use Frontrow's own address
(`FRONTROW_URL/<slug>`), even for organizations with a custom domain, so a
mistyped domain can never receive account links.

## Environment variables

| Name | Value |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | same as Frontrow Manager |
| `RESEND_API_KEY`, `FROM_EMAIL` | same as Frontrow Manager |
| `FRONTROW_URL` | this app's URL, e.g. `https://frontrow.jtgworkspace.com` (links in emails) |
| `CLICKUP_API_TOKEN` | same new token as Frontrow Manager (notes and request contacts) |
| `ALLOWED_ORIGINS` | optional; only if a form is posted from another origin |

## One-time setup

1. Vercel project `jtg-tools-frontrow` → Settings → General → **Root
   Directory** `frontrow`; add the variables; redeploy.
2. Add `frontrow.jtgworkspace.com` (Settings → Domains). **Until a domain is
   added, clients can't open the `*.vercel.app` URL** — Vercel's deployment
   protection asks them to log in to Vercel. Either add the domain or turn
   protection off for production.
3. For an organization's own domain (e.g. `portal.j-tgroup.com`): add it to
   this Vercel project, point DNS at Vercel, then set it in Manager →
   Organizations → Edit → Custom domain. Set it there last, or emailed links
   would point at a domain that isn't live yet.

## Files

- `api/page.js` renders every HTML page (`vercel.json` rewrites `/`,
  `/signin` and `/<slug>` to it); the organization's public details go in a
  JSON block the page script reads.
- `api/manifest.js` gives each organization its own installable app name and
  icon. Icons live in `assets/orgs/<slug>/`.
- `lib/sanitize.js`, `lib/clickup.js`, `lib/directory.js`, `lib/tokens.js`,
  `lib/mail.js` and `test/fake-postgrest.js` are copies of the Manager's;
  `test/sanitize-parity.test.js` fails if they drift.

`npm test` runs the route tests (Node 20+, no dependencies).
