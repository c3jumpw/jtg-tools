import io, json, os, re, sys, threading, zipfile, functools, http.server, socketserver, time, math, subprocess
from playwright.sync_api import sync_playwright

DIST = os.path.join(os.path.dirname(__file__), "dist")
ROOT = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(ROOT, ".cache", "test-shots")
os.makedirs(SHOTS, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=DIST))
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORT}/index.html"

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + ((" — " + str(detail)) if detail and not cond else ""))

MK_IMG = """async ([w,h,color,name]) => {
  const c = document.createElement('canvas'); c.width=w; c.height=h; const x=c.getContext('2d');
  x.fillStyle=color; x.fillRect(0,0,w,h); x.fillStyle='#fff'; x.font='bold 48px sans-serif'; x.fillText(name, 30, 80);
  const b = await new Promise(r=>c.toBlob(r,'image/png')); return new File([b], name+'.png', {type:'image/png'});
}"""

def els(page):
    return page.evaluate("HaloDeck.doc.slides[HaloDeck.ui.cur].elements.map(e=>({...e}))")

def wait_ready(page):
    page.wait_for_function("document.documentElement.classList.contains('ready')")
    page.wait_for_timeout(250)

def page_point(page, lx, ly):
    """logical page coords -> client coords"""
    return page.evaluate("([x,y]) => { const r = document.getElementById('canvasWrap').getBoundingClientRect(); return [r.left + x*HaloDeck.ui.zoom, r.top + y*HaloDeck.ui.zoom]; }", [lx, ly])

def ring_pt(page, s, ang=math.pi / 4):
    """a point on a hollow ellipse's outline (away from the resize handles)"""
    a = s["w"] / 2 - s["strokeW"] / 2; b = s["h"] / 2 - s["strokeW"] / 2
    return page_point(page, s["x"] + s["w"] / 2 + a * math.cos(ang), s["y"] + s["h"] / 2 + b * math.sin(ang))

PDFJS_DIR = os.path.join(ROOT, ".cache/pdfjs/node_modules/pdfjs-dist/")   # made by dev_setup.py (the app fetches it from a CDN)
TESTPDFS = os.path.join(ROOT, ".cache/testpdfs/")
def serve_pdfjs(route):
    import mimetypes
    rel = route.request.url.split("pdfjs-dist@4.10.38/", 1)[1].split("?")[0]
    path = os.path.join(PDFJS_DIR, rel)
    if not os.path.isfile(path):
        return route.fulfill(status=404, body="not found")
    ct = "text/javascript" if path.endswith((".mjs", ".js")) else (mimetypes.guess_type(path)[0] or "application/octet-stream")
    route.fulfill(status=200, body=open(path, "rb").read(), headers={"Content-Type": ct, "Access-Control-Allow-Origin": "*"})

def png_bytes(w, h, color, label):
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (w, h), color); d = ImageDraw.Draw(im); d.text((20, 20), label, fill="white")
    b = io.BytesIO(); im.save(b, "PNG"); return b.getvalue()

def drag(page, x0, y0, x1, y1, steps=8):
    page.mouse.move(x0, y0); page.mouse.down(); page.mouse.move(x1, y1, steps=steps); page.mouse.up()

