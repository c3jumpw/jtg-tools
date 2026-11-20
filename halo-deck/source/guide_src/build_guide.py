"""Assemble dist/guide.html from guide.template.html, figs.json (each screenshot's caption and key) and the
screenshots capture.py took. Called by build.py on every release build, with the same build id as the app."""
import base64, html, json, re
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
SHOTS = HERE / "shots"
FAVICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%231C1B1A'/%3E"
           "%3Crect x='9' y='14' width='35' height='25' rx='3.5' fill='%23EDE7DD'/%3E%3Ccircle cx='43' cy='42' r='13' fill='none' stroke='%23F2A93B' stroke-width='4.5'/%3E"
           "%3Ccircle cx='43' cy='42' r='4' fill='%23F2A93B'/%3E%3C/svg%3E")

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
def day(d):
    y, m, dd = d.split("-"); return f"{MONTHS[int(m) - 1]} {int(dd)}, {y}"

def changelog_html(log, icon):
    """the change log as a timeline, oldest first, the same data the app shows"""
    ic = {"new": "spark", "improved": "trend", "fixed": "wrench", "changed": "swap", "removed": "minusCircle"}
    e = html.escape
    rows = []
    for v in log["versions"]:
        now = v is log["versions"][-1]
        meta = [day(v["date"])] + ([f'live {day(v["live"])}'] if v.get("live") and v["live"] != v["date"] else []) + ([f'build {v["build"]}'] if v.get("build") else [])
        items = "".join(
            f'<li><span class="clog-tags"><span class="chip c-{c["type"]}">{icon(ic[c["type"]])}{e(log["types"][c["type"]])}</span>'
            + (f'<span class="chip c-admin">{icon("shield")}Admins</span>' if c["for"] == "admins" else "")
            + f'</span><span><b>{e(c["title"])}</b> {e(c["text"])}</span></li>' for c in v["changes"])
        rows.append(f'<li class="clog-v{" now" if now else ""}"><span class="clog-dot"></span><div class="clog-card"><div class="clog-head">'
                    f'<span class="clog-ver">{e(v["version"])}</span><span><b>{e(v["title"])}</b><small>{e(" · ".join(meta))}</small></span></div>'
                    + (f'<p class="clog-note">{e(v["note"])}</p>' if v.get("note") else "") + f'<ul>{items}</ul></div></li>')
    return '<ol class="clog">' + "".join(rows) + "</ol>"

def build(info, log):
    meta = json.loads((SHOTS / "shots.json").read_text())
    figs = json.loads((HERE / "figs.json").read_text())
    # the app's own icons, so the guide shows exactly the symbols people see in HaloDeck
    src = (ROOT / "src" / "app.js").read_text()
    block = src[src.index("const ICONS = {"):src.index("};", src.index("const ICONS = {"))]
    icons = dict(re.findall(r"^\s*(\w+):'(.*)',?\s*$", block, re.M))
    def icon(name):
        return ('<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
                'stroke-linejoin="round" aria-hidden="true">%s</svg>' % icons[name])
    def fig(name):
        f, m = figs[name], meta.get(name)
        if not m: raise SystemExit(f'BUILD STOPPED: the guide uses screenshot "{name}", but capture.py didn\'t take it.')
        b64 = base64.b64encode((SHOTS / f"{name}.webp").read_bytes()).decode()
        pins = "".join(f'<span class="pin" style="left:{p["x"]}%;top:{p["y"]}%" aria-hidden="true">{p["n"]}</span>' for p in m["marks"])
        img = f'<img src="data:image/webp;base64,{b64}" width="{m["w"]}" height="{m["h"]}" alt="{html.escape(f["alt"])}">'
        leg = ""
        if f.get("legend"):
            nums = [p["n"] for p in m["marks"]]
            if len(nums) != len(f["legend"]):
                raise SystemExit(f'BUILD STOPPED: screenshot "{name}" has {len(nums)} markers but figs.json explains {len(f["legend"])}.')
            leg = '<ol class="legend">' + "".join(f'<li><span class="pin sm">{n}</span><span>{t}</span></li>' for n, t in zip(nums, f["legend"])) + "</ol>"
        cap = f'<figcaption>{f["caption"]}</figcaption>' if f.get("caption") else ""
        return (f'<figure class="shot shot-{f["layout"]}" id="fig-{name}"><div class="frame" style="--cssw:{m["cssw"]}px">{img}{pins}</div>{cap}{leg}</figure>')
    tpl = (HERE / "guide.template.html").read_text()
    out = re.sub(r"\{\{fig:(\w+)\}\}", lambda mm: fig(mm.group(1)), tpl)
    out = out.replace("{{changelog}}", changelog_html(log, icon))
    out = out.replace("{{changelog:count}}", str(len(log["versions"]))).replace("{{changelog:first}}", day(log["versions"][0]["date"]))
    out = re.sub(r"\{\{icon:(\w+)\}\}", lambda mm: icon(mm.group(1)), out)
    out = re.sub(r"\{\{build:(\w+)\}\}", lambda mm: html.escape(str(info[mm.group(1)])), out)
    assert "{{" not in out, re.findall(r"\{\{[^}]*\}\}", out)[:5]
    head, body = out.split("<!--BODY-->")
    head = head.replace("<!--HEAD-->", "").strip()
    # 1) the copy that sits next to index.html; the build id near the top lets the app check they match
    full = ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            f'<meta name="halodeck-build" content="{info["id"]}">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            f'<link rel="icon" type="image/svg+xml" href="{FAVICON}">\n' + head + "\n</head>\n<body>\n" + body.strip() + "\n</body>\n</html>\n")
    (ROOT / "dist" / "guide.html").write_text(full)
    # 2) the same page as a shareable artifact (the host adds its own document skeleton)
    art = HERE / "artifact" / "halodeck-guide.html"
    art.parent.mkdir(exist_ok=True)
    art.write_text(head + "\n" + body.strip() + "\n")
    return len(full.encode())
