/* 首页《千里江山图》上的季候粒子：春落花、夏流萤、秋落叶、冬飞雪。
   与山海图同一套季候值（<html data-season>），不另设开关；reduced-motion 停笔。 */
(function () {
  const host = document.querySelector('.mast-scene');
  const c = host && host.querySelector('.mast-weather');
  if (!host || !c) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const g = c.getContext('2d');
  const root = document.documentElement;
  let W = 0, H = 0, DPR = 1, t = 0, raf = 0, parts = [];

  const SEASON = () => root.dataset.season || 'autumn';
  const COLORS = {
    spring: ['rgba(246,206,214,.85)', 'rgba(252,226,232,.7)', 'rgba(236,186,198,.8)'],
    summer: ['rgba(255,240,170,.85)', 'rgba(255,226,120,.7)'],
    autumn: ['rgba(196,110,40,.85)', 'rgba(160,84,30,.8)', 'rgba(214,150,70,.75)', 'rgba(120,88,40,.7)'],
    winter: ['rgba(255,255,255,.92)', 'rgba(238,246,255,.85)', 'rgba(220,232,246,.8)']
  };
  const COUNT = { spring: 46, summer: 26, autumn: 40, winter: 90 };

  const rnd = (a, b) => a + Math.random() * (b - a);
  function spawn(init) {
    const s = SEASON();
    const col = COLORS[s][Math.floor(Math.random() * COLORS[s].length)];
    const size = s === 'winter' ? rnd(1.2, 3.2) : s === 'summer' ? rnd(1.4, 2.6) : rnd(3, 6.5);
    return {
      x: rnd(0, W), y: init ? rnd(0, H) : rnd(-40, -6),
      vx: s === 'winter' ? rnd(-.25, .25) : rnd(-.55, -.1),
      vy: s === 'summer' ? rnd(-.06, .06) : s === 'winter' ? rnd(.35, 1.1) : rnd(.35, .95),
      r: size, a: rnd(.55, 1), col,
      ph: rnd(0, 6.28), spin: rnd(-.02, .02),
      kind: s
    };
  }
  function resize() {
    const r = host.getBoundingClientRect();
    DPR = Math.min(devicePixelRatio || 1, 1.5);
    W = Math.max(320, Math.round(r.width)); H = Math.max(320, Math.round(r.height));
    c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
    c.style.width = W + 'px'; c.style.height = H + 'px';
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    parts = Array.from({ length: COUNT[SEASON()] || 40 }, () => spawn(true));
  }
  function draw() {
    g.clearRect(0, 0, W, H);
    t += 0.016;
    const s = SEASON();
    const want = COUNT[s] || 40;
    while (parts.length < want) parts.push(spawn(false));
    if (parts.length > want) parts.length = want;
    for (const p of parts) {
      p.x += p.vx + Math.sin(t * 1.3 + p.ph) * .35;
      p.y += p.vy + (s === 'summer' ? Math.sin(t * .9 + p.ph) * .18 : 0);
      p.ph += p.spin;
      if (p.y > H + 10 || p.x < -20) { Object.assign(p, spawn(false)); if (s === 'summer') p.y = rnd(0, H); }
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.ph);
      g.globalAlpha = p.a;
      g.fillStyle = p.col;
      if (p.kind === 'winter') {
        g.beginPath(); g.arc(0, 0, p.r, 0, 6.283); g.fill();
      } else if (p.kind === 'autumn') {
        g.beginPath(); g.ellipse(0, 0, p.r, p.r * .42, 0, 0, 6.283); g.fill();
      } else if (p.kind === 'spring') {
        g.beginPath(); g.ellipse(0, 0, p.r, p.r * .68, 0, 0, 6.283); g.fill();
      } else {
        // 夏日：低空浮光
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, p.r * 4);
        grad.addColorStop(0, p.col); grad.addColorStop(1, 'rgba(255,240,180,0)');
        g.fillStyle = grad; g.beginPath(); g.arc(0, 0, p.r * 4, 0, 6.283); g.fill();
      }
      g.restore();
    }
    raf = requestAnimationFrame(draw);
  }
  const start = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };
  resize();
  new ResizeObserver(resize).observe(host);
  new IntersectionObserver(es => { es[0].isIntersecting ? start() : stop(); }, { threshold: 0 }).observe(host);
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
  window.addEventListener('worldclock', () => { parts = Array.from({ length: COUNT[SEASON()] || 40 }, () => spawn(true)); });
  start();
})();
