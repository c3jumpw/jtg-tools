// api/_lib/activities.ts
//
// The one catalog of who a lead came through (brand) and what they did
// (action). Every Systeme.io tag and every CRM activity is derived from it,
// so a tag's name, its description and the ClickUp fields it sets can never
// drift apart.
//
// Files under api/_lib are helpers, not routes: Vercel does not turn paths
// that start with an underscore into functions.
//
// ── TAG NAMES ─────────────────────────────────────────────────────────
// "<BRAND> · <Action>", e.g. "BMS · Brand brief started". Brand codes are
// the CRM's own Sub-Branch codes, so a tag sorts and filters the same way
// a ClickUp record does.
//
// Systeme.io tags have a name and nothing else (no description field in
// the app or the API). Each tag's descriptor therefore lives here, is
// written onto the contact as their "Last action", and is served by
// GET /api/lead-activity?catalog=1 for the tag guide.

export type Brand = {
  code: string;           // tag prefix and CRM Sub-Branch value
  name: string;           // human name
  branch: 'JTG' | 'MCO' | 'UNY' | 'MKC SA';
  subBranch: string | null; // CRM Sub-Branch option; null when ClickUp has none for it
  site: string;
};

export const BRANDS: Record<string, Brand> = {
  F5:      { code: 'F5',     name: 'The Fortune 5 Agency', branch: 'JTG', subBranch: 'F5',     site: 'befortune5.com' },
  F5CEO:   { code: 'F5 CEO', name: 'Fortune 5 CEO',        branch: 'JTG', subBranch: 'F5 CEO', site: 'fortune5ceo.com' },
  BMS:     { code: 'BMS',    name: 'Build My Startup',     branch: 'JTG', subBranch: 'BMS',    site: 'buildmystart-up.com' },
  PD:      { code: 'PD',     name: 'The Party Designers',  branch: 'JTG', subBranch: 'PD',     site: 'wearepartydesigners.com' },
  BB:      { code: 'BB',     name: 'Bar Boost',            branch: 'JTG', subBranch: 'BB',     site: 'barboost.j-tgroup.com' },
  BLK:     { code: 'BLK',    name: 'Blanket Label',        branch: 'JTG', subBranch: 'BLK',    site: 'blanket-label.j-tgroup.com' },
  BLM:     { code: 'BLM',    name: 'Blloom',               branch: 'JTG', subBranch: 'BLM',    site: 'bloom.j-tgroup.com' },
  ACAD:    { code: 'ACAD',   name: 'Acad Branding',        branch: 'JTG', subBranch: 'ACAD',   site: 'acad.j-tgroup.com' },
  SD:      { code: 'SD',     name: 'Seeder',               branch: 'JTG', subBranch: 'SD',     site: 'seeder.j-tgroup.com' },
  BC:      { code: 'BC',     name: 'BC Agency',            branch: 'JTG', subBranch: 'BC',     site: 'bc-agency.j-tgroup.com' },
  MBC:     { code: 'MBC',    name: 'Media BC',             branch: 'JTG', subBranch: 'MBC',    site: 'media-bc.j-tgroup.com' },
  JW:      { code: 'JW',     name: 'Jumpwebs',             branch: 'JTG', subBranch: null,     site: 'jumpwebs.j-tgroup.com' },
  JTG:     { code: 'JTG',    name: 'Jump Tech Group',      branch: 'JTG', subBranch: null,     site: 'j-tgroup.com' },
};

export type Action = {
  label: string;          // second half of the tag name
  description: string;    // the tag's descriptor; {brand} and {site} are filled in
  leadSource: 'inquiry' | 'opted-in';
  contactType: 'potential client' | 'supporter';
};

export const ACTIONS: Record<string, Action> = {
  booked_call: {
    label: 'Booked call',
    description: 'Booked a call with the {brand} team on the booking page ({site}).',
    leadSource: 'inquiry', contactType: 'potential client',
  },
  requested_time: {
    label: 'Requested a time',
    description: 'Asked {brand} for a meeting time because no open time suited them or nobody was bookable yet.',
    leadSource: 'inquiry', contactType: 'potential client',
  },
  discovery_form: {
    label: 'Discovery form',
    description: 'Submitted the {brand} brand discovery form, the business intake that starts a project.',
    leadSource: 'inquiry', contactType: 'potential client',
  },
  start_form: {
    label: 'Start form',
    description: 'Submitted the {brand} "Start your build" intake form.',
    leadSource: 'inquiry', contactType: 'potential client',
  },
  brand_brief_started: {
    label: 'Brand brief started',
    description: 'Saved at least one session of the {brand} Personal Brand Kickoff brief; may not have finished all three.',
    leadSource: 'inquiry', contactType: 'potential client',
  },
  brand_brief_complete: {
    label: 'Brand brief complete',
    description: 'Finished all three sessions of the {brand} Personal Brand Kickoff brief.',
    leadSource: 'inquiry', contactType: 'potential client',
  },
  contact_form: {
    label: 'Contact form',
    description: 'Sent {brand} a message through the contact form on {site}.',
    leadSource: 'inquiry', contactType: 'potential client',
  },
  design_request: {
    label: 'Design request',
    description: 'Requested a design from {brand} through the "Tell us about it" form.',
    leadSource: 'inquiry', contactType: 'potential client',
  },
  updates_signup: {
    label: 'Updates sign-up',
    description: 'Signed up for {brand} updates and news.',
    leadSource: 'opted-in', contactType: 'supporter',
  },
};

export function tagName(brand: Brand, action: Action): string {
  return `${brand.code} · ${action.label}`;
}

export function describe(brand: Brand, action: Action): string {
  return action.description.replace('{brand}', brand.name).replace('{site}', brand.site);
}

// GET /api/lead-activity?catalog=1 -- the tag guide, generated from this file.
export function catalog() {
  const tags: Array<{ tag: string; brand: string; action: string; description: string }> = [];
  for (const b of Object.values(BRANDS)) {
    for (const [key, a] of Object.entries(ACTIONS)) {
      if (!actionApplies(b, key)) continue;
      tags.push({ tag: tagName(b, a), brand: b.name, action: key, description: describe(b, a) });
    }
  }
  return tags;
}

// Which actions each brand actually has a form for. Keeps the guide honest:
// it lists the tags that can occur, not every theoretical combination.
const BRAND_ACTIONS: Record<string, string[]> = {
  F5: ['booked_call', 'requested_time', 'discovery_form', 'contact_form'],
  BMS: ['booked_call', 'requested_time', 'start_form', 'brand_brief_started', 'brand_brief_complete', 'contact_form'],
  'F5 CEO': ['updates_signup', 'contact_form'],
  PD: ['design_request', 'contact_form'],
};
export function actionApplies(brand: Brand, action: string): boolean {
  const list = BRAND_ACTIONS[brand.code];
  return list ? list.includes(action) : action === 'contact_form' || action === 'updates_signup';
}
