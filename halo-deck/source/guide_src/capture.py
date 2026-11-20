"""Drive the HaloDeck build in dist/ with headless Chromium and capture the screenshots used by the
getting-started tour (inside index.html) and the illustrated guide (guide.html).

  python3 guide_src/capture.py app    screenshots of the editor, menus, dialogs and panels
  python3 guide_src/capture.py tour   screenshots of the tour itself (needs the tour pictures already built in)

Writes guide_src/shots/<name>.webp and guide_src/shots/shots.json (size + numbered marker positions in %).
build.py runs both phases on every full build, so the pictures always show the version being built."""
import base64, functools, http.server, io, json, os, re, socketserver, sys, threading, mimetypes
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from sample_pages import DASHBOARD, SETTINGS

PHASE = sys.argv[1] if len(sys.argv) > 1 else "app"
DIST = ROOT / "dist"
OUT = HERE / "shots"; OUT.mkdir(exist_ok=True)
PDFJS = ROOT / ".cache/pdfjs/node_modules/pdfjs-dist"
PDF = ROOT / ".cache/testpdfs/letter-report.pdf"
if not PDFJS.exists() or not PDF.exists():
    sys.exit("Run dev_setup.py once first (it fetches the PDF reader and makes sample PDFs).")

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(DIST)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}/index.html"
BUILD_ID = re.search(r'<meta name="halodeck-build" content="(\w+)"', (DIST / "index.html").read_text()).group(1)
def serve_guide(route):
    # the app checks guide.html's build id; answer with this build's so the Help screenshot shows no mismatch warning
    route.fulfill(status=200, body=f'<!DOCTYPE html><meta charset="utf-8"><meta name="halodeck-build" content="{BUILD_ID}">', headers={"Content-Type": "text/html"})
QUIET = "localStorage.setItem('halodeck_seen_version', '999'); localStorage.setItem('halodeck_tip_sticky', '9');"

def serve_pdfjs(route):
    rel = route.request.url.split("pdfjs-dist@4.10.38/", 1)[1].split("?")[0]
    p = PDFJS / rel
    if not p.is_file(): return route.fulfill(status=404, body="nf")
    ct = "text/javascript" if p.suffix in (".mjs", ".js") else (mimetypes.guess_type(str(p))[0] or "application/octet-stream")
    route.fulfill(status=200, body=p.read_bytes(), headers={"Content-Type": ct, "Access-Control-Allow-Origin": "*"})

meta_path = OUT / "shots.json"
SHOTS = json.loads(meta_path.read_text()) if meta_path.exists() else {}

def save(page, name, clip=None, marks=(), max_w=1600):
    png = page.screenshot(clip=clip) if clip else page.screenshot()
    im = Image.open(io.BytesIO(png)).convert("RGB")
    vw = page.viewport_size["width"]; vh = page.viewport_size["height"]
    ox, oy, cw, ch = (clip["x"], clip["y"], clip["width"], clip["height"]) if clip else (0, 0, vw, vh)
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    im.save(OUT / f"{name}.webp", "WEBP", quality=84, method=6)
    SHOTS[name] = {"w": im.width, "h": im.height, "cssw": round(cw), "marks": [
        {"n": n, "x": round((x - ox) / cw * 100, 2), "y": round((y - oy) / ch * 100, 2)} for n, x, y in marks]}
    print(f"  {name}: {im.width}x{im.height}, {os.path.getsize(OUT / f'{name}.webp') // 1024} KB")

def bb(page, sel):
    b = page.locator(sel).first.bounding_box()
    assert b, sel
    return b
def pt(page, sel, ax=0.5, ay=0.5, dx=0, dy=0):
    b = bb(page, sel); return (b["x"] + b["width"] * ax + dx, b["y"] + b["height"] * ay + dy)
def around(page, sels, pad=16, minw=0, minh=0):
    bs = [bb(page, s) for s in sels]
    x0 = min(b["x"] for b in bs) - pad; y0 = min(b["y"] for b in bs) - pad
    x1 = max(b["x"] + b["width"] for b in bs) + pad; y1 = max(b["y"] + b["height"] for b in bs) + pad
    vw = page.viewport_size["width"]; vh = page.viewport_size["height"]
    if x1 - x0 < minw: c = (x0 + x1) / 2; x0, x1 = c - minw / 2, c + minw / 2
    if y1 - y0 < minh: c = (y0 + y1) / 2; y0, y1 = c - minh / 2, c + minh / 2
    x0 = max(0, x0); y0 = max(0, y0); x1 = min(vw, x1); y1 = min(vh, y1)
    return {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}

