/* ============================================================ getting-started tour
   A step-by-step walkthrough with screenshots, in two tracks: making decks (everyone) and running
   HaloDeck for others (admins). The screenshots are taken from this exact version: every full build
   photographs the app it has just built and embeds the pictures here, so the tour can't fall behind.
   "Show me" lights up the real control on screen. After an update, returning users see What's new once. */
// The change log (src/changelog.json, oldest first) is the single record of every version. The build checks it,
// stamps this build's id on the newest entry and puts it here; the version number is the newest entry's.
const CHANGELOG = /*@CHANGELOG@*/{"versions":[{"version":"0", "date":"", "title":"", "changes":[]}]};
const VERSIONS = CHANGELOG.versions;
const APP_VERSION = VERSIONS[VERSIONS.length - 1].version;
const BUILD = /*@BUILD@*/{"id":"dev", "date":""};
const TOUR_SHOTS = /*@TOUR_SHOTS@*/{};

const TOUR = {
  users:{label:"Making decks", steps:[
    {title:"Your workspace", lead:"Everything happens on one screen. Here's what's where.", shot:"workspace",
      points:["<b>Top bar</b>: tools, Paste, Open, Save project and Export", "<b>Slides</b>: click one to open it, drag to reorder",
        "<b>The slide</b>: everything you add sits on top as its own layer", "<b>Floating toolbar</b> for whatever you select",
        "<b>Properties, Layers and Slide</b> settings", "Previous / next slide, zoom and <b>FIT</b>"]},
    {title:"Bring a picture in", lead:"Start from a screenshot, a picture or some text.", shot:"topbar_left", pins:[[8,1],[7,2]],
      points:["<b>Paste</b> whatever you copied: a screenshot, a picture from a website, text, or a layer", "<b>Insert images</b> from your computer"],
      tips:["Or drag files onto the slide. Each picture becomes its own layer.", "Drop pictures on the Slides list to give each one its own slide."],
      show:["#btnPaste", "#btnMore"], showLabel:"Show me Paste",
      showTips:["Click Paste, or press Ctrl+V (⌘V on a Mac).", "Paste is under More on this screen."]},
    {title:"Turn a PDF or photos into slides", lead:"Open ▾ → PDF… makes one slide per page, sized to match, so nothing is cropped.", shot:"dialog_pdf",
      points:["<b>Pages</b>: all, or a list like 1-3, 7", "<b>Slide size</b>: match the PDF, or fit pages into this deck", "A <b>new deck</b> or <b>this deck</b>",
        "<b>Copy each page's text into its notes</b>, so the words stay readable in HTML exports"],
      tips:["Open ▾ → Photos… does the same for a batch of photos, one slide each."],
      show:["#btnOpen", "#btnMore"], showLabel:"Show me Open",
      showTips:["Click Open, then choose PDF… or Photos…", "Tap More, then Open PDF as slides… or Photos as slides…"]},
    {title:"Mark it up", lead:"Circle, Rectangle and Arrow draw straight on top of the picture.", shot:"drawing",
      points:["Drag over the spot. Hold <kbd>Shift</kbd> for a perfect circle."],
      tips:["Keys: <kbd>O</kbd> circle, <kbd>R</kbd> rectangle, <kbd>A</kbd> arrow, <kbd>T</kbd> text, <kbd>V</kbd> select.",
        "The tool stays on so you can mark several things. Press <kbd>Esc</kbd> or <kbd>V</kbd> when you're done.",
        "A single click drops a ready-made circle, or an arrow pointing at the spot."],
      show:["#tools", "#dock"], showLabel:"Show me the tools",
      showTips:["Circle, Rectangle and Arrow are here, next to Select and Text.", "The tools are along the bottom of the screen."]},
    {title:"Select, move and resize", lead:"Click something to select it, drag to move it.", shot:"selected",
      points:["Drag a square handle to <b>resize</b>", "Drag the round handle to <b>rotate</b> (<kbd>Shift</kbd> snaps to 15°)", "The <b>floating toolbar</b>: duplicate, front, back, lock, delete"],
      tips:["Hollow circles and boxes only catch clicks on their outline, so whatever is inside stays clickable.",
        "Arrow keys nudge by 1px, with <kbd>Shift</kbd> by 10."]},
    {title:"Add labels and notes", lead:"Short labels go on the slide; longer commentary goes in the notes.", shot:"editing",
      points:["Click into any text box to type. The cursor lands where you click."],
      tips:["<b>Text</b> tool (<kbd>T</kbd>): click on the slide and type.", "Text hidden under a picture? Double-click it.",
        "Slide notes are exported as real text under each slide."],
      show:['[data-tool="text"]'], showLabel:"Show me the Text tool",
      showTips:["Pick Text, then click on the slide where the label should go."]},
    {title:"Right-click for more", lead:"Right-click on the slide, or touch and hold on a phone or tablet.", shot:"ctxmenu_layer",
      tips:["On a layer: edit text, cut, copy, paste, duplicate, arrange, lock, delete.", "On empty space: <b>Paste here</b> drops what you copied right where you clicked."]},
    {title:"Style it", lead:"Select something and its settings appear under Properties.", shot:"panel_style",
      points:["<b>Text</b>: type here if that's easier", "<b>Font</b> and <b>size</b>", "<b>Bold</b>, <i>italic</i> and alignment", "<b>Background behind text</b>, for labels over busy screenshots"],
      tips:["Shapes, arrows and pictures each get their own settings: color, outline, fill, frame and more."],
      show:["#secStyle", "#btnPanel"], showLabel:"Show me Properties",
      showTips:["Properties change to fit whatever you select.", "Open Layers & style to see Properties."]},
    {title:"Layers", lead:"Every picture, shape and text box is a layer. The top layer is listed first.", shot:"panel_layers",
      points:["Drag to <b>reorder</b>", "<b>Edit</b> a text layer", "<b>Hide</b> or show", "<b>Lock</b>: it can't be moved, and clicks pass through to what's underneath", "<b>Delete</b>"],
      tips:["Click a row to select a layer that's hard to click on the slide."],
      show:["#secLayers", "#btnPanel"], showLabel:"Show me Layers",
      showTips:["One row per layer, top layer first.", "Open Layers & style to see the layers."]},
    {title:"Slides and page size", lead:"Slide settings sit under Layers.", shot:"panel_slide",
      points:["<b>Page size</b> for every slide: 16:9, 4:3, square, 9:16, 4:5, A4, US Letter", "<b>Background</b> color", "<b>Background image</b>",
        "<b>Notes</b>, exported as text", "Put the notes <b>on the slide</b> as a text box"],
      tips:["Add, duplicate, delete and reorder slides in the Slides list on the left."],
      show:["#secSlide", "#btnPanel"], showLabel:"Show me Slide settings",
      showTips:["Page size, background and notes for the slide you're on.", "Open Layers & style, then the Slide tab."]},
    {title:"Export", lead:"Export ▾ → HTML, PNG or PDF, then choose which slides go out.", shot:"dialog_export",
      points:["<b>HTML</b>, <b>PNG</b> or <b>PDF</b>", "Options for that format", "<b>All</b>, <b>Current</b> or <b>Clear</b>",
        "<b>Custom</b>: type slide numbers like 1-3, 5", "Or click slides to pick them", "The button says exactly what you'll get"],
      show:["#btnExport", "#btnMore"], showLabel:"Show me Export",
      showTips:["Click Export, then HTML, PNG or PDF.", "Export is under More on this screen."]},
    {title:"Share it, keep it", lead:"An exported HTML deck opens in any browser, on its own.", shot:"viewer",
      points:["Previous / next: arrow keys, swiping or clicking work too", "<b>All slides</b> on one page", "<b>Full screen</b> for presenting", "Your <b>notes</b>, as real text"],
      tips:["Your deck saves itself in this browser. <b>Save project</b> (<kbd>Ctrl</kbd>+<kbd>S</kbd>) downloads a copy for backup or another computer."],
      show:["#btnSave", "#btnMore"], showLabel:"Show me Save project",
      showTips:["Downloads an editable copy of this deck.", "Save project is under More on this screen."]},
    {title:"On a phone or tablet", lead:"Same tools, arranged for touch.", shot:"phone_editor",
      points:["<b>Slides</b>", "<b>More</b>: Paste, Open, Save project, Help", "<b>Tools</b> along the bottom, then Layers &amp; style"],
      tips:["Tap to select, tap selected text again to type.", "Pinch to zoom. Touch and hold for the right-click menu."]},
    {title:"Help is always here", lead:"You've seen the essentials. Here's where to find them again.", shot:"help_panel",
      tips:["The <b>?</b> button (or the <kbd>?</kbd> key) opens a quick reference, this tour and the full illustrated guide.",
        "New to an update? What's new appears once, the first time you open it."],
      show:["#btnHelp", "#btnMore"], showLabel:"Show me Help",
      showTips:["Quick reference, this tour and the illustrated guide.", "Help & guide is under More on this screen."]},
  ]},
  admins:{label:"Running HaloDeck", steps:[
    {title:"What an admin does here", lead:"HaloDeck has no server, accounts or admin console. The admin puts two files online and keeps them current.", visual:"map",
      tips:["Each person's decks stay in their own browser. Nothing is uploaded anywhere.", "You support people when something goes wrong: the guide's admin part covers the usual problems."]},
    {title:"Put it online", lead:"Any static web host works. On GitHub Pages it takes a few minutes.", visual:"files",
      points:["Create a GitHub repository", "Upload <code>index.html</code> and <code>guide.html</code> to its top level",
        "<b>Settings → Pages</b>: deploy from the <code>main</code> branch, <code>/ (root)</code>", "Open the address GitHub shows and check it loads"]},
    {title:"Release an update", lead:"Every update comes as a matching index.html and guide.html. Upload both.", visual:"release",
      tips:["People get the new version the next time they open or refresh HaloDeck. Their decks aren't touched.",
        "What's new appears once, showing each person only the changes that apply to their role. This tour's screenshots always match the version, because they're built into it.",
        "If the guide on the site doesn't match the app, Help says so to everyone, so a forgotten upload gets noticed."]},
    {title:"Keep track of changes", lead:"The change log lists every version since the first, oldest first: what changed, when, and who it affects.", visual:"changelog",
      tips:["Filter it to admin changes, or download it as JSON or CSV to keep with your records.",
        "It's also published next to the app as <code>changelog.json</code> and <code>CHANGELOG.md</code>.",
        "Every update adds an entry. A new version can't be built without one."], action:"log"},
    {title:"Where decks are stored", lead:"In each person's browser, for that computer and that web address only.", visual:"storage",
      tips:["Clearing browsing data or using a private window loses the autosaved deck. Project files are the backup.",
        "<b>Changing the site's address strands autosaved decks.</b> Renaming the repository or moving to a custom domain counts. Have everyone use Save project first."]},
    {title:"Network and privacy", lead:"Three kinds of addresses are used. Only the first is essential.", visual:"network",
      tips:["No analytics, no tracking, no uploads.", "An exported HTML file contains its pictures and an editable copy of its slides. Treat it like any document you send."]},
    {title:"Roll it out", lead:"A short checklist for your team.", visual:"checklist",
      tips:["The illustrated guide's admin part has the details: hosting, data, limits and troubleshooting."], guide:"guide.html#admins"},
  ]},
};

