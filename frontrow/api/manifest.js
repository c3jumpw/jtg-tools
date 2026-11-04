import { route } from '../lib/core.js';
import { orgBySlug, safeBranding } from '../lib/directory.js';

/* GET ?org=<slug> — the web app manifest, so "Add to Home Screen" / "Install
 * app" gives each organization its own name, icon and colour. */

export default route(async (request) => {
  const slug = new URL(request.url).searchParams.get('org');
  const org = slug ? await orgBySlug(slug) : null;
  const b = org ? safeBranding(org.branding || {}) : {};
  const icon = /^\/assets\/[a-z0-9/_-]+$/i.test(b.icon || '') ? b.icon : '/assets/brand';
  const start = org ? (org.custom_domain ? '/' : `/${org.slug}`) : '/signin';
  const manifest = {
    id: start,
    name: org ? `${org.name} Client Portal` : 'Frontrow',
    short_name: org ? (org.name.length <= 12 ? org.name : org.slug.toUpperCase()) : 'Frontrow',
    description: org ? `Updates, tasks and guides from your ${org.name} team.` : 'Your client portal.',
    start_url: start,
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: b.ink || '#15161D',
    icons: [
      { src: `${icon}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${icon}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      ...(icon === '/assets/brand' ? [{ src: '/assets/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] : [])
    ]
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=300' }
  });
});
