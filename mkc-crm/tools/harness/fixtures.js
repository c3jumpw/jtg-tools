// Fixture data for rendering MKC CRM offline. Shapes mirror what the app
// reads (ClickUp task objects w/ custom_fields, Sheets value arrays,
// /api/staging rows with SQL-style UTC timestamps, etc).
const NOW = Date.now();
const DAY = 864e5, HR = 36e5;
const ms = d => String(Math.round(NOW - d));          // ClickUp string ms
const sqlUtc = msAgo => new Date(NOW - msAgo).toISOString().replace('T', ' ').slice(0, 19);

const F = { // field ids copied from the app's CU_FIELDS
  BRANCH: '6623fa17-7220-4e17-8011-ee6a4a8fe2c7', EMAIL: '7e3e1cac-80c3-4424-988c-e66c89b44fe5',
  PHONE: 'd41f3e8a-c719-4de5-b5d6-00ac496a5e60', TYPE: '1d69cb4f-928e-4dcb-bf6e-1519519140b4',
  NAD: '8865a284-7e78-4328-9d3a-c01e2cbfd8c2', SB_JTG: '20b50b13-180c-4d35-9b6d-e54d055d1393',
  SOURCE: '44476ae7-636f-4d0f-973d-3dfe89b6ea80', KNOWN: '2e7b9ad6-456e-4aa5-a1a6-166e4267ceb0',
  LAST_ACTION: '97828e31-718b-418e-bc9b-83ad1c47afb3', COMPANY: '73785f38-2d0b-424f-b45f-a42d0cd532d0',
  OPP: '1d4e9287-decb-4f8b-841e-63a4b13b345c', PLAN: 'f6f4749a-f850-4c4f-8434-896e47488571',
  ACCT_STATUS: 'c5315bbe-aada-489b-8efd-d48f75cda9d5', MAIN_CONTACT: '713872a4-68d9-4aa9-b7f4-99cfc19c746b',
  REL_LC: 'f6832391-c71f-4f14-9962-172f00f23a7d', REL_DEAL: '1aadae14-4a3d-406a-a4c9-eb6d9e6cb6dd',
  REL_ACCT: '80a6aefc-e9d9-488f-926b-6dcb780f3736', NOTEBOOK: '5e37aae5-7f16-4669-b05a-0435ca51c5dd',
};
const BR = { JTG: 'a842dfdd-2da9-4a0c-8c8f-eb27543d598d', UNY: '3bf70234-24f3-47b4-99a7-6fe33287aa6b', MCO: 'c919face-ad76-4489-b76c-6433fd574dfc', 'MKC SA': 'bdcde1f5-8652-4512-9dfe-933e0663c9cb' };
const branchOpts = Object.entries(BR).map(([label, id]) => ({ id, label }));
const typeOpts = [['59fcb834-7901-4177-b346-101cb9abf871', 'High Value'], ['b74611f9-53e5-4b9b-a9d8-b64c0a76bdef', 'Demo Prospect'], ['e0825a89-720a-4212-884e-5a80fb347ed1', 'Potential Client'], ['947afcc8-d8e9-4706-a2eb-f71dc1ba9c4c', 'Client']].map(([id, label]) => ({ id, label }));
const sbOpts = ['F5', 'F5 CEO', 'BMS', 'BB', 'PD'].map((name, i) => ({ id: 'sb' + i, name, orderindex: i }));

const TEAM = [
  { id: 1001, username: 'Dana Reyes', email: 'dana.reyes@mkc-example.com' },
  { id: 1002, username: 'Marcus Bell', email: 'marcus.bell@mkc-example.com' },
  { id: 1003, username: 'Priya Natarajan', email: 'priya.n@mkc-example.com' },
  { id: 1004, username: 'Leo Okafor', email: 'leo.okafor@mkc-example.com' },
];
const asg = i => [TEAM[i % 4]];

function cfBranch(b) { return { id: F.BRANCH, name: 'Branch', type: 'labels', type_config: { options: branchOpts }, value: [BR[b]] }; }
function cfType(i) { return { id: F.TYPE, name: 'Lead/Contact Type', type: 'labels', type_config: { options: typeOpts }, value: [typeOpts[i % typeOpts.length].id] }; }
function cfText(id, name, value, type = 'short_text') { return { id, name, type, value }; }
function cfDate(id, name, value) { return { id, name, type: 'date', value }; }