const tourModal = $("#tourModal"), spotlight = $("#spotlight");
const tour = {track:null, i:0};
function cmpVer(a, b){
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for(let k = 0; k < Math.max(pa.length, pb.length); k++){ const d = (pa[k] || 0) - (pb[k] || 0); if(d) return d < 0 ? -1 : 1; }
  return 0;
}
const buildLine = () => "HaloDeck " + APP_VERSION + (BUILD.id && BUILD.id !== "dev" ? " · build " + BUILD.id : "") + (BUILD.date ? " · " + BUILD.date : "");
function markSeen(){ try{ localStorage.setItem("halodeck_seen_version", APP_VERSION); }catch(_){} }

function shotHtml(name, pins){
  const s = TOUR_SHOTS[name];
  if(!s) return '<div class="tv-missing">' + icon("image") + "<span>Screenshot not included in this build</span></div>";
  const marks = pins ? pins.map(([from, to]) => { const m = s.marks.find(k => k.n === from); return m ? {n:to, x:m.x, y:m.y} : null; }).filter(Boolean) : s.marks;
  return '<div class="tv-frame' + (s.w / s.h < 0.8 ? " tall" : s.w / s.h > 4 ? " strip" : "") + '"><img src="' + s.src + '" width="' + s.w + '" height="' + s.h + '" alt="">'
    + marks.map(m => '<span class="tpin" style="left:' + m.x + "%;top:" + m.y + '%">' + m.n + "</span>").join("") + "</div>";
}
function adminVisual(kind){
  const box = (ic, t, d, cls) => '<div class="tbox' + (cls ? " " + cls : "") + '"><b>' + icon(ic) + t + "</b><span>" + d + "</span></div>";
  const arrow = '<span class="tarrow">' + icon("chevR") + "</span>";
  switch(kind){
    case "map": return '<div class="tdiag"><div class="trow">' + box("folder", "Your repository", "index.html · guide.html") + arrow
      + box("grid", "GitHub Pages", "serves the two files at your address") + arrow + box("slides", "Each person's browser", "runs the app and keeps their decks", "hi") + "</div>"
      + '<div class="trow sub">' + box("text", "Google Fonts", "optional", "dash") + box("pdf", "PDF reader", "only when opening a PDF", "dash") + box("lock", "Nothing else", "no accounts, no uploads", "dash") + "</div></div>";
    case "files": return '<div class="tdiag"><pre class="ttree">your-repository/\n├─ index.html   <em>the app</em>\n├─ guide.html   <em>the illustrated guide</em>\n├─ changelog.json, CHANGELOG.md  <em>the change log</em>\n└─ README.md    <em>optional</em></pre>'
      + '<div class="trow">' + box("grid", "Settings → Pages", "Deploy from a branch · main · / (root)") + "</div></div>";
    case "release": return '<div class="tdiag"><div class="trow">' + box("download", "1 · New version", "index.html, guide.html, change log") + arrow + box("upload", "2 · Upload both", "replace the old files") + "</div>"
      + '<div class="trow">' + box("replace", "3 · People refresh", "decks are untouched") + arrow + box("check", "4 · What's new", "once, by role", "hi") + "</div>"
      + '<p class="tver">This copy: <b>' + esc(buildLine()) + "</b></p></div>";
    case "storage": return '<div class="tdiag"><div class="trow">' + box("slides", "Browser A · laptop", "its own autosaved deck", "hi") + box("slides", "Browser B · phone", "a different deck") + "</div>"
      + '<div class="trow">' + box("save", "Save project", "a .halodeck.json file: the backup, and how a deck moves") + "</div></div>";
    case "network": return '<div class="tdiag"><table class="ttable"><tr><th>Address</th><th>Used for</th><th>If blocked</th></tr>'
      + "<tr><td>Your GitHub Pages address</td><td>The app and the guide</td><td>Won't load</td></tr>"
      + "<tr><td>fonts.googleapis.com · fonts.gstatic.com</td><td>Fonts</td><td>System fonts, all still works</td></tr>"
      + "<tr><td>cdn.jsdelivr.net · unpkg.com</td><td>PDF reader, only when opening a PDF</td><td>PDFs won't open</td></tr></table></div>";
    case "changelog": {
      const recent = VERSIONS.slice(-4);
      return '<div class="tdiag"><ol class="tlog">' + recent.map(v => {
        const n = v.changes.length, a = v.changes.filter(c => c.for === "admins").length;
        return '<li' + (v.version === APP_VERSION ? ' class="now"' : "") + '><span class="tlog-dot"></span><span class="tlog-v">' + esc(v.version) + '</span><span class="tlog-t"><b>' + esc(v.title)
          + "</b><small>" + esc(fmtDate(v.date)) + " · " + n + " change" + (n === 1 ? "" : "s") + (a ? " · " + a + " for admins" : "") + "</small></span></li>";
      }).join("") + '</ol><p class="tver">' + VERSIONS.length + " versions since " + esc(fmtDate(VERSIONS[0].date)) + ". This copy: <b>" + esc(buildLine()) + "</b></p></div>";
    }
    case "checklist": return '<div class="tdiag"><ul class="tchecks">'
      + ["Publish both files and open the address yourself", "Open a PDF on your work network to check the PDF reader loads",
         "Share two links: the app, and the guide (…/guide.html)", "Ask people to keep project files in a shared folder",
         "Agree on a format: HTML to read or give to AI tools, PDF to print, PNG to paste", "Plan any address change; collect project files first"]
        .map(t => "<li>" + t + "</li>").join("") + "</ul></div>";
  }
  return "";
}

