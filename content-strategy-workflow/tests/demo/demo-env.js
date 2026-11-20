/*
 * ContentFlow demo environment -- runs the REAL index.html against fictional
 * data, with no Supabase, backend or ClickUp connection.
 *
 * Injected before the page's own scripts (Playwright addInitScript). It:
 *   - defines window.supabase (the CDN script is blocked by the harness, so
 *     this stub is what createClient() returns), signed in as
 *     window.__CF_DEMO.role ('admin' | 'rep' | 'client'), or signed out when
 *     window.__CF_DEMO.signedOut is true;
 *   - answers every fetch to the ContentFlow backend, including the ClickUp
 *     proxy, from the in-memory data below.
 *
 * Used by tests/tour/capture.js (tour screenshots) and tests/guide.test.js.
 * Everything here is invented: businesses, people, posts and IDs.
 * When the app starts reading a new endpoint or field, add it here so the
 * screenshots keep showing a fully working app (tests/tour/check.js fails
 * on any request this file doesn't answer).
 */
(function () {
  'use strict';
  var CFG = window.__CF_DEMO || {};
  var ROLE = CFG.role || 'admin';
  var BACKEND = 'contentflow-oauth.vercel.app';
  var ACCOUNTS_LIST_ID = '901710481777'; // CU_ACCOUNTS_LIST_ID in index.html
  window.__CF_DEMO_UNHANDLED = [];

  // ---- Clock-relative helpers (the capture freezes the clock, so these are stable)
  var NOW = Date.now();
  var DAY = 24 * 60 * 60 * 1000;
  function today() { var d = new Date(NOW); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); }
  function dateField(offsetDays) { return String(today() + offsetDays * DAY); } // ClickUp date fields are UTC-midnight ms
  function ago(days, hours) { return String(NOW - days * DAY - (hours || 0) * 3600 * 1000); }
  function iso(days, hours) { return new Date(NOW - days * DAY - (hours || 0) * 3600 * 1000).toISOString(); }

  // ---- Accounts (Companies & Accounts list) --------------------------------
  var ACCOUNTS = [
    { id: '86demo101', name: 'Harbor & Pine Coffee' },
    { id: '86demo102', name: 'Harbor & Pine Roastery' },
    { id: '86demo103', name: 'Northside Fitness' },
    { id: '86demo104', name: 'Lumen Dental' },
    { id: '86demo105', name: 'Old Town Bakery' },
  ];
  var INACTIVE = ['86demo105'];
  var HP = '86demo101', ROAST = '86demo102', NF = '86demo103', LD = '86demo104';

  // ---- People -----------------------------------------------------------------
  var MEMBERS = [
    { id: 501, username: 'Jordan Taylor', email: 'jordan@studio.example', color: '#2f86d6', initials: 'JT' },
    { id: 502, username: 'Alex Rivera', email: 'alex@studio.example', color: '#c9463c', initials: 'AR' },
    { id: 503, username: 'Sam Okafor', email: 'sam@studio.example', color: '#2e9e4f', initials: 'SO' },
  ];
  var DANA = { id: 601, username: 'Dana Reyes', email: 'dana@harborpine.example', color: '#7c5cbf' };
  // Everyone joined in September unless the session is a brand-new user
  // (CFG.freshUser), whose account is dated after any release (it isn't shown
  // anywhere; it only tells the app this person is new, not returning).
  var JOINED = CFG.freshUser ? '2099-01-01T00:00:00Z' : '2026-09-19T15:00:00Z';
  var PROFILES = {
    admin: { id: 'demo-admin', role: 'admin', email: 'morgan@studio.example', display_name: 'Morgan Ellis', created_at: JOINED },
    rep: { id: 'demo-rep', role: 'rep', email: 'jordan@studio.example', display_name: 'Jordan Taylor', created_at: JOINED },
    client: { id: 'demo-client', role: 'client', email: 'dana@harborpine.example', display_name: 'Dana Reyes', created_at: JOINED },
  };
  // contentflow_release_views: the last release each person has seen.
  // CFG.seenVersion is this session's own row (null = never seen anything).
  var RELEASE_VIEWS = [
    { email: 'jordan@studio.example', role: 'rep', last_seen_version: '1.27.0', seen_at: iso(0, 3) },
    { email: 'dana@harborpine.example', role: 'client', last_seen_version: '1.27.0', seen_at: iso(0, 5) },
    { email: 'alex@studio.example', role: 'rep', last_seen_version: '1.26.0', seen_at: iso(2) },
  ];
  window.__CF_DEMO_UPSERTS = [];
  var ACCESS = {
    admin: [],
    rep: [HP, ROAST, LD],
    client: [HP, ROAST],
  };

  // ---- ClickUp list: statuses + custom fields ----------------------------------
  var STATUSES = [
    { status: 'idea', color: '#87909e', type: 'open', orderindex: 0 },
    { status: 'copy - in progress', color: '#a855c9', type: 'custom', orderindex: 1 },
    { status: 'media - in progress', color: '#d93f6b', type: 'custom', orderindex: 2 },
    { status: 'for review', color: '#dc6419', type: 'custom', orderindex: 3 },
    { status: 'approved', color: '#4558c9', type: 'custom', orderindex: 4 },
    { status: 'scheduled', color: '#2f86d6', type: 'custom', orderindex: 5 },
    { status: 'published', color: '#2e9e4f', type: 'closed', orderindex: 6 },
  ];
  function st(name) { return STATUSES.filter(function (s) { return s.status === name; })[0]; }

  var MEDIUMS = [
    { id: 'md-blog', label: 'Blog', color: '#6b7280' },
    { id: 'md-email', label: 'Email Blast', color: '#2f9e44' },
    { id: 'md-fbpost', label: 'Facebook Post', color: '#1877f2' },
    { id: 'md-fbreel', label: 'Facebook Reel', color: '#3b5998' },
    { id: 'md-igpost', label: 'Instagram Post', color: '#c13584' },
    { id: 'md-igreel', label: 'Instagram Reel', color: '#e5307a' },
    { id: 'md-igstory', label: 'Instagram Story', color: '#f77737' },
    { id: 'md-li', label: 'LinkedIn Post', color: '#0a66c2' },
    { id: 'md-news', label: 'Newsletter', color: '#8a6d3b' },
    { id: 'md-tiktok', label: 'TikTok Post', color: '#1d1d1f' },
    { id: 'md-yt', label: 'YouTube Short', color: '#e02424' },
  ];
  var FIELDS = [
    { id: 'f-acct', name: 'Related Account ID', type: 'short_text', type_config: {} },
    { id: 'f-mkc', name: 'MKC ID', type: 'short_text', type_config: {} },
    { id: 'f-sched', name: 'Scheduled Date', type: 'date', type_config: {} },
    { id: 'f-medium', name: 'Medium(s)', type: 'labels', type_config: { options: MEDIUMS } },
    { id: 'f-pub', name: 'Publish Date', type: 'date', type_config: {} },
    { id: 'f-next', name: 'Next Action Date', type: 'date', type_config: {} },
    { id: 'f-notebook', name: 'Notebook Link', type: 'url', type_config: {} },
  ];

  function cf(values) {
    return FIELDS.map(function (f) {
      var v = values[f.id];
      return { id: f.id, name: f.name, type: f.type, type_config: f.type_config, value: v === undefined ? null : v };
    });
  }
  function who(ids) { return ids.map(function (i) { return MEMBERS.filter(function (m) { return m.id === i; })[0]; }); }

  // ---- Content entries ------------------------------------------------------------
  var TASKS = [];
  function task(id, name, status, acct, opts) {
    opts = opts || {};
    TASKS.push({
      id: id, name: name, status: st(status), assignees: who(opts.who || []),
      date_created: ago(opts.created || 20), date_updated: ago(opts.updated === undefined ? 1 : opts.updated),
      custom_fields: cf({
        'f-acct': acct, 'f-mkc': '86ent' + id.slice(-3),
        'f-sched': opts.sched !== undefined ? dateField(opts.sched) : null,
        'f-pub': opts.pub !== undefined ? dateField(opts.pub) : null,
        'f-next': opts.next !== undefined ? dateField(opts.next) : null,
        'f-medium': opts.md || [],
        'f-notebook': opts.notebook || null,
      }),
    });
  }
  task('t101', 'Behind the bar: latte art in 30 seconds', 'idea', HP, { md: ['md-igreel', 'md-tiktok'], next: 4 });
  task('t102', 'Holiday hours announcement', 'idea', HP, { md: ['md-fbpost', 'md-igstory'], next: 9 });
  task('t103', 'January challenge teaser', 'idea', NF, { md: ['md-igreel'], updated: 2 });
  task('t104', 'Fall menu launch reel', 'for review', HP, { who: [501, 503], md: ['md-igreel', 'md-fbreel', 'md-tiktok'], sched: 1, pub: 2, next: -1, notebook: 'https://notes.example.com/harbor-pine/fall-menu' });
  task('t105', '3 myths about teeth whitening', 'copy - in progress', LD, { who: [502], md: ['md-blog', 'md-fbpost'], sched: 6, pub: 8, next: 2 });
  task('t106', 'Gift card promo for the holidays', 'copy - in progress', HP, { who: [501], md: ['md-email', 'md-igpost'], pub: 14, next: 3 });
  task('t107', 'Roast day: meet the beans', 'media - in progress', ROAST, { who: [503], md: ['md-yt', 'md-igreel'], sched: 9, pub: 10, next: 5 });
  task('t108', 'Member spotlight: Priya', 'scheduled', NF, { who: [502], md: ['md-fbpost', 'md-email'], sched: 3, pub: 3 });
  task('t109', 'New patient welcome video', 'approved', LD, { who: [502, 503], md: ['md-yt'], sched: 12, pub: 13 });
  task('t110', 'Pumpkin cold foam is back', 'published', HP, { who: [501], md: ['md-igpost', 'md-igstory'], pub: -6, updated: 6 });
  task('t111', 'Wholesale partners page', 'copy - in progress', ROAST, { who: [501], md: ['md-blog', 'md-li'], updated: 12, created: 30 });
  task('t112', 'Floss like you mean it', 'media - in progress', LD, { who: [503], md: ['md-tiktok'], updated: 9, created: 25 });
  task('t113', 'Coffee subscription explainer', 'scheduled', ROAST, { who: [501], md: ['md-email', 'md-news'], sched: 7, pub: 7 });
  task('t114', 'Morning regulars photo series', 'for review', HP, { who: [503], md: ['md-igpost'], sched: 11, pub: 12, next: 1 });
  task('t115', 'Spin class playlist drop', 'published', NF, { who: [502], md: ['md-tiktok', 'md-igreel'], pub: -3, updated: 3 });

  var COMMENTS = {
    t104: [
      { id: 'c1', comment_text: 'Uploaded "fall-menu-reel-v2.mp4" to Media Files (raw).', user: { username: 'Sam Okafor' }, date: ago(0, 3) },
      { id: 'c2', comment_text: 'Love it. Could the pumpkin cold foam be the opening shot?', user: { username: 'Dana Reyes' }, date: ago(0, 5) },
      { id: 'c3', comment_text: 'Caption draft is in Copy / Drafts. Ready for Dana to look at.', user: { username: 'Jordan Taylor' }, date: ago(1, 2) },
      { id: 'c4', comment_text: 'Shot list approved, filming Thursday.', user: { username: 'Jordan Taylor' }, date: ago(4) },
      { id: 'c5', comment_text: 'Moved to Media - In Progress.', user: { username: 'Sam Okafor' }, date: ago(5) },
    ],
    t105: [{ id: 'c6', comment_text: 'First draft is in Copy / Drafts.', user: { username: 'Alex Rivera' }, date: ago(0, 7) }],
    t114: [{ id: 'c7', comment_text: 'Uploaded "regulars-03.jpg" to Client Assets.', user: { username: 'Dana Reyes' }, date: ago(1, 6) }],
    t107: [{ id: 'c8', comment_text: 'B-roll from the roastery is in Media Extractions.', user: { username: 'Sam Okafor' }, date: ago(2, 1) }],
    t108: [{ id: 'c9', comment_text: 'Scheduled for Friday 9am on Facebook and the newsletter.', user: { username: 'Alex Rivera' }, date: ago(2, 4) }],
    t113: [{ id: 'c10', comment_text: 'Subscriber discount code confirmed: BEANS10.', user: { username: 'Dana Reyes' }, date: ago(3, 2) }],
  };

  var FILES = {
    t104: [
      { id: 'fl1', filename: 'fall-menu-caption-v2.docx', sizeBytes: 18432, category: 'copy_drafts' },
      { id: 'fl2', filename: 'fall-menu-reel-v2.mp4', sizeBytes: 44040192, category: 'media_raw' },
      { id: 'fl3', filename: 'storefront-autumn.jpg', sizeBytes: 2202009, category: 'client_assets' },
      { id: 'fl4', filename: 'shot-list.pdf', sizeBytes: 96256, category: 'notes' },
    ],
    t105: [{ id: 'fl5', filename: 'whitening-myths-draft.docx', sizeBytes: 22528, category: 'copy_drafts' }],
    t110: [{ id: 'fl6', filename: 'cold-foam-final.mp4', sizeBytes: 31457280, category: 'published_final' }],
  };

  // ---- Ideas layer (per account) ---------------------------------------------------
  var PILLARS = {};
  PILLARS[HP] = [{ id: 'p1', name: 'Seasonal menu' }, { id: 'p2', name: 'Behind the bar' }, { id: 'p3', name: 'Local regulars' }];
  PILLARS[ROAST] = [{ id: 'p4', name: 'Bean origins' }, { id: 'p5', name: 'Brew guides' }];
  PILLARS[LD] = [{ id: 'p6', name: 'Myth busting' }, { id: 'p7', name: 'Meet the team' }];
  PILLARS[NF] = [{ id: 'p8', name: 'Member wins' }, { id: 'p9', name: 'Quick workouts' }];

  var RHYTHM = { natural_source: 'questions', weekly_capacity: '1hr', routine_type: 'quick_capture' };

  var IDEAS = {};
  IDEAS[HP] = [
    { id: 'i1', title: "Competitor's cider launch", source_type: 'link', source_url: 'https://instagram.com/p/example-cider', body: 'Their reel got huge reach. Could we do a spiced cider version?', pillar_id: 'p1', status: 'inbox', needs_review: true, is_private: false, category: null, created_at: iso(0, 4) },
    { id: 'i2', title: 'Pumpkin latte blind taste test', source_type: 'text', body: 'Three versions, staff guess which is ours. Film it.', pillar_id: 'p1', status: 'inbox', needs_review: false, is_private: false, category: 'Video', created_at: iso(1) },
    { id: 'i3', title: 'Morning open: 6am timelapse', source_type: 'text', body: null, pillar_id: 'p2', status: 'inbox', needs_review: false, is_private: true, category: null, created_at: iso(2) },
    { id: 'i4', title: 'Regular asked if we do catering', source_type: 'note', body: 'Came up twice this week. A post answering it could double as an FAQ.', pillar_id: null, status: 'inbox', needs_review: false, is_private: false, category: 'FAQ', created_at: iso(3) },
    { id: 'i5', title: 'Name a drink after our 1,000th regular', source_type: 'text', body: null, pillar_id: 'p3', status: 'inbox', needs_review: false, is_private: false, category: null, created_at: iso(5) },
    { id: 'i6', title: 'Barista playlist', source_type: 'text', body: null, pillar_id: 'p2', status: 'archived', needs_review: false, is_private: false, category: null, created_at: iso(15) },
    { id: 'i7', title: 'Pumpkin cold foam is back', source_type: 'text', body: null, pillar_id: 'p1', status: 'converted', needs_review: false, is_private: false, category: null, created_at: iso(20) },
  ];
  IDEAS[ROAST] = [
    { id: 'i8', title: 'Why our Ethiopia lot tastes like blueberries', source_type: 'text', body: null, pillar_id: 'p4', status: 'inbox', needs_review: false, is_private: false, category: null, created_at: iso(1) },
    { id: 'i9', title: 'Pour-over in 4 steps', source_type: 'note', body: null, pillar_id: 'p5', status: 'inbox', needs_review: false, is_private: false, category: null, created_at: iso(2) },
  ];
  IDEAS[LD] = [{ id: 'i10', title: 'Does whitening hurt? (most asked question)', source_type: 'text', body: null, pillar_id: 'p6', status: 'inbox', needs_review: false, is_private: false, category: null, created_at: iso(1) }];
  IDEAS[NF] = [{ id: 'i11', title: '5-minute desk stretch', source_type: 'text', body: null, pillar_id: 'p9', status: 'inbox', needs_review: false, is_private: false, category: null, created_at: iso(1) }];

  var IDEA_FILES = { i2: [{ id: 'if1', filename: 'taste-test-notes.m4a', sizeBytes: 1048576, category: 'idea_media' }] };

  function foundation(acct, id, name, active, extra) {
    return Object.assign({
      id: id, account_id: acct, name: name, is_active: active,
      niche: '', business_description: '', elevator_pitch: '', value_proposition: '',
      audience_buckets: [], expertise_areas: '', offers: [], proof_points: '',
      voice_adjectives: '', voice_avoid: '', keywords: '', cta_lines: '', hook_lines: '',
      social_links: {}, notebook_url: null,
    }, extra);
  }
  var FOUNDATIONS = {};
  FOUNDATIONS[HP] = [
    foundation(HP, 'fd1', '2026 Positioning', true, {
      niche: 'Neighbourhood specialty coffee bar',
      business_description: 'A small coffee bar that roasts in-house, bakes in the morning and knows most customers by name.',
      elevator_pitch: 'Harbor & Pine is the neighbourhood coffee bar that roasts its own beans and remembers your order.',
      value_proposition: 'Small-batch coffee, made by people who know your name.',
      audience_buckets: [
        { name: 'Remote workers', demographics: '25-40, work from home 3+ days a week', psychographics: 'Want a third place that feels calm', painPoints: 'Noisy cafes, weak Wi-Fi, no outlets', goals: 'A reliable spot to get two hours of focus' },
        { name: 'Weekend regulars', demographics: 'Local families and couples', psychographics: 'Value routine and small rituals', painPoints: 'Long lines on Saturday mornings', goals: 'A treat that feels personal' },
      ],
      expertise_areas: 'In-house roasting, seasonal drinks, latte art',
      offers: [{ name: 'Coffee subscription', features: 'Fresh roast every two weeks', advantages: 'Roasted to order, never shelf-stale', benefits: 'Cafe-quality coffee at home without thinking about it' }],
      proof_points: 'Voted best local coffee 2025; 4.9 stars from 600+ reviews',
      voice_adjectives: 'warm, local, a little nerdy', voice_avoid: 'corporate jargon, exclamation-mark overload',
      keywords: 'specialty coffee\nlocal roaster\nlatte art\nseasonal drinks',
      cta_lines: 'Stop by this week.\nOrder ahead in the app.\nAsk for the seasonal special.',
      hook_lines: 'Your barista has opinions.\nWe tasted 40 pumpkins so you don\'t have to.',
      social_links: { instagram: 'harborpinecoffee', facebook: 'harborpinecoffee', tiktok: 'harborpine', linkedin: 'https://www.linkedin.com/company/harbor-pine-example' },
      notebook_url: 'https://notes.example.com/harbor-pine',
    }),
    foundation(HP, 'fd2', 'Original launch (2023)', false, { niche: 'Coffee cart', elevator_pitch: 'Great coffee on the go.', voice_adjectives: 'friendly, upbeat' }),
  ];
  FOUNDATIONS[ROAST] = [foundation(ROAST, 'fd3', 'Roastery launch', true, { niche: 'Small-batch roaster', elevator_pitch: 'Coffee roasted twice a week, shipped the same day.', social_links: { instagram: 'harborpineroastery' } })];
  FOUNDATIONS[LD] = [foundation(LD, 'fd4', 'Family dentistry', true, { niche: 'Family dental practice', elevator_pitch: 'Gentle, modern dentistry for the whole family.', social_links: { facebook: 'lumendental', instagram: 'lumendental' } })];
  FOUNDATIONS[NF] = [foundation(NF, 'fd5', 'Community gym', true, { niche: 'Neighbourhood gym', social_links: { instagram: 'northsidefit' } })];

  var PROMPTS = {
    fd1: [
      { id: 'pr1', name: 'Instagram caption', prompt_text: 'Write an Instagram caption for a business with this positioning: {{elevator_pitch}}. Voice: {{voice_adjectives}}. Avoid: {{voice_avoid}}. End with one of these: {{cta_lines}}', notes: 'Use for any single-image or reel post.' },
      { id: 'pr2', name: 'Three hook ideas', prompt_text: 'Give me three opening hooks for a short video about {{niche}}, in the style of: {{hook_lines}}', notes: null },
    ],
  };

  var MESSAGES = {};
  MESSAGES[HP] = [
    { id: 'm1', body: 'We are closed Thursday the 26th for Thanksgiving. Can the holiday hours post go out Monday?', creator_label: 'Dana Reyes', created_at: iso(0, 2) },
    { id: 'm2', body: 'Noted. Holiday hours is scheduled for Monday 9am, and the gift card promo follows on the 2nd.', creator_label: 'Jordan Taylor', created_at: iso(0, 1) },
  ];
  MESSAGES[ROAST] = [{ id: 'm3', body: 'New single origin arrives next week. Photos to follow.', creator_label: 'Dana Reyes', created_at: iso(2) }];

  var ADMIN_USERS = [
    { email: 'morgan@studio.example', displayName: 'Morgan Ellis', role: 'admin', accounts: [] },
    { email: 'jordan@studio.example', displayName: 'Jordan Taylor', role: 'rep', accounts: [{ clickupAccountId: HP }, { clickupAccountId: ROAST }, { clickupAccountId: LD }] },
    { email: 'alex@studio.example', displayName: 'Alex Rivera', role: 'rep', accounts: [{ clickupAccountId: NF }, { clickupAccountId: LD }] },
    { email: 'dana@harborpine.example', displayName: 'Dana Reyes', role: 'client', accounts: [{ clickupAccountId: HP }, { clickupAccountId: ROAST }] },
    { email: 'priya@northside.example', displayName: 'Priya Shah', role: 'client', accounts: [{ clickupAccountId: NF }] },
  ];
  function usersByAccount() {
    var map = {};
    ADMIN_USERS.forEach(function (u) {
      u.accounts.forEach(function (a) { (map[a.clickupAccountId] = map[a.clickupAccountId] || []).push({ email: u.email, role: u.role }); });
    });
    return map;
  }
  function accountName(id) { var a = ACCOUNTS.filter(function (x) { return x.id === id; })[0]; return a ? a.name : id; }
  function taskAcct(t) { return t.custom_fields.filter(function (f) { return f.id === 'f-acct'; })[0].value; }

  // ---- Supabase stub ---------------------------------------------------------------
  window.supabase = {
    createClient: function () {
      function query(table) {
        if (table === 'contentflow_release_views') {
          var own = CFG.seenVersion ? { last_seen_version: CFG.seenVersion } : null;
          var rv = {
            select: function () { return rv; }, eq: function () { return rv; },
            maybeSingle: function () { return Promise.resolve({ data: own, error: null }); },
            upsert: function (row) { window.__CF_DEMO_UPSERTS.push(row); CFG.seenVersion = row.last_seen_version; return Promise.resolve({ data: null, error: null }); },
            then: function (res, rej) {
              var rows = RELEASE_VIEWS.concat(CFG.seenVersion ? [{ email: PROFILES[ROLE].email, role: ROLE, last_seen_version: CFG.seenVersion, seen_at: new Date(NOW).toISOString() }] : []);
              return Promise.resolve({ data: ROLE === 'admin' ? rows : [], error: null }).then(res, rej);
            },
          };
          return rv;
        }
        var data = table === 'profiles' ? PROFILES[ROLE]
          : table === 'account_access' ? ACCESS[ROLE].map(function (id) { return { clickup_account_id: id, clickup_list_id: null }; })
          : table === 'account_settings' ? ACCOUNTS.map(function (a) { return { account_id: a.id, is_active: INACTIVE.indexOf(a.id) === -1 }; })
          : [];
        var b = {
          select: function () { return b; }, in: function () { return b; }, eq: function () { return b; }, order: function () { return b; },
          single: function () { return Promise.resolve({ data: data, error: null }); },
          then: function (res, rej) { return Promise.resolve({ data: data, error: null }).then(res, rej); },
        };
        return b;
      }
      var session = CFG.signedOut ? null : { user: { id: PROFILES[ROLE].id, email: PROFILES[ROLE].email }, access_token: 'demo-token' };
      return {
        auth: {
          getSession: function () { return Promise.resolve({ data: { session: session } }); },
          onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
          signInWithPassword: function () { return Promise.resolve({ error: { message: 'This is a demo -- sign-in is disabled.' } }); },
          signOut: function () { return Promise.resolve({}); },
          updateUser: function () { return Promise.resolve({ data: {}, error: null }); },
        },
        from: query,
        storage: { from: function () { return { uploadToSignedUrl: function () { return Promise.resolve({ error: null }); } }; } },
      };
    },
  };

  // ---- ClickUp proxy ---------------------------------------------------------------
  function clickup(path, method, body) {
    var m;
    if (path === '/user') return { user: { id: 501, username: 'Demo' } };
    if ((m = path.match(/^\/list\/(\d+)\/field$/))) return { fields: FIELDS };
    if ((m = path.match(/^\/list\/(\d+)\/member$/))) return { members: MEMBERS };
    if ((m = path.match(/^\/list\/(\d+)\/task/))) {
      if (method === 'POST') { var t = { id: 't9' + TASKS.length, name: body.name, status: STATUSES[0], assignees: [], custom_fields: cf({}), date_updated: String(NOW) }; TASKS.unshift(t); return t; }
      if (m[1] === ACCOUNTS_LIST_ID) {
        return { tasks: ACCOUNTS.map(function (a) { return { id: 'acc-' + a.id, name: a.name, custom_fields: [{ id: 'f-mkc', name: 'MKC ID', type: 'short_text', value: a.id }] }; }) };
      }
      return { tasks: TASKS };
    }
    if ((m = path.match(/^\/list\/(\d+)$/))) return { id: m[1], name: 'Client Master Content Strategy Workflow', statuses: STATUSES };
    if ((m = path.match(/^\/task\/([^/]+)\/comment$/))) {
      if (method === 'POST') { (COMMENTS[m[1]] = COMMENTS[m[1]] || []).unshift({ id: 'cn' + Date.now(), comment_text: body.comment_text, user: { username: PROFILES[ROLE].display_name }, date: String(Date.now()) }); return {}; }
      return { comments: COMMENTS[m[1]] || [] };
    }
    if ((m = path.match(/^\/task\/([^/]+)\/field\/([^/]+)$/))) return {};
    if ((m = path.match(/^\/task\/([^/]+)$/))) return method === 'DELETE' ? {} : (TASKS.filter(function (t) { return t.id === m[1]; })[0] || {});
    return undefined;
  }

  // ---- ContentFlow backend -------------------------------------------------------------
  function backend(path, q, method, body) {
    var acct = q.get('accountId');
    switch (path) {
      case '/api/clickup-proxy': return clickup(body.path, body.method || 'GET', body.body) || clickupFallback(body);
      case '/api/accounts': return method === 'GET' ? { inactiveAccountIds: INACTIVE, usersByAccount: usersByAccount() } : {};
      case '/api/admin/list-users': return { users: ADMIN_USERS };
      case '/api/admin/invite-user': return { ok: true };
      case '/api/profile': return { ok: true };
      case '/api/client/tasks': {
        if (method === 'POST') return { ok: true };
        var mine = ACCESS.client;
        var names = {}; mine.forEach(function (id) { names[id] = accountName(id); });
        return { tasks: TASKS.filter(function (t) { return mine.indexOf(taskAcct(t)) !== -1; }), accountNames: names };
      }
      case '/api/client/comments': return method === 'POST' ? { ok: true } : { comments: COMMENTS[q.get('taskId')] || [] };
      case '/api/account-messages': return method === 'POST' ? { message: { id: 'mn', body: body.body, creator_label: PROFILES[ROLE].display_name, created_at: new Date().toISOString() } } : { messages: MESSAGES[acct] || [] };
      case '/api/files/list': { var id = q.get('taskId'); return { files: FILES[id] || IDEA_FILES[id] || [] }; }
      case '/api/files/download-url': return { url: 'about:blank' };
      case '/api/files/upload-url': case '/api/files/delete': return { ok: true };
      case '/api/pillars': return method === 'GET' ? { pillars: PILLARS[acct] || [] } : { ok: true };
      case '/api/ideas': return method === 'GET' ? { ideas: IDEAS[acct] || [] } : { ok: true };
      case '/api/rhythm': return method === 'GET' ? { rhythm: CFG.noRhythm ? null : RHYTHM } : { rhythm: RHYTHM };
      case '/api/brand-foundation': return method === 'GET' ? { foundations: FOUNDATIONS[acct] || [] } : { ok: true };
      case '/api/prompt-library': return method === 'GET' ? { prompts: PROMPTS[q.get('foundationId')] || [] } : { ok: true };
      case '/api/oauth-exchange': return { ok: true };
    }
    return undefined;
  }
  function clickupFallback(body) { window.__CF_DEMO_UNHANDLED.push('clickup ' + (body.method || 'GET') + ' ' + body.path); return {}; }

  var realFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf(BACKEND) === -1) return realFetch.apply(this, arguments);
    var u = new URL(url);
    var method = (init && init.method) || 'GET';
    var body = null;
    try { body = init && init.body ? JSON.parse(init.body) : null; } catch (e) { body = null; }
    var result = backend(u.pathname, u.searchParams, method, body);
    if (result === undefined) {
      window.__CF_DEMO_UNHANDLED.push(method + ' ' + u.pathname + u.search);
      return Promise.resolve(new Response(JSON.stringify({ error: 'Demo data has no answer for ' + u.pathname }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
    }
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })); }, 5);
    });
  };
})();
