#!/usr/bin/env python3
"""Build HaloDeck: dist/index.html (the app, with its getting-started tour) and dist/guide.html (the guide).

  python3 build.py           the release build. Builds the app, photographs it in a headless browser,
                             puts those screenshots into the tour and the guide, and stamps all of it
                             with one build id. Run dev_setup.py once beforehand.
  python3 build.py --quick   the app only, reusing the last screenshots (for quick checks while editing)
  python3 build.py --publish the release build, then copies the four release files into the folder above
                             this one (when this source sits in the site's halo-deck/source folder)

Because every release build re-takes the screenshots from the app it has just built, the tour and the
guide can't show an older version than the one being shipped.

The change log, src/changelog.json, is the record of every version (oldest first). Each update adds an entry at
the end; the version number is read from it. The build stops with an error if an entry is missing a date, title
or changes, if a change's type or audience isn't one of the listed ones, if versions or dates go backwards, or if
a tour step or change points at a screenshot that wasn't taken. Besides index.html and guide.html it writes
changelog.json (stamped with this build's id) and CHANGELOG.md, to publish next to the app."""
import base64, datetime, hashlib, io, json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).parent
SRC, DIST, GUIDE = ROOT / "src", ROOT / "dist", ROOT / "guide_src"
SHOTS = GUIDE / "shots"
RELEASE_FILES = ["index.html", "guide.html", "changelog.json", "CHANGELOG.md"]   # what goes online, side by side

FAVICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E"
           "%3Crect width='64' height='64' rx='14' fill='%231C1B1A'/%3E"
           "%3Crect x='9' y='14' width='35' height='25' rx='3.5' fill='%23EDE7DD'/%3E"
           "%3Ccircle cx='43' cy='42' r='13' fill='none' stroke='%23F2A93B' stroke-width='4.5'/%3E"
           "%3Ccircle cx='43' cy='42' r='4' fill='%23F2A93B'/%3E%3C/svg%3E")

def js_string(text):
    # JSON is valid JS; also keep "</script>" from closing the editor's own <script>.
    return json.dumps(text).replace("</", "<\\/")

def fail(msg):
    sys.exit("BUILD STOPPED: " + msg)

def vkey(v):
    return tuple(int(x) for x in v.split("."))

def load_changelog():
    """read and check src/changelog.json; returns it unchanged"""
    try:
        log = json.loads((SRC / "changelog.json").read_text())
    except ValueError as e:
        fail(f"src/changelog.json isn't valid JSON: {e}")
    return check_changelog(log)

def check_changelog(log):
    types, auds, vs = log.get("types", {}), log.get("audiences", {}), log.get("versions", [])
    if not vs: fail("src/changelog.json has no versions.")
    prev = None
    for v in vs:
        where = f'version {v.get("version", "?")} in src/changelog.json'
        if not re.fullmatch(r"\d+(\.\d+)+", str(v.get("version", ""))): fail(f'{where}: "version" must look like 1.8')
        for k in ("date", "live"):
            if k in v and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(v[k])): fail(f'{where}: "{k}" must be a date like 2026-11-20')
        if "date" not in v: fail(f'{where}: add the "date" it was made')
        if not str(v.get("title", "")).strip(): fail(f'{where}: add a short "title"')
        if not v.get("changes"): fail(f'{where}: list at least one change')
        if v.get("live") and v["live"] < v["date"]: fail(f'{where}: "live" can\'t be before "date"')
        for c in v["changes"]:
            if c.get("type") not in types: fail(f'{where}: change "{c.get("title")}" has type "{c.get("type")}"; use one of {", ".join(types)}')
            if c.get("for") not in auds: fail(f'{where}: change "{c.get("title")}" is for "{c.get("for")}"; use one of {", ".join(auds)}')
            if not str(c.get("title", "")).strip() or not str(c.get("text", "")).strip(): fail(f'{where}: every change needs a "title" and a "text"')
            if "show" in c and not (isinstance(c["show"], list) and all(isinstance(x, str) for x in c["show"])): fail(f'{where}: "show" must be a list of selectors')
        if prev:
            if vkey(v["version"]) <= vkey(prev["version"]): fail(f'{where}: versions must go up, oldest first (it comes after {prev["version"]})')
            if v["date"] < prev["date"]: fail(f'{where}: its date is before the version above it')
        prev = v
    return log

def version_info():
    log = load_changelog()
    v = log["versions"][-1]["version"]
    h = hashlib.sha256()
    for f in sorted(list(SRC.glob("*")) + [GUIDE / "guide.template.html", GUIDE / "figs.json", GUIDE / "capture.py", GUIDE / "sample_pages.py"]):
        h.update(f.name.encode()); h.update(f.read_bytes())
    return v, h.hexdigest()[:7], datetime.date.today().isoformat(), log

def tour_shot_names(log):
    """every screenshot the tour (shot:"..." in tour.js) and What's new (the change log) use, plus the welcome's"""
    names = set(re.findall(r'shot:"(\w+)"', (SRC / "tour.js").read_text())) | {"workspace"}
    names |= {c["shot"] for v in log["versions"] for c in v["changes"] if c.get("shot")}
    return sorted(names)