def photo(w, h, sky, ground, sun):
    """a simple made-up landscape 'photo'"""
    im = Image.new("RGB", (w, h), sky); d = ImageDraw.Draw(im)
    for y in range(h // 2):
        t = y / (h / 2); d.line([(0, y), (w, y)], fill=tuple(int(sky[i] * (1 - t) + 255 * t * 0.9) for i in range(3)))
    d.ellipse([w * 0.66, h * 0.16, w * 0.80, h * 0.16 + w * 0.14], fill=sun)
    d.polygon([(0, h * 0.62), (w * 0.3, h * 0.42), (w * 0.55, h * 0.6), (w * 0.8, h * 0.45), (w, h * 0.58), (w, h), (0, h)], fill=ground)
    d.polygon([(0, h * 0.78), (w * 0.4, h * 0.64), (w, h * 0.8), (w, h), (0, h)], fill=tuple(max(0, c - 40) for c in ground))
    im = im.filter(ImageFilter.GaussianBlur(1.2)); b = io.BytesIO(); im.save(b, "JPEG", quality=88); return b.getvalue()

def sample_deck(browser):
    """the example deck shown in every screenshot: two screens of a made-up app, marked up"""
    def render(html, ids):
        pg = browser.new_page(viewport={"width": 1600, "height": 900})
        pg.set_content(html); pg.wait_for_timeout(150)
        boxes = {i: pg.locator("#" + i).bounding_box() for i in ids}
        png = pg.screenshot(); pg.close(); return png, boxes
    dash, db = render(DASHBOARD, ["dropbar", "badrow", "kpi-orders"])
    sett, sb = render(SETTINGS, ["riskset", "risktog"])
    S = 0.8
    sc = lambda b: {k: v * S for k, v in b.items()}
    bar, row, kpi = sc(db["dropbar"]), sc(db["badrow"]), sc(db["kpi-orders"])
    risk, tog = sc(sb["riskset"]), sc(sb["risktog"])
    data = lambda b: "data:image/png;base64," + base64.b64encode(b).decode()
    base = lambda i: {"id": i, "rot": 0, "opacity": 1, "locked": False, "hidden": False}
    txt = lambda i, x, y, w, t, size=24, color="#1C1B1A", hl="#FFFFFF", hlo=0.94, bold=False: dict(base(i), type="text", x=x, y=y, w=w, h=60, text=t, font="inter",
        size=size, color=color, bold=bold, italic=False, align="left", hl=hl, hlOpacity=hlo, pad=12)
    shape = lambda i, kind, x, y, w, h, stroke="#E5484D", sw=5: dict(base(i), type="shape", shape=kind, x=x, y=y, w=w, h=h, stroke=stroke, strokeW=sw, fill=stroke, fillOpacity=0, radius=10)
    arrow = lambda i, x1, y1, x2, y2, stroke="#E5484D": dict(base(i), type="arrow", x1=x1, y1=y1, x2=x2, y2=y2, stroke=stroke, strokeW=5, head="end")
    image = lambda i, a: dict(base(i), type="image", asset=a, x=0, y=0, w=1280, h=720, alt="", radius=0, borderW=0, borderColor="#F2A93B")
    ecx, ecy = bar["x"] + bar["width"] / 2, bar["y"] + 4
    deck = {"app": "halodeck", "version": 2, "title": "Inventory review — week 42", "page": {"w": 1280, "h": 720},
      "assets": {"a_dash": data(dash), "a_set": data(sett)},
      "slides": [
        {"id": "s1", "bg": "#ffffff", "bgAsset": None, "notes": "Orders fell from 2,140 in week 40 to 1,330 in week 41 — the week the new supplier prices went live. The mug (SKU-2041) also sold out, which accounts for part of the drop.",
         "elements": [image("e_img1", "a_dash"),
           shape("e_ring", "ellipse", ecx - 62, ecy - 58, 124, 112),
           txt("e_note", 830, 520, 380, "Orders fell 38% the week the new prices went live", size=22, bold=True),
           arrow("e_arrow", 822, 556, ecx + 66, ecy + 10),
           shape("e_box", "rect", row["x"] - 6, row["y"] - 3, row["width"] + 12, row["height"] + 6, sw=4)]},
        {"id": "s2", "bg": "#ffffff", "bgAsset": None, "notes": "This switch pushed the new prices live without review. Turn it off before the next supplier file arrives.",
         "elements": [image("e_img2", "a_set"),
           shape("e_box2", "rect", risk["x"] - 10, risk["y"] - 4, risk["width"] + 20, risk["height"] + 8),
           txt("e_note2", 640, 520, 420, "Turn this off before the next price file", size=24, bold=True),
           arrow("e_arrow2", 820, 515, tog["x"] + tog["width"] / 2, tog["y"] + tog["height"] + 10)]},
        {"id": "s3", "bg": "#0E2A47", "bgAsset": None, "notes": "",
         "elements": [txt("e_t3", 96, 110, 900, "Next steps", size=64, color="#FFFFFF", hlo=0, bold=True),
           txt("e_b3", 96, 240, 1000, "1. Restock SKU-2041 by Friday\n2. Switch off automatic price overwrite\n3. Re-check orders at the end of week 43", size=34, color="#EDE7DD", hlo=0)]},
      ]}
    return json.dumps(deck).encode(), kpi

OLD_SITE = "https://jtg-tools.jtgworkspace.com/halo-deck/"   # an address HaloDeck is moving away from (SITE_MOVE in src/updates.js)
def serve_as_old_site(route):
    """answer for the old address from dist/, so the page runs with that address and shows the moving notice"""
    path = route.request.url.split("/halo-deck/", 1)[1].split("?")[0] or "index.html"
    f = DIST / path
    if path == "guide.html": return serve_guide(route)
    if not f.is_file(): return route.fulfill(status=404, body="nf")
    route.fulfill(status=200, body=f.read_bytes(), headers={"Content-Type": mimetypes.guess_type(str(f))[0] or "text/html"})

def open_deck(page, deck_bytes, url=None):
    page.goto(url or URL); page.wait_for_function("document.documentElement.classList.contains('ready')"); page.wait_for_timeout(300)
    page.set_input_files("#fileProject", {"name": "inventory-review.halodeck.json", "mimeType": "application/json", "buffer": deck_bytes})
    page.wait_for_timeout(900)
    page.evaluate("document.getElementById('toast').classList.remove('show')")

def phase_app(browser):
    deck_bytes, kpi = sample_deck(browser)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2, accept_downloads=True)
    ctx.add_init_script(QUIET)
    ctx.route("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/**", serve_pdfjs)
    ctx.route("**/guide.html", serve_guide)
    page = ctx.new_page()
    open_deck(page, deck_bytes)
    sel_layer = lambda key: page.locator(f'.layer[data-key="{key}"] .lname').click()
    def lp(x, y): return page.evaluate("([x,y]) => { const r = document.getElementById('canvasWrap').getBoundingClientRect(); return [r.left + x*HaloDeck.ui.zoom, r.top + y*HaloDeck.ui.zoom]; }", [x, y])

    # the whole workspace, a rectangle selected
    sel_layer("e_box"); page.wait_for_timeout(250)
    save(page, "workspace", marks=[
        (1, *pt(page, "#topbar", 0.30, 0.5)), (2, *pt(page, "#slidesPanel", 0.5, 0.42)), (3, *pt(page, "#canvasWrap", 0.08, 0.1)),
        (4, *pt(page, "#ctxBar", 1.0, 0.5, 14)), (5, *pt(page, "#rightPanel", 0.5, 0.2)), (6, *pt(page, "#zoomBar", 1.0, 0.5, 14))])

    # the top bar, in two halves so it reads at guide size
    tb = bb(page, "#topbar"); split = bb(page, "#titleField")["x"] - 6
    save(page, "topbar_left", clip={"x": 0, "y": tb["y"], "width": split, "height": tb["height"]}, marks=[
        (1, *pt(page, "#btnUndo", 1.0, 1.0, 0, 2)), (2, *pt(page, '[data-tool="select"]', 0.5, 1.0, 0, 2)), (3, *pt(page, '[data-tool="text"]', 0.5, 1.0, 0, 2)),
        (4, *pt(page, '[data-tool="ellipse"]', 0.5, 1.0, 0, 2)), (5, *pt(page, '[data-tool="rect"]', 0.5, 1.0, 0, 2)), (6, *pt(page, '[data-tool="arrow"]', 0.5, 1.0, 0, 2)),
        (7, *pt(page, "#btnImage", 0.5, 1.0, 0, 2)), (8, *pt(page, "#btnPaste", 0.5, 1.0, 0, 2))])
    save(page, "topbar_right", clip={"x": split, "y": tb["y"], "width": tb["width"] - split, "height": tb["height"]}, marks=[
        (9, *pt(page, "#titleField", 0.25, 1.0, 0, 2)), (10, *pt(page, "#saveStatus", 0.5, 1.0, 0, 2)), (11, *pt(page, "#btnHelp", 0.5, 1.0, 0, 2)),
        (12, *pt(page, "#btnOpen", 0.5, 1.0, 0, 2)), (13, *pt(page, "#btnSave", 0.5, 1.0, 0, 2)), (14, *pt(page, "#btnExport", 0.5, 1.0, 0, 2))])

    # a selected shape: handles + floating toolbar
    save(page, "selected", clip=around(page, ["#ctxBar", ".selbox"], pad=34), marks=[
        (1, *pt(page, ".handle.h-se", 0.5, 0.5, 12, 12)), (2, *pt(page, ".handle.rot", 0.5, 0.5, 16, -2)), (3, *pt(page, "#ctxBar", 0.0, 0.5, -14))])

    # drawing a circle on top of the picture, caught mid-drag
    page.keyboard.press("Escape"); page.click('[data-tool="ellipse"]')
    x0, y0 = lp(kpi["x"] - 8, kpi["y"] - 6)
    x1, y1 = lp(kpi["x"] + kpi["width"] + 8, kpi["y"] + kpi["height"] + 6)
    page.mouse.move(x0, y0); page.mouse.down(); page.mouse.move(x1, y1, steps=10)
    cw = bb(page, "#canvasWrap")
    save(page, "drawing", clip={"x": cw["x"] + cw["width"] * 0.3, "y": cw["y"], "width": cw["width"] * 0.7, "height": cw["height"] * 0.55}, marks=[(1, x1 + 12, y1 + 12)])
    page.mouse.up(); page.wait_for_timeout(150)
    sb_ = bb(page, '[data-tool="select"]'); pb_ = bb(page, "#btnPaste")
    save(page, "toolbar_active", clip={"x": sb_["x"] - 10, "y": tb["y"], "width": pb_["x"] + pb_["width"] - sb_["x"] + 20, "height": tb["height"]},
         marks=[(1, *pt(page, '[data-tool="ellipse"]', 0.5, 1.0, 0, 2))])
    page.keyboard.press("Escape"); page.keyboard.press("Control+z"); page.wait_for_timeout(200)

    # typing in a text box
    n = bb(page, '#canvas [data-id="e_note"]')
    page.mouse.click(n["x"] + n["width"] * 0.6, n["y"] + n["height"] * 0.7); page.wait_for_timeout(200)
    page.keyboard.press("End")
    save(page, "editing", clip=around(page, ['#canvas [data-id="e_note"]'], pad=40), marks=[(1, n["x"] + n["width"] + 6, n["y"] + 8)])
    page.keyboard.press("Escape"); page.mouse.click(*lp(1240, 30)); page.wait_for_timeout(150)

    # right-click menus
    r = bb(page, '#canvas [data-id="e_note"]')
    page.mouse.click(r["x"] + 40, r["y"] + 20, button="right"); page.wait_for_timeout(200)
    save(page, "ctxmenu_layer", clip=around(page, ["#ctxMenu", '#canvas [data-id="e_note"]'], pad=18))
    page.keyboard.press("Escape")
    cwb = bb(page, "#canvasWrap"); bx, by = cwb["x"] + 80, cwb["y"] + cwb["height"] + 28      # empty space below the slide
    page.mouse.click(bx, by, button="right"); page.wait_for_timeout(200)
    save(page, "ctxmenu_blank", clip=around(page, ["#ctxMenu"], pad=18, minw=300))
    page.keyboard.press("Escape"); page.mouse.click(*lp(1240, 30))

    # right panel: style (text), layers, slide settings
    sel_layer("e_note"); page.wait_for_timeout(250)
    rp = bb(page, "#rightPanel")
    save(page, "panel_style", clip={"x": rp["x"], "y": rp["y"], "width": rp["width"], "height": min(rp["height"], 780)}, marks=[
        (1, *pt(page, '#props textarea[data-k="text"]', 1.0, 0.0, -10, -10)), (2, *pt(page, '#props select[data-k="font"]', 1.0, 0.5, -30)),
        (3, *pt(page, '#props [data-toggle="bold"]', 0.0, 0.5, -6)), (4, *pt(page, '#props input[type="range"][data-k="hlOpacity"]', 0.9, 0.5))])
    page.mouse.click(*lp(1240, 30)); page.wait_for_timeout(150)
    page.evaluate("document.getElementById('secLayers').scrollIntoView({block:'start'})"); page.wait_for_timeout(100)
    save(page, "panel_layers", clip=around(page, ["#secLayers"], pad=0), marks=[
        (1, *pt(page, ".layer .grip", 0.5, 0.5)), (2, *pt(page, '.layer [data-act="edit"]', 0.5, 0.5)), (3, *pt(page, '.layer [data-act="vis"]', 0.5, 0.5)),
        (4, *pt(page, '.layer [data-act="lock"]', 0.5, 0.5)), (5, *pt(page, '.layer [data-act="del"]', 0.5, 0.5))])
    page.evaluate("document.getElementById('secSlide').scrollIntoView({block:'start'})"); page.wait_for_timeout(100)
    save(page, "panel_slide", clip=around(page, ["#secSlide"], pad=0), marks=[
        (1, *pt(page, "#pageSize", 0.95, 0.5, -16)), (2, *pt(page, "#bgColors", 1.0, 0.5, -8)), (3, *pt(page, "#btnBgImage", 0.95, 0.5, -10)),
        (4, *pt(page, "#slideNotes", 0.95, 0.25)), (5, *pt(page, "#btnNotesToLayer", 0.97, 0.5, -10))])
    page.evaluate("document.getElementById('rightPanel').scrollTop = 0")

    # slides panel with the hover actions (a shorter window so the panel isn't mostly empty)
    page.set_viewport_size({"width": 1440, "height": 560}); page.wait_for_timeout(300)
    page.hover(".thumb >> nth=1"); page.wait_for_timeout(200)
    sp = bb(page, "#slidesPanel")
    save(page, "panel_slides", clip={"x": sp["x"], "y": sp["y"], "width": sp["width"], "height": sp["height"]}, marks=[
        (1, *pt(page, ".thumb >> nth=0", 0.9, 0.12)), (2, *pt(page, '.thumb >> nth=1 >> [data-act="dup"]', 0.5, 0.5, 0, -18)),
        (3, *pt(page, "#btnAddSlide", 0.5, 0.5)), (4, *pt(page, "#btnSlidesFromImages", 0.5, 0.5))])
    page.set_viewport_size({"width": 1440, "height": 900}); page.wait_for_timeout(300)

    # Open menu, PDF dialog, photos dialog
    page.click("#btnOpen"); page.wait_for_timeout(200)
    save(page, "menu_open", clip=around(page, ["#menuOpen", "#btnOpen"], pad=14))
    page.keyboard.press("Escape")
    page.set_input_files("#filePdf", str(PDF))
    page.wait_for_function("document.querySelectorAll('#imStrip canvas').length === 3", timeout=60000); page.wait_for_timeout(300)
    save(page, "dialog_pdf", clip=around(page, [".import-modal"], pad=0), marks=[
        (1, *pt(page, "#imPagesMode", 1.0, 0.5, 14)), (2, *pt(page, "#imSize", 1.0, 0.25, -24)), (3, *pt(page, "#imWhere", 1.0, 0.5, 14)), (4, *pt(page, "#imText", 0.5, 0.5, -16))])
    page.click("#imCancel")
    photos = [{"name": f"site-visit-{i}.jpg", "mimeType": "image/jpeg", "buffer": photo(1600, 1200, s, g, (255, 214, 120))}
              for i, (s, g) in enumerate([((90, 150, 220), (70, 130, 80)), ((240, 150, 90), (120, 90, 60)), ((120, 170, 210), (60, 110, 130)), ((180, 160, 220), (90, 120, 70))], 1)]
    page.set_input_files("#fileSlides", photos)
    page.wait_for_selector("#imOpts:not([hidden])", timeout=30000); page.wait_for_timeout(300)
    save(page, "dialog_photos", clip=around(page, [".import-modal"], pad=0), marks=[
        (1, *pt(page, "#imSize", 1.0, 0.25, -24)), (2, *pt(page, "#imFit", 1.0, 0.5, 14)), (3, *pt(page, "#imOrder", 1.0, 0.5, 14))])
    page.click("#imCancel")

    # the paste box
    page.evaluate("() => { navigator.clipboard.read = () => Promise.reject(new DOMException('blocked', 'NotAllowedError')); }")
    page.click("#btnPaste"); page.wait_for_timeout(250)
    save(page, "dialog_paste", clip=around(page, [".paste-modal"], pad=0))
    page.keyboard.press("Escape")

    # Export menu + dialog with a custom selection
    page.click("#btnExport"); page.wait_for_timeout(200)
    save(page, "menu_export", clip=around(page, ["#menuExport", "#btnExport"], pad=14))
    page.click('#menuExport [data-format="pdf"]'); page.wait_for_timeout(300)
    page.fill("#exRange", "1-2"); page.locator("#exRange").blur(); page.wait_for_timeout(200)
    save(page, "dialog_export", clip=around(page, ["#exportModal .modal"], pad=0), marks=[
        (1, *pt(page, ".ex-formats", 1.0, 0.12, -18)), (2, *pt(page, "#exOptsPdf", 1.0, 0.5, -16)), (3, *pt(page, "#exAll", 0.0, 0.5, -16)),
        (4, *pt(page, "#exRange", 0.82, 0.5)), (5, *pt(page, ".ex-card >> nth=2", 0.5, 0.5)), (6, *pt(page, "#exGo", 0.0, 0.5, -14))])
    page.click('.ex-format[data-format="html"]'); page.click("#exAll")
    with page.expect_download() as dl:
        page.click("#exGo")
    html_path = str(OUT / "_exported.html"); dl.value.save_as(html_path)

    # in-app help
    page.click("#btnHelp"); page.wait_for_timeout(300)
    save(page, "help_panel", clip=around(page, [".help-modal"], pad=0))
    page.locator("#helpRole").scroll_into_view_if_needed(); page.wait_for_timeout(250)
    save(page, "help_role", clip=around(page, ["#helpRole"], pad=14))
    page.keyboard.press("Escape")

    # the change log, an admin page (Help → Change log)
    page.evaluate("HaloDeck.updates.log()"); page.wait_for_timeout(400); page.evaluate("document.activeElement.blur()")
    save(page, "changelog", clip=around(page, ["#logModal .modal"], pad=0), marks=[
        (1, *pt(page, "#logFor", 0.5, 1.0, 0, 8)), (2, *pt(page, "#logOrder", 0.5, 1.0, 0, 8)), (3, *pt(page, "#logJson", 0.5, 1.0, 0, 8)),
        (4, *pt(page, ".tl-v.now .tl-here", 0.0, 0.5, -18))])
    page.keyboard.press("Escape")

    # the exported HTML deck on its own
    v = ctx.new_page(); v.set_viewport_size({"width": 1280, "height": 1000})
    v.goto("file://" + html_path); v.wait_for_timeout(500)
    save(v, "viewer", marks=[(1, *pt(v, "#prev")), (2, *pt(v, "#all")), (3, *pt(v, "#fs")), (4, *pt(v, ".slide-wrap.active .notes", 0.04, 0.2))], max_w=1400)
    v.close(); ctx.close()

    # phone
    mctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
    mctx.add_init_script(QUIET)
    m = mctx.new_page(); open_deck(m, deck_bytes)
    save(m, "phone_editor", max_w=780, marks=[(1, *pt(m, "#btnSlidesPanel")), (2, *pt(m, "#btnMore")), (3, *pt(m, "#dock", 0.5, 0.0, 0, -4))])
    n = bb(m, '#canvas [data-id="e_note"]'); m.touchscreen.tap(n["x"] + 20, n["y"] + 12); m.wait_for_timeout(250)
    m.tap('#ctxBar [data-act="style"]'); m.wait_for_timeout(450)
    save(m, "phone_sheet", max_w=780, marks=[(1, *pt(m, ".sheet-tabs"))])
    m.tap('#rightPanel [data-close]'); m.wait_for_timeout(350)
    cdp = mctx.new_cdp_session(m)
    hx, hy = m.evaluate("(() => { const r = document.getElementById('canvasWrap').getBoundingClientRect(); return [r.left + r.width * 0.9, r.top + r.height * 0.94]; })()")
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": hx, "y": hy, "id": 1}]})
    m.wait_for_timeout(750); cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); m.wait_for_timeout(200)
    save(m, "phone_hold", max_w=780)
    mctx.close()

    # the notice people see at an address HaloDeck is moving away from
    octx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
    octx.add_init_script(QUIET)
    octx.route("https://jtg-tools.jtgworkspace.com/**", serve_as_old_site)
    o = octx.new_page(); open_deck(o, deck_bytes, OLD_SITE)
    o.wait_for_timeout(600); o.reload(); o.wait_for_function("document.documentElement.classList.contains('ready')")
    o.wait_for_selector("#moveBanner:not([hidden])", timeout=5000); o.wait_for_timeout(300)
    b = bb(o, "#moveBanner")
    save(o, "move_banner", clip={"x": b["x"] - 60, "y": 0, "width": b["width"] + 120, "height": b["y"] + b["height"] + 56}, marks=[
        (1, *pt(o, "#moveSave", 0.5, 1.0, 0, 18)), (2, *pt(o, "#moveGo", 0.5, 1.0, 0, 18))])
    octx.close()

