/* ============================================================ updates
   The change log (every version, oldest first), each person's role, the What's new that appears once after an
   update with only the changes that apply to that role, and the notice for a move to a new web address.
   HaloDeck has no accounts, so the role is what the person chose: "I make decks" or "I run HaloDeck for others"
   (in the tour's welcome, in Help, or by opening the app once with ?role=admin). */

// When HaloDeck's address changes, autosaved decks stay behind at the old one (browsers keep them per address).
// People who open HaloDeck at a "from" address see a notice to save their deck; the welcome at the new address
// tells them how to bring it back. Leave "from" empty when no move is planned.
const SITE_MOVE = {from:["jtg-tools.jtgworkspace.com"], to:"https://jtg-tools.mkcworkspace.com/halo-deck/"};

const TYPE_META = {
  new:{label:"New", icon:"spark"}, improved:{label:"Improved", icon:"trend"}, fixed:{label:"Fixed", icon:"wrench"},
  changed:{label:"Changed", icon:"swap"}, removed:{label:"Removed", icon:"minusCircle"},
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(d){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "");
  return m ? MONTHS[+m[2] - 1] + " " + (+m[3]) + ", " + m[1] : String(d || "");
}
const typeOf = c => TYPE_META[c.type] || TYPE_META.changed;
const chipHtml = c => '<span class="chip c-' + esc(TYPE_META[c.type] ? c.type : "changed") + '">' + icon(typeOf(c).icon) + typeOf(c).label + "</span>"
  + (c.for === "admins" ? '<span class="chip c-admin">' + icon("shield") + "Admins</span>" : "");

/* ---- role */
const ROLE_KEY = "halodeck_role";
function roleChosen(){ try{ return !!localStorage.getItem(ROLE_KEY); }catch(_){ return false; } }
function getRole(){ try{ return localStorage.getItem(ROLE_KEY) === "admin" ? "admin" : "user"; }catch(_){ return "user"; } }
function setRole(r){ try{ localStorage.setItem(ROLE_KEY, r === "admin" ? "admin" : "user"); }catch(_){} renderRolePick(); }
function renderRolePick(){
  $$("#helpRole [data-role]").forEach(b => { const on = b.dataset.role === getRole(); b.classList.toggle("active", on); b.setAttribute("aria-checked", on ? "true" : "false"); });
}
$("#helpRole").addEventListener("click", e => {
  const b = e.target.closest("[data-role]"); if(!b) return;
  setRole(b.dataset.role);
  toast(b.dataset.role === "admin" ? "What's new will include admin changes too." : "What's new will show changes to the tools.");
});
(function roleFromAddress(){ const m = /[?&]role=(admin|user)(?:&|$)/.exec(location.search); if(m) setRole(m[1]); })();

/** versions after `after` with only the changes that apply to `role`, newest first */
function changesFor(role, after){
  return VERSIONS.filter(v => !after || cmpVer(v.version, after) > 0)
    .map(v => ({v, changes:v.changes.filter(c => c.for !== "admins" || role === "admin")}))
    .filter(g => g.changes.length).reverse();
}

