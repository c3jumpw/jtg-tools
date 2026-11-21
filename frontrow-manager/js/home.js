/* GitHub Pages also serves this folder, at jtg-tools.mkcworkspace.com/frontrow-manager/,
 * but the Manager's sign-in and data live on Vercel. Send anyone who lands
 * there to the real address. */
(function () {
  var h = location.hostname;
  if (/^jtg-tools\./.test(h) || /\.github\.io$/.test(h)) {
    location.replace('https://frontrow-manager.mkcworkspace.com/' + location.hash);
  }
})();
