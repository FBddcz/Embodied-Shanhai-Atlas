/* 山海图 · WebGL2 群岛
   七区七岛：人间（中央大陆）、学宫（西北高峰）、藏经（东北崖窟）、碑林（东·石林）、
   灵物（南·火山翠湖）、招贤（西南平原）、驿路（北·列屿港埠）。
   高度场是唯一真源：GPU 纹理、命中、遮挡、山道、小地图都从它取。
   没有 WebGL2 时改载 atlas-2d.js。 */
(function () {
  'use strict';
  const root = document.getElementById('atlasRoot');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = '1';

  /* ================= 工具 ================= */
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const isNight = () => document.documentElement.getAttribute('data-theme') === 'night';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tick = () => new Promise(r => setTimeout(r, 0));
  function bez(x1, y1, x2, y2) {
    const A = (a, b) => 1 - 3 * b + 3 * a, B = (a, b) => 3 * b - 6 * a, C = a => 3 * a;
    const f = (t, a, b) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
    const df = (t, a, b) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
    return x => {
      if (x <= 0) return 0; if (x >= 1) return 1;
      let lo = 0, hi = 1, t = x;
      for (let i = 0; i < 8; i++) {
        const e = f(t, x1, x2) - x; if (Math.abs(e) < 1e-5) break;
        const d = df(t, x1, x2); if (e > 0) hi = t; else lo = t;
        t = Math.abs(d) > 1e-6 ? t - e / d : (lo + hi) / 2; if (t < lo || t > hi) t = (lo + hi) / 2;
      }
      return f(t, y1, y2);
    };
  }
  const E_IN = bez(.16, 1, .3, 1), E_CAM = bez(.65, 0, .35, 1), E_BACK = bez(.34, 1.56, .64, 1);
  const hex3 = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  function mulberry32(a) {
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  /* ================= 色与名 ================= */
  const ORDER = ['company', 'lab', 'model', 'benchmark', 'job', 'resource', 'news'];
  const RC = {
    company: ['#8E4F2A', '#DE9C70'], lab: ['#3A4656', '#AEBBD0'], model: ['#2D6B57', '#7CC2A6'], benchmark: ['#2C5A78', '#86B6D6'],
    job: ['#7E5E12', '#DDB75E'], resource: ['#7D3550', '#D898B6'], news: ['#A8321F', '#E2705A']
  };
  const THEME = {
    day: { paper: '#F1E9DA', ink: '#1E1914', seal: '#A8321F', soft: '#FAF5EA' },
    night: { paper: '#121110', ink: '#F0E7D7', seal: '#E2705A', soft: '#1C1A17' }
  };
  const th = () => THEME[isNight() ? 'night' : 'day'];
  const rcol = k => RC[k] ? RC[k][isNight() ? 1 : 0] : th().ink;
  const TYPE_CN = { company: '公司', lab: '机构', model: '模型', benchmark: '榜单', job: '岗位', resource: '资源', news: '动态', event: '会期' };
  const LINK_CN = { model: '模型', lab: '机构', bench: '榜单', event: '会期', job: '岗位', news: '动态', tag: '同道' };
  const LINK_ORDER = ['model', 'lab', 'bench', 'event', 'job', 'news', 'tag'];

  /* ================= 噪声（JS 版，生成高度场用） ================= */
  function hash2(i, j) { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
  function noised(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const dux = 30 * fx * fx * (fx * (fx - 2) + 1), duy = 30 * fy * fy * (fy * (fy - 2) + 1);
    const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
    const k1 = b - a, k2 = c - a, k4 = a - b - c + d;
    return [-1 + 2 * (a + k1 * ux + k2 * uy + k4 * ux * uy), 2 * dux * (k1 + k4 * uy), 2 * duy * (k2 + k4 * ux)];
  }
  function fbm(x, y, o) { let s = 0, a = .5; for (let i = 0; i < o; i++) { s += a * noised(x, y)[0]; const nx = 1.6 * x - 1.2 * y, ny = 1.2 * x + 1.6 * y; x = nx; y = ny; a *= .5; } return s; }
  function ridged(x, y, o) { let s = 0, a = .5, w = 1; for (let i = 0; i < o; i++) { let n = 1 - Math.abs(noised(x, y)[0]); n *= n * w; w = Math.min(1, n * 2); s += a * n; const nx = 1.6 * x - 1.2 * y, ny = 1.2 * x + 1.6 * y; x = nx; y = ny; a *= .5; } return s; }
  function eroded(x, y, o) {
    let a = 0, b = .5, dx = 0, dy = 0;
    for (let i = 0; i < o; i++) { const n = noised(x, y); dx += n[1]; dy += n[2]; a += b * n[0] / (1 + dx * dx + dy * dy); b *= .5; const nx = 1.6 * x - 1.2 * y, ny = 1.2 * x + 1.6 * y; x = nx; y = ny; }
    return a;
  }

  /* ================= 七岛 ================= */
  // 世界坐标：X–Z 为海面，y 向上；北 = −z。
  const ISLES = {
    company: { label: '人间', cx: .00, cz: .06, r: .66, kind: 'continent', nr: .70, nOff: 0 },
    lab: { label: '学宫', cx: -1.12, cz: -.86, r: .40, kind: 'peaks', nr: .56, nOff: .16 },
    resource: { label: '藏经', cx: 1.08, cz: -.92, r: .38, kind: 'cliffs', nr: .60, nOff: .08 },
    benchmark: { label: '碑林', cx: 1.36, cz: .18, r: .36, kind: 'karst', nr: .70, nOff: .05 },
    model: { label: '灵物', cx: .22, cz: 1.24, r: .34, kind: 'volcano', nr: .40, nOff: .34 },
    job: { label: '招贤', cx: -1.24, cz: .74, r: .38, kind: 'plains', nr: .70, nOff: .04 },
    news: { label: '驿路', cx: .02, cz: -1.42, r: .62, kind: 'islets', nr: 1, nOff: 0 }
  };
  const EXT = 2.3;              // 网格覆盖 [-EXT, EXT]²
  const LAND = [];              // 参与高度场的陆块（六岛 + 驿路列屿）
  const ISLETS = [];
  (function prepWorld() {
    const rnd = mulberry32(20261113);
    ORDER.forEach((k, idx) => {
      const I = ISLES[k];
      I.key = k; I.idx = idx; I.seed = idx * 7.31 + 1.7;
      const L = Math.hypot(I.cx, I.cz);
      I.out = L > .05 ? [I.cx / L, I.cz / L] : [0, -1];          // 朝外（离群岛中心）的方向
      I.nc = [-I.out[0] * I.nOff, -I.out[1] * I.nOff];             // 结点区中心（局部，朝内侧）
      if (k === 'news') return;
      if (I.kind === 'peaks') {
        // 高峰排在外侧，台地在内侧：从群岛中心看过去，峰是背景
        const base = Math.atan2(I.out[1], I.out[0]);
        I.peaks = [[0, .78, .62, .30], [-.9, .70, .52, .27], [.9, .72, .50, .26], [-1.7, .64, .40, .24], [1.7, .66, .38, .24]]
          .map(([da, rr, h, w]) => [Math.cos(base + da) * rr, Math.sin(base + da) * rr, h, w]);
      }
      if (I.kind === 'volcano') I.cone = [I.out[0] * .30, I.out[1] * .30];
      if (I.kind === 'continent') I.rivers = [-.35, 1.95, 3.55];
      LAND.push(I);
    });
    // 驿路：北方一串列屿，弧心在大陆北缘之外
    const C0 = [.02, -.52], R = .92;
    for (let i = 0; i < 9; i++) {
      const a = (-124 + i * 8.5) * Math.PI / 180;
      const it = { key: 'news', idx: 6, kind: 'islet', cx: C0[0] + Math.cos(a) * R + (rnd() - .5) * .04, cz: C0[1] + Math.sin(a) * R + (rnd() - .5) * .05, r: .075 + rnd() * .035, seed: 40 + i * 3.7 };
      it.out = [0, -1];
      ISLETS.push(it); LAND.push(it);
    }
  })();

  function carveRivers(I, lx, lz, h) {
    const rho = Math.hypot(lx, lz);
    if (rho < .16 || rho > 1.2) return h;
    const phi = Math.atan2(lz, lx);
    for (let k = 0; k < 3; k++) {
      const a = I.rivers[k] + .26 * Math.sin(rho * 7.5 + k * 2.1);
      const w = Math.abs(wrapA(phi - a)) * rho;
      const c = (1 - sstep(0, .045 + .02 * rho, w)) * sstep(.16, .30, rho);
      if (c > 0) h = lerp(h, -.014, c * .92);
    }
    return h;
  }
  function riverDist(I, lx, lz) {
    const rho = Math.hypot(lx, lz), phi = Math.atan2(lz, lx);
    let best = 9;
    for (let k = 0; k < 3; k++) { const a = I.rivers[k] + .26 * Math.sin(rho * 7.5 + k * 2.1); best = Math.min(best, Math.abs(wrapA(phi - a)) * rho); }
    return rho < .16 ? 9 : best;
  }

  function hIsle(I, x, z, lx, lz, dq) {
    const er = eroded(x * 1.7 + I.seed, z * 1.7, 4);
    const roll = .05 + .020 * er;
    const outward = lx * I.out[0] + lz * I.out[1];
    switch (I.kind) {
      case 'continent': {
        const rd = ridged(x * 3.1 + 7, z * 3.1 - 3, 5);
        const ridges = sstep(.35, .9, fbm(x * 2.2 - 4, z * 2.2 + 6, 3) + .3);
        const rim = sstep(.34, .74, dq) * (1 - sstep(.86, 1.0, dq));
        const north = .55 + .45 * sstep(-.5, .8, outward);
        let h = roll + .045 + rim * north * (.22 + .40 * rd) + rim * ridges * .10;
        h += .03 * sstep(.1, .5, fbm(x * 3.6 + 2, z * 3.6 - 1, 3) + .25) * (1 - sstep(.2, .6, dq));
        return carveRivers(I, lx, lz, h);
      }
      case 'peaks': {
        let p = 0;
        for (const q of I.peaks) { const d = Math.hypot(lx - q[0], lz - q[1]) / q[3]; p += q[2] * Math.exp(-d * d * 1.7); }
        const rd = ridged(x * 4 + 3, z * 4 + 1, 5);
        let h = roll + .05 + p * (.80 + .85 * rd);
        const plat = 1 - sstep(.42, .66, Math.hypot(lx - I.nc[0], lz - I.nc[1]));
        return lerp(h, .10 + .012 * er, plat * .93);
      }
      case 'cliffs': {
        // 三级台地 + 细纹：单层阶跃会显得像被刀切过
        let h = .34 * sstep(1.0, .80, dq) + .09 * sstep(.86, .62, dq) + .045 * sstep(.62, .44, dq);
        h += .03 * er;
        h -= .05 * (1 - sstep(0, .62, dq));
        h += .028 * ridged(x * 5, z * 5, 3) * sstep(.45, .9, dq);
        h += .012 * fbm(x * 13, z * 13, 3) * sstep(.2, .7, dq);
        return Math.max(h, roll * .5);
      }
      case 'karst': {
        let h = .045 + .018 * er + .012 * fbm(x * 6, z * 6, 3);
        for (const p of I.pillars) {
          const d = Math.hypot(lx - p[0], lz - p[1]);
          if (d < p[2]) h = Math.max(h, .045 + p[3] * Math.pow(1 - d / p[2], .32));
        }
        return h;
      }
      case 'volcano': {
        const dc = Math.hypot(lx - I.cone[0], lz - I.cone[1]);
        let h = roll + .52 * Math.pow(clamp(1 - dc / .82, 0, 1), 1.6) * (.80 + .35 * ridged(x * 3, z * 3, 3));
        return lerp(h, .17 + .006 * er, sstep(.25, .15, dc));
      }
      case 'plains': {
        let h = .05 + .03 * fbm(x * 2.6, z * 2.6, 4) + .016 * er;
        return h + .09 * sstep(.62, .95, dq) * sstep(0, .4, fbm(x * 3 + 5, z * 3, 3) + .2);
      }
      default: { // islet
        return .045 + .055 * Math.pow(clamp(1 - dq, 0, 1), 1.1) + .015 * er;
      }
    }
  }

  function sampleWorld(x, z) {
    let best = -1, bm = 0, bdq = 9, soft = 0;
    for (let i = 0; i < LAND.length; i++) {
      const I = LAND[i];
      const lx = (x - I.cx) / I.r, lz = (z - I.cz) / I.r, d0 = Math.hypot(lx, lz);
      if (d0 > 2.4) continue;
      const ang = Math.atan2(lz, lx);
      const cw = 1 + .09 * Math.sin(3 * ang + I.seed) + .05 * Math.sin(5 * ang + I.seed * 1.7) + .025 * Math.sin(9 * ang + I.seed * 2.3) + .08 * fbm(x * 2.8 + I.seed, z * 2.8 - I.seed, 3);
      const dq = d0 / cw;
      soft = Math.max(soft, sstep(2.2, .95, dq) * (I.kind === 'islet' ? .7 : 1));
      const m = sstep(1.0, .80, dq);
      if (m > bm) { bm = m; best = i; bdq = dq; }
    }
    const sea = -(.018 + .12 * (1 - soft)) + .006 * fbm(x * 5, z * 5, 2);
    if (best < 0) return [sea, -1];
    const I = LAND[best];
    const hl = hIsle(I, x, z, (x - I.cx) / I.r, (z - I.cz) / I.r, bdq);
    return [bm * hl + (1 - bm) * sea, I.idx];
  }

  // 碑林石柱（局部坐标，确定性）
  (function makePillars() {
    const rnd = mulberry32(9091);
    const I = ISLES.benchmark;
    // 两列石柱沿脊线排开，外侧群
    const spots = [];
    for (let i = 0; i < 9; i++) spots.push([I.out[0] * 1.0 * (Math.cos(i * .5) * 0) + (i - 4) * .105, (i % 3 - 1) * .10 + I.out[1] * .35]);
    for (let i = 0; i < 8; i++) { const a = rnd() * 6.283, d = .45 + rnd() * .45; spots.push([Math.cos(a) * d, Math.sin(a) * d]); }
    // 保留在岛内的
    I.pillars = spots.filter(([x, z]) => Math.hypot(x - I.nc[0], z - I.nc[1]) > .30 && Math.hypot(x, z) < .86)
      .map(([x, z]) => [x, z, .05 + rnd() * .035, .16 + rnd() * .22]);
  })();

  /* ================= 高度场 ================= */
  let N = 0, HN = 0, HF = null, CELL = 0;
  function buildField(n) {
    N = n; HN = n + 1; CELL = 2 * EXT / n;
    HF = new Float32Array(HN * HN);
    for (let j = 0; j < HN; j++) {
      const z = -EXT + j * CELL;
      for (let i = 0; i < HN; i++) HF[j * HN + i] = sampleWorld(-EXT + i * CELL, z)[0];
    }
  }
  function hAt(x, z) {
    const fi = clamp((x + EXT) / CELL, 0, N - 1e-3), fj = clamp((z + EXT) / CELL, 0, N - 1e-3);
    const i = Math.floor(fi), j = Math.floor(fj), fx = fi - i, fz = fj - j;
    const a = HF[j * HN + i], b = HF[j * HN + i + 1], c = HF[(j + 1) * HN + i], d = HF[(j + 1) * HN + i + 1];
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
  }

  /* ================= DOM ================= */
  root.innerHTML = `
<div class="atlas2d-stage atlas-stage-wrap">
  <canvas id="atlasCanvas" aria-hidden="true"></canvas>
  <div class="atlas-label-layer" aria-hidden="true"></div>
  <div class="atlas-hover" hidden></div>
  <div class="atlas-regioncard" hidden></div>
  <div class="atlas-compass" role="button" tabindex="0" aria-label="回正北">
    <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="15"/><path class="needle" d="M20 6 24 20 20 34 16 20Z"/><path class="seal" d="M20 6 24 20 20 20Z"/><text x="20" y="4.6">北</text></svg>
  </div>
  <div class="atlas-minimap" aria-hidden="true"><canvas width="296" height="296"></canvas><span class="atlas-minimap-cone"></span></div>
  <div class="atlas-hud">
    <div class="atlas-chips" role="toolbar" aria-label="分区"></div>
  </div>
  <div class="atlas-tools">
    <button class="atlas-tool" data-act="zoom-in" aria-label="放大">+</button>
    <button class="atlas-tool" data-act="zoom-out" aria-label="缩小">−</button>
    <button class="atlas-tool" data-act="search" aria-label="图内搜索（/）">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
    </button>
    <button class="atlas-tool" data-act="guide" aria-label="名录">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
    </button>
    <button class="atlas-tool" data-act="pause" aria-label="暂停自动运动（空格）" aria-pressed="false">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 5v14M15 5v14"/></svg>
    </button>
    <button class="atlas-tool" data-act="help" aria-label="快捷键（?）">?</button>
  </div>
  <div class="atlas-pins" role="tablist" aria-label="钉选"></div>
  <aside class="atlas-dossier" hidden aria-label="地标详情"></aside>
  <div class="atlas-crumb"></div>
  <div class="atlas-search" hidden>
    <div class="atlas-search-box"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
      <input type="search" placeholder="寻一地标：公司、机构、碑、文…" aria-label="图内搜索" autocomplete="off" spellcheck="false">
      <span class="atlas-kbd">/</span></div>
    <div class="atlas-search-list" role="listbox"></div>
  </div>
  <nav class="atlas-guide" hidden aria-label="名録"><header><b>名録</b><span>Tab 浏览 · Enter 聚焦</span><button data-guide-close aria-label="关闭">×</button></header><div class="atlas-guide-list"></div></nav>
  <div class="atlas-help" hidden><div class="atlas-help-card">
    <header><b>山海图例</b><button data-help-close aria-label="关闭">×</button></header>
    <div class="legend-grid">
      <section><h4>地域</h4><div data-legion="regions"></div></section>
      <section><h4>宗门</h4><div data-legion="sects"></div></section>
      <section><h4>圣兽</h4><div data-legion="beasts"></div></section>
      <section><h4>秘境</h4><div data-legion="depths"></div></section>
      <section><h4>异象</h4><div data-legion="phenomena"></div></section>
      <section><h4>派系</h4><div data-legion="factions"></div></section>
      <section><h4>学派</h4><div data-legion="schools"></div></section>
      <section><h4>天梯</h4><div data-legion="trials"></div></section>
    </div>
    <p class="legend-note">藏经 = 修炼资源，共十一关；楼阁为宗门，光环为秘境入口，兽影为各域圣兽。</p>
    <dd class="legend-help">
      <span>拖动旋转 · 滚轮缩放 · 1–7 飞区 · 0 全岛</span>
      <span>单击聚焦 · P 钉选 · / 搜索 · G 秘境 · L 标签 · M 小地图 · 空格暂停</span>
    </dd>
  </div></div>
  <div class="atlas-intro"><div class="atlas-intro-card"><span class="atlas-seal">山海</span><b>山海图</b><i></i></div></div>
  <div class="atlas-live" role="status" aria-live="polite"></div>
  <div class="atlas-boot"><span class="atlas-boot-ring"></span><em>正在引水成海…</em></div>
</div>`;

  const $ = (s, el = root) => el.querySelector(s);
  const $$ = (s, el = root) => Array.from(el.querySelectorAll(s));
  const canvas = $('#atlasCanvas');
  const layer = $('.atlas-label-layer');
  const hoverEl = $('.atlas-hover');
  const dossier = $('.atlas-dossier');
  const liveEl = $('.atlas-live');
  const boot = $('.atlas-boot');
  const mini = $('.atlas-minimap canvas');
  const compass = $('.atlas-compass');
  const pinsBar = $('.atlas-pins');
  const regionCard = $('.atlas-regioncard');
  const crumb = $('.atlas-crumb');
  const searchEl = $('.atlas-search');
  const searchInput = $('.atlas-search input');
  const searchList = $('.atlas-search-list');
  const guideEl = $('.atlas-guide');
  const guideList = $('.atlas-guide-list');
  const helpEl = $('.atlas-help');
  const chipsEl = $('.atlas-chips');

  function say(msg) { liveEl.textContent = ''; requestAnimationFrame(() => { liveEl.textContent = msg; }); }

  function gl2() {
    for (const opt of [{ antialias: false, alpha: false, depth: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true }, { antialias: false, alpha: false, depth: false }]) {
      const g = canvas.getContext('webgl2', opt);
      if (g) return g;
    }
    return null;
  }

  /* ================= 数据 ================= */
  let DATA = null, NODES = [], LINKS = [], BYID = new Map(), LINKS_OF = new Map(), REGIONS = [];
  let state = 'S1', filter = new Set(ORDER), pins = [], labelLevel = window.innerWidth < 760 ? 0 : 1;
  let FOCUS = null, HOVER = null, SEARCH_HIT = null, paused = false, showMini = !(innerWidth < 760);
  let SHOW_WEAK = false;            // 弱关系（12/25）默认隐藏
  let PHENOM = null;                // 当前异象 {kind, t0, dur, life, fade, at}
  let LORE = null;
  const SECTS = [];                 // {zone, name, beast, creed, taboo, href, x,y,z, w}
  const DEPTHS = [];                // {zone, name, text, href, x,y,z, w}
  const BEASTS = [];                // {zone, name, form, text, virtue, x,z, seed}
  let SHOW_DEPTH = false, SHOW_SECT = true, SHOW_BEAST = true;
  const beastIdx = z => Math.max(0, ORDER.indexOf(z));
  function loreAnchor(I, lx, lz) { return [I.cx + I.r * lx, I.cz + I.r * lz]; }
  function buildLore() {
    SECTS.length = 0; DEPTHS.length = 0; BEASTS.length = 0;
    if (!LORE) return;
    const sectOf = Object.fromEntries((LORE.sects || []).map(x => [x.zone, x]));
    const depthOf = Object.fromEntries((LORE.depths || []).map(x => [x.zone, x]));
    const beastOf = Object.fromEntries((LORE.beasts || []).map(x => [x.zone, x]));
    ORDER.forEach((k, i) => {
      const I = ISLES[k];
      // 宗门：岛心偏内的高处
      const sx = I.kind === 'continent' ? I.cx - .12 : I.cx + I.nc[0] * .55;
      const sz = I.kind === 'continent' ? I.cz - .10 : I.cz + I.nc[1] * .55;
      const sy = Math.max(.10, hAt(sx, sz)) + .045;
      const sc = sectOf[k];
      if (sc) SECTS.push({ ...sc, x: sx, y: sy, z: sz, w: k, rgb: hex3(rcol(k)) });
      // 秘境：岛的外侧边缘，岩壁/崖缝
      const dx = I.cx + I.out[0] * I.r * .62, dz = I.cz + I.out[1] * I.r * .62;
      const dc = depthOf[k];
      if (dc) DEPTHS.push({ ...dc, x: dx, y: Math.max(.02, hAt(dx, dz)) + .012, z: dz, w: k, rgb: hex3(rcol(k)), seed: i * 2.7 });
      // 圣兽：在岛上方缓慢游动
      const bc = beastOf[k];
      if (bc) BEASTS.push({ ...bc, cx: I.cx, cz: I.cz, r: I.r * .55, h: I.kind === 'peaks' ? .42 : .22, ph: i * .9, sp: .00006 + i * .000012, w: k });
    });
  }
  const INK_COL = [.30, .26, .22];
  function lineRGB(a, b) {
    const pa = hex3(rcol(a.region)), pb = hex3(rcol(b.region));
    // 两侧区色相混，再向墨/纸拉近，避免彩色线抢眼
    const mixc = [0, 1, 2].map(i => (pa[i] + pb[i]) * .5);
    const base = hex3(isNight() ? th().paper : th().ink);
    return [0, 1, 2].map(i => lerp(base[i], mixc[i], isNight() ? .55 : .5));
  }

  /* ================= 相机 ================= */
  const cam = { yaw: -0.38, pitch: .60, dist: 4.3, ty: .14, tYaw: -0.38, tPitch: .60, tDist: 3.9, tTy: .14 };
  const NARROW = () => innerWidth < 760;
  let W = 1, H = 1, DPR = 1, renderScale = 1;
  const tween = { on: false, t0: 0, dur: 0, fy: 0, fp: 0, fd: 0, fty: 0, ty: 0, tp: 0, td: 0, tty: 0, arc: 0, ease: E_CAM };
  function flyTo(o) {
    const dYaw = wrapA((o.yaw ?? cam.yaw) - cam.yaw);
    tween.fy = cam.yaw; tween.fp = cam.pitch; tween.fd = cam.dist; tween.fty = cam.ty;
    tween.ty = cam.yaw + dYaw; tween.tp = o.pitch ?? cam.pitch; tween.td = o.dist ?? cam.dist; tween.tty = o.ty ?? cam.ty;
    tween.dur = o.dur || 1100; tween.t0 = performance.now(); tween.on = true; tween.arc = o.arc || 0; tween.ease = o.ease || E_CAM;
    if (o.dist != null) cam.tDist = o.dist;
    cam.spin = false;
    if (reduced) { cam.yaw = tween.ty; cam.pitch = tween.tp; cam.dist = tween.td; cam.tDist = tween.td; cam.ty = tween.tty; tween.on = false; }
  }
  function stepTween(now) {
    if (!tween.on) return;
    const t = clamp((now - tween.t0) / tween.dur, 0, 1), e = tween.ease(t);
    cam.yaw = lerp(tween.fy, tween.ty, e);
    cam.pitch = lerp(tween.fp, tween.tp, e);
    cam.dist = lerp(tween.fd, tween.td, e) + tween.arc * Math.sin(Math.PI * e);
    cam.ty = lerp(tween.fty, tween.tty, e);
    if (t >= 1) tween.on = false;
  }
  function camEye() {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    return [Math.sin(cam.yaw) * cp * cam.dist, sp * cam.dist + cam.ty, Math.cos(cam.yaw) * cp * cam.dist];
  }

  /* ================= 地标落位：按度数分两环 + 泊松盘最小间距 ================= */
  function layoutNodes() {
    const byReg = new Map(ORDER.map(k => [k, []]));
    NODES.forEach(n => { const k = byReg.has(n.region) ? n.region : 'company'; n.region = k; byReg.get(k).push(n); });
    const rnd = mulberry32(4242);
    for (const k of ORDER) {
      const I = ISLES[k], list = byReg.get(k);
      list.sort((a, b) => (b.d || 0) - (a.d || 0) || String(a.name).localeCompare(String(b.name)));
      if (k === 'news') {
        const per = Math.ceil(list.length / ISLETS.length);
        list.forEach((n, i) => {
          const it = ISLETS[Math.min(ISLETS.length - 1, Math.floor(i / per))];
          const j = i % per, m = Math.min(per, list.length - Math.floor(i / per) * per);
          const a = j * 2.39996 + it.seed, rr = Math.min(it.r * .52, .075) * Math.sqrt((j + .6) / m);
          n.x = it.cx + Math.cos(a) * rr; n.z = it.cz + Math.sin(a) * rr;
          n.lx = (n.x - I.cx) / I.r; n.lz = (n.z - I.cz) / I.r;
        });
      } else {
        // 两环：度数高者在内环（靠区心），其余外环；同环内泊松盘最小间距
        const n = list.length;
        const pivot = [I.r * .26, I.r * .26];                    // 内环中心（相对岛心）
        const maxR = Math.max(.10, Math.min(.40, Math.sqrt(n) * .030)) * (I.kind === 'continent' ? 1.15 : 1);
        const ringR = [maxR * .42, maxR * .95];
        const minGap = Math.max(.052, Math.min(.085, maxR * .42));
        const hiCount = Math.min(n, Math.max(3, Math.round(n * .42)));
        list.forEach((node, i) => {
          const ring = i < hiCount ? 0 : 1;
          let placed = false;
          for (let attempt = 0; attempt < 90 && !placed; attempt++) {
            const a = rnd() * 6.2832;
            const rr = ring === 0 ? ringR[0] * Math.sqrt(rnd() * .9 + .15) : lerp(ringR[0] + minGap * 1.15, ringR[1], Math.sqrt(rnd()));
            const px = pivot[0] + Math.cos(a) * rr, pz = pivot[1] + Math.sin(a) * rr;
            let ok = true;
            for (let j = 0; j < i; j++) { const o = list[j]; if (Math.hypot(o.lx - px, o.lz - pz) < minGap) { ok = false; break; } }
            if (!ok) continue;
            node.lx = px; node.lz = pz; placed = true;
          }
          if (!placed) { const a = i * 2.39996 + I.seed; node.lx = pivot[0] + Math.cos(a) * ringR[ring]; node.lz = pivot[1] + Math.sin(a) * ringR[ring]; }
        });
        list.forEach(node => {
          let x = I.cx + node.lx, z = I.cz + node.lz;
          for (let g = 0; g < 10 && hAt(x, z) < .024; g++) { x = lerp(x, I.cx + pivot[0], .30); z = lerp(z, I.cz + pivot[1], .30); }
          node.x = x; node.z = z; node.lx = (x - I.cx) / I.r; node.lz = (z - I.cz) / I.r;
        });
      }
      list.forEach((node, i) => {
        node.region = k; node.idx = i;
        node.lift = .020 + rnd() * .010 + Math.min(.018, (node.d || 1) * .0014);
        node.y = Math.max(.018, hAt(node.x, node.z));
      });
    }
    NODES.sort((a, b) => (b.d || 0) - (a.d || 0));
  }

  /* ================= WebGL ================= */
  const gl = gl2(); window.__phase = 'gl';
  window.__phase = gl ? 'gl-ok' : 'gl-null';
  if (!gl) { loadFallback('no-webgl2'); return; }

  const EXTF = gl.getExtension('EXT_color_buffer_float');
  const NS = 420, LNS = 2400;       // 山道采样点 / 航道采样点

  function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
  function prog(vs, fs, name) {
    const p = gl.createProgram(), a = sh(gl.VERTEX_SHADER, vs), b = sh(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, a); gl.attachShader(p, b); gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, 'aA'); gl.bindAttribLocation(p, 2, 'aB'); gl.bindAttribLocation(p, 3, 'aC'); gl.bindAttribLocation(p, 4, 'aD');
    gl.linkProgram(p);
    const okCompile = gl.getShaderParameter(a, gl.COMPILE_STATUS) && gl.getShaderParameter(b, gl.COMPILE_STATUS);
    (window.__atlasProg = window.__atlasProg || {})[name] = !!gl.getProgramParameter(p, gl.LINK_STATUS);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) || !okCompile) {
      const msg = (gl.getShaderInfoLog(a) || '') + (gl.getShaderInfoLog(b) || '') + gl.getProgramInfoLog(p);
      window.__atlasGlError = (window.__atlasGlError || '') + name + ': ' + msg;
    }
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name.replace('[0]', ''); u[nm] = gl.getUniformLocation(p, nm); }
    return { p, u };
  }
  /* ---------- 纹理上传：对驱动宽容，但把每种失败写进 __atlasHFmt ---------- */
  const FILTER_OK = new Set([gl.NEAREST, gl.LINEAR, gl.NEAREST_MIPMAP_NEAREST, gl.LINEAR_MIPMAP_NEAREST, gl.NEAREST_MIPMAP_LINEAR, gl.LINEAR_MIPMAP_LINEAR]);
  function tex2d(w, h, ifmt, fmt, type, filter, data) {
    const flt = FILTER_OK.has(filter) ? filter : gl.NEAREST;
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data || null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, flt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, flt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  let hTex = null, iTex = null;
  const f32 = new Float32Array(1), i32 = new Int32Array(f32.buffer);
  function toHalf(src) {
    const out = new Uint16Array(src.length);
    for (let k = 0; k < src.length; k++) {
      f32[0] = src[k];
      const x = i32[0], sign = (x >> 16) & 0x8000;
      const e = (x >> 23) & 0xff; let m = x & 0x7fffff;
      if (e === 0xff) { out[k] = sign | 0x7c00 | (m ? 0x200 : 0); continue; }
      const ex = e - 127 + 15;
      if (ex >= 0x1f) { out[k] = sign | 0x7c00; continue; }
      if (ex <= 0) {
        if (ex < -10) { out[k] = sign; continue; }
        m = (m | 0x800000) >>> Math.min(31, 1 - ex);
        out[k] = sign | (m >> 13);
        continue;
      }
      out[k] = sign | (ex << 10) | (m >> 13);
    }
    return out;
  }
  // 高度场 → 浮点纹理。依次尝试 R16F/HALF_FLOAT（核心可过滤）、RGBA16F/HALF_FLOAT、R32F/FLOAT。
  function uploadHeight(hsrc) {
    const half = toHalf(hsrc);
    const halfRGBA = new Uint16Array(HN * HN * 4);
    for (let k = 0; k < HN * HN; k++) { halfRGBA[k * 4] = half[k]; }   // 其余通道保持 0
    const tries = [
      ['R16F/HALF', () => tex2d(HN, HN, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.LINEAR, half)],
      ['RGBA16F/HALF', () => tex2d(HN, HN, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, halfRGBA)],
      ['R32F/NEAREST', () => tex2d(HN, HN, gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST, hsrc)]
    ];
    const log = [];
    for (const [name, make] of tries) {
      while (gl.getError() !== gl.NO_ERROR) {}
      const t = make();
      const err = gl.getError();
      if (err === gl.NO_ERROR) {
        window.__atlasHFmt = name; window.__atlasHTry = log.concat([name + ':ok']).join(';');
        return { tex: t, rgba: name.startsWith('RGBA') };
      }
      log.push(name + ':' + err);
      gl.deleteTexture(t);
    }
    window.__atlasHFmt = 'FAILED'; window.__atlasHTry = log.join(';');
    return { tex: hTex, rgba: false };
  }
  function uploadField() {
    if (HF.length !== HN * HN) {   // resize 与布局竞争时自愈
      buildField(N);
      initGridVao();
    }
    if (hTex) { gl.deleteTexture(hTex); hTex = null; }
    if (iTex) { gl.deleteTexture(iTex); iTex = null; }
    const hsrc = window.FLAT_H ? new Float32Array(HF.length).fill(.25) : HF;
    const up = uploadHeight(hsrc);
    hTex = up.tex; window.__hRGBA = up.rgba;
    window.__dbgH = HF;
    const i8 = new Uint8Array(HN * HN);
    for (let j = 0; j < HN; j++) {
      const z = -EXT + j * CELL;
      for (let i = 0; i < HN; i++) {
        const v = sampleWorld(-EXT + i * CELL, z)[1];
        i8[j * HN + i] = v < 0 ? 255 : v;
      }
    }
    iTex = tex2d(HN, HN, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.NEAREST, i8);
    window.__dbgI = i8;
  }

  /* ---------- 共用 GLSL ---------- */
  const NOISE = `
float h21(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x),u.y);}
float fbm3(vec2 p){float s=0.,a=.5;for(int i=0;i<3;i++){s+=a*vn(p);p=mat2(1.6,1.2,-1.2,1.6)*p;a*=.5;}return s;}
float fbm4(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*vn(p);p=mat2(1.6,1.2,-1.2,1.6)*p;a*=.5;}return s;}
`;
  const MAT = 'const int NISLE=7;';

  /* ---------- Pass 1：地形 + 水面 → 颜料 / 法线 ---------- */
  const VS_T = `#version 300 es
layout(location=0) in vec2 aPos;
uniform mat4 uVP; uniform sampler2D uH; uniform sampler2D uI; uniform float uExt, uN, uTime;
flat out float vIsle; out vec3 vW; out vec3 vN; out float vCurv;
float hAt(ivec2 c){return texelFetch(uH, clamp(c, ivec2(0), ivec2(int(uN))), 0).r;}
void main(){
  ivec2 c = ivec2(aPos*uN+.5);
  float h = hAt(c), hl=hAt(c-ivec2(2,0)), hr=hAt(c+ivec2(2,0)), hd=hAt(c-ivec2(0,2)), hu=hAt(c+ivec2(0,2));
  float cell = 4.*uExt/uN;
  vN = normalize(vec3(hl-hr, 2.*cell, hd-hu));
  vCurv = (hl+hr+hd+hu-4.*h)/(cell*cell);
  vIsle = texelFetch(uI, clamp(c, ivec2(0), ivec2(int(uN))), 0).r*255.;
  vW = vec3((aPos.x*2.-1.)*uExt, h, (aPos.y*2.-1.)*uExt);
  gl_Position = uVP*vec4(vW,1.);
}`;
  const FS_T = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in float vCurv;
flat in float vIsle;
${MAT}
uniform vec3 uL; uniform float uTime; uniform float uWater; uniform vec3 uCam;
uniform vec3 uKReg[NISLE];
layout(location=0) out vec4 oPig;   // r 墨 g 赭石 b 青绿(0 绿..1 青) a 青绿量
layout(location=1) out vec4 oNrm;   // xyz 法线，a 岛号(0..6/255) 或 1.0=水
${NOISE}
float cunTex(vec2 p, float ang){
  // 皴笔：沿 ang 方向拉长的细笔，稀疏、低反差，避免「雪挂」
  float c = cos(ang), s = sin(ang);
  vec2 q = mat2(c, -s, s, c) * p;
  float a = vn(q * vec2(.9, 26.));
  float b = vn(q * vec2(.35, 9.) + 13.7);
  return smoothstep(.58, .86, a * .62 + b * .38);
}
void main(){
  vec3 n = normalize(vN);
  if (uWater > .5) { oPig = vec4(0.); oNrm = vec4(.5, 1., .5, 1.); return; }
  int isle = int(vIsle + .5);
  float slope = 1. - n.y;
  float lam = clamp(dot(n, uL), 0., 1.);
  float band = floor(lam*4.)/4.;
  float tone = mix(lam, band, .62*smoothstep(.5, 2.4, distance(vW, uCam))*smoothstep(.08,.26,slope));
  // 高度明暗：低处（岸、平原）留白，山体随高度积墨；峰脊再提亮
  float alt = smoothstep(.03, .55, vW.y);
  tone = clamp(tone * (1.06 - .62*alt) + .06*alt, 0., 1.);
  float ridge = 1.-smoothstep(-8., -2., vCurv);
  float gully = smoothstep(1.5, 9., vCurv);
  // 皴：陡坡竖向（披麻），缓坡沿等高线（折带）
  float ang = atan(n.z, n.x);
  float cun = mix(cunTex(vW.xz * 2.4, ang + 1.57) * .5, cunTex(vec2(vW.x*5. + vW.z*4., vW.y*16.), ang), smoothstep(.18,.55,slope));
  cun *= smoothstep(.10,.30,slope) * (1. - .7*ridge) * smoothstep(7.5, 4.5, distance(vW, uCam));
  // 高度分层：青绿罩染越往上越青
  float hgt = max(vW.y, 0.);
  float qlAmt = smoothstep(.025,.075,hgt) * (1.-.45*ridge) * (.55+.45*tone);
  float qlMix = smoothstep(.10,.34,hgt + .03*fbm3(vW.xz*3.));
  float near = smoothstep(1.1, 3.4, distance(vW, uCam));       // 0 贴脸 .. 1 远处
  float ink = .035 + .52*(1.-tone) + .26*pow(slope,1.1) + .26*gully + .20*cun;
  ink *= mix(.34, 1., near);
  gully *= near;
  ink *= 1. - .65*ridge;
  ink *= smoothstep(-.004,.020,vW.y);
  ink *= .35 + .85*alt;                    // 平地留白，山体积墨
  ink = clamp(ink, 0., 1.1);
  float ochre = .34*(1.-tone)*smoothstep(0.,.22,slope) + .30*(1.-smoothstep(.0,.09,hgt));
  // 岛色：低处一层极淡的区域色，让七区各自呼吸
  vec3 kreg = uKReg[clamp(isle,0,NISLE-1)];
  float regAmt = .085 * smoothstep(.0,.06,hgt) * (1.-.5*ridge) * (.6+.4*tone);
  oPig = vec4(ink, ochre, qlMix, qlAmt);
  oPig.rgb += kreg * regAmt;
  oNrm = vec4(n*.5+.5, (float(isle)+.5)/255.);
}`;
  const pT = prog(VS_T, FS_T, 'terrain');
  const VS_W = `#version 300 es
layout(location=0) in vec2 aPos; uniform mat4 uVP; out vec3 vW; out vec3 vN; out float vCurv;
void main(){ vW = vec3(aPos.x*7., 0., aPos.y*7.); vN = vec3(0,1,0); vCurv = 0.; gl_Position = uVP*vec4(vW,1.); }`;
  const FS_W = `#version 300 es
precision highp float;
layout(location=0) out vec4 oPig;
layout(location=1) out vec4 oNrm;
void main(){ oPig = vec4(0.); oNrm = vec4(.5,1.,.5,1.); }`;
  const pW = prog(VS_W, FS_W, 'water');

  /* ---------- Pass 2：合成 ---------- */
  const VS_Q = `#version 300 es
layout(location=0) in vec2 aPos; out vec2 vUv; void main(){vUv=aPos*.5+.5; gl_Position=vec4(aPos,0.,1.);}`;
  const FS_C = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uPig, uNrm, uDep, uH;
uniform mat4 uInvVP; uniform vec3 uCam; uniform vec2 uRes;
uniform float uTime, uNear, uFar, uExt, uNight, uLevel, uCloudBias, uDbg, uSeason;
uniform vec4 uPhenom;      // x 种类(1 蜃楼 2 星陨 3 鲸落 4 极光 5 霞光) y 淡入淡出 z 相位 w 目标 yaw
uniform vec3 uPaper, uKInk, uKOchre, uKGreen, uKBlue, uFogCol, uSunDir, uSeal;
${NOISE}
float lin(float d){ float z=d*2.-1.; return 2.*uNear*uFar/(uFar+uNear-z*(uFar-uNear)); }
vec3 world(vec2 uv, float d){ vec4 p = uInvVP*vec4(uv*2.-1., d*2.-1., 1.); return p.xyz/p.w; }
float hTex(vec2 xz){ return texture(uH, (xz/uExt)*.5+.5).r; }
const mat3 SX = mat3(-1,-2,-1, 0,0,0, 1,2,1);
const mat3 SY = mat3(-1,0,1, -2,0,2, -1,0,1);
bool NIGHT(){ return uNight > .5; }

// —— 光：线性空间。昼为低角度暖阳（金色时刻），夜为冷月 ——
vec3 sunCol(){ return NIGHT() ? vec3(.40,.50,.74)*1.25 : vec3(1.00,.80,.56)*2.25; }
vec3 skyAmb(){ return NIGHT() ? vec3(.030,.042,.075) : vec3(.27,.37,.53); }
vec3 hazeCol(vec3 rd){
  float s = pow(max(dot(rd, uSunDir), 0.), 5.);
  return NIGHT() ? mix(vec3(.020,.028,.050), vec3(.075,.090,.130), s)
                 : mix(vec3(.60,.69,.78), vec3(1.10,.86,.62), s);
}
vec3 skyCol(vec3 rd){
  float y = rd.y;
  float sd = max(dot(rd, uSunDir), 0.);
  if (NIGHT()){
    vec3 c = mix(vec3(.018,.026,.050), vec3(.003,.005,.013), smoothstep(0., .6, y));
    c += vec3(.16,.20,.30)*pow(sd, 20.)*.55 + vec3(.40,.45,.55)*pow(sd, 300.)*.6;
    c += vec3(1.0,.98,.92)*smoothstep(.99935, .99960, sd)*3.0;
    vec2 sp = rd.xz/(rd.y + .62) * 62.; vec2 cell = floor(sp); float hh = h21(cell);
    vec2 c2 = fract(sp) - .5 - (vec2(h21(cell + 3.1), h21(cell + 7.7)) - .5)*.6;
    float st = step(.88, hh) * (1. - smoothstep(0., .09, length(c2))) * (.55 + .45*sin(uTime*.0012 + hh*40.));
    c += vec3(.85,.88,1.)*st*smoothstep(.05, .30, y)*(1. - smoothstep(.97, .995, sd))*.9;
    // 银河：一条极淡的斜带
    float mw = exp(-pow((rd.x*.8 + rd.z*.6 - rd.y*.35)*3.2, 2.)) * fbm3(rd.xz*7.);
    c += vec3(.10,.12,.20)*mw*smoothstep(.1, .5, y)*.5;
    c = mix(c, hazeCol(rd), (1. - smoothstep(.0, .14, y))*.9);
    return c;
  }
  vec3 zen = vec3(.16,.32,.62), hor = vec3(.70,.78,.84);
  vec3 c = mix(hor, zen, pow(smoothstep(0., 1., max(y, 0.)), .55));
  c = mix(c, vec3(1.10,.82,.56), pow(sd, 4.)*.55*(1. - smoothstep(.0, .55, y)));
  c += vec3(1.0,.82,.58)*pow(sd, 48.)*.9 + vec3(1.4,1.2,.95)*smoothstep(.99900, .99945, sd)*7.;
  c = mix(c, hazeCol(rd), (1. - smoothstep(.0, .12, y))*.85);
  return c;
}
// 高度场软阴影：沿光线步进，记最小「离地高度 / 距离」
float shadowHF(vec3 p, vec3 L){
  float res = 1., t = .010;
  for (int i = 0; i < 22; i++){
    vec3 q = p + L*t;
    if (abs(q.x) > uExt || abs(q.z) > uExt || q.y > .95) break;
    float d = q.y - hTex(q.xz);
    res = min(res, 9.*d/t);
    if (res < .002) break;
    t += max(.010, t*.16);
  }
  return clamp(res, 0., 1.);
}
vec3 waterN(vec2 p, float tm){
  vec2 a1 = vec2(tm*.000110, tm*.000065), a2 = vec2(-tm*.000150, tm*.000090);
  float e = .006;
  float h0 = vn(p*8. + a1) + .55*vn(p*21. + a2) + .25*vn(p*55. - a1*1.7);
  float hx = vn((p+vec2(e,0.))*8. + a1) + .55*vn((p+vec2(e,0.))*21. + a2) + .25*vn((p+vec2(e,0.))*55. - a1*1.7);
  float hz = vn((p+vec2(0.,e))*8. + a1) + .55*vn((p+vec2(0.,e))*21. + a2) + .25*vn((p+vec2(0.,e))*55. - a1*1.7);
  return normalize(vec3(-(hx-h0)/e*.010, 1., -(hz-h0)/e*.010));
}
float cloudShade(vec3 p, vec3 L){
  // 低层云在地面与海面投下的影子
  float tc = (1.02 - p.y)/max(L.y, .05);
  vec2 cp = (p + L*tc).xz;
  float cn = fbm4(cp*3.0 + vec2(uTime*.000020, uTime*.000006)) + .22*fbm3(cp*8. - vec2(uTime*.000040, uTime*.000012));
  float cov = smoothstep(.60, .80, cn) * (1. - smoothstep(3.0, 7.5, length(cp)));
  return 1. - .55*cov*clamp(1. + uCloudBias, 0., 2.);
}
vec3 aces(vec3 x){ return clamp((x*(2.51*x + .03))/(x*(2.43*x + .59) + .14), 0., 1.); }

void main(){
  vec2 px = 1./uRes;
  float d0 = texture(uDep, vUv).r;
  float z0 = lin(d0);
  bool sky0 = d0 > .9999;

  // —— 轮廓：深度比 + 法线的 Sobel；只作极淡的勾边，保留一点画意 ——
  float th = mix(1.5, .8, smoothstep(3., 8., z0));
  float gxD=0., gyD=0., gxN=0., gyN=0.;
  for (int i=0;i<3;i++) for (int j=0;j<3;j++){
    vec2 uv = vUv + vec2(float(i-1),float(j-1))*th*px;
    float zd = lin(texture(uDep, uv).r) / max(z0, 1e-3);
    vec3 nn = texture(uNrm, uv).xyz;
    float nl = dot(nn, vec3(.33,.5,.17));
    gxD += SX[i][j]*zd; gyD += SY[i][j]*zd; gxN += SX[i][j]*nl; gyN += SY[i][j]*nl;
  }
  float line = max(smoothstep(.04, .14, length(vec2(gxD,gyD))), smoothstep(.10, .30, length(vec2(gxN,gyN)))*.7);

  vec4 pig = texture(uPig, vUv);
  vec4 nrm = texture(uNrm, vUv);
  vec3 wp = world(vUv, d0);
  vec3 rd = normalize(wp - uCam);
  bool water = nrm.a > .9;
  bool sky = sky0 && !water;
  float t = sky ? 60. : distance(wp, uCam);
  if (sky0 && rd.y < 0.) { sky = false; water = true; t = -uCam.y/min(rd.y, -1e-4); wp = uCam + rd*t; }
  vec3 L = normalize(uSunDir);
  vec3 col;

  if (sky) {
    col = skyCol(rd);
    // 远山三重：随视线方位起伏，空气透视让远层更淡更蓝
    vec2 dir = normalize(rd.xz + 1e-5);
    for (int k=2; k>=0; k--){
      float fl = float(k);
      float ridgeH = .006 + (.040 - .010*fl) * fbm4(dir*(5. + fl*3.) + fl*17.);
      ridgeH += .010*fbm3(dir*(14. + fl*5.) + fl*9.);
      float m = 1. - smoothstep(ridgeH - .0012, ridgeH + .0012, rd.y);
      vec3 rc = NIGHT() ? mix(vec3(.010,.014,.026), hazeCol(rd), .35 + .2*fl)
                        : mix(vec3(.20,.27,.34), hazeCol(rd), .38 + .22*fl);
      // 山体顶部受光
      rc += (NIGHT() ? vec3(.02,.025,.04) : vec3(.10,.08,.05)) * smoothstep(ridgeH - .010, ridgeH, rd.y);
      col = mix(col, rc, m*smoothstep(-.002, .004, rd.y + .002));
    }
  } else if (water) {
    // 高度场只覆盖 [-uExt, uExt]²；格外的海床读数是夹边常数，潮线与深浅都要在格边淡出
    float inGrid = 1. - smoothstep(uExt - .35, uExt - .02, max(abs(wp.x), abs(wp.z)));
    float sea = mix(-.40, hTex(wp.xz), inGrid);
    float depth = max(-sea, 0.);
    vec3 nW = waterN(wp.xz, uTime);
    float nearFade = 1. - smoothstep(2.5, 9.0, t);
    nW = normalize(mix(vec3(0.,1.,0.), nW, .35 + .65*nearFade));
    float cosI = max(dot(-rd, nW), 0.);
    float F = .02 + .98*pow(1. - cosI, 5.);
    vec3 shallow = NIGHT() ? vec3(.025,.060,.075) : vec3(.20,.55,.52);
    vec3 deep    = NIGHT() ? vec3(.006,.014,.026) : vec3(.020,.105,.165);
    vec3 body = mix(shallow, deep, 1. - exp(-depth*7.));
    float csh = cloudShade(wp, L);
    vec3 lit = body * (skyAmb()*.9 + sunCol()*max(L.y, 0.)*.32*csh);
    vec3 R = reflect(rd, nW);
    vec3 refl = skyCol(vec3(R.x, abs(R.y), R.z));
    // 岛影：反射方向上若被陆地挡住，倒影压暗
    float occ = 0.;
    for (int i = 1; i < 6; i++){ vec3 q = wp + R*(float(i)*.06); occ = max(occ, step(q.y, hTex(q.xz))); }
    refl = mix(refl, refl*(NIGHT() ? .25 : .38), occ*.85);
    col = mix(lit, refl, F);
    float spec = pow(max(dot(R, L), 0.), NIGHT() ? 300. : 520.);
    col += sunCol()*spec*(NIGHT() ? 3.5 : 5.0)*shadowHF(wp + vec3(0., .002, 0.), L)*csh;
    // 岸边浪花 + 白描潮线（保留一点画意，极淡）
    float foam = (1. - smoothstep(.006, .030, depth)) * (.45 + .55*vn(wp.xz*60. + uTime*.00006));
    float ring = abs(fract(-sea*22. - uTime*.000028 + vn(wp.xz*2.2)*.18) - .5)*2.;
    float wave = (1. - smoothstep(0., .08, ring)) * smoothstep(.01, .30, depth) * nearFade * .35 * inGrid;
    foam *= inGrid;
    vec3 foamC = NIGHT() ? vec3(.10,.12,.16) : vec3(.95,.93,.88);
    col = mix(col, foamC, clamp(foam*.75 + wave*.25, 0., 1.)*nearFade);
  } else {
    // —— 地表：颜料通道 → 反照率（石、赭、石绿、石青、沙、岩顶） ——
    vec3 n = normalize(nrm.xyz*2. - 1.);
    float slope = 1. - n.y;
    float matF = nrm.a*255.;
    vec3 alb; float specK = 0., emis = 0.;
    if (matF > 99.5) {
      // 楼阁材质：0 石基 1 朱漆 2 青瓦 3 金顶 4 窗格
      int m = int(matF - 100. + .5);
      alb = m == 0 ? vec3(.40,.38,.34) : m == 1 ? vec3(.36,.045,.03) : m == 2 ? vec3(.040,.050,.065) : m == 3 ? vec3(.82,.58,.18) : vec3(.22,.12,.05);
      specK = m == 2 ? .30 : (m == 3 ? 1.4 : 0.);
      emis = m == 4 ? 1. : 0.;
    } else {
    vec3 stone = vec3(.34,.31,.27), ochre = vec3(.46,.27,.13);
    vec3 green = vec3(.08,.24,.07), azure = vec3(.035,.16,.27);
    alb = mix(stone, ochre, clamp(pig.g*1.25, 0., 1.));
    vec3 veg = mix(green, azure, clamp(pig.b, 0., 1.));
    alb = mix(alb, veg, clamp(pig.a*2.4, 0., 1.)*(1. - smoothstep(.45, .78, slope)));
    alb = mix(alb, vec3(.60,.52,.38), 1. - smoothstep(.0, .022, wp.y));
    alb = mix(alb, vec3(.70,.69,.66), smoothstep(.40, .58, wp.y + .05*vn(wp.xz*22.))*(1. - smoothstep(.50, .85, slope))*.65);
    alb *= (.80 + .38*vn(wp.xz*52.)) * (.88 + .24*vn(vec2(wp.x*30. + wp.z*24., wp.y*70.)));
    alb *= mix(1., .55, clamp(pig.r, 0., 1.)*.55);
    // 陡壁：岩色压深，带竖向岩纹
    alb = mix(alb, vec3(.20,.18,.16)*(.75 + .5*vn(vec2(wp.x*40. + wp.z*30., wp.y*9.))), smoothstep(.55, .85, slope)*.75);
    }
    if (NIGHT()) alb = mix(vec3(dot(alb, vec3(.30,.59,.11))), alb, .45) * vec3(.85,.92,1.08);   // 月下失色
    float ndl = max(dot(n, L), 0.);
    float sh = ndl > 0. ? shadowHF(wp + n*.004, L) : 0.;
    float hemi = n.y*.5 + .5;
    float ao = clamp(1. - pig.r*.50, .38, 1.);
    vec3 amb = skyAmb()*mix(.30, 1., hemi) + (NIGHT() ? vec3(.004,.005,.008) : vec3(.11,.09,.06))*(1. - hemi);
    sh *= cloudShade(wp, L);
    col = alb * (sunCol()*ndl*sh + amb*ao);
    if (specK > 0.) col += sunCol()*pow(max(dot(reflect(rd, n), L), 0.), 30.)*specK*sh;
    if (emis > 0.) col += (NIGHT() ? vec3(2.2,1.05,.38) : vec3(.10,.05,.02))*emis;
    // 逆光时植被透光（薄叶散射）
    float back = pow(max(dot(rd, L), 0.), 4.) * clamp(pig.a*2., 0., 1.);
    col += (NIGHT() ? vec3(0.) : vec3(.30,.36,.10)) * back * .25 * sh;
    // 岸线一圈湿沙暗边
    col *= mix(.72, 1., smoothstep(.0, .012, wp.y));
  }

  // —— 空气透视 + 贴海的雾（云海） ——
  vec3 hz = hazeCol(rd);
  if (!sky) {
    float a = NIGHT() ? .55 : .80, b = 9.;
    float hfog = (a/b)*exp(-uCam.y*b)*(1. - exp(-t*rd.y*b))/max(abs(rd.y), 1e-3);
    hfog = clamp(abs(hfog), 0., 1.);
    float mpatch = .55 + .9*fbm3(wp.xz*1.3 + vec2(uTime*.000016, -uTime*.000010));
    float dist = 1. - exp(-max(t - 2.6, 0.)*.050);
    float fog = clamp(dist + hfog*.55*mpatch, 0., 1.);
    col = mix(col, hz, fog);
    line *= 1. - fog;
  }

  // —— 云海：两层解析平面，顶亮底暗，近日处镶银边 ——
  for (int k=0; k<2; k++){
    float cy = k==0 ? 1.02 : 1.50;
    float tc = (cy - uCam.y)/rd.y;
    if (tc > 0. && (sky || tc < t)) {
      vec3 cp = uCam + rd*tc;
      vec2 wind = vec2(uTime*(k==0 ? .000020 : -.000012), uTime*.000006);
      float cn = fbm4(cp.xz*(k==0 ? 3.0 : 1.9) + wind) + .22*fbm3(cp.xz*8. - wind*2.);
      // 边缘侵蚀：高频噪声扰动覆盖率阈值，团块状轮廓变成碎边与丝缕
      float erode = fbm3(cp.xz*17. + wind*3.1) - .5;
      float lo = (k==0 ? .60 : .64) - .085*erode;
      float hi = (k==0 ? .80 : .84) - .115*erode;
      float cov = smoothstep(lo, hi, cn);
      // 云内薄处透光：覆盖率高的地方更实，边缘更淡，避免整团一个色
      float wisp = smoothstep(.05, .55, cov) * (1. - smoothstep(.62, .95, cn));
      cov *= 1. - smoothstep(3.0, 7.5, length(cp.xz));
      cov *= smoothstep(.0, .45, tc);
      // 与岛体交接：按距离连续淡出，不留直线切边
      if (!sky) cov *= smoothstep(.0, .55, t - tc);
      cov = clamp(cov*(1. + uCloudBias*1.8), 0., 1.);
      cov = clamp(cov*(k==0 ? .55 : .42), 0., 1.);
      float thick = smoothstep(.56, .95, cn);
      vec3 under = NIGHT() ? vec3(.03,.04,.07) : skyAmb()*.95 + vec3(.06,.05,.05);
      vec3 top = NIGHT() ? sunCol()*.20 : sunCol()*.38;
      vec3 cc = mix(top, under, thick*(uCam.y < cy ? .85 : .35));
      // 薄处带一点天光，厚处压暗；近太阳的低角处镶银边
      cc += (NIGHT() ? vec3(.02,.025,.04) : sunCol()*.10) * wisp;
      cc += sunCol()*pow(max(dot(rd, L), 0.), 10.)*(1. - thick)*(NIGHT() ? .25 : .45);
      float sheen = pow(max(dot(rd, L), 0.), 3.) * (1. - thick) * (1. - cov);
      cc += sunCol() * sheen * (NIGHT() ? .10 : .22);
      col = mix(col, cc, cov);
      line *= 1. - cov;
    }
  }

  // —— 勾边：极淡、远处消失 ——
  col *= 1. - clamp(line, 0., 1.)*(NIGHT() ? .25 : .30)*(1. - smoothstep(3., 9., t));

  // —— 异象（程序化，在线性空间里叠） ——
  if (uPhenom.x > .5 && uPhenom.y > .001) {
    float az = atan(rd.x, rd.z);
    float kk = uPhenom.x, f = uPhenom.y;
    vec2 phdir = normalize(rd.xz + 1e-5);
    float dz = abs(atan(sin(az - uPhenom.w), cos(az - uPhenom.w)));
    if (kk < 1.5) {
      // 海市蜃楼：远海浮起倒置的山影，竖向拉丝、下缘溶开
      float near = exp(-pow(dz*2.2, 2.));
      float base = .05 + .026*fbm3(phdir*3.2 + vec2(uPhenom.z*.7, 0.));
      float rise = .028 + .020*fbm3(phdir*7. + uPhenom.z) * smoothstep(base, base + .05, rd.y);
      float top = base + rise;
      float body = smoothstep(base, base + .012, rd.y) * (1. - smoothstep(top - .01, top, rd.y));
      float streak = .55 + .45*vn(vec2(az*34., rd.y*90. + uPhenom.z));
      float mirage = body * near * f * streak * .62;
      vec3 mcol = mix(hz*.60, hz*.30 + vec3(.05,.04,.03), smoothstep(base, top, rd.y));
      col = mix(col, mcol, clamp(mirage, 0., .5));
    } else if (kk < 2.5) {
      // 星陨：一点亮头带一条渐细的尾
      float y0 = .30 + .12*sin(uPhenom.z*.6);
      float slope = .55;
      float d = rd.y - (y0 - dz*slope);
      float head = exp(-pow(d*90., 2.)) * exp(-pow(dz*22., 2.));
      float tail = exp(-pow(d*40., 2.)) * smoothstep(.06, 0., dz) * (1. - smoothstep(.0, .22, dz));
      float k = (head * 2.6 + tail * .55) * f;
      col += vec3(1.35,1.28,1.10) * k;
      col += vec3(1.6,1.45,1.15) * head * head * f * .8;
    } else if (kk < 3.5) {
      // 鲸落：水下一团缓移的冷光，带两道散开的圈
      if (water) {
        vec2 d2 = wp.xz - vec2(uPhenom.w);
        float glow = exp(-pow(length(d2)*2.0, 2.));
        float ring = exp(-pow((length(d2) - .18)*26., 2.)) * .5 + exp(-pow((length(d2) - .34)*30., 2.)) * .28;
        col += vec3(.07,.21,.30) * (glow*.55 + ring) * f * (.85 + .15*sin(uPhenom.z*3. + length(d2)*9.));
      }
    } else if (kk < 4.5) {
      // 极光：三条高度错开的帘幕，各自垂向抖动
      if (NIGHT()) {
        for (int j=0; j<3; j++){
          float fj = float(j);
          float yb = .30 + fj*.045 + .02*sin(az*2.2 + uPhenom.z*.8 + fj*1.7);
          float band = exp(-pow((rd.y - yb)*16., 2.));
          float curtain = .55 + .45*vn(vec2(az*9. + uPhenom.z*1.3 + fj*4., rd.y*8.));
          float mask = exp(-pow(dz*1.1, 2.));
          vec3 ac = j==1 ? vec3(.05,.26,.20) : vec3(.06,.18,.24);
          col += ac * band * curtain * mask * f * (.55 - fj*.10);
        }
      }
    } else {
      // 霞光：贴近地平线的暖光，越往上越淡，夹着云缝
      // 三处都用连续衰减（方位角、上缘、下缘），硬阈值会在光弱时露出方块边
      float near = exp(-pow(dz*2.1, 2.));
      float lift = (1. - smoothstep(.06, .34, rd.y)) * smoothstep(-.02, .05, rd.y);
      float seam = .55 + .45*fbm3(vec2(az*5., rd.y*22.) + uPhenom.z*.6);
      vec3 warm = mix(vec3(1.05,.58,.34), vec3(1.30,.86,.52), smoothstep(.0, .16, rd.y));
      col = mix(col, warm, lift * near * seam * f * .55);
      col += vec3(.55,.24,.10) * exp(-pow((rd.y - .04)*18., 2.)) * near * f * .28;
    }
  }
  if (uDbg > .5 && uDbg < 1.5) { o = vec4(pig.rgba); return; }

  // —— 成片：曝光 → ACES → 伽马 → 分离调色 → 暗角 → 颗粒 ——
  col *= NIGHT() ? 1.55 : .80;
  col = aces(col);
  col = pow(col, vec3(1./2.2));
  // —— 四时：整幅画的调子随季候挪一点（1 春 2 夏 3 秋 4 冬） ——
  if (uSeason > .5) {
    float lum0 = dot(col, vec3(.2126,.7152,.0722));
    vec3 tint = uSeason < 1.5 ? vec3(.94, 1.03, .98)
              : uSeason < 2.5 ? vec3(1.03, 1.00, .94)
              : uSeason < 3.5 ? vec3(1.06, .99, .90)
                              : vec3(.95, .98, 1.06);
    col = mix(vec3(lum0), col, uSeason < 3.5 ? (uSeason < 1.5 ? 1.04 : 1.10) : .78) * tint;
  }
  // —— 天候：春落花、秋落叶、冬飞雪；夏不落物，只让天光更亮 ——
  if (uSeason > .5 && abs(uSeason - 2.) > .1) {
    vec2 sp = gl_FragCoord.xy / uRes;
    float t = uTime * .00022;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float cellH = 0.085 + fi * .03;
      vec2 q = vec2(sp.x * 7.0 + sin(sp.y * 5.0 + t * 3.0 + fi) * .35 + t * (fi + 1.) * 4.0,
                    sp.y * (1.0 / cellH) + t * (2.2 + fi));
      vec2 id = floor(q); vec2 f = fract(q) - .5;
      float h = h21(id + fi * 17.3);
      float keep = step(.90, h);
      float r = length(f - vec2((h21(id + 3.1) - .5) * .6, (h21(id + 7.7) - .5) * .6));
      float dotSize = .10 + .06 * h21(id + 5.5);
      float flake = (1. - smoothstep(dotSize * .5, dotSize, r)) * keep * smoothstep(.10, .55, sp.y);
      float a = flake * (uSeason < 1.5 ? .55 : uSeason < 3.5 ? .60 : .72);
      vec3 tint = uSeason < 1.5 ? vec3(.98,.86,.90) : uSeason < 3.5 ? vec3(.86,.55,.26) : vec3(.95,.97,1.0);
      col = mix(col, tint, a);
      if (uSeason > 3.5) col += vec3(.10,.11,.13) * flake * smoothstep(.6, 1., r) * .4;
    }
  } else if (uSeason > 1.5 && uSeason < 2.5) {
    col *= NIGHT() ? 1.0 : 1.035;          // 夏日天光更亮
  }
  float lum = dot(col, vec3(.2126,.7152,.0722));
  vec3 shadowT = NIGHT() ? vec3(.92,.98,1.10) : vec3(.94,1.00,1.04);
  vec3 highT = NIGHT() ? vec3(1.02,1.00,.96) : vec3(1.04,1.00,.93);
  col *= mix(shadowT, highT, smoothstep(.2, .8, lum));
  vec2 q = vUv - .5; col *= 1. - .30*dot(q, q)*1.6;
  col += (h21(gl_FragCoord.xy + fract(uTime*.0007)*91.) - .5)*.018;
  o = vec4(clamp(col, 0., 1.), 1.);
}`;

  const pC = prog(VS_Q, FS_C, 'composite');
  window.__pC = pC; window.__gl = gl; window.__phase = 'pC-ok';

  /* ---------- Pass 3：地标印章（实例化，屏幕恒定大小，手动遮挡） ---------- */
  const VS_M = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 aA;   // xyz 世界，w = 图集格（-1 显示纹样）
layout(location=2) in vec4 aB;   // x 尺寸px(=0 隐) y 类型 z 高亮 0..1 w 淡化倍率
uniform mat4 uVP; uniform vec2 uRes; uniform float uDPR;
out vec2 vUv; out float vCell; out float vZ; out float vType; out float vOn; out float vDim; out float vS;
void main(){
  vec4 c = uVP*vec4(aA.xyz,1.);
  float px = aB.x*(1. + .28*aB.z);
  c.xy += aPos*px/uRes*2.*c.w;
  vUv = aPos*.5+.5; vCell = aA.w; vType = aB.y; vZ = c.z/c.w*.5+.5; vOn = aB.z; vDim = aB.w; vS = px;
  gl_Position = aB.x <= 0. ? vec4(2.,2.,2.,2.) : c;
}`;
  const FS_M = `#version 300 es
precision highp float;
in vec2 vUv; in float vCell; in float vZ; in float vType; in float vOn; in float vDim; in float vS;
out vec4 o;
uniform sampler2D uAtlas, uDep; uniform vec2 uRes; uniform float uNight, uGrid; uniform vec3 uSeal, uPaper;
${NOISE}
void main(){
  vec2 p = vUv*2.-1.; float r = length(p), ang = atan(p.y, p.x);
  // 总览时不画印章，画「灵灯」：一粒暖光点 + 柔光晕；悬停 / 聚焦才展开成带标识的印
  if (vOn < .5 && vS < 19.5) {
    float sz = texture(uDep, gl_FragCoord.xy/uRes).r;
    float vis0 = mix(.30, 1., step(vZ - .0006, sz));
    float core = 1. - smoothstep(.15, .28, r);
    float halo = exp(-r*r*6.0) * (uNight > .5 ? .80 : .62);
    vec3 cCore = uNight > .5 ? vec3(1., .94, .80) : vec3(1., .97, .88);
    vec3 cHalo = uNight > .5 ? vec3(1., .64, .28) : mix(uSeal, vec3(.98, .66, .24), .55);
    vec3 c = mix(cHalo, cCore, core);
    float a = clamp(core + halo*(1. - core), 0., 1.) * vis0 * (1. - vDim*.75);
    if (a < .004) discard;
    o = vec4(c, a);
    return;
  }
  float aa = fwidth(r)*1.15, px = fwidth(r);
  float disc = 1.-smoothstep(1.-aa, 1., r);
  float sceneZ = texture(uDep, gl_FragCoord.xy/uRes).r;
  float vis = mix(.26, 1., step(vZ - .0006, sceneZ));
  if (disc <= 0.) discard;
  // 印泥底 + 纸面 + 图集内容
  float inner = 1.-smoothstep(.70-aa, .72, r);
  float ring = smoothstep(.74-aa,.74,r) - smoothstep(.90,.90+aa,r);
  vec3 col = mix(mix(uPaper*1.02, uPaper, .4), uSeal, ring*.92);
  // 纸面阴刻：细内圈
  float hair = smoothstep(.69-aa,.69,r)*inner;
  col = mix(col, uSeal, hair*.45);
  if (vCell >= 0.) {
    vec2 g = (vec2(mod(vCell, 16.), floor(vCell/16.)) + vec2(vUv.x, 1.-vUv.y)) / 16.;
    vec4 g4 = texture(uAtlas, g);
    col = mix(col, mix(uPaper, g4.rgb, 1.), inner * g4.a);
    // 有图的格子：淡纸底，免得深色 logo 糊死
    col = mix(col, uPaper*.985, inner*(1.-g4.a)*.9);
  } else {
    // 纹样：玉璧 / 碑 / 旗 / 卷 / 帆 / 灯
    float m = 0.;
    if (vType > .5 && vType < 1.5) {           // 玉璧
      m = smoothstep(.30, .33, r) * (1.-smoothstep(.56,.59,r)) + (1.-smoothstep(.12,.15,r));
    } else if (vType > 1.5 && vType < 2.5) {   // 碑
      m = step(abs(p.x), .24) * step(abs(p.y), .58);
    } else if (vType > 2.5 && vType < 3.5) {   // 旗
      m = step(abs(p.x), .035) * step(p.y, .6) * step(-.6, p.y) + step(.025, p.x)*step(p.x,.46)*step(-.56,p.y)*step(p.y,.02);
    } else if (vType > 3.5 && vType < 4.5) {   // 卷
      m = step(abs(p.y), .30) * step(abs(p.x), .52) * (1.-step(.05, abs(abs(p.x)-.52)));
    } else if (vType > 4.5 && vType < 5.5) {   // 帆
      m = step(p.y, .58) * step(-.60, p.y) * step(abs(p.x - p.y*.55), .26) + step(abs(p.x), .03);
    } else {                                    // 灯
      m = 1.-smoothstep(.34,.38,r);
    }
    col = mix(col, uSeal, m*inner*.9);
  }
  col = mix(col, mix(col, vec3(dot(col, vec3(.33,.34,.33)))*.55, .6), vOn*.3);
  col = mix(col, uPaper, vDim*.10);
  o = vec4(col*disc*vis, disc*vis*(1.-.18*vDim));
}`;
  const pM = prog(VS_M, FS_M, 'marks');

  /* ---------- 氛围精灵：鹤 / 萤 / 灯 / 远帆 / 鲲 ---------- */
  const VS_S = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 aA;   // xyz 世界
layout(location=2) in vec4 aB;   // 种类 尺寸px 相位 透明度
layout(location=3) in vec4 aC;   // rgb 着色
uniform mat4 uVP; uniform vec2 uRes;
out vec2 vUv; out float vKind; out float vPh; out float vAl; out float vZ; out vec3 vCol; out float vPx;
void main(){
  vec4 c = uVP*vec4(aA.xyz,1.);
  c.xy += aPos*aB.y/uRes*2.*c.w;
  vUv = aPos*.5+.5; vKind = aB.x; vPh = aB.z; vAl = aB.w; vZ = c.z/c.w*.5+.5; vCol = aC.rgb;
  vPx = aB.y;
  gl_Position = aB.y <= 0. ? vec4(2.,2.,2.,2.) : c;
}`;
  const FS_S = `#version 300 es
precision highp float;
in vec2 vUv; in float vKind; in float vPh; in float vAl; in float vZ; in vec3 vCol; in float vPx;
out vec4 o;
uniform sampler2D uDep; uniform vec2 uRes; uniform vec3 uInk; uniform float uNight, uTime;
void main(){
  vec2 p = vUv*2.-1.;
  float sceneZ = texture(uDep, gl_FragCoord.xy/uRes).r;
  float vis = mix(.35, 1., step(vZ-.001, sceneZ));
  float a = 0.; vec3 col = uInk;
  if (vKind < .5) {            // 鹤：两翅一笔，随相位扇动
      float wing = sin(vPh + uTime*.004)*.35;
      float body = 1.-smoothstep(.06,.12, length(p*vec2(1.,2.2)));
      float wl = 1.-smoothstep(.02,.05, abs(p.y - wing*abs(p.x) - .06 + abs(p.x)*.22));
      float wr = 1.-smoothstep(.02,.05, abs(p.y + wing*abs(p.x) - .06 + abs(p.x)*.22));
      a = body + (wl + wr)*step(abs(p.x), .9)*(1.-step(.62,abs(p.x)))*.9;
  } else if (vKind < 1.5) {   // 萤
      float g = exp(-length(p)*3.2);
      col = mix(vec3(.95,.72,.28), vec3(.80,.92,.55), uNight);
      a = g * (.55+.45*sin(vPh + uTime*.0025)) * (uNight>.5 ? 1. : .25);
  } else if (vKind < 2.5) {   // 舟灯
      float g = exp(-length(p)*3.4);
      col = uNight > .5 ? vec3(.98,.78,.40) : vec3(.62,.30,.16);
      a = g * .8;
  } else if (vKind < 3.5) {   // 远帆：船身一弯 + 两面竹骨帆
      float aa = fwidth(p.x)*1.5;
      float hull = (1.-smoothstep(-aa, aa, abs(p.y + .52 - .10*p.x*p.x) - .07)) * (1.-smoothstep(.70-aa, .70+aa, abs(p.x)));
      vec2 q1 = p - vec2(-.16, .02), q2 = p - vec2(.30, -.06);
      float s1 = step(abs(q1.x + q1.y*.18), .22) * step(-.42, q1.y) * step(q1.y, .50 - .25*q1.x);
      float s2 = step(abs(q2.x + q2.y*.18), .16) * step(-.40, q2.y) * step(q2.y, .30 - .25*q2.x);
      float batt = .80 + .20*step(.5, fract((p.y + .5)*6.));
      a = max(hull, max(s1, s2)*.85*batt);
      col = uNight > .5 ? vec3(.10,.12,.16) : uInk*.9;
  } else if (vKind < 4.5) {   // 鲲：极淡的一道弧影
      float y = p.y - (.28*sin(p.x*2.2 + vPh*.2) - .10);
      a = (1.-smoothstep(.02,.10,abs(y))) * step(abs(p.x), .95) * .7;
  } else if (vKind < 5.5) {   // 圣兽：名字决定形态，用 vPh 取模分七种
      int f = int(mod(floor(vPh), 7.));
      if (f == 0) {           // 驮山兽：厚重的一团，慢慢起伏
        float b = 1.-smoothstep(.38,.58, length(p*vec2(.62,1.25)));
        float leg = (1.-smoothstep(.05,.10, abs(abs(p.x)-.32)-.02)) * smoothstep(-.35,-.55,p.y) * .5;
        a = clamp(b*.85 + leg, 0., 1.);
      } else if (f == 1) {    // 白泽：独角鹿
        float body = 1.-smoothstep(.16,.26, length((p-vec2(0.,-.05))*vec2(1.5,1.)));
        float neck = (1.-smoothstep(.05,.10, abs(p.x-.30+p.y*.55)-.04)) * smoothstep(-.05,-.20,p.y) * .9;
        float horn = (1.-smoothstep(.02,.06, abs(p.x-.44+p.y*.9)-.03)) * smoothstep(.25,.40,p.y) * .9;
        a = clamp(body + neck + horn, 0., 1.);
      } else if (f == 2) {    // 鲲：只留一道背脊
        float y = p.y - (.34*sin(p.x*1.6 + vPh*.3) - .06);
        a = (1.-smoothstep(.03,.12,abs(y))) * step(abs(p.x), .98) * .8;
      } else if (f == 3) {    // 赑屃：龟背上驮一块碑
        float shell = 1.-smoothstep(.30,.42, length((p-vec2(0.,-.18))*vec2(1., .72)));
        float stel = (1.-smoothstep(.12,.15, abs(p.x))) * smoothstep(.62,.52, p.y) * smoothstep(-.02,-.08, p.y) * .7;
        a = clamp(shell*.85 + stel, 0., 1.);
      } else if (f == 4) {    // 青鸟：三足，双翼展开
        // 原来两笔直斜线交叉成一个 X，远看像划掉了岛名。改为带渐细的翼形
        float tL = 1. - smoothstep(.0, .52, abs(p.x + .18));
        float tR = 1. - smoothstep(.0, .52, abs(p.x - .18));
        float wL = .012 + .075 * tL;
        float wR = .012 + .075 * tR;
        float wingL = (1. - smoothstep(0., wL, abs(p.y + p.x * .42 + .10))) * step(-.86, p.x) * step(p.x, .10);
        float wingR = (1. - smoothstep(0., wR, abs(p.y - p.x * .42 + .10))) * step(-.10, p.x) * step(p.x, .86);
        float body = 1. - smoothstep(.04, .10, length(p * vec2(2.4, 1.1)));
        a = clamp(max(wingL, wingR) * .82 + body, 0., 1.);
      } else if (f == 5) {    // 蠹鱼：细长游动的银鳞
        float y = p.y - (.10*sin(p.x*7. + vPh*.6));
        a = (1.-smoothstep(.02,.05, abs(y))) * step(abs(p.x), .8);
      } else {                // 风狸：一道掠过的风痕
        a = (1.-smoothstep(.0,.10, abs(p.y - .12*sin(p.x*3. + vPh*.5)))) * (1.-smoothstep(.1,.9,abs(p.x))) * .7;
      }
      col = uNight > .5 ? vec3(.72,.74,.78) : uInk;
      a *= 1.15;
  } else if (vKind < 6.5) {   // 宗门楼阁：檐线为主，屋身半透，幡随风动
      a = 0.;
      float aa = fwidth(p.x) * 1.2;
      // 一层檐：抛物线外挑
      float y1 = -.06 + .46*pow(abs(p.x), 2.2);
      float e1 = 1.-smoothstep(.015, .015+aa, abs(p.y - y1));
      // 檐上短脊（只在中段）
      float e1b = (1.-smoothstep(.06,.07,abs(p.x))) * step(y1, p.y) * step(p.y, y1 + .13);
      // 二层檐
      float y2 = .16 + .52*pow(abs(p.x), 2.2);
      float e2 = (1.-smoothstep(.015, .015+aa, abs(p.y - y2))) * (1.-smoothstep(.40,.46,abs(p.x)));
      // 屋身：两层之间的淡块
      float body = (1.-smoothstep(.17,.20,abs(p.x))) * (1.-smoothstep(.06,.10,p.y)) * smoothstep(-.30,-.24, p.y) * .55;
      // 幡：一条竖杆加飘带
      float fxx = .30;
      float pole = (1.-smoothstep(.008,.016,abs(p.x - fxx))) * step(.10, p.y) * step(p.y, .90);
      float cloth = (1.-smoothstep(.05,.09, abs(p.x - fxx - .11 - .04*sin(p.y*7. + uTime*.002)))) * step(.34, p.y) * step(p.y, .78) * .8;
      a = clamp(max(max(e1, e2*.95), max(body, max(pole, cloth))), 0., 1.);
      col = mix(vCol, vec3(.30,.20,.12), .25);
      o = vec4(col*a*vis*vAl*1.0, a*vis*vAl*1.0);
      return;
  } else {                    // 秘境：一圈极淡的光环 + 裂缝
      float r = length(p);
      float sw = atan(p.y, p.x) + r*6. - uTime*.0008;
      float swirl = (.5 + .5*sin(sw*3.)) * exp(-r*r*3.2);
      a = exp(-r*r*7.)*.55 + swirl*.25;
      col = mix(vCol, vec3(1.), .35);
  }
  a = clamp(a, 0., 1.);
  // 楼阁在远距离只剩几条檐线，压成一道黑杠；小于 9px 时整体淡出
  if (vKind > 5.5 && vKind < 6.5) a *= smoothstep(6.0, 13.0, vPx);
  o = vec4(col*a*vis*vAl, a*vis*vAl);
}`;
  const pS = prog(VS_S, FS_S, 'sprites');

  /* ---------- 山道 / 航道 / 瀑布（实例化屏幕空间带状） ---------- */
  const VS_R = `#version 300 es
layout(location=1) in vec4 aA;   // 起点 xyz
layout(location=2) in vec4 aB;   // 终点 xyz
layout(location=3) in vec4 aC;   // 宽px 透明度 类型 标记
layout(location=4) in vec4 aD;   // 控制点 xyz
layout(location=5) in vec3 aE;   // 线色
uniform mat4 uVP; uniform vec2 uRes;
out float vT; out float vSide; out float vKind; out float vMark; out float vZ; out vec3 vCol;
void main(){
  // 二次贝塞尔：起点 → 控制点 → 终点，17 个顶点连成一条弧
  float t = float(gl_VertexID) / 16.;
  vec3 w = mix(mix(aA.xyz, aD.xyz, t), mix(aD.xyz, aB.xyz, t), t);
  vec4 c = uVP*vec4(w, 1.);
  gl_Position = c;
  vT = t; vSide = 0.; vKind = aC.z; vMark = aC.w; vZ = c.z/c.w*.5+.5; vCol = aE;
}`;
  const FS_R = `#version 300 es
precision highp float;
in float vT; in float vSide; in float vKind; in float vMark; in float vZ; in vec3 vCol;
out vec4 o;
uniform sampler2D uDep; uniform vec2 uRes; uniform float uTime, uNight;
uniform vec3 uInk, uSeal;
${NOISE}
void main(){
  // 被山挡住的段落淡到三成
  float sceneZ = texture(uDep, gl_FragCoord.xy/uRes).r;
  float vis = mix(.30, 1., step(vZ - .0008, sceneZ));
  float a = (.35 + .65*sin(3.14159*vT)) * vis;   // 两端淡出
  vec3 col = vCol;
  if (vKind > .5 && vKind < 1.5) {           // 瀑布：断断续续
    a *= .55 + .45*sin(vT*24. - uTime*.004);
    col = mix(uInk, uSeal, .25);
  } else if (vKind > 1.5) {                   // 云瀑
    a *= .5 + .5*vn(vec2(vT*9., uTime*.0012));
  }
  o = vec4(col, a);
}`;
  const pR = prog(VS_R, FS_R, 'ribbons');

  /* ---------- 宗门楼阁：真三维塔阁，写进同一张 G-buffer，与地形同光 ---------- */
  const VS_B = `#version 300 es
layout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in float aM;
uniform mat4 uVP; out vec3 vN; flat out float vM;
void main(){ vN = aN; vM = aM; gl_Position = uVP*vec4(aP, 1.); }`;
  const FS_B = `#version 300 es
precision highp float;
in vec3 vN; flat in float vM;
layout(location=0) out vec4 oPig; layout(location=1) out vec4 oNrm;
void main(){ vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; oPig = vec4(0.); oNrm = vec4(n*.5 + .5, (100. + vM + .5)/255.); }`;
  const pB = prog(VS_B, FS_B, 'pagoda');
  let vaoPag = null, pagCount = 0;
  function buildPagodas() {
    const Pp = [], Nn = [], Mm = [];
    const tri = (a, b, c, m) => {
      const n = norm3(cross3(sub3(b, a), sub3(c, a)));
      Pp.push(...a, ...b, ...c); Nn.push(...n, ...n, ...n); Mm.push(m, m, m);
    };
    const quad = (a, b, c, d, m) => { tri(a, b, c, m); tri(a, c, d, m); };
    // 层数按宗门性格：学宫高塔、藏经书阁、驿路小亭
    const TIERS = { company: 3, lab: 5, model: 3, benchmark: 2, job: 2, resource: 4, news: 1 };
    for (const sc of SECTS) {
      const tiers = TIERS[sc.w] || 3;
      const s = sc.w === 'news' ? .024 : .032;
      const yaw = ((sc.x * 7.3 + sc.z * 3.1) % 6.283 + 6.283) % 6.283;
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const baseY = Math.max(0, hAt(sc.x, sc.z));
      const W_ = (lx, ly, lz) => [sc.x + lx * cs - lz * sn, baseY + ly, sc.z + lx * sn + lz * cs];
      const box = (hw, y0, y1, m) => {
        const c = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]];
        for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; quad(W_(a[0], y0, a[1]), W_(b[0], y0, b[1]), W_(b[0], y1, b[1]), W_(a[0], y1, a[1]), m); }
        quad(W_(-hw, y1, -hw), W_(hw, y1, -hw), W_(hw, y1, hw), W_(-hw, y1, hw), m);
      };
      const roof = (r, y, rIn, yTop, lift, m) => {
        const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (let i = 0; i < 4; i++) {
          const a = C[i], b = C[(i + 1) % 4];
          const A = W_(a[0] * r, y + lift, a[1] * r), B = W_(b[0] * r, y + lift, b[1] * r);   // 翘角
          const Mi = W_((a[0] + b[0]) / 2 * r, y - lift * .3, (a[1] + b[1]) / 2 * r);       // 檐口中段下垂
          const Ai = W_(a[0] * rIn, yTop, a[1] * rIn), Bi = W_(b[0] * rIn, yTop, b[1] * rIn);
          tri(A, Mi, Ai, m); tri(Mi, B, Bi, m); tri(Mi, Bi, Ai, m);
        }
        const yy = y - lift * .1;
        quad(W_(-r * .92, yy, -r * .92), W_(r * .92, yy, -r * .92), W_(r * .92, yy, r * .92), W_(-r * .92, yy, r * .92), m);
      };
      let y = s * .20;
      box(s * 1.0, -.04, y, 0);                       // 石台基（埋进地里，免得悬空）
      box(s * .80, y, y + s * .08, 0); y += s * .08;
      for (let i = 0; i < tiers; i++) {
        const k = 1 - i * (tiers > 3 ? .12 : .17);
        const hw = s * .50 * k, h = s * (i === 0 ? .66 : .48) * k;
        box(hw, y, y + h * .70, 1);                   // 朱漆柱身
        box(hw * .985, y + h * .70, y + h, 4);        // 窗格一圈（夜里亮）
        y += h;
        roof(hw + s * .34 * k, y, hw * .50, y + s * .22 * k, s * .08 * k, 2);
        y += s * .14 * k;
      }
      const fb = s * .06, ft = y + s * .06, tip = W_(0, ft + s * .40, 0);
      box(fb * 1.3, y, ft, 3);
      const Cn = [[-fb, -fb], [fb, -fb], [fb, fb], [-fb, fb]];
      for (let i = 0; i < 4; i++) { const a = Cn[i], b = Cn[(i + 1) % 4]; tri(W_(a[0], ft, a[1]), W_(b[0], ft, b[1]), tip, 3); }
      sc.top = baseY + ft + s * .2;
    }
    pagCount = Pp.length / 3;
    if (vaoPag) gl.deleteVertexArray(vaoPag);
    vaoPag = gl.createVertexArray(); gl.bindVertexArray(vaoPag);
    const mk = (arr, loc, n) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0); };
    mk(Pp, 0, 3); mk(Nn, 1, 3); mk(Mm, 2, 1);
    gl.bindVertexArray(null);
  }

  /* ================= 缓冲 ================= */
  const quadGeo = new Float32Array([-1, -1, 3, -1, -1, 3]);           // 全屏三角
  const stripGeo = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);    // 实例化用的单位方
  let vaoGrid, vaoQuad, vaoMark, vaoSprite, vaoRib;
  let markInst = null, spriteInst = null, ribInst = null, markBuf = null, spriteBuf = null, ribBuf = null;
  const RIB_COL = [];
  let ribColBuf = null, ribColData = new Float32Array(LNS * 3);
  const MAX_MARK = 420, MAX_SPRITE = 420, MAX_RIB = LNS;

  function initBuffers() {
    vaoQuad = gl.createVertexArray(); gl.bindVertexArray(vaoQuad);
    let b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, quadGeo, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    vaoMark = gl.createVertexArray(); gl.bindVertexArray(vaoMark);
    b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, stripGeo, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    markInst = new Float32Array(MAX_MARK * 8);
    markBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, markBuf); gl.bufferData(gl.ARRAY_BUFFER, markInst.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(2, 1);

    vaoSprite = gl.createVertexArray(); gl.bindVertexArray(vaoSprite);
    b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, stripGeo, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    spriteInst = new Float32Array(MAX_SPRITE * 12);
    spriteBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf); gl.bufferData(gl.ARRAY_BUFFER, spriteInst.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 48, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 48, 16); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 48, 32); gl.vertexAttribDivisor(3, 1);

    vaoRib = gl.createVertexArray(); gl.bindVertexArray(vaoRib);
    ribInst = new Float32Array(MAX_RIB * 16);
    ribBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ribBuf); gl.bufferData(gl.ARRAY_BUFFER, ribInst.byteLength, gl.DYNAMIC_DRAW);
    const stride = 64;   // 每条 16 个 float；原来写成 48，第二条起全部错位成乱线
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 32); gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, stride, 48); gl.vertexAttribDivisor(4, 1);
    ribColBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ribColBuf); gl.bufferData(gl.ARRAY_BUFFER, MAX_RIB * 12, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 3, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(5, 1);
  }
  function initGridVao() {
    const verts = new Float32Array(HN * HN * 2);
    for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) { verts[(j * HN + i) * 2] = i / N; verts[(j * HN + i) * 2 + 1] = j / N; }
    const idx = new Uint32Array(N * N * 6); let k = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * HN + i, b = a + 1, c = a + HN, d = c + 1; idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
    if (vaoGrid) gl.deleteVertexArray(vaoGrid);
    vaoGrid = gl.createVertexArray(); gl.bindVertexArray(vaoGrid);
    let b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    if (vaoGrid.idxBuf) gl.deleteBuffer(vaoGrid.idxBuf);
    b = gl.createBuffer(); vaoGrid.idxBuf = b; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    vaoGrid.count = idx.length;
  }

  /* ================= 印章图集（真实 logo） ================= */
  const ATL = 2048, CELLPX = 128;
  const atlasCanvas = document.createElement('canvas'); atlasCanvas.width = atlasCanvas.height = ATL;
  const actx = atlasCanvas.getContext('2d');
  let atlasTex = null, atlasReady = false;
  const cellOf = new Map();
  const logoCache = new Map();
  let loadTotal = 0, loadDone = 0;

  function paintCell(cell, draw) {
    const cx = (cell % 16) * CELLPX, cy = Math.floor(cell / 16) * CELLPX;
    actx.clearRect(cx, cy, CELLPX, CELLPX);
    actx.save(); actx.translate(cx, cy); actx.beginPath(); actx.arc(CELLPX / 2, CELLPX / 2, CELLPX / 2 - 2, 0, Math.PI * 2); actx.clip();
    draw(actx);
    actx.restore();
  }
  function drawSeal(img) {
    // 先铺淡纸底，再以 contain 缩放；源图小于 48px 的不放大
    actx.fillStyle = '#FBF6EA'; actx.fillRect(0, 0, CELLPX, CELLPX);
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) return;
    const pad = 22, maxSide = CELLPX - pad * 2;
    const k = Math.min(1, maxSide / Math.max(w, h));
    const dw = Math.max(1, w * k), dh = Math.max(1, h * k);
    actx.imageSmoothingQuality = 'high';
    actx.drawImage(img, (CELLPX - dw) / 2, (CELLPX - dh) / 2, dw, dh);
  }
  function drawGlyph(txt) {
    actx.fillStyle = '#A8321F'; actx.fillRect(0, 0, CELLPX, CELLPX);
    actx.fillStyle = '#F7EFE2'; actx.textAlign = 'center'; actx.textBaseline = 'middle';
    const t = (txt || '志').slice(0, 2);
    const fs = t.length > 1 ? 46 : 64;
    actx.font = `600 ${fs}px "MaShanZheng","Songti SC","STKaiti",serif`;
    actx.fillText(t, CELLPX / 2, CELLPX / 2 + 3);
  }
  function rebuildAtlas() {
    if (!atlasTex) { atlasTex = tex2d(ATL, ATL, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR_MIPMAP_LINEAR); }
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    atlasReady = true;
  }
  function buildAtlas() {
    const images = NODES.filter(n => n.logo).slice(0, 120);
    let cell = 0;
    loadTotal = images.length;
    images.forEach(n => { cellOf.set(n.id, cell); paintCell(cell, c => drawGlyph(n.name)); cell++; });
    cellOf.set('__n', cell);
    rebuildAtlas();
    let dirty = false, timer = null;
    const schedule = () => { dirty = true; if (!timer) timer = setTimeout(() => { timer = null; if (dirty) { dirty = false; rebuildAtlas(); } }, 90); };
    images.forEach(n => {
      const img = new Image(); img.decoding = 'async';
      img.onload = () => {
        loadDone++;
        const w = img.naturalWidth, h = img.naturalHeight;
        if (Math.min(w, h) >= 48) {
          const c = cellOf.get(n.id);
          paintCell(c, c2 => drawSeal(img));
          n.cell = c;
          schedule();
        }
        updateBoot();
      };
      img.onerror = () => { loadDone++; updateBoot(); };
      img.src = n.logo;
      logoCache.set(n.id, img);
    });
    NODES.forEach(n => { if (!cellOf.has(n.id)) n.cell = -1; });
    if (!images.length) loadDone = loadTotal = 0;
  }
  function updateBoot() {
    const p = loadTotal ? loadDone / loadTotal : 1;
    boot.style.setProperty('--boot', p);
    if (p >= 1 && boot.dataset.done !== '1') { boot.dataset.done = '1'; setTimeout(() => boot.remove(), 400); }
  }

  /* ================= 矩阵 ================= */
  function persp(fovy, asp, n, f) { const t = 1 / Math.tan(fovy / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; }
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm3 = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  function lookAt(e, c, u) { const z = norm3(sub3(e, c)), x = norm3(cross3(u, z)), y = cross3(z, x); return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot3(x, e), -dot3(y, e), -dot3(z, e), 1]; }
  function mul4(a, b) { const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
  function inv4(a) {
    const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
    const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
    const d = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
    return [
      (a[5] * b11 - a[6] * b10 + a[7] * b09) * d, (a[2] * b10 - a[1] * b11 - a[3] * b09) * d, (a[13] * b05 - a[14] * b04 + a[15] * b03) * d, (a[10] * b04 - a[9] * b05 - a[11] * b03) * d,
      (a[6] * b08 - a[4] * b11 - a[7] * b07) * d, (a[0] * b11 - a[2] * b08 + a[3] * b07) * d, (a[14] * b02 - a[12] * b05 - a[15] * b01) * d, (a[8] * b05 - a[10] * b02 + a[11] * b01) * d,
      (a[4] * b10 - a[5] * b08 + a[7] * b06) * d, (a[1] * b08 - a[0] * b10 - a[3] * b06) * d, (a[12] * b04 - a[13] * b02 + a[15] * b00) * d, (a[9] * b02 - a[8] * b04 - a[11] * b00) * d,
      (a[5] * b07 - a[4] * b09 - a[6] * b06) * d, (a[0] * b09 - a[1] * b07 + a[2] * b06) * d, (a[13] * b01 - a[12] * b03 - a[14] * b00) * d, (a[8] * b03 - a[9] * b01 + a[10] * b00) * d];
  }

  /* ================= 帧缓冲 ================= */
  let fbG = null, tPig = null, tNrm = null, tDep = null, fw = 0, fh = 0;
  function makeTargets(w, h) {
    if (fbG) { gl.deleteFramebuffer(fbG); gl.deleteTexture(tPig); gl.deleteTexture(tNrm); gl.deleteTexture(tDep); }
    fw = w; fh = h;
    tPig = tex2d(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    tNrm = tex2d(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    tDep = tex2d(w, h, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);
    fbG = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbG);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tPig, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tNrm, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tDep, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  function resizeGL() {
    const rect = canvas.parentElement.getBoundingClientRect();
    DPR = Math.min(devicePixelRatio || 1, NARROW() || coarse ? 1.5 : 2);
    W = Math.max(320, Math.round(rect.width)); H = Math.max(300, Math.round(rect.height || innerHeight * .8));
    canvas.width = Math.round(W * DPR * renderScale); canvas.height = Math.round(H * DPR * renderScale);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    makeTargets(canvas.width, canvas.height);
  }


  /* ================= 路线：同岛山道 + 跨岛航道（按岛对捆绑） ================= */
  const ROUTES = [];      // {pts, score, water, rgb, type}
  const FALLS = [];
  const BUNDLES = [];     // 跨岛主干：{a:isleKey, b:isleKey, pts, score, rgb, members:[routeIdx]}
  function isleAnchor(key) { const I = ISLES[key]; return I ? [I.cx, I.cz, I] : null; }
  function arcPoint(a, b, t, water) {
    const x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t);
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (water) return [x, .014 + Math.sin(Math.PI * t) * (.02 + d * .03), z];
    const base = lerp(Math.max(a.y, .012) + .032, Math.max(b.y, .012) + .032, t);
    return [x, base + Math.sin(Math.PI * t) * (.018 + d * .09), z];
  }
  function buildRoutes() {
    ROUTES.length = 0; BUNDLES.length = 0;
    // 1) 同岛：山道，直接连
    LINKS.forEach(l => {
      const a = BYID.get(l[0]), b = BYID.get(l[1]);
      if (!a || !b) return;
      if (a.region === b.region) {
        const pts = [];
        for (let i = 0; i <= 8; i++) pts.push(arcPoint(a, b, i / 8, false));
        ROUTES.push({ pts, score: l[3], water: false, type: l[2], rgb: lineRGB(a, b), a: l[0], b: l[1] });
      }
    });
    // 2) 跨岛：先按岛对建主干，再把每个节点以短枝汇入
    const byPair = new Map();
    LINKS.forEach(l => {
      const a = BYID.get(l[0]), b = BYID.get(l[1]);
      if (!a || !b || a.region === b.region) return;
      const k = a.region < b.region ? a.region + '|' + b.region : b.region + '|' + a.region;
      if (!byPair.has(k)) byPair.set(k, []);
      byPair.get(k).push({ l, a, b });
    });
    byPair.forEach((list, k) => {
      const [ka, kb] = k.split('|');
      const A = ISLES[ka], B = ISLES[kb];
      if (!A || !B) return;
      const d = Math.hypot(A.cx - B.cx, A.cz - B.cz);
      const tA = 0.62, tB = 0.62;
      const JA = [lerp(A.cx, B.cx, (A.r * tA) / d), lerp(A.cz, B.cz, (A.r * tA) / d)];
      const JB = [lerp(B.cx, A.cx, (B.r * tB) / d), lerp(B.cz, A.cz, (B.r * tB) / d)];
      const best = list.reduce((m, x) => Math.max(m, x.l[3]), 0);
      const rgb = lineRGB(list[0].a, list[0].b);
      const ptsT = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const x = lerp(JA[0], JB[0], t), z = lerp(JA[1], JB[1], t);
        const bow = Math.sin(Math.PI * t) * .05;
        ptsT.push([x + (-(JB[1] - JA[1]) / Math.max(d, .01)) * bow * .0, .012 + Math.sin(Math.PI * t) * (.02 + d * .02), z + ((JB[0] - JA[0]) / Math.max(d, .01)) * bow * .0]);
      }
      const bundle = { a: ka, b: kb, JA, JB, score: best, rgb, count: list.length, pts: ptsT };
      BUNDLES.push(bundle);
      // 分支短枝：节点 → 本岛锚点
      list.forEach(({ a, b, l }) => {
        const aFirst = a.region === ka;
        const nd = aFirst ? a : b;
        const J = aFirst ? JA : JB;
        const pts = [];
        for (let i = 0; i <= 3; i++) {
          const t = i / 3;
          const x = lerp(nd.x, J[0], t), z = lerp(nd.z, J[1], t);
          const y = lerp(Math.max(nd.y, .012) + .03, .012, t) + Math.sin(Math.PI * t) * .03;
          pts.push([x, y, z]);
        }
        ROUTES.push({ pts, score: l[3], water: true, type: l[2], rgb, a: l[0], b: l[1], stub: true });
      });
    });
    // 3) 瀑布
    FALLS.length = 0;
    const pk = ISLES.lab, cl = ISLES.resource;
    [[-.55, -1.02], [.18, -.86]].forEach(([lx, lz]) => {
      const sx = pk.cx + lx, sz = pk.cz + lz;
      FALLS.push({ a: [sx, Math.max(.16, hAt(sx, sz)), sz], b: [sx + pk.out[0] * .34, .03, sz + pk.out[1] * .34] });
    });
    [[-.3, -.4], [.34, .28]].forEach(([lx, lz]) => {
      const sx = cl.cx + lx, sz = cl.cz + lz;
      FALLS.push({ a: [sx, Math.max(.12, hAt(sx, sz)), sz], b: [sx + cl.out[0] * .22, .03, sz + cl.out[1] * .22] });
    });
  }
  function buildRibbons() {
    let n = 0;
    const focusLinks = FOCUS ? new Set((LINKS_OF.get(FOCUS.id) || []).map(l => l[0] === FOCUS.id ? `${l[0]}|${l[1]}` : `${l[1]}|${l[0]}`)) : null;
    const hiNode = HOVER || FOCUS || (SEARCH_HIT ? SEARCH_HIT : null);
    const hiLinks = hiNode ? new Set((LINKS_OF.get(hiNode.id) || []).map(l => `${l[0]}|${l[1]}`)) : null;
    // 一条线一次实例：起点 / 终点 / (宽, 透明, 类型, 标记) / 控制点
    const put = (ax, ay, az, bx, by, bz, wdt, alpha, kind, mark, ctrl) => {
      if (n >= MAX_RIB) return;
      const o = n * 16;
      ribInst[o] = ax; ribInst[o + 1] = ay; ribInst[o + 2] = az; ribInst[o + 3] = 0;
      ribInst[o + 4] = bx; ribInst[o + 5] = by; ribInst[o + 6] = bz; ribInst[o + 7] = 0;
      ribInst[o + 8] = wdt * DPR; ribInst[o + 9] = alpha; ribInst[o + 10] = kind; ribInst[o + 11] = mark;
      ribInst[o + 12] = ctrl[0]; ribInst[o + 13] = ctrl[1]; ribInst[o + 14] = ctrl[2]; ribInst[o + 15] = 1;
      n++;
    };
    const mid = (pts) => {
      const a = pts[0], b = pts[pts.length - 1];
      const m = pts[Math.floor(pts.length / 2)];
      return [2 * m[0] - (a[0] + b[0]) / 2, 2 * m[1] - (a[1] + b[1]) / 2, 2 * m[2] - (a[2] + b[2]) / 2];
    };
    RIB_COL.length = 0;
    const baseAlpha = isNight() ? .40 : .32;
    // 总览不画关系线（一岛对一岛几十条会糊成扇面）；悬停 / 聚焦某个地标时才画它的关系
    if (hiNode) for (const bd of BUNDLES) {
      const onPair = hiLinks && hiLinks.size ? [...hiLinks].some(k => k.includes(bd.a) && k.includes(bd.b)) : false;
      if (bd.score < 50 && !SHOW_WEAK && !onPair) continue;
      const a = baseAlpha * (bd.score >= 50 ? 1 : .55) * (onPair ? 1.9 : (hiNode ? .22 : 1));
      const w = (bd.score >= 50 ? .95 : .6) * (onPair ? 1.8 : 1);
      const pts = bd.pts, A0 = pts[0], B0 = pts[pts.length - 1];
      put(A0[0], A0[1], A0[2], B0[0], B0[1], B0[2], w, a, 0, onPair ? 1 : 0, mid(pts));
      RIB_COL[n - 1] = bd.rgb;
    }
    // 山道与短枝
    if (hiNode) for (const r of ROUTES) {
      const key = `${r.a}|${r.b}`;
      const on = hiLinks && hiLinks.has(key);
      if (r.score < 50 && !SHOW_WEAK && !on) continue;
      let al = baseAlpha * (r.score >= 50 ? .95 : .5) * (on ? 2.0 : (hiNode ? .22 : 1));
      let w = r.water ? .7 : .85;
      if (on) w *= 1.7;
      const pts = r.pts, A1 = pts[0], B1 = pts[pts.length - 1];
      put(A1[0], A1[1], A1[2], B1[0], B1[1], B1[2], w, al, 0, on ? 1 : 0, mid(pts));
      RIB_COL[n - 1] = r.rgb;
    }
    for (const f of FALLS) {
      put(f.a[0], f.a[1], f.a[2], f.b[0], f.b[1], f.b[2], 1.4, .42, 1, 0, [f.a[0] + .02, (f.a[1] + f.b[1]) * .5, f.a[2]]);
      RIB_COL[n - 1] = INK_COL;
    }
    // 云瀑（异象）
    if (PHENOM && PHENOM.kind === 'cloudfall' && PHENOM.life > 0) {
      const I = ISLES.lab;
      for (let k = 0; k < 3; k++) {
        const x0 = I.cx - .28 + k * .22, z0 = I.cz - .22;
        const y0 = hAt(x0, z0) + .06;
        put(x0, y0, z0, x0 + I.out[0] * .34, .04, z0 + I.out[1] * .34, 7.5, .30 * PHENOM.fade, 2, 0, [x0 + I.out[0] * .18, y0 - .10, z0 + I.out[1] * .18]);
        RIB_COL[n - 1] = [.97, .96, .93];
      }
    }
    return n;
  }

  /* ================= 氛围实例（鹤 / 萤 / 灯 / 远帆 / 鲲） ================= */
  const rndS = mulberry32(777);
  const BIRDS = Array.from({ length: 16 }, () => ({
    cx: ISLES.lab.cx + (rndS() - .5) * .6, cz: ISLES.lab.cz + (rndS() - .5) * .6,
    r: .22 + rndS() * .26, h: .42 + rndS() * .22, sp: (.00010 + rndS() * .00008) * (rndS() < .5 ? 1 : -1),
    ph: rndS() * 6.28, size: 7 + rndS() * 5
  }));
  const FIRE = Array.from({ length: 22 }, () => ({
    cx: ISLES.model.cx + (rndS() - .5) * .7, cz: ISLES.model.cz + (rndS() - .5) * .7,
    r: .10 + rndS() * .3, h: .06 + rndS() * .22, sp: .00008 + rndS() * .00012, ph: rndS() * 6.28, size: 5 + rndS() * 4
  }));
  const LANTERNS = Array.from({ length: 10 }, () => ({
    cx: ISLES.news.cx + (rndS() - .5) * 1.6, cz: ISLES.news.cz + (rndS() - .5) * .4,
    r: .05 + rndS() * .1, h: .02 + rndS() * .03, sp: .00004 + rndS() * .00004, ph: rndS() * 6.28, size: 4 + rndS() * 3
  }));
  const FARSAIL = Array.from({ length: 12 }, () => {
    const a = rndS() * 6.283, d = 2.6 + rndS() * 2.6;
    return { x: Math.cos(a) * d, z: Math.sin(a) * d, sp: .00002 + rndS() * .00003, ph: rndS() * 6.28, size: 9 + rndS() * 7 };
  });
  const whale = { t0: -40000, period: 96000, on: false };

  /* ================= 渲染 ================= */
  const LIGHT_D = norm3([-.22, .40, -.89]);   // 低角度暖阳在默认视角的前上方：逆光金边、长影、海面碎金
  /* 时辰定日位：6 时东升、12 时正中、18 时西落；夜间用月色。
     太阳高度角同时决定画面里光的方向与冷暖。 */
  function sunDir() {
    const d = new Date();
    const h = d.getHours() + d.getMinutes() / 60;
    const t = Math.min(1, Math.max(0, (h - 6) / 12));      // 0 = 日出，1 = 日落
    const el = Math.sin(Math.PI * t) * 0.55 + 0.06;        // 高度
    const az = (-0.62 + 1.25 * t) * Math.PI;               // 东 → 西
    return norm3([Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)]);
  }
  const SUN_L = sunDir();
  let VP = null, IVP = null, tms = 0;
  function paper3() { return hex3(th().paper); }
  function K(c) { const p = paper3(); return c.map((v, i) => -Math.log(Math.max(v, .002) / p[i])); }
  function palette() {
    const night = isNight();
    const t = th();
    const seal = hex3(t.seal), ink = hex3(t.ink);
    // 夜间同样以浅纸为底计算墨色，最后在合成里整体反相成拓片
    const paper = night ? [.935, .905, .845] : hex3(t.paper);
    return {
      paper, ink,
      KInk: K(night ? [.22, .21, .20] : ink).map(v => v * 2.6),
      KOchre: (night ? K([.72, .54, .42]) : K([.80, .62, .45])).map(v => v * 1.6),
      KGreen: (night ? K([.42, .62, .52]) : K([.50, .70, .58])).map(v => v * 1.9),
      KBlue: (night ? K([.34, .52, .66]) : K([.36, .55, .66])).map(v => v * 2.4),
      fog: night ? [.90, .88, .84] : [.900, .876, .826],
      paperShader: paper,
      sun: night ? norm3([.42, .50, -.76]) : SUN_L,
      seal,
      KReg: ORDER.map(k => K(hex3(rcol(k)).map(v => Math.min(.92, v * .92 + .05))))
    };
  }


  /* ================= 投影与标签 ================= */
  function projectWorld(x, y, z) {
    const m = VP, w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 0.001) return null;
    const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    const cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    const cz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    return { x: (cx * .5 + .5) * W, y: (.5 - cy * .5) * H, z: cz, w };
  }
  function occluded(x, y, z) {
    const eye = camEye();
    const dx = x - eye[0], dy = y - eye[1], dz = z - eye[2];
    const L = Math.hypot(dx, dy, dz);
    for (let i = 1; i < 22; i++) {
      const t = i / 22;
      const hx = eye[0] + dx * t, hz = eye[2] + dz * t, hy = eye[1] + dy * t;
      if (hy < hAt(hx, hz) - .004) return true;
    }
    return false;
  }
  const zoomSize = () => clamp(6.0 / Math.max(cam.dist, 1.2), .7, 1.35);

  const labelPool = [];
  function ensureLabels(n) { while (labelPool.length < n) { const el = document.createElement('span'); el.className = 'atlas-label'; layer.appendChild(el); labelPool.push(el); } }
  function labelSet() {
    // 总览（相机还远）时只显示七岛题名，地标名等贴近了再出，免得挤成一团
    if (!FOCUS && !HOVER && !pins.length && !SEARCH_HIT && cam.dist > 4.3) return [];
    const cap = NARROW() ? 6 : labelLevel === 0 ? 12 : labelLevel === 1 ? 12 : 22;
    const pri = [];
    const focusNb = FOCUS ? new Set((LINKS_OF.get(FOCUS.id) || []).map(l => (l[0] === FOCUS.id ? l[1] : l[0]))) : null;
    for (const nd of NODES) {
      if (!filter.has(nd.region) && nd !== FOCUS) continue;
      let p = 0;
      if (nd === FOCUS) p = 1000; else if (pins.includes(nd.id)) p = 900; else if (nd === HOVER) p = 850;
      else if (nd === SEARCH_HIT) p = 800;
      else if (focusNb && focusNb.has(nd.id)) p = 700;
      else if (cam.dist < 7) p = 100 + (nd.d || 0);
      else p = (nd.d || 0) + (nd.region === 'company' ? 3 : 0);
      pri.push([p, nd]);
    }
    pri.sort((a, b) => b[0] - a[0]);
    // 同区优先：先取当前区/主陆，再补其他区；跨区最多 3 个（除非聚焦）
    const homeKey = FOCUS ? FOCUS.region : (state === 'S2' ? (REGIONS.find(r => r.key && labelHome) || {}).key : 'company');
    const out = [];
    if (FOCUS || HOVER || pins.length) { pri.slice(0, cap).forEach(x => out.push(x[1])); return out; }
    const crossCap = 3;
    let cross = 0;
    for (const [p, nd] of pri) {
      if (out.length >= cap) break;
      const same = nd.region === homeKey;
      if (!same) { if (cross >= crossCap) continue; cross++; }
      out.push(nd);
    }
    return out;
  }
  /* 七岛题名：每帧投影到峰顶上方；聚焦单个地标时隐去，免得抢字 */
  let isleEls = null;
  const isleTop = {};
  function isleTopH(k) {
    if (isleTop[k] != null) return isleTop[k];
    const I = ISLES[k];
    let m = 0;
    if (k === 'news') { for (const it of ISLETS) m = Math.max(m, hAt(it.cx, it.cz)); }
    else for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) m = Math.max(m, hAt(I.cx + I.r * i / 6, I.cz + I.r * j / 6));
    return (isleTop[k] = m);
  }
  function drawIsles() {
    if (!layer) return;
    if (!isleEls) {
      isleEls = ORDER.map(k => {
        const el = document.createElement('span');
        el.className = 'atlas-isle';
        const R = REGIONS.find(r => r.key === k) || {};
        el.style.setProperty('--rc', rcol(k));
        el.innerHTML = `<b>${ISLES[k].label}</b><i>${R.sub || ''}</i>`;
        el.setAttribute('aria-hidden', 'true');
        layer.appendChild(el);
        return el;
      });
    }
    const show = !FOCUS && state !== 'S3' && state !== 'S4';
    ORDER.forEach((k, i) => {
      const I = ISLES[k], el = isleEls[i];
      el.style.setProperty('--rc', rcol(k));
      const ax = k === 'news' ? .02 : I.cx, az = k === 'news' ? -1.55 : I.cz;
      const p = VP ? projectWorld(ax, isleTopH(k) + .16, az) : null;
      if (!p || !show || !filter.has(k) || p.x < -60 || p.x > W + 60 || p.y < 30 || p.y > H) { el.style.opacity = '0'; return; }
      const sc = clamp(6.5 / Math.max(cam.dist, 2), .62, 1.25) * (NARROW() ? .8 : 1);
      el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${sc.toFixed(3)})`;
      el.style.opacity = '1';
    });
  }
  let labelHome = 'company';
  const fontFamily = () => getComputedStyle(document.documentElement).getPropertyValue('--f-kai').trim() || '"Songti SC",serif';
  let placedBoxes = [];
  function drawLabels() {
    const want = labelSet();
    ensureLabels(Math.max(want.length, 12));
    placedBoxes = [];
    // 先占住两块地方：顶上的分区条，以及七岛题名——地标名不许压在上面
    const hud = document.querySelector('.atlas-hud');
    let topBar = 56;
    if (hud) { const r = hud.getBoundingClientRect(); if (r.height > 0) topBar = Math.max(topBar, r.height + 22); }
    placedBoxes.push([0, 0, W, topBar]);
    if (VP) for (const k of ORDER) {
      const I = ISLES[k], ax = k === 'news' ? .02 : I.cx, az = k === 'news' ? -1.55 : I.cz;
      const q = projectWorld(ax, isleTopH(k) + .16, az);
      if (!q) continue;
      const sc = clamp(6.5 / Math.max(cam.dist, 2), .62, 1.25) * (NARROW() ? .8 : 1);
      const bw2 = 96 * sc, bh2 = 54 * sc;
      placedBoxes.push([q.x - bw2 / 2, q.y - bh2, bw2, bh2]);
    }
    let used = 0;
    const fam = fontFamily();
    for (const nd of want) {
      const p = nd._p;
      if (!p || p.x < -80 || p.x > W + 80 || p.y < -40 || p.y > H + 40) continue;
      const hidden = occluded(nd.x, nd.y + nd.lift, nd.z);
      const el = labelPool[used];
      const on = nd === FOCUS || nd === HOVER;
      const txt = NARROW()
        ? (nd.name.length > 7 ? nd.name.slice(0, 7) + '…' : nd.name)
        : (nd.name.length > 10 ? nd.name.slice(0, 10) + '…' : nd.name);
      if (el._t !== txt) { el.textContent = txt; el._t = txt; }
      el.setAttribute('data-region', nd.region);
      el.classList.toggle('on', on);
      // 量宽：用字体估计（13px 中文 ≈ 字号，拉丁 ≈ .58 字号）
      el.style.fontFamily = fam;
      const fs = on ? 13.5 : 11.5;
      let tw = 0; for (const ch of txt) tw += /[　-鿿]/.test(ch) ? fs : fs * .56;
      const bw = tw + 10, bh = fs + 8;
      const gap = 5;
      const cands = [[p.x - bw / 2, p.y + 11], [p.x - bw / 2, p.y - bh - 11], [p.x + 13, p.y - bh / 2], [p.x - bw - 13, p.y - bh / 2],
                     [p.x - bw / 2 + 20, p.y + 26], [p.x - bw / 2 - 20, p.y - bh - 26],
                     [p.x + 18, p.y + 14], [p.x - bw - 18, p.y + 14],
                     [p.x + 18, p.y - bh - 14], [p.x - bw - 18, p.y - bh - 14]];
      let pick = null, fallback = null;
      for (const [x, y] of cands) {
        if (x < 4 || x + bw > W - 4 || y < topBar || y + bh > H - 4) continue;
        let clash = false;
        for (const r of placedBoxes) if (x < r[0] + r[2] + gap && x + bw + gap > r[0] && y < r[1] + r[3] + gap && y + bh + gap > r[1]) { clash = true; break; }
        if (!clash) { pick = [x, y]; break; }
        if (!fallback) fallback = [x, y];
      }
      if (!pick && on) pick = fallback;
      if (!pick) { el.style.opacity = 0; continue; }
      placedBoxes.push([pick[0], pick[1], bw, bh]);
      el.style.transform = `translate3d(${pick[0].toFixed(1)}px,${pick[1].toFixed(1)}px,0)`;
      el.style.opacity = hidden ? .38 : 1;
      used++;
    }
    for (let i = used; i < labelPool.length; i++) labelPool[i].style.opacity = 0;
  }

  /* ================= 渲染主函数 ================= */
  let paused2 = false;
  const stats = { ft: 16, slow: 0 };
  function buildSprites(now) {
    let n = 0;
    const push = (kind, x, y, z, size, ph, alpha, rgb) => {
      if (n >= MAX_SPRITE) return;
      const o = n * 12;
      spriteInst[o] = x; spriteInst[o + 1] = y; spriteInst[o + 2] = z; spriteInst[o + 3] = 0;
      spriteInst[o + 4] = kind; spriteInst[o + 5] = size * DPR * zoomSize(); spriteInst[o + 6] = ph; spriteInst[o + 7] = alpha;
      const c = rgb || [.3, .26, .22];
      spriteInst[o + 8] = c[0]; spriteInst[o + 9] = c[1]; spriteInst[o + 10] = c[2]; spriteInst[o + 11] = 1;
      n++;
    };
    const t = paused || reduced ? 0 : now;
    for (const b of BIRDS) {
      const a = b.ph + t * b.sp;
      const x = b.cx + Math.cos(a) * b.r, z = b.cz + Math.sin(a) * b.r;
      push(0, x, hAt(x, z) + b.h, z, b.size, t * .004 + b.ph, .8);
    }
    for (const f of FIRE) {
      const a = f.ph + t * f.sp;
      const x = f.cx + Math.cos(a) * f.r, z = f.cz + Math.sin(a) * f.r * .8;
      push(1, x, hAt(x, z) + f.h + .03 * Math.sin(t * .0007 + f.ph), z, f.size, f.ph, isNight() ? .9 : .3);
    }
    for (const l of LANTERNS) {
      const a = l.ph + t * l.sp;
      const x = l.cx + Math.cos(a) * l.r, z = l.cz + Math.sin(a) * l.r;
      push(2, x, Math.max(hAt(x, z), 0) + l.h, z, l.size, l.ph, .7);
    }
    for (const f of FARSAIL) {
      const x = f.x + Math.sin(t * f.sp + f.ph) * .05, z = f.z + Math.cos(t * f.sp * .8 + f.ph) * .05;
      push(3, x, .02, z, f.size, f.ph, .55);
    }
    // 圣兽（常驻，低预算）
    if (SHOW_BEAST) for (const b of BEASTS) {
      const a = b.ph + t * b.sp;
      const x = b.cx + Math.cos(a) * b.r, z = b.cz + Math.sin(a) * b.r * .8;
      const y = Math.max(hAt(x, z), .02) + b.h + .02 * Math.sin(t * .0006 + b.ph);
      // 总览时收小、压淡，别挡住岛名
      const far = clamp((cam.dist - 3.2) / 2.4, 0, 1);
      push(5, x, y, z, 30 * (1 - .45 * far), beastIdx(b.w), .30 * (1 - .55 * far), isNight() ? [.74, .76, .80] : [.26, .22, .18]);
    }
    // 宗门楼阁
    // 楼阁已是三维模型；夜里在塔顶点一盏灯
    if (isNight()) for (const sct of SECTS) push(2, sct.x, (sct.top || sct.y + .1), sct.z, 54, sct.x * 3.1, .85);
    // 秘境：总览几乎不显，飞近 / 开启后亮起
    for (const dp of DEPTHS) {
      const d = Math.hypot(dp.x - camEye()[0], dp.z - camEye()[2]);
      const near = 1 - sstep(3.2, 7.5, d);
      const on = SHOW_DEPTH ? 1 : near * .55;
      if (on < .04) continue;
      push(7, dp.x, dp.y + .02 * Math.sin(t * .001 + dp.seed), dp.z, 34, dp.seed, on, dp.rgb);
    }
    // 鲲：每 96 秒一次，横穿群岛南侧深海
    const wt = (now - whale.t0) % whale.period;
    if (wt < 26000 && !reduced) {
      const k = wt / 26000;
      const x = lerp(-2.1, 2.1, k), z = 1.9 + Math.sin(k * 3.14) * .18;
      push(4, x, -.02, z, 190, k * 6.28, Math.sin(k * Math.PI) * .28);
    }
    return n;
  }
    function renderFrame(now) {
    const P = palette();
    const eye = camEye();
    const near = .18, far = 60;
    VP = mul4(persp(34 * Math.PI / 180, W / H, near, far), lookAt(eye, [0, cam.ty, 0], [0, 1, 0]));
    IVP = inv4(VP);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbG); gl.viewport(0, 0, fw, fh);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); gl.clearBufferfv(gl.COLOR, 1, [.5, .5, .5, 0]);
    gl.depthMask(true); gl.clearBufferfi(gl.DEPTH_STENCIL, 0, 1, 0);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);

    gl.useProgram(pT.p);
    gl.uniformMatrix4fv(pT.u.uVP, false, VP); gl.uniform1f(pT.u.uExt, EXT); gl.uniform1f(pT.u.uN, N);
    gl.uniform3fv(pT.u.uL, P.sun); gl.uniform1f(pT.u.uTime, now); gl.uniform3fv(pT.u.uCam, eye);
    gl.uniform3fv(pT.u.uKReg, P.KReg.flat());
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, hTex); gl.uniform1i(pT.u.uH, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, iTex); gl.uniform1i(pT.u.uI, 1);
    if (!window.__NO_TERRAIN) { gl.bindVertexArray(vaoGrid); gl.drawElements(gl.TRIANGLES, vaoGrid.count, gl.UNSIGNED_INT, 0); }
    if (window.__probe) window.__probe.push('terrain:' + gl.getError());

    if (vaoPag && pagCount) {
      gl.useProgram(pB.p); gl.uniformMatrix4fv(pB.u.uVP, false, VP);
      gl.bindVertexArray(vaoPag); gl.drawArrays(gl.TRIANGLES, 0, pagCount);
    }
    gl.useProgram(pW.p); gl.uniformMatrix4fv(pW.u.uVP, false, VP);
    gl.bindVertexArray(vaoQuad); gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (window.__probe) window.__probe.push('water:' + gl.getError());
    gl.disable(gl.DEPTH_TEST);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, fw, fh);
    gl.useProgram(pC.p);
    [[tPig, 'uPig'], [tNrm, 'uNrm'], [tDep, 'uDep'], [hTex, 'uH']].forEach(([t, nm], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(pC.u[nm], i); });
    gl.uniformMatrix4fv(pC.u.uInvVP, false, IVP); gl.uniform3fv(pC.u.uCam, eye); gl.uniform2f(pC.u.uRes, fw, fh);
    gl.uniform1f(pC.u.uTime, now); gl.uniform1f(pC.u.uNear, near); gl.uniform1f(pC.u.uFar, far); gl.uniform1f(pC.u.uExt, EXT);
    gl.uniform1f(pC.u.uNight, isNight() ? 1 : 0); gl.uniform1f(pC.u.uLevel, 0);
    gl.uniform1f(pC.u.uCloudBias, CLOUD_BIAS);
    const SEASON_N = { spring: 1, summer: 2, autumn: 3, winter: 4 };
    gl.uniform1f(pC.u.uSeason, (window.__atlasSeason || root.dataset.season) ? (SEASON_N[window.__atlasSeason || root.dataset.season] || 0) : 0);
    gl.uniform1f(pC.u.uDbg, +(new URLSearchParams(location.search).get('dbg') || 0));
    gl.uniform4f(pC.u.uPhenom, PHENOM ? PHENOM.kind : 0, PHENOM ? PHENOM.fade : 0, PHENOM ? now * .0002 : 0, PHENOM ? PHENOM.at : 0);
    gl.uniform3fv(pC.u.uPaper, P.paperShader || P.paper); gl.uniform3fv(pC.u.uKInk, P.KInk); gl.uniform3fv(pC.u.uKOchre, P.KOchre);
    gl.uniform3fv(pC.u.uKGreen, P.KGreen); gl.uniform3fv(pC.u.uKBlue, P.KBlue); gl.uniform3fv(pC.u.uFogCol, P.fog);
    gl.uniform3fv(pC.u.uSunDir, P.sun); gl.uniform3fv(pC.u.uSeal, P.seal);
    gl.bindVertexArray(vaoQuad); gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (window.__probe) window.__probe.push('composite:' + gl.getError());

    gl.enable(gl.BLEND);
    // 山道与航道
    const nr = window.__NO_RIB ? 0 : buildRibbons();
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(pR.p); gl.uniformMatrix4fv(pR.u.uVP, false, VP); gl.uniform2f(pR.u.uRes, fw, fh);
    gl.uniform1f(pR.u.uTime, now); gl.uniform1f(pR.u.uNight, isNight() ? 1 : 0);
    gl.uniform3fv(pR.u.uInk, P.ink); gl.uniform3fv(pR.u.uSeal, P.seal);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tDep); gl.uniform1i(pR.u.uDep, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, ribBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, ribInst, 0, nr * 16);
    for (let i = 0; i < nr; i++) { const c = RIB_COL[i] || INK_COL; ribColData[i * 3] = c[0]; ribColData[i * 3 + 1] = c[1]; ribColData[i * 3 + 2] = c[2]; }
    gl.bindBuffer(gl.ARRAY_BUFFER, ribColBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, ribColData, 0, nr * 3);
    // 每条路一条 polyline：起点 / 控制点 / 终点
    gl.bindVertexArray(vaoRib); gl.drawArraysInstanced(gl.LINE_STRIP, 0, 17, window.__RIB_CAP ? Math.min(nr, window.__RIB_CAP) : nr);
    window.__lastRib = nr;
    if (window.__probe) window.__probe.push('rib:' + gl.getError());

    // 地标印章
    const nm = window.__NO_MARK ? 0 : buildMarks(now, eye);
    gl.useProgram(pM.p); gl.uniformMatrix4fv(pM.u.uVP, false, VP); gl.uniform2f(pM.u.uRes, fw, fh); gl.uniform1f(pM.u.uDPR, fw / W);
    gl.uniform1f(pM.u.uNight, isNight() ? 1 : 0); gl.uniform1f(pM.u.uGrid, N);
    gl.uniform3fv(pM.u.uSeal, P.seal); gl.uniform3fv(pM.u.uPaper, isNight() ? [.24,.23,.21] : P.paper);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.uniform1i(pM.u.uAtlas, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tDep); gl.uniform1i(pM.u.uDep, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, markBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, markInst, 0, nm * 8);
    gl.bindVertexArray(vaoMark); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nm);
    if (window.__probe) window.__probe.push('mark:' + gl.getError());

    // 氛围
    const nsp = window.__NO_SPRITE ? 0 : buildSprites(now);
    gl.useProgram(pS.p); gl.uniformMatrix4fv(pS.u.uVP, false, VP); gl.uniform2f(pS.u.uRes, fw, fh);
    gl.uniform1f(pS.u.uNight, isNight() ? 1 : 0); gl.uniform1f(pS.u.uTime, now); gl.uniform3fv(pS.u.uInk, P.ink);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tDep); gl.uniform1i(pS.u.uDep, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, spriteInst, 0, nsp * 12);
    gl.bindVertexArray(vaoSprite); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nsp);
    gl.disable(gl.BLEND);

    // 投影到屏幕（标签、悬停、命中）
    for (const nd of NODES) nd._p = projectWorld(nd.x, nd.y + nd.lift, nd.z);
    for (const sct of SECTS) sct._p = projectWorld(sct.x, sct.y + .02, sct.z);
    for (const dp of DEPTHS) dp._p = projectWorld(dp.x, dp.y + .02, dp.z);
    for (const b of BEASTS) {
      const a = (paused || reduced ? 0 : now) * b.sp + b.ph;
      b._p = projectWorld(b.cx + Math.cos(a) * b.r, .12, b.cz + Math.sin(a) * b.r * .8);
    }
  }
  function buildMarks(now, eye) {
    let n = 0;
    const cap = NARROW() ? 180 : MAX_MARK;
    const focusNb = FOCUS ? new Set((LINKS_OF.get(FOCUS.id) || []).map(l => (l[0] === FOCUS.id ? l[1] : l[0]))) : null;
    const zs = zoomSize();
    for (const nd of NODES) {
      if (n >= cap) break;
      const vis = filter.has(nd.region);
      const isFocus = nd === FOCUS || pins.includes(nd.id) || nd === SEARCH_HIT;
      if (!vis && !isFocus) continue;
      let size = 0;
      if (isFocus) size = NARROW() ? 22 : 24;
      else if (nd === HOVER) size = 21;
      else if (nd.region === 'news') size = 11;
      else size = clamp(10 + (nd.d || 1) * .45, 11, 17);
      size *= zs;
      const near = focusNb && focusNb.has(nd.id);
      let dim = 0;
      if (FOCUS && !isFocus && !near) dim = .62;
      if (!vis) dim = Math.max(dim, .55);
      const o = n * 8;
      const cell = nd.cell != null ? nd.cell : -1;
      const typeId = cell >= 0 ? 0 : ({ company: 0, lab: 0, model: 1, benchmark: 2, job: 3, resource: 4, news: 5, event: 6 }[nd.type] ?? 0);
      markInst[o] = nd.x; markInst[o + 1] = nd.y + nd.lift; markInst[o + 2] = nd.z; markInst[o + 3] = cell;
      markInst[o + 4] = size; markInst[o + 5] = typeId; markInst[o + 6] = isFocus || nd === HOVER ? 1 : 0; markInst[o + 7] = dim;
      n++;
    }
    return n;
  }

  /* ================= 小地图 ================= */
  let miniBase = null, miniBaseNight = null;
  function buildMiniBase(night) {
    const S = 296;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    // 海与陆分得开：海给一层青灰，陆按高度从浅赭到深褐，岸线画深
    const sea = night ? [26, 34, 52] : [176, 196, 198];
    const land0 = night ? [120, 116, 110] : [214, 198, 168];
    const land1 = night ? [176, 172, 162] : [122, 96, 66];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const wx = lerp(-EXT, EXT, x / (S - 1)), wz = lerp(-EXT, EXT, y / (S - 1));
      const h = hAt(wx, wz);
      const i = (y * S + x) * 4;
      const k = clamp((h - .002) * 3.2, 0, 1);
      if (h < .004) {
        img.data[i] = sea[0]; img.data[i + 1] = sea[1]; img.data[i + 2] = sea[2]; img.data[i + 3] = 235;
      } else {
        img.data[i] = lerp(land0[0], land1[0], k);
        img.data[i + 1] = lerp(land0[1], land1[1], k);
        img.data[i + 2] = lerp(land0[2], land1[2], k);
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const id = g.getImageData(0, 0, S, S); const dd = id.data;
    const edge = night ? [200, 196, 186] : [92, 78, 60];
    for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
      const i = (y * S + x) * 4;
      const a = dd[i + 3] > 200;
      if (a && (dd[i + 3 - S * 4] < 200 || dd[i + 3 + S * 4] < 200 || dd[i + 3 - 4] < 200 || dd[i + 3 + 4] < 200)) {
        dd[i] = edge[0]; dd[i + 1] = edge[1]; dd[i + 2] = edge[2];
      }
    }
    g.putImageData(id, 0, 0);
    return c;
  }
  function drawMini() {
    if (!showMini || !miniBase) return;
    const g = mini.getContext('2d');
    g.clearRect(0, 0, 296, 296);
    g.drawImage(isNight() ? miniBaseNight : miniBase, 0, 0);
    // 钉选与当前焦点
    const toMini = (x, z) => [(x + EXT) / (2 * EXT) * 296, (z + EXT) / (2 * EXT) * 296];
    pins.forEach(id => { const nd = BYID.get(id); if (!nd) return; const [mx, my] = toMini(nd.x, nd.z); g.fillStyle = rcol(nd.region); g.beginPath(); g.arc(mx, my, 3.2, 0, 6.283); g.fill(); });
    if (FOCUS) { const [mx, my] = toMini(FOCUS.x, FOCUS.z); g.strokeStyle = '#A8321F'; g.lineWidth = 1.6; g.beginPath(); g.arc(mx, my, 5, 0, 6.283); g.stroke(); }
  }

  /* ================= 悬停卡 / 钉选侧栏 ================= */
  function nodeThumb(nd) {
    if (nd.logo && nd.cell >= 0 && atlasReady) {
      const cx = (nd.cell % 16) * CELLPX, cy = Math.floor(nd.cell / 16) * CELLPX;
      const s = 88;
      const c = document.createElement('canvas'); c.width = c.height = s;
      const g = c.getContext('2d');
      g.drawImage(atlasCanvas, cx, cy, CELLPX, CELLPX, 0, 0, s, s);
      return c.toDataURL();
    }
    return null;
  }
  let hoverTimer = null;
  function showHover(nd, mx, my) {
    if (!nd) { hoverEl.hidden = true; hoverEl.classList.remove('on'); return; }
    const thumb = nodeThumb(nd);
    const facts = (nd.facts || []).slice(0, 3).map(f => `<span>${esc(f)}</span>`).join('');
    const nb = (LINKS_OF.get(nd.id) || []).length;
    hoverEl.innerHTML = `
      <div class="ah-top">
        ${thumb ? `<img class="ah-thumb" src="${thumb}" alt="">` : `<span class="ah-seal" data-region="${nd.region}">${esc(nd.name.slice(0, 2))}</span>`}
        <div class="ah-title"><b>${esc(nd.name)}</b>${nd.en ? `<i>${esc(nd.en)}</i>` : ''}</div>
        <span class="ah-type" data-region="${nd.region}">${TYPE_CN[nd.type] || ''}</span>
      </div>
      ${nd.one ? `<p class="ah-one">${esc(nd.one)}</p>` : ''}
      ${facts ? `<div class="ah-facts">${facts}</div>` : ''}
      <div class="ah-foot"><span>关联 ${nb}</span><span>单击钉选 · ⏎ 展卷</span></div>`;
    hoverEl.hidden = false;
    hoverEl.classList.add('on');
    // 锚定地标上方，不跟鼠标
    const p = nd._p;
    const bw = 286;
    let x = p ? p.x - bw / 2 : mx - bw / 2, y = p ? p.y - 14 : my;
    const hgt = hoverEl.offsetHeight || 120;
    x = clamp(x, 10, W - bw - 10);
    if (p && p.y - hgt - 26 < 10) y = p.y + 26; else y = (p ? p.y : my) - hgt - 16;
    hoverEl.style.transform = `translate3d(${x.toFixed(0)}px,${y.toFixed(0)}px,0)`;
  }

  function relGroups(nd) {
    const out = new Map();
    (LINKS_OF.get(nd.id) || []).forEach(l => {
      const other = BYID.get(l[0] === nd.id ? l[1] : l[0]);
      if (!other) return;
      const k = l[2];
      if (!out.has(k)) out.set(k, []);
      out.get(k).push({ n: other, s: l[3] });
    });
    return [...out.entries()].sort((a, b) => LINK_ORDER.indexOf(a[0]) - LINK_ORDER.indexOf(b[0]));
  }
  function openDossier(nd) {
    if (!nd) { dossier.hidden = true; root.classList.remove('dossier-open'); return; }
    const region = REGIONS.find(r => r.key === nd.region) || {};
    const thumb = nodeThumb(nd);
    const groups = relGroups(nd).map(([k, list]) => `
      <section class="ds-rel"><h4>${LINK_CN[k] || k}<span>${list.length}</span></h4>
        ${list.slice(0, 8).map(({ n }) => `<button class="ds-relrow" data-fly="${esc(n.id)}"><span class="ds-dot" data-region="${n.region}"></span>${esc(n.name)}</button>`).join('')}
        ${list.length > 8 ? `<span class="ds-more">另 ${list.length - 8} 个</span>` : ''}
      </section>`).join('');
    dossier.innerHTML = `
      <header class="ds-head">
        ${thumb ? `<img class="ds-thumb" src="${thumb}" alt="">` : `<span class="ds-seal" data-region="${nd.region}">${esc(nd.name.slice(0, 2))}</span>`}
        <div><h3>${esc(nd.name)}</h3>${nd.en ? `<i>${esc(nd.en)}</i>` : ''}<span class="ds-type" data-region="${nd.region}">${region.label || ''} · ${TYPE_CN[nd.type] || ''}</span></div>
        <button class="ds-close" aria-label="关闭">×</button>
      </header>
      <p class="ds-verdict">${esc(nd.one || '')}</p>
      ${(nd.facts || []).length ? `<dl class="ds-facts">${nd.facts.map(f => `<div><dt></dt><dd>${esc(f)}</dd></div>`).join('')}</dl>` : ''}
      <div class="ds-rels">${groups || '<p class="ds-empty">图上暂无连线。</p>'}</div>
      <div class="ds-acts">
        <a class="ds-open" href="${esc(nd.file)}">展卷<span>→</span></a>
        <button class="ds-pin" aria-pressed="${pins.includes(nd.id)}">${pins.includes(nd.id) ? '已钉' : '钉选'} <kbd>P</kbd></button>
      </div>`;
    dossier.hidden = false;
    root.classList.add('dossier-open');
    dossier.querySelector('.ds-close').addEventListener('click', () => { setState('S2'); });
    dossier.querySelector('.ds-open').addEventListener('click', () => { saveCam(); });
    dossier.querySelector('.ds-pin').addEventListener('click', () => togglePin(nd.id));
    dossier.querySelectorAll('[data-fly]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); const t = BYID.get(b.dataset.fly); if (t) focusNode(t, { keepDossier: true }); }));
    say(`已聚焦 ${nd.name} · ${TYPE_CN[nd.type] || ''} · 关联 ${(LINKS_OF.get(nd.id) || []).length}`);
  }
  function renderPins() {
    pinsBar.innerHTML = pins.map(id => {
      const nd = BYID.get(id);
      if (!nd) return '';
      return `<button class="atlas-pin" data-pin="${esc(id)}" title="${esc(nd.name)}"><span data-region="${nd.region}">${esc(nd.name.slice(0, 2))}</span><i>${esc(nd.name)}</i><em aria-label="取消钉选">×</em></button>`;
    }).join('');
    pinsBar.querySelectorAll('.atlas-pin').forEach(b => {
      b.addEventListener('click', e => {
        const id = b.dataset.pin, nd = BYID.get(id);
        if (e.target.tagName === 'EM') { togglePin(id); return; }
        if (nd) focusNode(nd);
      });
    });
    pinsBar.classList.toggle('has', pins.length > 0);
  }
  function togglePin(id) {
    const i = pins.indexOf(id);
    if (i >= 0) pins.splice(i, 1);
    else { pins.push(id); if (pins.length > 3) pins.shift(); }
    try { sessionStorage.setItem('atlas-pins', JSON.stringify(pins)); } catch (e) {}
    renderPins();
    if (FOCUS && FOCUS.id === id) openDossier(FOCUS);
    say(i >= 0 ? '已取消钉选' : '已钉选，最多三枚');
  }

  /* ================= 区域题卡 ================= */
  function showRegionCard(key) {
    if (!key) { regionCard.hidden = true; return; }
    const r = REGIONS.find(x => x.key === key);
    if (!r) { regionCard.hidden = true; return; }
    const visited = visitedRegions.has(key);
    regionCard.innerHTML = `<b>${esc(r.label)}</b><span>${esc(r.sub)} · ${r.count} 条</span>${visited ? '' : `<em>初至</em>`}`;
    regionCard.hidden = false;
    regionCard.dataset.region = key;
    visitedRegions.add(key);
    clearTimeout(regionCard._t);
    regionCard._t = setTimeout(() => { regionCard.hidden = true; }, 2600);
  }
  const visitedRegions = new Set();

  /* ================= 状态机与相机编排 ================= */
  const camForRegion = key => {
    const I = ISLES[key];
    if (!I) return { yaw: cam.yaw, pitch: .72, dist: NARROW() ? 4.4 : 3.4, ty: .05 };
    const L = Math.hypot(I.cx, I.cz);
    const yaw = L > .05 ? Math.atan2(I.cx, I.cz) : cam.yaw;
    const d = clamp(I.r / Math.tan(19 * Math.PI / 180) * 1.35, 2.4, 5.2);
    return { yaw, pitch: I.kind === 'peaks' ? .52 : .66, dist: NARROW() ? d * 1.28 : d, ty: .06 };
  };
  function setState(s, opt = {}) {
    state = s;
    root.dataset.state = s;
    if (s === 'S1') {
      FOCUS = null; HOVER = null; hoverEl.hidden = true;
      openDossier(null); regionCard.hidden = true;
      crumb.innerHTML = '';
      flyTo({ yaw: NARROW() ? cam.yaw : -.38, pitch: NARROW() ? .82 : .70, dist: NARROW() ? 7.2 : 6.0, ty: .10, dur: reduced ? 400 : 1400 });
      setHash('');
      say('全岛');
    } else if (s === 'S2') {
      const key = opt.region;
      FOCUS = null; HOVER = null; hoverEl.hidden = true; openDossier(null);
      const c = camForRegion(key);
      const span = Math.abs(c.dist - cam.dist);
      const dur = reduced ? 400 : clamp(1200 * Math.sqrt(Math.max(span, .4) / 3.2), 900, 1800);
      flyTo({ ...c, dur, arc: 0 });
      showRegionCard(key);
      triggerPhenom(key);
      const r = REGIONS.find(x => x.key === key);
      crumb.innerHTML = `<button data-crumb="S1">山海图</button><span>/</span><b>${esc(r ? r.label : '')}</b>`;
      crumb.querySelector('[data-crumb]').addEventListener('click', () => setState('S1'));
      setHash('r=' + key);
      say(`${r ? r.label : ''} 分区`);
    } else if (s === 'S3') {
      const nd = opt.node;
      FOCUS = nd; HOVER = null; hoverEl.hidden = true;
      const L = Math.hypot(nd.x, nd.z);
      const yaw = opt.keepDossier ? cam.yaw : (L > .02 ? Math.atan2(nd.x, nd.z) : cam.yaw);
      const pitch = opt.keepDossier ? clamp(cam.pitch, .50, .70) : (NARROW() ? .76 : .70);
      const dist = NARROW() ? 4.0 : 3.6;
      const dYaw = Math.abs(wrapA(yaw - cam.yaw));
      flyTo({ yaw, pitch, dist, ty: .05, dur: reduced ? 400 : opt.keepDossier ? 900 : 1100, arc: dYaw > Math.PI / 2 ? .7 : 0 });
      openDossier(nd);
      const r = REGIONS.find(x => x.key === nd.region);
      crumb.innerHTML = `<button data-crumb="S1">山海图</button><span>/</span><button data-crumb="${esc(nd.region)}">${esc(r ? r.label : '')}</button><span>/</span><b>${esc(nd.name)}</b>`;
      crumb.querySelectorAll('[data-crumb]').forEach(b => b.addEventListener('click', () => { const v = b.dataset.crumb; v === 'S1' ? setState('S1') : setState('S2', { region: v }); }));
      setHash('n=' + encodeURIComponent(nd.id));
    }
  }
  function focusNode(nd, opt = {}) { if (!nd) return; setState('S3', { node: nd, ...opt }); }
  const PHEN_NAMES = { 1: '海市蜃楼', 2: '星陨', 3: '鲸落', 4: '极光', 5: '霞光', 6: '云瀑' };
  function triggerPhenom(zone, force) {
    if (reduced || paused) return;
    if (PHENOM && PHENOM.life > 0) return;
    const I = ISLES[zone] || ISLES.company;
    const pool = isNight() ? [1, 2, 3, 4, 3] : [1, 2, 5, 1, 5];
    const kind = force || pool[Math.floor(Math.random() * pool.length)];
    const at = Math.hypot(I.cx, I.cz) > .1 ? Math.atan2(I.cx, I.cz) : .6;
    PHENOM = { kind, t0: performance.now(), dur: 4200 + Math.random() * 1600, life: 1, fade: 0, at };
    if (kind === 6) PHENOM.dur = 3800;
    say(PHEN_NAMES[kind] + ' 现于' + (I.label || ''));
  }
  function stepPhenom(now) {
    if (!PHENOM) return;
    const t = (now - PHENOM.t0) / PHENOM.dur;
    if (t >= 1) { PHENOM = null; return; }
    PHENOM.life = 1 - t;
    PHENOM.fade = Math.min(1, t * 4) * Math.min(1, (1 - t) * 3);
  }
  function setHash(q) {
    const url = location.pathname + location.search + (q ? '#' + q : '');
    try { history.replaceState(null, '', url); } catch (e) {}
  }
  function saveCam() {
    try { sessionStorage.setItem('atlas-cam', JSON.stringify({ yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, ty: cam.ty, focus: FOCUS ? FOCUS.id : '', state })); } catch (e) {}
  }

  /* ================= 命中 ================= */
  function hitTest(mx, my) {
    let best = null, bd = 1e9;
    const R = NARROW() ? 26 : 20;
    for (const nd of NODES) {
      if (!nd._p) continue;
      if (!filter.has(nd.region) && !pins.includes(nd.id)) continue;
      const d = (nd._p.x - mx) ** 2 + (nd._p.y - my) ** 2;
      if (d < R * R && d < bd) { bd = d; best = nd; }
    }
    return best;
  }

  function hitLore(mx, my) {
    const R = NARROW() ? 30 : 24;
    let best = null, bd = R * R;
    if (SHOW_SECT) for (const sct of SECTS) {
      if (!sct._p) continue;
      const d = (sct._p.x - mx) ** 2 + (sct._p.y - my) ** 2;
      if (d < bd) { bd = d; best = { kind: 'sect', item: sct }; }
    }
    for (const dp of DEPTHS) {
      if (!dp._p) continue;
      const d = (dp._p.x - mx) ** 2 + (dp._p.y - my) ** 2;
      if (d < bd * .8) { bd = d; best = { kind: 'depth', item: dp }; }
    }
    if (SHOW_BEAST) for (const b of BEASTS) {
      if (!b._p) continue;
      const d = (b._p.x - mx) ** 2 + (b._p.y - my) ** 2;
      if (d < bd) { bd = d; best = { kind: 'beast', item: b }; }
    }
    return best;
  }
  function showLoreCard(hit) {
    const it = hit.item;
    if (hit.kind === 'sect') {
      hoverEl.innerHTML = `<div class="ah-top"><span class="ah-seal" data-region="${it.zone}">${esc(it.name.slice(0, 1))}</span>
        <div class="ah-title"><b>${esc(it.name)}</b><i>宗门 · ${esc((REGIONS.find(r => r.key === it.zone) || {}).label || '')}</i></div></div>
        <p class="ah-one">${esc(it.creed || '')}</p>
        <div class="ah-facts"><span>圣兽 ${esc(it.beast || '—')}</span><span>禁忌：${esc(it.taboo || '—')}</span></div>
        <div class="ah-foot"><span>入宗门 →</span><span>单击定位</span></div>`;
    } else if (hit.kind === 'depth') {
      hoverEl.innerHTML = `<div class="ah-top"><span class="ah-seal" data-region="${it.zone}">秘</span>
        <div class="ah-title"><b>${esc(it.name)}</b><i>秘境 · ${esc((REGIONS.find(r => r.key === it.zone) || {}).label || '')}</i></div></div>
        <p class="ah-one">${esc(it.text || '')}</p>
        <div class="ah-foot"><span>入秘境 →</span><span>单击定位</span></div>`;
    } else {
      hoverEl.innerHTML = `<div class="ah-top"><span class="ah-seal" data-region="${it.zone}">兽</span>
        <div class="ah-title"><b>${esc(it.name)}</b><i>圣兽 · ${esc(it.form || '')}</i></div></div>
        <p class="ah-one">${esc(it.text || '')}</p>
        <div class="ah-facts"><span>其德 ${esc(it.virtue || '—')}</span></div>
        <div class="ah-foot"><span>${esc((REGIONS.find(r => r.key === it.zone) || {}).label || '')}</span><span>单击飞去</span></div>`;
    }
    hoverEl.hidden = false; hoverEl.classList.add('on');
    const p = it._p, bw = 286, hgt = hoverEl.offsetHeight || 120;
    const x = clamp(p.x - bw / 2, 10, W - bw - 10);
    let y = p.y - hgt - 16; if (y < 10) y = p.y + 22;
    hoverEl.style.transform = `translate3d(${x.toFixed(0)}px,${y.toFixed(0)}px,0)`;
  }

  /* ================= HUD ================= */
  function buildChips() {
    chipsEl.innerHTML = `<button class="atlas-chip active" data-region="all"><b>全岛</b><span>${NODES.length}</span></button>` +
      REGIONS.map(r => `<button class="atlas-chip active" data-region="${r.key}" title="${esc(r.sub)}"><span class="atlas-chip-dot"></span><b>${esc(r.label)}</b><span>${r.count}</span></button>`).join('');
    chipsEl.querySelectorAll('[data-region]').forEach(b => b.addEventListener('click', () => toggleRegion(b.dataset.region)));
  }
  function syncChips() {
    chipsEl.querySelectorAll('[data-region]').forEach(b => {
      const k = b.dataset.region;
      b.classList.toggle('active', k === 'all' ? filter.size === ORDER.length : filter.has(k));
    });
  }
  function toggleRegion(k) {
    if (k === 'all') { filter = new Set(ORDER); setState('S1'); }
    else if (filter.size === 1 && filter.has(k)) { filter = new Set(ORDER); setState('S1'); }
    else { filter = new Set(ORDER); setState('S2', { region: k }); }
    syncChips();
  }
  function zoomBy(k) { cam.tDist = clamp(cam.tDist * k, 1.25, 12); }
  $$('[data-act]').forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a === 'zoom-in') zoomBy(.84);
    if (a === 'zoom-out') zoomBy(1.18);
    if (a === 'search') openSearch();
    if (a === 'guide') toggleGuide();
    if (a === 'pause') togglePause(b);
    if (a === 'help') { buildLegend(); toggleHelp(true); }
  }));

  /* ================= 指针 / 滚轮 / 触屏 ================= */
  let drag = null, downAt = null, inertia = [0, 0], lastMove = 0;
  function localPos(ev) { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
  function beginDrag(mx, my) { drag = { x: mx, y: my }; inertia = [0, 0]; canvas.classList.add('grabbing'); }
  function moveDrag(mx, my, now) {
    if (!drag) return;
    const dx = mx - drag.x, dy = my - drag.y;
    cam.yaw -= dx * .0042; cam.pitch = clamp(cam.pitch + dy * .0032, .17, 1.42);
    cam.tYaw = cam.yaw; cam.tPitch = cam.pitch;
    tween.on = false; cam.spin = false;
    const dtl = Math.max(1, now - lastMove); lastMove = now;
    inertia = [clamp(dx * .0042 / (dtl / 16), -.05, .05), clamp(dy * .0032 / (dtl / 16), -.03, .03)];
    drag.x = mx; drag.y = my;
  }
  canvas.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    const [mx, my] = localPos(ev);
    downAt = [mx, my, ev.timeStamp]; lastMove = ev.timeStamp;
    if (ev.pointerType === 'mouse') { beginDrag(mx, my); canvas.setPointerCapture(ev.pointerId); }
  });
  canvas.addEventListener('pointermove', ev => {
    const [mx, my] = localPos(ev);
    if (drag) { moveDrag(mx, my, ev.timeStamp); return; }
    if (ev.pointerType !== 'mouse') return;
    const lore = hitLore(mx, my);
    if (lore) {
      HOVER = null; clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => showLoreCard(lore), 120);
      canvas.style.cursor = 'pointer';
      window.__loreHit = { kind: lore.kind, item: lore.item };
      return;
    }
    window.__loreHit = null;
    const nd = hitTest(mx, my);
    if (nd !== HOVER) {
      HOVER = nd;
      canvas.style.cursor = nd ? 'pointer' : 'grab';
      clearTimeout(hoverTimer);
      if (nd) hoverTimer = setTimeout(() => showHover(nd, mx, my), 120);
      else if (!window.__loreHit) showHover(null);
    }
  });
  canvas.addEventListener('pointerup', ev => {
    const [mx, my] = localPos(ev);
    const tap = downAt && Math.hypot(mx - downAt[0], my - downAt[1]) < 7 && ev.timeStamp - downAt[2] < 700;
    drag = null; canvas.classList.remove('grabbing'); canvas.style.cursor = 'grab';
    downAt = null;
    if (!tap) return;
    const lore = hitLore(mx, my);
    if (lore) {
      showLoreCard(lore);
      window.__lorePicked = lore;
      if (lore.kind === 'sect') {
        const I = ISLES[lore.item.zone];
        flyTo({ yaw: Math.atan2(lore.item.x, lore.item.z), pitch: .58, dist: 2.6, ty: .10, dur: 1200 });
        setTimeout(() => { if (lore.item.href) location.href = lore.item.href; }, 450);
      } else if (lore.kind === 'depth') {
        flyTo({ yaw: Math.atan2(lore.item.x, lore.item.z), pitch: .5, dist: 2.2, ty: .10, dur: 1200 });
        setTimeout(() => { if (lore.item.href) location.href = lore.item.href; }, 650);
      } else {
        flyTo({ yaw: Math.atan2(lore.item.cx, lore.item.cz), pitch: .62, dist: 3.2, ty: .10, dur: 1200 });
      }
      say(lore.kind === 'sect' ? `${lore.item.name} · 入宗门` : lore.kind === 'depth' ? `${lore.item.name} · 入秘境` : `${lore.item.name} · 圣兽`);
      return;
    }
    const nd = hitTest(mx, my);
    if (!nd) { if (state === 'S3') setState('S2', { region: FOCUS ? FOCUS.region : 'company' }); return; }
    if (FOCUS === nd) { saveCam(); location.href = nd.file; return; }
    focusNode(nd);
  });
  canvas.addEventListener('pointercancel', () => { drag = null; canvas.classList.remove('grabbing'); });
  canvas.addEventListener('pointerleave', () => { if (drag) return; HOVER = null; showHover(null); canvas.style.cursor = 'grab'; });
  canvas.style.cursor = 'grab';

  canvas.addEventListener('wheel', ev => {
    ev.preventDefault();
    const k = Math.exp(clamp(ev.deltaY, -120, 120) * .0011);
    const old = cam.tDist;
    cam.tDist = clamp(cam.tDist * k, 1.25, 12);
    // 指针锚定：缩放时朝指针所指的地面点推近
    if (!reduced && ev.deltaMode === 0 && cam.tDist < old) {
      const [mx, my] = localPos(ev);
      const nd = hitTest(mx, my);
      if (nd && !tween.on) {
        const dy = wrapA(Math.atan2(nd.x, nd.z) - cam.yaw);
        cam.yaw += dy * Math.min(.10, (1 - cam.tDist / old) * .35);
      }
    }
    if (state === 'S1' && cam.tDist < 5 && !tween.on) { /* 推近后进入区内视角；不强制改状态 */ }
  }, { passive: false });
  canvas.addEventListener('dblclick', ev => {
    const [mx, my] = localPos(ev);
    cam.tDist = clamp(cam.tDist * .68, 1.25, 12);
    const nd = hitTest(mx, my);
    if (nd) focusNode(nd);
  });

  /* 触屏：单指拖、双指缩放、长按钉选 */
  let pinch = null, longPress = null;
  canvas.addEventListener('touchstart', ev => {
    if (ev.touches.length === 2) {
      const [a, b] = ev.touches;
      pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: cam.tDist, yaw: cam.yaw, pitch: cam.pitch, cy: (a.clientY + b.clientY) / 2 };
      drag = null;
    } else if (ev.touches.length === 1) {
      const t = ev.touches[0], [mx, my] = localPos(t);
      downAt = [mx, my, ev.timeStamp];
      clearTimeout(longPress);
      longPress = setTimeout(() => {
        const nd = hitTest(mx, my);
        if (nd) { togglePin(nd.id); try { navigator.vibrate && navigator.vibrate(8); } catch (e) {} }
      }, 520);
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', ev => {
    if (ev.touches.length === 2 && pinch) {
      ev.preventDefault();
      const [a, b] = ev.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const cy = (a.clientY + b.clientY) / 2;
      cam.tDist = clamp(pinch.z * pinch.d / Math.max(1, d), 1.25, 12);
      cam.pitch = clamp(pinch.pitch + (cy - pinch.cy) * .002, .17, 1.42);
      cam.tYaw = cam.yaw; cam.tPitch = cam.pitch;
      tween.on = false;
      return;
    }
    if (ev.touches.length === 1) {
      clearTimeout(longPress);
      const t = ev.touches[0], [mx, my] = localPos(t);
      if (!drag) beginDrag(mx, my);
      else moveDrag(mx, my, ev.timeStamp);
    }
  }, { passive: false });
  canvas.addEventListener('touchend', ev => {
    clearTimeout(longPress);
    if (pinch && ev.touches.length < 2) pinch = null;
    if (drag && downAt && ev.changedTouches.length === 1) {
      const t = ev.changedTouches[0], [mx, my] = localPos(t);
      const tap = Math.hypot(mx - downAt[0], my - downAt[1]) < 9 && ev.timeStamp - downAt[2] < 520;
      drag = null;
      if (tap) {
        const nd = hitTest(mx, my);
        if (nd) { if (FOCUS === nd) { saveCam(); location.href = nd.file; } else focusNode(nd); }
      }
    }
    drag = null;
  }, { passive: true });

  /* ================= 键盘 ================= */
  function regionList() { return REGIONS.map(r => r.key); }
  function cycle(d) {
    if (filter.size === 1) {
      const k = [...filter][0], i = regionList().indexOf(k);
      setState('S2', { region: regionList()[(i + d + 7) % 7] });
      syncChips();
      return;
    }
    const i = REGIONS.findIndex(r => r.key === (state === 'S2' && FOCUS ? FOCUS.region : ''));
    const nk = (state === 'S2' ? i + d : 0 + 3);
    setState('S2', { region: REGIONS[(state === 'S2' ? (i + d + 7) % 7 : (d > 0 ? 0 : 6))].key });
    syncChips();
  }
  function tabNode(d) {
    let pool = NODES.filter(n => filter.has(n.region));
    if (FOCUS) {
      const i = pool.indexOf(FOCUS);
      if (i >= 0) pool = pool.slice(i + 1).concat(pool.slice(0, i));
    }
    for (const nd of pool) { if (nd === FOCUS) continue; setState('S3', { node: nd, keepDossier: true }); focusLabelTab(nd); return; }
  }
  function focusLabelTab(nd) {
    const el = labelPool.find(l => l._t && nd.name.startsWith(l._t.replace('…', '')));
    if (el) { el.tabIndex = -1; el.focus && el.focus(); }
  }
  function neighbour(d) {
    if (!FOCUS) return;
    const list = (LINKS_OF.get(FOCUS.id) || []).map(l => BYID.get(l[0] === FOCUS.id ? l[1] : l[0])).filter(Boolean);
    if (!list.length) return;
    const i = list.indexOf(FOCUS._nbLast);
    focusNode(list[(i + d + list.length) % list.length]);
    FOCUS._nbLast = FOCUS;
  }
  let tabIdx = 0;
  document.addEventListener('keydown', ev => {
    const tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    switch (ev.key) {
      case 'ArrowLeft': case 'a': case 'A': cam.yaw += .08; cam.tYaw = cam.yaw; tween.on = false; ev.preventDefault(); break;
      case 'ArrowRight': case 'd': case 'D': cam.yaw -= .08; cam.tYaw = cam.yaw; tween.on = false; ev.preventDefault(); break;
      case 'ArrowUp': case 'w': case 'W': cam.pitch = clamp(cam.pitch - .06, .17, 1.42); cam.tPitch = cam.pitch; tween.on = false; ev.preventDefault(); break;
      case 'ArrowDown': case 's': case 'S': cam.pitch = clamp(cam.pitch + .06, .17, 1.42); cam.tPitch = cam.pitch; tween.on = false; ev.preventDefault(); break;
      case '+': case '=': zoomBy(.9); break;
      case '-': case '_': zoomBy(1.12); break;
      case '[': neighbour(-1); break;
      case ']': neighbour(1); break;
      case 'Tab': ev.preventDefault(); tabNode(ev.shiftKey ? -1 : 1); break;
      case 'Enter':
        if (HOVER) focusNode(HOVER);
        else if (FOCUS) { saveCam(); location.href = FOCUS.file; }
        break;
      case 'p': case 'P': if (FOCUS) togglePin(FOCUS.id); break;
      case ' ': ev.preventDefault(); togglePause(); break;
      case '/': ev.preventDefault(); openSearch(); break;
      case 'l': case 'L': labelLevel = (labelLevel + 1) % 3; say(['标签：疏', '标签：中', '标签：密'][labelLevel]); break;
      case 'm': case 'M': showMini = !showMini; root.classList.toggle('no-mini', !showMini); break;
      case 'g': case 'G': SHOW_DEPTH = !SHOW_DEPTH; say(SHOW_DEPTH ? '秘境：显' : '秘境：隐'); syncLegend(); break;
      case '?': toggleHelp(true); break;
      case 'Escape': closeAll(); break;
      default:
        if (/^[0-9]$/.test(ev.key)) {
          if (ev.key === '0') setState('S1');
          else setState('S2', { region: ORDER[+ev.key - 1] });
          syncChips();
        }
    }
  });
  function closeAll() {
    if (helpEl.hidden === false) { toggleHelp(false); return; }
    if (guideEl.hidden === false) { toggleGuide(false); return; }
    if (searchEl.hidden === false) { closeSearch(); return; }
    if (state === 'S3') setState('S2', { region: FOCUS ? FOCUS.region : 'company' });
    else if (state === 'S2') setState('S1');
  }

  /* ================= 图内搜索 ================= */
  let searchTimer = null, searchIdx = -1, searchResults = [];
  function openSearch() {
    searchEl.hidden = false; searchInput.value = ''; searchResults = []; renderSearchList();
    setTimeout(() => searchInput.focus(), 30);
    say('图内搜索');
  }
  function closeSearch() { searchEl.hidden = true; SEARCH_HIT = null; }
  function searchFor(q) {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return NODES.map(nd => {
      let score = 0;
      const nm = (nd.name || '').toLowerCase(), en = (nd.en || '').toLowerCase(), one = (nd.one || '').toLowerCase();
      if (nm === s || en === s) score = 100;
      else if (nm.startsWith(s) || en.startsWith(s)) score = 70;
      else if (nm.includes(s) || en.includes(s)) score = 40;
      else if ((nd.facts || []).some(f => String(f).toLowerCase().includes(s))) score = 24;
      else if (one.includes(s)) score = 14;
      return { nd, score };
    }).filter(x => x.score).sort((a, b) => b.score - a.score).slice(0, 9);
  }
  function renderSearchList() {
    if (!searchResults.length) {
      searchList.innerHTML = searchInput.value.trim() ? '<div class="asl-empty">图上没有。换个词，或直接 ⌘K 搜全站。</div>' : '<div class="asl-empty">输入名称、标签或城市。结果是图上的地标。</div>';
      return;
    }
    searchList.innerHTML = searchResults.map(({ nd }, i) => `<button class="asl-row${i === searchIdx ? ' on' : ''}" data-i="${i}" role="option"><span class="ds-dot" data-region="${nd.region}"></span><span class="asl-name">${esc(nd.name)}</span><span class="asl-sub">${esc(nd.en || (REGIONS.find(r => r.key === nd.region) || {}).label || '')}</span></button>`).join('');
    searchList.querySelectorAll('.asl-row').forEach(b => b.addEventListener('click', () => pickSearch(+b.dataset.i)));
  }
  function pickSearch(i) {
    const r = searchResults[i];
    if (!r) return;
    closeSearch();
    focusNode(r.nd);
  }
  function previewSearch(i) {
    searchIdx = i;
    const r = searchResults[i];
    if (!r) return;
    SEARCH_HIT = r.nd;
    renderSearchList();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (state !== 'S3') flyTo({ yaw: Math.atan2(r.nd.x, r.nd.z), pitch: .55, dist: Math.max(cam.dist * .8, 2.2), dur: 900 });
    }, 180);
  }
  searchInput.addEventListener('input', () => {
    searchResults = searchFor(searchInput.value);
    searchIdx = -1;
    renderSearchList();
    if (searchResults.length) previewSearch(0);
    else SEARCH_HIT = null;
  });
  searchInput.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); previewSearch(Math.min(searchResults.length - 1, searchIdx + 1)); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); previewSearch(Math.max(0, searchIdx - 1)); }
    else if (ev.key === 'Enter') { ev.preventDefault(); if (searchIdx < 0 && searchResults[0]) pickSearch(0); else pickSearch(searchIdx); }
    else if (ev.key === 'Escape') { closeSearch(); }
  });

  /* ================= 名录（等价通道） ================= */
  function toggleGuide(force) {
    const show = force != null ? force : guideEl.hidden;
    guideEl.hidden = !show;
    if (show) {
      const groups = REGIONS.map(r => {
        const list = NODES.filter(n => n.region === r.key);
        return `<section data-region="${r.key}"><h4><span class="ds-dot" data-region="${r.key}"></span>${esc(r.label)}<em>${list.length}</em></h4><ul>${list.slice(0, 40).map(n => `<li><button data-guide-id="${esc(n.id)}" tabindex="-1">${esc(n.name)}</button></li>`).join('')}</ul></section>`;
      }).join('');
      guideList.innerHTML = groups;
      guideList.querySelectorAll('[data-guide-id]').forEach(b => {
        b.addEventListener('click', () => { const nd = BYID.get(b.dataset.guideId); if (nd) { focusNode(nd); closeGuideOnMobile(); } });
        b.addEventListener('focus', () => { const nd = BYID.get(b.dataset.guideId); if (nd && nd !== FOCUS) { FOCUS = nd; SEARCH_HIT = nd; } });
        b.addEventListener('keydown', ev => { if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); const all = [...guideList.querySelectorAll('button')]; const i = all.indexOf(b); all[clamp(i + (ev.key === 'ArrowDown' ? 1 : -1), 0, all.length - 1)].focus(); } });
      });
      guideList.querySelectorAll('button')[0] && guideList.querySelectorAll('button')[0].focus({ preventScroll: true });
    }
  }
  function closeGuideOnMobile() { if (NARROW()) toggleGuide(false); }
  guideEl.querySelector('[data-guide-close]').addEventListener('click', () => toggleGuide(false));

  function toggleHelp(force) { helpEl.hidden = force != null ? !force : !helpEl.hidden; if (!helpEl.hidden) syncLegend(); }
  function buildLegend() {
    const box = q => helpEl.querySelector(`[data-legion="${q}"]`);
    if (!box('regions')) return;
    box('regions').innerHTML = REGIONS.map(r => `<label><input type="checkbox" data-leg="${r.key}" checked><span data-region="${r.key}">${esc(r.label)}</span><em>${r.count}</em></label>`).join('');
    if (LORE) {
      box('sects').innerHTML = (LORE.sects || []).map(x => `<label><input type="checkbox" data-leg-sect="1" checked><span data-region="${x.zone}">${esc(x.name)}</span><em>${esc(x.beast || '')}</em></label>`).join('');
      box('beasts').innerHTML = (LORE.beasts || []).map(x => `<label><input type="checkbox" data-leg-beast="1" checked><span data-region="${x.zone}">${esc(x.name)}</span><em>${esc(x.virtue || '')}</em></label>`).join('');
      box('depths').innerHTML = `<label><input type="checkbox" data-leg-depth="1"${SHOW_DEPTH ? ' checked' : ''}><span>显示秘境</span><em>${(LORE.depths || []).length} 处</em></label>` +
        (LORE.depths || []).map(x => `<label class="leg-dim"><span data-region="${x.zone}">${esc(x.name)}</span><a href="${esc(x.href || '#')}">→</a></label>`).join('');
      box('phenomena').innerHTML = (LORE.phenomena || []).map(x => `<label class="leg-dim"><span>${esc(x.name)}</span><em>${esc(x.where || '')}</em></label>`).join('');
      box('factions').innerHTML = (LORE.factions || []).map(x => `<label class="leg-dim"><a href="${esc(x.href || '#')}">${esc(x.name)}</a><em>${(x.members || []).length}</em></label>`).join('');
      box('schools').innerHTML = (LORE.schools || []).map(x => `<label class="leg-dim"><a href="${esc(x.href || '#')}">${esc(x.name)}</a><em>${(x.works || []).length}</em></label>`).join('');
      box('trials').innerHTML = (LORE.trials || []).map(x => `<label class="leg-dim"><a href="${esc(x.href || '#')}">${esc(x.name)}</a><em>${esc(String(x.level))}</em></label>`).join('');
    }
    helpEl.querySelectorAll('[data-leg]').forEach(cb => cb.addEventListener('change', () => {
      const k = cb.dataset.leg;
      if (cb.checked) filter.add(k); else filter.delete(k);
      syncChips();
    }));
    helpEl.querySelectorAll('[data-leg-sect]').forEach(cb => cb.addEventListener('change', () => { SHOW_SECT = cb.checked; }));
    helpEl.querySelectorAll('[data-leg-beast]').forEach(cb => cb.addEventListener('change', () => { SHOW_BEAST = cb.checked; }));
    helpEl.querySelectorAll('[data-leg-depth]').forEach(cb => cb.addEventListener('change', () => { SHOW_DEPTH = cb.checked; }));
  }
  function syncLegend() {
    if (!helpEl || !helpEl.querySelector('[data-legion="regions"]')) return;
    helpEl.querySelectorAll('[data-leg]').forEach(cb => { cb.checked = filter.has(cb.dataset.leg); });
    const dd = helpEl.querySelector('[data-leg-depth]'); if (dd) dd.checked = SHOW_DEPTH;
  }
  helpEl.querySelector('[data-help-close]').addEventListener('click', () => toggleHelp(false));
  helpEl.addEventListener('click', ev => { if (ev.target === helpEl) toggleHelp(false); });

  function togglePause(btn) {
    paused = !paused;
    root.classList.toggle('paused', paused);
    $$('[data-act="pause"]').forEach(b => { b.setAttribute('aria-pressed', String(paused)); b.classList.toggle('on', paused); });
    say(paused ? '已暂停自动运动' : '继续');
  }

  /* ================= 罗盘与小地图 ================= */
  compass.addEventListener('click', () => { flyTo({ yaw: 0, dur: 800 }); });
  compass.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); flyTo({ yaw: 0, dur: 800 }); } });
  const miniWrap = $('.atlas-minimap');
  function miniPick(ev) {
    const r = mini.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width * 2 * EXT - EXT;
    const z = (ev.clientY - r.top) / r.height * 2 * EXT - EXT;
    let best = null, bd = .3;
    for (const nd of NODES) { const d = Math.hypot(nd.x - x, nd.z - z); if (d < bd) { bd = d; best = nd; } }
    if (best) focusNode(best);
    else flyTo({ yaw: Math.atan2(x, z), pitch: .8, dist: 4.2, dur: 1000 });
  }
  miniWrap.addEventListener('pointerdown', miniPick);
  miniWrap.style.display = showMini ? '' : 'none';

  /* ================= 主题、尺寸、主循环 ================= */
  let CLOUD_BIAS = 0;
  function syncTheme() {
    root.classList.toggle('night', isNight());
    miniBase = null;
  }
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const ro = new ResizeObserver(() => { if (Math.abs(canvas.parentElement.getBoundingClientRect().width - W) > 2) resizeGL(); });
  ro.observe(canvas.parentElement);

  let raf = 0, lastTs = 0, visible = true, idleFrames = 0, frameAcc = 0, frameCnt = 0, miniTick = 0;
  document.addEventListener('visibilitychange', () => { visible = document.visibilityState === 'visible'; });
  new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(canvas);
  /* 上下文丢失：先冻结动画并给出提示，恢复后重载一次，避免白屏 */
  let ctxLost = false;
  canvas.addEventListener('webglcontextlost', ev => {
    ev.preventDefault(); ctxLost = true;
    root.classList.add('ctx-lost');
    say('山海图暂时中断，正在重新起笔。');
  }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    ctxLost = false;
    try {
      const k = 'atlas-ctx-reload';
      const last = +(sessionStorage.getItem(k) || 0);
      if (Date.now() - last > 20000) { sessionStorage.setItem(k, String(Date.now())); location.reload(); return; }
    } catch (e) { /* 存储不可用时停在提示 */ }
    root.classList.remove('ctx-lost');
  }, false);

  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (!visible) { lastTs = ts; return; }
    const dt = Math.min(64, ts - (lastTs || ts)); lastTs = ts;
    const busy = tween.on || drag || !paused && !reduced;
    if (!busy && idleFrames > 12) return;
    idleFrames = busy ? 0 : idleFrames + 1;

    if (!paused && !reduced && cam.spin && !drag && !tween.on && state !== 'S3') cam.yaw += dt * .000032;
    if (drag && !drag.moving) { /* inertia 在 pointerup 之后结算 */ }
    // 惯性
    if (!drag && (Math.abs(inertia[0]) > 1e-4 || Math.abs(inertia[1]) > 1e-4)) {
      cam.yaw -= inertia[0]; cam.pitch = clamp(cam.pitch + inertia[1], .17, 1.42);
      inertia[0] *= .92; inertia[1] *= .92;
    }
    // 缩放阻尼（仅在无相机补间时生效，否则会与补间互相覆盖）
    if (!tween.on) { if (!reduced) cam.dist += (cam.tDist - cam.dist) * .12; else cam.dist = cam.tDist; }
    stepTween(ts);
    stepPhenom(ts);
    // 季候也管云量：春雾重、秋云薄、冬阴沉
    const SEASON_CLOUD = { spring: .16, summer: -.05, autumn: -.08, winter: .10 };
    CLOUD_BIAS = introActive(ts) + (SEASON_CLOUD[root.dataset.season] || 0);

    const tR = performance.now();
    renderFrame(paused || reduced ? 0 : ts);
    drawLabels();
    drawIsles();
    stats.ft = stats.ft * .9 + (performance.now() - tR) * .1;
    stats.cnt = (stats.cnt || 0) + 1;
    if (!stats.t0) stats.t0 = performance.now();
    else if (performance.now() - stats.t0 > 1000) { stats.fps = Math.round(stats.cnt * 1000 / (performance.now() - stats.t0)); stats.cnt = 0; stats.t0 = performance.now(); }
    // 罗盘
    const needle = compass.querySelector('.needle');
    if (needle) compass.querySelector('svg').style.transform = `rotate(${(cam.yaw * 180 / Math.PI).toFixed(1)}deg)`;
    // 悬停卡跟随（锚定地标，重投影后同步位置）
    if (HOVER && !hoverEl.hidden && HOVER._p) {
      const bw = 286, hgt = hoverEl.offsetHeight || 120;
      let x = clamp(HOVER._p.x - bw / 2, 10, W - bw - 10);
      let y = HOVER._p.y - hgt - 18;
      if (y < 10) y = HOVER._p.y + 26;
      hoverEl.style.transform = `translate3d(${x.toFixed(0)}px,${y.toFixed(0)}px,0)`;
    }
    if (++miniTick % 8 === 0 && showMini) { if (!miniBase) { miniBase = buildMiniBase(false); miniBaseNight = buildMiniBase(true); } drawMini(); }
    // 自适应分辨率
    frameAcc += dt; frameCnt++;
    if (frameCnt >= 60) {
      const avg = frameAcc / frameCnt;
      if (avg > 26 && renderScale > .62) { renderScale = Math.max(.62, renderScale - .1); resizeGL(); }
      else if (avg < 13 && renderScale < 1) { renderScale = Math.min(1, renderScale + .05); resizeGL(); }
      frameAcc = 0; frameCnt = 0;
    }
  }
  const introStart = performance.now();
  function introActive(ts) {
    const t = (ts - introStart) / 1500;
    return t >= 1 ? 0 : (1 - E_IN(clamp(t, 0, 1))) * .42;
  }

  /* ================= 载入 ================= */
  function loadFallback(reason) {
    window.__atlasFallback = reason;
    root.innerHTML = '';
    root.dataset.ready = '';
    const s = document.createElement('script'); s.src = 'atlas-2d.js'; s.defer = true;
    document.body.appendChild(s);
  }
  function hashTarget() {
    const h = location.hash.replace(/^#/, '');
    if (h.startsWith('n=')) return { type: 'n', id: decodeURIComponent(h.slice(2)) };
    if (h.startsWith('r=')) return { type: 'r', key: h.slice(2) };
    return null;
  }
  function restoreSession() {
    try {
      const c = JSON.parse(sessionStorage.getItem('atlas-cam') || 'null');
      if (!c) return false;
      cam.yaw = c.yaw; cam.pitch = clamp(c.pitch, .2, 1.4); cam.dist = cam.tDist = clamp(c.dist, 1.3, 10); cam.ty = c.ty || .05;
      if (c.focus && BYID.get(c.focus)) setTimeout(() => focusNode(BYID.get(c.focus)), 60);
      return true;
    } catch (e) { return false; }
  }

  tick().then(() => {
    const narrow = NARROW() || coarse;
    const n = narrow ? 224 : (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4 ? 256 : 384);
    if (window.__atlasFallback === 'no-webgl2') return;
    initBuffers();
    boot.style.setProperty('--boot', .05);
    fetch(window.ATLAS_DATA_URL || 'atlas.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }).catch(() => fetch('dist/atlas.json', { cache: 'no-cache' }).then(r => r.json()))
    .then(d => {
      if (!d) { boot.querySelector('em').textContent = '图谱数据未能载入'; return; }
      start(d, n);
    }).catch(err => {
      window.__atlasGlError = String(err);
      boot.querySelector('em').textContent = '图谱加载失败';
    });
  });

  function start(d, n) {
    DATA = d; REGIONS = d.regions || []; NODES = d.nodes.map(x => Object.assign({}, x));
    BYID = new Map(NODES.map(x => [x.id, x]));
    LINKS = d.links.slice();
    LINKS_OF = new Map();
    LINKS.forEach(l => {
      [l[0], l[1]].forEach(id => { if (!LINKS_OF.has(id)) LINKS_OF.set(id, []); LINKS_OF.get(id).push(l); });
    });
    try { pins = JSON.parse(sessionStorage.getItem('atlas-pins') || '[]').filter(id => BYID.has(id)); } catch (e) { pins = []; }
    boot.style.setProperty('--boot', .25);
    buildField(n);
    uploadField(); initGridVao(); layoutNodes();
    LORE = d.lore || null;
    buildLore();
    buildPagodas();
    buildRoutes(); buildChips(); renderPins(); syncTheme();
    boot.style.setProperty('--boot', .55);
    buildAtlas(); updateBoot();
    resizeGL();
    boot.style.setProperty('--boot', .9);
    setTimeout(() => updateBoot(), 0);
    // 入场：从云上俯冲下来，云层渐散
    const narrow = NARROW();
    if (!reduced) {
      cam.dist = cam.tDist = narrow ? 8.6 : 7.8; cam.pitch = 1.24; cam.yaw = -.9;
      flyTo({ yaw: -.38, pitch: narrow ? .82 : .70, dist: narrow ? 7.2 : 6.0, dur: 1800, ease: E_IN });
    } else { cam.yaw = -.38; cam.pitch = .70; cam.dist = cam.tDist = narrow ? 7.2 : 6.0; }
    $$('.atlas-tool, .atlas-chip, .atlas-compass, .atlas-minimap, .atlas-crumb').forEach((el, i) => { el.style.setProperty('--i', i); });
    root.dataset.state = 'S1';
    const tgt = hashTarget();
    const restored = restoreSession();
    setTimeout(() => {
      if (tgt && tgt.type === 'n' && BYID.get(tgt.id)) focusNode(BYID.get(tgt.id));
      else if (tgt && tgt.type === 'r') { filter = new Set(ORDER); setState('S2', { region: tgt.key }); syncChips(); }
      else if (!restored) { /* 停在总览 */ }
    }, reduced ? 80 : 1700);
    window.addEventListener('hashchange', () => { const t = hashTarget(); if (t && t.type === 'n' && BYID.get(t.id)) focusNode(BYID.get(t.id)); });
    root.addEventListener('pointerdown', () => root.classList.add('engaged'), { once: true });
    updateBoot();
    const introEl = $('.atlas-intro');
    if (introEl) {
      const kill = () => { if (introEl.parentNode) introEl.parentNode.removeChild(introEl); };
      if (reduced) kill(); else setTimeout(kill, 2600);
    }
    setTimeout(() => { if (boot && boot.parentNode) boot.remove(); }, 4000);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
    window.__atlasStats = () => ({ W, H, DPR, renderScale, state, nodes: NODES.length, links: LINKS.length, gl: window.__atlasGlError || 'ok', frame: +stats.ft.toFixed(2), fps: stats.fps });
  }
  window.__atlasGlError = null;
  window.__atlasNullU = () => { const o = []; for (const nm of ['uPhenom','uPaper','uKInk','uUniform','uTime','uSunDir','uDbg','uCloudBias','uNight']) { /* noop */ } return o; };
  window.__atlasU = () => { const j = {}; for (const [nm, pr] of Object.entries({pT, pW, pC, pM, pS, pR})) { j[nm] = {}; for (const [k, v] of Object.entries(pr.u || {})) j[nm][k] = v === null ? 'NULL' : 'ok'; } return j; };
  window.__atlasPalette = () => { const P = palette(); return { paper: P.paper, KInk: P.KInk, KOchre: P.KOchre, fog: P.fog, sun: P.sun }; };
  window.__atlasDebug = { render: (t) => renderFrame(t || 1000), cam, nodes: () => NODES, lore: () => ({ sects: SECTS, depths: DEPTHS, beasts: BEASTS }), depths: (on) => { SHOW_DEPTH = on; }, focus: (id) => { const n = BYID.get(id); if (n) focusNode(n); return !!n; }, get state() { return state; }, setProbe: v => { window.__probe = v ? [] : null; }, fw: () => [fw, fh], tex: () => ({ h: hTex, i: iTex, pig: tPig, nrm: tNrm, dep: tDep }), fields: () => ({ h: window.__dbgH, isl: window.__dbgI }),
    readPig: (x, y) => { const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tPig, 0); const b = new Uint8Array(4); gl.readPixels(Math.round(x), Math.round(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); return Array.from(b); },
    readScreen: (x, y) => { renderFrame(3000); const b = new Uint8Array(4); gl.readPixels(Math.round(x * fw), Math.round(y * fh), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); return Array.from(b); },
    readDep: (x, y) => { const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tDep, 0); const b = new Uint8Array(4); gl.readPixels(Math.round(x), Math.round(y), 1, 1, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, b); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); return Array.from(b); }
  };
})();
