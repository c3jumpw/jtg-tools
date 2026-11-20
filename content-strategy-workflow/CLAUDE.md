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

## Pending: move to jtg-tools.mkcworkspace.com

Requested 2026-11-20. The whole tools site moves, because every tool shares
one GitHub Pages domain (repo-root `CNAME`, now `jtg-tools.jtgworkspace.com`;
the repo is `c3jumpw/jtg-tools`, so Pages answers at `c3jumpw.github.io`).
Do not change `CNAME` until the owner confirms this DNS record exists and
resolves, or the live site goes down:

    jtg-tools.mkcworkspace.com  CNAME  c3jumpw.github.io

Then, in one go:
1. Repo-root `CNAME` → `jtg-tools.mkcworkspace.com`; wait for GitHub Pages to
   issue the HTTPS certificate (Settings → Pages → Enforce HTTPS).
2. Vercel `contentflow-oauth` env `ALLOWED_ORIGIN` →
   `https://jtg-tools.mkcworkspace.com`, then redeploy (it is the backend's
   CORS origin; a wrong value breaks client-role data and admin invites).
3. Supabase Auth → URL Configuration: Site URL and redirect URLs →
   `https://jtg-tools.mkcworkspace.com/content-strategy-workflow/` (invite and
   password-reset links land there).
4. ClickUp OAuth app: add the redirect URL
   `https://jtg-tools.mkcworkspace.com/content-strategy-workflow/`
   (index.html sends `location.origin + location.pathname`).
5. `guide.html` "Open ContentFlow" link → the new address.
Keep the old jtgworkspace.com record for a while; GitHub Pages only serves one
custom domain, so old links will stop working once `CNAME` changes. Tell
users the new address.