def phase_tour(browser):
    """the tour itself, for the guide (it can only be photographed once its own pictures are built in)"""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
    ctx.route("**/guide.html", serve_guide)
    page = ctx.new_page()                                   # a first visit: the welcome opens by itself
    page.goto(URL); page.wait_for_function("document.documentElement.classList.contains('ready')")
    page.wait_for_selector("#tourModal:not([hidden])", timeout=10000); page.wait_for_timeout(400)
    save(page, "tour_welcome", clip=around(page, ["#tourModal .tour"], pad=0))
    page.click('[data-track="users"]'); page.wait_for_timeout(250)
    for _ in range(2): page.click("#tourNext")              # the PDF step: a screenshot with markers, and Show me → Open
    page.wait_for_timeout(350)
    save(page, "tour_step", clip=around(page, ["#tourModal .tour"], pad=0), marks=[
        # letters, so they aren't mixed up with the tour's own numbered markers inside the picture
        ("A", *pt(page, "#tourCount", 1.0, 0.5, 30)), ("B", *pt(page, "#tourVisual", 0.0, 0.0, 2, 2)), ("C", *pt(page, "#tourShow", 1.0, 0.5, 18)), ("D", *pt(page, "#tourDots", 1.0, 0.5, 30))])
    page.click("#tourShow"); page.wait_for_timeout(450)
    save(page, "tour_showme", clip=around(page, ["#spotlight .spot-ring", "#spotlight .spot-tip"], pad=40, minw=760))
    page.keyboard.press("Escape"); page.wait_for_timeout(250)
    page.click("#tourClose"); page.wait_for_timeout(200)
    # someone who makes decks, back after two updates
    page.evaluate("localStorage.setItem('halodeck_seen_version', '1.6'); localStorage.setItem('halodeck_role', 'user')")
    page.reload(); page.wait_for_selector("#newsModal:not([hidden])", timeout=10000); page.wait_for_timeout(600); page.evaluate("document.activeElement.blur()")
    save(page, "tour_whatsnew", clip=around(page, ["#newsModal .modal"], pad=0), marks=[
        (1, *pt(page, ".ncard .ncard-tags", 0.0, 0.5, -16)), (2, *pt(page, ".ncard .linkbtn", 1.0, 0.5, 18)),
        (3, *pt(page, "#newsRole .linkbtn", 1.0, 0.5, 18)), (4, *pt(page, "#newsOk", 0.5, 0.0, 0, -16))])
    page.click("#newsOk")
    page.evaluate("HaloDeck.tour.open('admins', 2)"); page.wait_for_timeout(350)
    save(page, "tour_admin", clip=around(page, ["#tourModal .tour"], pad=0))
    ctx.close()

with sync_playwright() as p:
    browser = p.chromium.launch()
    (phase_tour if PHASE == "tour" else phase_app)(browser)
    browser.close()
meta_path.write_text(json.dumps(SHOTS, indent=1))
print("captured", PHASE)
