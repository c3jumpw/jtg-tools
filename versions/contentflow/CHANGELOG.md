# ContentFlow — Changelog

Each shipped revision of `content-strategy-workflow/index.html` is archived
here under `index.v<version>.html` so prior behavior can always be diffed or
restored, independent of git history digging.

## v1.0.0 — 2026-09-08
Initial release.
- Board (drag-and-drop by status), List (sortable/filterable), and Calendar
  views, all reading live from the ClickUp "Client Master Content Strategy
  Workflow" list.
- Task modal: name, status, assignees, all custom fields (recognizes
  MKC ID / Next Action Date / Medium(s) / Publish Date / Related Account ID /
  Scheduled Date by name; any other custom field on the list renders
  generically based on its ClickUp field type).
- Comments: view + post, synced to ClickUp.
- No backend/build step: single self-contained HTML/CSS/JS file, matching
  this repo's existing tool convention (see mkc-crm, keyforge, etc.).
- Connect screen: manual personal-API-token entry, cached client-side only
  (localStorage if "remember" is checked, else sessionStorage this tab only).
- Verified with an automated jsdom smoke test (25 checks: connect flow, all
  three views, custom field rendering + editing, comments with HTML-escaping,
  create/update/delete, drag-and-drop status changes, and a regression check
  for the "Save button stuck disabled" bug found and fixed during that same
  test pass -- see inline code comments in index.html for details).