const FIRST = ['Sharon', 'Miles', 'Andre', 'Keisha', 'Tom', 'Gabriela', 'Victor', 'Hannah', 'Omar', 'Lena', 'Raj', 'Brittany', 'Carlos', 'Mei', 'Darnell', 'Yusuf'];
const LAST = ['Garry', 'Whitfield', 'Okonkwo', 'Patel', 'Lindqvist', 'Moreno', 'Chen', 'Abernathy', 'Haddad', 'Fischer', 'Nguyen', 'Sorensen'];
const LEAD_ST = ['pre-engagement', 'manual outreach cue', 'initial contact made', 'nurturing', 'attention needed', 'ready for pipeline', 'churned/disqualified'];
const DEAL_ST = ['oppurtunity', 'scheduled ds / intro', 'qualified lead/prospect', 'demo presented', 'proposal pending', 'offer prsntd / negotiation', 'closed / won', 'archived'];
const CONTACT_ST = ['listed', 'to do', 'in progress', 'in review', 'completed'];
const BRANCHES = ['JTG', 'JTG', 'UNY', 'MCO', 'MKC SA'];

function person(prefix, i, statuses, extra = {}) {
  const fn = FIRST[i % FIRST.length], ln = LAST[(i * 7) % LAST.length];
  const id = `86${prefix}${String(1000 + i)}`.slice(0, 9);
  const updatedAgo = [0.2, 1, 2, 5, 6, 9, 14, 30][i % 8] * DAY;
  return {
    id, name: `${fn} ${ln}`, status: { status: statuses[i % statuses.length], color: '#999' },
    date_updated: ms(updatedAgo), date_created: ms(updatedAgo + 20 * DAY), parent: null,
    assignees: asg(i), due_date: i % 5 === 0 ? ms(-2 * DAY) : null, description: i % 3 === 0 ? 'Met at the Atlanta CEO breakfast. Interested in the F5 program; follow up after the holidays.' : '',
    custom_fields: [
      cfBranch(BRANCHES[i % BRANCHES.length]), cfType(i),
      cfText(F.EMAIL, 'Email', `${fn.toLowerCase()}.${ln.toLowerCase()}@example.com`, 'email'),
      cfText(F.PHONE, 'Phone', `+1 470 555 ${String(1000 + i * 37).slice(-4)}`, 'phone'),
      cfDate(F.NAD, 'Next Action Date', i % 2 ? ms(-(i % 20) * DAY) : null),
      { id: F.SB_JTG, name: 'Sub-Branch (JTG)', type: 'drop_down', type_config: { options: sbOpts }, value: i % 5 },
      cfText(F.KNOWN, 'Known As', fn), cfText(F.NOTEBOOK, 'Notebook Link', i % 4 === 0 ? 'https://notebooklm.google.com/notebook/abc' : null, 'url'),
    ],
    ...extra,
  };
}

const leads = Array.from({ length: 34 }, (_, i) => person('le', i, LEAD_ST));
// Edge cases a real team hits: apostrophes, very long names/emails.
leads[0].name = "Dana's Bakery (Sharon O'Neill)";
leads[0].custom_fields[2].value = 'sharon.oneill.procurement.department@danasbakery-and-catering-example.com';
leads[1].name = 'Bartholomew Featherstonehaugh-Montgomery III, Regional Director of Strategic Partnerships';
leads[2].custom_fields[3].value = '+1 470 555 0134'; // matches the inbox text below

const pipeline = Array.from({ length: 14 }, (_, i) => {
  const t = person('pi', i + 50, DEAL_ST);
  t.name = ['Peachtree Holdings — F5 Retainer', 'Delta Logistics Expansion', "O'Malley & Sons Renewal", 'Northside Dental Group', 'Atlas Fitness Franchise', 'Sweet Auburn Co-op', 'Ridgeview Capital', 'Brightline Media', 'Summit Roofing', 'Harbor Health', 'Keystone Ventures', 'Lumen Studios', 'Crescent Realty', 'Juniper Labs'][i];
  t.status = { status: DEAL_ST[i % DEAL_ST.length] };
  t.custom_fields.push(cfText(F.COMPANY, 'Company/Account Name', t.name.split(' ')[0] + ' Inc.'),
    { id: F.OPP, name: 'Opportunity', type: 'currency', value: 2500 * (i + 1) },
    cfText('pcemail', 'Primary Contact Email', `owner${i}@example.com`, 'email'));
  return t;
});
const contacts = Array.from({ length: 22 }, (_, i) => person('co', i + 100, CONTACT_ST));
const accounts = Array.from({ length: 9 }, (_, i) => {
  const t = person('ac', i + 200, ['listed', 'in review', 'completed']);
  t.name = ['Peachtree Holdings', 'Delta Logistics', "O'Malley & Sons", 'Northside Dental Group', 'Atlas Fitness', 'Sweet Auburn Co-op', 'Ridgeview Capital', 'Brightline Media', 'Summit Roofing'][i];
  t.custom_fields.push({ id: F.ACCT_STATUS, name: 'Account Status', type: 'drop_down', type_config: { options: [{ id: 'as0', name: 'Active', orderindex: 0 }, { id: 'as1', name: 'Under Review', orderindex: 1 }] }, value: i % 2 },
    cfText(F.MAIN_CONTACT, 'Main Contact', FIRST[i] + ' ' + LAST[i]));
  // "Referenced By": this account id appears inside a deal's field value
  return t;
});
pipeline[0].custom_fields.push(cfText('relacct', 'Related Account', accounts[0].id));

