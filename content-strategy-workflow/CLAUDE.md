# ContentFlow (content-strategy-workflow/)

Single-file app: `index.html` (vanilla JS, no build step), served by GitHub
Pages. Backend: `contentflow-oauth` on Vercel. Data: Supabase + ClickUp.

**Any change to `index.html` is a release.** Follow `RELEASING.md` before
calling the work done: bump `APP_VERSION`, update `tour/steps.js` (version,
What's new, steps/covers), update `guide.html`, then run

```sh
node tests/tour/capture.js && node tests/tour/check.js && node tests/help.test.js
```

and commit the refreshed `tour/shots/` and `tour/manifest.js`. The GitHub
Action `contentflow-tour.yml` re-runs these on push; a red run blocks the
release.

Keep tests and tooling inside this folder: anything outside the repo has been
lost to sandbox resets before.
