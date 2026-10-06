(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const canvas = $('#game');
  const ctx = canvas.getContext('2d');

  const DURATION = 100;      // 1プレイの長さ（秒）
  const GRAVITY = 900;
  const SUBSTEPS = 6;
  const HAND_T = 8;          // 手の厚み（当たり判定）
  const ARC_FROM = 0.2;      // 手のひらの弧（ラジアン）
  const ARC_TO = Math.PI - 0.2;
  const ARC_POINTS = 14;

  const DEFAULT_NAMES = [
    '母', '父', '親友', '幼なじみ', '祖母', '姉', '恋人', '初恋の人', '恩師', '弟',
    '後輩', '先輩', '祖父', '妹', '同期', '猫', '部活の仲間', '兄', 'いとこ', '推し',
    '隣の席の子', 'バイト仲間', '昔の担任', '近所のおばあちゃん', '犬', '文通相手',
    'ネットの友達', '同僚', '上司', '元クラスメイト', '旅先で会った人', '常連の店主',
    '子ども', '甥', '姪', '古い友人', '遠くに住む友達', '相談に乗ってくれた人',
    '救ってくれた人', '同じ夢を見た人', 'ルームメイト', '習い事の先生', '初めての友達',
    '喧嘩した友達', 'いつも笑わせてくれる人', '待っていてくれる人', '叔母', '叔父',
    '師匠', '幼稚園の先生', 'ゼミの仲間', '同じ駅の人', '隣人', '戦友', '相棒',
    '名付け親', '支えてくれた人', 'まだ会えていない人', '昔の自分', 'いまの自分',
  ];

  const LINES = [
    [2, '大切な人が、降ってくる'],
    [20, 'ひとりも、落としたくない'],
    [40, '手のひらは、ふたつしかない'],
    [62, 'それでも、全部ほしかった'],
    [86, 'いま、手の中にいるのは誰？'],
  ];

  let W = 0, H = 0, DPR = 1;
  const hand = { x: 0, tx: 0, vx: 0, tilt: 0, cx: 0, cy: 0, R: 80, pts: [] };
  let particles = [];
  let stars = [];
  let state = 'title';       // title | play | end
  let t = 0;
  let nextSpawn = 0;
  let nameQueue = [];
  let mine = new Set();
  let lineIdx = 0;
  let attending = null;
  let pointer = null;        // { id, x, mode: 'drag' | 'attend' }
  let result = null;
  let lastTime = 0;
  const FONT = getComputedStyle(document.body).fontFamily;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;

  // ---------- レイアウト ----------
  function resize() {
    const r = canvas.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    hand.R = clamp(W * 0.2, 60, 88);
    hand.cy = H - hand.R - 70;
    if (!hand.x) hand.x = hand.tx = W / 2;
    hand.x = hand.tx = clamp(hand.x, hand.R, W - hand.R);
    stars = Array.from({ length: 70 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H * 0.85,
      r: Math.random() * 1.2 + 0.3,
      p: Math.random() * Math.PI * 2,
    }));
  }

  function buildHand(cx) {
    hand.cx = cx;
    const c = Math.cos(hand.tilt), s = Math.sin(hand.tilt);
    hand.pts.length = 0;
    for (let i = 0; i < ARC_POINTS; i++) {
      const a = lerp(ARC_FROM, ARC_TO, i / (ARC_POINTS - 1));
      const lx = Math.cos(a) * hand.R, ly = Math.sin(a) * hand.R;
      hand.pts.push(cx + lx * c - ly * s, hand.cy + lx * s + ly * c);
    }
  }

  // ---------- 粒 ----------
  function spawn() {
    const name = nameQueue.length ? nameQueue.shift() : '名前も知らない誰か';
    const r = 13 + Math.random() * 4;
    const early = particles.filter((p) => p.everHeld || p.state === 'active').length < 3;
    const x = early
      ? clamp(hand.x + (Math.random() - 0.5) * 60, r + 10, W - r - 10)
      : r + 10 + Math.random() * (W - 2 * r - 20);
    particles.push({
      name, r, x, y: -r - 10,
      vx: 0, vy: 30,
      vmax: lerp(70, 150, clamp(t / DURATION, 0, 1)) + Math.random() * 30,
      sway: Math.random() * Math.PI * 2,
      hue: 20 + Math.random() * 300,
      light: 1,
      heldT: 0,
      everHeld: false,
      state: 'active', // active | fading | gone
      alpha: 1,
      mine: mine.has(name),
    });
  }

  function spawnInterval() {
    return lerp(3.0, 1.1, clamp(t / 75, 0, 1));
  }

  // ---------- 物理 ----------
  function collideHand(p, bvx) {
    const pts = hand.pts;
    const min = p.r + HAND_T;
    let touched = false;
    for (let i = 0; i < pts.length - 2; i += 2) {
      const ax = pts[i], ay = pts[i + 1], ex = pts[i + 2] - ax, ey = pts[i + 3] - ay;
      let u = ((p.x - ax) * ex + (p.y - ay) * ey) / (ex * ex + ey * ey);
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const dx = p.x - (ax + ex * u), dy = p.y - (ay + ey * u);
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.001;
      const nx = dx / d, ny = dy / d;
      p.x += nx * (min - d);
      p.y += ny * (min - d);
      const rvx = p.vx - bvx, rvy = p.vy;
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        const tx = -ny, ty = nx;
        const vt = (rvx * tx + rvy * ty) * 0.996;
        const nvn = -vn * 0.15;
        p.vx = bvx + nx * nvn + tx * vt;
        p.vy = ny * nvn + ty * vt;
      }
      touched = true;
    }
    if (touched && Math.hypot(p.x - hand.cx, p.y - hand.cy) < hand.R) p.heldT = 0.3;
  }

  function collidePair(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const min = a.r + b.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) return;
    const d = Math.sqrt(d2) || 0.001;
    const nx = dx / d, ny = dy / d;
    const push = (min - d) / 2;
    a.x -= nx * push; a.y -= ny * push;
    b.x += nx * push; b.y += ny * push;
    const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (vn < 0) {
      const j = -vn * 0.55;
      a.vx -= nx * j; a.vy -= ny * j;
      b.vx += nx * j; b.vy += ny * j;
    }
    // 手の中の粒に触れている粒も「手の中」
    if (a.heldT > 0.05 && b.heldT < a.heldT - 0.05) b.heldT = a.heldT - 0.05;
    if (b.heldT > 0.05 && a.heldT < b.heldT - 0.05) a.heldT = b.heldT - 0.05;
  }

  function physics(dt, prevX) {
    const h = dt / SUBSTEPS;
    const bvx = (hand.x - prevX) / dt;
    const act = particles.filter((p) => p.state === 'active');
    for (let s = 1; s <= SUBSTEPS; s++) {
      buildHand(lerp(prevX, hand.x, s / SUBSTEPS));
      for (const p of act) {
        if (p.everHeld) {
          p.vy = Math.min(p.vy + GRAVITY * h, 1400);
        } else {
          // 降ってくる間はふわりと
          p.vy = Math.min(p.vy + GRAVITY * 0.3 * h, p.vmax);
          p.sway += h * 1.3;
          p.vx = lerp(p.vx, Math.sin(p.sway) * 18, h * 2);
        }
        p.x += p.vx * h;
        p.y += p.vy * h;
        p.heldT = Math.max(0, p.heldT - h);
        collideHand(p, bvx);
      }
      for (let i = 0; i < act.length; i++) {
        for (let j = i + 1; j < act.length; j++) collidePair(act[i], act[j]);
      }
      for (const p of act) {
        if (p.x < p.r) { p.x = p.r; p.vx = Math.abs(p.vx) * 0.3; }
        if (p.x > W - p.r) { p.x = W - p.r; p.vx = -Math.abs(p.vx) * 0.3; }
      }
    }
  }

  // ---------- 進行 ----------
  function heldList() {
    return particles.filter((p) => p.state === 'active' && p.heldT > 0);
  }

  function update(dt) {
    t += dt;
    if (t < DURATION && t >= nextSpawn) {
      spawn();
      nextSpawn = t + spawnInterval();
    }
    while (lineIdx < LINES.length && t >= LINES[lineIdx][0]) showLine(LINES[lineIdx++][1]);

    // 手の移動（想いを向けている間は動かない）
    const prevX = hand.x;
    if (!attending) hand.x = lerp(hand.x, hand.tx, Math.min(1, dt * 16));
    hand.x = clamp(hand.x, hand.R * 0.7, W - hand.R * 0.7);
    hand.vx = lerp(hand.vx, (hand.x - prevX) / dt, 0.25);
    hand.tilt = lerp(hand.tilt, clamp(-hand.vx * 0.0008, -0.6, 0.6), Math.min(1, dt * 10));

    physics(dt, prevX);

    const held = heldList();
    const decay = (1 / 24) * (1 + 0.09 * Math.max(0, held.length - 1));
    const outY = hand.cy + hand.R + 30;

    for (const p of particles) {
      if (p.state === 'active') {
        if (p.heldT > 0 && !p.everHeld) {
          p.everHeld = true;
          Sound.catch();
        }
        if (p.heldT > 0) {
          if (attending === p) p.light = Math.min(1, p.light + dt * 0.75);
          else p.light -= dt * decay;
          if (p.light <= 0) {
            p.light = 0;
            p.state = 'fading';
            p.fate = 'faded';
            log(`${p.name}が、静かに離れていった`);
            Sound.fade();
            if (attending === p) stopAttend();
          }
        }
        if (p.y > outY) {
          p.state = 'gone';
          p.fate = p.everHeld ? 'spilled' : 'missed';
          if (p.everHeld) {
            log(`${p.name}が零れ落ちた`);
            Sound.spill();
            if (navigator.vibrate) navigator.vibrate(40);
          }
          if (attending === p) stopAttend();
        }
      } else if (p.state === 'fading') {
        p.alpha -= dt * 0.6;
        p.y -= dt * 30;
      } else if (p.state === 'gone') {
        p.vy += GRAVITY * dt;
        p.y += p.vy * dt;
        p.x += p.vx * dt;
        p.alpha -= dt * 0.8;
      }
    }
    particles = particles.filter((p) => p.state === 'active' || p.alpha > 0);

    $('#progress-bar').style.width = `${clamp(t / DURATION, 0, 1) * 100}%`;

    const falling = particles.some((p) => p.state === 'active' && !p.everHeld);
    if ((t > DURATION && !falling) || t > DURATION + 8) finish();
  }

  // ---------- 描画 ----------
  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const s of stars) {
      const a = 0.35 + 0.35 * Math.sin(s.p + lastTime * 0.0012);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (state !== 'title') drawHand();

    for (const p of particles) drawParticle(p);
  }

  function drawHand() {
    if (state !== 'play') buildHand(hand.x);
    const pts = hand.pts;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    };
    // ぬくもりの光
    const glow = ctx.createRadialGradient(hand.cx, hand.cy + hand.R * 0.6, 4, hand.cx, hand.cy + hand.R * 0.6, hand.R * 1.6);
    glow.addColorStop(0, 'rgba(255,200,150,0.18)');
    glow.addColorStop(1, 'rgba(255,200,150,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(hand.cx - hand.R * 2, hand.cy - hand.R, hand.R * 4, hand.R * 3);

    path();
    ctx.strokeStyle = '#e9b48f';
    ctx.lineWidth = HAND_T * 2 + 4;
    ctx.stroke();
    path();
    ctx.strokeStyle = '#f7d2b4';
    ctx.lineWidth = HAND_T * 2 - 6;
    ctx.stroke();
    // 指先
    for (const i of [0, pts.length - 2]) {
      ctx.fillStyle = '#f2c4a1';
      ctx.beginPath();
      ctx.arc(pts[i], pts[i + 1], HAND_T + 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // 両手の合わせ目
    const mi = (ARC_POINTS >> 1) * 2;
    ctx.strokeStyle = 'rgba(160,100,80,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pts[mi] - 1, pts[mi + 1] - HAND_T);
    ctx.lineTo(pts[mi] - 1, pts[mi + 1] + HAND_T);
    ctx.stroke();
    ctx.restore();
  }

  function drawParticle(p) {
    const lit = p.state === 'active' ? 0.25 + 0.75 * p.light : 0.25 * p.light + 0.1;
    const a = clamp(p.alpha, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 2.4);
    g.addColorStop(0, `hsla(${p.hue},80%,82%,${0.9 * lit})`);
    g.addColorStop(0.4, `hsla(${p.hue},70%,65%,${0.45 * lit})`);
    g.addColorStop(1, `hsla(${p.hue},70%,60%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `hsla(${p.hue},60%,${55 + 35 * lit}%,${0.35 + 0.6 * lit})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();

    if (attending === p) {
      ctx.strokeStyle = 'rgba(255,230,190,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 6 + Math.sin(lastTime * 0.008) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.font = `${p.mine ? 600 : 400} 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = p.mine ? `rgba(255,217,168,${0.4 + 0.6 * lit})` : `rgba(243,236,255,${0.3 + 0.6 * lit})`;
    const tw = ctx.measureText(p.name).width / 2 + 4;
    ctx.fillText(p.name, clamp(p.x, tw, W - tw), p.y - p.r - 3);
    ctx.restore();
  }

  // ---------- 文字 ----------
  let lineTimer = 0;
  function showLine(text) {
    const el = $('#line');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(lineTimer);
    lineTimer = setTimeout(() => el.classList.remove('show'), 3800);
  }

  function log(text) {
    const box = $('#log');
    const el = document.createElement('div');
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.remove(), 3700);
  }

  // ---------- 操作 ----------
  function localPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function stopAttend() {
    attending = null;
    Sound.humStop();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'play' || pointer) return;
    const pos = localPos(e);
    let hit = null, best = Infinity;
    for (const p of heldList()) {
      const d = Math.hypot(p.x - pos.x, p.y - pos.y);
      if (d < p.r + 14 && d < best) { hit = p; best = d; }
    }
    canvas.setPointerCapture(e.pointerId);
    if (hit) {
      attending = hit;
      hand.tx = hand.x;
      Sound.humStart();
      pointer = { id: e.pointerId, x: pos.x, mode: 'attend' };
    } else {
      pointer = { id: e.pointerId, x: pos.x, mode: 'drag' };
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    const pos = localPos(e);
    if (pointer.mode === 'drag') hand.tx = clamp(hand.tx + (pos.x - pointer.x) * 1.15, 0, W);
    pointer.x = pos.x;
  });

  const release = (e) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    if (pointer.mode === 'attend') stopAttend();
    pointer = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  $('#mute').addEventListener('click', (e) => {
    const on = Sound.toggle();
    e.currentTarget.classList.toggle('off', !on);
  });

  // ---------- 画面遷移 ----------
  function loadNames() {
    try {
      const saved = JSON.parse(localStorage.getItem('koboreru-names') || '[]');
      document.querySelectorAll('#names input').forEach((el, i) => { el.value = saved[i] || ''; });
      if (saved.some(Boolean)) $('#names-box').open = true;
    } catch (_) { /* 保存できない環境でも遊べる */ }
  }

  function start() {
    Sound.init();
    const inputs = [...document.querySelectorAll('#names input')].map((el) => el.value.trim());
    try { localStorage.setItem('koboreru-names', JSON.stringify(inputs)); } catch (_) { /* noop */ }
    const custom = [...new Set(inputs.filter(Boolean))];
    mine = new Set(custom);

    const pool = DEFAULT_NAMES.filter((n) => !mine.has(n));
    for (let i = pool.length - 1; i > 6; i--) {
      const j = 6 + Math.floor(Math.random() * (i - 5));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    // 自分の大切な人は序盤に混ぜる
    const slots = [0, 2, 4, 7, 10, 13, 16, 20];
    custom.forEach((n, i) => pool.splice(slots[i] ?? pool.length, 0, n));
    nameQueue = pool;

    particles = [];
    history.length = 0;
    t = 0;
    nextSpawn = 1.2;
    lineIdx = 0;
    attending = null;
    pointer = null;
    hand.x = hand.tx = W / 2;
    hand.vx = hand.tilt = 0;
    $('#title').hidden = true;
    $('#end').hidden = true;
    $('#hud').hidden = false;
    $('#log').textContent = '';
    state = 'play';
  }

  function finish() {
    state = 'end';
    stopAttend();
    pointer = null;
    const kept = [], spilled = [], faded = [], missed = [];
    for (const p of particles) {
      if (p.state === 'active') (p.heldT > 0 || p.everHeld ? kept : missed).push(p);
    }
    for (const p of history) {
      if (p.fate === 'spilled') spilled.push(p);
      else if (p.fate === 'faded') faded.push(p);
      else if (p.fate === 'missed') missed.push(p);
    }
    result = { kept, spilled, faded, missed };
    renderEnd();
    $('#hud').hidden = true;
    $('#line').classList.remove('show');
  }

  // 去っていった粒の記録（描画用配列からは消えるため）
  const history = [];
  function recordFates() {
    for (const p of particles) {
      if (p.fate && !p.recorded) { p.recorded = true; history.push(p); }
    }
  }

  function renderEnd() {
    const { kept, spilled, faded, missed } = result;
    const lost = spilled.length + faded.length;
    let v;
    if (kept.length === 0) v = '気づいたら\n手の中には、誰もいなかった';
    else if (lost >= kept.length * 2 + 3) v = '全部、受け止めようとしたね\nでも、持てる数には限りがあった';
    else if (lost <= 2) v = '全部は追わなかった\nそのぶん、手の中はちゃんと温かい';
    else v = '零れ落ちていく人がいて\n残ってくれた人がいた';
    $('#verdict').textContent = v;

    const box = $('#results');
    box.textContent = '';
    const group = (cls, title, list) => {
      if (!list.length) return;
      const g = document.createElement('div');
      g.className = `group ${cls}`;
      const h = document.createElement('h2');
      h.textContent = `${title}（${list.length}）`;
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const p of list) {
        const c = document.createElement('span');
        c.className = p.mine ? 'chip mine' : 'chip';
        c.textContent = p.name;
        chips.appendChild(c);
      }
      g.append(h, chips);
      box.appendChild(g);
    };
    group('kept', '最後まで手の中にいた人', kept);
    group('lost', '零れ落ちた人', spilled);
    group('faded', '静かに離れていった人', faded);
    group('missed', '手が届かなかった人', missed);
    $('#end').hidden = false;
  }

  // ---------- ループ ----------
  function frame(now) {
    const dt = Math.min(0.05, (now - (lastTime || now)) / 1000) || 0.016;
    lastTime = now;
    if (state === 'play') {
      update(dt);
      recordFates();
    }
    draw();
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  $('#start').addEventListener('click', start);
  $('#again').addEventListener('click', start);
  document.addEventListener('visibilitychange', () => { lastTime = 0; });

  resize();
  loadNames();
  requestAnimationFrame(frame);
})();
