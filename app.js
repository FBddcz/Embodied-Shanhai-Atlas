/* 具身山海志 · 全站交互
   主题、目录、搜索、筛选、对比、关注、认错、转场兜底、揭露动画。零依赖。 */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const root = document.documentElement;
root.classList.add('js');

const TYPE_LABEL = { company: '公司', model: '模型', benchmark: '榜单', event: '活动', job: '岗位', resource: '资源', lab: '机构', paper: '论文', news: '动态' };
const FILE = e => e.file || `${e.type}-${e.id}.html`;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------------- 提示 ---------------- */
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制');
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) { toast('已复制'); return true; }
    } catch (e2) {}
    toast('复制失败，请手动选择');
    return false;
  }
}

/* ---------------- 主题 ---------------- */
const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/></svg>';
function setTheme(theme, animate) {
  const apply = () => {
    root.dataset.theme = theme;
    const btn = $('#themeBtn');
    if (btn) {
      btn.innerHTML = theme === 'night' ? SUN : MOON;
      btn.setAttribute('aria-label', theme === 'night' ? '切到昼' : '切到夜');
    }
  };
  if (animate && document.startViewTransition && !reduceMotion()) {
    try { const vt = document.startViewTransition(apply); if (vt && vt.ready) vt.ready.catch(() => {}); }
    catch (e) { apply(); }
  } else apply();
  try { localStorage.setItem('atlas-theme', theme); } catch (e) {}
}
function bindTheme() {
  const btn = $('#themeBtn');
  setTheme(root.dataset.theme === 'night' ? 'night' : 'ink', false);
  if (btn) btn.addEventListener('click', () => setTheme(root.dataset.theme === 'night' ? 'ink' : 'night', true));
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', e => {
    let saved = null;
    try { saved = localStorage.getItem('atlas-theme'); } catch (err) {}
    if (!saved) setTheme(e.matches ? 'night' : 'ink', false);
  });
}

/* ---------------- 四时天候：实时 / 一年浓缩成一天 / 四分钟一年 ----------------
   把节令与时辰写到 <html data-season data-hour>，样式与山海图都读这两项。
   cycle：一年 = 24 小时真实时间；fast：一年 = 4 分钟，用来演示。 */
function bindWorldClock() {
  const rootEl = document.documentElement;
  const btn = $('#worldClock');
  const menu = $('#worldClockMenu');
  if (!btn || !menu) return;
  const TERMS = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
    '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];
  const SEASON = ['spring', 'summer', 'autumn', 'winter'];
  const SCN = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
  const MODE_NAME = { real: '随天时', cycle: '一日一年', fast: '四分钟一年', off: '已停下' };
  let mode = 'real';
  try { mode = localStorage.getItem('atlas-clock') || 'real'; } catch (e) {}
  const t0 = Date.now();
  let acc = 0, last = Date.now(), raf = 0;

  // 取「一年中的位置」0..1 与「一天中的时刻」0..24
  const state = () => {
    const now = new Date();
    if (mode === 'real') {
      const doy = (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(now.getFullYear(), 0, 1)) / 864e5;
      const m = now.getMonth() + 1, dd = now.getDate();
      // 季节按月份：3–5 春、6–8 夏、9–11 秋、12–2 冬（北半球）
      const season = (m >= 3 && m <= 5) ? 'spring' : (m >= 6 && m <= 8) ? 'summer' : (m >= 9 && m <= 11) ? 'autumn' : 'winter';
      // 节气：每月 6 日前后一个、21 日前后一个；月初未到节气时用上月末那个
      let ti = (m - 1) * 2 + (dd >= 21 ? 1 : 0) - (dd < 6 ? 1 : 0);
      ti = ((ti % 24) + 24) % 24;
      return { year: (doy + (now.getHours() + now.getMinutes() / 60) / 24) / 365, hour: now.getHours() + now.getMinutes() / 60, season, term: TERMS[ti] };
    }
    if (mode === 'off') return { year: frozen.year, hour: frozen.hour, term: frozen.term };
    const span = mode === 'fast' ? 240000 : 86400000;
    acc += Date.now() - last; last = Date.now();
    const p = (acc % span) / span;                       // 0..1 一年
    const season = SEASON[Math.min(3, Math.floor(p * 4))];
    const q = (p * 4) % 1;                               // 该季内的位置
    const hour = q * 24;
    const termIdx = (['spring', 'summer', 'autumn', 'winter'].indexOf(season) * 6 + Math.min(5, Math.floor(q * 6))) % 24;
    return { year: p, hour, season, term: TERMS[termIdx] };
  };
  const frozen = { year: 0.85, hour: 10, term: '立冬' };
  if (mode === 'off') { const st = state(); frozen.year = st.year; frozen.hour = st.hour; frozen.term = st.term; }

  const HOURS = ['night', 'dawn', 'morning', 'day', 'dusk', 'night'];
  const hourKey = h => h < 5 || h >= 19 ? 'night' : h < 8 ? 'dawn' : h < 11 ? 'morning' : h < 16 ? 'day' : 'dusk';

  const apply = () => {
    const st = state();
    const season = st.season || SEASON[Math.min(3, Math.floor(st.year * 4))];
    rootEl.dataset.season = season;
    rootEl.dataset.hour = hourKey(st.hour);
    window.__worldHour = st.hour;
    window.__worldSeason = season;
    const label = `${SCN[season]}·${st.term}`;
    $$('[data-world-label]').forEach(el => { if (el.textContent !== label) el.textContent = label; });
    const mb = $('[data-clock-mode]');
    if (mb && mb.textContent !== MODE_NAME[mode]) mb.textContent = MODE_NAME[mode];
    try { window.dispatchEvent(new CustomEvent('worldclock', { detail: { season, hour: st.hour, mode } })); } catch (e) {}
  };

  const tick = () => {
    if (mode === 'cycle' || mode === 'fast') { apply(); raf = requestAnimationFrame(() => setTimeout(tick, 900)); }
  };
  const setMode = m => {
    mode = m;
    if (m === 'off') { const st = state(); frozen.year = st.year; frozen.hour = st.hour; frozen.term = st.term; }
    last = Date.now();
    try { localStorage.setItem('atlas-clock', m); } catch (e) {}
    apply();
    cancelAnimationFrame(raf);
    if (m === 'cycle' || m === 'fast') tick();
    menu.hidden = true; btn.setAttribute('aria-expanded', 'false');
    toast(m === 'real' ? '四时跟随真实时间' : m === 'cycle' ? '一年浓缩成一日：每 24 小时走完四季' : m === 'fast' ? '一年浓缩成四分钟，供演示' : '时序停在当前节令');
  };
  btn.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  $$('[data-clock-open]').forEach(b => b.addEventListener('click', () => {
    menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
    menu.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    menu.querySelector('button[data-clock]')?.focus();
  }));
  $$('[data-clock]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.clock)));
  document.addEventListener('click', e => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  // 页面隐藏时停表，回来后重新对齐
  document.addEventListener('visibilitychange', () => { last = Date.now(); if (!document.hidden) apply(); });
  apply();
  if (mode === 'cycle' || mode === 'fast') tick();
  // 真实模式下每 10 分钟校一次
  setInterval(() => { if (mode === 'real') apply(); }, 600000);
}

/* ---------------- 卷底：云海仙山循环视频（全站背景 + 首页画上的流云） ---------------- */
function bindBackdrop() {
  const host = $('.atmo');
  const vids = [host && host.querySelector('.atmo-video'), ...$$('video[data-theme-video]')].filter(Boolean);
  if (!vids.length || document.body.classList.contains('is-atlas')) return;
  const conn = navigator.connection || {};
  const lite = !!conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '');
  const small = matchMedia('(max-width: 47.99rem)').matches;
  const webm = !!vids[0].canPlayType('video/webm; codecs="vp9"');
  let cur = '';
  const play = v => { const p = v.play(); if (p && p.catch) p.catch(() => {}); };
  const load = () => {
    const theme = root.dataset.theme === 'night' ? 'night' : 'day';
    if (theme === cur) return;
    cur = theme;
    const base = 'assets/video/bg-' + theme;
    vids.forEach(v => {
      // 先瞬间隐去旧视频，露出 .atmo 的海报底图（按 cover 铺满）。
      // 不给 <video> 设 poster：Safari 画 poster 不认 object-fit，会按 contain 缩小居中，
      // 和底图叠成两层、左右各露一条硬边（切换昼夜时最明显）。
      v.style.transition = 'none';
      v.classList.remove('on');
      void v.offsetWidth;
      v.style.transition = '';
      v.removeAttribute('poster');
      if (lite) { v.removeAttribute('src'); v.load(); return; }
      v.src = base + (small ? '-720' : '') + (webm ? '.webm' : '.mp4');
      v.playbackRate = reduceMotion() ? 0.5 : 1;
      play(v);
    });
  };
  vids.forEach(v => {
    v.addEventListener('playing', () => v.classList.add('on'));
    v.addEventListener('ratechange', () => { if (reduceMotion() && v.playbackRate !== 0.5) v.playbackRate = 0.5; });
  });
  // 首屏先画字，空闲时再拉视频
  (window.requestIdleCallback || (f => setTimeout(f, 300)))(load);
  new MutationObserver(load).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  document.addEventListener('visibilitychange', () => {
    vids.forEach(v => { if (document.hidden) v.pause(); else if (v.getAttribute('src')) play(v); });
  });
  if (!host) return;
  // 阅读纱：页顶薄，往下滚动到七成屏高时加到最厚
  const home = document.body.dataset.page === 'home';
  const v0 = home ? 0.62 : 0.40, v1 = 0.80;
  let raf = 0;
  const veil = () => {
    raf = 0;
    const k = Math.min(1, scrollY / (innerHeight * 0.7));
    host.style.setProperty('--veil', (v0 + (v1 - v0) * k).toFixed(3));
  };
  veil();
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(veil); }, { passive: true });
}

