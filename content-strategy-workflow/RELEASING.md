# Releasing ContentFlow

ContentFlow ships with two help pages that must always describe the version
users are on:

- **tour.html** — the step-by-step Getting started tour, one per role, built
  from real screenshots of `index.html`.
- **guide.html** — the full reference guide.

Both open from the **?** button and from Settings. Nothing about them is
optional at release time; the checks below fail if they fall behind.

## Every release, in order

1. **index.html**
   - Bump `APP_VERSION`.
   - Add a `vX.Y.Z` entry to the version history comment at the top of the script.
   - Archive the file as `versions/contentflow/index.vX.Y.Z.html` and add a
     `CHANGELOG.md` entry there.

2. **tour/steps.js**
   - Set `version` to the new number.
   - Add `whatsNew['X.Y.Z']`: one line per change users will notice. Use
     `roles` to target it and `step` to link it to a tour step. Users see these
     once, in a banner, after they next sign in.
   - Add or adjust steps for anything new or moved on screen. Every top-bar
     tab, top-bar control, Settings item, Ideas sub-tab and Admin panel tab
     must be listed in some step's `covers` for each role that has it.
     `check.js` names anything missing.

3. **guide.html**
   - Update the sections the change touches.
   - Update the footer to `matches ContentFlow vX.Y`.

4. **tests/demo/demo-env.js** — if the app now reads a new endpoint, field
   or ClickUp path, add demo data for it. The capture fails on any request the
   demo can't answer, so a screenshot never shows a broken screen.

5. **Run the checks** from `content-strategy-workflow/`:

   ```sh
   npm install --prefix tests                  # first time only
   npx --prefix tests playwright install chromium   # first time only
   node tests/tour/capture.js    # re-shoots every tour screenshot from index.html
   node tests/tour/check.js      # tour + guide are current and cover every page/menu
   node tests/help.test.js       # Help layer, banner and regression tests
   ```

   Commit `tour/shots/` and `tour/manifest.js` with the release.

6. **Push.** `.github/workflows/contentflow-tour.yml` repeats step 5's
   capture and checks on GitHub for every push that touches the app,
   commits refreshed screenshots, and goes red if the tour or guide is
   behind. Treat a red run as a release blocker.

## How it stays honest

- `capture.js` drives the real `index.html` (on fictional demo data, with a
  frozen clock) to each step's screen and records the screenshot, the
  highlight boxes, the app version and a fingerprint of `index.html`.
- `check.js` fails when that fingerprint doesn't match the current
  `index.html` (the app changed but the screenshots didn't), when the app
  shows a tab or menu item no step covers, when the release has no What's new
  note, or when the guide footer names an older version.
- A step whose selector stops matching fails the capture instead of
  producing a misleading screenshot.
