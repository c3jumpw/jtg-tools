"""Renders ContentFlow's favicon / home-screen icon set from the in-app logo.

The geometry below is brandMarkSvg()'s own path (index.html): keep the two in
sync, so the tab icon and the in-app mark can never drift apart.
Run from content-strategy-workflow/:  python3 icon-src/gen.py
"""
from PIL import Image, ImageDraw

AMBER = (232, 162, 61, 255)   # --accent  #E8A23D  (the in-app brand-mark background)
INK   = (33, 22, 10, 255)     # #21160A   (the trend-line stroke, same as the app's SVG)

# The app's mark, in its own 24x24 viewBox coords (see brandMarkSvg()):
#   path M4 13 L10 7 L14 11 L20 5, stroke-width 2.4, round caps + joins
PTS = [(4, 13), (10, 7), (14, 11), (20, 5)]
SW = 2.4
# Visual bounds include half the stroke on every side, so the mark is optically
# centered rather than centered on the bare path (whose own bbox sits high in
# the viewBox -- center y=9, not 12).
BX0, BY0, BX1, BY1 = 4 - SW/2, 5 - SW/2, 20 + SW/2, 13 + SW/2
BW, BH = BX1 - BX0, BY1 - BY0
CX, CY = (BX0 + BX1) / 2, (BY0 + BY1) / 2

SS = 8  # supersample, then downscale -- gives clean antialiased round joins


def render(size, rounded=True, mark_frac=0.62, bleed=False, sw=SW):
    N = size * SS
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if bleed:
        # apple-touch-icon: full-bleed, opaque. iOS applies its OWN rounded
        # mask and dislikes transparency, so no corners/alpha of our own.
        d.rectangle([0, 0, N, N], fill=AMBER)
    elif rounded:
        # Matches .brand-mark's 6px radius on a 22px box (~27%).
        d.rounded_rectangle([0, 0, N - 1, N - 1], radius=int(N * 0.27), fill=AMBER)
    else:
        d.rectangle([0, 0, N, N], fill=AMBER)

    scale = (mark_frac * N) / BW
    ox, oy = N / 2 - CX * scale, N / 2 - CY * scale
    pts = [(x * scale + ox, y * scale + oy) for x, y in PTS]
    w = max(1, int(round(sw * scale)))

    d.line(pts, fill=INK, width=w, joint='curve')      # round joins
    for (x, y) in (pts[0], pts[-1]):                    # round caps
        d.ellipse([x - w/2, y - w/2, x + w/2, y + w/2], fill=INK)
    return img.resize((size, size), Image.LANCZOS)


# Small sizes are optically corrected, not naively scaled: at 16px the native
# 2.4-unit stroke lands at ~1.3px and blurs into grey, so they get a larger
# mark and a heavier stroke.
TUNE = {16: (0.70, 3.5), 32: (0.66, 2.9), 48: (0.64, 2.6)}

if __name__ == '__main__':
    for s in (16, 32, 48, 192, 512):
        mf, sw = TUNE.get(s, (0.62, SW))
        render(s, mark_frac=mf, sw=sw).save(f'favicon-{s}.png' if s < 100 else f'icon-{s}.png')
    render(48, mark_frac=0.64, sw=2.6).save('favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
    render(180, bleed=True, mark_frac=0.56).convert('RGB').save('apple-touch-icon.png')
    render(512, bleed=True, mark_frac=0.52).convert('RGB').save('icon-512-maskable.png')