def tour_shots(names, required=True):
    """screenshots for the tour, made smaller than the guide's: the tour lives inside index.html"""
    from PIL import Image
    meta = json.loads((SHOTS / "shots.json").read_text()) if (SHOTS / "shots.json").exists() else {}
    out = {}
    for n in names:
        f = SHOTS / f"{n}.webp"
        if n not in meta or not f.exists():
            if required:
                fail(f'the tour uses screenshot "{n}", but capture.py didn\'t take it.')
            continue
        im = Image.open(f).convert("RGB")
        limit = 620 if im.width / im.height < 0.8 else 980
        if im.width > limit:
            im = im.resize((limit, round(im.height * limit / im.width)), Image.LANCZOS)
        b = io.BytesIO(); im.save(b, "WEBP", quality=74, method=6)
        out[n] = {"src": "data:image/webp;base64," + base64.b64encode(b.getvalue()).decode(), "w": im.width, "h": im.height, "marks": meta[n]["marks"]}
    return out

def stamped(log, build):
    """the change log with this build's id on the newest version"""
    out = json.loads(json.dumps(log))
    if build["id"] != "dev": out["versions"][-1]["build"] = build["id"]
    return out

def changelog_md(log):
    t, a = log["types"], log["audiences"]
    def day(d):
        y, m, dd = d.split("-"); return f'{["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][int(m) - 1]} {int(dd)}, {y}'
    out = [f'# {log["product"]} change log', "", log["about"], "",
           "Each change says who it affects: " + "; ".join(f"**{k}**: {v}" for k, v in a.items()) + ".", ""]
    for v in log["versions"]:
        out += [f'## {v["version"]} · {v["title"]}', ""]
        meta = [day(v["date"])] + ([f'live {day(v["live"])}'] if v.get("live") and v["live"] != v["date"] else []) + ([f'build {v["build"]}'] if v.get("build") else [])
        out += ["_" + " · ".join(meta) + "_", ""]
        if v.get("note"): out += [f'> {v["note"]}', ""]
        for c in v["changes"]:
            out.append(f'- **{t[c["type"]]}**' + (" · _Admins_" if c["for"] == "admins" else "") + f' · {c["title"]}: {c["text"]}')
        out.append("")
    return "\n".join(out)

def write_release_files(log):
    (DIST / "changelog.json").write_text(json.dumps(log, ensure_ascii=False, indent=1) + "\n")
    (DIST / "CHANGELOG.md").write_text(changelog_md(log))

def write_app(build, shots, log):
    css = (SRC / "style.css").read_text()
    body = (SRC / "body.html").read_text()
    app = (SRC / "app.js").read_text()
    app = app.replace("/*@TOUR_JS@*/", (SRC / "tour.js").read_text() + "\n" + (SRC / "updates.js").read_text())
    app = app.replace('/*@CHANGELOG@*/{"versions":[{"version":"0", "date":"", "title":"", "changes":[]}]}',
                      json.dumps(stamped(log, build), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/"))
    app = app.replace('/*@VIEWER_CSS@*/""', js_string((SRC / "viewer.css").read_text()))
    app = app.replace('/*@VIEWER_JS@*/""', js_string((SRC / "viewer.js").read_text()))
    app = app.replace('/*@BUILD@*/{"id":"dev", "date":""}', json.dumps(build))
    app = app.replace("/*@TOUR_SHOTS@*/{}", json.dumps(shots, separators=(",", ":")))
    assert "/*@" not in app, re.findall(r"/\*@\w+@\*/", app)
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="halodeck-build" content="{build['id']}">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<title>HaloDeck — slide &amp; annotation designer</title>
<meta name="description" content="Design annotated slides — images, text, circles and arrows — and export them as one self-contained HTML file or as images.">
<meta name="theme-color" content="#201E1B">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<link rel="icon" type="image/svg+xml" href="{FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&family=Inter:ital,wght@0,400;0,500;0,600;0,700;1,400;1,700&family=JetBrains+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap">
<style>
{css}</style>
</head>
<body>
{body}
<script>
{app}</script>
</body>
</html>
"""
    DIST.mkdir(exist_ok=True)
    (DIST / "index.html").write_text(html)
    return len(html.encode())

def capture(phase):
    r = subprocess.run([sys.executable, str(GUIDE / "capture.py"), phase])
    if r.returncode: fail(f"taking the {phase} screenshots failed (see above).")

def main():
    quick = "--quick" in sys.argv
    v, h, day, log = version_info()
    names = tour_shot_names(log)
    if quick:
        size = write_app({"id": "dev", "date": "", "version": v}, tour_shots(names, required=False), log)
        print(f"quick build: dist/index.html ({size:,} bytes), last screenshots reused, guide not rebuilt")
        return
    build = {"id": h, "date": day, "version": v}
    write_app(build, {}, log)                        # 1. the app, so it can be photographed
    capture("app")                                   # 2. screenshots of the editor, menus, dialogs, panels
    size = write_app(build, tour_shots(names), log)  # 3. the final app, with those screenshots in its tour
    capture("tour")                                  # 4. screenshots of the tour itself, for the guide
    sys.path.insert(0, str(GUIDE))
    import build_guide
    final = stamped(log, build)
    gsize = build_guide.build(build, final)          # 5. the guide, from the same screenshots and change log
    write_release_files(final)                       # 6. changelog.json and CHANGELOG.md
    print(f"\nHaloDeck {v} · build {h} · {day}\n  dist/index.html {size:,} bytes\n  dist/guide.html {gsize:,} bytes"
          f"\n  dist/changelog.json, dist/CHANGELOG.md ({len(log['versions'])} versions)")
    if "--publish" in sys.argv:
        site = ROOT.parent
        if ROOT.name != "source" or not (site / "index.html").exists():
            fail("--publish copies into the folder above this one, which should be the site's halo-deck folder (with this source in halo-deck/source).")
        import shutil
        for n in RELEASE_FILES: shutil.copy2(DIST / n, site / n)
        print(f"  copied {', '.join(RELEASE_FILES)} to {site}")

if __name__ == "__main__":
    main()
