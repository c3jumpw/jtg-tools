/*
 * ContentFlow change log -- every release, in plain language, newest last.
 *
 * The single source for:
 *   - Admin panel › Change log (the full history, filterable, exportable);
 *   - the "What's new" window each person sees once after an update, showing
 *     only the items whose `roles` include their role;
 *   - the tour's What's new page.
 *
 * Every release adds one entry at the END (RELEASING.md step 2;
 * tests/tour/check.js fails without it). Fields:
 *   version, date (YYYY-MM-DD), title, summary
 *   items: [{ type: 'new' | 'improved' | 'fixed',
 *             title,            short headline
 *             text,             one or two plain sentences, from the user's side
 *             roles,            who it affects: any of 'admin', 'rep', 'client'
 *             area,             where in the app (Board, Ideas, Admin panel...)
 *             step,             optional tour step id: What's new shows a
 *                               close-up of its screenshot, "Show me" opens it
 *             focus }]          optional: which of that step's highlights
 *                               (0 = first) the close-up centres on
 * Write for the people using ContentFlow, not for developers; the technical
 * history stays in index.html's version comments and versions/contentflow/CHANGELOG.md.
 */
(function (root) {
  'use strict';
  var ALL = ['admin', 'rep', 'client'];
  var TEAM = ['admin', 'rep'];
  var ADMIN = ['admin'];
  var CLIENT = ['client'];

  var RELEASES = [
    {
      version: '1.0.0', date: '2026-09-08', title: 'ContentFlow opens',
      summary: 'The production board for the Client Master Content Strategy Workflow list, synced with ClickUp.',
      items: [
        { type: 'new', title: 'Board and List', text: 'See every content entry as cards by stage, or as a table, straight from ClickUp.', roles: ALL, area: 'Board', step: 'board' },
        { type: 'new', title: 'Calendar', text: 'A month view of entries by their dates.', roles: TEAM, area: 'Calendar', step: 'calendar' },
        { type: 'new', title: 'Edit entries in place', text: 'Change stage, dates, mediums and assignees, and drag cards between stages.', roles: TEAM, area: 'Entries', step: 'entry' },
      ],
    },
    {
      version: '1.1.0', date: '2026-09-19', title: 'Sign-in and roles',
      summary: 'Everyone signs in to ContentFlow, with three roles deciding what each person sees.',
      items: [
        { type: 'new', title: 'Sign in with email and password', text: 'Each person has a ContentFlow login, with the role admin, team member or client.', roles: ALL, area: 'Sign-in', step: 'sign-in' },
        { type: 'new', title: 'Connect with ClickUp sign-in', text: 'Admins and team members link ClickUp by approving access, instead of pasting a token.', roles: TEAM, area: 'Sign-in', step: 'connect-clickup' },
        { type: 'new', title: 'Team members see their own accounts', text: 'A team member only sees the accounts they are assigned to.', roles: TEAM, area: 'Access' },
        { type: 'new', title: 'Client view', text: 'Clients see their own content on a Board and List and can comment, with no ClickUp account needed.', roles: ['admin', 'client'], area: 'Board' },
        { type: 'new', title: 'Admin panel', text: 'Invite people and choose their role and accounts.', roles: ADMIN, area: 'Admin panel', step: 'admin-invite' },
      ],
    },
    {
      version: '1.2.0', date: '2026-09-19', title: 'Dashboard',
      summary: 'A Dashboard of what is due and where everything stands.',
      items: [
        { type: 'new', title: 'Dashboard', text: 'Totals, entries by stage and by account, and a list of what is overdue or due this week.', roles: ALL, area: 'Dashboard', step: 'dashboard' },
        { type: 'improved', title: 'Simpler ClickUp connection', text: 'Connecting ClickUp no longer asks for a list ID.', roles: TEAM, area: 'Sign-in' },
        { type: 'new', title: '"Almost there" screen', text: 'Clients whose login isn’t linked to a business yet see a clear waiting screen instead of an empty board.', roles: CLIENT, area: 'Sign-in' },
      ],
    },
    {
      version: '1.3.0', date: '2026-09-19', title: 'Reliable ClickUp connection',
      summary: 'ClickUp requests now go through ContentFlow’s own server.',
      items: [
        { type: 'fixed', title: '"Could not reach ClickUp"', text: 'Boards failed to load after connecting ClickUp. They load reliably now.', roles: TEAM, area: 'Board' },
        { type: 'fixed', title: '"Failed to fetch" while connecting', text: 'The ClickUp connect step could fail outright. Fixed.', roles: TEAM, area: 'Sign-in' },
      ],
    },
    {
      version: '1.4.0', date: '2026-09-19', title: 'Account names everywhere',
      summary: 'Real account names replace IDs, and mediums get their colours.',
      items: [
        { type: 'improved', title: 'Account names instead of IDs', text: 'Filters, cards, the List and the Dashboard show account names, sorted A to Z.', roles: ALL, area: 'Board' },
        { type: 'improved', title: 'Pick an entry’s account by name', text: 'The account sits as a badge at the top of each entry.', roles: ADMIN, area: 'Entries', step: 'entry' },
        { type: 'improved', title: 'Coloured mediums', text: 'Mediums use their ClickUp colours everywhere.', roles: ALL, area: 'Board' },
        { type: 'improved', title: 'Comments are now the Log', text: 'Each entry’s comment thread is called its Log.', roles: ALL, area: 'Entries' },
      ],
    },
    {
      version: '1.5.0', date: '2026-09-19', title: 'Files on every entry',
      summary: 'Six file categories per entry, two of them shared with clients.',
      items: [
        { type: 'new', title: 'Files on entries', text: 'Copy / Drafts, Notes, Media Extractions and Media Files (raw) for the team; Published / Final and Client Assets shared with the client.', roles: ALL, area: 'Files', step: 'entry' },
        { type: 'new', title: 'Clients can upload', text: 'Clients add logos, photos and reference under Client Assets.', roles: CLIENT, area: 'Files', step: 'entry-client' },
      ],
    },
    {
      version: '1.6.0', date: '2026-09-19', title: 'Stuck work and the review check',
      summary: 'The Dashboard flags stalled entries; moving to review checks for a draft.',
      items: [
        { type: 'new', title: 'Stuck entries', text: 'The Dashboard flags open entries with no next action date and no activity for 7+ days.', roles: ALL, area: 'Dashboard', step: 'dashboard' },
        { type: 'new', title: 'For Review reminder', text: 'Moving an entry into For Review without a draft or raw media asks you to confirm.', roles: TEAM, area: 'Entries' },
      ],
    },
    {
      version: '1.7.0', date: '2026-09-19', title: 'A better Log and phone fixes',
      summary: 'Timestamps in the Log, uploads noted automatically, and a phone layout pass.',
      items: [
        { type: 'improved', title: 'Log with times', text: 'Log entries show when they were posted, newest first, folded to the latest four.', roles: ALL, area: 'Entries', step: 'entry-log' },
        { type: 'new', title: 'Uploads noted in the Log', text: 'Every upload adds a line to the entry’s Log.', roles: ALL, area: 'Files' },
        { type: 'improved', title: 'Accounts found either way', text: 'An entry finds its account whether ClickUp has it as text or as a linked task.', roles: TEAM, area: 'Entries' },
        { type: 'fixed', title: 'Phone layout', text: 'The client entry panel, admin user table and top bar now fit small screens, with bigger tap targets.', roles: ALL, area: 'Phone', step: 'phone' },
      ],
    },
    {
      version: '1.8.0', date: '2026-09-19', title: 'Clients can request content',
      summary: 'Clients add their own requests; only admins move entries between accounts.',
      items: [
        { type: 'new', title: '+ New for clients', text: 'Clients send their team a new request in one line.', roles: CLIENT, area: 'Entries', step: 'new-entry' },
        { type: 'improved', title: 'Only admins move entries between accounts', text: 'Team members see an entry’s account but can’t change it.', roles: TEAM, area: 'Entries' },
        { type: 'improved', title: 'Your account filled in', text: 'A team member with one account gets it set on new entries automatically.', roles: ['rep'], area: 'Entries' },
        { type: 'fixed', title: '"No account" mismatch', text: 'An entry could say "No account" while its card showed the right one.', roles: TEAM, area: 'Entries' },
      ],
    },
    {
      version: '1.9.0', date: '2026-09-19', title: 'Ideas',
      summary: 'A place for raw ideas before they become work.',
      items: [
        { type: 'new', title: 'Ideas tab', text: 'Capture ideas as they come, sorted by content pillar. Nothing is real work until you promote it.', roles: ALL, area: 'Ideas', step: 'ideas' },
        { type: 'new', title: 'Pillars & Rhythm', text: 'Set where ideas come from, the time you have each week, and the themes you post about.', roles: ALL, area: 'Ideas', step: 'rhythm' },
        { type: 'new', title: 'Promote', text: 'Turn an idea into a content entry on the Board.', roles: ALL, area: 'Ideas', step: 'ideas' },
      ],
    },
    {
      version: '1.10.0', date: '2026-09-19', title: 'Accounts screen and the idea board',
      summary: 'Admins manage accounts; ideas sort into pillar columns.',
      items: [
        { type: 'new', title: 'Accounts screen', text: 'Switch accounts on or off, see who has access, and invite someone to an account.', roles: ADMIN, area: 'Admin panel', step: 'admin-accounts' },
        { type: 'improved', title: 'Ideas in pillar columns', text: 'Drag ideas between pillars to re-sort them.', roles: ALL, area: 'Ideas', step: 'ideas' },
        { type: 'new', title: 'Pipeline health', text: '"6 ideas waiting, about 3 weeks of material at your pace."', roles: ALL, area: 'Ideas' },
        { type: 'improved', title: 'Settings menu', text: 'Disconnect ClickUp moved into a Settings menu.', roles: TEAM, area: 'Settings' },
        { type: 'fixed', title: 'Promoted ideas keep their account', text: 'A promoted idea could land with no account.', roles: ALL, area: 'Ideas' },
        { type: 'fixed', title: 'Every account selectable', text: 'Accounts with no entries yet can be picked too.', roles: TEAM, area: 'Board' },
      ],
    },
    {
      version: '1.11.0', date: '2026-09-19', title: 'Links, notes and private ideas',
      summary: 'Richer capture and filters for the Idea Inbox.',
      items: [
        { type: 'new', title: 'Capture links and notes', text: 'Links start flagged Needs review so they get looked at.', roles: ALL, area: 'Ideas', step: 'capture' },
        { type: 'new', title: 'Private ideas', text: 'Keep an idea to yourself (admins can still see it).', roles: ALL, area: 'Ideas', step: 'capture' },
        { type: 'new', title: 'Idea filters', text: 'Active, Needs Review, Archived and Promoted, plus newest or oldest first.', roles: ALL, area: 'Ideas' },
      ],
    },
    {
      version: '1.12.0', date: '2026-09-19', title: 'Files on ideas',
      summary: 'Keep media with the idea it belongs to.',
      items: [
        { type: 'new', title: 'Attach files to ideas', text: 'Photos, voice memos and old media stay with the idea.', roles: ALL, area: 'Ideas', step: 'idea-detail' },
      ],
    },
    {
      version: '1.13.0', date: '2026-09-19', title: 'Fixes from a full review',
      summary: 'Ideas carry over properly, switched-off accounts lock everywhere, and List gets search.',
      items: [
        { type: 'improved', title: 'Promoted ideas bring their details', text: 'Details, link, category and files move into the new entry.', roles: ALL, area: 'Ideas' },
        { type: 'new', title: 'Edit ideas', text: 'Fix or extend an idea after capturing it; re-file it from the idea on a phone.', roles: ALL, area: 'Ideas', step: 'idea-detail' },
        { type: 'new', title: 'Search the List', text: 'Filter entries by name as you type.', roles: ALL, area: 'List', step: 'list' },
        { type: 'new', title: 'Idea pipeline on the Dashboard', text: 'Active ideas and pace for the account you’re viewing.', roles: ALL, area: 'Dashboard', step: 'dashboard' },
        { type: 'fixed', title: 'Switched-off accounts', text: 'Switching an account off now locks team members and clients out of it everywhere.', roles: ALL, area: 'Access' },
        { type: 'improved', title: 'Pick an account for Ideas', text: 'Team members with several accounts choose one instead of getting the first.', roles: ['rep'], area: 'Ideas' },
      ],
    },
    {
      version: '1.14.0', date: '2026-09-19', title: 'Dark mode and Messages',
      summary: 'A dark theme, and one shared conversation per account.',
      items: [
        { type: 'new', title: 'Dark mode', text: 'Switch it in Settings; ContentFlow remembers your choice.', roles: ALL, area: 'Settings', step: 'settings' },
        { type: 'new', title: 'Messages', text: 'A shared conversation per account on the Dashboard, for anything not tied to one post.', roles: ALL, area: 'Dashboard', step: 'dashboard' },
        { type: 'improved', title: 'Admin panel tabs', text: 'Accounts and Invite & Users are separate tabs, with account search.', roles: ADMIN, area: 'Admin panel', step: 'admin-accounts' },
        { type: 'fixed', title: 'Empty Accounts screen', text: 'The Accounts screen could open empty.', roles: ADMIN, area: 'Admin panel' },
      ],
    },
    {
      version: '1.15.0', date: '2026-09-20', title: 'Feed and the Settings menu',
      summary: 'Every conversation in one timeline, and one menu for settings.',
      items: [
        { type: 'new', title: 'Feed', text: 'Every Log comment across your entries, newest first.', roles: ALL, area: 'Feed', step: 'feed' },
        { type: 'new', title: 'Settings menu and Edit profile', text: 'Theme, sync, your name, email and password in one place.', roles: ALL, area: 'Settings', step: 'profile' },
        { type: 'improved', title: 'Tabs with icons', text: 'Tabs have icons and colours; the logo returns to the Dashboard.', roles: ALL, area: 'Navigation', step: 'top-bar' },
        { type: 'fixed', title: 'Uploading files to ideas', text: 'Idea attachments failed to upload.', roles: ALL, area: 'Ideas' },
      ],
    },
    {
      version: '1.16.0', date: '2026-09-20', title: 'Brand Foundation',
      summary: 'The account’s strategy on one page.',
      items: [
        { type: 'new', title: 'Brand Foundation', text: 'Positioning, audience, offers and voice, with Copy buttons for reusable lines. Clients can read it.', roles: ALL, area: 'Foundation', step: 'foundation' },
      ],
    },
    {
      version: '1.17.0', date: '2026-09-20', title: 'Foundation profiles',
      summary: 'Keep more than one version of a brand’s strategy.',
      items: [
        { type: 'new', title: 'Several profiles', text: 'Keep past and current positioning side by side; one is marked current.', roles: ALL, area: 'Foundation', step: 'foundation' },
      ],
    },
    {
      version: '1.18.0', date: '2026-09-20', title: 'Prompt Library',
      summary: 'Reusable prompts that fill in from the brand, and a phone tab fix.',
      items: [
        { type: 'new', title: 'Prompt Library', text: 'Save prompts with {{tags}} that fill in from the Foundation, ready to paste into any AI tool.', roles: ALL, area: 'Foundation', step: 'prompts' },
        { type: 'new', title: 'Duplicate a profile', text: 'Start a new Foundation profile from an existing one.', roles: TEAM, area: 'Foundation', step: 'foundation' },
        { type: 'new', title: 'Notebook link on profiles', text: 'An admin-only link to the account’s private notes.', roles: ADMIN, area: 'Foundation' },
        { type: 'fixed', title: 'Tabs cut off on phones', text: 'The tab bar now scrolls sideways.', roles: ALL, area: 'Phone', step: 'phone' },
      ],
    },
    {
      version: '1.19.0', date: '2026-09-20', title: 'Notebook links from ClickUp',
      summary: 'An entry’s Notebook link now comes from ClickUp.',
      items: [
        { type: 'improved', title: 'Notebook link on entries', text: 'Shown to admins from ClickUp’s Notebook Link field, and edited only in ClickUp.', roles: ADMIN, area: 'Entries', step: 'entry' },
      ],
    },
    {
      version: '1.19.1', date: '2026-09-20', title: 'Notebook link fix',
      summary: 'Notebook links show reliably.',
      items: [
        { type: 'fixed', title: 'Notebook links read reliably', text: 'Every format ClickUp can send is understood.', roles: ADMIN, area: 'Entries' },
      ],
    },
    {
      version: '1.20.0', date: '2026-09-20', title: 'Several businesses per client',
      summary: 'One login for clients who run more than one business.',
      items: [
        { type: 'new', title: 'Switch between businesses', text: 'See all your businesses together, or pick one.', roles: CLIENT, area: 'Navigation', step: 'businesses' },
        { type: 'new', title: 'Choose the business for a request', text: 'New requests ask which business they’re for.', roles: CLIENT, area: 'Entries', step: 'new-entry' },
        { type: 'improved', title: 'Give a client several businesses', text: 'List each business’s MKC ID when inviting.', roles: ADMIN, area: 'Admin panel', step: 'admin-invite' },
      ],
    },
    {
      version: '1.21.0', date: '2026-09-20', title: 'Dates and sign-out fixes',
      summary: 'Fixes from a full system check.',
      items: [
        { type: 'fixed', title: 'Dates a day early', text: 'In some time zones, saved dates and Calendar items could land a day early.', roles: TEAM, area: 'Calendar', step: 'calendar' },
        { type: 'fixed', title: 'Clean sign-out', text: 'Signing out now clears everything from the previous session on that browser.', roles: ALL, area: 'Settings' },
        { type: 'fixed', title: 'Account badges in dark mode', text: 'Badges were hard to read in dark mode.', roles: ALL, area: 'Board' },
      ],
    },
    {
      version: '1.22.0', date: '2026-09-20', title: 'Ideas navigation',
      summary: 'The three Ideas pages are always one tap apart.',
      items: [
        { type: 'fixed', title: 'Move between Ideas pages', text: 'Ideas, Pillars & Rhythm and Foundation are always one tap apart, including on phones.', roles: ALL, area: 'Ideas', step: 'ideas' },
      ],
    },
    {
      version: '1.23.0', date: '2026-09-20', title: 'Social links',
      summary: 'Each brand’s social profiles, one tap away.',
      items: [
        { type: 'new', title: 'Social links', text: 'Add each network on the Brand Foundation; the links open the profile, in the app on a phone.', roles: ALL, area: 'Foundation', step: 'foundation' },
        { type: 'new', title: 'Social links in entries', text: 'Every entry shows its account’s social links.', roles: ALL, area: 'Entries', step: 'entry' },
      ],
    },
    {
      version: '1.23.1', date: '2026-09-20', title: 'LinkedIn links',
      summary: 'LinkedIn takes the full profile address.',
      items: [
        { type: 'improved', title: 'LinkedIn full URL', text: 'Company and personal LinkedIn pages both link correctly.', roles: TEAM, area: 'Foundation' },
      ],
    },
    {
      version: '1.24.0', date: '2026-09-27', title: 'App icon',
      summary: 'ContentFlow’s own icon.',
      items: [
        { type: 'new', title: 'Icon for tabs and home screens', text: 'Add ContentFlow to your phone’s home screen with its own icon.', roles: ALL, area: 'Phone', step: 'phone' },
      ],
    },
    {
      version: '1.25.0', date: '2026-10-30', title: 'The guide',
      summary: 'A visual guide to every screen.',
      items: [
        { type: 'new', title: 'Guide', text: 'Every screen, menu and setting explained, set to your role. Under the ? button.', roles: ALL, area: 'Help', step: 'top-bar' },
      ],
    },
    {
      version: '1.26.0', date: '2026-11-18', title: 'Step-by-step tour',
      summary: 'A tour built from real screenshots, and fixes those screenshots exposed.',
      items: [
        { type: 'new', title: 'Getting started tour', text: 'A step-by-step tour for your role with a real screenshot of every screen, under the ? button and in Settings.', roles: ALL, area: 'Help', step: 'top-bar' },
        { type: 'fixed', title: 'Notebook links stay read-only', text: 'The Notebook Link field no longer shows as an editable box inside entries.', roles: TEAM, area: 'Entries', step: 'entry' },
        { type: 'fixed', title: 'The For Review check works', text: 'Moving an entry into For Review with no draft or raw media now asks you first.', roles: TEAM, area: 'Entries' },
        { type: 'fixed', title: 'Stages in order', text: 'The Board and the Dashboard list stages from Idea to Published.', roles: ALL, area: 'Board', step: 'board' },
        { type: 'fixed', title: 'Entry panel layout', text: 'Each heading in an opened entry now sits with its content.', roles: CLIENT, area: 'Entries', step: 'entry-client' },
        { type: 'fixed', title: 'Easier-to-see buttons', text: 'Close, delete and filter buttons were hard to see in light mode.', roles: ALL, area: 'Design' },
      ],
    },
    {
      version: '1.27.0', date: '2026-11-20', title: 'Change log and What’s new',
      summary: 'A full history of ContentFlow for admins, and a short note for everyone after each update.',
      items: [
        { type: 'new', title: 'What’s new after updates', text: 'After an update, ContentFlow shows you once what changed for your role, with a picture of each change. Settings › What’s new shows it again.', roles: ALL, area: 'Help', step: 'settings', focus: 2 },
        { type: 'new', title: 'Change log', text: 'Admin panel › Change log lists every release since the first, filterable by role and type, with who has seen the latest update. Export it as CSV or JSON.', roles: ADMIN, area: 'Admin panel', step: 'admin-changelog', focus: 2 },
        { type: 'improved', title: 'Remembered on every device', text: 'Once you’ve seen an update’s notes, you won’t be shown them again on another phone or computer.', roles: ALL, area: 'Help' },
      ],
    },
    {
      version: '1.27.1', date: '2026-11-21', title: 'New address',
      summary: 'ContentFlow moved to jtg-tools.mkcworkspace.com with the rest of the JTG tools.',
      items: [
        { type: 'improved', title: 'ContentFlow has a new address', text: 'ContentFlow is now at jtg-tools.mkcworkspace.com/content-strategy-workflow/. Update your bookmark: the old jtgworkspace.com address no longer opens it. Your entries, ideas and files are unchanged.', roles: ALL, area: 'Sign-in' },
        { type: 'improved', title: 'Sign in once more', text: 'Browsers remember sign-ins per address, so you sign in again once at the new address.', roles: ALL, area: 'Sign-in', step: 'sign-in' },
        { type: 'improved', title: 'Reconnect ClickUp once', text: 'At the new address, connect ClickUp again the first time you sign in. It takes one click on ClickUp’s approval screen.', roles: TEAM, area: 'Sign-in', step: 'connect-clickup' },
      ],
    },
  ];

  var CHANGELOG = { releases: RELEASES };
  if (typeof module !== 'undefined' && module.exports) module.exports = CHANGELOG;
  else root.CF_CHANGELOG = CHANGELOG;
})(this);
