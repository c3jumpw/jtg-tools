# MKC CRM tools

Browser tests and the getting-started tour's screenshots for `mkc-crm/index.html`.
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

## Tests

| File | What it checks |
| --- | --- |
| `test/features.test.js` | filters, completed jobs and invoices, the assistant |
| `test/statuses.test.js` | ClickUp's live statuses, new-deal status and links, amounts owed |
| `test/guide.test.js` | the tour: who sees what, first sign-in, What's new, keyboard, phone, Show me |
| `test/sweep.js` | every screen on a computer and a phone: no script errors, nothing too wide, every icon button named |
| `guide/check.js` | the tour covers every feature and its pictures are current |