function renderTour(){
  const t = TOUR[tour.track], s = t.steps[tour.i], n = t.steps.length;
  $("#tourTrack").textContent = "Getting started · " + t.label;
  $("#tourCount").textContent = "Step " + (tour.i + 1) + " of " + n;
  $("#tourVisual").innerHTML = s.shot ? shotHtml(s.shot, s.pins) : adminVisual(s.visual);
  $("#tourVisual").className = "tour-visual" + (s.shot ? "" : " diagram");
  let h = "<h2 id=\"tourTitle\">" + s.title + "</h2>" + (s.lead ? '<p class="tour-lead">' + s.lead + "</p>" : "");
  if(s.points) h += '<ol class="tour-points">' + s.points.map((p, k) => '<li><span class="tpin sm">' + (k + 1) + "</span><span>" + p + "</span></li>").join("") + "</ol>";
  if(s.tips) h += '<ul class="tour-tips">' + s.tips.map(p => "<li>" + p + "</li>").join("") + "</ul>";
  if(s.guide) h += '<a class="pill tour-guide" href="' + s.guide + '" target="_blank" rel="noopener">' + icon("book") + "Open the guide's admin part</a>";
  if(s.action === "log") h += '<button class="pill tour-guide" type="button" data-open-log>' + icon("history") + "Open the change log</button>";
  $("#tourText").innerHTML = h;
  const show = $("#tourShow");
  show.hidden = !s.show; if(s.show) show.lastChild.textContent = s.showLabel || "Show me";
  $("#tourDots").innerHTML = t.steps.map((st, k) => '<button class="tdot' + (k === tour.i ? " on" : k < tour.i ? " done" : "") + '" data-i="' + k + '" aria-label="Step ' + (k + 1) + ": " + esc(st.title) + '"></button>').join("");
  $("#tourBack").hidden = false; $("#tourBack").textContent = "Back";
  $("#tourNext").textContent = tour.i === n - 1 ? "Finish" : "Next";
  $("#tourNext").hidden = false; $("#tourDots").hidden = false; $("#tourCount").hidden = false; $("#tourShowWrap").hidden = false;
  tourModal.dataset.mode = "step";
}
function renderWelcome(){
  tour.track = null;
  $("#tourTrack").textContent = "Getting started";
  $("#tourCount").hidden = true;
  $("#tourVisual").className = "tour-visual"; $("#tourVisual").innerHTML = shotHtml("workspace", []);
  $("#tourText").innerHTML = '<h2 id="tourTitle">Welcome to HaloDeck</h2><p class="tour-lead">Mark up screenshots, explain them, and share them as one file. Pick a short tour:</p>'
    + '<div class="tour-tracks">'
    + '<button class="tour-track-btn" data-track="users">' + icon("ellipse") + "<span><b>I make decks</b><small>" + TOUR.users.steps.length + " short steps with screenshots</small></span></button>"
    + '<button class="tour-track-btn" data-track="admins">' + icon("folder") + "<span><b>I set HaloDeck up for others</b><small>" + TOUR.admins.steps.length + " steps for admins</small></span></button></div>"
    + '<p class="tour-small">You can open the tour again any time from <b>Help</b> (the ? button).</p>'
    + (movedHere() ? '<div class="tour-moved">' + icon("info") + '<span><b>Used HaloDeck at ' + esc(SITE_MOVE.from[0]) + '?</b> Your deck didn\'t move with it. Open the project file you saved there.</span>'
      + '<button class="pill sm" type="button" data-open-project>' + icon("folder") + "Open a project file</button></div>" : "");
  $("#tourShowWrap").hidden = true; $("#tourDots").hidden = true; $("#tourBack").hidden = true;
  $("#tourNext").hidden = false; $("#tourNext").textContent = "Skip for now";
  tourModal.dataset.mode = "welcome";
}
function openTour(track, step){
  if(ui.editing) endEdit();
  closeMenu(); closePanels(); closeHelp();
  hideSpot();
  closeNews();
  if(TOUR[track]){ tour.track = track; tour.i = clamp(step || 0, 0, TOUR[track].steps.length - 1); renderTour(); }
  else renderWelcome();
  tourModal.hidden = false;
  markSeen();
  setTimeout(() => { const b = tourModal.querySelector(".tour-track-btn") || $("#tourNext"); if(b && !b.hidden) b.focus({preventScroll:true}); }, 30);
}
function closeTour(){ tourModal.hidden = true; hideSpot(); }
function tourGo(d){
  if(!tour.track) return;
  const n = TOUR[tour.track].steps.length, j = tour.i + d;
  if(j < 0){ renderWelcome(); return; }
  if(j >= n){ closeTour(); toast("That's the tour. It's in Help (the ? button) whenever you want it again."); return; }
  tour.i = j; renderTour();
}
$("#tourNext").addEventListener("click", () => {
  const mode = tourModal.dataset.mode;
  if(mode === "step") tourGo(1); else closeTour();
});
$("#tourBack").addEventListener("click", () => tourGo(-1));
$("#tourClose").addEventListener("click", closeTour);
tourModal.addEventListener("pointerdown", e => { if(e.target === tourModal) closeTour(); });
tourModal.addEventListener("click", e => {
  const tb = e.target.closest("[data-track]");
  if(tb){ if(tb.dataset.track === "admins") setRole("admin"); else if(!roleChosen()) setRole("user"); openTour(tb.dataset.track, 0); return; }
  if(e.target.closest("[data-open-log]")){ closeTour(); openLog(); return; }
  if(e.target.closest("[data-open-project]")){ closeTour(); $("#fileProject").click(); return; }
  const dot = e.target.closest(".tdot"); if(dot && tour.track){ tour.i = +dot.dataset.i; renderTour(); }
});