with sync_playwright() as p:
    browser = p.chromium.launch()
    # The getting-started tour opens by itself on a first visit. Every context is a "returning user" unless
    # it's made with fresh=True, so the tour doesn't sit on top of the other tests.
    _new_context = browser.new_context
    def new_context(fresh=False, **kw):
        c = _new_context(**kw)
        if not fresh:
            c.add_init_script("try{ if(localStorage.getItem('halodeck_seen_version') === null) localStorage.setItem('halodeck_seen_version', '999'); }catch(e){}")
        return c
    browser.new_context = new_context

    # ------------------------------------------------------------ desktop
    ctx = browser.new_context(viewport={"width":1440, "height":900}, accept_downloads=True, timezone_id="America/New_York")
    ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=f"http://127.0.0.1:{PORT}")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "ERR_TUNNEL" not in m.text and "fonts.g" not in m.text else None)
    page.goto(URL); wait_ready(page)
    page.screenshot(path=f"{SHOTS}/d1_empty.png")

    geo = page.evaluate("""() => { const s=document.getElementById('stage').getBoundingClientRect(), w=document.getElementById('canvasWrap').getBoundingClientRect();
      return {s:[s.left,s.top,s.right,s.bottom], w:[w.left,w.top,w.right,w.bottom], sw:document.getElementById('stage').scrollWidth, cw:document.getElementById('stage').clientWidth,
              docW:document.documentElement.scrollWidth, vw:innerWidth, ratio:w.width/w.height}; }""")
    check("desktop: slide fits inside the stage", geo["w"][0] >= geo["s"][0] and geo["w"][2] <= geo["s"][2] and geo["w"][3] <= geo["s"][3], geo)
    check("desktop: no stray horizontal scrolling", geo["sw"] <= geo["cw"] + 1 and geo["docW"] <= geo["vw"], geo)
    check("desktop: canvas is 16:9", abs(geo["ratio"] - 16/9) < 0.01, geo["ratio"])

    # --- text: create, type, click away
    page.click('[data-tool="text"]')
    x, y = page_point(page, 200, 150)
    page.mouse.click(x, y)
    page.keyboard.type("Hello world")
    x2, y2 = page_point(page, 1100, 650)
    page.mouse.click(x2, y2)
    e = els(page)
    check("text: typed into a new text box", len(e) == 1 and e[0]["text"] == "Hello world", e)
    check("text: editing ended after clicking away", page.evaluate("HaloDeck.ui.editing") is None)

    # --- text: single click goes straight into editing, caret where clicked
    t = e[0]
    tx, ty = page_point(page, t["x"] + t["w"] - 30, t["y"] + 30)
    page.mouse.click(*page_point(page, t["x"] + t["pad"] + 2, t["y"] + t["pad"] + 20))
    check("text: one click enters edit mode", page.evaluate("HaloDeck.ui.editing") == t["id"])
    check("text: the text box has keyboard focus", page.evaluate("document.activeElement && document.activeElement.dataset.id") == t["id"])
    page.keyboard.type(">> ")
    page.keyboard.press("Escape")
    txt = els(page)[0]["text"]
    check("text: caret was placed at the click (start of text)", txt.startswith(">> Hello"), txt)
    page.keyboard.press("Control+z")
    check("undo restores text", els(page)[0]["text"] == "Hello world", els(page)[0]["text"])

    # --- text: dragging moves instead of editing
    t = els(page)[0]
    cx, cy = page_point(page, t["x"] + 60, t["y"] + 25)
    page.mouse.move(cx, cy); page.mouse.down(); page.mouse.move(cx + 80, cy + 40, steps=6); page.mouse.up()
    t2 = els(page)[0]
    z = page.evaluate("HaloDeck.ui.zoom")
    check("text: drag moves it (not edit)", abs((t2["x"] - t["x"]) - 80 / z) < 2 and page.evaluate("HaloDeck.ui.editing") is None, (t["x"], t2["x"]))

    # --- ellipse draw / move / resize
    page.click('[data-tool="ellipse"]')
    sx, sy = page_point(page, 600, 300)
    page.mouse.move(sx, sy); page.mouse.down(); page.mouse.move(sx + 150, sy + 100, steps=8); page.mouse.up()
    sh = [x for x in els(page) if x["type"] == "shape"]
    check("ellipse: drawn by dragging", len(sh) == 1 and abs(sh[0]["w"] - 150 / z) < 2 and abs(sh[0]["h"] - 100 / z) < 2, sh)
    check("ellipse: the tool stays on after drawing", page.evaluate("HaloDeck.ui.tool") == "ellipse")
    page.keyboard.press("Escape")
    check("Esc goes back to the Select tool (shape stays selected)", page.evaluate("[HaloDeck.ui.tool, HaloDeck.ui.sel]") == ["select", sh[0]["id"]])
    s0 = sh[0]
    mx, my = ring_pt(page, s0)
    page.mouse.move(mx, my); page.mouse.down(); page.mouse.move(mx + 50, my + 30, steps=5); page.mouse.up()
    s1 = [x for x in els(page) if x["type"] == "shape"][0]
    check("ellipse: moved by dragging its outline", abs(s1["x"] - s0["x"] - 50 / z) < 2 and abs(s1["y"] - s0["y"] - 30 / z) < 2, (s0, s1))
    hb = page.locator(".handle.h-se").bounding_box()
    page.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2); page.mouse.down()
    page.mouse.move(hb["x"] + 60, hb["y"] + 40, steps=5); page.mouse.up()
    s2 = [x for x in els(page) if x["type"] == "shape"][0]
    check("ellipse: resized with corner handle", s2["w"] > s1["w"] + 30 and abs(s2["x"] - s1["x"]) < 0.5, (s1["w"], s2["w"]))
    check("ctx toolbar shows for selection", page.locator("#ctxBar").is_visible())

    # --- arrow (tap-to-place)
    page.click('[data-tool="arrow"]')
    ax, ay = page_point(page, 900, 200)
    page.mouse.click(ax, ay)
    arr = [x for x in els(page) if x["type"] == "arrow"]
    check("arrow: tap drops an arrow pointing at the spot", len(arr) == 1 and abs(arr[0]["x2"] - 900) < 2 and abs(arr[0]["y2"] - 200) < 2, arr)
    page.keyboard.press("v")

    # --- paste an image from the clipboard (Ctrl/Cmd+V path)
    before = len(els(page))
    page.evaluate("async (mk) => { const f = await (eval(mk))([800,500,'#3e8ef7','pasted']); const dt = new DataTransfer(); dt.items.add(f); document.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles:true, cancelable:true})); }", MK_IMG)
    page.wait_for_timeout(600)
    imgs = [x for x in els(page) if x["type"] == "image"]
    check("paste: image from clipboard becomes a layer", len(els(page)) == before + 1 and len(imgs) == 1, len(imgs))

    # --- Paste button (async clipboard API, as on mobile)
    page.evaluate("async (mk) => { const f = await (eval(mk))([300,300,'#30a46c','btnpaste']); await navigator.clipboard.write([new ClipboardItem({'image/png': f})]); }", MK_IMG)
    page.click("#btnPaste"); page.wait_for_timeout(700)
    check("paste button: reads an image from the clipboard", len([x for x in els(page) if x["type"] == "image"]) == 2)

    # --- copy / paste an element
    page.evaluate("HaloDeck.ui.sel = HaloDeck.doc.slides[0].elements.find(e=>e.type==='shape').id")
    n0 = len(els(page))
    page.evaluate("""() => { const dt = new DataTransfer();
      document.dispatchEvent(new ClipboardEvent('copy', {clipboardData: dt, bubbles:true, cancelable:true}));
      document.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles:true, cancelable:true})); }""")
    page.wait_for_timeout(200)
    e_all = els(page)
    shapes = [x for x in e_all if x["type"] == "shape"]
    check("copy/paste: element duplicated with offset", len(e_all) == n0 + 1 and len(shapes) == 2 and shapes[1]["x"] != shapes[0]["x"], len(e_all))

    # --- drop 3 files from the OS onto the slide
    n0 = len(els(page))
    dx, dy = page_point(page, 640, 360)
    page.evaluate("""async ([mk, x, y]) => { const m = eval(mk); const dt = new DataTransfer();
      for (const [c,n] of [['#e5484d','one'],['#8e4ec6','two'],['#f2a93b','three']]) dt.items.add(await m([640,400,c,n]));
      document.elementFromPoint(x,y).dispatchEvent(new DragEvent('dragover', {dataTransfer:dt, clientX:x, clientY:y, bubbles:true, cancelable:true}));
      document.elementFromPoint(x,y).dispatchEvent(new DragEvent('drop', {dataTransfer:dt, clientX:x, clientY:y, bubbles:true, cancelable:true})); }""", [MK_IMG, dx, dy])
    page.wait_for_timeout(900)
    check("drop: 3 files -> 3 separate image layers", len(els(page)) == n0 + 3, len(els(page)) - n0)
    page.screenshot(path=f"{SHOTS}/d2_annotated.png")

    # --- drop 2 files onto the slides panel -> 2 new slides
    ns0 = page.evaluate("HaloDeck.doc.slides.length")
    bb = page.locator("#slideList").bounding_box()
    page.evaluate("""async ([mk, x, y]) => { const m = eval(mk); const dt = new DataTransfer();
      dt.items.add(await m([1200,900,'#0e2a47','slideA'])); dt.items.add(await m([900,1200,'#30a46c','slideB']));
      document.elementFromPoint(x,y).dispatchEvent(new DragEvent('drop', {dataTransfer:dt, clientX:x, clientY:y, bubbles:true, cancelable:true})); }""",
      [MK_IMG, bb["x"] + bb["width"] / 2, bb["y"] + 200])
    page.wait_for_timeout(900)
    check("drop on slide list: one new slide per image", page.evaluate("HaloDeck.doc.slides.length") == ns0 + 2)
    # add notes to slide 2
    page.evaluate("HaloDeck.doc.slides[1].notes = 'Point out the ridge on the left.'")
    page.click(".thumb >> nth=0")
    check("slide nav: back on slide 1", page.evaluate("HaloDeck.ui.cur") == 0)
    page.evaluate("HaloDeck.doc.slides[0].notes = 'Slide one commentary.'")

    # --- slide reorder by dragging a thumbnail
    order0 = page.evaluate("HaloDeck.doc.slides.map(s=>s.id)")
    t1 = page.locator(".thumb >> nth=1").bounding_box(); t3 = page.locator(".thumb >> nth=2").bounding_box()
    page.mouse.move(t1["x"] + 40, t1["y"] + 20); page.mouse.down()
    page.mouse.move(t1["x"] + 40, t3["y"] + t3["height"] - 5, steps=10); page.mouse.up()
    order1 = page.evaluate("HaloDeck.doc.slides.map(s=>s.id)")
    check("slides: drag to reorder", order1[0] == order0[0] and order1[1] == order0[2] and order1[2] == order0[1], (order0, order1))

    # --- layers reorder by dragging
    page.click(".thumb >> nth=0")
    l0 = page.evaluate("HaloDeck.doc.slides[0].elements.map(e=>e.id)")
    r0 = page.locator(".layer >> nth=0").bounding_box(); r2 = page.locator(".layer >> nth=2").bounding_box()
    page.mouse.move(r0["x"] + 70, r0["y"] + r0["height"] / 2); page.mouse.down()
    page.mouse.move(r0["x"] + 70, r2["y"] + r2["height"] - 3, steps=8); page.mouse.up()
    l1 = page.evaluate("HaloDeck.doc.slides[0].elements.map(e=>e.id)")
    check("layers: drag to reorder", l1 != l0 and sorted(l1) == sorted(l0) and l1[-1] == l0[-2], (l0[-3:], l1[-3:]))

    # --- export modal: HTML of selected slides
    page.click("#btnExport")
    check("export: menu offers HTML, PNG and PDF", page.locator("#menuExport").is_visible() and
          page.eval_on_selector_all("#menuExport [data-format]", "b => b.map(x => x.dataset.format)") == ["html", "png", "pdf"])
    page.screenshot(path=f"{SHOTS}/d3a_export_menu.png")
    page.click('#menuExport [data-format="html"]')
    check("export: modal opens with all slides selected", page.locator(".ex-card.on").count() == page.evaluate("HaloDeck.doc.slides.length"))
    page.screenshot(path=f"{SHOTS}/d3_export_modal.png")
    page.click(".ex-card >> nth=2")
    check("export: deselecting a slide updates the count", "2 of 3" in page.inner_text("#exPickCount"), page.inner_text("#exPickCount"))
    with page.expect_download() as dl:
        page.click("#exGo")
    html_path = SHOTS + "/exported-deck.html"; dl.value.save_as(html_path); html_name = dl.value.suggested_filename
    exported = open(html_path).read()
    check("export html: file name", html_name == "untitled-deck.html", html_name)
    check("export html: only the 2 selected slides", exported.count('class="slide-wrap"') == 2, exported.count('class="slide-wrap"'))
    check("export html: text, notes and embedded images", "Hello world" in exported and "Slide one commentary." in exported and "data:image/png;base64" in exported)
    check("export html: editable source embedded", 'id="halodeck-source"' in exported)
    check("export modal closed after export", page.locator("#exportModal").is_hidden())

    # --- the exported file works on its own
    viewer = ctx.new_page(); verr = []
    viewer.on("pageerror", lambda e: verr.append(str(e)))
    viewer.goto("file://" + html_path); viewer.wait_for_timeout(300)
    vis1 = viewer.evaluate("[...document.querySelectorAll('.slide-wrap')].map(w=>getComputedStyle(w).display)")
    viewer.keyboard.press("ArrowRight"); viewer.wait_for_timeout(100)
    vis2 = viewer.evaluate("[...document.querySelectorAll('.slide-wrap')].map(w=>getComputedStyle(w).display)")
    check("exported viewer: arrow keys change slide", vis1 == ["block", "none"] and vis2 == ["none", "block"], (vis1, vis2))
    viewer.keyboard.press("ArrowLeft")
    lay = viewer.evaluate("(() => { const c=document.querySelector('.ctrl').getBoundingClientRect(), s=document.querySelector('.slide-wrap.active .slide').getBoundingClientRect(), n=document.querySelector('.slide-wrap.active .notes').getBoundingClientRect(); return [c.bottom, s.top, n.top, s.bottom, innerHeight]; })()")
    check("exported viewer: controls never cover the slide or notes", lay[0] <= lay[1] and lay[2] >= lay[3] and lay[3] <= lay[4], lay)
    viewer.screenshot(path=f"{SHOTS}/v1_exported_html.png")
    check("exported viewer: no script errors", not verr, verr)
    viewer.close()

    # --- export images (zip of PNGs at 2x, with notes)
    page.click("#btnExport"); page.click('#menuExport [data-format="png"]')
    check("export: PNG chosen from the menu is preselected", page.locator('.ex-format.active').get_attribute("data-format") == "png" and page.locator("#exOptsImg").is_visible())
    with page.expect_download() as dl:
        page.click("#exGo")
    zp = str(dl.value.path()); zname = dl.value.suggested_filename
    zf = zipfile.ZipFile(zp)
    names = zf.namelist()
    check("export images: zip name", zname == "untitled-deck-slides.zip", zname)
    check("export images: one PNG per slide + notes.txt", names == ["untitled-deck-01.png", "untitled-deck-02.png", "untitled-deck-03.png", "notes.txt"], names)
    check("export images: zip CRCs valid", zf.testzip() is None)
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(zf.read(names[0])))
        check("export images: 2x resolution", im.size == (2560, 1440), im.size)
        im.save(f"{SHOTS}/x1_slide1.png")
        Image.open(io.BytesIO(zf.read(names[1]))).save(f"{SHOTS}/x2_slide2.png")
    except ImportError:
        check("export images: PNG signature", zf.read(names[0])[:8] == b"\x89PNG\r\n\x1a\n")
    check("export images: notes text", "Slide one commentary." in zf.read("notes.txt").decode())

    # --- single slide, JPG -> a plain image file
    page.click("#btnExport"); page.click('#menuExport [data-format="png"]')
    page.click("#exNone"); page.click(".ex-card >> nth=1"); page.click('#exImgType [data-v="jpeg"]'); page.click('#exImgScale [data-v="1"]')
    page.uncheck("#exImgNotes")
    with page.expect_download() as dl:
        page.click("#exGo")
    jn = dl.value.suggested_filename; jb = open(dl.value.path(), "rb").read()
    check("export single slide: plain .jpg", jn == "untitled-deck-02.jpg" and jb[:3] == b"\xff\xd8\xff", jn)

    # --- PDF: every slide + notes pages, with real (searchable) text
    page.click("#btnExport"); page.click('#menuExport [data-format="pdf"]')
    check("export: PDF chosen from the menu shows PDF options", page.locator("#exOptsPdf").is_visible() and page.locator("#exOptsImg").is_hidden())
    check("export: button says what it exports", "as PDF" in page.inner_text("#exGo"), page.inner_text("#exGo"))
    page.screenshot(path=f"{SHOTS}/d3b_export_pdf.png")
    with page.expect_download(timeout=90000) as dl:
        page.click("#exGo")
    pdf_path = SHOTS + "/deck.pdf"; dl.value.save_as(pdf_path)
    check("export pdf: file name", dl.value.suggested_filename == "untitled-deck.pdf", dl.value.suggested_filename)
    qc = subprocess.run(["qpdf", "--check", pdf_path], capture_output=True, text=True)
    check("export pdf: valid PDF structure (qpdf --check)", qc.returncode == 0, (qc.stdout + qc.stderr)[-400:])
    info = subprocess.run(["pdfinfo", pdf_path], capture_output=True, text=True).stdout
    npages = int(re.search(r"Pages:\s+(\d+)", info).group(1)); psize = re.search(r"Page size:\s+([\d.]+) x ([\d.]+)", info)
    nsl = page.evaluate("HaloDeck.doc.slides.length"); nno = page.evaluate("HaloDeck.doc.slides.filter(s => s.notes.trim()).length")
    check("export pdf: one page per slide + notes pages", npages == nsl + nno, (npages, nsl, nno))
    check("export pdf: 16:9 pages (960×540 pt)", float(psize.group(1)) == 960 and float(psize.group(2)) == 540, psize.groups())
    check("export pdf: title metadata", "Untitled deck" in info, info[:200])
    ptxt = subprocess.run(["pdftotext", pdf_path, "-"], capture_output=True, text=True).stdout
    check("export pdf: slide text is real text", "Hello world" in ptxt, ptxt[:300])
    check("export pdf: notes pages carry the notes", "Slide one commentary." in ptxt and "Point out the ridge on the left." in ptxt and "notes" in ptxt, ptxt[:600])
    # the invisible text sits where the visible text is drawn
    hw = page.evaluate("HaloDeck.doc.slides[0].elements.find(e => e.text === 'Hello world')")
    bbox = subprocess.run(["pdftotext", "-bbox", "-f", "1", "-l", "1", pdf_path, "-"], capture_output=True, text=True).stdout
    mm = re.search(r'xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">Hello', bbox)
    if mm and hw:
        ex_x = (hw["x"] + hw["pad"]) * 0.75
        check("export pdf: text layer lines up with the picture", abs(float(mm.group(1)) - ex_x) < 3, (mm.groups(), ex_x))
    else:
        check("export pdf: text layer lines up with the picture", False, (bool(mm), hw))
    subprocess.run(["pdftoppm", "-r", "50", "-png", "-f", "1", "-l", "3", pdf_path, SHOTS + "/pdfpage"], check=False)
    # smaller (JPEG) variant at 1x
    page.click("#btnExport"); page.click('#menuExport [data-format="pdf"]')
    page.click('#exPdfQual [data-v="small"]'); page.click('#exPdfScale [data-v="1"]'); page.uncheck("#exPdfNotes")
    with page.expect_download(timeout=90000) as dl:
        page.click("#exGo")
    pdf2 = SHOTS + "/deck-small.pdf"; dl.value.save_as(pdf2)
    qc2 = subprocess.run(["qpdf", "--check", pdf2], capture_output=True, text=True)
    n2 = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", pdf2], capture_output=True, text=True).stdout).group(1))
    check("export pdf (smaller, no notes): valid, one page per slide, smaller file", qc2.returncode == 0 and n2 == nsl and os.path.getsize(pdf2) < os.path.getsize(pdf_path),
          (qc2.returncode, n2, os.path.getsize(pdf2), os.path.getsize(pdf_path)))

    # --- autosave survives a reload
    page.wait_for_timeout(900)
    snap = page.evaluate("JSON.stringify(HaloDeck.doc.slides.map(s=>[s.id,s.elements.length]))")
    page.reload(); wait_ready(page)
    check("autosave: deck restored after reload", page.evaluate("JSON.stringify(HaloDeck.doc.slides.map(s=>[s.id,s.elements.length]))") == snap)
    check("autosave: images restored", page.evaluate("[...document.querySelectorAll('#canvas .el-image img')].every(i=>i.complete && i.naturalWidth>0)"))

    # --- re-open the exported HTML for editing
    page.once("dialog", lambda d: d.accept())
    page.set_input_files("#fileProject", html_path)
    page.wait_for_timeout(700)
    check("open exported HTML: slides come back editable", page.evaluate("HaloDeck.doc.slides.length") == 2 and
          page.evaluate("HaloDeck.doc.slides[0].elements.some(e=>e.type==='text' && e.text==='Hello world')"))
    check("open exported HTML: images restored", page.evaluate("[...document.querySelectorAll('#canvas .el-image img')].every(i=>i.naturalWidth>0)"))

    # --- vertical page size
    page.select_option("#pageSize", "9:16")
    page.wait_for_timeout(300)
    r = page.evaluate("(() => { const w=document.getElementById('canvasWrap').getBoundingClientRect(), s=document.getElementById('stage').getBoundingClientRect(); return [w.width/w.height, w.bottom<=s.bottom+1, w.top>=s.top-1]; })()")
    check("page size: vertical 9:16 fits the stage", abs(r[0] - 9/16) < 0.01 and r[1] and r[2], r)
    page.screenshot(path=f"{SHOTS}/d4_vertical_page.png")
    check("desktop: no console/page errors", not errors, errors[:5])
    ctx.close()

    # ------------------------------------------------------------ desktop: drawing over layers, editing text, paste
    ctx = browser.new_context(viewport={"width":1440, "height":900}, accept_downloads=True)
    ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=f"http://127.0.0.1:{PORT}")
    page = ctx.new_page(); errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "ERR_TUNNEL" not in m.text and "fonts.g" not in m.text else None)
    page.goto(URL); wait_ready(page)
    page.click("#btnHelp"); page.wait_for_timeout(300)
    check("help: ? button opens Help with the guide link (guide.html is next to the app)", page.locator("#helpModal").is_visible()
          and page.locator("#helpGuide").is_visible() and page.get_attribute("#helpGuide", "href") == "guide.html" and page.locator("#helpMissing").is_hidden())
    check("help: shortcuts show the right modifier", "Ctrl+Z" in page.inner_text(".help-keys"), page.inner_text(".help-keys")[:60])
    page.keyboard.press("Escape")
    check("help: Esc closes it", page.locator("#helpModal").is_hidden())
    page.keyboard.press("Shift+Slash"); page.wait_for_timeout(200)
    check("help: the ? key opens it", page.locator("#helpModal").is_visible())
    page.keyboard.press("Escape")
    gr = page.request.get(URL.replace("index.html", "guide.html"))
    check("guide.html is served next to the app and links back", gr.ok and 'id="openApp"' in gr.text() and "fig-workspace" in gr.text())
    pb = page.locator("#btnPaste")
    check("paste: labelled Paste button in the toolbar", pb.is_visible() and pb.inner_text().strip() == "Paste", pb.inner_text())

    # a big screenshot via the Paste button
    page.evaluate("async (mk) => { const f = await (eval(mk))([1600,900,'#3e8ef7','screenshot']); await navigator.clipboard.write([new ClipboardItem({'image/png': f})]); }", MK_IMG)
    pb.click(); page.wait_for_timeout(700)
    img = [x for x in els(page) if x["type"] == "image"]
    check("paste button: picture from the clipboard", len(img) == 1, len(img))
    img0 = img[0]

    # draw several shapes starting ON the picture, without re-picking the tool
    page.click('[data-tool="ellipse"]')
    drag(page, *page_point(page, 300, 200), *page_point(page, 520, 330))
    drag(page, *page_point(page, 700, 380), *page_point(page, 900, 520))
    page.click('[data-tool="rect"]')
    drag(page, *page_point(page, 400, 450), *page_point(page, 620, 560))
    page.click('[data-tool="arrow"]')
    drag(page, *page_point(page, 980, 250), *page_point(page, 860, 330))
    e2 = els(page)
    check("draw over picture: 2 circles, 1 rectangle, 1 arrow, all started on the picture",
          [x.get("shape", x["type"]) for x in e2] == ["image", "ellipse", "ellipse", "rect", "arrow"], [x.get("shape", x["type"]) for x in e2])
    check("draw over picture: the picture itself didn't move", e2[0]["x"] == img0["x"] and e2[0]["y"] == img0["y"])
    page.screenshot(path=f"{SHOTS}/f1_drawn_over_picture.png")

    # with the tool still on, dragging the shape you just drew moves it instead of drawing another
    page.click('[data-tool="ellipse"]')
    drag(page, *page_point(page, 150, 420), *page_point(page, 260, 520))
    c = els(page)[-1]
    rx, ry = ring_pt(page, c, math.pi * 0.75)
    drag(page, rx, ry, rx + 40, ry, steps=5)
    c2 = els(page)[-1]
    check("tool on: dragging the just-drawn circle's outline nudges it", len(els(page)) == 6 and c2["id"] == c["id"] and c2["x"] > c["x"] + 10, (len(els(page)), c["x"], c2["x"]))
    page.keyboard.press("Escape")

    # clicking inside a hollow circle reaches the picture underneath
    circ = els(page)[1]
    page.mouse.click(*page_point(page, circ["x"] + circ["w"] / 2, circ["y"] + circ["h"] / 2))
    check("hollow circle: clicking inside it selects what's underneath", page.evaluate("HaloDeck.ui.sel") == img0["id"], page.evaluate("HaloDeck.ui.sel"))

    # text inside a circle highlight can be clicked into
    page.click('[data-tool="text"]')
    page.mouse.click(*page_point(page, 330, 250)); page.keyboard.type("Under circle"); page.keyboard.press("Escape")
    t = [x for x in els(page) if x["type"] == "text"][0]
    page.click('[data-tool="ellipse"]')
    drag(page, *page_point(page, t["x"] - 40, t["y"] - 40), *page_point(page, t["x"] + 380, t["y"] + 110))
    page.keyboard.press("Escape"); page.mouse.click(*page_point(page, 40, 40))
    ov = els(page)[-1]
    check("setup: circle drawn over the text", ov["type"] == "shape" and ov["x"] < t["x"] and ov["x"] + ov["w"] > t["x"] + 200)
    page.mouse.click(*page_point(page, t["x"] + t["pad"] + 3, t["y"] + t["pad"] + 20))
    check("text under a circle: one click goes into editing", page.evaluate("HaloDeck.ui.editing") == t["id"], page.evaluate("[HaloDeck.ui.sel, HaloDeck.ui.editing]"))
    page.keyboard.type("X"); page.keyboard.press("Escape")
    check("text under a circle: typed text lands in it", [x for x in els(page) if x["id"] == t["id"]][0]["text"] == "XUnder circle", [x for x in els(page) if x["id"] == t["id"]][0]["text"])

    # text completely covered by a picture: double-click edits it, and it floats up while you type
    page.locator(f'.layer[data-key="{t["id"]}"] .lname').click()
    page.click('#ctxBar [data-act="back"]')
    page.mouse.click(*page_point(page, 40, 40))
    order = [x["id"] for x in els(page)]
    check("setup: text now sits under the picture", order[0] == t["id"], order[:2])
    tx, ty = page_point(page, t["x"] + t["pad"] + 3, t["y"] + t["pad"] + 20)
    page.mouse.click(tx, ty)
    check("covered text: single click selects the picture on top", page.evaluate("HaloDeck.ui.sel") == img0["id"] and page.evaluate("HaloDeck.ui.editing") is None)
    page.mouse.dblclick(tx, ty)
    check("covered text: double-click edits it", page.evaluate("HaloDeck.ui.editing") == t["id"], page.evaluate("[HaloDeck.ui.sel, HaloDeck.ui.editing]"))
    zi = page.evaluate("(id) => getComputedStyle(document.querySelector('#canvas [data-id=\"' + id + '\"]')).zIndex", t["id"])
    check("covered text: shown above the picture while editing", zi == "3", zi)
    page.keyboard.press("End"); page.keyboard.type("!"); page.keyboard.press("Escape")
    check("covered text: edit saved, layer order unchanged", els(page)[0]["text"] == "XUnder circle!" and els(page)[0]["id"] == t["id"], els(page)[0]["text"])

    # locked text: click edits, drag doesn't move
    tid = t["id"]
    page.locator(f'.layer[data-key="{tid}"] .lname').click()
    page.click('#ctxBar [data-act="front"]')
    page.click('#ctxBar [data-act="lock"]')
    page.mouse.click(*page_point(page, 40, 40))
    tl = [x for x in els(page) if x["id"] == tid][0]
    check("setup: text on top and locked", tl["locked"] and els(page)[-1]["id"] == tid)
    page.mouse.click(*page_point(page, tl["x"] + tl["pad"] + 3, tl["y"] + tl["pad"] + 20))
    check("locked text: still opens for editing", page.evaluate("HaloDeck.ui.editing") == tid)
    page.keyboard.press("Escape")
    lx, ly = page_point(page, tl["x"] + 60, tl["y"] + 20)
    drag(page, lx, ly, lx + 90, ly + 40)
    tl2 = [x for x in els(page) if x["id"] == tid][0]
    check("locked text: dragging doesn't move it", tl2["x"] == tl["x"] and tl2["y"] == tl["y"], (tl["x"], tl2["x"]))
    page.keyboard.press("Escape")
    page.locator(f'.layer[data-key="{tid}"] [data-act="lock"]').click()
    check("unlock from the layers panel", not [x for x in els(page) if x["id"] == tid][0]["locked"])

    # text tool over existing text edits it instead of stacking a new box
    n_before = len(els(page))
    page.click('[data-tool="text"]')
    page.mouse.click(*page_point(page, tl["x"] + tl["pad"] + 40, tl["y"] + tl["pad"] + 20))
    check("text tool on existing text: edits it, no new box", page.evaluate("HaloDeck.ui.editing") == tid and len(els(page)) == n_before)
    page.keyboard.press("Escape")

    # Style panel text box and the Layers ✎ button
    page.evaluate("(id) => { HaloDeck.ui.sel = null; }", tid)
    page.mouse.click(*page_point(page, 40, 40))
    page.locator(f'.layer[data-key="{tid}"] .lname').click()
    ta = page.locator('#props textarea[data-k="text"]')
    check("style panel: text box shows the layer's text", ta.is_visible() and ta.input_value() == "XUnder circle!", ta.input_value() if ta.count() else None)
    ta.fill("Edited from the panel"); ta.blur()
    nodetxt = page.evaluate("(id) => document.querySelector('#canvas [data-id=\"' + id + '\"]').textContent", tid)
    check("style panel: typing there updates the slide", [x for x in els(page) if x["id"] == tid][0]["text"] == "Edited from the panel" and nodetxt == "Edited from the panel", nodetxt)
    page.locator(f'.layer[data-key="{tid}"] [data-act="edit"]').click()
    check("layers: ✎ button opens the text for editing", page.evaluate("HaloDeck.ui.editing") == tid)
    page.keyboard.press("Escape")

    # right-click menu: copy a shape, paste it where you right-click
    page.mouse.click(*page_point(page, 40, 40))
    rect = [x for x in els(page) if x.get("shape") == "rect"][0]
    page.mouse.click(*page_point(page, rect["x"] + 2, rect["y"] + rect["h"] / 2), button="right")
    menu_txt = page.inner_text("#ctxMenu")
    check("right-click on a layer: Cut/Copy/Paste/Duplicate/Delete", page.locator("#ctxMenu").is_visible() and all(w in menu_txt for w in ["Cut", "Copy", "Paste", "Duplicate", "Delete"]) and page.evaluate("HaloDeck.ui.sel") == rect["id"], menu_txt)
    page.screenshot(path=f"{SHOTS}/f2_context_menu.png")
    page.click('#ctxMenu [data-act="copy"]')
    page.mouse.click(*page_point(page, 1180, 640), button="right")
    check("right-click on empty space: Paste here", "Paste here" in page.inner_text("#ctxMenu"), page.inner_text("#ctxMenu"))
    n0 = len(els(page))
    page.click('#ctxMenu [data-act="paste"]'); page.wait_for_timeout(500)
    pr = els(page)
    check("menu Paste here: copy lands where you right-clicked", len(pr) == n0 + 1 and pr[-1].get("shape") == "rect" and
          abs(pr[-1]["x"] + pr[-1]["w"] / 2 - min(1180, 1280 - pr[-1]["w"] / 2)) < 2 and abs(pr[-1]["y"] + pr[-1]["h"] / 2 - min(640, 720 - pr[-1]["h"] / 2)) < 2,
          (len(pr), n0, pr[-1].get("x"), pr[-1].get("y")))
    page.mouse.click(*page_point(page, 40, 40), button="right")
    page.keyboard.press("Escape")
    check("right-click menu closes with Esc", page.locator("#ctxMenu").is_hidden())

    # Paste when the browser won't hand the clipboard over: a paste box takes it
    page.evaluate("() => { navigator.clipboard.read = () => Promise.reject(new DOMException('blocked', 'NotAllowedError')); }")
    pb.click(); page.wait_for_timeout(200)
    check("blocked clipboard: paste box opens, focused", page.locator("#pasteModal").is_visible() and page.evaluate("document.activeElement.id") == "pasteTarget")
    page.screenshot(path=f"{SHOTS}/f3_paste_box.png")
    n0 = len(els(page))
    page.evaluate("""async (mk) => { const f = await (eval(mk))([500,300,'#8e4ec6','boxed']); const dt = new DataTransfer(); dt.items.add(f);
      document.getElementById('pasteTarget').dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles:true, cancelable:true})); }""", MK_IMG)
    page.wait_for_timeout(600)
    check("paste box: picture pasted into it becomes a layer and the box closes", len(els(page)) == n0 + 1 and els(page)[-1]["type"] == "image" and page.locator("#pasteModal").is_hidden())
    page.evaluate("() => { navigator.clipboard.read = async () => [new ClipboardItem({'text/plain': new Blob(['C:\\\\Users\\\\me\\\\Desktop\\\\shot.png'], {type:'text/plain'})})]; }")
    pb.click(); page.wait_for_timeout(200)
    check("copied file (path on clipboard): asks to paste it in the box, no stray text layer", page.locator("#pasteModal").is_visible() and "file" in page.inner_text("#pasteWhy") and els(page)[-1]["type"] == "image")
    page.keyboard.press("Escape")
    check("paste box closes with Esc", page.locator("#pasteModal").is_hidden())
    check("drawing & editing session: no errors", not errors, errors[:5])
    ctx.close()

    # ------------------------------------------------------------ desktop: open PDFs and photos as slides
    ctx = browser.new_context(viewport={"width":1440, "height":900}, accept_downloads=True)
    ctx.route("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/**", serve_pdfjs)
    page = ctx.new_page(); errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "ERR_TUNNEL" not in m.text and "fonts.g" not in m.text else None)
    page.goto(URL); wait_ready(page)
    def import_pdf(path):
        page.set_input_files("#filePdf", path)
        page.wait_for_selector("#imOpts:not([hidden])", timeout=60000)
    def finish_import():
        page.click("#imGo"); page.wait_for_selector("#importModal", state="hidden", timeout=90000); page.wait_for_timeout(200)

    page.click("#btnOpen")
    acts = page.eval_on_selector_all("#menuOpen [data-act]", "b => b.map(x => x.dataset.act)")
    check("Open menu: PDF, photos, project", page.locator("#menuOpen").is_visible() and acts == ["pdf", "photos", "project"], acts)
    page.keyboard.press("Escape")

    # Letter-size PDF -> new deck at exactly that size, text in notes, pages locked
    import_pdf(TESTPDFS + "letter-report.pdf")
    page.wait_for_function("document.querySelectorAll('#imStrip canvas').length === 3", timeout=30000)
    check("PDF dialog: pages, size and previews", "3 pages" in page.inner_text("#imMeta") and "8.5 × 11 in" in page.inner_text("#imMeta")
          and page.locator("#imStrip canvas").count() == 3 and "US Letter portrait" in page.inner_text("#imSize"), page.inner_text("#imMeta"))
    page.screenshot(path=f"{SHOTS}/i1_pdf_dialog.png")
    finish_import()
    pg = page.evaluate("HaloDeck.doc.page"); sl = page.evaluate("HaloDeck.doc.slides")
    check("PDF -> slides: slide size matches the PDF (Letter, 816×1056)", pg == {"w":816, "h":1056}, pg)
    check("PDF -> slides: one slide per page, deck named after the file", len(sl) == 3 and page.evaluate("HaloDeck.doc.title") == "letter-report", (len(sl), page.evaluate("HaloDeck.doc.title")))
    e0 = sl[0]["elements"][0]
    check("PDF -> slides: page fills the slide exactly, locked", (e0["x"], e0["y"], round(e0["w"]), round(e0["h"]), e0["locked"]) == (0, 0, 816, 1056, True), e0)
    check("PDF -> slides: page text copied into notes", "Quarterly report page 2" in sl[1]["notes"] and "churn fell sharply" in sl[1]["notes"], sl[1]["notes"][:120])
    natural = page.evaluate("(() => { const i = document.querySelector('#canvas .el-image img'); return [i.naturalWidth, i.naturalHeight]; })()")
    check("PDF -> slides: page picture is sharp (≥ 2× slide pixels)", natural[0] >= 1600 and abs(natural[0] / natural[1] - 816 / 1056) < 0.01, natural)
    page.screenshot(path=f"{SHOTS}/i2_pdf_imported.png")
    # draw straight onto the locked page
    page.click('[data-tool="ellipse"]')
    drag(page, *page_point(page, 100, 400), *page_point(page, 300, 520))
    page.keyboard.press("Escape")
    check("PDF page: you can draw on it right away", [x["type"] for x in els(page)] == ["image", "shape"] and els(page)[0]["x"] == 0)
    # round trip: HTML has the words, PDF keeps Letter size
    page.click("#btnExport"); page.click('#menuExport [data-format="html"]')
    with page.expect_download() as dl:
        page.click("#exGo")
    hp = SHOTS + "/from-pdf.html"; dl.value.save_as(hp); htm = open(hp).read()
    check("PDF -> HTML: page text is in the HTML", "Quarterly report page 3" in htm and "Revenue grew in every region" in htm and 'alt="Page 2 of letter-report"' in htm)
    page.click("#btnExport"); page.click('#menuExport [data-format="pdf"]')
    with page.expect_download(timeout=90000) as dl:
        page.click("#exGo")
    rp = SHOTS + "/roundtrip.pdf"; dl.value.save_as(rp)
    rinfo = subprocess.run(["pdfinfo", rp], capture_output=True, text=True).stdout
    check("PDF round trip: exported PDF is Letter size again (612×792 pt)", "612 x 792 pts" in rinfo, re.search(r"Page size:.*", rinfo).group(0) if "Page size" in rinfo else rinfo)

    # 16:9 PDF added to this (Letter) deck, keeping the deck size -> pages fitted, not stretched
    page.click(".thumb >> nth=2")
    import_pdf(TESTPDFS + "slides-169.pdf")
    page.click('#imWhere [data-v="add"]'); page.check('#imSize input[value="keep"]')
    finish_import()
    sl = page.evaluate("HaloDeck.doc.slides"); pg = page.evaluate("HaloDeck.doc.page")
    f = sl[3]["elements"][0]
    check("add 16:9 PDF to Letter deck (keep size): added after current slide", len(sl) == 5 and pg == {"w":816, "h":1056} and page.evaluate("HaloDeck.ui.cur") == 3, (len(sl), pg))
    check("add 16:9 PDF (keep size): page fitted inside, aspect kept, centred", abs(f["w"] - 816) < 0.5 and abs(f["h"] - 816 * 405 / 720) < 0.5 and abs(f["y"] - (1056 - f["h"]) / 2) < 0.5, f)

    # page range + mixed sizes
    import_pdf(TESTPDFS + "mixed.pdf")
    check("mixed sizes: dialog says pages differ", "different sizes" in page.inner_text("#imNote"), page.inner_text("#imNote"))
    page.click('#imPagesMode [data-v="range"]'); page.fill("#imRange", "2")
    check("page range: summary counts 1 slide", page.inner_text("#imGo") == "Create 1 slide", page.inner_text("#imGo"))
    page.fill("#imRange", "5-9")
    check("page range: impossible range blocks creating", page.locator("#imGo").is_disabled() and "bad" in (page.get_attribute("#imRange", "class") or ""))
    page.fill("#imRange", "2"); finish_import()
    sl = page.evaluate("HaloDeck.doc.slides")
    check("page range: only page 2 (landscape Letter) came in, as a new deck", len(sl) == 1 and page.evaluate("HaloDeck.doc.page") == {"w":1056, "h":816} and sl[0]["notes"].strip() == "Landscape page", (len(sl), page.evaluate("HaloDeck.doc.page")))

    # no text layer, and a password
    import_pdf(TESTPDFS + "scan.pdf"); finish_import()
    check("PDF with no text: tells you it's pictures only", "no text layer" in page.inner_text("#toast"), page.inner_text("#toast"))
    page.set_input_files("#filePdf", TESTPDFS + "locked.pdf"); page.wait_for_timeout(2500)
    check("password-protected PDF: clear message, no dialog left open", page.locator("#importModal").is_hidden() and "password" in page.inner_text("#toast"), page.inner_text("#toast"))

    # dropping a PDF onto the page opens the same dialog
    page.evaluate("""async (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([u], 'dropped.pdf', {type:'application/pdf'}));
      const t = document.getElementById('stage'); t.dispatchEvent(new DragEvent('drop', {dataTransfer:dt, clientX:700, clientY:400, bubbles:true, cancelable:true})); }""",
      __import__("base64").b64encode(open(TESTPDFS + "slides-169.pdf", "rb").read()).decode())
    page.wait_for_selector("#imOpts:not([hidden])", timeout=30000)
    check("drop a PDF: opens the PDF dialog", page.inner_text("#imName") == "dropped.pdf")
    page.click("#imCancel")
    check("cancel leaves the deck alone", page.locator("#importModal").is_hidden() and page.evaluate("HaloDeck.doc.slides.length") == 1)

    # photos -> slides: order by file name, match their shape, or fill this deck's slides
    photos = [{"name": n, "mimeType": "image/png", "buffer": png_bytes(900, 1200, c, n)} for n, c in [("img10.png", "#8e4ec6"), ("img2.png", "#30a46c"), ("img1.png", "#e5484d")]]
    page.click("#btnOpen"); page.click('#menuOpen [data-act="photos"]') if False else None
    page.keyboard.press("Escape")
    page.set_input_files("#fileSlides", photos)
    page.wait_for_selector("#imOpts:not([hidden])", timeout=30000)
    check("photos dialog: 3 photos, previews in name order", page.inner_text("#imName") == "3 photos" and
          page.eval_on_selector_all("#imStrip img", "i => i.map(x => x.alt)") == ["img1.png", "img2.png", "img10.png"], page.eval_on_selector_all("#imStrip img", "i => i.map(x => x.alt)"))
    page.screenshot(path=f"{SHOTS}/i3_photos_dialog.png")
    page.click('#imWhere [data-v="new"]')
    finish_import()
    sl = page.evaluate("HaloDeck.doc.slides")
    check("photos -> new deck matched to the photos (3:4 portrait, 900×1200)", page.evaluate("HaloDeck.doc.page") == {"w":900, "h":1200} and len(sl) == 3, page.evaluate("HaloDeck.doc.page"))
    check("photos -> slides: in file-name order, each fills its slide", [s["elements"][0]["alt"] for s in sl] == ["img1", "img2", "img10"] and
          all((round(s["elements"][0]["w"]), round(s["elements"][0]["h"])) == (900, 1200) for s in sl), [s["elements"][0]["alt"] for s in sl])
    page.select_option("#pageSize", "16:9"); page.wait_for_timeout(200)
    page.set_input_files("#fileSlides", photos[:2])
    page.wait_for_selector("#imOpts:not([hidden])", timeout=30000)
    page.check('#imSize input[value="keep"]'); page.click('#imFit [data-v="cover"]'); page.click('#imOrder [data-v="picked"]')
    finish_import()
    sl = page.evaluate("HaloDeck.doc.slides"); cv = sl[page.evaluate("HaloDeck.ui.cur")]["elements"][0]
    check("photos added to 16:9 deck with Fill: cover the slide, as picked", len(sl) == 5 and abs(cv["w"] - 1280) < 0.5 and cv["h"] > 720 and cv["alt"] == "img10", (len(sl), cv["w"], cv["h"], cv["alt"]))

    # export: custom slide selection
    page.click("#btnExport"); page.click('#menuExport [data-format="png"]')
    check("export: range field starts as all slides", page.input_value("#exRange") == "1-5", page.input_value("#exRange"))
    page.fill("#exRange", "1, 3-4")
    check("export: typing 1, 3-4 picks those slides", page.locator(".ex-card.on").count() == 3 and "3 of 5" in page.inner_text("#exPickCount"), page.inner_text("#exPickCount"))
    page.click("#exCur")
    check("export: Current picks just the slide you're on", page.locator(".ex-card.on").count() == 1 and page.input_value("#exRange") == str(page.evaluate("HaloDeck.ui.cur") + 1), page.input_value("#exRange"))
    page.click(".ex-card >> nth=0")
    cur1 = page.evaluate("HaloDeck.ui.cur") + 1
    want = "1" if cur1 == 1 else ("1-2" if cur1 == 2 else "1, " + str(cur1))
    check("export: clicking slides updates the range text", page.input_value("#exRange") == want, (page.input_value("#exRange"), want))
    page.click("#exAll")
    check("export: All selects everything again", page.input_value("#exRange") == "1-5" and page.locator(".ex-card.on").count() == 5)
    page.screenshot(path=f"{SHOTS}/i4_export_range.png")
    page.click("#exCancel")
    check("open-as-slides session: no errors", not errors, errors[:5])
    ctx.close()

    # ------------------------------------------------------------ phone (portrait)
    for label, vp in [("phone", {"width":390, "height":844}), ("phone-landscape", {"width":844, "height":390})]:
        mctx = browser.new_context(viewport=vp, device_scale_factor=3, is_mobile=True, has_touch=True, accept_downloads=True)
        mctx.route("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/**", serve_pdfjs)
        m = mctx.new_page(); merr = []
        m.on("pageerror", lambda e: merr.append(str(e)))
        m.goto(URL); wait_ready(m)
        m.screenshot(path=f"{SHOTS}/m_{label}_1_empty.png")
        g = m.evaluate("""() => { const q=id=>document.getElementById(id).getBoundingClientRect(); const s=q('stage'), w=q('canvasWrap'), d=q('dock'), t=document.getElementById('topbar');
          return {wrapInStage: w.left>=s.left-1 && w.right<=s.right+1 && w.top>=s.top-1 && w.bottom<=s.bottom+1, dockVisible: d.height>0 && d.bottom<=innerHeight+1,
                  topbarFits: t.scrollWidth<=t.clientWidth+1, docW: document.documentElement.scrollWidth, vw: innerWidth, toolsInDock: !!document.querySelector('#dock #tools')}; }""")
        check(f"{label}: slide fits the screen", g["wrapInStage"], g)
        check(f"{label}: tool dock at the bottom", g["dockVisible"] and g["toolsInDock"], g)
        check(f"{label}: top bar doesn't overflow", g["topbarFits"] and g["docW"] <= g["vw"], g)

        # tap to drop a circle
        m.tap('[data-tool="ellipse"]')
        cx, cy = page_point(m, 640, 360)
        m.touchscreen.tap(cx, cy)
        check(f"{label}: tap creates a circle", len([x for x in els(m) if x["type"] == "shape"]) == 1)
        m.tap('[data-tool="select"]')
        # one-finger drag moves it (small on a phone screen, so it's grabbable anywhere) — CDP touch
        cdp = mctx.new_cdp_session(m)
        s0 = [x for x in els(m) if x["type"] == "shape"][0]
        px, py = page_point(m, s0["x"] + s0["w"] / 2, s0["y"] + s0["h"] / 2)
        cdp.send("Input.dispatchTouchEvent", {"type":"touchStart", "touchPoints":[{"x":px, "y":py, "id":1}]})
        for i in range(1, 9):
            cdp.send("Input.dispatchTouchEvent", {"type":"touchMove", "touchPoints":[{"x":px + i * 5, "y":py + i * 3, "id":1}]})
        cdp.send("Input.dispatchTouchEvent", {"type":"touchEnd", "touchPoints":[]})
        m.wait_for_timeout(100)
        s1 = [x for x in els(m) if x["type"] == "shape"][0]
        zz = m.evaluate("HaloDeck.ui.zoom")
        check(f"{label}: finger drag moves the circle", abs(s1["x"] - s0["x"] - 40 / zz) < 3, (s0["x"], s1["x"], zz))
        # tap text tool, tap canvas, type
        m.tap('[data-tool="text"]')
        tx, ty = page_point(m, 120, 120)
        m.touchscreen.tap(tx, ty)
        m.keyboard.type("Look here")
        bx, by = page_point(m, 1200, 690)
        m.touchscreen.tap(bx, by)
        texts = [x for x in els(m) if x["type"] == "text"]
        check(f"{label}: tap text tool + type", len(texts) == 1 and texts[0]["text"] == "Look here", texts)
        # first tap selects, second tap edits
        t = texts[0]
        qx, qy = page_point(m, t["x"] + t["pad"] + 6, t["y"] + t["pad"] + 10)
        m.touchscreen.tap(qx, qy)
        sel1 = m.evaluate("[HaloDeck.ui.sel, HaloDeck.ui.editing]")
        m.wait_for_timeout(350)
        m.touchscreen.tap(qx, qy)
        sel2 = m.evaluate("[HaloDeck.ui.sel, HaloDeck.ui.editing]")
        check(f"{label}: tap selects, second tap edits text", sel1 == [t["id"], None] and sel2 == [t["id"], t["id"]], (sel1, sel2))
        m.evaluate("document.activeElement.blur()")
        # pinch zoom
        z0 = m.evaluate("HaloDeck.ui.zoom")
        sb = m.locator("#stage").bounding_box()
        mx, my = sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2
        cdp.send("Input.dispatchTouchEvent", {"type":"touchStart", "touchPoints":[{"x":mx - 30, "y":my, "id":1}, {"x":mx + 30, "y":my, "id":2}]})
        for i in range(1, 11):
            cdp.send("Input.dispatchTouchEvent", {"type":"touchMove", "touchPoints":[{"x":mx - 30 - i * 8, "y":my, "id":1}, {"x":mx + 30 + i * 8, "y":my, "id":2}]})
        cdp.send("Input.dispatchTouchEvent", {"type":"touchEnd", "touchPoints":[]})
        m.wait_for_timeout(150)
        z1 = m.evaluate("HaloDeck.ui.zoom")
        check(f"{label}: pinch zooms the slide", z1 > z0 * 1.8, (z0, z1))
        m.screenshot(path=f"{SHOTS}/m_{label}_2_zoomed.png")
        m.tap("#btnZoomFit")
        # select circle and open style sheet
        m.evaluate("HaloDeck.ui.sel=null")
        s1 = [x for x in els(m) if x["type"] == "shape"][0]
        m.touchscreen.tap(*ring_pt(m, s1, math.pi * 0.25))
        m.wait_for_timeout(100)
        check(f"{label}: context toolbar appears for selection", m.locator("#ctxBar").is_visible())
        m.screenshot(path=f"{SHOTS}/m_{label}_3_selected.png")
        m.tap('#ctxBar [data-act="style"]')
        m.wait_for_timeout(350)
        check(f"{label}: style panel opens", m.locator("#props .field >> nth=0").is_visible() and m.locator("#props .field").count() > 3)
        m.wait_for_timeout(250)
        if label == "phone":
            vis = m.evaluate("(() => { const w=document.getElementById('canvasWrap').getBoundingClientRect(), p=document.getElementById('rightPanel').getBoundingClientRect(); return [w.bottom, p.top, w.top]; })()")
            check("phone: slide stays visible above the style sheet", vis[0] <= vis[1] + 1 and vis[2] > 40, vis)
        m.screenshot(path=f"{SHOTS}/m_{label}_4_style_sheet.png")
        m.tap('#rightPanel [data-close]')
        m.wait_for_timeout(300)
        m.tap("#btnSlidesPanel"); m.wait_for_timeout(300)
        check(f"{label}: slides drawer opens", m.locator("#slideList").is_visible())
        m.screenshot(path=f"{SHOTS}/m_{label}_5_slides.png")
        m.touchscreen.tap(vp["width"] - 12, vp["height"] / 2); m.wait_for_timeout(300)
        check(f"{label}: tapping outside closes the drawer", not m.evaluate("document.getElementById('slidesPanel').classList.contains('open')"))
        # touch and hold on empty slide space -> menu -> Paste here (clipboard not shared -> paste box)
        hx, hy = page_point(m, 60, 650)
        cdp.send("Input.dispatchTouchEvent", {"type":"touchStart", "touchPoints":[{"x":hx, "y":hy, "id":1}]})
        m.wait_for_timeout(750)
        cdp.send("Input.dispatchTouchEvent", {"type":"touchEnd", "touchPoints":[]})
        m.wait_for_timeout(150)
        check(f"{label}: touch-and-hold opens the menu with Paste here", m.locator("#ctxMenu").is_visible() and "Paste here" in m.inner_text("#ctxMenu"))
        m.screenshot(path=f"{SHOTS}/m_{label}_6a_hold_menu.png")
        m.tap('#ctxMenu [data-act="paste"]'); m.wait_for_timeout(300)
        n0 = len(els(m))
        if m.locator("#pasteModal").is_visible():
            m.screenshot(path=f"{SHOTS}/m_{label}_6b_paste_box.png")
            m.evaluate("""() => { const dt = new DataTransfer(); dt.setData('text/plain', 'Pasted on a phone');
              document.getElementById('pasteTarget').dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles:true, cancelable:true})); }""")
            m.wait_for_timeout(200)
        te = [x for x in els(m) if x["type"] == "text" and x["text"] == "Pasted on a phone"]
        check(f"{label}: paste from the hold menu adds the text near the finger", len(te) == 1 and te[0]["x"] < 640, te)
        m.keyboard.press("Escape"); m.evaluate("document.activeElement && document.activeElement.blur()")
        m.tap("#btnMore"); m.wait_for_timeout(150)
        check(f"{label}: More menu has Paste, PDF and photos as slides, and Help", m.locator('#menuMore [data-act="paste"]').is_visible()
              and m.locator('#menuMore [data-act="pdf"]').is_visible() and m.locator('#menuMore [data-act="slidesFromImages"]').is_visible()
              and m.locator('#menuMore [data-act="help"]').is_visible())
        m.tap("#btnMore"); m.wait_for_timeout(100)
        m.set_input_files("#filePdf", TESTPDFS + "letter-report.pdf")
        m.wait_for_selector("#imOpts:not([hidden])", timeout=60000); m.wait_for_timeout(600)
        fit = m.evaluate("(() => { const r = document.querySelector('.import-modal').getBoundingClientRect(), g = document.getElementById('imGo').getBoundingClientRect(); return [r.left >= 0, r.right <= innerWidth + 1, g.bottom <= innerHeight + 1, document.documentElement.scrollWidth <= innerWidth]; })()")
        check(f"{label}: PDF dialog fits the screen", all(fit), fit)
        m.screenshot(path=f"{SHOTS}/m_{label}_7_pdf_dialog.png")
        m.tap("#imCancel"); m.wait_for_timeout(150)
        m.tap("#btnExport"); m.wait_for_timeout(200)
        check(f"{label}: export menu opens", m.locator("#menuExport").is_visible())
        m.tap('#menuExport [data-format="pdf"]'); m.wait_for_timeout(250)
        fm = m.evaluate("[...document.querySelectorAll('.ex-format')].map(b => { const r = b.getBoundingClientRect(); return [r.width > 60, r.right <= innerWidth + 1]; })")
        check(f"{label}: three format tiles fit the screen", len(fm) == 3 and all(a and b for a, b in fm), fm)
        m.screenshot(path=f"{SHOTS}/m_{label}_6_export.png")
        m.tap('.ex-format[data-format="html"]')
        with m.expect_download() as dl:
            m.tap("#exGo")
        check(f"{label}: export works", dl.value.suggested_filename.endswith(".html"))
        check(f"{label}: no page errors", not merr, merr[:5])
        mctx.close()

    # ------------------------------------------------------------ getting-started tour
    def meta_build(path):
        m = re.search(r'<meta name="halodeck-build" content="(\w+)"', open(path, encoding="utf-8").read(4096))
        return m.group(1) if m else None
    app_id, guide_id = meta_build(os.path.join(DIST, "index.html")), meta_build(os.path.join(DIST, "guide.html"))
    check("release: index.html and guide.html carry the same build id", app_id and app_id == guide_id and app_id != "dev", (app_id, guide_id))

    fctx = browser.new_context(fresh=True, viewport={"width":1440, "height":900})
    fp = fctx.new_page(); ferr = []
    fp.on("pageerror", lambda e: ferr.append(str(e)))
    fp.goto(URL); wait_ready(fp)
    fp.wait_for_selector("#tourModal:not([hidden])", timeout=5000)
    check("tour: a first visit opens the welcome", fp.locator("#tourModal").is_visible() and fp.locator('[data-track="users"]').is_visible()
          and fp.locator('[data-track="admins"]').is_visible())
    info = fp.evaluate("""() => { const t = HaloDeck.tour; const all = [...t.data.users.steps, ...t.data.admins.steps];
      return {version: t.version, build: t.build, users: t.data.users.steps.length, admins: t.data.admins.steps.length,
              missing: all.filter(s => s.shot && !t.shots.includes(s.shot)).map(s => s.shot),
              noVisual: all.filter(s => !s.shot && !s.visual).map(s => s.title),
              last: HaloDeck.updates.changelog.versions.at(-1), seen: localStorage.getItem('halodeck_seen_version')}; }""")
    check("tour: every user step has its screenshot built in", not info["missing"] and info["users"] >= 12, info["missing"])
    check("tour: every step has a picture or a diagram", not info["noVisual"], info["noVisual"])
    check("tour: version and build id come from the change log's newest entry", info["version"] == info["last"]["version"] and info["build"]["id"] == app_id
          and info["last"].get("build") == app_id, (info["version"], info["last"].get("version"), info["last"].get("build")))
    check("tour: opening it marks this version as seen", info["seen"] == info["version"], info["seen"])
    fp.screenshot(path=f"{SHOTS}/tour_0_welcome.png")
    fp.click('[data-track="users"]'); fp.wait_for_timeout(150)
    check("tour: users track starts at step 1", fp.inner_text("#tourCount") == f"Step 1 of {info['users']}", fp.inner_text("#tourCount"))
    fp.click("#tourNext"); fp.click("#tourNext"); fp.wait_for_timeout(100)
    c1 = fp.inner_text("#tourCount")
    fp.click("#tourBack"); fp.wait_for_timeout(100); c2 = fp.inner_text("#tourCount")
    fp.keyboard.press("ArrowRight"); fp.keyboard.press("ArrowRight"); fp.wait_for_timeout(100); c3 = fp.inner_text("#tourCount")
    fp.click(".tdot >> nth=6"); fp.wait_for_timeout(100); c4 = fp.inner_text("#tourCount")
    check("tour: Next, Back, arrow keys and dots move between steps", (c1, c2, c3, c4) == (f"Step 3 of {info['users']}", f"Step 2 of {info['users']}", f"Step 4 of {info['users']}", f"Step 7 of {info['users']}"), (c1, c2, c3, c4))

    def walk_track(pg, track, label):
        n = pg.evaluate(f"HaloDeck.tour.data.{track}.steps.length")
        bad_img, bad_show, bad_back, overflow = [], [], [], []
        for i in range(n):
            pg.evaluate(f"HaloDeck.tour.open('{track}', {i})"); pg.wait_for_timeout(60)
            st = pg.evaluate("""() => { const img = document.querySelector('#tourVisual img'), d = document.querySelector('#tourVisual .tdiag');
                const box = document.querySelector('#tourModal .tour').getBoundingClientRect(), nx = document.getElementById('tourNext').getBoundingClientRect();
                return {img: img ? (img.complete && img.naturalWidth > 0) : !!d, show: !document.getElementById('tourShow').hidden,
                        fits: box.left >= -1 && box.right <= innerWidth + 1 && nx.bottom <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth}; }""")
            if not st["img"]: bad_img.append(i + 1)
            if not st["fits"]: overflow.append(i + 1)
            if st["show"]:
                pg.click("#tourShow"); pg.wait_for_timeout(120)
                sp = pg.evaluate("""() => { const sp = document.getElementById('spotlight'); if(sp.hidden) return null;
                    const r = sp.querySelector('.spot-ring').getBoundingClientRect(), t = sp.querySelector('.spot-tip'), tr = t.getBoundingClientRect();
                    const hit = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2).find(n => !sp.contains(n));
                    return {ring: r.width > 8 && r.height > 8 && r.left >= -8 && r.right <= innerWidth + 8 && r.top >= -8 && r.bottom <= innerHeight + 8,
                            tip: t.querySelector('span').textContent.length > 5 && tr.left >= 0 && tr.right <= innerWidth + 1 && tr.top >= 0 && tr.bottom <= innerHeight + 1,
                            target: !!hit && hit.id !== 'canvasArea'}; }""")
                if not sp or not all(sp.values()): bad_show.append((i + 1, sp))
                pg.keyboard.press("Escape"); pg.wait_for_timeout(80)
                back = pg.evaluate("[!document.getElementById('tourModal').hidden, document.getElementById('spotlight').hidden, document.getElementById('tourCount').textContent]")
                if not (back[0] and back[1] and back[2] == f"Step {i + 1} of {n}"): bad_back.append((i + 1, back))
        check(f"tour {label}: every step's picture loads", not bad_img, bad_img)
        check(f"tour {label}: every Show me rings a real control, with a tip on screen", not bad_show, bad_show)
        check(f"tour {label}: Esc from Show me returns to the same step", not bad_back, bad_back)
        check(f"tour {label}: every step fits the screen", not overflow, overflow)
        pg.evaluate("HaloDeck.tour.close()")

    walk_track(fp, "users", "desktop users")
    walk_track(fp, "admins", "desktop admins")
    fp.evaluate("HaloDeck.tour.open('admins', 2)"); fp.wait_for_timeout(80)
    check("tour admins: release step shows this build", app_id in fp.inner_text("#tourVisual"), fp.inner_text("#tourVisual"))
    fp.screenshot(path=f"{SHOTS}/tour_1_admin_release.png")
    fp.evaluate("HaloDeck.tour.open('users', 13)"); fp.wait_for_timeout(80)
    check("tour: last step says Finish", fp.inner_text("#tourNext") == "Finish")
    fp.click("#tourNext"); fp.wait_for_timeout(150)
    check("tour: Finish closes it and says where to find it again", fp.locator("#tourModal").is_hidden() and "Help" in fp.inner_text("#toast"))
    fp.reload(); wait_ready(fp); fp.wait_for_timeout(300)
    check("tour: doesn't open again on the next visit", fp.locator("#tourModal").is_hidden())
    # What's new: once per version, only what applies to the person's role
    log = json.load(open(os.path.join(DIST, "changelog.json")))
    def count(after, role):
        return sum(1 for v in log["versions"] if [int(n) for n in v["version"].split(".")] > [int(n) for n in after.split(".")]
                   for c in v["changes"] if c["for"] == "everyone" or role == "admin")
    fp.evaluate("localStorage.setItem('halodeck_seen_version', '1.6'); localStorage.removeItem('halodeck_role')"); fp.reload(); wait_ready(fp)
    fp.wait_for_selector("#newsModal:not([hidden])", timeout=5000)
    wn = fp.evaluate("""() => ({title: document.getElementById('newsTitle').textContent, cards: document.querySelectorAll('#newsBody .ncard').length,
        admin: document.querySelectorAll('#newsBody .chip.c-admin').length, vers: [...document.querySelectorAll('.news-ver b')].map(b => b.textContent),
        imgs: [...document.querySelectorAll('#newsBody img')].every(i => i.complete && i.naturalWidth > 0), nimgs: document.querySelectorAll('#newsBody img').length,
        tour: !document.getElementById('tourModal').hidden, log: !document.getElementById('newsLog').hidden})""")
    check("what's new: shown after an update, newest first", wn["title"] == "HaloDeck " + info["version"] and wn["vers"] == [info["version"], "1.7"] and not wn["tour"], wn)
    check("what's new: someone who makes decks sees only changes for everyone", wn["cards"] == count("1.6", "user") and wn["admin"] == 0, (wn["cards"], count("1.6", "user")))
    check("what's new: its pictures load", wn["imgs"] and wn["nimgs"] >= 2, wn["nimgs"])
    check("what's new: no change log button for people who make decks", not wn["log"])
    fp.screenshot(path=f"{SHOTS}/tour_2_whatsnew_user.png")
    # every Show me in What's new rings a real control and comes back
    n_show = fp.locator("#newsBody [data-show]").count(); bad = []
    for i in range(n_show):
        fp.click(f"#newsBody [data-show] >> nth={i}"); fp.wait_for_timeout(150)
        sp = fp.evaluate("""() => { const sp = document.getElementById('spotlight'); if(sp.hidden) return null; const r = sp.querySelector('.spot-ring').getBoundingClientRect();
            return r.width > 8 && r.top >= -8 && r.bottom <= innerHeight + 8 && sp.querySelector('button').textContent.includes("What's new"); }""")
        fp.keyboard.press("Escape"); fp.wait_for_timeout(100)
        if not sp or not fp.locator("#newsModal").is_visible() or not fp.locator("#helpModal").is_hidden(): bad.append(i)
    check("what's new: every Show me rings the control and returns to What's new", n_show >= 2 and not bad, (n_show, bad))
    fp.click("#newsRole [data-switch-role]"); fp.wait_for_timeout(150)
    wa = fp.evaluate("() => ({cards: document.querySelectorAll('#newsBody .ncard').length, admin: document.querySelectorAll('#newsBody .chip.c-admin').length, role: localStorage.getItem('halodeck_role'), log: !document.getElementById('newsLog').hidden})")
    check("what's new: switching to 'I run HaloDeck' adds the admin changes", wa["role"] == "admin" and wa["cards"] == count("1.6", "admin") and wa["admin"] == count("1.6", "admin") - count("1.6", "user") and wa["log"], wa)
    fp.screenshot(path=f"{SHOTS}/tour_2_whatsnew_admin.png")
    fp.click("#newsTour"); fp.wait_for_timeout(100)
    check("what's new: Take the tour opens the welcome", fp.locator('[data-track="users"]').is_visible() and fp.locator("#newsModal").is_hidden())
    fp.keyboard.press("Escape"); fp.wait_for_timeout(100)
    check("tour: Esc closes it", fp.locator("#tourModal").is_hidden())
    fp.reload(); wait_ready(fp); fp.wait_for_timeout(300)
    check("what's new: only once", fp.locator("#newsModal").is_hidden() and fp.locator("#tourModal").is_hidden())
    fp.evaluate("localStorage.setItem('halodeck_seen_version', '1.4'); localStorage.setItem('halodeck_role', 'user')"); fp.reload(); wait_ready(fp)
    fp.wait_for_selector("#newsModal:not([hidden])", timeout=5000)
    vers = fp.evaluate("[...document.querySelectorAll('.news-ver b')].map(b => b.textContent)")
    check("what's new: someone who skipped updates sees each one", vers == [v["version"] for v in log["versions"] if v["version"] in ("1.5", "1.6", "1.7", "1.8")][::-1], vers)
    fp.keyboard.press("Escape"); fp.wait_for_timeout(80)
    check("what's new: Esc closes it", fp.locator("#newsModal").is_hidden())
    roles = fp.evaluate("""() => { const u = HaloDeck.updates;
        const flat = g => g.flatMap(x => x.changes);
        return {userAdmin: flat(u.forRole('user', '1.0')).filter(c => c.for === 'admins').length, adminAdmin: flat(u.forRole('admin', '1.0')).filter(c => c.for === 'admins').length,
                nothing: u.news(HaloDeck.tour.version), hidden: document.getElementById('newsModal').hidden}; }""")
    check("what's new: admin changes only reach admins, and nothing new means no pop-up", roles["userAdmin"] == 0 and roles["adminAdmin"] > 0 and roles["nothing"] is False and roles["hidden"], roles)
    # role in Help
    fp.click("#btnHelp"); fp.wait_for_timeout(300)
    fp.click('#helpRole [data-role="admin"]'); fp.wait_for_timeout(100)
    rp = fp.evaluate("() => [localStorage.getItem('halodeck_role'), document.querySelector('#helpRole [data-role=admin]').getAttribute('aria-checked'), document.querySelector('#helpRole [data-role=user]').getAttribute('aria-checked')]")
    check("help: Your role switches between deck maker and admin", rp == ["admin", "true", "false"], rp)
    fp.click('#helpRole [data-role="user"]'); fp.keyboard.press("Escape")
    fp.goto(URL + "?role=admin"); wait_ready(fp)
    check("role: opening HaloDeck with ?role=admin makes you an admin", fp.evaluate("localStorage.getItem('halodeck_role')") == "admin")
    # the change log (admin page)
    fp.click("#btnHelp"); fp.wait_for_timeout(300); fp.click("#helpLog"); fp.wait_for_timeout(300)
    lg = fp.evaluate("""() => ({open: !document.getElementById('logModal').hidden, help: document.getElementById('helpModal').hidden,
        vers: [...document.querySelectorAll('#logBody .tl-ver')].map(n => n.textContent), now: document.querySelector('#logBody .tl-v.now .tl-ver')?.textContent,
        rows: document.querySelectorAll('#logBody .tl-changes li').length, build: document.querySelector('#logBody .tl-v.now small')?.textContent})""")
    allv = [v["version"] for v in log["versions"]]
    check("change log: opens from Help with every version, oldest first", lg["open"] and lg["help"] and lg["vers"] == allv and lg["now"] == info["version"], lg)
    check("change log: lists every change, with this build on the current version", lg["rows"] == sum(len(v["changes"]) for v in log["versions"]) and app_id in (lg["build"] or ""), (lg["rows"], lg["build"]))
    fp.screenshot(path=f"{SHOTS}/tour_7_changelog.png")
    fp.click('#logFor [data-for="admins"]'); fp.click('#logOrder [data-order="desc"]'); fp.wait_for_timeout(100)
    la = fp.evaluate("() => ({rows: document.querySelectorAll('#logBody .tl-changes li').length, admin: document.querySelectorAll('#logBody .tl-changes .chip.c-admin').length, first: document.querySelector('#logBody .tl-ver').textContent})")
    n_admin = sum(1 for v in log["versions"] for c in v["changes"] if c["for"] == "admins")
    check("change log: filters to admin changes and flips to newest first", la["rows"] == n_admin == la["admin"] and la["first"] == info["version"], la)
    with fp.expect_download() as dl:
        fp.click("#logJson")
    dj = json.loads(open(dl.value.path(), encoding="utf-8").read())
    with fp.expect_download() as dl2:
        fp.click("#logCsv")
    rows = list(__import__("csv").reader(open(dl2.value.path(), encoding="utf-8-sig")))
    check("change log: downloads as JSON and CSV", dl.value.suggested_filename == "halodeck-changelog.json" and [v["version"] for v in dj["versions"]] == allv
          and dj["versions"][-1].get("build") == app_id and len(rows) == 1 + sum(len(v["changes"]) for v in log["versions"]) and rows[0][0] == "version", (len(rows), dl2.value.suggested_filename))
    fp.keyboard.press("Escape"); fp.wait_for_timeout(80)
    check("change log: Esc closes it", fp.locator("#logModal").is_hidden())
    fp.evaluate("HaloDeck.tour.open('admins', 3)"); fp.wait_for_timeout(100)
    check("tour admins: a step on keeping track of changes", "change log" in fp.inner_text("#tourText").lower() and fp.locator("#tourVisual .tlog li").count() >= 3)
    fp.click("[data-open-log]"); fp.wait_for_timeout(200)
    check("tour admins: Open the change log works", fp.locator("#logModal").is_visible() and fp.locator("#tourModal").is_hidden())
    fp.keyboard.press("Escape")
    md = open(os.path.join(DIST, "CHANGELOG.md"), encoding="utf-8").read()
    check("release: changelog.json and CHANGELOG.md are written for this build", log["versions"][-1].get("build") == app_id and f"## {info['version']} ·" in md and "## 1.0 ·" in md)
    sys.path.insert(0, ROOT); import build as B
    broken = []
    for mutate in (lambda d: d["versions"][-1].update(date="2026-01-01"), lambda d: d["versions"][-1]["changes"][0].update(type="feature"),
                   lambda d: d["versions"][-1]["changes"][0].update(**{"for": "managers"}), lambda d: d["versions"].append(dict(d["versions"][0])),
                   lambda d: d["versions"][-1].update(changes=[])):
        d = json.loads(json.dumps(log)); mutate(d)
        try: B.check_changelog(d); broken.append(False)
        except SystemExit: broken.append(True)
    check("release: the build refuses a malformed or out-of-order change log", all(broken), broken)
    # Help: version, tour button, guide check
    fp.click("#btnHelp"); fp.wait_for_timeout(500)
    check("help: shows the version and build", (info["version"] in fp.inner_text("#helpVersion")) and app_id in fp.inner_text("#helpVersion"), fp.inner_text("#helpVersion"))
    check("help: no warning when the guide matches", fp.locator("#helpStale").is_hidden())
    fp.click("#helpTour"); fp.wait_for_timeout(150)
    check("help: Take the tour opens it", fp.locator("#tourModal").is_visible() and fp.locator("#helpModal").is_hidden())
    fp.keyboard.press("Escape")
    fp.keyboard.press("Shift+Slash"); fp.wait_for_timeout(200)
    check("help: the ? key opens Help", fp.locator("#helpModal").is_visible())
    fp.keyboard.press("Escape")
    fp.route("**/guide.html", lambda r: r.fulfill(status=200, body='<!DOCTYPE html><meta charset="utf-8"><meta name="halodeck-build" content="0000000">', headers={"Content-Type":"text/html"}))
    fp.reload(); wait_ready(fp)                                         # Help checks the guide once per visit
    fp.click("#btnHelp"); fp.wait_for_timeout(500)
    check("help: warns when the guide on the site is from another build", fp.locator("#helpStale").is_visible() and "guide.html" in fp.inner_text("#helpStale"), fp.inner_text("#helpStale") if fp.locator("#helpStale").count() else "")
    fp.screenshot(path=f"{SHOTS}/tour_3_help_stale.png")
    fp.keyboard.press("Escape")
    fp.unroute("**/guide.html")
    check("tour: no page errors", not ferr, ferr[:5])
    fctx.close()

    # someone who used HaloDeck before the tour existed (a deck saved, no version seen) gets What's new, not the welcome
    octx = browser.new_context(fresh=True, viewport={"width":1440, "height":900})
    op = octx.new_page(); op.goto(URL); wait_ready(op)
    op.evaluate("""async () => { HaloDeck.doc.slides[0].elements.push({id:'x1', type:'text', x:100, y:100, w:300, h:60, text:'Old work', font:'inter', size:24, color:'#000',
        bold:false, italic:false, align:'left', hl:'#fff', hlOpacity:0, pad:8, rot:0, opacity:1, locked:false, hidden:false}); await HaloDeck.saveNow(); }""")
    op.evaluate("localStorage.removeItem('halodeck_seen_version')"); op.reload(); wait_ready(op)
    op.wait_for_selector("#newsModal:not([hidden])", timeout=5000)
    check("tour: existing users get What's new (this version only) instead of the welcome", op.locator("#tourModal").is_hidden() and op.locator(".news-ver").count() == 0
          and op.locator("#newsBody .ncard").count() == count(log["versions"][-2]["version"], "user"))
    octx.close()

    # moving to a new address: a notice at the old one, a pointer at the new one
    OLD, NEW = "https://jtg-tools.jtgworkspace.com/halo-deck/", "https://jtg-tools.mkcworkspace.com/halo-deck/"
    def as_site(route):
        path = route.request.url.split("/halo-deck/", 1)[1].split("?")[0] or "index.html"
        f = os.path.join(DIST, path)
        if not os.path.isfile(f): return route.fulfill(status=404, body="nf")
        route.fulfill(status=200, body=open(f, "rb").read(), headers={"Content-Type": "text/html" if f.endswith(".html") else "application/octet-stream"})
    mvctx = browser.new_context(viewport={"width":1440, "height":900}, accept_downloads=True)
    mvctx.route("https://jtg-tools.jtgworkspace.com/**", as_site); mvctx.route("https://jtg-tools.mkcworkspace.com/**", as_site)
    mv = mvctx.new_page(); mverr = []; mv.on("pageerror", lambda e: mverr.append(str(e)))
    mv.goto(OLD); wait_ready(mv)
    check("move: the old address shows the moving notice", mv.locator("#moveBanner").is_visible() and "jtg-tools.mkcworkspace.com" in mv.inner_text("#moveBanner")
          and mv.get_attribute("#moveGo", "href") == NEW)
    with mv.expect_download() as dl:
        mv.click("#moveSave")
    check("move: Save project from the notice downloads the deck", dl.value.suggested_filename.endswith(".json"))
    mv.click("#moveClose"); mv.reload(); wait_ready(mv)
    check("move: hiding it lasts for the visit", mv.locator("#moveBanner").is_hidden())
    mv.screenshot(path=f"{SHOTS}/move_1_old.png")
    nctx = browser.new_context(fresh=True, viewport={"width":1440, "height":900})
    nctx.route("https://jtg-tools.mkcworkspace.com/**", as_site)
    nv = nctx.new_page(); nv.goto(NEW); wait_ready(nv)
    nv.wait_for_selector("#tourModal:not([hidden])", timeout=5000)
    check("move: the welcome at the new address explains how to bring a deck over", "jtg-tools.jtgworkspace.com" in nv.inner_text("#tourText")
          and nv.locator("[data-open-project]").is_visible() and nv.locator("#moveBanner").is_hidden())
    nv.screenshot(path=f"{SHOTS}/move_2_new.png")
    nctx.close()
    lp0 = mvctx.new_page(); lp0.goto(URL); wait_ready(lp0)
    check("move: no notice at any other address", lp0.locator("#moveBanner").is_hidden())
    check("move: no page errors", not mverr, mverr[:3])
    mvctx.close()

    # phone: the tour and Show me work with the compact layout
    pctx = browser.new_context(fresh=True, viewport={"width":390, "height":844}, device_scale_factor=3, is_mobile=True, has_touch=True)
    pp = pctx.new_page(); perr = []
    pp.on("pageerror", lambda e: perr.append(str(e)))
    pp.goto(URL); wait_ready(pp)
    pp.wait_for_selector("#tourModal:not([hidden])", timeout=5000)
    fit = pp.evaluate("(() => { const r = document.querySelector('#tourModal .tour').getBoundingClientRect(), b = document.getElementById('tourNext').getBoundingClientRect(); return [r.left >= 0, r.right <= innerWidth + 1, b.bottom <= innerHeight + 1, document.documentElement.scrollWidth <= innerWidth]; })()")
    check("tour phone: the welcome fits the screen", all(fit), fit)
    pp.screenshot(path=f"{SHOTS}/tour_4_phone_welcome.png")
    pp.tap('[data-track="users"]'); pp.wait_for_timeout(150)
    pp.evaluate("HaloDeck.tour.open('users', 2)"); pp.wait_for_timeout(100)
    pp.screenshot(path=f"{SHOTS}/tour_5_phone_step.png")
    pp.tap("#tourShow"); pp.wait_for_timeout(200)
    pp.screenshot(path=f"{SHOTS}/tour_6_phone_showme.png")
    check("tour phone: Show me points at More when Open isn't on screen", "More" in pp.inner_text("#spotlight .spot-tip"), pp.inner_text("#spotlight .spot-tip"))
    pp.tap("#spotlight .spot-tip button"); pp.wait_for_timeout(100)
    walk_track(pp, "users", "phone users")
    walk_track(pp, "admins", "phone admins")
    pp.evaluate("localStorage.setItem('halodeck_role', 'admin'); HaloDeck.updates.news('1.6')"); pp.wait_for_timeout(200)
    def fits(sel, btn):
        return pp.evaluate("([s, b]) => { const r = document.querySelector(s).getBoundingClientRect(), k = document.querySelector(b).getBoundingClientRect(); return [r.left >= 0, r.right <= innerWidth + 1, k.bottom <= innerHeight + 1, document.documentElement.scrollWidth <= innerWidth]; }", [sel, btn])
    f1 = fits("#newsModal .modal", "#newsOk")
    check("what's new phone: fits the screen", all(f1), f1)
    pp.screenshot(path=f"{SHOTS}/tour_8_phone_news.png")
    pp.tap("#newsLog"); pp.wait_for_timeout(250)
    f2 = fits("#logModal .modal", "#logClose")
    check("change log phone: fits the screen", all(f2), f2)
    pp.screenshot(path=f"{SHOTS}/tour_9_phone_log.png")
    pp.tap("#logClose"); pp.wait_for_timeout(100)
    pp.tap("#btnMore"); pp.wait_for_timeout(150)
    check("change log phone: in the More menu", pp.locator('#menuMore [data-act="log"]').is_visible())
    pp.tap('#menuMore [data-act="log"]'); pp.wait_for_timeout(200)
    check("change log phone: More → Change log opens it", pp.locator("#logModal").is_visible())
    pp.tap("#logClose")
    check("tour phone: no page errors", not perr, perr[:5])
    pctx.close()

    # ------------------------------------------------------------ tablet
    tctx = browser.new_context(viewport={"width":820, "height":1180}, is_mobile=True, has_touch=True)
    tp = tctx.new_page(); tp.goto(URL); wait_ready(tp)
    tp.screenshot(path=f"{SHOTS}/t_tablet.png")
    tctx.close()

    # ------------------------------------------------------------ migration from the previous version
    v1 = {"title":"Old deck", "currentSlideIdx":0, "slides":[{"id":"s1", "bg":"#ffffff", "bgImage":"", "notes":"old note", "elements":[
        {"id":"el1", "type":"text", "x":10, "y":10, "w":30, "h":10, "rot":0, "opacity":1, "text":"Legacy text", "fontFamily":"Georgia, 'Times New Roman', serif", "fontSize":4, "color":"#112233", "bold":True, "italic":False, "align":"center", "bg":"#F2A93B", "bgOpacity":0, "padding":0.8},
        {"id":"el2", "type":"shape", "shape":"ellipse", "x":50, "y":50, "w":20, "h":20, "rot":0, "opacity":1, "stroke":"#F2A93B", "strokeWidth":0.6, "fill":"#F2A93B", "fillOpacity":0.12, "radius":6},
        {"id":"el3", "type":"shape", "shape":"arrow", "x1":10, "y1":90, "x2":40, "y2":60, "opacity":1, "stroke":"#F2A93B", "strokeWidth":0.55}]}]}
    lctx = browser.new_context(viewport={"width":1280, "height":800})
    lctx.add_init_script("localStorage.setItem('halodeck_project_v1', %s)" % json.dumps(json.dumps(v1)))
    lp = lctx.new_page(); lerr = []
    lp.on("pageerror", lambda e: lerr.append(str(e)))
    lp.goto(URL); wait_ready(lp)
    le = els(lp)
    ok = (len(le) == 3 and le[0]["text"] == "Legacy text" and le[0]["font"] == "georgia" and abs(le[0]["x"] - 128) < 0.01
          and abs(le[0]["size"] - 51.2) < 0.01 and le[1]["shape"] == "ellipse" and abs(le[1]["w"] - 256) < 0.01 and le[2]["type"] == "arrow"
          and abs(le[2]["y1"] - 648) < 0.01)
    check("migration: decks from the previous version load with geometry intact", ok, le)
    check("migration: no errors", not lerr, lerr)
    lp.screenshot(path=f"{SHOTS}/l_migrated.png")
    lctx.close()
    browser.close()

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
sys.exit(1 if fails else 0)
