(function(){
  var deck=document.getElementById('deck');
  var wraps=[].slice.call(deck.querySelectorAll('.slide-wrap'));
  var n=wraps.length, cur=0;
  var curEl=document.getElementById('cur'), allBtn=document.getElementById('all'), fsBtn=document.getElementById('fs');
  var root=document.documentElement;
  function allMode(){ return deck.classList.contains('all'); }
  function show(i,noHash){
    cur=Math.max(0,Math.min(n-1,i));
    for(var k=0;k<n;k++) wraps[k].classList.toggle('active',k===cur);
    curEl.textContent=cur+1;
    if(!noHash && history.replaceState) history.replaceState(null,'','#'+(cur+1));
  }
  function next(){ if(!allMode()) show(cur+1); }
  function prev(){ if(!allMode()) show(cur-1); }
  function toggleAll(){
    var on=deck.classList.toggle('all');
    document.body.classList.toggle('all-mode',on);
    allBtn.setAttribute('aria-pressed',on?'true':'false');
    if(on){ if(wraps[cur]) wraps[cur].scrollIntoView({block:'start'}); } else { show(cur,true); window.scrollTo(0,0); }
  }
  function isFs(){ return !!(document.fullscreenElement||document.webkitFullscreenElement); }
  function toggleFs(){
    if(isFs()){ (document.exitFullscreen||document.webkitExitFullscreen).call(document); }
    else { var f=root.requestFullscreen||root.webkitRequestFullscreen; if(f) f.call(root); }
  }
  function onFs(){ var on=isFs(); root.classList.toggle('fs',on); fsBtn.setAttribute('aria-pressed',on?'true':'false'); if(on && allMode()) toggleAll(); }
  document.addEventListener('fullscreenchange',onFs);
  document.addEventListener('webkitfullscreenchange',onFs);
  document.getElementById('prev').onclick=prev;
  document.getElementById('next').onclick=next;
  allBtn.onclick=toggleAll;
  fsBtn.onclick=toggleFs;
  document.addEventListener('keydown',function(e){
    if(e.metaKey||e.ctrlKey||e.altKey) return;
    var k=e.key;
    if(k==='f'||k==='F'){ toggleFs(); return; }
    if(k==='a'||k==='A'){ toggleAll(); return; }
    if(allMode()) return;
    if(k==='ArrowRight'||k==='ArrowDown'||k==='PageDown'||k===' '||k==='Enter'){ e.preventDefault(); next(); }
    else if(k==='ArrowLeft'||k==='ArrowUp'||k==='PageUp'){ e.preventDefault(); prev(); }
    else if(k==='Home'){ e.preventDefault(); show(0); }
    else if(k==='End'){ e.preventDefault(); show(n-1); }
  });
  deck.addEventListener('click',function(e){ if(root.classList.contains('fs')) (e.clientX<window.innerWidth*0.3?prev:next)(); });
  var sx=null, sy=null;
  deck.addEventListener('touchstart',function(e){ var t=e.touches[0]; sx=t.clientX; sy=t.clientY; },{passive:true});
  deck.addEventListener('touchend',function(e){
    if(sx===null) return;
    var t=e.changedTouches[0], dx=t.clientX-sx, dy=t.clientY-sy; sx=null;
    if(Math.abs(dx)>50 && Math.abs(dx)>Math.abs(dy)*1.5) (dx<0?next:prev)();
  },{passive:true});
  var hideT;
  document.addEventListener('mousemove',function(){
    if(!root.classList.contains('fs')) return;
    root.classList.add('show-ctrl'); clearTimeout(hideT);
    hideT=setTimeout(function(){ root.classList.remove('show-ctrl'); },1800);
  });
  var h=parseInt((location.hash||'').slice(1),10);
  show(h>0?h-1:0,true);
})();
