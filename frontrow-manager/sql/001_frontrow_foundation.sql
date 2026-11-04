-- Frontrow — client portal platform — foundation schema
--
-- Lives in the MKC-Admin project beside `core` (shared people, sessions,
-- tool access) and `booking`. Same security model as those two:
--
--   * Only the server, holding the service-role key, can reach this schema.
--     anon and authenticated get no USAGE on it, so the public anon key
--     cannot see these tables through the REST API at all.
--   * RLS is enabled on every table with no policies, as a second wall: if a
--     grant is ever added by mistake, rows still stay invisible.
--   * Scoping (which organization, company, contact) is decided by the
--     server on every request from the session — never from ids the browser
--     sends.
--
-- Shape of the data:
--
--   organization  a tenant with its own branded sign-in page (JTG, MCO, UNY,
--                 MKC). Mirrors the ClickUp "Branch" label.
--   branch        a brand inside an organization (Fortune 5, BMS, Anvil…).
--                 Mirrors the ClickUp "Sub-Branch" value.
--   company       a client account. Mirrors a task in the ClickUp Accounts
--                 list; `active` follows its Account Status.
--   contact       a client person. Mirrors a task in the ClickUp Contacts
--                 list and links to one or more companies.
--   account       a contact's sign-in (password). Exists only for contacts
--                 linked to at least one active company.
--
-- Staff are core.people with a core.tool_access row for tool 'frontrow'.
-- Clients are frontrow.contacts — deliberately NOT core.people, which is the
-- MKC team roster.

create schema if not exists frontrow;
revoke all on schema frontrow from public, anon, authenticated;
grant usage on schema frontrow to service_role;

create or replace function frontrow.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ── Organizations and branches ──────────────────────────────────────────

create table frontrow.organizations (
  id             uuid primary key default gen_random_uuid(),
  -- The sign-in URL is /<slug>. Words the app itself uses are reserved.
  slug           text not null unique
                 check (slug ~ '^[a-z0-9][a-z0-9-]{1,30}$'
                        and slug not in ('api', 'css', 'js', 'assets', 'signin', 'manager', 'admin',
                                         'app', 'www', 'help', 'frontrow', 'static', 'setup', 'reset')),
  name           text not null check (length(btrim(name)) between 1 and 120),
  -- The ClickUp "Branch" label this organization stands for ('JTG', 'MKC SA').
  clickup_label  text unique,
  -- Optional own host name for the sign-in page, e.g. portal.j-tgroup.com.
  custom_domain  text unique check (custom_domain is null or custom_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  -- { accent, ink, logo, logo_on_dark, icon, font, home_url, tagline }
  branding       jsonb not null default '{}'::jsonb,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table frontrow.organizations is
  'A tenant: one branded Frontrow sign-in page and the companies it serves. Mirrors the ClickUp Branch label.';

create table frontrow.branches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references frontrow.organizations (id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 120),
  -- The ClickUp "Sub-Branch" value ('F5', 'BMS', 'Anvil').
  clickup_value   text,
  logo            text,                         -- asset path or https URL
  tile            text not null default 'light' check (tile in ('light', 'dark', 'tint')),
  sort            integer not null default 100,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, clickup_value)
);
create index branches_org_idx on frontrow.branches (organization_id, sort);

-- ── Clients ─────────────────────────────────────────────────────────────