/* "Show me": dim the screen and ring the real control, then come back to the same step */
function visibleTarget(sels){
  for(const sel of sels || []){
    const n = $(sel);
    if(!n) continue;
    const r = n.getBoundingClientRect();
    if(r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && getComputedStyle(n).visibility !== "hidden") return n;
  }
  return null;
}
const spot = {back:null, openedHelp:false};
/* Ring the first of `sels` that's on screen. Controls inside Help open Help first. `back` runs when the person
   clicks anywhere or presses a key, to return them to where they came from. Returns false if nothing is on screen. */
function spotlightOn(sels, title, tips, backLabel, back){
  const inHelp = (sels || []).some(sel => { const n = $(sel); return n && n.closest("#helpModal"); });
  spot.openedHelp = false;
  if(inHelp && helpModal.hidden){ openHelp(); spot.openedHelp = true; }
  for(const sel of sels || []){ const n = $(sel); if(n && (n.closest("#rightPanel") || n.closest("#helpModal"))) n.scrollIntoView({block:"center"}); }
  const n = visibleTarget(sels);
  if(!n){ if(spot.openedHelp) closeHelp(); return false; }
  const r = n.getBoundingClientRect(), pad = 6;
  const ring = spotlight.querySelector(".spot-ring"), tip = spotlight.querySelector(".spot-tip");
  ring.style.cssText = "left:" + (r.left - pad) + "px;top:" + (r.top - pad) + "px;width:" + (r.width + pad * 2) + "px;height:" + (r.height + pad * 2) + "px";
  tip.querySelector("b").textContent = title;
  const k = sels.findIndex(sel => $(sel) === n);
  tip.querySelector("span").textContent = (tips || [])[k] || (tips || [])[0] || "";
  tip.querySelector("button").textContent = backLabel;
  spot.back = back;
  spotlight.hidden = false;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let y = r.bottom + 16; if(y + th > innerHeight - 10) y = r.top - th - 16;
  if(r.height > innerHeight * 0.6) y = Math.max(10, r.top + 20);
  const x = clamp(r.left + r.width / 2 - tw / 2, 10, Math.max(10, innerWidth - tw - 10));
  tip.style.left = x + "px"; tip.style.top = clamp(y, 10, Math.max(10, innerHeight - th - 10)) + "px";
  spotlight.querySelector("button").focus({preventScroll:true});
  return true;
}
function showMe(){
  const s = tour.track && TOUR[tour.track].steps[tour.i];
  if(!s || !s.show) return;
  tourModal.hidden = true;
  if(!spotlightOn(s.show, s.title, s.showTips, "Back to the tour", () => { tourModal.hidden = false; renderTour(); })){
    tourModal.hidden = false; toast("That's not on screen right now — try a wider window.", {warn:true});
  }
}
function hideSpot(){ if(spotlight) spotlight.hidden = true; }
function backFromSpot(){
  hideSpot();
  if(spot.openedHelp){ closeHelp(); spot.openedHelp = false; }
  const b = spot.back; spot.back = null;
  if(b) b();
}
$("#tourShow").addEventListener("click", showMe);
spotlight.addEventListener("click", backFromSpot);

$("#helpTour").addEventListener("click", () => openTour());
$("#helpVersion").textContent = buildLine();
