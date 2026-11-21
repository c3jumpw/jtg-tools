# ContentFlow (content-strategy-workflow/)

Single-file app: `index.html` (vanilla JS, no build step), served by GitHub
Pages. Backend: `contentflow-oauth` on Vercel. Data: Supabase + ClickUp.

**Any change to `index.html` is a release.** Follow `RELEASING.md` before
calling the work done: bump `APP_VERSION`, add the release to `changelog.js` (what changed, for
which roles: it feeds the admin Change log and each person's What's new
window), update `tour/steps.js` (version, steps/covers), update `guide.html`,
then run

```sh
node tests/tour/capture.js && node tests/tour/check.js && node tests/help.test.js
```

and commit the refreshed `tour/shots/` and `tour/manifest.js`. The GitHub
Action `contentflow-tour.yml` re-runs these on push; a red run blocks the
release.

Keep tests and tooling inside this folder: anything outside the repo has been
lost to sandbox resets before.

## Address

https://jtg-tools.mkcworkspace.com/content-strategy-workflow/ since
2026-11-21 (v1.27.1). The repo-root `CNAME` is shared by every JTG tool;
DNS (GoDaddy) has `jtg-tools.mkcworkspace.com CNAME c3jumpw.github.io`.
If the address ever changes again, update all of these together:
1. Repo-root `CNAME` (every tool moves with it).
2. Vercel `contentflow-oauth` env `ALLOWED_ORIGIN` (exact origin, no path),
   then redeploy. A wrong value blocks every backend call from the browser.
3. Supabase Auth → URL Configuration: redirect URLs (and the Site URL if it
   is ContentFlow's; the project is shared with other apps).
4. ClickUp OAuth app "Content Flow" (ClickUp → Settings → ClickUp API →
   ClickUp API Settings): Redirect URL(s), one origin per line.
5. `guide.html` "Open ContentFlow" link, and a change-log entry telling
   people to sign in and reconnect ClickUp again.

Supabase project `uwomibcrrrahucqtsvte` ("uny-tools") is shared with UnyBase:
its Site URL is `https://unybase.unywebs.com` and must stay that way. Its
redirect allow list has `https://jtg-tools.mkcworkspace.com/content-strategy-workflow/**`
for ContentFlow (added 2026-11-21).

Known issue (backend, not this repo): `api/admin/invite-user.js` calls
`inviteUserByEmail(email)` with no `redirectTo`, so invite links fall back to
the Site URL and open UnyBase, not ContentFlow. Fix: pass
`{ redirectTo: 'https://jtg-tools.mkcworkspace.com/content-strategy-workflow/' }`
and redeploy. The invited person then lands signed in and can set a password
in Settings › Profile.