/* ---------------- 页头与目录 ---------------- */
function bindHeader() {
  const head = $('#siteHeader');
  const onScroll = () => { if (head) head.classList.toggle('is-solid', scrollY > 12 || document.body.classList.contains('is-atlas')); };
  onScroll();
  addEventListener('scroll', onScroll, { passive: true });

  const toc = $('#toc');
  const openBtn = $('#menuBtn');
  const closeBtn = $('#tocClose');
  let lastFocus = null;
  const open = () => {
    if (!toc) return;
    lastFocus = document.activeElement;
    toc.classList.add('open');
    if (openBtn) openBtn.setAttribute('aria-expanded', 'true');
    (closeBtn || toc).focus();
  };
  const close = () => {
    if (!toc) return;
    toc.classList.remove('open');
    if (openBtn) openBtn.setAttribute('aria-expanded', 'false');
    if (lastFocus) lastFocus.focus();
  };
  if (openBtn) openBtn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && toc && toc.classList.contains('open')) close(); });
}

/* ---------------- 换区标题卡 ---------------- */
function bindZoneCard() {
  const zone = document.body.dataset.zone;
  if (!zone || document.body.classList.contains('is-atlas') || reduceMotion()) return;
  const key = 'zone-seen-' + zone;
  let seen = null;
  try { seen = sessionStorage.getItem(key); } catch (e) {}
  if (seen) return;
  try { sessionStorage.setItem(key, '1'); } catch (e) {}
  root.classList.add('zone-in');
  setTimeout(() => root.classList.remove('zone-in'), 1700);
}

/* ---------------- 揭露 ---------------- */
function bindReveal() {
  const els = $$('.ledger-item, .index-list .row, .news-item, .paper-row, .res-card, .job-card, .event-row, .feature, .rel-card, .money-row, .story-item, .sec');
  if (reduceMotion() || !('IntersectionObserver' in window)) { els.forEach(el => el.classList.add('reveal', 'in')); return; }
  els.forEach((el, i) => {
    el.classList.add('reveal');
    if (el.getBoundingClientRect().top < innerHeight * 1.05) el.classList.add('in');
  });
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.02 });
  els.forEach(el => { if (!el.classList.contains('in')) io.observe(el); });
}

/* ---------------- 搜索 ---------------- */
let DATA = null;
let searchIndex = [];
let paperIndex = [];
let papersLoaded = false;
let papersPromise = null;
const palette = $('#palette');
const paletteInput = $('#paletteInput');
const paletteResults = $('#paletteResults');
let results = [];
let activeIndex = 0;