const TASK_ST = ['to do', 'in progress', 'for review', 'completed/approved'];
const master = Array.from({ length: 16 }, (_, i) => {
  const names = ["Call Sharon O'Neill re: catering proposal", 'Send F5 deck to Peachtree', "Follow up on Dana's invoice", 'Prep demo for Delta Logistics', 'Book discovery call — Northside Dental', 'Draft renewal terms', 'Confirm Atlas walkthrough', 'Upload signed agreement', 'Review Q4 pipeline', 'Text Miles about workshop', 'Email onboarding packet', 'Schedule kickoff', 'Collect deposit — Ridgeview', 'Update Brightline notes', 'Reconcile CRM duplicates', 'Weekly team sync agenda'];
  const due = [3 * DAY, 1 * DAY, 0.1 * DAY, -0.2 * DAY, -2 * DAY, -4 * DAY, -10 * DAY, null, 6 * DAY, 2 * DAY, -1 * DAY, null, 9 * DAY, -3 * DAY, null, -5 * DAY][i];
  const cfs = [];
  // Task 3 links a DEAL's id through the "Related Lead/Contact ID" field --
  // the workflow-reality case the app's own comments describe.
  if (i === 3) cfs.push(cfText(F.REL_LC, 'Related Lead/Contact ID', pipeline[1].id));
  else if (i % 3 === 0) cfs.push(cfText(F.REL_LC, 'Related Lead/Contact ID', leads[i % leads.length].id));
  else if (i % 3 === 1) cfs.push(cfText(F.REL_DEAL, 'Related Deal ID', pipeline[i % pipeline.length].id));
  else cfs.push(cfText(F.REL_ACCT, 'Related Account ID', accounts[i % accounts.length].id));
  return { id: `86ta${1000 + i}`, name: names[i], status: { status: i === 3 ? 'to do' : TASK_ST[i % 4] }, date_updated: ms(i * HR), date_created: ms(i * DAY + 5 * DAY), parent: null, assignees: asg(i), due_date: due == null ? null : ms(due), start_date: null, custom_fields: cfs };
});

const SHEETS = {
  'ClickUp Labels Mastersheet!A:C': [['UUID', 'Label', 'Field'], ...branchOpts.map(o => [o.id, o.label, 'Branch'])],
  'MKC Team Member Directory!A:T': [['MKC ID', 'Status', 'First', 'Last', 'Middle', 'Known As', 'Branch', 'Role', 'Hire', 'Term', 'P Email', 'P Phone', 'Addr', 'WS Name', 'WS Email', 'Passcode', 'Pub Email', 'Pub Phone', 'Quo ID', 'Access'],
    ...TEAM.map((m, i) => [`86a1b2c3${i}`, 'Active', m.username.split(' ')[0], m.username.split(' ')[1], '', '', 'JTG', 'Rep', '', '', '', '', '', m.username, m.email, 'REDACTED-FIXTURE', m.email, '+14705550100', '', i ? 'Staff' : 'Super Admin'])],
  'Entities & Branches!A:D': [['ID', 'Branch', 'Entity', 'Notes'], ['1', 'JTG'], ['2', 'UNY'], ['3', 'MCO'], ['4', 'MKC SA']],
  'Lead Sources!A:C': [['UUID', 'Source', 'Notes'], ['x', 'Referral'], ['y', 'Met at Event']],
  'Master CRM Entries!A:K': [['ID']], 'Master CRM Tasks!A:H': [['Task']], 'Entities & Branches!A1': [['ID']],
};

