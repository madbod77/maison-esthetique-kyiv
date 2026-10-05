(() => {
  'use strict';
  const catalog = window.MAISON_CATALOG;
  const dialog = document.querySelector('#catalog-dialog');
  const search = document.querySelector('#service-search');
  const select = document.querySelector('#category-filter');
  const results = document.querySelector('#catalog-results');
  const count = document.querySelector('#result-count');
  const clear = document.querySelector('#clear-search');
  let direction = 'all', opener = null, timer;
  const normalize = s => s.toLocaleLowerCase('uk').normalize('NFKC').replace(/[ʼ’'`\u200b\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function categoryDirection(title) {
    if (/Електроепіляція/i.test(title)) return 'electro';
    if (/Лазерна/i.test(title)) return 'laser';
    if (/Шугар/i.test(title)) return 'wax';
    if (/Естетика тіла/i.test(title)) return 'body';
    if (title === 'Масаж') return 'massage';
    return 'cosmetology';
  }
  function setDirection(value) {
    direction = value;
    document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter === direction)));
  }
  for (const group of catalog.groups) {
    const option = document.createElement('option'); option.value=group.id;option.textContent=group.title;select.append(option);
  }
  function render() {
    const query=normalize(search.value); const words=query.split(' ').filter(Boolean); let total=0;
    const groups=catalog.groups.map(g=>({...g,services:g.services.filter(s=>words.every(w=>normalize(s.name+' '+g.title+' '+s.description).includes(w)))})).filter(g=>(select.value==='all'||select.value===g.id)&&(direction==='all'||categoryDirection(g.title)===direction)&&g.services.length);
    const html=groups.map(g=>{total+=g.services.length;return `<section class="catalog-category"><h3>${escape(g.title)}</h3>${g.services.map(s=>{const selected=window.MaisonBooking.has(s.id);return `<article class="service-row${selected?' is-selected':''}" data-service-id="${escape(s.id)}"><div><h4>${escape(s.name)}</h4>${s.description?`<details class="service-description"><summary>Про процедуру</summary><p>${escape(s.description)}</p></details>`:''}</div><span class="service-duration">${escape(s.duration||'Час уточнюється')}</span><span class="service-price">${escape(s.price)}</span><button class="service-go" type="button" data-select-service="${escape(s.id)}" aria-pressed="${selected}" aria-label="${selected?'Прибрати':'Додати'} послугу: ${escape(s.name)}">${selected?'✓':'+'}</button></article>`;}).join('')}</section>`}).join('');
    results.innerHTML=html||'<div class="empty-state"><h3>Спробуймо інший запит.</h3><p>Змініть назву або скиньте фільтри,<br>щоб знову побачити все меню Maison.</p><button class="button outline" id="reset-filters">Показати всі послуги <span aria-hidden="true">↗</span></button></div>';
    count.textContent=`Знайдено: ${total} із ${catalog.groups.reduce((n,g)=>n+g.services.length,0)} послуг · ${groups.length} категорій`;
    clear.hidden=!search.value;
    document.querySelector('#reset-filters')?.addEventListener('click',reset);
  }
  function reset(){search.value='';select.value='all';setDirection('all');render();search.focus();}
  function openCatalog(value,button){opener=button; search.value='';select.value='all';setDirection(value||'all');render();window.MaisonBooking.open('services',button);dialog.scrollTop=0;search.focus({preventScroll:true});closeMenu();}
  document.querySelectorAll('[data-open-catalog]').forEach(b=>b.addEventListener('click',()=>openCatalog('all',b)));
  document.querySelectorAll('[data-direction]').forEach(b=>b.addEventListener('click',()=>openCatalog(b.dataset.direction,b)));
  document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{select.value='all';setDirection(b.dataset.filter);render();}));
  document.querySelector('#close-catalog').addEventListener('click',()=>window.MaisonBooking.close());
  dialog.addEventListener('keydown',e=>{
    // A search input can consume Escape to clear itself; the dialog owns Escape.
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();window.MaisonBooking.close();}
  },{capture:true});
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)window.MaisonBooking.close();}});
  search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(render,100);});
  clear.addEventListener('click',()=>{search.value='';render();search.focus();});
  select.addEventListener('change',()=>{setDirection('all');render();});
  document.addEventListener('maison:selection',render);
  document.addEventListener('maison:booking-open',closeMenu);
  const menuButton=document.querySelector('.menu-toggle'),menu=document.querySelector('#mobile-menu');
  function closeMenu(){menu.hidden=true;menuButton.setAttribute('aria-expanded','false');menuButton.setAttribute('aria-label','Відкрити меню');}
  menuButton.addEventListener('click',()=>{const expanded=menuButton.getAttribute('aria-expanded')==='true';menu.hidden=expanded;menuButton.setAttribute('aria-expanded',String(!expanded));menuButton.setAttribute('aria-label',expanded?'Відкрити меню':'Закрити меню');});
  menu.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden){closeMenu();menuButton.focus();}});
  window.addEventListener('resize',()=>{if(window.innerWidth>600)closeMenu();});
  render();
})();
