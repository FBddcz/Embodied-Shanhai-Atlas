/* 山海图 · Canvas 2D 降级版（无 WebGL2 时由 atlas.js 动态载入）
   原 v5 荒古地形
   笛卡尔高度场 + 径向遮罩 → 逐格法向着色 → 16 级墨色 LUT 批渲染
   → 世界空间等高线 → 大气透视 → 光柱 / 尘埃 → 地标。

   性能要点（来自调研）：
   · 按 (明暗, 雾) 分桶合批，每帧只有 16~24 次 fill，不是 1800 次
   · 所有颜色字符串预生成 LUT，帧内不拼 rgba
   · 等高线只算一次（世界坐标折线），旋转时直接投影
   · DPR 上限 2，窄屏自动降网格 */
(function () {
  let canvas = document.getElementById('atlasCanvas');
  const root = document.getElementById('atlasRoot');
  if (!canvas && root) {
    root.classList.add('atlas-fallback');
    root.innerHTML = '<div class="atlas2d-stage"><canvas id="atlasCanvas" aria-hidden="true"></canvas><div class="atlas-tip" id="atlasTip" hidden></div></div>' +
      '<div class="atlas2d-bar"><div class="atlas2d-chips">' +
      [['all','全岛'],['company','人间'],['lab','学宫'],['model','灵物'],['benchmark','碑林'],['job','招贤'],['resource','藏经'],['news','驿路']]
        .map(([k, l], i) => `<button class="atlas2d-chip${i ? '' : ' active'}" data-atlas-region="${k}">${l}</button>`).join('') +
      '</div><div class="atlas2d-actions"><button class="atlas2d-btn" id="atlasPause">暂停</button><button class="atlas2d-btn" id="atlasReset">重排</button></div>' +
      '<span class="atlas2d-stat" id="atlasStat"></span></div>';
    canvas = document.getElementById('atlasCanvas');
  }
  if (!canvas) return;
  const tip = document.getElementById('atlasTip');
  const stat = document.getElementById('atlasStat');
  const pauseBtn = document.getElementById('atlasPause');
  const resetBtn = document.getElementById('atlasReset');
  const chips = [...document.querySelectorAll('[data-atlas-region]')];

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const night = () => document.documentElement.getAttribute('data-theme') === 'night';

  const SEAL = '#a33f2c';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => t * t * (3 - 2 * t);
  const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ---------- 噪声 ---------- */
  const perm = (() => {
    const r = mulberry32(1337), p = new Uint8Array(512);
    const base = [...Array(256).keys()];
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [base[i], base[j]] = [base[j], base[i]]; }
    for (let i = 0; i < 512; i++) p[i] = base[i & 255];
    return p;
  })();
  const grad2 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  function noise2(x, y) {
    const X = Math.floor(x), Y = Math.floor(y);
    const fx = x - X, fy = y - Y;
    const u = smooth(fx), v = smooth(fy);
    const g = (i, j) => grad2[perm[(perm[(X + i) & 255] + Y + j) & 511] & 7];
    const d = (i, j, dx, dy) => { const q = g(i, j); return q[0] * dx + q[1] * dy; };
    return lerp(
      lerp(d(0, 0, fx, fy), d(1, 0, fx - 1, fy), u),
      lerp(d(0, 1, fx, fy - 1), d(1, 1, fx - 1, fy - 1), u), v);
  }
  function fbm(x, y, oct) {
    let s = 0, a = 1, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += noise2(x * f, y * f) * a; n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }

  /* ---------- 分区 ---------- */
  const BASE = [
    { key: 'company',   label: '人间', sub: '诸司都邑', cx: 0.00, cz: 0.02, r: 0.34 },
    { key: 'lab',       label: '学宫', sub: '洞天福地', cx: -0.58, cz: -0.34, r: 0.18 },
    { key: 'model',     label: '灵物', sub: '山海异兽', cx: 0.10, cz: 0.56, r: 0.17 },
    { key: 'benchmark', label: '碑林', sub: '试炼之石', cx: 0.62, cz: -0.20, r: 0.15 },
    { key: 'job',       label: '招贤', sub: '悬榜求士', cx: -0.59, cz: 0.40, r: 0.15 },
    { key: 'resource',  label: '藏经', sub: '典籍法门', cx: 0.60, cz: 0.44, r: 0.14 },
    { key: 'news',      label: '驿路', sub: '风闻驿报', cx: 0.30, cz: -0.60, r: 0.14 }
  ];
  const REG = Object.fromEntries(BASE.map(r => [r.key, r]));
  const TYPE_CN = { company: '公司', lab: '机构', model: '模型', benchmark: '榜单', job: '岗位', resource: '资源', news: '动态', event: '活动' };

  /* ---------- 山 ---------- */
  const MOUNTAINS = (() => {
    const r = mulberry32(9173), out = [];
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2 + (r() - 0.5) * 0.42;
      const rad = 0.66 + r() * 0.20;
      out.push({ x: Math.cos(a) * rad, z: Math.sin(a) * rad, h: 0.14 + r() * 0.18, r: 0.13 + r() * 0.09 });
    }
    out.push({ x: -0.32, z: 0.12, h: 0.11, r: 0.16 });
    out.push({ x: 0.36, z: 0.06, h: 0.09, r: 0.14 });
    return out;
  })();
  const COAST = a => 0.93 + 0.05 * Math.sin(a * 3 + 1.2) + 0.026 * Math.sin(a * 5 + 0.4) + 0.012 * Math.sin(a * 9 + 2.1);

  function heightAt(x, z) {
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const coast = COAST(a);
    if (r > coast) return -0.06;
    const edge = smoothstep(coast, coast * 0.62, r);
    let h = 0.055 + 0.055 * fbm(x * 2.2 + 11, z * 2.2 - 7, 4) + 0.030 * fbm(x * 5.6, z * 5.6, 3);
    for (const m of MOUNTAINS) {
      const d = Math.hypot(x - m.x, z - m.z);
      if (d < m.r) h += m.h * smooth(1 - d / m.r);
    }
    for (const g of BASE) {
      const d = Math.hypot(x - g.cx, z - g.cz);
      h *= 1 - 0.66 * smooth(clamp(1 - d / (g.r * 1.3), 0, 1));
    }
    return Math.max(0, h * edge);
  }

  /* ---------- 网格 ---------- */
  let N = 48, STEP = 2 / 48;
  let HGT = null;          // (N+1)^2 高度
  let cells = [];          // {x0,z0,x1,z1, h00,h10,h11,h01, shade, hAvg}
  let contours = [];       // 世界坐标折线 [[{x,z},...]]
  let coastPts = [];

  function buildMesh() {
    const narrow = W < 620;
    N = narrow ? 30 : 48;
    STEP = 2 / N;
    HGT = new Float32Array((N + 1) * (N + 1));
    for (let iz = 0; iz <= N; iz++) {
      for (let ix = 0; ix <= N; ix++) {
        HGT[iz * (N + 1) + ix] = heightAt(-1 + ix * STEP, -1 + iz * STEP);
      }
    }
    cells = [];
    const LX = -0.42, LY = 0.72, LZ = 0.55;
    const LL = Math.hypot(LX, LY, LZ);
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const h00 = HGT[iz * (N + 1) + ix];
        const h10 = HGT[iz * (N + 1) + ix + 1];
        const h11 = HGT[(iz + 1) * (N + 1) + ix + 1];
        const h01 = HGT[(iz + 1) * (N + 1) + ix];
        if (h00 < 0 && h10 < 0 && h11 < 0 && h01 < 0) continue;
        const x0 = -1 + ix * STEP, z0 = -1 + iz * STEP;
        const x1 = x0 + STEP, z1 = z0 + STEP;
        // 法向：两邻边叉积
        const ux = STEP, uy = h10 - h00, uz = 0;
        const vx = 0, vy = h01 - h00, vz = STEP;
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const diff = Math.max(0, (nx * LX + ny * LY + nz * LZ) / LL);
        const hAvg = (h00 + h10 + h11 + h01) / 4;
        // 环境光遮蔽：比四周低的地方积墨
        const gx = (ix > 0 ? HGT[iz * (N + 1) + ix - 1] : h00);
        const gx2 = (ix < N - 1 ? HGT[iz * (N + 1) + ix + 2] : h10);
        const gz = (iz > 0 ? HGT[(iz - 1) * (N + 1) + ix] : h00);
        const gz2 = (iz < N - 1 ? HGT[(iz + 2) * (N + 1) + ix] : h01);
        const neigh = (gx + gx2 + gz + gz2) / 4;
        const ao = clamp((neigh - hAvg) / 0.055, 0, 1);
        const slope = clamp(1 - ny, 0, 1);
        cells.push({
          x0, z0, x1, z1,
          h00, h10, h11, h01,
          shade: clamp(0.16 + 0.84 * diff - 0.30 * slope - 0.26 * ao, 0, 1),
          h: hAvg
        });
      }
    }
    buildContours();
    buildCoast();
  }

  /* marching squares，世界坐标只算一次 */
  const LEVELS = [0.05, 0.08, 0.12, 0.17, 0.23, 0.30, 0.38];
  function buildContours() {
    contours = LEVELS.map(() => []);
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const h00 = HGT[iz * (N + 1) + ix], h10 = HGT[iz * (N + 1) + ix + 1];
        const h11 = HGT[(iz + 1) * (N + 1) + ix + 1], h01 = HGT[(iz + 1) * (N + 1) + ix];
        const x0 = -1 + ix * STEP, z0 = -1 + iz * STEP;
        const x1 = x0 + STEP, z1 = z0 + STEP;
        const lo = Math.min(h00, h10, h11, h01), hi = Math.max(h00, h10, h11, h01);
        LEVELS.forEach((L, li) => {
          if (L < lo || L > hi) return;
          const pts = [];
          const edge = (ax, az, ah, bx, bz, bh) => {
            if ((ah - L) * (bh - L) < 0) {
              const t = (L - ah) / (bh - ah);
              pts.push({ x: lerp(ax, bx, t), z: lerp(az, bz, t) });
            }
          };
          edge(x0, z0, h00, x1, z0, h10);
          edge(x1, z0, h10, x1, z1, h11);
          edge(x1, z1, h11, x0, z1, h01);
          edge(x0, z1, h01, x0, z0, h00);
          if (pts.length === 2) contours[li].push(pts);
          else if (pts.length === 4) {
            contours[li].push([pts[0], pts[1]]);
            contours[li].push([pts[2], pts[3]]);
          }
        });
      }
    }
  }

  function buildCoast() {
    coastPts = [];
    for (let i = 0; i < 720; i++) {
      const a = i / 720 * Math.PI * 2;
      const r = COAST(a);
      coastPts.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
    }
  }

  /* ---------- 墨色 LUT ---------- */
  let LUT = null, LUT_NIGHT = null;
  const SHADE_STEPS = 12, FOG_STEPS = 10;
  function buildLUT() {
    const mk = (paper, inkC, fogC) => {
      const out = [];
      for (let s = 0; s < SHADE_STEPS; s++) {
        const row = [];
        const shade = s / (SHADE_STEPS - 1);
        // 高处留白、陡坡积墨
        const baseMix = 0.04 + 0.55 * (1 - shade);
        for (let f = 0; f < FOG_STEPS; f++) {
          const fog = f / (FOG_STEPS - 1);
          const c = [0, 0, 0];
          for (let k = 0; k < 3; k++) {
            const c0 = lerp(paper[k], inkC[k], baseMix);
            c[k] = Math.round(lerp(c0, fogC[k], fog));
          }
          row.push(`rgb(${c[0]},${c[1]},${c[2]})`);
        }
        out.push(row);
      }
      return out;
    };
    LUT = mk([244, 239, 228], [58, 46, 34], [214, 205, 186]);
    LUT_NIGHT = mk([25, 24, 22], [230, 222, 206], [52, 56, 58]);
  }

  /* ---------- 相机 ---------- */
  const narrow0 = innerWidth < 620;
  const cam = {
    yaw: -0.55, pitch: narrow0 ? 0.72 : 0.78,
    dist: narrow0 ? 3.5 : 3.1, tdist: narrow0 ? 3.5 : 3.1,
    spin: !narrow0
  };
  let W = 0, H = 0, DPR = 1, ctx = null, F = 1;
  let nodes = [], links = [], byId = new Map();
  let hover = null, drag = null, downAt = null;
  let running = true, t0 = 0, now = 0, lastTs = 0;
  let intro = null, filter = 'all';
  let paperPat = null, dust = [], dustSprite = null;
  const logoImgs = new Map();

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dprCap = W < 620 ? 1.6 : 2;
    DPR = Math.min(devicePixelRatio || 1, dprCap);
    W = Math.max(320, Math.round(rect.width));
    H = root ? Math.max(360, Math.round(rect.height || innerHeight * 0.8)) : Math.round(W < 620 ? Math.max(520, W * 1.12) : Math.max(520, Math.min(W * 0.70, innerHeight * 0.78)));
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx = canvas.getContext('2d');
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildPaper();
    buildMesh();
    buildDust();
  }

  function buildPaper() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const img = g.createImageData(256, 256);
    const r = mulberry32(5);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 230 + Math.floor(r() * 24);
      img.data[i] = v; img.data[i + 1] = v - 4; img.data[i + 2] = v - 13; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    paperPat = c;
  }

  function buildDust() {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,246,230,.9)');
    grd.addColorStop(1, 'rgba(255,246,230,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    dustSprite = c;
    const r = mulberry32(77);
    dust = [];
    const n = W < 620 ? 46 : 90;
    for (let i = 0; i < n; i++) {
      dust.push({
        x: r() * W, y: H * (0.14 + r() * 0.7),
        s: 0.5 + r() * 1.6, vx: (r() - 0.5) * 0.10, vy: -0.03 - r() * 0.07,
        a: 0.10 + r() * 0.22, ph: r() * 6.28
      });
    }
  }

  /* ---------- 投影 ---------- */
  let cy = 1, sy = 0, cp = 1, sp = 0, effDist = 3.1;
  function updateCam() {
    // 呼吸：极慢的俯仰与推拉，让静止画面也有生命
    const br = reduced ? 0 : Math.sin(now / 11000) * 0.012;
    const p = clamp(cam.pitch + br, 0.12, 1.35);
    cy = Math.cos(cam.yaw); sy = Math.sin(cam.yaw);
    cp = Math.cos(p); sp = Math.sin(p);
    effDist = cam.dist + (reduced ? 0 : Math.sin(now / 17000) * 0.05);
  }
  function project(x, y, z) {
    const x1 = x * cy - z * sy;
    const z1 = x * sy + z * cy;
    const y2 = y * cp + z1 * sp;
    const z2 = -y * sp + z1 * cp;
    const zc = z2 + effDist;
    const s = F / Math.max(0.25, zc);
    return { x: W / 2 + x1 * s, y: H * 0.56 - y2 * s, s, depth: zc };
  }

  /* ---------- 天空与大气 ---------- */
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    if (night()) {
      g.addColorStop(0, '#141416');
      g.addColorStop(0.45, '#1b1a18');
      g.addColorStop(1, '#232120');
    } else {
      g.addColorStop(0, '#e9e2d2');
      g.addColorStop(0.42, '#efe8d9');
      g.addColorStop(0.72, '#f2ece0');
      g.addColorStop(1, '#efe7d6');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawSun() {
    const sx = W * 0.24, sy0 = H * 0.08;
    const g = ctx.createRadialGradient(sx, sy0, 0, sx, sy0, Math.max(W, H) * 0.55);
    if (night()) {
      g.addColorStop(0, 'rgba(220,212,192,.10)');
      g.addColorStop(1, 'rgba(220,212,192,0)');
    } else {
      g.addColorStop(0, 'rgba(255,250,236,.42)');
      g.addColorStop(1, 'rgba(255,250,236,0)');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawSea() {
    const pts = [];
    for (let i = 0; i < 72; i++) {
      const a = i / 72 * Math.PI * 2;
      pts.push(project(Math.cos(a) * 2.4, -0.10, Math.sin(a) * 2.4));
    }
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath();
    const g = ctx.createLinearGradient(0, H * 0.22, 0, H);
    if (night()) {
      g.addColorStop(0, 'rgba(120,140,146,.04)');
      g.addColorStop(1, 'rgba(110,130,138,.10)');
    } else {
      g.addColorStop(0, 'rgba(150,170,168,.08)');
      g.addColorStop(1, 'rgba(140,162,160,.18)');
    }
    ctx.fillStyle = g;
    ctx.fill();
    // 波纹环
    ctx.strokeStyle = night() ? 'rgba(222,230,230,.05)' : 'rgba(78,106,110,.10)';
    ctx.lineWidth = 0.7;
    for (const rr of [1.06, 1.26, 1.5, 1.78]) {
      ctx.beginPath();
      for (let i = 0; i <= 72; i++) {
        const a = i / 72 * Math.PI * 2;
        const p = project(Math.cos(a) * rr, -0.095, Math.sin(a) * rr);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }

  function drawCloudShadows() {
    if (reduced) return;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    for (let k = 0; k < 2; k++) {
      const cx = (((now / (110000 + k * 40000)) + k * 0.45) % 1.5 - 0.25) * W;
      const cy = H * (0.46 + k * 0.12);
      const rx = W * (0.24 + k * 0.06);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
      g.addColorStop(0, night() ? 'rgba(8,8,8,.16)' : 'rgba(120,108,90,.09)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - rx, cy - rx * 0.5, rx * 2, rx);
    }
    ctx.restore();
  }

  function drawDistantLayers() {
    // 远山三层剪影，离相机越远越淡、越靠上
    const r = mulberry32(31);
    for (let layer = 0; layer < 3; layer++) {
      const baseY = H * (0.30 + layer * 0.055);
      const amp = H * (0.028 + layer * 0.016);
      const alpha = night() ? 0.05 + layer * 0.03 : 0.10 + layer * 0.05;
      const shift = reduced ? 0 : Math.sin(now / (14000 + layer * 5000)) * (6 + layer * 6);
      ctx.beginPath();
      ctx.moveTo(-40, H);
      ctx.lineTo(-40, baseY);
      const seg = 26;
      for (let i = 0; i <= seg; i++) {
        const x = -40 + (W + 80) * i / seg;
        const y = baseY - Math.abs(Math.sin(i * 1.7 + layer * 2.1)) * amp * (0.5 + r() * 0.8);
        ctx.lineTo(x + shift, y);
      }
      ctx.lineTo(W + 40, H);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, baseY - amp, 0, baseY + H * 0.16);
      const c = night() ? '190,186,176' : '120,104,82';
      g.addColorStop(0, `rgba(${c},${alpha})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.fill();
    }
  }

  function drawLightShafts() {
    if (reduced) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const sway = Math.sin(now / 6000) * 8;
    [[0.30, 0.16, 0.05], [0.46, 0.10, 0.04], [0.62, 0.13, 0.03]].forEach(([x, w, a], i) => {
      const topX = W * x + sway * (i + 1) * 0.4;
      const g = ctx.createLinearGradient(topX, 0, topX + W * 0.10, H);
      const c = night() ? '226,214,190' : '255,248,232';
      g.addColorStop(0, `rgba(${c},${a * (night() ? 1.4 : 1)})`);
      g.addColorStop(0.6, `rgba(${c},${a * 0.35})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(topX - W * 0.02, -10);
      ctx.lineTo(topX + W * 0.03, -10);
      ctx.lineTo(topX + W * (0.05 + w), H);
      ctx.lineTo(topX - W * (0.02 + w * 0.5), H);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
  }

  function drawDust() {
    if (reduced || !dustSprite) return;
    ctx.save();
    for (const d of dust) {
      if (running) {
        d.x += d.vx; d.y += d.vy;
        if (d.y < -10) { d.y = H + 10; d.x = Math.random() * W; }
        if (d.x < -10) d.x = W + 10;
        if (d.x > W + 10) d.x = -10;
      }
      const tw = 0.7 + 0.3 * Math.sin(now / 900 + d.ph);
      ctx.globalAlpha = d.a * tw;
      const s = 2.4 * d.s;
      ctx.drawImage(dustSprite, d.x, d.y, s, s);
    }
    ctx.restore();
  }

  /* ---------- 地形 ---------- */
  const buckets = Array.from({ length: SHADE_STEPS * FOG_STEPS }, () => []);
  let PROJ = null;
  function drawTerrain(reveal) {
    updateCam();
    PROJ = new Float32Array((N + 1) * (N + 1) * 3);
    for (let iz = 0; iz <= N; iz++) {
      for (let ix = 0; ix <= N; ix++) {
        const i = (iz * (N + 1) + ix) * 3;
        const p = project(-1 + ix * STEP, HGT[iz * (N + 1) + ix], -1 + iz * STEP);
        PROJ[i] = p.x; PROJ[i + 1] = p.y; PROJ[i + 2] = p.depth;
      }
    }
    for (const b of buckets) b.length = 0;

    const table = night() ? LUT_NIGHT : LUT;
    const cellList = [];
    for (const c of cells) {
      if (reveal < 1) {
        const rr = Math.hypot((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2);
        if (rr > reveal) continue;
      }
      const i00 = (Math.round((c.z0 + 1) / STEP) * (N + 1) + Math.round((c.x0 + 1) / STEP)) * 3;
      const i10 = i00 + 3;
      const i01 = i00 + (N + 1) * 3;
      const i11 = i01 + 3;
      const depth = (PROJ[i00 + 2] + PROJ[i10 + 2] + PROJ[i01 + 2] + PROJ[i11 + 2]) / 4;
      const fog = clamp((depth - (effDist - 0.95)) / 1.85, 0, 1);
      const sIdx = Math.min(SHADE_STEPS - 1, Math.round(c.shade * (SHADE_STEPS - 1)));
      const fIdx = Math.min(FOG_STEPS - 1, Math.round(fog * (FOG_STEPS - 1)));
      const b = buckets[sIdx * FOG_STEPS + fIdx];
      b.push(i00, i10, i11, i01);
    }

    // 远 → 近：雾多的桶先画
    for (let f = FOG_STEPS - 1; f >= 0; f--) {
      for (let s = 0; s < SHADE_STEPS; s++) {
        const arr = buckets[s * FOG_STEPS + f];
        if (!arr.length) continue;
        ctx.beginPath();
        for (let k = 0; k < arr.length; k += 4) {
          const a = arr[k], b = arr[k + 1], c2 = arr[k + 2], d = arr[k + 3];
          ctx.moveTo(PROJ[a], PROJ[a + 1]);
          ctx.lineTo(PROJ[b], PROJ[b + 1]);
          ctx.lineTo(PROJ[c2], PROJ[c2 + 1]);
          ctx.lineTo(PROJ[d], PROJ[d + 1]);
          ctx.closePath();
        }
        const col = table[s][f];
        ctx.fillStyle = col;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;         // 共享边描一遍，消除抗锯齿缝隙
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  function drawContours(reveal) {
    if (reveal < 1) return;
    ctx.strokeStyle = night() ? 'rgba(228,220,202,.16)' : 'rgba(66,52,38,.17)';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    for (const segs of contours) {
      for (const seg of segs) {
        const p0 = project(seg[0].x, heightAt(seg[0].x, seg[0].z), seg[0].z);
        const p1 = project(seg[1].x, heightAt(seg[1].x, seg[1].z), seg[1].z);
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
      }
    }
    ctx.stroke();
  }

  function drawCoast() {
    ctx.beginPath();
    coastPts.forEach((p, i) => {
      const q = project(p.x, 0, p.z);
      i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.strokeStyle = night() ? 'rgba(226,220,204,.30)' : 'rgba(70,56,40,.36)';
    ctx.lineWidth = 1.15;
    ctx.stroke();
    // 岸外平行细线
    ctx.strokeStyle = night() ? 'rgba(226,220,204,.08)' : 'rgba(70,56,40,.10)';
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  /* ---------- 地标 ---------- */
  function drawLandmarks() {
    const hi = hover;
    const near = new Set();
    if (hi) links.forEach(l => { if (l.a === hi.id) near.add(l.b); if (l.b === hi.id) near.add(l.a); });

    const items = [];
    for (const n of nodes) {
      if (filter !== 'all' && (n.region || n.type) !== filter && hover !== n) continue;
      const gy = heightAt(n.x, n.z);
      const top = project(n.x, gy + n.lift, n.z);
      const base = project(n.x, gy, n.z);
      items.push({ n, top, base, depth: top.depth });
    }

    // 山道
    for (const l of links) {
      const a = byId.get(l.a), b = byId.get(l.b);
      if (!a || !b) continue;
      if (filter !== 'all' && (a.region || a.type) !== filter && (b.region || b.type) !== filter) continue;
      const on = hi && (l.a === hi.id || l.b === hi.id);
      const ga = heightAt(a.x, a.z), gb = heightAt(b.x, b.z);
      const N2 = 12, pts = [];
      for (let i = 0; i <= N2; i++) {
        const t = i / N2;
        const x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t);
        const arc = Math.sin(Math.PI * t) * (0.03 + Math.hypot(a.x - b.x, a.z - b.z) * 0.09);
        pts.push(project(x, lerp(ga, gb, t) + 0.05 + arc, z));
      }
      const grow = reduced ? 1 : clamp((now - 900 - (a.depth || 0) * 50) / 800, 0, 1);
      if (grow <= 0) continue;
      const tier = l.score >= 50 ? 3 : l.score >= 25 ? 2 : 1;
      const alpha = (tier === 3 ? 0.30 : tier === 2 ? 0.12 : 0.05) * grow * (on ? 2.4 : 1);
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.strokeStyle = night() ? `rgba(230,222,206,${alpha})` : `rgba(52,40,28,${alpha})`;
      ctx.lineWidth = on ? 1.9 : (tier === 3 ? 1.2 : tier === 2 ? 0.85 : 0.55);
      ctx.stroke();
    }

    items.sort((a, b) => b.depth - a.depth);
    const labels = [];
    for (const it of items) {
      const { n, top, base } = it;
      const dim = hi && !near.has(n.id) && hover !== n;
      ctx.globalAlpha = dim ? 0.3 : 1;
      // 立杆
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(top.x, top.y);
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = night() ? 'rgba(226,218,202,.26)' : 'rgba(58,46,34,.24)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.setLineDash([]);
      // 落点
      ctx.beginPath();
      ctx.ellipse(base.x, base.y, 2.6, 1.15, 0, 0, Math.PI * 2);
      ctx.fillStyle = night() ? 'rgba(226,218,202,.16)' : 'rgba(58,46,34,.16)';
      ctx.fill();
      glyph(n, top, hover === n);
      ctx.globalAlpha = 1;
      if (n.labelOn || hover === n) labels.push({ n, p: top, on: hover === n });
    }
    drawLabels(labels);
  }

  function drawLabels(list) {
    list.sort((a, b) => (b.on ? 1 : 0) - (a.on ? 1 : 0));
    const placed = [];
    for (const it of list) {
      const label = it.n.name.length > 9 ? it.n.name.slice(0, 9) + '…' : it.n.name;
      const fs = it.on ? 13 : 11.5;
      ctx.font = `${it.on ? 600 : 400} ${fs}px "Songti SC","Noto Serif SC",serif`;
      const w = ctx.measureText(label).width + 6, h = fs + 4;
      const cands = [
        [it.p.x - w / 2, it.p.y + 10],
        [it.p.x - w / 2, it.p.y - h - 10],
        [it.p.x + 10, it.p.y - h / 2],
        [it.p.x - w - 10, it.p.y - h / 2]
      ];
      let pick = null;
      for (const [x, y] of cands) {
        let clash = false;
        for (const r of placed) if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) { clash = true; break; }
        if (!clash || it.on) { pick = [x, y]; break; }
      }
      if (!pick) continue;
      placed.push({ x: pick[0], y: pick[1], w, h });
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.lineWidth = 3;
      ctx.strokeStyle = night() ? 'rgba(20,20,18,.92)' : 'rgba(246,241,231,.96)';
      ctx.strokeText(label, pick[0], pick[1]);
      ctx.fillStyle = night() ? `rgba(232,224,208,${it.on ? .96 : .68})` : `rgba(30,24,18,${it.on ? .96 : .68})`;
      ctx.fillText(label, pick[0], pick[1]);
    }
  }

  function roundRect(c, x, y, w, h, r) {
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function glyph(n, p, on) {
    const s = clamp(2.9 / p.depth, 0.8, 1.45) * (on ? 1.22 : 1) * (W < 620 ? 0.92 : 1);
    const inkColor = night() ? `rgba(232,224,208,${on ? .98 : .78})` : `rgba(44,34,24,${on ? .98 : .78})`;
    const paperC = night() ? '#191816' : '#f4efe4';
    ctx.save();
    ctx.translate(p.x, p.y);
    if (n.type === 'company') {
      const img = logoImgs.get(n.id);
      const ready = img && img.complete && img.naturalWidth;
      const wide = !!n.wide;
      const w = (wide ? 26 : 18) * s, h = (wide ? 13 : 18) * s;
      const r = Math.min(3.2 * s, h / 3);
      ctx.shadowColor = night() ? 'rgba(0,0,0,.65)' : 'rgba(70,50,30,.30)';
      ctx.shadowBlur = on ? 10 : 5;
      ctx.shadowOffsetY = on ? 4 : 2;
      ctx.beginPath();
      roundRect(ctx, -w / 2, -h / 2, w, h, r);
      ctx.fillStyle = ready ? (night() ? 'rgba(244,239,228,.94)' : 'rgba(255,253,247,.96)') : SEAL;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = on ? SEAL : (night() ? 'rgba(226,218,202,.35)' : 'rgba(163,63,44,.45)');
      ctx.lineWidth = on ? 1.4 : 0.9;
      ctx.stroke();
      if (ready) {
        ctx.save();
        ctx.beginPath();
        roundRect(ctx, -w / 2, -h / 2, w, h, r);
        ctx.clip();
        const pad = 3 * s;
        const iw = img.naturalWidth, ih = img.naturalHeight;
        const k = Math.min((w - pad * 2) / iw, (h - pad * 2) / ih);
        ctx.drawImage(img, -iw * k / 2, -ih * k / 2, iw * k, ih * k);
        ctx.restore();
      } else {
        ctx.fillStyle = '#f7efe2';
        ctx.font = `600 ${8 * s}px "KaiTi","STKaiti",serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText((n.name || '·').slice(0, 1), 0, 0.5);
      }
    } else if (n.type === 'lab') {
      ctx.fillStyle = inkColor;
      [[0, 6], [-3.2, 3.6], [-6.2, 2]].forEach(([dy, half]) => {
        ctx.beginPath();
        ctx.moveTo(-half * s, dy * s + 4 * s);
        ctx.lineTo(0, dy * s - 2.4 * s);
        ctx.lineTo(half * s, dy * s + 4 * s);
        ctx.closePath();
        ctx.fill();
      });
    } else if (n.type === 'model') {
      ctx.fillStyle = inkColor;
      ctx.beginPath(); ctx.arc(0, 0, 4.1 * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = night() ? 'rgba(232,224,208,.42)' : 'rgba(44,34,24,.42)';
      ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.arc(0, 0, 7.2 * s, 0, Math.PI * 2); ctx.stroke();
    } else if (n.type === 'benchmark') {
      ctx.fillStyle = inkColor;
      ctx.fillRect(-4.2 * s, -7 * s, 8.4 * s, 13.2 * s);
      ctx.fillStyle = paperC;
      ctx.fillRect(-2.3 * s, -4.3 * s, 4.6 * s, 1.2);
      ctx.fillRect(-2.3 * s, -1.1 * s, 4.6 * s, 1.2);
      ctx.fillRect(-2.3 * s, 2.1 * s, 4.6 * s, 1.2);
    } else if (n.type === 'job') {
      ctx.strokeStyle = inkColor; ctx.fillStyle = inkColor; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -7.4 * s); ctx.lineTo(0, 4.4 * s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -7.4 * s); ctx.lineTo(6.8 * s, -4.9 * s); ctx.lineTo(0, -2.5 * s); ctx.closePath(); ctx.fill();
    } else if (n.type === 'resource') {
      ctx.fillStyle = inkColor;
      ctx.fillRect(-4.1 * s, -4.1 * s, 8.2 * s, 8.2 * s);
      ctx.strokeStyle = paperC; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(-1.6 * s, -4.1 * s); ctx.lineTo(-1.6 * s, 4.1 * s); ctx.stroke();
    } else {
      ctx.fillStyle = night() ? 'rgba(232,224,208,.55)' : 'rgba(44,34,24,.55)';
      ctx.beginPath(); ctx.arc(0, 0, 2.05 * s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawRegions() {
    for (const g of BASE) {
      const gy = heightAt(g.cx, g.cz);
      const p = project(g.cx, gy + 0.008, g.cz);
      const dim = filter !== 'all' && filter !== g.key;
      ctx.save();
      ctx.globalAlpha = dim ? 0.26 : 1;
      ctx.font = '600 12px "KaiTi","STKaiti",serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = night() ? 'rgba(20,20,18,.86)' : 'rgba(246,241,231,.92)';
      ctx.strokeText(g.label, p.x, p.y);
      ctx.fillStyle = night() ? `rgba(232,224,208,${filter === g.key ? .88 : .46})` : `rgba(52,40,28,${filter === g.key ? .88 : .46})`;
      ctx.fillText(g.label, p.x, p.y);
      ctx.restore();
    }
  }

  /* ---------- 装饰：罗盘、比例尺、卷轴边 ---------- */
  function drawChrome() {
    ctx.strokeStyle = night() ? 'rgba(226,218,202,.14)' : 'rgba(70,56,40,.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(10.5, 10.5, W - 21, H - 21);
    ctx.strokeStyle = night() ? 'rgba(226,218,202,.06)' : 'rgba(70,56,40,.07)';
    ctx.strokeRect(16.5, 16.5, W - 33, H - 33);

    // 罗盘
    const cx = W - 44, cy0 = 48, r = 15;
    ctx.save();
    ctx.translate(cx, cy0);
    ctx.strokeStyle = night() ? 'rgba(226,218,202,.34)' : 'rgba(70,56,40,.34)';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(4, 0); ctx.lineTo(0, r); ctx.lineTo(-4, 0); ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = 'rgba(163,63,44,.75)';
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(4, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    ctx.font = '9px "KaiTi",serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = night() ? 'rgba(226,218,202,.5)' : 'rgba(70,56,40,.5)';
    ctx.fillText('北', 0, -r - 9);
    ctx.restore();

    // 比例尺
    const sx = 30, sy0 = H - 26, seg = 22;
    ctx.strokeStyle = night() ? 'rgba(226,218,202,.34)' : 'rgba(70,56,40,.34)';
    ctx.lineWidth = 0.9;
    for (let i = 0; i < 4; i++) {
      if (i % 2 === 0) {
        ctx.fillStyle = night() ? 'rgba(226,218,202,.28)' : 'rgba(70,56,40,.28)';
        ctx.fillRect(sx + i * seg, sy0, seg, 3);
      }
      ctx.strokeRect(sx + i * seg, sy0, seg, 3);
    }
    ctx.font = '9px "KaiTi",serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = night() ? 'rgba(226,218,202,.45)' : 'rgba(70,56,40,.45)';
    ctx.fillText('百里', sx, sy0 - 3);

    // 朱印
    ctx.save();
    ctx.globalAlpha = 0.93;
    ctx.fillStyle = SEAL;
    const bw = W < 620 ? 30 : 34;
    ctx.fillRect(22, H - 64, bw, bw);
    ctx.fillStyle = '#f7efe2';
    ctx.font = `600 ${W < 620 ? 10 : 11.5}px "KaiTi","STKaiti",serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('山海', 22 + bw / 2, H - 64 + bw * 0.32);
    ctx.fillText('图志', 22 + bw / 2, H - 64 + bw * 0.70);
    ctx.restore();
  }

  /* ---------- 主绘制 ---------- */
  function draw(ts) {
    if (!ctx) return;
    now = ts - t0;
    F = Math.min(W, H) * (W < 620 ? 2.0 : 2.42);

    let reveal = 1;
    if (intro) {
      const t = clamp(now / intro.dur, 0, 1);
      reveal = 0.72 + easeInOut(t) * 0.28;
      cam.pitch = lerp(intro.fromPitch, intro.toPitch, easeInOut(t));
      cam.dist = lerp(intro.fromDist, intro.toDist, easeInOut(t));
      if (t >= 1) { intro = null; }
    }

    ctx.clearRect(0, 0, W, H);
    updateCam();
    drawSky();
    drawSun();
    drawDistantLayers();
    drawLightShafts();
    drawSea();

    // 纸纹
    if (paperPat) {
      ctx.save();
      ctx.globalAlpha = night() ? 0.05 : 0.10;
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = ctx.createPattern(paperPat, 'repeat');
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    drawTerrain(reveal);
    drawCloudShadows();
    drawContours(reveal);
    drawCoast();
    drawRegions();
    if (reveal > 0.995) drawLandmarks();
    drawDust();
    drawChrome();

    // 暗角与暖调
    const vg = ctx.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.34, W / 2, H * 0.5, Math.max(W, H) * 0.76);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, night() ? 'rgba(0,0,0,.36)' : 'rgba(90,66,40,.09)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------- 交互 ---------- */
  function pos(ev) { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
  function hit(mx, my) {
    let best = null, bd = 18 * 18;
    for (const n of nodes) {
      if (filter !== 'all' && (n.region || n.type) !== filter) continue;
      const gy = heightAt(n.x, n.z);
      const p = project(n.x, gy + n.lift, n.z);
      const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  canvas.addEventListener('pointerdown', ev => {
    const [mx, my] = pos(ev);
    downAt = [mx, my];
    const n = hit(mx, my);
    if (n) hover = n;
    drag = { x: mx, y: my };
    canvas.setPointerCapture(ev.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', ev => {
    const [mx, my] = pos(ev);
    if (drag) {
      cam.yaw += (mx - drag.x) * 0.0052;
      cam.pitch = clamp(cam.pitch - (my - drag.y) * 0.0032, 0.14, 1.30);
      cam.spin = false;
      drag.x = mx; drag.y = my;
      return;
    }
    const n = hit(mx, my);
    if (n !== hover) {
      hover = n;
      canvas.style.cursor = n ? 'pointer' : 'grab';
      if (n && tip) {
        tip.hidden = false;
        tip.textContent = `${TYPE_CN[n.type] || ''} · ${n.name}${n.one ? ' — ' + n.one : ''}`;
        const tw = Math.min(270, W - 24);
        tip.style.maxWidth = tw + 'px';
        tip.style.left = Math.min(Math.max(10, mx + 14), W - tw - 10) + 'px';
        tip.style.top = Math.max(8, my - 46) + 'px';
      } else if (tip) tip.hidden = true;
    }
  });
  canvas.addEventListener('pointerup', ev => {
    const [mx, my] = pos(ev);
    const moved = downAt ? Math.hypot(mx - downAt[0], my - downAt[1]) : 99;
    const n = hit(mx, my);
    drag = null; canvas.style.cursor = 'grab';
    if (moved < 6 && n && n.file) location.href = n.file;
  });
  canvas.addEventListener('pointerleave', () => { hover = null; if (tip) tip.hidden = true; });
  canvas.addEventListener('wheel', ev => {
    if (!document.body.classList.contains('is-atlas') && !(ev.ctrlKey || ev.metaKey)) return; // 普通页面里放行滚动
    ev.preventDefault();
    cam.tdist = clamp(cam.tdist * (ev.deltaY < 0 ? 0.92 : 1.08), 1.9, 5.2);
  }, { passive: false });

  let pinch = null;
  canvas.addEventListener('touchstart', ev => {
    if (ev.touches.length === 2) {
      const [a, b] = ev.touches;
      pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: cam.tdist };
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', ev => {
    if (ev.touches.length === 2 && pinch) {
      ev.preventDefault();
      const [a, b] = ev.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      cam.tdist = clamp(pinch.z * pinch.d / Math.max(1, d), 1.9, 5.2);
    }
  }, { passive: false });

  if (pauseBtn) pauseBtn.addEventListener('click', () => {
    running = !running;
    pauseBtn.textContent = running ? '暂停' : '继续';
  });
  if (resetBtn) resetBtn.addEventListener('click', () => {
    cam.yaw = -0.55; cam.spin = !narrow0;
    restartIntro();
  });
  chips.forEach(c => c.addEventListener('click', () => {
    filter = c.dataset.atlasRegion;
    chips.forEach(x => x.classList.toggle('active', x === c));
  }));
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      const r = canvas.parentElement.getBoundingClientRect();
      if (Math.abs(r.width - W) > 2) resize();
    }).observe(canvas.parentElement);
  }

  function restartIntro() {
    const baseDist = narrow0 ? 3.5 : 3.1;
    if (reduced) { intro = null; cam.pitch = 0.78; cam.dist = cam.tdist = baseDist; return; }
    intro = { dur: 1700, fromPitch: 1.18, toPitch: 0.78, fromDist: baseDist + 0.9, toDist: baseDist };
    cam.tdist = baseDist;
    t0 = performance.now();
    now = 0;
  }

  /* ---------- 主循环 ---------- */
  function frame(ts) {
    if (!t0) t0 = ts;
    const dt = Math.min(64, ts - (lastTs || ts));
    lastTs = ts;
    if (running && !reduced && cam.spin && !drag && !intro) cam.yaw += dt * 0.000030;
    cam.dist += (cam.tdist - cam.dist) * (reduced ? 1 : 0.10);
    draw(ts);
    requestAnimationFrame(frame);
  }

  /* ---------- 布局：黄金角螺旋铺开 ---------- */
  function layout() {
    const r = mulberry32(4242);
    const per = {};
    for (const n of nodes) per[n.region || n.type] = (per[n.region || n.type] || 0) + 1;
    const seen = {};
    for (const n of nodes) {
      const g = REG[n.region || n.type] || REG.company;
      const rk = n.region || n.type;
      const idx = (seen[rk] = (seen[rk] || 0) + 1);
      const k = idx / Math.max(1, per[rk]);
      const a = idx * 2.39996 + (n.type === 'company' ? 0 : 0.8);
      const rad = g.r * Math.sqrt(Math.min(0.98, k * 0.95 + 0.05));
      n.x = clamp(g.cx + Math.cos(a) * rad, -0.93, 0.93);
      n.z = clamp(g.cz + Math.sin(a) * rad, -0.93, 0.93);
      n.lift = 0.085 + Math.min(0.085, (n.d || 1) * 0.005) + r() * 0.018;
    }
    const ranked = nodes.slice().sort((a, b) => b.d - a.d);
    const cap = W < 620 ? 9 : 17;
    ranked.forEach((n, i) => { n.labelOn = i < cap || n.type === 'benchmark'; });
  }

  buildLUT();

  fetch('atlas.json', { cache: 'no-cache' })
    .then(r => r.json())
    .then(data => {
      nodes = data.nodes.map(n => Object.assign({}, n));
      byId = new Map(nodes.map(n => [n.id, n]));
      for (const n of nodes) {
        if (n.logo) {
          const img = new Image();
          img.decoding = 'async';
          img.src = n.logo;
          logoImgs.set(n.id, img);
        }
      }
      const maxScore = Math.max.apply(null, data.links.map(l => l[3])) || 1;
      links = data.links.filter(l => byId.has(l[0]) && byId.has(l[1]))
        .map(l => ({ a: l[0], b: l[1], type: l[2], score: l[3], w: l[3] / maxScore }));
      resize(); layout();
      restartIntro();
      requestAnimationFrame(frame);
      if (stat) stat.textContent = `${nodes.length} 个地标 · ${links.length} 条山道 · 拖动旋转`;
    })
    .catch(() => { if (stat) stat.textContent = '图谱数据加载失败'; });

  new MutationObserver(() => { if (ctx) draw(performance.now()); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