// Activity Inbox rows. occurred_at uses the SQL "YYYY-MM-DD HH:MM:SS" UTC
// format the app's own qcRelTime() normalizes for.
const STAGING = [
  { id: 'evt_101', source_type: 'quo', event_type: 'text', direction: 'incoming', status: 'pending', occurred_at: sqlUtc(25 * 60e3), contact_identifier: '+14705550134', contact_name: null, owner_name: 'Dana Reyes', thread_key: 'quo:+14705550134', body: 'Hi Dana — got the catering proposal, can we push the tasting to Thursday at 3? Also my partner wants to see the F5 pricing sheet.' },
  { id: 'evt_100', source_type: 'quo', event_type: 'text', direction: 'outgoing', status: 'posted', occurred_at: sqlUtc(3 * HR), contact_identifier: '+14705550134', contact_name: null, owner_name: 'Dana Reyes', thread_key: 'quo:+14705550134', body: 'Sending the proposal over now!' },
  { id: 'evt_102', source_type: 'quo', event_type: 'call', direction: 'incoming', status: 'pending', occurred_at: sqlUtc(5 * HR), contact_identifier: '+16785550199', contact_name: null, owner_name: 'Marcus Bell', thread_key: 'quo:+16785550199', body: 'Call answered (4m 12s)\n\n[AI Summary]\nCaller asked about the workshop dates and whether the BMS track has openings in January.\n\n[Transcript]\nMarcus: MKC, this is Marcus.\nCaller: Hi, I saw the flyer for the workshop...' },
  { id: 'evt_103', source_type: 'zoho_mail', event_type: 'email', direction: 'incoming', status: 'pending', occurred_at: sqlUtc(26 * HR), contact_identifier: 'owner3@example.com', contact_name: null, owner_name: 'Priya Natarajan', thread_key: 'zoho:owner3@example.com', subject: 'Re: Northside Dental — revised quote', body: 'Thanks Priya, the revised numbers work. Can you send the agreement for e-signature?' },
  { id: 'evt_104', source_type: 'manual', event_type: 'note', direction: 'outgoing', status: 'pending', occurred_at: sqlUtc(2 * DAY), contact_identifier: null, contact_name: null, owner_name: 'Dana Reyes', thread_key: 'manual:1', body: 'Ran into Miles at the chamber mixer, he wants a demo for his ops team next week.' },
  { id: 'evt_105', source_type: 'quo', event_type: 'call', direction: 'incoming', status: 'assigned', occurred_at: sqlUtc(4 * DAY), contact_identifier: '+18005550000', contact_name: null, owner_name: 'Leo Okafor', thread_key: 'quo:+18005550000', body: 'Missed call' },
];
const THREADS = {};
STAGING.forEach(s => { (THREADS[s.thread_key] = THREADS[s.thread_key] || []).push(s); });
Object.values(THREADS).forEach(a => a.sort((x, y) => x.occurred_at.localeCompare(y.occurred_at)));

const SCHEDULED = [
  { id: 'sch_1', status: 'awaiting_confirmation', channel: 'text', entry_name: "Dana's Bakery (Sharon O'Neill)", scheduled_for: new Date(NOW + 2 * HR).toISOString(), message: 'Hi Sharon, just checking in on the tasting.', action_label: 'Check-in' },
  { id: 'sch_2', status: 'pending', channel: 'email', entry_name: 'Peachtree Holdings — F5 Retainer', scheduled_for: new Date(new Date().setHours(23, 0, 0, 0)).toISOString(), message: 'Proposal attached.', action_label: 'Send Proposal' },
];

const COMMENTS = [
  { id: 'c1', comment_text: '[LOG] #call — Marcus Bell | 11/03/2026 | 2:14 PM\nLeft voicemail, will try again Thursday.', user: { username: 'Marcus Bell' }, date: ms(1 * DAY) },
  { id: 'c2', comment_text: '[LOG] Status → NURTURING — Dana Reyes | 10/30/2026 | 9:02 AM', user: { username: 'Dana Reyes' }, date: ms(5 * DAY) },
  { id: 'c3', comment_text: 'Assigned from Activity Inbox: "Can we push the tasting to Thursday?"', user: { username: 'Priya Natarajan' }, date: ms(0.1 * DAY) },
];

const SESSION_USER = { name: 'Dana Reyes', knownAs: 'Dana', mkcId: '86a1b2c30', accessLevel: 'super admin', branch: 'JTG', role: 'Operations Lead', wsEmail: 'dana.reyes@mkc-example.com' };
const DIRECTORY = TEAM.map((m, i) => ({ mkcId: `86a1b2c3${i}`, firstName: m.username.split(' ')[0], lastName: m.username.split(' ')[1], branch: 'JTG' }));

module.exports = { lists: { '901710477809': leads, '901710326878': pipeline, '901710477009': contacts, '901710481777': accounts, '901714539764': master, '901715467342': [], '901711759484': [] }, TEAM, SHEETS, STAGING, THREADS, SCHEDULED, COMMENTS, SESSION_USER, DIRECTORY, ids: { leadApos: leads[0].id, leadLong: leads[1].id, deal0: pipeline[0].id, acct0: accounts[0].id, task0: master[0].id } };