async function loadData() {
  if (DATA) return DATA;
  const res = await fetch('search.json');
  if (!res.ok) throw new Error('search.json');
  DATA = await res.json();
  searchIndex = [...DATA.entities, ...(DATA.news || [])].map(e => ({
    ...e,
    hay: [e.name, e.en, e.one, e.company, e.owner, (e.tags || []).join(' ')].filter(Boolean).join(' ').toLowerCase()
  }));
  return DATA;
}
async function loadPapers() {
  if (papersLoaded) return paperIndex;
  if (papersPromise) return papersPromise;
  papersPromise = fetch('papers-index.json')
    .then(r => { if (!r.ok) throw new Error('papers'); return r.json(); })
    .then(d => {
      paperIndex = (d.papers || []).map(row => {
        const [id, file, name, a, dt, c, , cats, zh] = row;
        return { id: 'paper:' + id, type: 'paper', name, file, a, d: dt, c, zh: zh || '',
          one: `${dt} · ${c}`, hay: [name, zh, a, c, cats, dt].filter(Boolean).join(' ').toLowerCase() };
      });
      papersLoaded = true;
      return paperIndex;
    })
    .finally(() => { papersPromise = null; });
  return papersPromise;
}

function openPalette(initial = '') {
  if (!palette) return;
  palette.classList.add('open');
  palette.setAttribute('aria-hidden', 'false');
  if (paletteInput) { paletteInput.value = initial; }
  renderResults(initial);
  if (!DATA) loadData().then(() => { if (palette.classList.contains('open')) renderResults(paletteInput ? paletteInput.value : ''); }).catch(() => {
    if (paletteResults) paletteResults.innerHTML = '<div class="palette-empty">索引加载失败，请刷新页面。</div>';
  });
  setTimeout(() => paletteInput && paletteInput.focus(), 30);
}
function closePalette() {
  if (!palette) return;
  palette.classList.remove('open');
  palette.setAttribute('aria-hidden', 'true');
}
function renderResults(q) {
  if (!paletteResults) return;
  const query = (q || '').trim().toLowerCase();
  if (!DATA && !query) { paletteResults.innerHTML = '<div class="palette-empty">正在载入索引…</div>'; return; }
  let paperTotal = 0;
  if (!query) {
    results = searchIndex.slice(0, 12);
  } else {
    const core = searchIndex.filter(e => e.hay.includes(query)).slice(0, 7);
    const paperHits = paperIndex.filter(e => e.hay.includes(query));
    paperTotal = paperHits.length;
    const papers = paperHits.slice(0, 12 - core.length);
    results = [...core, ...papers].slice(0, 12);
    if (!papersLoaded) loadPapers().then(() => {
      if (palette && palette.classList.contains('open') && (paletteInput.value || '').trim().toLowerCase() === query) renderResults(query);
    }).catch(() => {});
  }
  activeIndex = 0;
  if (!results.length) {
    paletteResults.innerHTML = query && !papersLoaded ? '<div class="palette-empty">正在检索论文索引…</div>'
      : '<div class="palette-empty">没有匹配。试试公司名、榜单名、作者或「杭州」。</div>';
    return;
  }
  const more = query && paperTotal > results.filter(e => e.type === 'paper').length
    ? `<a class="result more" href="papers.html?q=${encodeURIComponent(query)}" role="option" aria-selected="false">
    <span class="type">论文</span><span><span class="name">在论文索引里看全部 ${paperTotal} 篇</span><span class="sub">含标题、摘要与作者</span></span><span class="go">→</span>
  </a>` : '';
  paletteResults.innerHTML = results.map((e, i) => `<a class="result${i === 0 ? ' active' : ''}" href="${esc(FILE(e))}" data-result-index="${i}" role="option" aria-selected="${i === 0}">
    <span class="type">${TYPE_LABEL[e.type] || '条目'}</span>
    <span><span class="name">${esc(e.type === 'paper' && e.zh ? e.zh : e.name)}</span><span class="sub">${esc(e.type === 'paper' ? `${(e.a || '').split(', ').slice(0, 3).join('、')} · ${e.d || ''}` : (e.one || e.en || ''))}</span></span>
    <span class="go">↵</span>
  </a>`).join('') + more;
}
function moveActive(dir) {
  if (!results.length) return;
  activeIndex = (activeIndex + dir + results.length) % results.length;
  $$('.result', paletteResults).forEach((el, i) => {
    el.classList.toggle('active', i === activeIndex);
    el.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
  });
  const el = $$('.result', paletteResults)[activeIndex];
  if (el) el.scrollIntoView({ block: 'nearest' });
}
function bindSearch() {
  document.addEventListener('click', e => {
    const opener = e.target.closest('[data-open-search]');
    if (opener) { e.preventDefault(); openPalette(opener.dataset.searchQ || ''); return; }
    const facet = e.target.closest('[data-facet-q]');
    if (facet) { e.preventDefault(); location.href = `papers.html?q=${encodeURIComponent(facet.dataset.facetQ)}`; }
  });
  if (paletteInput) paletteInput.addEventListener('input', () => renderResults(paletteInput.value));
  if (palette) palette.addEventListener('click', e => { if (e.target === palette) closePalette(); });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette && palette.classList.contains('open') ? closePalette() : openPalette(); return; }
    const typing = /input|textarea|select/i.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
    if (e.key === '/' && !typing && !document.body.classList.contains('is-atlas') && palette && !palette.classList.contains('open')) { e.preventDefault(); openPalette(); return; }
    if (!palette || !palette.classList.contains('open')) return;
    if (e.key === 'Escape') { closePalette(); paletteInput && paletteInput.blur(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
    if (e.key === 'Enter') {
      const el = results[activeIndex];
      if (el) { e.preventDefault(); location.href = FILE(el); }
    }
  });
}