/* ---- What's new: once per update, only what applies to this person */
const newsModal = $("#newsModal");
const news = {after:null, list:[]};
function openNews(after){
  if(after == null) after = VERSIONS.length > 1 ? VERSIONS[VERSIONS.length - 2].version : "";   // a returning user from before versions were tracked
  markSeen();
  if(!changesFor(getRole(), after).length) return false;                                      // nothing applies to them: say nothing
  if(ui.editing) endEdit();
  closeMenu(); closePanels(); closeHelp(); hideSpot();
  news.after = after; renderNews();
  newsModal.hidden = false;
  setTimeout(() => $("#newsOk").focus({preventScroll:true}), 30);
  return true;
}
function renderNews(){
  const role = getRole(), groups = changesFor(role, news.after), latest = VERSIONS[VERSIONS.length - 1];
  const total = groups.reduce((n, g) => n + g.changes.length, 0), multi = groups.length > 1;
  $("#newsTitle").textContent = "HaloDeck " + APP_VERSION;
  $("#newsSub").textContent = fmtDate(latest.date) + " · " + total + (total === 1 ? " change" : " changes") + " for you" + (multi ? ", across " + groups.length + " updates" : "");
  news.list = [];
  $("#newsBody").innerHTML = groups.map(g => (multi ? '<div class="news-ver"><b>' + esc(g.v.version) + "</b><span>" + esc(g.v.title) + "</span><small>" + esc(fmtDate(g.v.date)) + "</small></div>" : "")
    + '<div class="news-grid">' + newsCards(g.changes) + "</div>").join("");
  const other = role === "admin" ? "user" : "admin";
  const hidden = role === "admin" ? 0 : changesFor("admin", news.after).reduce((n, g) => n + g.changes.length, 0) - total;
  $("#newsRole").innerHTML = icon(role === "admin" ? "shield" : "user") + "<span>" + (role === "admin" ? "Showing everything, including admin changes." : "Showing changes for people who make decks."
    + (hidden ? " " + hidden + " more for admins." : "")) + '</span><button class="linkbtn" type="button" data-switch-role="' + other + '">' + (role === "admin" ? "I just make decks" : "I run HaloDeck") + "</button>";
  $("#newsLog").hidden = role !== "admin";
}
/* changes with a picture get a full-width card (picture beside the text); the rest pair up two to a row */
function newsCards(changes){
  const shot = c => c.shot && TOUR_SHOTS[c.shot];
  const withPic = changes.filter(shot), plain = changes.filter(c => !shot(c));
  return withPic.concat(plain).map(c => newsCard(c, news.list.push(c) - 1, !shot(c) && plain.length % 2 === 1 && c === plain[plain.length - 1])).join("");
}
function newsCard(c, i, solo){
  const shot = c.shot && TOUR_SHOTS[c.shot], r = shot ? shot.w / shot.h : 1;
  return '<article class="ncard' + (shot ? " has-shot" : "") + (solo ? " solo" : "") + '">'
    + (shot ? '<div class="ncard-shot' + (r < 0.8 ? " tall" : r > 2.6 ? " wide" : "") + '"><img src="' + shot.src + '" alt=""></div>' : '<div class="ncard-ic c-' + esc(c.type) + '">' + icon(typeOf(c).icon) + "</div>")
    + '<div class="ncard-text"><div class="ncard-tags">' + chipHtml(c) + "</div><h3>" + esc(c.title) + "</h3><p>" + esc(c.text) + "</p>"
    + (c.show ? '<button class="linkbtn" type="button" data-show="' + i + '">' + icon("select") + "Show me</button>" : "") + "</div></article>";
}
function closeNews(){ if(newsModal) newsModal.hidden = true; }
const SPOT_TIPS = {"#btnMore":"It's under More on this screen.", "#btnPanel":"It's under Layers & style on this screen."};
newsModal.addEventListener("click", e => {
  const sb = e.target.closest("[data-show]");
  if(sb){
    const c = news.list[+sb.dataset.show];
    newsModal.hidden = true;
    const tips = c.show.map(sel => SPOT_TIPS[sel] || "Here it is.");
    if(!spotlightOn(c.show, c.title, tips, "Back to What's new", () => { newsModal.hidden = false; })){
      newsModal.hidden = false; toast("That's not on screen right now — try a wider window.", {warn:true});
    }
    return;
  }
  const rb = e.target.closest("[data-switch-role]");
  if(rb){ setRole(rb.dataset.switchRole); renderNews(); }
});
newsModal.addEventListener("pointerdown", e => { if(e.target === newsModal) closeNews(); });
$("#newsOk").addEventListener("click", closeNews);
$("#newsClose").addEventListener("click", closeNews);
$("#newsTour").addEventListener("click", () => { closeNews(); openTour(); });
$("#newsLog").addEventListener("click", () => { closeNews(); openLog(); });

