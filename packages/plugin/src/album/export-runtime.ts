/** Self-contained browser code. Only public section/photo indices cross this boundary. */
export const ALBUM_EXPORT_SCRIPT = String.raw`
(() => {
  const data = JSON.parse(document.getElementById('album-data').textContent);
  document.querySelectorAll('img[data-image-index]').forEach(img => { img.src=data.images[Number(img.dataset.imageIndex)]; });
  data.photos.forEach(photo => { photo.src=data.images[photo.image]; });
  const root = document.querySelector('.album-view'), base = root.querySelector('.av-base');
  const scroll = root.querySelector('.av-scroll'), overlay = root.querySelector('.av-overlay');
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const button = (action, label, cls = '', value = '', content = label) => '<button type="button" class="'+cls+'" data-action="'+action+'" data-value="'+value+'" aria-label="'+esc(label)+'">'+content+'</button>';
  let mode = '', index = 0, current = 0, trigger = null, touch = null;
  const phone = () => root.clientWidth <= 640;
  function close() { mode = ''; overlay.replaceChildren(); base.inert = false; root.querySelectorAll('[data-action=toc]').forEach(n => n.setAttribute('aria-expanded','false')); if (trigger && trigger.isConnected) trigger.focus({preventScroll:true}); }
  function paint(focus = false) {
    base.inert = true;
    root.querySelectorAll('[data-action=toc]').forEach(n => n.setAttribute('aria-expanded',String(mode === 'toc')));
    if (mode === 'toc') {
      overlay.innerHTML = '<div class="av-scrim" data-action="close"></div><div class="av-pop av-pop--toc" role="dialog" aria-modal="true" aria-label="목차"><div class="av-pop-head"><h3>목차</h3>'+button('close','닫기','av-icon','','✕')+'</div><ol class="av-toc">'+data.sections.map((s,i) => '<li>'+button('jump',s.label,i===current?'is-current':'',i,'<i>'+s.number+'</i><span>'+esc(s.label)+'</span>')+'</li>').join('')+'</ol></div>';
    } else {
      const p = data.photos[index];
      overlay.innerHTML = '<div class="av-lightbox" role="dialog" aria-modal="true" aria-label="사진 크게 보기"><div class="av-lb-top"><span aria-live="polite">'+(index+1)+' / '+data.photos.length+'</span>'+button('close','사진 닫기','av-icon','','✕')+'</div><div class="av-stage"><img src="'+p.src+'" alt="'+esc(p.alt)+'">'+button('prev','이전 사진','av-arrow av-prev','','‹')+button('next','다음 사진','av-arrow av-next','','›')+'</div><div class="av-lb-bottom"><div class="av-caption">'+p.caption.map((line,i)=>i?'<small>'+esc(line)+'</small>':'<p>'+esc(line)+'</p>').join('')+'</div><div class="av-thumbs">'+data.photos.map((photo,i)=>button('photo',(i+1)+'번 사진',i===index?'is-current':'',i,'<img src="'+photo.src+'" alt="">')).join('')+'</div><div class="av-dots" aria-hidden="true">'+(data.photos.length<=12?data.photos.map((_,i)=>'<i class="'+(i===index?'is-current':'')+'"></i>').join(''):'')+'</div></div></div>';
      overlay.querySelector('.av-thumbs .is-current')?.scrollIntoView({block:'nearest',inline:'nearest'});
    }
    if (focus) overlay.querySelector('button')?.focus();
  }
  function step(delta) { const active = document.activeElement?.dataset.action; index = (index+delta+data.photos.length)%data.photos.length; paint(); overlay.querySelector('[data-action="'+(active || 'close')+'"]')?.focus({preventScroll:true}); }
  function activate(node) {
    if (node.hasAttribute('data-photo-index')) { trigger=node; index=Number(node.dataset.photoIndex); mode='photo'; paint(true); return; }
    const action=node.dataset.action;
    if (action==='close') close();
    if (action==='toc') { trigger=node; mode='toc'; paint(true); }
    if (action==='jump') {
      const target=document.getElementById(data.sections[Number(node.dataset.value)].id); close();
      // Jump targets can sit inside the theme's native chapter folds.
      for(let parent=target?.parentElement;parent;parent=parent.parentElement) if(parent.tagName==='DETAILS') parent.open=true;
      if(target) { target.focus({preventScroll:true}); scroll.scrollTo({top:target.getBoundingClientRect().top-scroll.getBoundingClientRect().top+scroll.scrollTop-16,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}); }
    }
    if (action==='prev' || action==='next') step(action==='prev'?-1:1);
    if (action==='photo') { index=Number(node.dataset.value); paint(); overlay.querySelector('.av-thumbs .is-current')?.focus({preventScroll:true}); }
  }
  root.addEventListener('click',event => { const node=event.target.closest('[data-action],[data-photo-index]'); if(node) { event.preventDefault(); activate(node); } });
  root.addEventListener('keydown',event => {
    if(event.key==='Escape' && mode) { event.preventDefault(); close(); }
    if(mode==='photo' && ['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); step(event.key==='ArrowLeft'?-1:1); }
    if(['Enter',' '].includes(event.key) && event.target.matches('figure[data-photo-index]')) { event.preventDefault(); activate(event.target); }
    if(event.key==='Tab' && mode) {
      const nodes=[...overlay.querySelectorAll('button')].filter(n=>n.getClientRects().length), first=nodes[0], last=nodes.at(-1);
      if(event.shiftKey && document.activeElement===first) { event.preventDefault(); last?.focus(); }
      if(!event.shiftKey && document.activeElement===last) { event.preventDefault(); first?.focus(); }
    }
  });
  root.addEventListener('touchstart',e => { if(e.target.closest('.av-stage') && e.touches.length===1) touch={x:e.touches[0].clientX,y:e.touches[0].clientY}; },{passive:true});
  root.addEventListener('touchend',e => { const end=e.changedTouches[0]; if(touch && end && mode==='photo' && phone()) { const dx=end.clientX-touch.x,dy=end.clientY-touch.y; if(Math.abs(dx)>45 && Math.abs(dx)>Math.abs(dy)*1.5) step(dx<0?1:-1); } touch=null; },{passive:true});
  const spy = () => {
    current=0; const top=scroll.getBoundingClientRect().top+24;
    data.sections.forEach((s,i)=>{ if(document.getElementById(s.id)?.getBoundingClientRect().top<=top) current=i; });
    if(scroll.scrollTop+scroll.clientHeight>=scroll.scrollHeight-2) current=Math.max(0,data.sections.length-1);
    root.querySelectorAll('.av-current').forEach(n=>n.textContent=data.sections[current]?.label || '목차');
    root.querySelectorAll('.av-number').forEach(n=>n.textContent=data.sections[current]?.number || '');
  };
  scroll.addEventListener('scroll',spy,{passive:true}); spy();
})();
`;