/* ---------------- 筛选 ---------------- */
function bindFilters() {
  const groups = $$('.seg[aria-label]');
  groups.forEach(seg => {
    const btns = $$('[data-filter]', seg);
    if (!btns.length) return;
    btns.forEach(btn => btn.addEventListener('click', () => {
      btns.forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
      const value = btn.dataset.filter;
      applyFilter(value);
    }));
  });
  function applyFilter(value) {
    const items = $$('[data-tags]');
    let visible = 0;
    items.forEach(el => {
      const tags = (el.dataset.tags || '').split(/\s+/);
      const match = value === '全部' || tags.includes(value);
      el.hidden = !match;
      if (match) visible++;
    });
    // 资源页按环节分组：整组隐藏
    $$('[data-stage]').forEach(sec => {
      const any = $$('[data-tags]', sec).some(el => !el.hidden);
      sec.hidden = !any;
    });
    // 动态页按月份分组
    $$('.feed-month').forEach(m => {
      let n = m.nextElementSibling, any = false;
      while (n && !n.classList.contains('feed-month')) { if (!n.hidden) any = true; n = n.nextElementSibling; }
      m.hidden = !any && value !== '全部';
    });
    const empty = $('#listEmpty');
    if (empty) empty.hidden = visible > 0 || value === '全部';
    const note = $('.count-note');
    if (note) note.dataset.base = note.dataset.base || note.textContent;
  }
}

/* ---------------- 图录 / 名录 ---------------- */
function bindViewSwitch() {
  const seg = $$('.seg[aria-label="视图"]');
  if (!seg.length) return;
  const btns = $$('[data-view]', seg[0]);
  const views = { ledger: $('#ledgerView'), index: $('#indexView') };
  btns.forEach(btn => btn.addEventListener('click', () => {
    btns.forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
    Object.entries(views).forEach(([k, el]) => { if (el) el.hidden = k !== btn.dataset.view; });
  }));
}

/* ---------------- 关注 ---------------- */
function getFollows() {
  try { return JSON.parse(localStorage.getItem('atlas-follows') || '[]'); } catch (e) { return []; }
}
function setFollows(list) {
  try { localStorage.setItem('atlas-follows', JSON.stringify([...new Set(list)])); } catch (e) {}
}
function updateFollowButtons() {
  const follows = getFollows();
  $$('[data-follow-id]').forEach(btn => {
    const on = follows.includes(btn.dataset.followId);
    btn.textContent = on ? '已关注' : '关注';
    btn.classList.toggle('btn-solid', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
function bindFollow() {
  $$('[data-follow-id]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.followId;
    const follows = getFollows();
    const i = follows.indexOf(id);
    if (i >= 0) { follows.splice(i, 1); toast('已取消关注'); }
    else { follows.push(id); toast('已关注，记录在本机'); }
    setFollows(follows);
    updateFollowButtons();
  }));
  updateFollowButtons();
}
function renderFollowing() {
  const wrap = $('#followingList');
  if (!wrap) return;
  const follows = getFollows();
  const needsPapers = follows.some(id => String(id).startsWith('paper:'));
  Promise.all([loadData(), needsPapers ? loadPapers().catch(() => []) : Promise.resolve([])]).then(() => {
    const all = [...DATA.entities, ...DATA.news.map(n => ({ ...n, file: n.file })), ...paperIndex];
    const items = follows.map(id => all.find(e => e.id === id)).filter(Boolean);
    const card = (e, sub, tag) => `<a class="rec-card" href="${esc(FILE(e))}" data-zone="company">
      ${e.img ? `<span class="rec-art"><img src="${esc(e.img)}" alt="" loading="lazy"></span>` : `<span class="rec-art rec-glyph">${esc((e.name || '志').slice(0, 2))}</span>`}
      <span class="rec-body"><span class="rec-name">${esc(e.name)}</span><span class="rec-sub">${esc(sub || TYPE_LABEL[e.type] || '')}</span><span class="rec-one">${esc((e.one || '').slice(0, 64))}</span>${tag ? `<span class="rec-tag">${esc(tag)}</span>` : ''}</span></a>`;

    // 选题池：每个池子按「能代表这一类」挑，不按热度
    const byIdList = ids => ids.map(id => all.find(e => e.id === id)).filter(Boolean);
    const oneShot = byIdList(['unitree-g1', 'robotwin', 'pi', 'isaac-sim', 'libero']);
    const chainKeys = ['本体硬件', '传感', '算法与模型', '部署', '评测'];
    const stagePicks = chainKeys.map(st => (DATA.entities || [])
      .filter(e => e.type === 'resource' && e.stage === st)
      .sort((a, b) => (b.one || '').length - (a.one || '').length)[0]
      || (DATA.entities || []).find(e => e.stage === st) || null).filter(Boolean);

    const block = (no, title, sub, cards) => cards.length ? `<section class="rec-block">
      <div class="sec-head"><span class="sec-no">${no}</span><span class="sec-title">${title}</span><span class="rule"></span><span class="aside">${sub}</span></div>
      <div class="rec-grid">${cards.join('')}</div></section>` : '';

    let html = '';
    if (!items.length) {
      html += `<div class="rec-note">还没有关注任何条目。在任意条目页点「关注」，它就记在这一页，只存在本机浏览器。</div>`;
    } else {
      html += `<div class="sec-head"><span class="sec-no">记</span><span class="sec-title">已关注</span><span class="rule"></span><span class="aside">${items.length} 条</span></div>
      <div class="rec-grid rec-followed">${items.map(e => card(e, TYPE_LABEL[e.type] || '', e.verified)).join('')}</div>`;
    }
    html += block('一', '先看这五条', '一司、一碑、一基座、一仿真、一基准', oneShot.map(e => card(e)));
    html += block('二', '按链路看', '从本体到评测，各取一条', stagePicks.map(e => card(e, e.stage)));
    html += block('三', '换条路走', '三条路线，各从第一站进', [
      `<a class="rec-card rec-route" href="world.html#routes"><span class="rec-art rec-glyph">造</span><span class="rec-body"><span class="rec-name">造器之路</span><span class="rec-sub">本体 → 传感 → 整机</span><span class="rec-one">先有台能上电的机器，别的都在它之上。</span></span></a>`,
      `<a class="rec-card rec-route" href="world.html#routes"><span class="rec-art rec-glyph">算</span><span class="rec-body"><span class="rec-name">养算法之路</span><span class="rec-sub">数据 → 模型 → 训练</span><span class="rec-one">没有数据与评测协议，模型只是能跑起来。</span></span></a>`,
      `<a class="rec-card rec-route" href="world.html#routes"><span class="rec-art rec-glyph">机</span><span class="rec-body"><span class="rec-name">上机之路</span><span class="rec-sub">中间件 → 部署 → 真机</span><span class="rec-one">从仿真到真机这一段，卡住的人最多。</span></span></a>`,
    ]);
    html += `<div class="vol-tools" style="margin-top:34px"><a class="btn" href="index.html">回首页</a><a class="btn" href="atlas.html">打开山海图</a><a class="btn" href="world.html">总览</a><a class="btn" href="leaderboard.html">碑林</a></div>`;
    wrap.innerHTML = html;
  }).catch(() => { wrap.innerHTML = '<p class="empty">索引加载失败。</p>'; });
}

/* ---------------- 认错与联系 ---------------- */
let claimTarget = null;
function openClaim(id, name) {
  claimTarget = { id, name };
  const modal = $('#claimModal');
  const target = $('#claimTarget');
  if (target) target.textContent = `正在反馈：${name}。写明要更正的内容，附可打开的来源。`;
  const form = $('#claimForm');
  if (form) form.reset();
  if (modal) { modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); }
  const first = $('#claimForm input[name="name"]');
  if (first) setTimeout(() => first.focus(), 40);
}
function closeClaim() {
  const modal = $('#claimModal');
  if (modal) { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
}
function bindClaim() {
  $$('[data-claim-id]').forEach(btn => btn.addEventListener('click', () => openClaim(btn.dataset.claimId, btn.dataset.claimName)));
  $$('[data-close-modal]').forEach(btn => btn.addEventListener('click', closeClaim));
  const modal = $('#claimModal');
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeClaim(); });
  const form = $('#claimForm');
  if (!form) return;
  const reportText = () => {
    const fd = new FormData(form);
    return `【认领/纠错】${claimTarget ? claimTarget.name : ''}\n页面：${location.href}\n反馈人：${(fd.get('name') || '未填写').toString()}\n内容：${(fd.get('message') || '').toString()}\n来源：${(fd.get('source') || '未填写').toString()}\n时间：${new Date().toISOString()}`;
  };
  const copyBtn = $('[data-copy-claim]');
  if (copyBtn) copyBtn.addEventListener('click', () => copyText(reportText()));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    if (!String(fd.get('message') || '').trim()) { toast('请填写要更正的内容'); return; }
    const body = reportText();
    const repo = (form.dataset.issues || (DATA && DATA.site && DATA.site.issuesRepo)) || '';
    if (repo) {
      window.open(`${repo}/issues/new?title=${encodeURIComponent(`[认领/纠错] ${claimTarget ? claimTarget.name : ''}`)}&body=${encodeURIComponent(body)}`, '_blank', 'noopener');
      toast('已打开 GitHub 提交页');
    } else {
      const ok = await copyText(body);
      if (!ok) return;
      toast('已复制，请发给维护者');
    }
    closeClaim();
  });
}