## v1.1.0 (2026-09-19)
- Added ContentFlow-level login (Supabase Auth, email + password) in front of the board -- everyone signs into the app itself now, not just ClickUp.
- Three roles: admin (full access + new Admin panel), rep (their own ClickUp OAuth connection, restricted to assigned account(s)), client (read-only board/list + comments, no ClickUp connection at all).
- Replaced manual personal-API-token entry with ClickUp OAuth for admins/reps.
- Client-role reads/writes now go through a new backend proxy (contentflow-oauth on Vercel: /api/client/tasks, /api/client/comments) instead of a direct ClickUp connection.
- Added an Admin panel: invite users by email (Supabase sends the invite, they set their own password), assign role + ClickUp account(s), see everyone with access.
- Reps are now restricted to their assigned account(s) in both the account filter dropdown and the underlying task list.
- New backend endpoints added to contentflow-oauth: /api/admin/invite-user, /api/admin/list-users, /api/client/tasks, /api/client/comments (see that project's own README/CHANGELOG).
- New Supabase project (uny-tools): `profiles` and `account_access` tables, RLS enabled, no direct client writes -- all writes go through the backend's service-role key.
- Tested via jsdom smoke test (25/25 passing): login gating, role routing, rep account restriction, client task/comment flow, admin invite flow, and a regression check that board/list/calendar rendering for admins/reps is unchanged.

## v1.2.0 (2026-09-19)
- Removed the manual "List ID" field from the admin/rep connect screen -- ContentFlow now points at the one Client Master Content Strategy Workflow list automatically (fixed CU_LIST_ID, matching the backend's CLICKUP_LIST_ID). Admins/reps just connect the ClickUp user/guest that already has access to that list.
- Clients with no account assigned yet now see a dedicated "Almost there -- waiting on your admin" screen instead of an empty board, and no longer trigger a pointless /api/client/tasks call while unassigned.
- Confirmed and documented: the account ID used throughout (invite form, Related Account ID matching) is the MKC ID from the Companies & Accounts list -- the invite form's help text now says so explicitly.
- Added a Dashboard view for both admin/rep and clients: total/overdue/due-this-week stat cards, a status breakdown (bar chart, CSS-only, no new dependency), an account breakdown when more than one account is in view, and a clickable "needs attention" list of overdue/due-soon tasks (by Next Action Date).
- Tested via jsdom smoke test, now 36/36 passing (added coverage for the connect-screen simplification, the client waiting screen, and both dashboards).

## v1.3.0 (2026-09-19)
- CRITICAL FIX: ClickUp's REST API doesn't reliably support being called directly from browser JavaScript on a different origin -- confirmed live, this was causing "Could not reach ClickUp" for every admin/rep after connecting. Root cause: the whole "browser calls ClickUp directly" architecture assumption (carried over from the original mkc-crm precedent) doesn't hold for a real cross-origin deployment; it was only ever exercised through mocked tests before now.
- Fix: added /api/clickup-proxy on the backend. Admin/rep ClickUp calls now route through it (server-to-server, immune to browser CORS) using the admin/rep's own ClickUp token, and the response is relayed back byte-for-byte. cuRequest()'s function signature and error behavior are unchanged, so no other frontend code needed to change.
- Also fixed a related backend bug from the same root cause class: /api/oauth-exchange's CORS setup only allowed a Content-Type header, but the frontend always attaches the user's Supabase login as an Authorization header too -- causing "Failed to fetch" during the ClickUp connect step itself. Now uses the shared applyCors() helper (allows Authorization) instead of a hand-rolled, incomplete copy.
- Added a jsdom test that actually exercises loadAll() -> cuRequest() -> the clickup-proxy backend call end-to-end, so this class of regression can't silently ship again. 40/40 passing.

## v1.4.0 (2026-09-19)
- Account names instead of raw MKC IDs everywhere: admin/rep resolve them via a new accounts directory (fetched from the Companies & Accounts list); clients get them from a new accountNames map the backend resolves server-side. Filter dropdown, board badges, list view, and dashboard breakdown all show names now, sorted alphabetically by name.
- Removed "Related Account ID" as a plain field row in the task modal; replaced with an editable name badge (styled <select>) at the top of the entry -- reassigning a task's account is now picking a name from a list, not hand-typing an id.
- Medium(s) are color-coded everywhere now (list view, edit-modal toggles), using each medium's own ClickUp color -- board cards already did this.
- Renamed "Comments" to "Log" throughout, admin/rep and client alike (heading, empty state, placeholder text).
- Backend: new getAccountNames() in lib/clickupService.js, new CLICKUP_ACCOUNTS_LIST_ID env var, /api/client/tasks now returns an accountNames map alongside tasks.
- jsdom smoke test now 52/52 passing (added coverage for account-name resolution on both roles, medium color-coding, and the Log rename).

## v1.5.0 (2026-09-19)
- File/media storage per task, backed by Supabase Storage (private bucket "content-files"). Six categories: Copy/Drafts, Notes, Media Extractions, Media Files (raw) -- internal, admin/rep only -- and Published/Final, Client Assets -- visible to clients too.
- Clients can upload only into Client Assets (their own reference material/logos); admin/rep can upload anywhere and delete; clients can't delete at all in v1.
- Uploads never pass through the Vercel backend: the browser gets a short-lived signed URL/token from /api/files/upload-url, then pushes the file straight to Supabase Storage, avoiding serverless request-size limits for large media.
- New backend: lib/filesPolicy.js (category rules) and /api/files/{upload-url,list,download-url,delete}, all permission-checked server-side.
- New Supabase: `files` metadata table + the storage bucket, RLS enabled with no direct-access policies (same backend-only-access pattern already used for profiles/account_access).
- jsdom smoke test now 67/67 passing (added coverage for category visibility by role, upload restriction, the upload/download/delete flows).

## v1.6.0 (2026-09-19)
- Dashboard now flags "stuck" tasks: no Next Action Date set and no ClickUp activity in 7+ days (date_updated as a proxy), excluding terminal statuses like Published. New stat card + list section, amber-styled to read distinctly from the existing overdue/red styling.
- Soft, dismissable warning when moving a task into "For Review" with no Copy/Drafts or Media Files (raw) uploaded yet -- covers both drag-and-drop and the modal's Save button. Never blocks the move outright, and only fires on an actual transition into the status (not on re-saving a task already there).
- No backend changes -- both features are frontend-only, reusing the existing /api/files/list endpoint.
- jsdom smoke test now 78/78 passing.

## v1.7.0 (2026-09-19)
- Account matching now checks BOTH a text field and a ClickUp relationship (linked-task) field, since the list has two fields both named "Related Account ID" -- text wins when both are set. New getTaskAccountId() (frontend) / rewritten extractAccountId() (backend) replace every direct read of the old text-only field.
- Removed the entry's own "MKC ID" field from the UI entirely -- stays in ClickUp, unused here. Board cards no longer show it.
- Log improvements: entries show a timestamp, sort newest-first, and collapse to 4 with a "Show all N" toggle. Every file upload now auto-posts a log entry ("Uploaded 'x.png' to Client Assets.") for both admin/rep and client uploads.
- Mobile/responsive pass: fixed a real bug where the client task panel (.modal-card) had no CSS at all; wrapped the admin user table for horizontal scroll instead of overflowing the page; topnav buttons wrap instead of clipping when there's no room; larger touch targets, tighter dashboard/board/connect-screen spacing under 760px/420px.
- Admin panel's user list now shows resolved account names instead of raw MKC IDs, for consistency with the rest of the app.
- jsdom smoke test now 93/93 passing.

## v1.8.0 (2026-09-19)
- Fixed a real bug: the task modal could show "No account" while the same task's board card correctly showed one, because the modal only ever read the text field while the card checked both text and relationship fields. buildTaskDraft() now seeds the text field's draft value from the resolved id whenever the text field itself is empty -- the modal always matches the card now, and simply saving the task (even untouched) heals the gap into ClickUp's text field going forward.
- Removed the entry's own "MKC ID" from the task modal too (v1.7.0 only removed it from cards). The save loop no longer writes back to MKC ID or to a relationship-typed account field (the latter needs a different API payload shape and this app was never meant to write to it).
- Account reassignment is now admin-only: reps see a read-only account badge even where a writable text field exists. A rep creating a brand-new task with exactly one assigned account gets it prefilled (still read-only).
- New: clients can create their own entries directly via a "+ New" button and a name-only form. Backed by a new POST /api/client/tasks endpoint that locks the new entry to the client's own assigned account server-side, defaults to the list's first workflow status (e.g. "Idea") rather than a hardcoded name, and logs who created it.
- jsdom smoke test now 109/109 passing.

## v1.9.0 (2026-09-19)
New layer added IN FRONT OF the production board -- nothing about the board/dashboard/roles changed, this sits before it.

- Idea Infrastructure system for capturing raw material before it's ready to be a real ClickUp task, based on product brainstorming around a four-layer model (Strategy/Pillars, Capture/Inbox, Rhythm/Habits, Production).
- Three new Supabase tables: pillars, ideas, rhythm_configs -- account-scoped exactly like account_access/files, same backend-gated access pattern (RLS enabled, no direct policies, everything through the service role key).
- Three new backend endpoints: /api/pillars, /api/ideas, /api/rhythm. Identical logic for admin/rep/client since none of this touches ClickUp until an idea is promoted -- a first for this codebase, where every other feature needed role-forked logic.
- New "Ideas" tab for every role: a one-time rhythm wizard (how ideas naturally originate, realistic weekly capacity, routine shape) that doubles as an editable settings screen; a plain-language pillar manager (no rigid one-to-one binding); an idea inbox (quick text capture, tagged to a pillar, grouped by pillar).
- "Promote" turns an idea into a real production task: admin/rep create it themselves via their own ClickUp connection then record the result (markConverted); clients have no ClickUp connection, so the backend creates it for them (convert action), reusing the same createClientTask() their "+ New" button already used.
- Deliberately no AI extraction yet -- structure first, per direction, until there's a way to charge for token use.
- jsdom smoke test now 128/128 passing (19 new tests covering account resolution, the rhythm wizard, pillar CRUD, idea capture/grouping/archive, and both promote-to-production paths).

## v1.10.0 (2026-09-19)
- "Disconnect ClickUp" moved out of the main topnav into a small settings-gear dropdown.
- Fixed a real bug: promoting an idea to production never set the new task's account (only name + status) -- now explicitly carries the idea's account onto the new task.
- computeAccounts() rewritten to derive from the full Companies & Accounts directory instead of only accounts with an existing task -- root cause of "only accounts with data can be selected," including in the Ideas tab.
- New admin Accounts screen: every account from Companies & Accounts, an active/inactive toggle (new account_settings table), who has access to each, and an "Invite to this account" shortcut.
- Pipeline-health summary on the Idea Inbox, giving the rhythm wizard's answers ongoing purpose.
- Idea Inbox redesigned as a drag-and-drop pillar matrix (reusing the production board's Kanban mechanics) instead of flat grouped tags.
- Inline copy clarifying Inbox vs. the workflow's own Idea status.
- New backend: /api/accounts (admin-only).
- jsdom smoke test now 146/146 passing.

## v1.11.0 (2026-09-19)
Richer capture, based on a broader content-ops research pass.

- Ideas now carry: source type (Idea/Link/Note, plus existing Quote), a needs_review flag (links start flagged by default), an is_private flag (default off = whole account team; on = only the creator, admins excepted), and a freeform category label independent of pillar.
- Idea Inbox gained real filter tabs (Active / Needs Review / Archived / Promoted) and a Newest/Oldest sort toggle. Active and Needs Review show the drag-and-drop pillar matrix; Archived and Promoted are flat lists.
- Archiving and promoting now update an idea's status in place instead of removing it from view, so it's still findable under its own filter tab.
- Privacy enforced server-side on every read and write, not just in the UI.
- Schema: ideas gained needs_review, is_private, category columns; source_type's allowed values extended.
- Deliberately NOT built this round: attaching media files directly to an idea. Plan: reuse the exact file-upload infrastructure already built for tasks (an idea's id can stand in for a task id with zero backend changes) -- UI didn't make it into this pass.
- jsdom smoke test now 159/159 passing.

## v1.12.0 (2026-09-19)
Media attachments for ideas -- the "old unsorted media" / gallery-pool feature deferred last round.

- Reuses the exact file-upload infrastructure already built for tasks: an idea's own id stands in for a task id, under a new "idea_media" category. Zero new storage code needed.
- New: canAccessIdeaMedia() in lib/supabaseAdmin.js re-checks an idea's own is_private rule inside all four file endpoints (upload-url, list, download-url, delete), since those endpoints otherwise have no way to know a taskId might actually be a private idea.
- delete.js now also lets a client remove an idea_media file they personally uploaded (still can't delete anything else), consistent with clients already fully managing their own captured ideas.
- Frontend: clicking any idea card (matrix or flat list) opens a detail modal with its body/link plus an Attachments section, using the same upload/download/delete controls as task files.
- jsdom smoke test now 166/166 passing.

## v1.13.0 (2026-09-19)
A full front-to-back audit turned up real bugs and gaps; all fixed in one pass.

- Promoting an idea now carries its body/link/category onto the new task's description (both paths), and attached idea_media files get re-parented onto the new task under "Media Files (raw)" instead of staying orphaned.
- Ideas can now be fully edited after capture (title, body, link, category, pillar) from the detail modal -- previously capture-only. The pillar picker there also serves as the non-drag fallback for reassigning pillar, since native drag-and-drop doesn't work on touch devices and ideas had no alternative (tasks already did).
- "Inactive" accounts now actually restrict rep/client access everywhere (files, ideas, pillars, rhythm, client tasks/comments, and a rep's own direct board/task view) -- previously only hid the account from the admin's own selector. getAllowedAccountIds() is the single enforcement point; new Supabase RLS policy lets a rep's own browser check inactive status too.
- Admin Accounts screen no longer goes stale after inviting someone from it or reopening the panel.
- Settings-gear dropdown closes on any click elsewhere, not just the gear or Disconnect.
- A rep with multiple accounts gets prompted to pick one for the Ideas tab instead of a silent default.
- render() now restores focus/cursor position across re-renders -- enables smooth live-filtering inputs for the first time.
- New: live search box on the List view (admin/rep and client).
- New: "Idea pipeline" summary on the Dashboard when a specific account is in view.
- disconnect() clears idea/pillar/accounts-directory state too, not just core ClickUp data.
- jsdom smoke test now 184/184 passing.

## v1.14.0 (2026-09-19)
Feedback pass: a real bug fix plus four requested features.

- Fixed: opening the admin panel could sometimes show an empty Accounts screen until a hard refresh -- now always explicitly reloads the accounts directory when opened.
- New: admin panel restructured into Accounts / Invite & Users sub-tabs. Accounts has a search box and collapsible rows (name + user-count + active-toggle collapsed, expand for details/invite) -- keeps a growing account list from burying the invite form.
- New: dark/light theme toggle (sun/moon icon, both topnavs), remembered in localStorage, falls back to OS-level prefers-color-scheme. Introduced a --surface CSS variable for hardcoded white card backgrounds, plus dark-mode overrides for status-banner/badge colors.
- New: Idea Inbox filter tabs get a small colored dot matching their semantic color (amber for review, green for promoted, etc.) for at-a-glance scanning.
- New: account-wide message hub on the Dashboard when a specific account is in view -- a shared thread (new account_messages table) distinct from the per-task Log, for general updates/questions. Admin/rep/client all see and can post to the same thread.
- jsdom smoke test now 190/190 passing.

## v1.15.0 (2026-09-20)
Fixed a broken upload path, reworked topnav navigation, and added a cross-entry activity feed.

- Fixed: files_category_check was never updated when idea_media was introduced, so every idea attachment upload failed at the database level -- fixed directly in Supabase.
- Fixed: account-filter dropdown options were nearly unreadable (near-white text on the browser's own white options-list background) -- now explicitly dark.
- Fixed a real dark-mode contrast bug: --ink was double-duty as both fixed chrome color and flippable heading text color. Split into --ink (chrome, constant) and --heading (text, flips per theme).
- Settings menu consolidated: theme, sync, and Admin panel access all moved into the one gear menu. New "Edit profile" modal (display name via new /api/profile, email + password via Supabase Auth). Sign out lives in the same menu.
- Clicking the ContentFlow logo returns to Dashboard (or the main board, from the admin panel).
- Tabs now have icons and color-grouping: Dashboard and Ideas each get their own color; Board/List/Calendar/Feed share one color to read as the same underlying workflow.
- New: Feed view -- a merged chronological timeline of comments across every entry in view, reusing the same account-filtering as Board/List/Calendar. Capped at the 60 most-recently-updated entries (ClickUp has no bulk comment endpoint).
- jsdom smoke test now 208/208 passing.

## v1.16.0 (2026-09-20)
Brand Foundation: the strategic layer underneath pillars.

- New per-account document (new brand_foundations table + /api/brand-foundation): positioning (niche, elevator pitch, value proposition), audience buckets (demographics, psychographics, pain points, goals), expertise/offers (Features/Advantages/Benefits), and reusable voice/keyword/CTA/hook material.
- Accessed via a new "Foundation" button next to Pillars & Rhythm in the Ideas tab.
- Admin/rep fully edit (audience buckets and offers are dynamic add/remove lists); clients get read-only, enforced server-side (POST is admin/rep only) and by never showing the Edit button.
- Read view has a Copy button next to every reusable block (elevator pitch, value prop, keywords, CTA lines, hook lines).
- Phase 1 of 3 -- guided wizard pacing and pillar auto-suggestion from Foundation content are deliberately deferred until this shape proves out.
- jsdom smoke test now 220/220 passing.

## v1.17.0 (2026-09-20)
Brand Foundation now supports multiple named profiles per account instead of just one.

- brand_foundations moved from account_id-as-primary-key to its own id, with name and is_active columns; a partial unique index enforces exactly one active profile per account at the database level.
- /api/brand-foundation gained create/update/setActive/delete actions in place of a single upsert.
- Foundation view now shows a profile switcher (★ marks the current one), + New profile, Set as current, and Delete controls -- all admin/rep only.
- A brand-new profile becomes current by default; deleting the current one auto-promotes the next most recent survivor so an account is never left without an active profile.
- jsdom smoke test now 232/232 passing.

## v1.18.0 (2026-09-20)
Fixed a mobile nav bug, added notebook links, a Prompt Library, and the ability to duplicate a Foundation profile.

- Fixed: topnav view-tabs had no overflow handling -- on narrow phones later tabs got cut off with no way to reach them. Tab bar now scrolls horizontally.
- New: "Duplicate" on a Foundation profile -- pre-fills a new-profile form from the currently viewed one instead of blank.
- New: admin-only Notebook link (external notes doc URL) on both a Brand Foundation profile and an individual content entry (new task_notebook_links table + /api/task-notebook, since tasks live in ClickUp not our database). Rep and client never see this field.
- New: Prompt Library inside each Foundation profile (new prompt_library table + /api/prompt-library, admin/rep write, everyone-with-access read). Reusable prompt templates with {{tag}} placeholders (elevator_pitch, keywords, cta_lines, etc.) that resolve against that profile's data -- separate Copy buttons for raw template vs. resolved text. No AI generation involved.
- jsdom smoke test now 250/250 passing.

## v1.19.0 (2026-09-20)
Corrected the content-entry notebook link's design after clarifying the actual requirement.

- It's now a real ClickUp custom field (NOTEBOOK_FIELD_NAME = "Notebook Link" -- update if your list's field is named differently), read-only within ContentFlow, editable only directly in ClickUp.
- v1.18.0 had built this as a separate editable Supabase table (task_notebook_links) + endpoint (/api/task-notebook) -- both removed now.
- buildTaskDraft() reads the field's current value the same way it already reads Medium(s)/Next Action Date/etc; shown to admin only, no edit control at all.
- Brand Foundation's own notebook_url is unaffected -- a Foundation profile has no ClickUp entry to read from, so it stays manually set within ContentFlow.
- jsdom smoke test now 253/253 passing.

## v1.19.1 (2026-09-20)
Confirmed the notebook-link field name and made the read defensive.

- Confirmed: field is exactly "Notebook Link", a website/url-type custom field on every entry in the Client Master Content Strategy Workflow list -- matches NOTEBOOK_FIELD_NAME.
- Since ClickUp's precise JSON shape for a website-type field's value can't be verified from here, added extractNotebookUrl() to also unwrap a {url: "..."}-shaped value, not just a plain string -- so this can't silently go blank if the actual shape differs.
- jsdom smoke test now 254/254 passing.

## v1.20.0 (2026-09-20)
Multi-account client support.

- A client granted access to more than one business previously had no way to reach anything but whichever account came first -- Ideas/Foundation/Pillars/Rhythm/Feed silently locked to that one account, new entries could only be created under it, and the client topnav had no account concept.
- New account switcher in the client topnav, shown only when a client has more than one business. Defaults to a merged "All my businesses" view across Board/List/Dashboard/Feed, with the option to narrow to one.
- Ideas/Foundation/Pillars/Rhythm now follow the switcher instead of guessing.
- "+ New" capture form gained an account picker for multi-business clients.
- /api/client/tasks now accepts an optional accountId on POST, validated against the caller's own account_access.
- jsdom smoke test now 263/263 passing.

## v1.21.0 (2026-09-20)
Full system audit. Backend checked clean; four real frontend issues found and fixed.

- Backend: RLS confirmed enabled on all 10 tables, every endpoint pairs requireUser with CORS, no endpoint bypasses the inactive-account filter, files_category_check still matches the app's category list.
- Fixed: --accent-ink (text color on every account badge) was never actually defined -- only used via a fallback that happened to work in light mode. Dark mode had poor contrast on one of the most frequently-visible elements in the app.
- Fixed: disconnect() (called on every sign-out) never picked up Brand Foundation/Prompt Library/Feed/Message Hub/client-specific state added in later rounds -- a different person on the same browser session could briefly see the previous session's cached data.
- Fixed: Calendar date keys round-tripped through toISOString(), shifting items back a day for anyone at a positive UTC offset.
- Fixed (more serious): toClickUpDate() built its save timestamp from local midnight while fromClickUpDate() reads via UTC -- for a positive-UTC-offset viewer, picking and saving a date would silently save and redisplay as the day before, everywhere.
- All four covered by new regression tests, two of which explicitly run under TZ=Asia/Tokyo.
- jsdom smoke test now 273/273 passing.

## v1.22.0 (2026-09-20)
Ideas-area navigation fix (mobile-reported bug).

- Ideas/Capture, Pillars & Rhythm, and Foundation were mutually-exclusive full-screen replacements, each with its own entry button living only inside the Idea Inbox -- once inside one, there was no way back to the others without exiting completely. The Rhythm Wizard had no exit at all short of finishing it.
- New persistent ideasSubNavHtml() sub-nav (Ideas / Pillars & Rhythm / Foundation) wraps all three states and never disappears -- switching between them, or escaping the wizard without saving, is always one tap.
- Styled as underline tabs (distinct from the topnav's pill tabs) with the same horizontal-scroll safety as the earlier topnav fix.
- Removed the now-redundant per-view Foundation/Pillars & Rhythm buttons inside the Idea Inbox.
- jsdom smoke test now 281/281 passing.

## v1.23.0 (2026-09-20)
Social links on Brand Foundation, with quick-access links in the task modal.

- New SOCIAL_NETWORKS config (Instagram, Facebook, TikTok, X, LinkedIn, YouTube, Pinterest) -- input is always just the username.
- sanitizeSocialUsername() strips a pasted full URL or leading @ down to a clean value.
- Read-only display is a single plain https:// link per network (new social_links jsonb column) -- no custom app-scheme URL needed, since every one of these networks already registers universal/app links for its own domain. One ordinary web link opens the installed app on mobile and the browser tab on desktop automatically.
- Added to the admin/rep and client task modals via new activeSocialLinksFor() helper, reusing the existing Foundation cache -- opening any content entry shows quick-access links to that account's social profiles.
- LinkedIn defaults to /company/{username}; flagged as a one-line change if any account's LinkedIn is a personal-style profile.
- jsdom smoke test now 298/298 passing.

## v1.23.1 (2026-09-20)
LinkedIn now takes the full profile URL instead of a username.

- Resolves the /company/ vs. /in/ ambiguity flagged in v1.23.0 -- LinkedIn's SOCIAL_NETWORKS entry is marked isFullUrl: true.
- urlFor() uses the stored URL exactly as given (adding https:// only if the protocol was omitted) rather than reconstructing one.
- The input binding skips sanitizeSocialUsername() for LinkedIn specifically, since that sanitizer strips a pasted URL down to a bare username -- exactly what would destroy the company/personal distinction.
- Edit form shows a url-type input with a "Full ... profile URL" placeholder for LinkedIn; every other network keeps the plain username input.
- No backend change needed.
- jsdom smoke test now 305/305 passing.

## v1.24.0 (2026-09-27)
Real favicon and home-screen icons.

- The inline data-URI SVG favicon did nothing on iPhone: iOS Safari doesn't support SVG favicons, and apple-touch-icon needs a real file URL. It had also drifted into an inverted colour scheme versus the in-app logo.
- New icon set rendered by icon-src/gen.py straight from brandMarkSvg()'s path and colours: favicon.ico (16/32/48), favicon-16/32/48.png, apple-touch-icon.png (180, opaque), icon-192/512.png, icon-512-maskable.png, plus site.webmanifest (display "browser", so the ClickUp OAuth redirect stays inside the browser on iOS).
- 16/32/48px sizes get a heavier stroke and larger mark so they stay legible.
- First version that isn't a single self-contained index.html: the icons are sibling files.
- Known gap: the jsdom smoke suite lived outside the repo and was lost to a sandbox reset; not re-run for this version.

## v1.25.0 (2026-10-30)
In-app Guide.

- New guide.html beside index.html: a visual walkthrough of every screen, menu and setting, built from styled mockups of the real UI with numbered callouts. Covers the four-layer model, roles and a permissions matrix, sign-in and ClickUp connect, the top bar and Settings menu, Dashboard, the stage pipeline, Board/List/Calendar/Feed, the entry modal and client panel, file categories, the Ideas area (Pillars & Rhythm, Idea Inbox, idea lifecycle), Brand Foundation, Prompt Library, Log vs. Messages, profile/theme/sync, phone use, the Admin panel, admin recipes, troubleshooting and a glossary.
- Role switch (Everyone / Admin / Team member / Client) hides sections, notes, matrix columns and mockup callouts that don't apply. Light and dark themes, phone-width layout.
- Opened from a new "?" button in both topnavs, "Open the guide" in Settings, a Guide button in the admin panel (jumps to the Admin panel section), and links on the sign-in, ClickUp-connect and "Almost there" screens.
- openGuide() shows it in a full-screen layer appended to <body>, outside #app, so render() never reloads it; the guide keeps its place between opens. It passes embed=1, the viewer's role and the current theme; clients are kept on the client view. Theme toggles reach an open guide via the contentflow.theme storage event. Escape closes it from either document.
- Also ships v1.24.0's icon files, which had not reached the repo.
- Verified with a Playwright run against a stubbed Supabase client (admin, rep, client, signed out): 46/46 checks passing, including no iframe reload across app re-renders, Escape from inside the guide, theme propagation and the admin-panel deep link. The old jsdom suite is still not rebuilt.
