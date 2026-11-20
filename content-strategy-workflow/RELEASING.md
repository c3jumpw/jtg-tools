# Releasing ContentFlow

ContentFlow ships with a change log and two help pages that must always
describe the version users are on:

- **changelog.js** — every release, in plain language, tagged by role. Admins
  read the full history in Admin panel › Change log (filter, search, export
  CSV/JSON). Everyone else sees only their role's changes, once, in the
  "What's new" window the first time they sign in after a release.
- **tour.html** — the step-by-step Getting started tour, one per role, built
  from real screenshots of `index.html`.
- **guide.html** — the full reference guide.

Nothing here is optional at release time; the checks below fail if any of
them falls behind.

## Every release, in order

1. **index.html**
   - Bump `APP_VERSION`.
   - Add a `vX.Y.Z` entry to the version history comment at the top of the script.
   - Archive the file as `versions/contentflow/index.vX.Y.Z.html` and add a
     `CHANGELOG.md` entry there (the technical record).

2. **changelog.js** — add one entry at the end:

   ```js
   {
     version: 'X.Y.Z', date: 'YYYY-MM-DD', title: 'Short name for the release',
     summary: 'One sentence for admins.',
     items: [
       { type: 'new' | 'improved' | 'fixed', title: '...', text: '...',
         roles: ALL | TEAM | ADMIN | CLIENT | ['rep'] ...,
         area: 'Board', step: 'board', focus: 0 },
     ],
   }
   ```

   - One item per change a person would notice, written for them, not for
     developers. Leave out purely internal changes.
   - `roles` decides who sees the item in What's new. A person whose role has
     no items in a release is not interrupted for it, but it still appears in
     the admin Change log.
   - `step` (optional) shows a close-up from that tour step's screenshot and a
     "Show me" link; `focus` picks which of the step's highlights the close-up
     centres on (default: the first that isn't full-width).
   - Never edit or remove an old entry except to fix a mistake: it is the
     history admins export.

3. **tour/steps.js**
   - Set `version` to the new number.
   - Add or adjust steps for anything new or moved on screen. Every top-bar
     tab, top-bar control, Settings item, Ideas sub-tab and Admin panel tab
     must be listed in some step's `covers` for each role that has it.
     `check.js` names anything missing.

4. **guide.html**
   - Update the sections the change touches.
   - Update the footer to `matches ContentFlow vX.Y`.

5. **tests/demo/demo-env.js** — if the app now reads a new endpoint, field
   or ClickUp path, add demo data for it. The capture fails on any request the
   demo can't answer, so a screenshot never shows a broken screen.

6. **Run the checks** from `content-strategy-workflow/`:

   ```sh
   npm install --prefix tests                  # first time only
   npx --prefix tests playwright install chromium   # first time only
   node tests/tour/capture.js    # re-shoots every tour screenshot from index.html
   node tests/tour/check.js      # tour + guide are current and cover every page/menu
   node tests/help.test.js       # Help layer, What's new, Change log and regression tests
   ```

   Commit `tour/shots/` and `tour/manifest.js` with the release.

7. **Push.** `.github/workflows/contentflow-tour.yml` repeats step 6's
   capture and checks on GitHub for every push that touches the app,
   commits refreshed screenshots, and goes red if the tour or guide is
   behind. Treat a red run as a release blocker.

## How it stays honest

- `capture.js` drives the real `index.html` (on fictional demo data, with a
  frozen clock) to each step's screen and records the screenshot, the
  highlight boxes, the app version and a fingerprint of `index.html`.
- `check.js` fails when that fingerprint doesn't match the current
  `index.html` (the app changed but the screenshots didn't), when the app
  shows a tab or menu item no step covers, when `changelog.js` has no entry
  for this version (or is out of order, or is missing a version listed in
  index.html's history comment, or names a step that doesn't exist), or when
  the guide footer names an older version.
- Who has seen each release is stored per person in Supabase
  (`contentflow_release_views`), so What's new shows once per person, not
  once per device, and admins see "Seen by N of M people" in the Change log.
- A step whose selector stops matching fails the capture instead of
  producing a misleading screenshot.