function openContact() {
  const modal = $('#contactModal');
  if (modal) { modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); }
  const first = $('#contactForm input[name="name"]');
  const cform = $('#contactForm');
  // 只能复制的模式下弹窗主角是二维码：手机上自动聚焦会弹出键盘把二维码顶走
  if (first && !(cform && cform.dataset.mode === 'copy' && cform.dataset.qr === '1')) setTimeout(() => first.focus(), 40);
}
function closeContact() {
  const modal = $('#contactModal');
  if (modal) { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
}
function bindContact() {
  $$('[data-open-contact]').forEach(btn => btn.addEventListener('click', e => { e.preventDefault(); openContact(); }));
  $$('[data-close-contact]').forEach(btn => btn.addEventListener('click', closeContact));
  const modal = $('#contactModal');
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeContact(); });
  const form = $('#contactForm');
  if (!form) return;
  const status = $('#contactStatus');
  const payload = () => {
    const fd = new FormData(form);
    return { name: (fd.get('name') || '').toString().trim(), intent: (fd.get('intent') || '').toString(), contact: (fd.get('contact') || '').toString().trim(), message: (fd.get('message') || '').toString().trim(), consent: fd.get('consent'), page: location.href, time: new Date().toISOString() };
  };
  const text = p => `【合作联系】${p.intent}\n称呼/机构：${p.name}\n联系方式：${p.contact}\n内容：${p.message}\n页面：${p.page}\n时间：${p.time}`;
  const copyBtn = $('[data-copy-contact]');
  if (copyBtn) copyBtn.addEventListener('click', () => { const p = payload(); if (!p.message || !p.contact) { toast('请先填写联系方式与来意'); return; } copyText(text(p)); });
  const cf = { endpoint: form.dataset.endpoint || '', key: form.dataset.key || '', email: form.dataset.email || '', qr: form.dataset.qr === '1' };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const p = payload();
    if (!p.name || !p.contact || !p.message) { if (status) status.textContent = '请填写称呼、联系方式与想聊的内容。'; return; }
    if (form.querySelector('[name="consent"]') && !p.consent) { if (status) status.textContent = '请先勾选同意。'; return; }
    const body = text(p);
    if (cf.endpoint) {
      if (status) status.textContent = '正在发送…';
      try {
        const bot = !!(form.querySelector('[name="botcheck"]') || {}).checked;
        const data = cf.key ? { access_key: cf.key, subject: `具身山海志 · 合作联系 · ${p.intent}`, from_name: p.name, botcheck: bot, ...p } : { ...p, _gotcha: bot ? '1' : '' };
        const res = await fetch(cf.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) });
        if (!res.ok) throw new Error(String(res.status));
        form.reset();
        if (status) status.textContent = '已发送，会尽快回复。';
        setTimeout(closeContact, 1400);
      } catch (err) {
        const copied = await copyText(body);
        if (status) status.textContent = copied ? '发送未成功，内容已复制；可扫码进交流群直接发送。' : '发送未成功，请稍后再试。';
      }
      return;
    }
    if (cf.email) {
      copyText(body);
      window.location.href = `mailto:${cf.email}?subject=${encodeURIComponent('合作联系 · ' + p.intent)}&body=${encodeURIComponent(body)}`;
      if (status) status.textContent = '已打开邮件客户端；没有反应时，内容已在剪贴板。';
      return;
    }
    // 只复制，不发送：弹窗保持打开，访客还要扫上面的二维码
    const ok = await copyText(body);
    if (status) status.textContent = ok ? (cf.qr ? '已复制。扫上方二维码进群，粘贴发送即可。' : '已复制，请到 GitHub Issue 粘贴发送。') : '复制失败，请手动选中文字复制。';
  });
}

