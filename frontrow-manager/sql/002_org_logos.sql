-- Frontrow: MCO and UNY logos (Nov 4, 2026). Data only.
-- Logos live in the frontrow app at /assets/orgs/<slug>/; colours are taken
-- from each logo. Applied to MKC-Admin (symbmscaajjmgywbifhv) on Nov 4, 2026.

update frontrow.organizations
set branding = branding || jsonb_build_object(
  'logo', '/assets/orgs/uny/logo.png',
  'logo_on_dark', '/assets/orgs/uny/logo-light.png',
  'accent', '#214F78',
  'ink', '#173A59',
  'highlight', '#00C8F5'
)
where slug = 'uny';

update frontrow.organizations
set branding = branding || jsonb_build_object(
  'logo', '/assets/orgs/mco/logo.png',
  'logo_on_dark', '/assets/orgs/mco/logo-light.png',
  'accent', '#1F1F1F',
  'ink', '#111111',
  'highlight', '#A8A39A'
)
where slug = 'mco';
