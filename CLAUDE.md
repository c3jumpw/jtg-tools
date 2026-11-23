# jtg-tools

Each folder is its own tool, served from GitHub Pages (custom domain in `CNAME`); some have server functions on Vercel.

## MKC CRM (`mkc-crm/`, server functions in `api/`)

Every change to the CRM, however small, needs three things before it merges:

1. **Change-log entry** in `mkc-crm/changelog.json`.
   - Append it at the end; the file stays oldest first.
   - Fields:
     - `date`: the day it goes live.
     - `type`: `new`, `improved`, `fixed` or `security`.
     - `audience`: `everyone`, `admin` or `super`, meaning the lowest access level it applies to.
     - `announce`: `true` if people should see it in their What's new pop-up.
     - `title` and `summary`: plain words, written for the people using the CRM.
     - optional `details`, `slides` and `refs`.
   - Admins read the whole log on the Change Log page. People it applies to see the announced entries once, the next time they sign in.
   - A change nobody would notice (a code comment, an internal rename) can skip the entry instead: put `[no changelog]` in the commit message.
2. **Tour coverage.** If the change adds a screen, a record tab or button, a pop-up or a Settings section, add a slide to `GUIDE_STEPS` in `mkc-crm/index.html` and its set-up in `mkc-crm/tools/guide/make.js`. Set the slide's `since` to the date.
3. **Checks.** Run `cd mkc-crm/tools && npm test`. On every push, the GitHub action **CRM tour and tests** runs the same checks and retakes the tour pictures. Its change-log check fails if the CRM changed after the newest entry.

Details are in `mkc-crm/tools/README.md`. Sample data for tests and screenshots is invented (`mkc-crm/tools/harness/fixtures.js`); never put real records in it.