function bindCopy() {
  $$('[data-copy]').forEach(btn => btn.addEventListener('click', () => copyText(`${btn.dataset.copy} · 具身山海志 · ${location.href}`)));
  $$('[data-copy-raw]').forEach(btn => btn.addEventListener('click', () => copyText(btn.dataset.copyRaw)));
}

/* ---------------- GitHub 星数 ----------------
   仓库公开后显示实时星数；接口失败（仓库未建、限流、被墙）就只显示「Star」，不编数字。 */
function bindStar() {
  const link = $('.tool-star');
  const out = $('[data-gh-count]');
  if (!link || !out) return;
  const m = (link.getAttribute('href') || '').match(/github\.com\/([^/]+)\/([^/?#]+)/);
  if (!m) return;
  const key = `gh-stars:${m[1]}/${m[2]}`;
  const show = n => { if (Number.isFinite(n) && n > 0) { out.textContent = n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); out.hidden = false; } };
  try { const c = JSON.parse(sessionStorage.getItem(key) || 'null'); if (c && Date.now() - c.t < 36e5) { show(c.n); return; } } catch (e) {}
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 2000));
  idle(() => fetch(`https://api.github.com/repos/${m[1]}/${m[2]}`, { headers: { Accept: 'application/vnd.github+json' } })
    .then(r => r.ok ? r.json() : null)
    .then(j => { if (!j) return; show(j.stargazers_count); try { sessionStorage.setItem(key, JSON.stringify({ n: j.stargazers_count, t: Date.now() })); } catch (e) {} })
    .catch(() => {}));
}

/* ---------------- 碑林：页内切换 ----------------
   点左栏或下拉框只换右侧表格，地址栏同步成该榜专页，前进后退可用；页面不回顶部。
   取不到页面时退回普通跳转。 */