/* ---- the change log (an admin page; Help links to it too) */
const logModal = $("#logModal");
const logView = {for:"all", order:"asc"};
function openLog(){
  if(ui.editing) endEdit();
  closeMenu(); closePanels(); closeHelp(); closeNews(); hideSpot();
  renderLog();
  logModal.hidden = false;
  $("#logBody").scrollTop = logView.order === "asc" ? $("#logBody").scrollHeight : 0;   // land on the newest version
  setTimeout(() => $("#logClose").focus({preventScroll:true}), 30);
}
function closeLog(){ if(logModal) logModal.hidden = true; }
const dateLine = v => fmtDate(v.date) + (v.live && v.live !== v.date ? " · live " + fmtDate(v.live) : "") + (v.build ? " · build " + v.build : "");
function renderLog(){
  const first = VERSIONS[0], last = VERSIONS[VERSIONS.length - 1];
  $("#logSub").textContent = VERSIONS.length + " versions, " + fmtDate(first.date) + " to " + fmtDate(last.date) + ". You're on " + APP_VERSION + ".";
  $$("#logFor [data-for]").forEach(b => b.classList.toggle("on", b.dataset.for === logView.for));
  $$("#logOrder [data-order]").forEach(b => b.classList.toggle("on", b.dataset.order === logView.order));
  let vs = VERSIONS.map(v => ({v, changes:v.changes.filter(c => logView.for === "all" || c.for === logView.for)})).filter(g => g.changes.length);
  if(logView.order === "desc") vs = vs.reverse();
  $("#logBody").innerHTML = '<ol class="tl">' + vs.map(({v, changes}) => {
    const now = v.version === APP_VERSION;
    return '<li class="tl-v' + (now ? " now" : "") + '"><span class="tl-dot"></span><div class="tl-card"><div class="tl-head"><span class="tl-ver">' + esc(v.version) + "</span>"
      + '<div class="tl-title"><b>' + esc(v.title) + "</b><small>" + esc(dateLine(v)) + "</small></div>" + (now ? '<span class="tl-here">This version</span>' : "") + "</div>"
      + (v.note ? '<p class="tl-note">' + esc(v.note) + "</p>" : "")
      + '<ul class="tl-changes">' + changes.map(c => '<li><div class="tl-tags">' + chipHtml(c) + "</div><div><b>" + esc(c.title) + "</b><span>" + esc(c.text) + "</span></div></li>").join("") + "</ul></div></li>";
  }).join("") + "</ol>" + (vs.length ? "" : '<p class="dim">No changes match.</p>') + '<p class="log-about">' + esc(CHANGELOG.about || "") + "</p>";
}
function changelogCsv(){
  const q = v => { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const rows = [["version", "date", "went_live", "build", "version_title", "type", "for", "change", "details"]];
  VERSIONS.forEach(v => v.changes.forEach(c => rows.push([v.version, v.date, v.live || "", v.build || "", v.title, c.type, c.for, c.title, c.text])));
  return "﻿" + rows.map(r => r.map(q).join(",")).join("\r\n") + "\r\n";
}
$("#logFor").addEventListener("click", e => { const b = e.target.closest("[data-for]"); if(b){ logView.for = b.dataset.for; renderLog(); } });
$("#logOrder").addEventListener("click", e => { const b = e.target.closest("[data-order]"); if(b){ logView.order = b.dataset.order; renderLog(); $("#logBody").scrollTop = 0; } });
$("#logJson").addEventListener("click", () => downloadBlob(new Blob([JSON.stringify(CHANGELOG, null, 1)], {type:"application/json"}), "halodeck-changelog.json"));
$("#logCsv").addEventListener("click", () => downloadBlob(new Blob([changelogCsv()], {type:"text/csv"}), "halodeck-changelog.csv"));
$("#logClose").addEventListener("click", closeLog);
logModal.addEventListener("pointerdown", e => { if(e.target === logModal) closeLog(); });
$("#helpLog").addEventListener("click", openLog);

/* ---- moving to a new address */
const moveHost = (() => { try{ return new URL(SITE_MOVE.to).hostname; }catch(_){ return ""; } })();
function movingFromHere(){ return !!moveHost && SITE_MOVE.from.includes(location.hostname); }
function movedHere(){ return !!moveHost && location.hostname === moveHost && SITE_MOVE.from.length > 0; }
function showMoveBanner(){
  if(!movingFromHere()) return;
  try{ if(sessionStorage.getItem("halodeck_move_hidden")) return; }catch(_){}
  $("#moveTitle").textContent = "HaloDeck is moving to " + moveHost;
  $("#moveText").textContent = deckHasContent()
    ? "Your autosaved deck stays at this address and won't move with it. Save project now, then open that file at the new address."
    : "Anything you make here stays at this address. Use Save project before you switch, then open the file at the new address.";
  $("#moveGo").href = SITE_MOVE.to;
  $("#moveBanner").hidden = false;
}
$("#moveSave").addEventListener("click", () => {
  saveProject();
  toast("Saved. At the new address, use Open ▾ → HaloDeck project… and pick this file.");
});
$("#moveClose").addEventListener("click", () => {
  $("#moveBanner").hidden = true;
  try{ sessionStorage.setItem("halodeck_move_hidden", "1"); }catch(_){}
});

/* ---- on start: the welcome for first-timers, What's new for anyone returning after an update */
function tourAutoStart(){
  renderRolePick();
  showMoveBanner();
  let seen;
  try{ seen = localStorage.getItem("halodeck_seen_version"); }catch(_){ return; }
  if(seen === null){ if(deckHasContent()) openNews(null); else openTour(); }
  else if(cmpVer(seen, APP_VERSION) < 0) openNews(seen);
}
