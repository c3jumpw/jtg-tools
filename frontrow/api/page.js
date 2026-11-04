import { route } from '../lib/core.js';
import { orgBySlug, orgByHost, branchesFor, publicOrg } from '../lib/directory.js';
import { landingPage, appShell, notFoundPage } from '../lib/pages.js';

/* Serves every HTML page (vercel.json rewrites them here):
 *   /            landing page — or, on an organization's own domain, its portal
 *   /signin      neutral sign-in
 *   /<slug>      an organization's portal
 */

const HTML = { 'Content-Type': 'text/html; charset=utf-8' };

export default route(async (request) => {
  const url = new URL(request.url);
  const site = (process.env.FRONTROW_URL || `${url.protocol}//${url.host}`).replace(/\/$/, '');
  const slug = url.searchParams.get('org');
  const view = url.searchParams.get('view');

  if (view === 'signin') {
    return new Response(appShell({ org: null, siteUrl: site }), { headers: { ...HTML, 'Cache-Control': 'public, max-age=0, s-maxage=300' } });
  }

  const org = slug ? await orgBySlug(slug) : await orgByHost(request.headers.get('x-forwarded-host') || request.headers.get('host'));
  if (org) {
    const shell = appShell({ org: publicOrg(org, await branchesFor(org.id)), siteUrl: site });
    return new Response(shell, { headers: { ...HTML, 'Cache-Control': 'public, max-age=0, s-maxage=60' } });
  }
  if (slug) return new Response(notFoundPage(), { status: 404, headers: { ...HTML, 'Cache-Control': 'no-store' } });
  return new Response(landingPage(), { headers: { ...HTML, 'Cache-Control': 'public, max-age=0, s-maxage=600' } });
});