function bindBoardSwitch() {
  const main = document.getElementById('board');
  if (!main || !window.fetch || !window.DOMParser || !history.pushState) return;
  const cache = new Map();
  const load = url => {
    if (!cache.has(url)) cache.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.text(); }).then(t => new DOMParser().parseFromString(t, 'text/html')));
    return cache.get(url);
  };
  const headerH = () => { const h = $('#siteHeader'); return h ? h.getBoundingClientRect().height : 64; };
  let busy = 0;
  async function go(href, push) {
    const url = href.split('#')[0];
    const ticket = ++busy;
    main.setAttribute('aria-busy', 'true');
    let doc;
    try { doc = await load(url); } catch (e) { location.href = href; return; }
    if (ticket !== busy) return;
    const next = doc.getElementById('board');
    if (!next) { location.href = href; return; }
    const before = main.getBoundingClientRect().top;
    main.innerHTML = next.innerHTML;
    main.dataset.board = next.dataset.board || '';
    const t1 = $('.vol-title'), t2 = doc.querySelector('.vol-title');
    if (t1 && t2) t1.innerHTML = t2.innerHTML;
    document.title = doc.title;
    const key = main.dataset.board;
    $$('.board-rail a[data-board-key]').forEach(a => { if (a.dataset.boardKey === key) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    const cur = $('.board-rail a[aria-current="true"]');
    const rail = $('.board-rail');
    if (cur && rail && rail.scrollHeight > rail.clientHeight) {
      const rr = rail.getBoundingClientRect(), cr = cur.getBoundingClientRect();
      if (cr.top < rr.top || cr.bottom > rr.bottom) rail.scrollTop += cr.top - rr.top - rr.height / 3;
    }
    if (push) history.pushState({ board: url }, '', url);
    main.removeAttribute('aria-busy');
    // 表格顶端已经滚出视口：回到表格顶端；还在视口里：保持原位，不跳
    const after = main.getBoundingClientRect().top;
    if (before < headerH()) window.scrollTo({ top: window.scrollY + after - headerH() - 12, behavior: 'auto' });
    else if (after !== before) window.scrollBy(0, after - before);
    const h = main.querySelector('h2');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('.board-rail a[data-board-key]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (a.getAttribute('aria-current') === 'true') return;
    go(a.getAttribute('href'), true);
  });
  document.addEventListener('change', e => { const s = e.target.closest('[data-board-pick]'); if (s && s.value) go(s.value, true); });
  document.addEventListener('pointerover', e => { const a = e.target.closest('.board-rail a[data-board-key]'); if (a) load(a.getAttribute('href').split('#')[0]).catch(() => {}); });
  history.replaceState({ board: location.pathname.split('/').pop() || 'leaderboard.html' }, '', location.href);
  window.addEventListener('popstate', e => { if (e.state && e.state.board) go(e.state.board, false); });
}

/* ---------------- 对比 ---------------- */
function bindCompare() {
  const tabs = $$('[data-compare-tab]');
  const raw = $('#compareData');
  if (!raw) return;
  let cd;
  try { cd = JSON.parse(raw.textContent); } catch (e) { return; }
  const MAX = 3;
  const state = { type: 'company', selected: { company: [], model: [] } };
  try {
    const saved = JSON.parse(localStorage.getItem('atlas-compare') || 'null');
    if (saved && saved.selected) Object.assign(state.selected, saved.selected);
  } catch (e) {}
  const listFor = t => (t === 'company' ? cd.companies : cd.models) || [];
  const byId = (t, id) => listFor(t).find(x => x.id === id);
  const ensure = t => {
    state.selected[t] = (state.selected[t] || []).filter(id => byId(t, id)).slice(0, MAX);
    if (!state.selected[t].length) state.selected[t] = listFor(t).slice(0, 3).map(x => x.id);
  };
  const m = location.hash.match(/^#(company|model):(.+)$/);
  if (m) {
    const ids = m[2].split(',').map(x => decodeURIComponent(x.trim())).filter(id => byId(m[1], id)).slice(0, MAX);
    if (ids.length) { state.type = m[1]; state.selected[state.type] = ids; }
  }
  ensure(state.type);
  const save = () => { try { localStorage.setItem('atlas-compare', JSON.stringify(state)); } catch (e) {} };
  const table = $('#compareTable');
  const picker = $('#comparePicker');
  const rowsCompany = x => [
    ['一句话', x.one || '—'], ['方向', (x.tags || []).join(' / ') || '—'], ['代表模型', (x.models || []).join('、') || '—'],
    ['榜单成绩', (x.results || []).join('\n') || '—'], ['在招岗位', (x.jobs || []).join('、') || '—'], ['关联机构', (x.labs || []).join('、') || '—'],
    ['官网', x.website || '—'], ['总部', x.city], ['成立', x.founded], ['轮次', x.stage], ['员工', x.employees], ['核验', x.verified]
  ];
  const rowsModel = x => [
    ['一句话', x.one || '—'], ['公司', x.company], ['发布', x.released], ['许可', x.license], ['参数', x.params], ['模态', x.modality],
    ['榜单成绩', (x.results || []).join('\n') || '—'], ['核验', x.verified]
  ];
  const rowsFor = x => (state.type === 'company' ? rowsCompany(x) : rowsModel(x));
  function render() {
    tabs.forEach(t => t.setAttribute('aria-pressed', t.dataset.compareTab === state.type ? 'true' : 'false'));
    const selected = state.selected[state.type].map(id => byId(state.type, id)).filter(Boolean);
    if (table) {
      if (!selected.length) {
        table.innerHTML = '<tbody><tr><td class="empty">还没有选择。从下方点选二到三个条目。</td></tr></tbody>';
      } else {
        const rows = rowsFor(selected[0]);
        table.innerHTML = `<thead><tr><th class="dim">维度</th>${selected.map(x => `<th><a href="${state.type}-${esc(x.id)}.html">${esc(x.name)}</a><div class="th-sub">${esc(state.type === 'company' ? (x.en || '') : (x.company || ''))}</div></th>`).join('')}</tr></thead>
        <tbody>${rows.map(([label], i) => `<tr><td class="dim">${esc(label)}</td>${selected.map(x => {
          const v = (rowsFor(x)[i] || ['', '—'])[1] || '—';
          const cell = /^https?:/.test(v) ? `<a href="${esc(v)}" target="_blank" rel="noopener noreferrer">${esc(v)}</a>` : esc(v);
          return `<td${label === '榜单成绩' ? ' class="pre-line"' : ''}>${cell}</td>`;
        }).join('')}</tr>`).join('')}</tbody>`;
      }
    }
    if (picker) picker.innerHTML = listFor(state.type).map(x => {
      const on = state.selected[state.type].includes(x.id);
      return `<button type="button" class="pick" data-compare-id="${esc(x.id)}" aria-pressed="${on}"><span>${esc(x.name)}</span><span class="mark">${on ? '✓' : '+'}</span></button>`;
    }).join('');
    save();
  }
  tabs.forEach(t => t.addEventListener('click', () => { state.type = t.dataset.compareTab; ensure(state.type); render(); }));
  if (picker) picker.addEventListener('click', e => {
    const btn = e.target.closest('[data-compare-id]');
    if (!btn) return;
    const id = btn.dataset.compareId;
    const sel = state.selected[state.type];
    const i = sel.indexOf(id);
    if (i >= 0) sel.splice(i, 1);
    else if (sel.length >= MAX) { toast('最多对比三项'); return; }
    else sel.push(id);
    render();
  });
  const clear = $('[data-compare-clear]');
  if (clear) clear.addEventListener('click', () => { state.selected[state.type] = []; render(); });
  const copy = $('[data-compare-copy]');
  if (copy) copy.addEventListener('click', () => {
    const selected = state.selected[state.type].map(id => byId(state.type, id)).filter(Boolean);
    if (!selected.length) { toast('还没有选择'); return; }
    const lines = [selected.map(x => x.name).join(' vs '), ''];
    rowsFor(selected[0]).forEach(([label], i) => lines.push(`${label}：${selected.map(x => (rowsFor(x)[i] || ['', '—'])[1] || '—').join(' ｜ ')}`));
    lines.push('', '具身山海志 · 选型对比 · ' + location.href);
    copyText(lines.join('\n'));
  });
  render();
}

/* ---------------- 转场兜底（不支持跨文档 View Transition 的浏览器） ---------------- */
function bindVeil() {
  if (!root.classList.contains('vt-fallback')) return;
  const reduce = reduceMotion();
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('veil-pending')));
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.hash && url.pathname === location.pathname) return;
    if (!/\.html?$/.test(url.pathname) && url.pathname !== '/') return;
    e.preventDefault();
    root.style.setProperty('--vx', e.clientX + 'px');
    root.style.setProperty('--vy', e.clientY + 'px');
    root.classList.add('leaving');
    try { sessionStorage.setItem('veil', '1'); } catch (err) {}
    setTimeout(() => { location.href = url.href; }, reduce ? 160 : 420);
  });
  addEventListener('pageshow', e => { if (e.persisted) root.classList.remove('leaving', 'veil-pending'); });
}

/* ---------------- 索引层提示 ---------------- */
function bindHash() {
  if (!location.hash) return;
  const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  // 整块区域（#board、#subscribe、#venues）贴顶即可；只有单行才居中并闪一下底色
  if (el && el.getBoundingClientRect().height > innerHeight * 0.5) { el.scrollIntoView({ block: 'start' }); return; }
  if (el) {
    el.style.transition = 'background-color 1.4s ease';
    el.style.backgroundColor = 'color-mix(in oklab, var(--z-pig) 16%, transparent)';
    el.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    setTimeout(() => { el.style.backgroundColor = ''; }, 1800);
  }
}

