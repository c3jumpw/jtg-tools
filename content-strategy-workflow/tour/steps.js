/*
 * ContentFlow getting-started tour: the single source of truth for every
 * tour step, for every role.
 *
 * Read by three things:
 *   - tour.html, which shows the steps;
 *   - tests/tour/capture.js, which drives the REAL app (on demo data) to the
 *     screen each step describes and saves the screenshot + highlight boxes
 *     to tour/shots/ and tour/manifest.js;
 *   - tests/tour/check.js, which fails the release when a page, menu item or
 *     tab exists in the app that no step covers, or when the screenshots were
 *     captured from an older index.html.
 *
 * Per-role text: any of title/body/points/shot.actions/shot.highlight may be
 * an object keyed by role ({ admin, rep, client, default }).
 * points[i] is the note for highlight ring i+1; extra points have no ring.
 * shot.actions run in order before the screenshot:
 *   ['click', selector] ['select', selector, value] ['fill', selector, text]
 *   ['wait', selector] ['waitMs', ms] ['scrollTo', selector]
 * Selectors are Playwright selectors (CSS, plus :has-text() / >> nth=N).
 * covers: feature ids from the app (see check.js) this step explains.
 */
(function (root) {
  'use strict';

  var HP = '86demo101';   // demo account "Harbor & Pine Coffee" (tests/demo/demo-env.js)
  var ROAST = '86demo102'; // "Harbor & Pine Roastery"

  var pickHarbor = ['select', '#account-filter-select', HP];

  var TOUR = {
    // The release these steps were written for. check.js requires this to
    // match APP_VERSION in index.html, so every release gets a review here.
    version: '1.27.0',

    roles: {
      admin: { label: 'Admin', blurb: 'Run the workspace: people, accounts and all the content in between.' },
      rep: { label: 'Team member', blurb: 'Produce content for the accounts you are assigned.' },
      client: { label: 'Client', blurb: 'Follow your content, add ideas and files, and talk to your team.' },
    },

    // What's new notes live in changelog.js (one entry per release, tagged by
    // role), which feeds the app's What's new window, Admin › Change log and
    // this tour's What's new page.

    sections: ['Getting in', 'Find your way', 'Production', 'Ideas & strategy', 'Settings', 'Admin'],

    steps: [
      // ------------------------------------------------------------------ Getting in
      {
        id: 'sign-in', section: 'Getting in', roles: ['admin', 'rep', 'client'], guide: 'getting-in',
        title: 'Sign in',
        body: 'Your admin invites you by email. Follow the link in the invitation, then sign in here any time with your email and password.',
        points: ['The email address your invitation went to.', 'Your password. Change it later under Settings › Edit profile.', 'Sign in. The link below it opens this tour.'],
        covers: ['screen:login'],
        shot: { boot: { signedOut: true }, actions: [['wait', '#login-form']], highlight: ['#login-email', '#login-password', '#login-form button[type=submit]'] },
      },
      {
        id: 'connect-clickup', section: 'Getting in', roles: ['admin', 'rep'], guide: 'getting-in',
        title: 'Connect ClickUp once',
        body: 'Content entries live in ClickUp, so admins and team members link their own ClickUp login. Use the login that can already open the Client Master Content Strategy Workflow list.',
        points: ['Keep this ticked to stay connected on this device. Untick it on a shared computer.', 'Approve ContentFlow in ClickUp and you are brought straight back here.'],
        covers: ['screen:connect'],
        shot: { boot: { noCreds: true }, actions: [['wait', '#connect-form']], highlight: ['.remember-row', '#connect-form button[type=submit]'] },
      },

      // ------------------------------------------------------------------ Find your way
      {
        id: 'top-bar', section: 'Find your way', roles: ['admin', 'rep', 'client'], guide: 'navigation',
        title: 'The top bar',
        body: {
          default: 'The dark bar is the same on every screen. Tabs on the left switch views; controls on the right act on the whole app.',
          client: 'The dark bar is the same on every screen. Tabs on the left switch views; controls on the right act on the whole app. Your team keeps everything here up to date.',
        },
        points: {
          default: ['The logo always brings you back to the Dashboard.', 'Ideas (amber), Dashboard (blue), then Board, List, Calendar and Feed: four views of the same content entries.', 'The account filter narrows every view to one account, or shows all of them.', '+ New starts a new content entry.', '? opens this tour and the full guide.', 'Settings: theme, sync, your profile and sign out.'],
          rep: ['The logo always brings you back to the Dashboard.', 'Ideas (amber), Dashboard (blue), then Board, List, Calendar and Feed: four views of the same content entries.', 'The account filter lists only the accounts you are assigned to.', '+ New starts a new content entry.', '? opens this tour and the full guide.', 'Settings: theme, sync, your profile and sign out.'],
          client: ['The logo always brings you back to the Dashboard.', 'Ideas, Dashboard, then Board, List and Feed: three views of your content.', 'With more than one business you can switch between them here. All my businesses mixes them together.', '+ New sends your team a new request.', '? opens this tour and the full guide.', 'Settings: theme, sync, your profile and sign out.'],
        },
        covers: ['view:dashboard', 'topnav:open-help'],
        shot: {
          actions: [['click', '.topnav [data-view="dashboard"] >> nth=0'], ['wait', '.dashboard']],
          highlight: {
            default: ['.topnav .brand', '.topnav .view-tabs', '#account-filter-select', '.topnav [data-action="new-task"]', '.topnav [data-action="open-help"]', '.topnav [data-action="toggle-settings-menu"]'],
            client: ['.topnav .brand', '.topnav .view-tabs', '#account-filter-select', '.topnav [data-action="client-new-task"]', '.topnav [data-action="open-help"]', '.topnav [data-action="toggle-settings-menu"]'],
          },
        },
      },
      {
        id: 'businesses', section: 'Find your way', roles: ['client'], guide: 'client-start',
        title: 'Switch between your businesses',
        body: 'If you run more than one business, they all live under one login. Everything follows the business you pick here: Board, List, Dashboard, Feed, Ideas and Foundation.',
        points: ['Pick one business to focus on it, or All my businesses to see everything together.', 'Each card shows which business it belongs to.'],
        covers: [],
        shot: { actions: [['click', '.topnav [data-view="board"] >> nth=0'], ['select', '#account-filter-select', ROAST], ['wait', '.board']], highlight: ['#account-filter-select', '.card .account-badge >> nth=0'] },
      },
      {
        id: 'dashboard', section: 'Find your way', roles: ['admin', 'rep', 'client'], guide: 'dashboard',
        title: 'Dashboard: what needs you today',
        body: 'The Dashboard sums up whatever the account filter shows. Pick one account to also see its idea pipeline and its message thread.',
        points: {
          default: ['Totals. Overdue and Due this week come from each entry’s Next Action Date; Stuck means no next step and no activity for 7+ days.', 'Idea pipeline: ideas waiting and how many weeks of material they make at this account’s pace.', 'Messages: one shared conversation per account, for anything not tied to a single post.'],
          client: ['Totals for your content. Overdue and Due this week follow the dates your team sets.', 'Idea pipeline: ideas waiting and how many weeks of material they make.', 'Messages: one shared conversation with your team, for anything not tied to a single post.'],
        },
        covers: ['view:dashboard'],
        shot: {
          viewport: { width: 1280, height: 960 },
          actions: [['click', '.topnav [data-view="dashboard"] >> nth=0'], pickHarbor, ['wait', '#account-message-form'], ['waitMs', 300]],
          highlight: ['.dashboard .dash-stats >> nth=0', '.dashboard .dash-stats >> nth=1', '#account-message-form'],
        },
      },

      // ------------------------------------------------------------------ Production
      {
        id: 'board', section: 'Production', roles: ['admin', 'rep', 'client'], guide: 'board',
        title: 'Board: every entry by stage',
        body: {
          default: 'One column per stage, one card per piece of content. Stage names and colours come straight from ClickUp.',
          client: 'One column per stage, one card per piece of content, in workflow order from Idea to Published. Your Board is view-only; tap a card to open it.',
        },
        points: {
          default: ['A stage, with how many entries are in it.', 'A card: account, title, where it will be posted, who is on it. Click to open.', 'Drag a card to another column to change its stage (on a phone, use Status inside the entry).', '+ Add task opens a blank entry.'],
          client: ['A stage, with how many of your entries are in it.', 'A card: business, title and where it will be posted. Tap to open.'],
        },
        covers: ['view:board'],
        shot: {
          actions: [['click', '.topnav [data-view="board"] >> nth=0'], ['wait', '.board .card']],
          highlight: {
            default: ['.board-column-header >> nth=3', '.card:has-text("Fall menu launch reel")', '.board-column >> nth=3', '.add-card-btn >> nth=0'],
            client: ['.board-column-header >> nth=0', '.card:has-text("Fall menu launch reel")'],
          },
        },
      },
      {
        id: 'entry', section: 'Production', roles: ['admin', 'rep'], guide: 'entry',
        title: 'Inside a content entry',
        body: 'Everything about one piece of content. Field changes are written to ClickUp when you press Save changes; Log posts and uploads save right away.',
        points: {
          admin: ['Account. Admins can move the entry to another account from here.', 'Status is the stage.', 'Dates, mediums and other ClickUp fields. New fields added in ClickUp appear here on their own.', 'Files, grouped by category. Four are team-only; Published / Final and Client Assets are shared with the client.', 'Notebook: the entry’s private reference link from ClickUp. Admins only; edit it in ClickUp.'],
          rep: ['Account (set by an admin).', 'Status is the stage.', 'Dates, mediums and other ClickUp fields. New fields added in ClickUp appear here on their own.', 'Files, grouped by category. Four are team-only; Published / Final and Client Assets are shared with the client.'],
        },
        covers: [],
        shot: {
          viewport: { width: 1280, height: 980 },
          actions: [['click', '.topnav [data-view="board"] >> nth=0'], ['click', '.card:has-text("Fall menu launch reel")'], ['wait', '#task-status-select'], ['wait', '.file-categories'], ['waitMs', 300]],
          highlight: {
            admin: ['#task-account-select', '#task-status-select', '.medium-toggle-group', '.files-section >> nth=0', '.files-section:has-text("Notebook") a'],
            rep: ['.modal-header .account-badge', '#task-status-select', '.medium-toggle-group', '.files-section >> nth=0'],
          },
        },
      },
      {
        id: 'entry-log', section: 'Production', roles: ['admin', 'rep'], guide: 'messages',
        title: 'The Log: talk about one entry',
        body: 'Each entry has a Log, newest first. It is the ClickUp task’s comment thread, so whoever works in ClickUp sees it too. Uploads add a line automatically.',
        points: ['The conversation so far. Show all expands older entries.', 'Write an update and press Post. Clients see it and can reply.', 'Save changes writes your field edits to ClickUp. Cancel drops them; Delete task removes the entry for good.'],
        covers: [],
        shot: {
          viewport: { width: 1280, height: 980 },
          actions: [['click', '.topnav [data-view="board"] >> nth=0'], ['click', '.card:has-text("Fall menu launch reel")'], ['wait', '.comments-section .comment'], ['scrollTo', '.modal-footer'], ['waitMs', 200]],
          highlight: ['.comments-section .comment >> nth=0', '#comment-form', '.modal-footer'],
        },
      },
      {
        id: 'entry-client', section: 'Production', roles: ['client'], guide: 'entry',
        title: 'Open an entry',
        body: 'See where a piece of content stands, download finished work, add your own files and talk to your team about it.',
        points: ['Status: the stage it is in. Your team moves it along.', 'Files: finished work arrives under Published / Final. Add photos, logos and reference under Client Assets.', 'Log: feedback, questions or approval. Type it and press Post.'],
        covers: [],
        shot: {
          viewport: { width: 1280, height: 900 },
          actions: [['click', '.topnav [data-view="board"] >> nth=0'], ['click', '.card:has-text("Fall menu launch reel")'], ['wait', '#client-comment-form'], ['wait', '.file-categories'], ['waitMs', 300]],
          highlight: ['#client-modal-overlay .modal-body > p >> nth=0', '#client-modal-overlay .files-section', '#client-comment-form'],
        },
      },
      {
        id: 'new-entry', section: 'Production', roles: ['admin', 'rep', 'client'], guide: 'workflow',
        title: { default: 'Start a new entry', client: 'Send your team a request' },
        body: {
          default: '+ New opens an empty entry. Give it a name, set the stage, people, dates and mediums, then Create task. It goes straight onto the Board and into ClickUp.',
          client: '+ New asks for one line: what you would like made. It lands on your Board in the first stage for your team to pick up.',
        },
        points: {
          default: ['Name the entry.', 'Pick the stage. New entries usually start at Idea.', 'Create task adds it to ClickUp.'],
          client: ['With more than one business, pick which one it is for.', 'Describe the idea in a few words.', 'Create sends it to your team.'],
        },
        covers: ['topnav:new-task', 'topnav:client-new-task'],
        shot: {
          actions: {
            default: [['click', '.topnav [data-view="board"] >> nth=0'], ['click', '.topnav [data-action="new-task"]'], ['wait', '#task-name-input'], ['fill', '#task-name-input', 'Thanksgiving week hours']],
            client: [['click', '.topnav [data-view="board"] >> nth=0'], ['click', '.topnav [data-action="client-new-task"]'], ['wait', '#client-new-task-form'], ['fill', '#client-new-task-name', 'Photo of the new espresso machine']],
          },
          highlight: {
            default: ['#task-name-input', '#task-status-select', '[data-action="save-task"]'],
            client: ['#client-new-task-account', '#client-new-task-name', '#client-new-task-form button[type=submit]'],
          },
        },
      },
      {
        id: 'list', section: 'Production', roles: ['admin', 'rep', 'client'], guide: 'list',
        title: 'List: find anything fast',
        body: 'The same entries as a table. Handy for finding one thing, or scanning dates across many.',
        points: {
          default: ['Search filters by name as you type.', 'Click a column heading to sort; click again to reverse.', 'Click any row to open it.'],
          client: ['Search filters by name as you type.', 'Status, business and mediums at a glance.', 'Tap any row to open it.'],
        },
        covers: ['view:list'],
        shot: {
          actions: [['click', '.topnav [data-view="list"] >> nth=0'], ['wait', '.list-table']],
          highlight: {
            default: ['#list-search-input', '.list-table th[data-key="scheduled"]', '.list-table tbody tr >> nth=0'],
            client: ['#list-search-input', '.list-table thead', '.list-table tbody tr >> nth=0'],
          },
        },
      },
      {
        id: 'calendar', section: 'Production', roles: ['admin', 'rep'], guide: 'calendar',
        title: 'Calendar: what goes out when',
        body: 'A month view of everything with a date, coloured by stage. An entry appears on its Publish Date, or its Scheduled Date if it has no publish date yet.',
        points: ['Change month, or jump back to Today.', 'Click an entry to open it.'],
        covers: ['view:calendar'],
        shot: {
          viewport: { width: 1280, height: 900 },
          actions: [['click', '.topnav [data-view="calendar"] >> nth=0'], ['wait', '.calendar-grid']],
          highlight: ['.calendar-header', '.cal-item:has-text("Fall menu launch reel")'],
        },
      },
      {
        id: 'feed', section: 'Production', roles: ['admin', 'rep', 'client'], guide: 'feed',
        title: 'Feed: catch up on every conversation',
        body: 'Every Log comment across the entries in view, newest first. It follows the account filter.',
        points: ['Who wrote it, on which entry, for which account, and when. Click to open that entry.'],
        covers: ['view:feed'],
        shot: { actions: [['click', '.topnav [data-view="feed"] >> nth=0'], ['wait', '.feed-list .comment']], highlight: ['.feed-list .comment >> nth=0'] },
      },

      // ------------------------------------------------------------------ Ideas & strategy
      {
        id: 'ideas', section: 'Ideas & strategy', roles: ['admin', 'rep', 'client'], guide: 'inbox',
        title: 'Ideas: raw material, sorted by pillar',
        body: {
          default: 'Ideas belong to one account, so pick it in the filter first. Nothing here is real work until someone promotes it.',
          client: 'Jot down anything worth making. Nothing here is real work until someone promotes it.',
        },
        points: ['Ideas, Pillars & Rhythm and Foundation: always one tap apart.', '+ Capture saves a new idea, link or note.', 'Filter by Active, Needs Review, Archived or Promoted.', 'One column per pillar. Drag a card to re-file it.', 'Promote turns the idea into a content entry on the Board.'],
        covers: ['view:ideas', 'ideas:inbox'],
        shot: {
          viewport: { width: 1280, height: 860 },
          actions: { default: [pickHarbor, ['click', '.topnav [data-view="ideas"] >> nth=0'], ['wait', '.pillar-board']], client: [['select', '#account-filter-select', HP], ['click', '.topnav [data-view="ideas"] >> nth=0'], ['wait', '.pillar-board']] },
          highlight: ['.ideas-subnav', '[data-action="start-new-idea"]', '.ideas-inbox .view-tabs', '.pillar-column >> nth=0', '[data-action="convert-idea"] >> nth=0'],
        },
      },
      {
        id: 'capture', section: 'Ideas & strategy', roles: ['admin', 'rep', 'client'], guide: 'inbox',
        title: 'Capture an idea',
        body: 'Use Link for something you saw online: it is flagged Needs review so it gets looked at. Note is for longer thoughts.',
        points: ['Idea, Link or Note.', 'File it under a pillar now, or leave it Unsorted.', 'Private to me hides it from everyone else (admins can still see it).'],
        covers: [],
        shot: {
          viewport: { width: 1280, height: 860 },
          actions: [pickHarbor, ['click', '.topnav [data-view="ideas"] >> nth=0'], ['click', '[data-action="start-new-idea"]'], ['click', '[data-action="set-idea-type"][data-value="link"]'], ['fill', '#idea-title-input', 'Neighbourhood latte art contest'], ['fill', '#idea-url-input', 'https://example.com/latte-art-contest']],
          highlight: ['#new-idea-form .wizard-options', '#idea-pillar-select', 'label:has(#idea-private-checkbox)'],
        },
      },
      {
        id: 'idea-detail', section: 'Ideas & strategy', roles: ['admin', 'rep', 'client'], guide: 'inbox',
        title: 'Open an idea',
        body: 'Click any idea to see it in full. When you promote it, its details, link and files carry over into the new entry.',
        points: ['Edit the title, details, pillar or category. On a phone, this is how you re-file an idea.', 'Attach photos, voice memos or old media to keep with it.'],
        covers: [],
        shot: {
          actions: [pickHarbor, ['click', '.topnav [data-view="ideas"] >> nth=0'], ['click', '.idea-card:has-text("Pumpkin latte blind taste test")'], ['wait', '#idea-detail-overlay'], ['wait', '#idea-detail-overlay .file-row'], ['waitMs', 200]],
          highlight: ['[data-action="start-idea-edit"]', '#idea-detail-overlay .files-section'],
        },
      },
      {
        id: 'rhythm', section: 'Ideas & strategy', roles: ['admin', 'rep', 'client'], guide: 'rhythm',
        title: 'Pillars & Rhythm',
        body: 'Three quick answers and 3–5 pillars. The weekly time you pick sets the pace behind “weeks of material”; the pillars become the inbox columns.',
        points: ['Where ideas come from, how much time you have, and the routine that fits.', 'Your pillars: add or remove them here.', 'Save to go back to the inbox.'],
        covers: ['ideas:rhythm'],
        shot: {
          viewport: { width: 1280, height: 1220 },
          actions: [pickHarbor, ['click', '.topnav [data-view="ideas"] >> nth=0'], ['click', '[data-action="ideas-subnav-goto"][data-value="rhythm"]'], ['wait', '.pillar-manager']],
          highlight: ['.wizard-options >> nth=1', '.pillar-manager', '[data-action="finish-rhythm-setup"]'],
        },
      },
      {
        id: 'foundation', section: 'Ideas & strategy', roles: ['admin', 'rep', 'client'], guide: 'foundation',
        title: 'Brand Foundation',
        body: {
          default: 'The account’s strategy on one page: positioning, audience, offers, voice and ready-to-copy lines. Keep several profiles as the brand changes; ★ marks the current one.',
          client: 'Your brand’s strategy on one page, kept up to date by your team. Copy any line straight into a caption or email.',
        },
        points: {
          default: ['Switch profiles. The ★ profile is the one used everywhere else.', 'New profile, Edit, Duplicate or delete.', 'Copy puts that block on your clipboard.', 'Further down: audience, offers, voice, social links (they open each profile, in the app on a phone) and the Prompt Library.'],
          client: ['Switch profiles. The ★ profile is the current one.', 'Copy puts that block on your clipboard.', 'Further down: audience, offers, voice, social links (they open each profile, in the app on a phone) and the Prompt Library.'],
        },
        covers: ['ideas:foundation'],
        shot: {
          viewport: { width: 1280, height: 900 },
          actions: [pickHarbor, ['click', '.topnav [data-view="ideas"] >> nth=0'], ['click', '[data-action="ideas-subnav-goto"][data-value="foundation"]'], ['wait', '#foundation-switcher-select'], ['waitMs', 200]],
          highlight: {
            default: ['#foundation-switcher-select', 'div:has(> [data-action="start-new-foundation"])', '[data-action="copy-foundation-text"] >> nth=0'],
            client: ['#foundation-switcher-select', '[data-action="copy-foundation-text"] >> nth=0'],
          },
        },
      },
      {
        id: 'prompts', section: 'Ideas & strategy', roles: ['admin', 'rep', 'client'], guide: 'prompts',
        title: 'Prompt Library',
        body: 'Saved prompts with {{tags}} that fill in from the Foundation profile, ready to paste into any AI tool.',
        points: {
          default: ['Click a prompt to open it.', 'The template as written, with its {{tags}}.', 'Ready to paste: the same prompt filled in. Copy resolved takes it.', '+ New prompt saves another one.'],
          client: ['Click a prompt to open it.', 'The template as written, with its {{tags}}.', 'Ready to paste: the same prompt filled in. Copy resolved takes it.'],
        },
        covers: [],
        shot: {
          viewport: { width: 1280, height: 900 },
          actions: [pickHarbor, ['click', '.topnav [data-view="ideas"] >> nth=0'], ['click', '[data-action="ideas-subnav-goto"][data-value="foundation"]'], ['wait', '[data-action="toggle-prompt-expanded"]'], ['click', '[data-action="toggle-prompt-expanded"] >> nth=0'], ['scrollTo', '[data-action="toggle-prompt-expanded"] >> nth=1'], ['waitMs', 200]],
          highlight: {
            default: ['[data-action="toggle-prompt-expanded"] >> nth=0', 'div:has(> span.field-label:has-text("Template")) >> nth=-1', 'div:has(> span.field-label:has-text("Ready to paste")) >> nth=-1', '[data-action="start-new-prompt"]'],
            client: ['[data-action="toggle-prompt-expanded"] >> nth=0', 'div:has(> span.field-label:has-text("Template")) >> nth=-1', 'div:has(> span.field-label:has-text("Ready to paste")) >> nth=-1'],
          },
        },
      },

      // ------------------------------------------------------------------ Settings
      {
        id: 'settings', section: 'Settings', roles: ['admin', 'rep', 'client'], guide: 'preferences',
        title: 'Settings',
        body: {
          admin: 'The gear holds everything that isn’t content: light or dark mode, Sync now, this tour and the full guide, the Admin panel, your profile, and sign out.',
          rep: 'The gear holds everything that isn’t content: light or dark mode, Sync now, this tour and the full guide, your profile, disconnecting ClickUp, and sign out.',
          client: 'The gear holds everything that isn’t content: light or dark mode, Sync now, this tour and the full guide, your profile, and sign out.',
        },
        points: ['Sync now reloads everything, for example after someone edits a task in ClickUp.', 'Bring back this tour, or open the full guide.', 'What’s new shows the latest update’s changes for you again.', 'The version you are on.'],
        covers: ['settings:toggle-theme', 'settings:refresh', 'settings:client-refresh', 'settings:open-tour', 'settings:open-guide', 'settings:open-whats-new', 'settings:open-admin-panel', 'settings:open-profile-modal', 'settings:disconnect', 'settings:sign-out', 'topnav:toggle-settings-menu'],
        shot: {
          actions: { default: [['click', '.topnav [data-action="toggle-settings-menu"]'], ['wait', '.settings-menu']] },
          highlight: {
            default: ['.settings-menu [data-action="refresh"]', '.settings-menu [data-action="open-tour"]', '.settings-menu [data-action="open-whats-new"]', '.settings-menu-version'],
            client: ['.settings-menu [data-action="client-refresh"]', '.settings-menu [data-action="open-tour"]', '.settings-menu [data-action="open-whats-new"]', '.settings-menu-version'],
          },
        },
      },
      {
        id: 'profile', section: 'Settings', roles: ['admin', 'rep', 'client'], guide: 'preferences',
        title: 'Your profile',
        body: 'Settings › Edit profile. Each part saves on its own.',
        points: ['Your name as others see it.', 'A new email takes effect once you click the confirmation link sent to it.', 'A new password: at least 6 characters, typed twice.'],
        covers: [],
        shot: {
          actions: [['click', '.topnav [data-action="toggle-settings-menu"]'], ['click', '.settings-menu [data-action="open-profile-modal"]'], ['wait', '#profile-name-input']],
          highlight: ['#profile-name-input', '#profile-email-input', '#profile-new-password-input'],
        },
      },

      {
        id: 'whats-new', section: 'Settings', roles: ['admin', 'rep', 'client'], guide: 'whats-new',
        title: 'What’s new after an update',
        body: 'The first time you sign in after ContentFlow is updated, this window shows what changed, only the changes that affect you. If you missed several updates, it covers all of them.',
        points: ['Each change, marked New, Improved or Fixed.', 'Show me opens the tour at that screen.', 'Got it closes it until the next update. Settings › What’s new brings it back.'],
        covers: [],
        shot: {
          boot: { seenVersion: '1.25.0' },
          viewport: { width: 1280, height: 860 },
          actions: [['wait', '#whats-new-modal'], ['waitMs', 400]],
          highlight: ['#whats-new-modal .wn-card >> nth=0', '#whats-new-modal .wn-body [data-action="whats-new-show"] >> nth=0', '#whats-new-modal .wn-footer [data-action="close-whats-new"]'],
        },
      },

      // ------------------------------------------------------------------ Admin
      {
        id: 'admin-accounts', section: 'Admin', roles: ['admin'], guide: 'admin-panel',
        title: 'Admin panel: accounts',
        body: 'Settings › Admin panel. The account list comes from ClickUp’s Companies & Accounts list.',
        points: ['Search accounts.', 'Click an account to see everyone with access, and invite someone to it.', 'The switch turns an account off: hidden everywhere and locked for team members and clients. Nothing is deleted.'],
        covers: ['admin:accounts'],
        shot: {
          actions: [['click', '.topnav [data-action="toggle-settings-menu"]'], ['click', '.settings-menu [data-action="open-admin-panel"]'], ['wait', '#accounts-search-input'], ['click', '[data-action="toggle-account-expand"][data-account-id="' + HP + '"]'], ['wait', '[data-action="invite-to-account"]']],
          highlight: ['#accounts-search-input', '.file-category:has([data-action="invite-to-account"])', '.toggle-switch >> nth=0'],
        },
      },
      {
        id: 'admin-invite', section: 'Admin', roles: ['admin'], guide: 'admin-recipes',
        title: 'Admin panel: invite people',
        body: 'Invite & Users. Access is set when you invite, so list every account the person needs.',
        points: ['Role: admin, rep (team member) or client.', 'The MKC ID of each account they should see, from Companies & Accounts. Separate several with commas.', 'Everyone with access, their role and their accounts.'],
        covers: ['admin:users'],
        shot: {
          viewport: { width: 1280, height: 900 },
          actions: [['click', '.topnav [data-action="toggle-settings-menu"]'], ['click', '.settings-menu [data-action="open-admin-panel"]'], ['click', '[data-action="set-admin-tab"][data-value="users"]'], ['wait', '#invite-form'], ['fill', '#invite-email', 'priya@northside.example'], ['select', '#invite-role', 'client'], ['fill', '#invite-accounts', '86demo103'], ['wait', '.table-wrap']],
          highlight: ['#invite-role', '#invite-accounts', '.table-wrap'],
        },
      },
      {
        id: 'admin-changelog', section: 'Admin', roles: ['admin'], guide: 'admin-changelog',
        title: 'Admin panel: change log',
        body: 'Every ContentFlow release since the first, with who each change affects. It is updated with every release.',
        points: ['Search, filter by who it affects or by New / Improved / Fixed, and flip the order.', 'Download the whole history as CSV or JSON to keep or share.', 'The current version, and how many people have seen its notes.', 'Each change, with the roles it affects.'],
        covers: ['admin:changelog'],
        shot: {
          viewport: { width: 1280, height: 900 },
          actions: [['click', '.topnav [data-action="toggle-settings-menu"]'], ['click', '.settings-menu [data-action="open-admin-panel"]'], ['click', '[data-action="set-admin-tab"][data-value="changelog"]'], ['wait', '.cl-timeline'], ['wait', '.cl-seen'], ['waitMs', 300]],
          highlight: ['.cl-controls', '[data-action="export-changelog"][data-format="csv"]', '.cl-release.current .cl-head', '.cl-release.current .cl-items li >> nth=0'],
        },
      },

      // ------------------------------------------------------------------ Wrap up
      {
        id: 'phone', section: 'Settings', roles: ['admin', 'rep', 'client'], guide: 'mobile',
        title: 'On your phone',
        body: 'Everything works on a phone. Swipe the tab bar for more views and swipe the Board for more stages. To change a stage, open the entry and use Status. In Safari, Share › Add to Home Screen puts ContentFlow with your apps.',
        points: ['Swipe sideways for more tabs.', 'Swipe the Board for more stages.'],
        covers: [],
        shot: {
          phone: true,
          actions: [['click', '.topnav [data-view="board"] >> nth=0'], ['wait', '.board .card']],
          highlight: ['.topnav .view-tabs', '.board-column >> nth=0'],
        },
      },
    ],
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TOUR;
  else root.CF_TOUR = TOUR;
})(this);
