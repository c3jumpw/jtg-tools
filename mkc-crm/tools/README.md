# MKC CRM tools

Browser tests, the getting-started tour's screenshots and the change log for `mkc-crm/index.html`.
Everything runs on invented sample data (`harness/fixtures.js`); nothing touches ClickUp, the Worker or real records.

```
cd mkc-crm/tools
npm install
npx playwright install chromium
npm test              # all checks
npm run guide         # remake every tour picture
node guide/make.js job invoices   # remake only some slides
```

## The tour

The tour is `GUIDE_STEPS` in `index.html`: one slide per feature, in three sets.

- **Getting started** — everyone.
- **For admins** — Admin and Super Admin.
- **For super admins** — Super Admin only.

It opens by itself on someone's first sign-in. People who have already seen it are shown only slides newer than their last visit, labelled **What's new**. It can be reopened from Resources, the **?** button and the command bar.

**When you change the CRM:**

1. **New screen, record tab, record button, pop-up or Settings section:** add a slide to `GUIDE_STEPS` (or list it in an existing slide's `covers`). Also add its set-up to `STEPS` in `guide/make.js`.
2. **New or changed slide:** set its `since` to today's date. That is what puts it in What's new.
3. **Push to main:** the **CRM tour and tests** GitHub action remakes the pictures, commits them, and runs every check. To do it by hand, run `npm run guide`.

`guide/check.js` fails when any of these is true:

- something in the app has no slide;
- a slide has no picture;
- the pictures were made from an older version of `index.html`.

## The change log

`mkc-crm/changelog.json` records every change to the CRM, oldest first. Admins read it in the CRM under **Admin → Change Log**, where it can be searched, filtered and downloaded as CSV or JSON.

Each entry says who it applies to (`audience`: everyone, admin or super) and whether to announce it (`announce`). The next time someone signs in, a **What's new** pop-up shows the announced entries that apply to their access level and that they haven't seen yet. Someone signing in for the first time gets the tour instead.

Add an entry with every change (see `CLAUDE.md` at the repo root). `changelog/check.js` checks the entries, and it fails if `mkc-crm/index.html` or `api/` changed after the newest entry. Put `[no changelog]` in a commit message to skip a change nobody would notice.

What has been seen is stored per browser, so someone using both a phone and a computer sees What's new on each.

## Tests

| File | What it checks |
| --- | --- |
| `test/senders.test.js` | which Resend key sends for which email domain (`api/_lib/senders.ts`; needs Node 22) |
| `test/features.test.js` | filters, completed jobs and invoices, the assistant |
| `test/statuses.test.js` | ClickUp's live statuses, new-deal status and links, amounts owed |
| `test/guide.test.js` | the tour: who sees what, first sign-in, keyboard, phone, Show me |
| `test/changelog.test.js` | What's new per access level and only once, first sign-in gets the tour, the Change Log page, filters and downloads |
| `test/sweep.js` | every screen on a computer and a phone: no script errors, nothing too wide, every icon button named |
| `guide/check.js` | the tour covers every feature and its pictures are current |
| `changelog/check.js` | the change log is well formed and has an entry for the latest CRM change |