create table frontrow.companies (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references frontrow.organizations (id) on delete restrict,
  branch_id               uuid references frontrow.branches (id) on delete set null,
  name                    text not null check (length(btrim(name)) between 1 and 200),
  clickup_account_id      text unique,
  -- The ClickUp Account Status option name, as last synced ('active', 'pre-deal'…).
  clickup_status          text,
  -- Contacts can sign in only to companies that are active. Follows the
  -- ClickUp Account Status ('active') on every sync.
  active                  boolean not null default true,
  branding                jsonb not null default '{}'::jsonb,
  primary_owner_person_id uuid references core.people (id) on delete set null,
  source                  text not null default 'manual' check (source in ('clickup', 'manual')),
  synced_at               timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index companies_org_idx on frontrow.companies (organization_id, branch_id);
comment on column frontrow.companies.clickup_account_id is
  'ClickUp task ID in the Accounts list. The join key for sync.';

create table frontrow.contacts (
  id                 uuid primary key default gen_random_uuid(),
  -- Stored lower-case: sign-in matches emails exactly.
  email              text not null check (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' and email = lower(email)),
  full_name          text not null default '',
  clickup_contact_id text unique,
  active             boolean not null default true,
  synced_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index contacts_email_key on frontrow.contacts (email);
comment on table frontrow.contacts is
  'A client person. Mirrors a ClickUp Contacts task; one contact can belong to several companies.';

create table frontrow.contact_companies (
  contact_id uuid not null references frontrow.contacts (id) on delete cascade,
  company_id uuid not null references frontrow.companies (id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'member', 'viewer')),
  -- 'clickup' links are rewritten by every sync; 'manual' links (made in
  -- Frontrow Manager, and written back to ClickUp) are left alone.
  source     text not null default 'manual' check (source in ('clickup', 'manual')),
  created_at timestamptz not null default now(),
  primary key (contact_id, company_id)
);
create index contact_companies_company_idx on frontrow.contact_companies (company_id);

-- ── Client accounts (sign-in) ───────────────────────────────────────────
-- An account belongs to exactly one contact. It is created when the contact
-- sets a password from a setup link. Only an scrypt hash is stored.

create table frontrow.accounts (
  contact_id      uuid primary key references frontrow.contacts (id) on delete cascade,
  password_hash   text check (password_hash is null or password_hash like 'scrypt$%'),
  status          text not null default 'active' check (status in ('active', 'disabled')),
  activated_at    timestamptz,
  last_sign_in_at timestamptz,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One-time links: 'setup' (create a password; made by staff or requested by
-- an eligible contact) and 'reset' (forgot password). Only SHA-256 hashes of
-- the tokens are stored; the raw token lives in the link's #fragment.
create table frontrow.account_tokens (
  token_hash           text primary key,
  contact_id           uuid not null references frontrow.contacts (id) on delete cascade,
  purpose              text not null check (purpose in ('setup', 'reset')),
  organization_id      uuid references frontrow.organizations (id) on delete set null,
  created_by_person_id uuid references core.people (id) on delete set null,
  created_at           timestamptz not null default now(),
  expires_at           timestamptz not null,
  used_at              timestamptz,
  ip                   text
);
create index account_tokens_contact_idx on frontrow.account_tokens (contact_id, purpose);

create table frontrow.client_sessions (
  token_hash text primary key,
  contact_id uuid not null references frontrow.contacts (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip         text,
  user_agent text
);
create index client_sessions_contact_idx on frontrow.client_sessions (contact_id);

-- People who asked for access from a sign-in page but aren't linked to an
-- active account. They confirm their email first (so bots can't create CRM
-- entries); confirmation creates or comments on their ClickUp contact.
create table frontrow.access_requests (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid references frontrow.organizations (id) on delete set null,
  email              text not null check (email = lower(email)),
  full_name          text not null default '',
  company_name       text not null default '',
  message            text not null default '' check (length(message) <= 2000),
  status             text not null default 'unconfirmed'
                     check (status in ('unconfirmed', 'confirmed', 'approved', 'dismissed')),
  confirm_token_hash text unique,
  confirm_expires_at timestamptz,
  clickup_task_id    text,
  ip                 text,
  created_at         timestamptz not null default now(),
  confirmed_at       timestamptz,
  handled_by         uuid references core.people (id) on delete set null,
  handled_at         timestamptz
);
create index access_requests_status_idx on frontrow.access_requests (status, created_at desc);

-- ── Staff scoping ───────────────────────────────────────────────────────
-- super_admin and manager see every company; account_manager and
-- supervisor see only the companies assigned to them here.

create table frontrow.staff_company_assignments (
  person_id  uuid not null references core.people (id) on delete cascade,
  company_id uuid not null references frontrow.companies (id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (person_id, company_id)
);
create index staff_company_assignments_company_idx on frontrow.staff_company_assignments (company_id);

-- ── Published content ───────────────────────────────────────────────────

create table frontrow.updates (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references frontrow.companies (id) on delete cascade,
  type         text not null default 'update'
               check (type in ('update', 'task', 'guide', 'report', 'meeting')),
  title        text not null check (length(btrim(title)) between 1 and 200),
  summary      text not null default '' check (length(summary) <= 1000),
  notes        text not null default '' check (length(notes) <= 20000),
  body_html    text not null default '' check (length(body_html) <= 2000000),
  html_path    text,
  status       text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by   uuid references core.people (id) on delete set null,
  published_by uuid references core.people (id) on delete set null,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint updates_published_is_stamped check (status <> 'published' or published_at is not null)
);
create index updates_company_feed_idx on frontrow.updates (company_id, status, published_at desc);
comment on column frontrow.updates.body_html is
  'Self-contained HTML, rendered only inside a sandboxed frame served with its own CSP. Never inserted into a page directly.';
comment on column frontrow.updates.notes is
  'Staff working notes the page was built from. Internal only: never returned by any client-facing route.';

create table frontrow.files (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references frontrow.companies (id) on delete cascade,
  storage_path           text not null unique,
  name                   text not null check (length(btrim(name)) between 1 and 255),
  category               text not null default 'general',
  uploaded_by_person_id  uuid references core.people (id) on delete set null,
  uploaded_by_contact_id uuid references frontrow.contacts (id) on delete set null,
  created_at             timestamptz not null default now()
);
create index files_company_idx on frontrow.files (company_id, created_at desc);

create table frontrow.tasks_mirror (
  clickup_task_id text primary key,
  company_id      uuid not null references frontrow.companies (id) on delete cascade,
  title           text not null,
  status          text not null default '',
  due_date        timestamptz,
  assignee_type   text not null default 'staff' check (assignee_type in ('client', 'staff')),
  client_visible  boolean not null default false,
  synced_at       timestamptz not null default now()
);
create index tasks_mirror_company_idx on frontrow.tasks_mirror (company_id, client_visible, due_date);

create table frontrow.requests (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references frontrow.companies (id) on delete cascade,
  contact_id      uuid references frontrow.contacts (id) on delete set null,
  body            text not null check (length(btrim(body)) between 1 and 5000),
  clickup_task_id text,
  created_at      timestamptz not null default now()
);
create index requests_company_idx on frontrow.requests (company_id, created_at desc);

create table frontrow.notification_prefs (
  contact_id    uuid primary key references frontrow.contacts (id) on delete cascade,
  push_enabled  boolean not null default true,
  email_enabled boolean not null default true,
  updated_at    timestamptz not null default now()
);

create table frontrow.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  contact_id uuid not null references frontrow.contacts (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- ── ClickUp sync log ────────────────────────────────────────────────────

create table frontrow.sync_runs (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'ok', 'failed')),
  counts      jsonb not null default '{}'::jsonb,
  error       text,
  started_by  uuid references core.people (id) on delete set null
);
create index sync_runs_started_idx on frontrow.sync_runs (started_at desc);

-- ── updated_at maintenance ──────────────────────────────────────────────

create trigger organizations_touch before update on frontrow.organizations
  for each row execute function frontrow.touch_updated_at();
create trigger branches_touch before update on frontrow.branches
  for each row execute function frontrow.touch_updated_at();
create trigger companies_touch before update on frontrow.companies
  for each row execute function frontrow.touch_updated_at();
create trigger contacts_touch before update on frontrow.contacts
  for each row execute function frontrow.touch_updated_at();
create trigger accounts_touch before update on frontrow.accounts
  for each row execute function frontrow.touch_updated_at();
create trigger updates_touch before update on frontrow.updates
  for each row execute function frontrow.touch_updated_at();
create trigger notification_prefs_touch before update on frontrow.notification_prefs
  for each row execute function frontrow.touch_updated_at();

-- ── Lock-down ───────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'branches', 'companies', 'contacts', 'contact_companies',
    'accounts', 'account_tokens', 'client_sessions', 'access_requests',
    'staff_company_assignments', 'updates', 'files', 'tasks_mirror', 'requests',
    'notification_prefs', 'push_subscriptions', 'sync_runs'
  ] loop
    execute format('alter table frontrow.%I enable row level security', t);
    execute format('revoke all on frontrow.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on frontrow.%I to service_role', t);
  end loop;
end $$;

revoke all on function frontrow.touch_updated_at() from public, anon, authenticated;

-- ── Client list summary ─────────────────────────────────────────────────
-- Counts for Frontrow Manager's client list, done in the database so busy
-- clients aren't cut off at the API's 1,000-row page limit.

create view frontrow.company_overview with (security_invoker = true) as
select c.id as company_id,
       (select count(*) from frontrow.contact_companies cc where cc.company_id = c.id)::int as contacts,
       (select count(*) from frontrow.contact_companies cc
          join frontrow.accounts a on a.contact_id = cc.contact_id
         where cc.company_id = c.id and a.password_hash is not null and a.status = 'active')::int as accounts,
       (select count(*) from frontrow.updates u where u.company_id = c.id and u.status = 'draft')::int as drafts,
       (select max(u.published_at) from frontrow.updates u where u.company_id = c.id and u.status = 'published') as last_published_at
from frontrow.companies c;

revoke all on frontrow.company_overview from public, anon, authenticated;
grant select on frontrow.company_overview to service_role;

-- ── Seed: organizations and branches from the ClickUp Branch fields ─────

insert into frontrow.organizations (slug, name, clickup_label, custom_domain, branding) values
  -- custom_domain stays empty until the domain points at Frontrow; set it in
  -- Frontrow Manager → Organizations, or links would go to a dead address.
  ('jtg', 'Jump Tech Group', 'JTG', null,
   '{"accent":"#2E3192","ink":"#16185A","highlight":"#00AEEF","font":"jtg","logo":"/assets/orgs/jtg/logo.png","logo_on_dark":"/assets/orgs/jtg/logo-light.png","icon":"/assets/orgs/jtg","home_url":"https://j-tgroup.com/","tagline":"One group. Twelve specialist teams."}'),
  ('mco', 'MCO', 'MCO', null,
   '{"accent":"#1F3A5F","ink":"#14243A","highlight":"#C8A14B","font":"default","icon":"/assets/orgs/mco","tagline":"Your MCO team, all in one place."}'),
  ('uny', 'UNY', 'UNY', null,
   '{"accent":"#1F3A5F","ink":"#14243A","highlight":"#4FA3A5","font":"default","icon":"/assets/orgs/uny","tagline":"Your UNY team, all in one place."}'),
  ('mkc', 'MKC', 'MKC SA', null,
   '{"accent":"#0A6DC9","ink":"#161B26","highlight":"#2297F9","font":"default","logo":"/assets/orgs/mkc/logo.png","logo_on_dark":"/assets/orgs/mkc/logo-light.png","icon":"/assets/orgs/mkc","tagline":"Your MKC team, all in one place."}');

insert into frontrow.branches (organization_id, name, clickup_value, logo, tile, sort)
select o.id, b.name, b.clickup_value, b.logo, b.tile, b.sort
from frontrow.organizations o
join (values
  ('jtg', 'Fortune 5 Agency',  'F5',      '/assets/brands/f5.png',    'light', 10),
  ('jtg', 'Build My Start-Up', 'BMS',     '/assets/brands/bms.png',   'light', 20),
  ('jtg', 'Blanket Label',     'BLK',     '/assets/brands/blk.png',   'light', 30),
  ('jtg', 'Bar Boost',         'BB',      '/assets/brands/bb.png',    'light', 40),
  ('jtg', 'Party Designers',   'PD',      '/assets/brands/pd.jpg',    'tint',  50),
  ('jtg', 'Blloom',            'BLM',     '/assets/brands/blm.png',   'light', 60),
  ('jtg', 'Acad Branding',     'ACAD',    '/assets/brands/acad.png',  'dark',  70),
  ('jtg', 'Seeder',            'SD',      '/assets/brands/sd.png',    'light', 80),
  ('jtg', 'BC Agency',         'BC',      '/assets/brands/bc.png',    'dark',  90),
  ('jtg', 'Media BC',          'MBC',     '/assets/brands/mbc.png',   'light', 100),
  ('jtg', 'Jumpwebs',          'JW',      '/assets/brands/jw.png',    'light', 110),
  ('jtg', 'Fortune 5 CEO',     'F5 CEO',  '/assets/brands/f5ceo.png', 'light', 120),
  ('mco', 'BCM',               'BCM',     null, 'light', 10),
  ('mco', 'Anvil',             'Anvil',   null, 'light', 20),
  ('mco', 'MCO Investments',   'MCO INV', null, 'light', 30)
) as b(org, name, clickup_value, logo, tile, sort) on b.org = o.slug;

-- ── Audit log is append-only ────────────────────────────────────────────
-- Frontrow records every staff and client action in core.audit_log under
-- tool = 'frontrow'. Nothing in any MKC app updates or deletes audit rows.

create or replace function core.audit_log_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- One update is allowed: the foreign key's ON DELETE SET NULL, which clears
  -- actor_person_id when a person record is deleted. The person must really
  -- be gone and every other column untouched, so "who did what" can't be
  -- rewritten or wiped.
  if tg_op = 'UPDATE'
     and old.actor_person_id is not null and new.actor_person_id is null
     and not exists (select 1 from core.people p where p.id = old.actor_person_id)
     and (new.id, new.at, new.tool, new.action, new.entity, new.entity_id, new.detail)
         is not distinct from
         (old.id, old.at, old.tool, old.action, old.entity, old.entity_id, old.detail) then
    return new;
  end if;
  raise exception 'core.audit_log is append-only: % is not allowed', tg_op
    using errcode = 'insufficient_privilege';
end $$;

drop trigger if exists audit_log_no_rewrite on core.audit_log;
create trigger audit_log_no_rewrite before update or delete on core.audit_log
  for each row execute function core.audit_log_append_only();
drop trigger if exists audit_log_no_truncate on core.audit_log;
create trigger audit_log_no_truncate before truncate on core.audit_log
  for each statement execute function core.audit_log_append_only();

revoke all on function core.audit_log_append_only() from public, anon, authenticated;