/* ---------------- 游历：到过的域 ---------------- */
function bindTravel() {
  let visited = [];
  try { visited = JSON.parse(localStorage.getItem('atlas-visits') || '[]'); } catch (e) {}
  const zone = document.body.dataset.zone;
  if (zone && !visited.includes(zone)) {
    visited.push(zone);
    try { localStorage.setItem('atlas-visits', JSON.stringify(visited)); } catch (e) {}
  }
  const wrap = $('#travel');
  if (wrap) {
    const zones = (wrap.dataset.zones || '').split(',').filter(Boolean);
    wrap.querySelectorAll('[data-seal]').forEach(a => {
      const on = visited.includes(a.dataset.seal);
      if (on) a.setAttribute('data-visited', '1');
      const st = a.querySelector('.seal-state');
      if (st) st.textContent = on ? '已阅' : '未至';
    });
    const cnt = $('#travelCount');
    if (cnt) cnt.textContent = `已游 ${visited.filter(z => zones.includes(z)).length} / ${zones.length}`;
  }
}

/* ---------------- init ---------------- */
function bindPaperHit() {
  const box = document.getElementById('paperHit');
  if (!box) return;
  const q = (new URLSearchParams(location.search).get('q') || '').trim();
  if (!q) return;
  const list = box.parentElement.querySelector('.paper-list');
  const pager = box.parentElement.querySelector('.pager, nav[aria-label]');
  box.hidden = false;
  box.innerHTML = `<div class="hit-head"><b>「${esc(q)}」</b><span>正在检索 ${fmtNum(10000)} 篇索引…</span><button class="btn btn-ghost" type="button" data-hit-clear>回到全部</button></div><div class="hit-list" id="hitList"></div>`;
  if (list) list.hidden = true;
  if (pager) pager.hidden = true;
  box.querySelector('[data-hit-clear]').addEventListener('click', () => {
    const u = new URL(location.href); u.searchParams.delete('q'); history.replaceState(null, '', u.pathname + u.search + u.hash);
    box.hidden = true; if (list) list.hidden = false; if (pager) pager.hidden = false;
  });
  const needle = q.toLowerCase();
  loadPapers().then(rows => {
    const hits = rows.filter(e => e.hay.includes(needle));
    const listEl = document.getElementById('hitList');
    if (!listEl) return;
    if (!hits.length) { listEl.innerHTML = `<p class="empty">索引里没有「${esc(q)}」。论文标题为英文原文，可换关键词再试。</p>`; return; }
    const head = box.querySelector('.hit-head span');
    if (head) head.textContent = `命中 ${hits.length} 篇${hits.length > 60 ? '，先列最近 60 篇' : ''}`;
    listEl.innerHTML = hits.slice(0, 60).map(e => `<a class="paper-row" href="${esc(e.file)}"><span class="d">${esc((e.d || '').slice(2).replace(/-/g, '.'))}</span><span><h3>${esc(e.name)}</h3>${e.zh ? `<span class="zh">${esc(e.zh)}</span>` : ''}<span class="au">${esc((e.a || '').split(', ').slice(0, 3).join('、'))} · ${esc(e.c || '')}</span></span><span class="go"></span></a>`).join('');
  }).catch(() => { const listEl = document.getElementById('hitList'); if (listEl) listEl.innerHTML = '<p class="empty">索引载入失败，刷新再试。</p>'; });
}
function fmtNum(n) { return Number(n).toLocaleString('en-US'); }

document.addEventListener('DOMContentLoaded', () => {
  bindTheme();
  bindWorldClock();
  bindBackdrop();
  bindHeader();
  bindZoneCard();
  bindTravel();
  bindSearch();
  bindFilters();
  bindPaperHit();
  bindWorldTabs();
  bindViewSwitch();
  bindFollow();
  bindClaim();
  bindContact();
  bindCopy();
  bindStar();
  bindBoardSwitch();
  bindCompare();
  bindVeil();
  bindReveal();
  renderFollowing();
  bindHash();
  // 预热搜索索引：空闲时取一次，⌘K 打开即用
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1600));
  idle(() => loadData().catch(() => {}));
});

/* ---------------- 世界页：分卷标签 ---------------- */
function bindWorldTabs() {
  const tabs = $$('.world-tab');
  const panels = $$('.world-panel');
  if (!tabs.length || !panels.length) return;
  const show = key => {
    tabs.forEach(t => {
      const on = t.dataset.worldTab === key;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panels.forEach(p => p.classList.toggle('on', p.dataset.worldPanel === key));
  };
  tabs.forEach(t => t.addEventListener('click', () => {
    const k = t.dataset.worldTab;
    show(k);
    if (history.replaceState) history.replaceState(null, '', '#' + k);
    const panel = document.querySelector('[data-world-panel="' + k + '"]');
    if (panel) window.scrollTo({ top: panel.getBoundingClientRect().top + scrollY - 96, behavior: 'smooth' });
  }));
  $$('[data-world-goto]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    show(a.dataset.worldGoto);
    if (history.replaceState) history.replaceState(null, '', '#' + a.dataset.worldGoto);
  }));
  const alias = { 'ch-kaipi': 'zonggang', 'ch-zongmen': 'zongmen', 'ch-shiyiguan': 'shiyiguan', 'ch-jiujie': 'jiujie', 'paixi': 'paixi', 'xuepai': 'xuepai', 'ch-qiguan': 'qiguan', 'ch-diyun': 'diyun', 'ch-routes': 'wulu' };
  const hash = (location.hash || '').replace('#', '');
  if (hash) {
    const key = tabs.some(t => t.dataset.worldTab === hash) ? hash : alias[hash];
    if (key) show(key);
    else if (hash.indexOf('trial-') === 0) show('jiujie');
    else if (hash.indexOf('faction-') === 0) show('paixi');
    else if (hash.indexOf('school-') === 0) show('xuepai');
    else if (hash.indexOf('sect-') === 0) show('zongmen');
    else if (hash.indexOf('depth-') === 0) show('diyun');
    else if (hash.indexOf('gate-') === 0) show('shiyiguan');
    // 深链到具体条目：展开它并滚到眼前
    const tgt = document.getElementById(hash);
    if (tgt && !tgt.classList.contains('world-panel')) {
      if (tgt.tagName === 'DETAILS') tgt.open = true;
      setTimeout(() => tgt.scrollIntoView({ block: 'start', behavior: 'auto' }), 80);
    }
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const h = a.getAttribute('href').slice(1);
    if (h.indexOf('trial-') === 0) show('jiujie');
    else if (h.indexOf('faction-') === 0) show('paixi');
    else if (h.indexOf('school-') === 0) show('xuepai');
  });
}
