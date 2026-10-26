/* ============================================================
   NEON RUSH — a neon cyberpunk hover-racer / shooter.
   One self-contained WebGL game (Three.js r128, vendored) that
   runs identically in a browser and inside the Luncher APK's
   WebView. Everything is procedural: the city, the cars, the
   particles, and even the synthwave soundtrack (WebAudio).
   No network, no assets to download — 100% offline.
   ============================================================ */
(function () {
'use strict';

/* --------------------------------------------------------- utils */
function $(id) { return document.getElementById(id); }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function fmt(n) { return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function storeGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
function storeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

var LANES = [-6.5, -2.2, 2.2, 6.5];
var ROAD_HALF = 8.2;

/* --------------------------------------------------------- audio */
var SFX = {
  ctx: null, master: null, musicGain: null, noiseBuf: null,
  engine: null, muted: storeGet('neonrush_mute', '0') === '1',
  step: 0, nextTime: 0,
  init: function () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.4;
    this.musicGain.connect(this.master);
    // shared white-noise buffer for explosions / hats / whooshes
    var len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = this.noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startEngine();
    this.nextTime = ctx.currentTime + 0.1;
    var self = this;
    setInterval(function () { self.scheduleMusic(); }, 90);
  },
  setMuted: function (m) {
    this.muted = m; storeSet('neonrush_mute', m ? '1' : '0');
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.03);
  },
  /* --- tiny synth helpers --- */
  tone: function (o) {
    if (!this.ctx) return;
    var ctx = this.ctx, t = o.t || ctx.currentTime;
    var osc = ctx.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t + o.dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.vol, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0008, t + o.dur);
    var out = g;
    if (o.filter) {
      var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.filter;
      osc.connect(f); f.connect(g);
    } else osc.connect(g);
    g.connect(o.music ? this.musicGain : this.master);
    osc.start(t); osc.stop(t + o.dur + 0.05);
  },
  noise: function (o) {
    if (!this.ctx) return;
    var ctx = this.ctx, t = o.t || ctx.currentTime;
    var src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    src.playbackRate.value = o.rate || 1;
    var f = ctx.createBiquadFilter(); f.type = o.ft || 'lowpass'; f.Q.value = o.q || 0.8;
    f.frequency.setValueAtTime(o.freq || 1000, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t + o.dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(o.vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + o.dur);
    src.connect(f); f.connect(g); g.connect(o.music ? this.musicGain : this.master);
    src.start(t, Math.random()); src.stop(t + o.dur + 0.05);
  },
  /* --- engine: two detuned oscillators through a lowpass --- */
  startEngine: function () {
    var ctx = this.ctx;
    var o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
    var o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 28;
    var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320; f.Q.value = 2;
    var g = ctx.createGain(); g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
    o1.start(); o2.start();
    this.engine = { o1: o1, o2: o2, f: f, g: g };
  },
  updateEngine: function (ratio, nitro, level) {
    if (!this.engine) return;
    var base = 48 + ratio * 165 + (nitro ? 45 : 0);
    this.engine.o1.frequency.value = base;
    this.engine.o2.frequency.value = base * 0.5 + 2;
    this.engine.f.frequency.value = 260 + ratio * 1500 + (nitro ? 700 : 0);
    this.engine.g.gain.setTargetAtTime(level, this.ctx.currentTime, 0.09);
  },
  /* --- synthwave loop: Am – F – C – G, 112 BPM, 16th notes --- */
  scheduleMusic: function () {
    if (!this.ctx) return;
    var SP16 = 60 / 112 / 4;
    var roots = [45, 41, 48, 43];                    // A2 F2 C3 G2 (midi)
    var tones = [[57, 60, 64, 69], [53, 57, 60, 65], [60, 64, 67, 72], [55, 59, 62, 67]];
    function f(m) { return 440 * Math.pow(2, (m - 69) / 12); }
    while (this.nextTime < this.ctx.currentTime + 0.22) {
      var s = this.step, bar = Math.floor(s / 16) % 4, st = s % 16, t = this.nextTime;
      if (st % 4 === 0) this.tone({ t: t, freq: 150, freqEnd: 42, dur: 0.16, type: 'sine', vol: 0.85, music: true }); // kick
      if (st % 4 === 2) this.noise({ t: t, dur: 0.05, vol: 0.16, ft: 'highpass', freq: 6500, music: true });          // hat
      if (st % 8 === 4) this.noise({ t: t, dur: 0.12, vol: 0.22, ft: 'bandpass', freq: 1800, q: 1.2, music: true });  // snare-ish
      if (st % 2 === 0) this.tone({ t: t, freq: f(roots[bar] + (st === 14 ? 12 : 0)), dur: 0.13, type: 'sawtooth', vol: 0.20, filter: 700, music: true }); // bass
      var arp = tones[bar][[0, 2, 1, 3][st % 4]] + (st >= 8 ? 0 : 0);
      this.tone({ t: t, freq: f(arp + 12), dur: 0.11, type: 'triangle', vol: 0.075, music: true });                 // arp
      if (st === 0) {                                                                                                  // pad
        this.tone({ t: t, freq: f(tones[bar][0]), dur: SP16 * 15, type: 'triangle', vol: 0.045, attack: 0.4, music: true });
        this.tone({ t: t, freq: f(tones[bar][2]), dur: SP16 * 15, type: 'sine', vol: 0.04, attack: 0.4, music: true });
      }
      this.nextTime += SP16; this.step++;
    }
  },
  /* --- one-shot effects --- */
  laser: function () { this.tone({ freq: rand(880, 980), freqEnd: 160, dur: 0.13, type: 'square', vol: 0.10 }); },
  explosion: function (big) {
    this.noise({ dur: big ? 0.9 : 0.45, vol: big ? 0.85 : 0.5, freq: 2400, freqEnd: 70 });
    this.tone({ freq: 110, freqEnd: 30, dur: big ? 0.8 : 0.4, type: 'sine', vol: 0.7 });
  },
  crash: function () {
    this.noise({ dur: 0.35, vol: 0.65, freq: 3200, freqEnd: 200 });
    this.tone({ freq: 190, freqEnd: 45, dur: 0.35, type: 'sawtooth', vol: 0.4, filter: 900 });
  },
  pickup: function (base) {
    if (!this.ctx) return; var t = this.ctx.currentTime;
    this.tone({ t: t, freq: base, dur: 0.09, type: 'sine', vol: 0.22 });
    this.tone({ t: t + 0.07, freq: base * 1.5, dur: 0.14, type: 'sine', vol: 0.22 });
  },
  whoosh: function () { this.noise({ dur: 0.28, vol: 0.3, ft: 'bandpass', freq: 500, freqEnd: 2600, q: 2 }); },
  beep: function (hi) { this.tone({ freq: hi ? 880 : 440, dur: hi ? 0.35 : 0.16, type: 'square', vol: 0.18 }); },
  riser: function () { this.tone({ freq: 200, freqEnd: 1200, dur: 0.7, type: 'sawtooth', vol: 0.12, filter: 2400 }); },
  click: function () { this.tone({ freq: 700, dur: 0.05, type: 'triangle', vol: 0.15 }); }
};

/* --------------------------------------------------------- state */
var state = {
  mode: 'menu',            // menu | countdown | playing | paused | dying | gameover
  quality: storeGet('neonrush_quality', 'high'),
  best: parseInt(storeGet('neonrush_best', '0'), 10) || 0,
  score: 0, distance: 0, worldDist: 0, elapsed: 0, kills: 0,
  health: 100, nitro: 55, usingNitro: false,
  combo: 0, mult: 1, comboTimer: 0,
  speed: 0, crashSlow: 1, invuln: 0, shake: 0,
  sector: 1, spawnIn: 30, fireTimer: 0, gunSide: 1,
  count: 3, countTimer: 0, dieTimer: 0, timeScale: 1,
  autoDropped: false, newRecord: false
};
var input = { left: false, right: false, nitro: false, fire: false };
var player = { x: 0, vx: 0 };

/* --------------------------------------------------------- three setup */
var renderer, scene, camera, dirLight, hemi, clock;
var MATS = {};             // themed shared materials
var TEX = {};
var playerGroup, carBody, flames = [], underglow, trailMat;
var dashes = [], buildings = [], gates = [];
var obstacles = [], pickups = [], lasers = [], bursts = [];
var streaks, streakPos, thruster, thrusterData, moonSprite;
var roadTex, gridTexInst;
var THEMES = [
  { name: 'NEON TOKYO',  fog: 0x070312, prim: 0x00f0ff, sec: 0xff2d78, grid: 0x0066ff, hemiSky: 0x8a7bff, hemiGnd: 0x12041f },
  { name: 'SOLAR FLARE', fog: 0x170601, prim: 0xff9a3d, sec: 0xff2d55, grid: 0xff5500, hemiSky: 0xffb37d, hemiGnd: 0x1f0700 },
  { name: 'TOXIC GRID',  fog: 0x021208, prim: 0x3dff8f, sec: 0xccff00, grid: 0x00cc66, hemiSky: 0x7dffb0, hemiGnd: 0x021a08 },
  { name: 'ARCTIC PULSE',fog: 0x020a18, prim: 0x6fd8ff, sec: 0xdff6ff, grid: 0x2299ff, hemiSky: 0xa8d8ff, hemiGnd: 0x04101f },
  { name: 'ROYAL VIOLET',fog: 0x12021f, prim: 0xb44dff, sec: 0xff4dd8, grid: 0x7722ff, hemiSky: 0xc99aff, hemiGnd: 0x160330 }
];

/* --- procedural canvas textures --- */
function canvasTex(w, h, draw) {
  var c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  var t = new THREE.CanvasTexture(c);
  return t;
}
function makeTextures() {
  TEX.glow = canvasTex(128, 128, function (g) {
    var r = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.5)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  });
  roadTex = canvasTex(256, 256, function (g, w, h) {
    g.fillStyle = '#0b0b14'; g.fillRect(0, 0, w, h);
    for (var i = 0; i < 2600; i++) {
      g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.05) + ')';
      g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
    }
    g.fillStyle = 'rgba(120,140,255,0.05)';
    for (var j = 0; j < 7; j++) g.fillRect(0, Math.random() * h, w, 2);
  });
  roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping; roadTex.repeat.set(1, 40);
  gridTexInst = canvasTex(128, 128, function (g, w, h) {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 3;
    g.strokeRect(0, 0, w, h);
  });
  gridTexInst.wrapS = gridTexInst.wrapT = THREE.RepeatWrapping; gridTexInst.repeat.set(26, 32);
  TEX.hazard = canvasTex(128, 64, function (g, w, h) {
    g.fillStyle = '#151515'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff9a1f';
    for (var x = -h; x < w + h; x += 28) {
      g.beginPath(); g.moveTo(x, h); g.lineTo(x + 14, h); g.lineTo(x + 14 + h, 0); g.lineTo(x + h, 0); g.fill();
    }
  });
  var windowCols = ['#7df9ff', '#ffd93d', '#ff7ad9', '#9dff8f', '#c9b8ff', '#ffffff'];
  TEX.buildings = [];
  for (var b = 0; b < 4; b++) {
    TEX.buildings.push(canvasTex(128, 256, function (g, w, h) {
      g.fillStyle = '#07050f'; g.fillRect(0, 0, w, h);
      for (var y = 8; y < h - 10; y += 13) for (var x = 7; x < w - 8; x += 12) {
        if (Math.random() < 0.42) {
          g.fillStyle = choice(windowCols);
          g.globalAlpha = rand(0.35, 1); g.fillRect(x, y, 6, 8); g.globalAlpha = 1;
        } else { g.fillStyle = 'rgba(90,100,150,0.12)'; g.fillRect(x, y, 6, 8); }
      }
      // neon sign strip
      var sx = choice([8, w - 26]), col = choice(windowCols);
      g.fillStyle = col; g.globalAlpha = 0.9; g.fillRect(sx, 14, 15, randInt(70, 150));
      g.globalAlpha = 1; g.fillStyle = '#0a0a18';
      for (var sy = 22; sy < 150; sy += 14) g.fillRect(sx + 3, sy, 9, 6);
    }));
  }
}
function glowSprite(color, scale, opacity) {
  var m = new THREE.SpriteMaterial({ map: TEX.glow, color: color, transparent: true, opacity: opacity == null ? 0.85 : opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  var s = new THREE.Sprite(m); s.scale.set(scale, scale, 1); return s;
}

/* --------------------------------------------------------- world building */
function buildEnvironment() {
  // ground base
  var ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 420), new THREE.MeshBasicMaterial({ color: 0x04020c }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.06, -140); scene.add(ground);

  // synthwave grid plains on both sides
  MATS.grid = new THREE.MeshBasicMaterial({ map: gridTexInst, color: 0x0066ff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
  [-1, 1].forEach(function (s) {
    var p = new THREE.Mesh(new THREE.PlaneGeometry(260, 320), MATS.grid);
    p.rotation.x = -Math.PI / 2; p.position.set(s * (10 + 130), -0.02, -130); scene.add(p);
  });

  // road
  var road = new THREE.Mesh(new THREE.PlaneGeometry(19.4, 300),
    new THREE.MeshStandardMaterial({ map: roadTex, color: 0xbfc4d8, roughness: 0.85, metalness: 0.25 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0, -130); road.receiveShadow = true; scene.add(road);

  // neon edge strips + guard rails
  MATS.edge = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
  var railMat = new THREE.MeshStandardMaterial({ color: 0x1a1e30, roughness: 0.5, metalness: 0.7 });
  [-1, 1].forEach(function (s) {
    var strip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.09, 300), MATS.edge);
    strip.position.set(s * 9.35, 0.05, -130); scene.add(strip);
    var rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.75, 300), railMat);
    rail.position.set(s * 9.9, 0.55, -130); scene.add(rail);
    var railGlow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 300), MATS.edge);
    railGlow.position.set(s * 9.9, 0.95, -130); scene.add(railGlow);
  });

  // lane dashes (recycled boxes — real motion, not texture trickery)
  MATS.dash = new THREE.MeshBasicMaterial({ color: 0xff2d78 });
  var dashGeo = new THREE.BoxGeometry(0.22, 0.05, 3.4);
  [-4.4, 0, 4.4].forEach(function (x) {
    for (var i = 0; i < 25; i++) {
      var d = new THREE.Mesh(dashGeo, MATS.dash);
      d.position.set(x, 0.03, 12 - i * 12); scene.add(d); dashes.push(d);
    }
  });

  // neon gates you blast through
  MATS.gate = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
  MATS.gate2 = new THREE.MeshBasicMaterial({ color: 0xff2d78 });
  MATS.gateGlow = new THREE.SpriteMaterial({ map: TEX.glow, color: 0x00f0ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  var pillarGeo = new THREE.BoxGeometry(0.55, 7.4, 0.55);
  var pillarMat = new THREE.MeshStandardMaterial({ color: 0x141828, roughness: 0.4, metalness: 0.8 });
  for (var gi = 0; gi < 7; gi++) {
    var gate = new THREE.Group();
    [-1, 1].forEach(function (s) {
      var p = new THREE.Mesh(pillarGeo, pillarMat); p.position.set(s * 10.4, 3.7, 0); gate.add(p);
      var tip = new THREE.Sprite(MATS.gateGlow); tip.scale.set(3.4, 3.4, 1); tip.position.set(s * 10.4, 7.2, 0); gate.add(tip);
    });
    var beam = new THREE.Mesh(new THREE.BoxGeometry(21.4, 0.5, 0.5), MATS.gate); beam.position.y = 7.3; gate.add(beam);
    var beam2 = new THREE.Mesh(new THREE.BoxGeometry(21.4, 0.16, 0.16), MATS.gate2); beam2.position.y = 6.7; gate.add(beam2);
    gate.position.z = 10 - gi * 48; scene.add(gate); gates.push(gate);
  }

  // buildings (unit box scaled, texture swaps on recycle)
  var boxGeo = new THREE.BoxGeometry(1, 1, 1);
  var bMats = TEX.buildings.map(function (t) {
    return new THREE.MeshStandardMaterial({ map: t, emissive: 0xbbbbbb, emissiveMap: t, emissiveIntensity: 0.55, roughness: 0.9, metalness: 0.1 });
  });
  for (var bi = 0; bi < 54; bi++) {
    var side = bi % 2 === 0 ? -1 : 1;
    var bmesh = new THREE.Mesh(boxGeo, choice(bMats));
    bmesh.userData.side = side; bmesh.userData.mats = bMats;
    placeBuilding(bmesh, rand(-290, 25));
    scene.add(bmesh); buildings.push(bmesh);
  }
  // distant skyline silhouettes
  var skyMat = new THREE.MeshBasicMaterial({ color: 0x0a0618 });
  for (var si = 0; si < 22; si++) {
    var sm = new THREE.Mesh(boxGeo, skyMat);
    var sh = rand(25, 85);
    sm.scale.set(rand(10, 22), sh, 10);
    sm.position.set(rand(-160, 160), sh / 2, rand(-320, -280));
    scene.add(sm);
  }

  // stars + moon
  var starGeo = new THREE.BufferGeometry();
  var sp = new Float32Array(1100 * 3);
  for (var sti = 0; sti < 1100; sti++) {
    var th = rand(0, Math.PI * 2), ph = rand(0.05, 1.25), r = 380;
    sp[sti * 3] = r * Math.sin(ph) * Math.cos(th);
    sp[sti * 3 + 1] = r * Math.cos(ph) * 0.6 + 12;
    sp[sti * 3 + 2] = r * Math.sin(ph) * Math.sin(th) - 60;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  var stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
  scene.add(stars);
  moonSprite = glowSprite(0xdfe8ff, 70, 0.95); moonSprite.position.set(85, 62, -300); scene.add(moonSprite);
  var planet = glowSprite(0xff2d78, 26, 0.7); planet.position.set(-120, 44, -290); scene.add(planet);

  // speed streaks
  var n = 260; streakPos = new Float32Array(n * 3);
  for (var k = 0; k < n; k++) {
    streakPos[k * 3] = rand(-15, 15); streakPos[k * 3 + 1] = rand(0.3, 9); streakPos[k * 3 + 2] = rand(-170, 12);
  }
  var sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
  streaks = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x9fd8ff, size: 0.16, map: TEX.glow, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  scene.add(streaks);
}
function placeBuilding(m, z) {
  var side = m.userData.side;
  var w = rand(6, 13), h = rand(9, 42), dep = rand(6, 13);
  m.scale.set(w, h, dep);
  m.position.set(side * rand(17, 46), h / 2 - 0.2, z);
  m.material = choice(m.userData.mats);
}

/* --------------------------------------------------------- vehicles & entities */
var glassMat, darkMetal, tailMat, headMat, wheelGeo;
function buildPlayer() {
  glassMat = new THREE.MeshStandardMaterial({ color: 0x0e1a2e, metalness: 0.9, roughness: 0.12, emissive: 0x0a2a44, emissiveIntensity: 0.7 });
  darkMetal = new THREE.MeshStandardMaterial({ color: 0x151824, metalness: 0.8, roughness: 0.35 });
  tailMat = new THREE.MeshBasicMaterial({ color: 0xff2233 });
  headMat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff });
  wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 14); wheelGeo.rotateZ(Math.PI / 2);

  playerGroup = new THREE.Group(); carBody = new THREE.Group();
  playerGroup.add(carBody); playerGroup.position.set(0, 0, 0); scene.add(playerGroup);

  var paint = new THREE.MeshStandardMaterial({ color: 0xff2d78, metalness: 0.55, roughness: 0.32, emissive: 0x30040f });
  var paint2 = new THREE.MeshStandardMaterial({ color: 0xff8a3d, metalness: 0.5, roughness: 0.35, emissive: 0x2a1000 });
  var neon = new THREE.MeshBasicMaterial({ color: 0x00f0ff });

  var body = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.5, 4.3), paint);
  body.position.y = 0.55; body.castShadow = true; carBody.add(body);
  var nose = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.3, 1.0), paint2);
  nose.position.set(0, 0.42, -2.35); nose.castShadow = true; carBody.add(nose);
  var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.48, 1.9), glassMat);
  cabin.position.set(0, 0.98, 0.25); cabin.castShadow = true; carBody.add(cabin);
  // neon side blades + top fin
  [-1, 1].forEach(function (s) {
    var blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 3.6), neon);
    blade.position.set(s * 1.1, 0.62, 0); carBody.add(blade);
    var gun = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.9), darkMetal);
    gun.position.set(s * 0.85, 0.95, -1.6); carBody.add(gun);
  });
  var fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 1.1), paint2);
  fin.position.set(0, 1.05, 1.55); carBody.add(fin);
  // spoiler
  var wing = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.09, 0.55), darkMetal);
  wing.position.set(0, 1.15, 2.1); carBody.add(wing);
  [-0.8, 0.8].forEach(function (x) {
    var strut = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.42, 0.09), darkMetal);
    strut.position.set(x, 0.92, 2.1); carBody.add(strut);
  });
  // tail light bar + headlights
  var tail = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.13, 0.06), tailMat);
  tail.position.set(0, 0.66, 2.17); carBody.add(tail);
  [-0.65, 0.65].forEach(function (x) {
    var hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.06), headMat);
    hl.position.set(x, 0.52, -2.86); carBody.add(hl);
    var gs = glowSprite(0xbfe8ff, 1.1, 0.8); gs.position.set(x, 0.52, -3.0); carBody.add(gs);
  });
  // hover pods with neon rings
  var ringGeo = new THREE.TorusGeometry(0.4, 0.07, 8, 20); ringGeo.rotateY(Math.PI / 2);
  [[-0.95, -1.45], [0.95, -1.45], [-0.95, 1.45], [0.95, 1.45]].forEach(function (p) {
    var pod = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), darkMetal);
    pod.position.set(p[0], 0.3, p[1]); carBody.add(pod);
    var ring = new THREE.Mesh(ringGeo, neon); ring.position.copy(pod.position); carBody.add(ring);
  });
  // thruster flames
  var flameGeo = new THREE.ConeGeometry(0.24, 1.7, 10); flameGeo.rotateX(Math.PI / 2);
  var flameMat = new THREE.MeshBasicMaterial({ color: 0x00d8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  var flameMat2 = new THREE.MeshBasicMaterial({ color: 0xff9a3d, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  [-0.55, 0.55].forEach(function (x) {
    var fl = new THREE.Mesh(flameGeo, flameMat); fl.position.set(x, 0.5, 3.0); carBody.add(fl); flames.push(fl);
    var fl2 = new THREE.Mesh(flameGeo, flameMat2); fl2.scale.set(0.55, 0.55, 0.55); fl2.position.set(x, 0.5, 2.9); carBody.add(fl2); flames.push(fl2);
  });
  // light trails on the asphalt
  trailMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  var trailGeo = new THREE.PlaneGeometry(0.3, 8); trailGeo.rotateX(-Math.PI / 2);
  [-0.85, 0.85].forEach(function (x) {
    var tr = new THREE.Mesh(trailGeo, trailMat); tr.position.set(x, 0.05, 6.2); playerGroup.add(tr);
  });
  // underglow: a camera-facing bloom plus a flat light pool on the asphalt
  var ug = glowSprite(0xff2d78, 6.5, 0.5); ug.position.set(0, 0.3, 0); playerGroup.add(ug);
  var poolGeo = new THREE.PlaneGeometry(6.4, 7.6); poolGeo.rotateX(-Math.PI / 2);
  var pool = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({ map: TEX.glow, color: 0xff2d78, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  pool.position.set(0, 0.04, 0); playerGroup.add(pool);
  underglow = new THREE.PointLight(0x00f0ff, 1.3, 11, 2); underglow.position.set(0, 0.4, 0); playerGroup.add(underglow);
  // headlight beam
  var spot = new THREE.SpotLight(0xbfe8ff, 1.7, 95, 0.52, 0.65, 1);
  spot.position.set(0, 1.1, -1.6); playerGroup.add(spot);
  var tgt = new THREE.Object3D(); tgt.position.set(0, 0.2, -34); playerGroup.add(tgt); spot.target = tgt;

  // thruster particle stream
  var TN = 200;
  var tPos = new Float32Array(TN * 3), tCol = new Float32Array(TN * 3);
  thrusterData = [];
  for (var i = 0; i < TN; i++) { tPos[i * 3 + 1] = -999; thrusterData.push({ life: 0, vx: 0, vy: 0, vz: 0 }); }
  var tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
  tg.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  thruster = new THREE.Points(tg, new THREE.PointsMaterial({ size: 0.5, map: TEX.glow, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  thruster.frustumCulled = false; scene.add(thruster);
}
var thrusterCursor = 0, thrusterAcc = 0;
function emitThruster(dt, intensity) {
  thrusterAcc += dt * 130 * intensity;
  var pos = thruster.geometry.attributes.position.array;
  while (thrusterAcc >= 1) {
    thrusterAcc -= 1;
    var i = thrusterCursor; thrusterCursor = (thrusterCursor + 1) % thrusterData.length;
    var d = thrusterData[i]; d.life = rand(0.25, 0.5); d.max = d.life;
    d.vx = rand(-1.2, 1.2); d.vy = rand(-0.6, 1.4); d.vz = rand(10, 20);
    pos[i * 3] = player.x + choice([-0.55, 0.55]) + rand(-0.08, 0.08);
    pos[i * 3 + 1] = 0.55; pos[i * 3 + 2] = 2.3;
  }
}
function updateThruster(dt) {
  var pos = thruster.geometry.attributes.position.array, col = thruster.geometry.attributes.color.array;
  for (var i = 0; i < thrusterData.length; i++) {
    var d = thrusterData[i];
    if (d.life <= 0) continue;
    d.life -= dt;
    if (d.life <= 0) { pos[i * 3 + 1] = -999; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0; continue; }
    pos[i * 3] += d.vx * dt; pos[i * 3 + 1] += d.vy * dt; pos[i * 3 + 2] += (d.vz + state.speed * 0.85) * dt;
    var r = d.life / d.max; // cyan-white core fading to orange
    col[i * 3] = r * 0.3 + (1 - r) * 1.0; col[i * 3 + 1] = r * 0.85; col[i * 3 + 2] = r * 1.0;
  }
  thruster.geometry.attributes.position.needsUpdate = true;
  thruster.geometry.attributes.color.needsUpdate = true;
}

/* --- entity factories (pooled) --- */
var TRAFFIC_COLORS = [0x3d7bff, 0xffd93d, 0x8a5cff, 0x2dffc4, 0xff5d3d, 0xe8eaf2, 0xff4dd8];
function makeTraffic() {
  var g = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: 0x3d7bff, metalness: 0.5, roughness: 0.4 });
  var body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 4.0), mat);
  body.position.y = 0.55; body.castShadow = true; g.add(body);
  var cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 1.9), glassMat);
  cab.position.set(0, 1.05, 0.15); cab.castShadow = true; g.add(cab);
  [[-0.95, -1.35], [0.95, -1.35], [-0.95, 1.35], [0.95, 1.35]].forEach(function (p) {
    var w = new THREE.Mesh(wheelGeo, darkMetal); w.position.set(p[0], 0.36, p[1]); g.add(w);
  });
  [-0.6, 0.6].forEach(function (x) {
    var t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.06), tailMat); t.position.set(x, 0.68, 2.02); g.add(t);
    var tg2 = glowSprite(0xff2233, 0.9, 0.7); tg2.position.set(x, 0.68, 2.15); g.add(tg2);
    var hd = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.06), headMat); hd.position.set(x, 0.6, -2.02); g.add(hd);
  });
  g.visible = false; scene.add(g);
  return { type: 'traffic', mesh: g, active: false, hp: 3, ownSpeed: 22, passed: false, bodyMat: mat, halfW: 1.25 };
}
function makeDrone() {
  var g = new THREE.Group();
  var core = new THREE.Mesh(new THREE.OctahedronGeometry(0.58),
    new THREE.MeshStandardMaterial({ color: 0x2a0505, emissive: 0xff2222, emissiveIntensity: 1.1, metalness: 0.6, roughness: 0.3 }));
  core.castShadow = true; g.add(core);
  var ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.09, 8, 26),
    new THREE.MeshStandardMaterial({ color: 0x1a1a24, emissive: 0xff6a00, emissiveIntensity: 0.8, metalness: 0.7, roughness: 0.3 }));
  ring.rotation.x = Math.PI / 2; g.add(ring);
  var rotors = [];
  [[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]].forEach(function (p) {
    var r = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.04, 0.15), darkMetal);
    r.position.set(p[0], 0.28, p[1]); g.add(r); rotors.push(r);
  });
  var gs = glowSprite(0xff3333, 2.8, 0.65); g.add(gs);
  g.visible = false; scene.add(g);
  return { type: 'drone', mesh: g, active: false, hp: 2, ownSpeed: 6, passed: false, rotors: rotors, core: core, ring: ring, seed: rand(0, 9), baseX: 0, halfW: 1.15 };
}
function makeBarrier() {
  var g = new THREE.Group();
  var box = new THREE.Mesh(new THREE.BoxGeometry(3.9, 1.0, 0.6),
    new THREE.MeshStandardMaterial({ map: TEX.hazard, emissive: 0xffffff, emissiveMap: TEX.hazard, emissiveIntensity: 0.35, roughness: 0.7 }));
  box.position.y = 0.5; box.castShadow = true; g.add(box);
  [-1.5, 1.5].forEach(function (x) {
    var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffaa00 }));
    lamp.position.set(x, 1.12, 0); g.add(lamp);
    var gs = glowSprite(0xffaa00, 1.3, 0.8); gs.position.set(x, 1.12, 0); g.add(gs);
  });
  g.visible = false; scene.add(g);
  return { type: 'barrier', mesh: g, active: false, hp: 999, ownSpeed: 0, passed: false, halfW: 2.15 };
}
function makePickup(kind) {
  var g = new THREE.Group(); var spin = [];
  if (kind === 'core') {
    var oct = new THREE.Mesh(new THREE.OctahedronGeometry(0.44),
      new THREE.MeshStandardMaterial({ color: 0x003344, emissive: 0x00e5ff, emissiveIntensity: 1.8, metalness: 0.4, roughness: 0.2 }));
    g.add(oct); spin.push(oct);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.05, 8, 24), new THREE.MeshBasicMaterial({ color: 0x00f0ff }));
    g.add(ring); spin.push(ring);
    g.add(glowSprite(0x00e5ff, 2.6, 0.75));
  } else if (kind === 'nitro') {
    var can = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.9, 14),
      new THREE.MeshStandardMaterial({ color: 0xff7a1f, emissive: 0xff5500, emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.3 }));
    g.add(can); spin.push(can);
    var band = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.18, 14), new THREE.MeshBasicMaterial({ color: 0xffd93d }));
    g.add(band);
    g.add(glowSprite(0xff9a3d, 2.6, 0.75));
  } else { // repair
    var bx = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x0d5c2e, emissive: 0x2dff8f, emissiveIntensity: 0.8, metalness: 0.4, roughness: 0.4 }));
    g.add(bx); spin.push(bx);
    var c1 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.17, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    c1.position.z = 0.42; g.add(c1);
    var c2 = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.55, 0.05), c1.material);
    c2.position.z = 0.42; g.add(c2);
    g.add(glowSprite(0x3dff8f, 2.6, 0.75));
  }
  g.visible = false; scene.add(g);
  return { kind: kind, mesh: g, active: false, spin: spin, seed: rand(0, 9) };
}
function makePools() {
  var i;
  for (i = 0; i < 13; i++) obstacles.push(makeTraffic());
  for (i = 0; i < 10; i++) obstacles.push(makeDrone());
  for (i = 0; i < 8; i++) obstacles.push(makeBarrier());
  for (i = 0; i < 16; i++) pickups.push(makePickup('core'));
  for (i = 0; i < 5; i++) pickups.push(makePickup('nitro'));
  for (i = 0; i < 5; i++) pickups.push(makePickup('repair'));
  // lasers
  var laserGeo = new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6); laserGeo.rotateX(Math.PI / 2);
  var laserCoreGeo = new THREE.CylinderGeometry(0.03, 0.03, 3.4, 6); laserCoreGeo.rotateX(Math.PI / 2);
  var lm = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  var lc = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  for (i = 0; i < 26; i++) {
    var lg = new THREE.Group();
    lg.add(new THREE.Mesh(laserGeo, lm)); lg.add(new THREE.Mesh(laserCoreGeo, lc));
    var lgs = glowSprite(0x00f0ff, 1.0, 0.8); lg.add(lgs);
    lg.visible = false; scene.add(lg);
    lasers.push({ mesh: lg, active: false });
  }
  // explosion bursts
  for (i = 0; i < 12; i++) {
    var BN = 90;
    var bp = new Float32Array(BN * 3);
    var bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    var bm = new THREE.PointsMaterial({ size: 0.55, map: TEX.glow, color: 0xffaa33, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    var pts = new THREE.Points(bg, bm);
    pts.visible = false; pts.frustumCulled = false; scene.add(pts);
    bursts.push({ pts: pts, active: false, life: 0, max: 1, vel: new Float32Array(BN * 3), n: BN });
  }
}
function spawnExplosion(pos, color, count, power, size, life) {
  for (var i = 0; i < bursts.length; i++) {
    var b = bursts[i];
    if (b.active) continue;
    b.active = true; b.life = b.max = life;
    b.pts.visible = true;
    b.pts.material.color.setHex(color);
    b.pts.material.size = size;
    b.pts.material.opacity = 1;
    b.pts.geometry.setDrawRange(0, count);
    var arr = b.pts.geometry.attributes.position.array;
    for (var j = 0; j < count; j++) {
      arr[j * 3] = pos.x; arr[j * 3 + 1] = pos.y; arr[j * 3 + 2] = pos.z;
      var a = rand(0, Math.PI * 2), e = rand(-0.4, 1.1), sp = rand(power * 0.3, power);
      b.vel[j * 3] = Math.cos(a) * Math.cos(e) * sp;
      b.vel[j * 3 + 1] = Math.sin(e) * sp + power * 0.25;
      b.vel[j * 3 + 2] = Math.sin(a) * Math.cos(e) * sp;
    }
    b.pts.geometry.attributes.position.needsUpdate = true;
    return;
  }
}
function updateBursts(dt) {
  bursts.forEach(function (b) {
    if (!b.active) return;
    b.life -= dt;
    if (b.life <= 0) { b.active = false; b.pts.visible = false; return; }
    var arr = b.pts.geometry.attributes.position.array;
    var cnt = b.pts.geometry.drawRange.count;
    for (var j = 0; j < cnt; j++) {
      b.vel[j * 3 + 1] -= 7 * dt;
      arr[j * 3] += b.vel[j * 3] * dt;
      arr[j * 3 + 1] = Math.max(0.1, arr[j * 3 + 1] + b.vel[j * 3 + 1] * dt);
      arr[j * 3 + 2] += (b.vel[j * 3 + 2] + state.speed * 0.55) * dt;
    }
    b.pts.material.opacity = clamp(b.life / b.max, 0, 1);
    b.pts.geometry.attributes.position.needsUpdate = true;
  });
}

/* --------------------------------------------------------- spawning */
function getFree(list, pred) {
  for (var i = 0; i < list.length; i++) if (!list[i].active && (!pred || pred(list[i]))) return list[i];
  return null;
}
function laneFree(x, z) {
  for (var i = 0; i < obstacles.length; i++) {
    var o = obstacles[i];
    if (o.active && Math.abs(o.mesh.position.z - z) < 9 && Math.abs(o.mesh.position.x - x) < 2.6) return false;
  }
  return true;
}
function spawnObstacle(type, x, z) {
  if (!laneFree(x, z)) return null;
  var o = getFree(obstacles, function (e) { return e.type === type; });
  if (!o) return null;
  o.active = true; o.passed = false;
  o.mesh.visible = true;
  o.mesh.position.set(x, type === 'drone' ? 1.9 : 0, z);
  if (type === 'traffic') { o.hp = 3; o.ownSpeed = rand(17, 30); o.bodyMat.color.setHex(choice(TRAFFIC_COLORS)); }
  if (type === 'drone') { o.hp = 2; o.baseX = x; }
  if (type === 'barrier') o.hp = 999;
  return o;
}
function spawnPickup(kind, x, z) {
  var p = getFree(pickups, function (e) { return e.kind === kind; });
  if (!p) return null;
  p.active = true; p.mesh.visible = true; p.mesh.position.set(x, 1.15, z);
  return p;
}
function spawnPattern() {
  var z = -252, roll = Math.random() * 100, lane = choice(LANES);
  if (roll < 28) {
    spawnObstacle('traffic', lane, z);
  } else if (roll < 44) {
    var l2 = choice(LANES.filter(function (l) { return l !== lane; }));
    spawnObstacle('traffic', lane, z); spawnObstacle('traffic', l2, z + rand(-4, 4));
  } else if (roll < 58) {
    spawnObstacle('barrier', lane, z);
    if (Math.random() < 0.6) spawnObstacle('traffic', choice(LANES.filter(function (l) { return Math.abs(l - lane) > 3; })), z - rand(8, 20));
  } else if (roll < 72) {
    spawnObstacle('drone', lane, z);
    if (Math.random() < 0.55) { spawnObstacle('drone', lane - 2.2 > -8 ? lane - 2.2 : lane + 2.2, z - 13); spawnObstacle('drone', lane + 2.2 < 8 ? lane + 2.2 : lane - 2.2, z - 13); }
  } else if (roll < 86) {
    for (var i = 0; i < 5; i++) spawnPickup('core', lane, z - i * 7);
  } else {
    spawnPickup(Math.random() < 0.5 ? 'nitro' : 'repair', lane, z);
    spawnObstacle('traffic', choice(LANES.filter(function (l) { return l !== lane; })), z - rand(4, 14));
  }
}

/* --------------------------------------------------------- HUD / UI */
var el = {};
['hud', 'score', 'best-hud', 'best-menu', 'combo', 'sector', 'distance', 'health-bar', 'nitro-bar', 'speed',
 'banner', 'banner-main', 'banner-sub', 'countdown', 'menu', 'pause-menu', 'gameover',
 'final-score', 'final-distance', 'final-kills', 'final-best', 'new-record', 'toast',
 'damage-flash', 'nitro-flash', 'popups', 'fps', 'btn-sound'].forEach(function (id) { el[id] = $(id); });

var bannerTimer = null, toastTimer = null;
function showBanner(main, sub) {
  el['banner-main'].textContent = main; el['banner-sub'].textContent = sub || '';
  el.banner.classList.add('hidden'); void el.banner.offsetWidth; // restart CSS animation
  el.banner.classList.remove('hidden');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(function () { el.banner.classList.add('hidden'); }, 2300);
}
function toast(msg) {
  el.toast.textContent = msg; el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.toast.classList.add('hidden'); }, 2600);
}
var _pv = null;
function popup3d(pos, text, cls) {
  if (!_pv) _pv = new THREE.Vector3();
  _pv.copy(pos).project(camera);
  if (_pv.z > 1 || _pv.z < -1) return;
  var d = document.createElement('div');
  d.className = 'popup' + (cls ? ' ' + cls : '');
  d.textContent = text;
  d.style.left = ((_pv.x * 0.5 + 0.5) * window.innerWidth) + 'px';
  d.style.top = ((-_pv.y * 0.5 + 0.5) * window.innerHeight) + 'px';
  while (el.popups.children.length >= 10) el.popups.removeChild(el.popups.firstChild);
  el.popups.appendChild(d);
  setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 1000);
}
function addScore(base, pos, label, cls) {
  state.combo += 1; state.comboTimer = 4;
  state.mult = 1 + Math.min(7, Math.floor(state.combo / 2));
  var pts = base * state.mult;
  state.score += pts;
  if (pos) popup3d(pos, (label ? label + ' ' : '') + '+' + fmt(pts), cls);
  return pts;
}
function updateHUD() {
  el.score.textContent = fmt(state.score);
  el['best-hud'].textContent = fmt(Math.max(state.best, Math.floor(state.score)));
  el.combo.textContent = '×' + state.mult;
  el.combo.classList.toggle('hot', state.mult >= 4);
  el.sector.textContent = 'SECTOR ' + (state.sector < 10 ? '0' : '') + state.sector;
  el.distance.textContent = fmt(state.distance) + ' m';
  el['health-bar'].style.transform = 'scaleX(' + clamp(state.health / 100, 0, 1) + ')';
  el['nitro-bar'].style.transform = 'scaleX(' + clamp(state.nitro / 100, 0, 1) + ')';
  el.speed.textContent = Math.round(state.speed * 2.2);
}

/* --------------------------------------------------------- theme / quality */
function applyTheme(idx) {
  var t = THEMES[idx % THEMES.length];
  scene.fog.color.setHex(t.fog);
  scene.background.setHex(t.fog);
  MATS.edge.color.setHex(t.prim);
  MATS.dash.color.setHex(t.sec);
  MATS.gate.color.setHex(t.prim);
  MATS.gate2.color.setHex(t.sec);
  MATS.gateGlow.color.setHex(t.prim);
  MATS.grid.color.setHex(t.grid);
  hemi.color.setHex(t.hemiSky); hemi.groundColor.setHex(t.hemiGnd);
  if (underglow) underglow.color.setHex(t.prim);
  if (trailMat) trailMat.color.setHex(t.prim);
  return t;
}
function setShadowSize(px) {
  dirLight.shadow.mapSize.set(px, px);
  if (dirLight.shadow.map) { dirLight.shadow.map.dispose(); dirLight.shadow.map = null; }
}
function applyQuality(q, silent) {
  state.quality = q; storeSet('neonrush_quality', q);
  var dpr = window.devicePixelRatio || 1;
  var wasShadow = renderer.shadowMap.enabled;
  if (q === 'high') { renderer.setPixelRatio(Math.min(dpr, 2)); renderer.shadowMap.enabled = true; dirLight.castShadow = true; setShadowSize(2048); streaks.visible = true; }
  else if (q === 'med') { renderer.setPixelRatio(Math.min(dpr, 1.5)); renderer.shadowMap.enabled = true; dirLight.castShadow = true; setShadowSize(1024); streaks.visible = true; }
  else { renderer.setPixelRatio(1); renderer.shadowMap.enabled = false; dirLight.castShadow = false; streaks.visible = false; }
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (wasShadow !== renderer.shadowMap.enabled) {
    scene.traverse(function (o) { if (o.material) o.material.needsUpdate = true; });
  }
  ['quality-btns', 'quality-btns-pause'].forEach(function (id) {
    var box = $(id); if (!box) return;
    Array.prototype.forEach.call(box.children, function (b) { b.classList.toggle('on', b.dataset.q === q); });
  });
  if (!silent) toast('🎨 گرافیک: ' + (q === 'high' ? 'فول 🔥' : q === 'med' ? 'متوسط' : 'کم'));
}

/* --------------------------------------------------------- game flow */
function clearEntities() {
  obstacles.forEach(function (o) { o.active = false; o.mesh.visible = false; });
  pickups.forEach(function (p) { p.active = false; p.mesh.visible = false; });
  lasers.forEach(function (l) { l.active = false; l.mesh.visible = false; });
  bursts.forEach(function (b) { b.active = false; b.pts.visible = false; });
}
function resetRun() {
  clearEntities();
  state.score = 0; state.distance = 0; state.elapsed = 0; state.kills = 0;
  state.health = 100; state.nitro = 55; state.combo = 0; state.mult = 1; state.comboTimer = 0;
  state.speed = 0; state.crashSlow = 1; state.invuln = 0; state.shake = 0;
  state.sector = 1; state.spawnIn = 45; state.timeScale = 1; state.autoDropped = false;
  state.newRecord = false;
  player.x = 0; player.vx = 0;
  carBody.visible = true;
  applyTheme(0);
  updateHUD();
}
function startGame() {
  SFX.init(); SFX.click();
  resetRun();
  el.menu.classList.add('hidden'); el.gameover.classList.add('hidden'); el['pause-menu'].classList.add('hidden');
  el.hud.classList.remove('hidden');
  state.mode = 'countdown'; state.count = 3; state.countTimer = 0;
  el.countdown.classList.remove('hidden');
  setCountdown('3'); SFX.beep(false);
}
function setCountdown(txt) {
  el.countdown.textContent = txt;
  el.countdown.classList.remove('pop'); void el.countdown.offsetWidth;
  el.countdown.classList.add('pop');
}
function toMenu() {
  SFX.click();
  var sc = Math.floor(state.score);
  if (sc > state.best) { state.best = sc; storeSet('neonrush_best', String(sc)); }
  clearEntities();
  carBody.visible = true;
  state.mode = 'menu'; state.timeScale = 1;
  el.hud.classList.add('hidden'); el.gameover.classList.add('hidden'); el['pause-menu'].classList.add('hidden');
  el.menu.classList.remove('hidden');
  el['best-menu'].textContent = fmt(state.best);
  applyTheme(0);
}
function pauseGame() {
  if (state.mode !== 'playing' && state.mode !== 'countdown') return;
  state.mode = 'paused';
  el['pause-menu'].classList.remove('hidden');
  SFX.updateEngine(0, false, 0);
}
function resumeGame() {
  if (state.mode !== 'paused') return;
  SFX.click();
  state.mode = 'playing';
  el['pause-menu'].classList.add('hidden');
}
function damage(amount, pos) {
  if (state.invuln > 0 || state.mode !== 'playing') return;
  state.health -= amount;
  state.invuln = 1.2; state.shake = 1; state.crashSlow = 0.4;
  state.combo = 0; state.mult = 1;
  el['damage-flash'].style.opacity = '1';
  SFX.crash();
  if (pos) spawnExplosion(pos, 0xffcc55, 42, 13, 0.6, 0.6);
  if (state.health <= 0) {
    state.health = 0;
    startDeath();
  }
}
function startDeath() {
  state.mode = 'dying'; state.dieTimer = 0;
  var p = new THREE.Vector3(player.x, 1, 0);
  spawnExplosion(p, 0xff7722, 90, 21, 0.95, 1.1);
  spawnExplosion(p, 0x00f0ff, 60, 15, 0.7, 0.8);
  spawnExplosion(p, 0xff2d78, 60, 17, 0.8, 0.9);
  carBody.visible = false;
  state.shake = 1.6;
  SFX.explosion(true); SFX.updateEngine(0, false, 0);
}
function finishGameOver() {
  state.mode = 'gameover'; state.timeScale = 1;
  var sc = Math.floor(state.score);
  if (sc > state.best) { state.best = sc; state.newRecord = true; storeSet('neonrush_best', String(sc)); }
  el['final-score'].textContent = fmt(sc);
  el['final-distance'].textContent = fmt(state.distance) + ' m';
  el['final-kills'].textContent = fmt(state.kills);
  el['final-best'].textContent = fmt(state.best);
  el['new-record'].classList.toggle('hidden', !state.newRecord);
  el.gameover.classList.remove('hidden');
}

/* --------------------------------------------------------- combat & collisions */
function shoot() {
  var l = getFree(lasers);
  if (!l) return;
  state.gunSide *= -1;
  l.active = true; l.mesh.visible = true;
  l.mesh.position.set(player.x + state.gunSide * 0.85, 1.0, -2.4);
  SFX.laser();
}
function killObstacle(o, byLaser) {
  var p = o.mesh.position.clone(); p.y = Math.max(0.8, p.y);
  spawnExplosion(p, o.type === 'drone' ? 0xff5522 : 0xffaa33, 65, 16, 0.8, 0.85);
  spawnExplosion(p, 0xffffff, 22, 10, 0.5, 0.4);
  o.active = false; o.mesh.visible = false;
  SFX.explosion(false);
  state.shake = Math.max(state.shake, 0.35);
  if (byLaser) {
    state.kills++;
    addScore(o.type === 'drone' ? 300 : 200, p, o.type === 'drone' ? '💥' : '🔥', 'pink');
    state.nitro = clamp(state.nitro + 8, 0, 100);
    if (o.type === 'drone' && Math.random() < 0.35 && p.z < -14) spawnPickup('core', clamp(p.x, -7.5, 7.5), p.z);
  }
}
function collectPickup(p) {
  var pos = p.mesh.position.clone();
  p.active = false; p.mesh.visible = false;
  if (p.kind === 'core') {
    state.nitro = clamp(state.nitro + 16, 0, 100);
    addScore(150, pos, '💎', ''); SFX.pickup(660);
    spawnExplosion(pos, 0x00e5ff, 16, 6, 0.45, 0.4);
  } else if (p.kind === 'nitro') {
    state.nitro = 100;
    addScore(100, pos, 'NITRO MAX ⚡', 'gold'); SFX.pickup(520);
    spawnExplosion(pos, 0xff9a3d, 20, 7, 0.5, 0.45);
  } else {
    state.health = clamp(state.health + 30, 0, 100);
    addScore(100, pos, '+30 ❤', 'green'); SFX.pickup(440);
    spawnExplosion(pos, 0x3dff8f, 18, 6, 0.5, 0.45);
  }
}

/* --------------------------------------------------------- per-frame updates */
function updatePlayer(dt, t) {
  var steer = 0;
  if (state.mode === 'menu') {
    player.x = Math.sin(t * 0.35) * 4.2;
    player.vx = Math.cos(t * 0.35) * 2;
  } else {
    if (input.left) steer -= 1;
    if (input.right) steer += 1;
    var steerSpeed = 17 + state.speed * 0.11;
    var k = 1 - Math.exp(-9 * dt);
    player.vx = lerp(player.vx, steer * steerSpeed, k);
    if (steer === 0 && Math.abs(player.vx) > steerSpeed) player.vx = lerp(player.vx, 0, 1 - Math.exp(-6 * dt));
    player.x += player.vx * dt;
    if (player.x < -ROAD_HALF) { player.x = -ROAD_HALF; player.vx = Math.max(0, player.vx); }
    if (player.x > ROAD_HALF) { player.x = ROAD_HALF; player.vx = Math.min(0, player.vx); }
  }
  playerGroup.position.x = player.x;
  carBody.position.y = 0.06 + Math.sin(t * 2.6) * 0.055;
  carBody.rotation.z = clamp(-player.vx * 0.016, -0.4, 0.4);
  carBody.rotation.y = clamp(-player.vx * 0.013, -0.35, 0.35);
  carBody.rotation.x = state.usingNitro ? 0.045 : 0;
  if (state.invuln > 0 && state.mode === 'playing') {
    carBody.visible = Math.floor(t * 14) % 2 === 0;
  } else if (state.mode !== 'dying' && state.mode !== 'gameover') carBody.visible = true;

  // thruster flames + trails
  var ratio = clamp(state.speed / 110, 0, 1.3);
  for (var i = 0; i < flames.length; i++) {
    var inner = flames[i].scale.x < 0.9;
    var base = inner ? 0.55 : 1;
    var len = base * (0.55 + ratio * 0.75 + (state.usingNitro ? 0.95 : 0) + Math.random() * 0.25);
    flames[i].scale.set(base, base, len);
    flames[i].position.z = 2.15 + 0.75 * len;
  }
  trailMat.opacity = 0.1 + ratio * 0.4 + (state.usingNitro ? 0.3 : 0);
  emitThruster(dt, 0.35 + ratio + (state.usingNitro ? 0.9 : 0));
}
function updateWorld(dt) {
  var dz = state.speed * dt;
  state.worldDist += dz;
  roadTex.offset.y = (state.worldDist / 7.5) % 1;
  gridTexInst.offset.y = (state.worldDist / 10) % 1;
  var i;
  for (i = 0; i < dashes.length; i++) { dashes[i].position.z += dz; if (dashes[i].position.z > 14) dashes[i].position.z -= 300; }
  for (i = 0; i < gates.length; i++) { gates[i].position.z += dz; if (gates[i].position.z > 18) gates[i].position.z -= 336; }
  for (i = 0; i < buildings.length; i++) {
    buildings[i].position.z += dz;
    if (buildings[i].position.z > 32) placeBuilding(buildings[i], buildings[i].position.z - 330);
  }
  if (streaks.visible) {
    var sp = (state.speed * 2.1 + 30) * dt;
    for (i = 0; i < streakPos.length / 3; i++) {
      streakPos[i * 3 + 2] += sp;
      if (streakPos[i * 3 + 2] > 14) {
        streakPos[i * 3 + 2] -= 184;
        streakPos[i * 3] = rand(-15, 15); streakPos[i * 3 + 1] = rand(0.3, 9);
      }
    }
    streaks.geometry.attributes.position.needsUpdate = true;
    streaks.material.opacity = clamp(0.1 + state.speed / 130 + (state.usingNitro ? 0.35 : 0), 0, 0.9);
  }
}
function updateObstacles(dt, t) {
  for (var i = 0; i < obstacles.length; i++) {
    var o = obstacles[i];
    if (!o.active) continue;
    var m = o.mesh;
    m.position.z += Math.max(2, state.speed - o.ownSpeed) * dt;
    if (o.type === 'drone') {
      m.position.y = 1.9 + Math.sin(t * 2.4 + o.seed) * 0.35;
      m.position.x = clamp(o.baseX + Math.sin(t * 0.9 + o.seed) * 1.6, -7.8, 7.8);
      o.core.rotation.y += dt * 3; o.ring.rotation.z += dt * 2;
      for (var r = 0; r < o.rotors.length; r++) o.rotors[r].rotation.y += dt * 28;
    }
    // passed the player?
    if (!o.passed && m.position.z > 3) {
      o.passed = true;
      if (state.mode === 'playing' && o.type !== 'barrier') {
        var lat = Math.abs(m.position.x - player.x);
        if (lat < 3.6 && state.speed > 42) {
          state.nitro = clamp(state.nitro + 10, 0, 100);
          addScore(250, m.position, 'NEAR MISS 💨', 'gold');
          SFX.whoosh();
        }
      }
    }
    if (m.position.z > 22) { o.active = false; m.visible = false; continue; }
    // collision with player
    if (state.mode === 'playing') {
      var dzp = Math.abs(m.position.z);
      var dxp = Math.abs(m.position.x - player.x);
      var hit = dzp < (o.type === 'barrier' ? 2.2 : 3.1) && dxp < o.halfW + 0.85;
      if (hit) {
        var cp = m.position.clone(); cp.y = 0.9;
        if (o.type === 'drone') { killObstacle(o, false); damage(15, cp); }
        else if (o.type === 'traffic') { killObstacle(o, false); damage(22, cp); }
        else {
          damage(26, cp);
          player.vx += (player.x < m.position.x ? -13 : 13);
          m.position.z = 5; // shove the barrier past so it cannot multi-hit
        }
      }
    }
  }
}
function updatePickups(dt, t) {
  for (var i = 0; i < pickups.length; i++) {
    var p = pickups[i];
    if (!p.active) continue;
    var m = p.mesh;
    m.position.z += state.speed * dt;
    m.position.y = 1.15 + Math.sin(t * 3 + p.seed) * 0.18;
    m.rotation.y += dt * 2.2;
    for (var s = 0; s < p.spin.length; s++) { p.spin[s].rotation.x += dt * 1.6; p.spin[s].rotation.y += dt * 2.4; }
    if (state.mode === 'playing') {
      var dz = m.position.z, dx = m.position.x - player.x;
      if (dz > -10 && dz < 4 && Math.abs(dx) < 5) { // magnet
        m.position.x -= dx * Math.min(1, 6 * dt);
        m.position.z += 12 * dt;
      }
      if (Math.abs(m.position.z) < 2.4 && Math.abs(m.position.x - player.x) < 1.9) { collectPickup(p); continue; }
    }
    if (m.position.z > 20) { p.active = false; m.visible = false; }
  }
}
function updateLasers(dt) {
  for (var i = 0; i < lasers.length; i++) {
    var l = lasers[i];
    if (!l.active) continue;
    l.mesh.position.z -= 300 * dt;
    if (l.mesh.position.z < -270) { l.active = false; l.mesh.visible = false; continue; }
    for (var j = 0; j < obstacles.length; j++) {
      var o = obstacles[j];
      if (!o.active) continue;
      var dz = Math.abs(l.mesh.position.z - o.mesh.position.z);
      var dx = Math.abs(l.mesh.position.x - o.mesh.position.x);
      if (dz < 2.6 && dx < o.halfW + 0.3) {
        l.active = false; l.mesh.visible = false;
        var hp2 = o.mesh.position.clone(); hp2.y = 1;
        if (o.type === 'barrier') {
          spawnExplosion(hp2, 0xffdd55, 10, 7, 0.4, 0.3);
        } else {
          o.hp -= 1;
          if (o.hp <= 0) killObstacle(o, true);
          else { spawnExplosion(hp2, 0xffcc55, 12, 8, 0.45, 0.35); SFX.crash(); }
        }
        break;
      }
    }
  }
}
var camPos = null;
function updateCamera(dt, t) {
  if (!camPos) camPos = new THREE.Vector3(0, 5.4, 11);
  var target;
  if (state.mode === 'menu') {
    var a = t * 0.22;
    target = new THREE.Vector3(player.x + Math.sin(a) * 8.5, 2.6 + Math.sin(t * 0.4) * 0.7, Math.cos(a) * 8.5 - 1);
    camPos.lerp(target, 1 - Math.exp(-2.2 * dt));
    camera.position.copy(camPos);
    camera.lookAt(player.x, 1.1, -1);
  } else {
    var ratio = clamp(state.speed / 120, 0, 1);
    target = new THREE.Vector3(player.x * 0.55, 5.1 + ratio * 0.7, 10.6 + ratio * 1.4);
    camPos.lerp(target, 1 - Math.exp(-5.5 * dt));
    camera.position.copy(camPos);
    if (state.shake > 0.01) {
      camera.position.x += rand(-1, 1) * 0.24 * state.shake;
      camera.position.y += rand(-1, 1) * 0.18 * state.shake;
    }
    camera.lookAt(player.x * 0.82, 1.15, -13);
  }
  var targetFov = state.usingNitro && state.mode === 'playing' ? 84 : 68;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov = lerp(camera.fov, targetFov, 1 - Math.exp(-6 * dt));
    camera.updateProjectionMatrix();
  }
}

/* --------------------------------------------------------- main loop */
var fpsEMA = 60, lowFpsTime = 0, hudTimer = 0;
function animate() {
  requestAnimationFrame(animate);
  var rawDt = Math.min(clock.getDelta(), 0.05);
  var t = clock.elapsedTime;
  if (state.mode === 'paused') { renderer.render(scene, camera); return; }

  // slow-motion while dying
  var tsTarget = state.mode === 'dying' ? 0.22 : 1;
  state.timeScale = lerp(state.timeScale, tsTarget, 1 - Math.exp(-5 * rawDt));
  var dt = rawDt * state.timeScale;

  // --- speed model ---
  var targetSpeed;
  if (state.mode === 'menu' || state.mode === 'gameover') targetSpeed = 30;
  else if (state.mode === 'countdown') targetSpeed = 26;
  else if (state.mode === 'dying') targetSpeed = 6;
  else {
    targetSpeed = (42 + Math.min(58, state.elapsed * 0.55 + (state.sector - 1) * 5)) * state.crashSlow;
    state.usingNitro = !!(input.nitro && state.nitro > 1 && state.mode === 'playing');
    if (state.usingNitro) { targetSpeed *= 1.55; state.nitro = Math.max(0, state.nitro - 32 * dt); }
  }
  if (state.mode !== 'playing') state.usingNitro = false;
  state.speed = lerp(state.speed, targetSpeed, 1 - Math.exp(-1.6 * dt));
  state.crashSlow = lerp(state.crashSlow, 1, 1 - Math.exp(-1.4 * rawDt));
  state.shake = Math.max(0, state.shake - rawDt * 2.2);
  if (el['damage-flash'].style.opacity !== '0') el['damage-flash'].style.opacity = String(Math.max(0, parseFloat(el['damage-flash'].style.opacity || 0) - rawDt * 2.4));
  el['nitro-flash'].style.opacity = state.usingNitro ? '1' : '0';

  // --- countdown ---
  if (state.mode === 'countdown') {
    state.countTimer += rawDt;
    if (state.countTimer > 0.78) {
      state.countTimer = 0; state.count--;
      if (state.count > 0) { setCountdown(String(state.count)); SFX.beep(false); }
      else if (state.count === 0) { setCountdown('GO! 🚀'); SFX.beep(true); }
      else { el.countdown.classList.add('hidden'); state.mode = 'playing'; showBanner('SECTOR 01', THEMES[0].name); }
    }
  }

  // --- playing bookkeeping ---
  if (state.mode === 'playing') {
    state.elapsed += dt;
    var dz = state.speed * dt;
    state.distance += dz;
    state.score += dz * 0.55;
    state.spawnIn -= dz;
    if (state.spawnIn <= 0) {
      spawnPattern();
      var baseGap = Math.max(26, 62 - (state.sector - 1) * 4 - state.elapsed * 0.08);
      state.spawnIn = rand(baseGap, baseGap + 24);
    }
    var newSector = Math.floor(state.distance / 650) + 1;
    if (newSector !== state.sector) {
      state.sector = newSector;
      var theme = applyTheme(newSector - 1);
      showBanner('SECTOR ' + (newSector < 10 ? '0' : '') + newSector, theme.name);
      state.score += 250 * newSector;
      SFX.riser();
    }
    if (state.comboTimer > 0) { state.comboTimer -= dt; if (state.comboTimer <= 0) { state.combo = 0; state.mult = 1; } }
    state.invuln = Math.max(0, state.invuln - dt);
    state.nitro = clamp(state.nitro + 1.4 * dt, 0, 100);
    state.fireTimer -= dt;
    if (input.fire && state.fireTimer <= 0) { shoot(); state.fireTimer = 0.13; }
  }
  if (state.mode === 'dying') {
    state.dieTimer += rawDt;
    if (state.dieTimer > 1.5) finishGameOver();
  }

  updatePlayer(dt, t);
  updateWorld(dt);
  updateObstacles(dt, t);
  updatePickups(dt, t);
  updateLasers(dt);
  updateBursts(dt);
  updateThruster(dt);
  updateCamera(rawDt, t);

  // --- audio / HUD at a gentler cadence ---
  hudTimer += rawDt;
  if (hudTimer > 0.08) {
    hudTimer = 0;
    if (state.mode === 'playing' || state.mode === 'countdown' || state.mode === 'dying') updateHUD();
    var level = state.mode === 'playing' || state.mode === 'countdown' ? 0.045 + clamp(state.speed / 130, 0, 1) * 0.05
      : state.mode === 'menu' ? 0.016 : 0;
    SFX.updateEngine(clamp(state.speed / 130, 0, 1.2), state.usingNitro, level);
    fpsEMA = lerp(fpsEMA, 1 / Math.max(rawDt, 0.001), 0.08);
    el.fps.textContent = Math.round(fpsEMA) + ' FPS';
    // adaptive quality: keep it smooth on weaker phones
    if (state.mode === 'playing' && !state.autoDropped) {
      if (fpsEMA < 34 && state.quality !== 'low') {
        lowFpsTime += 0.08;
        if (lowFpsTime > 2.5) {
          state.autoDropped = true;
          applyQuality(state.quality === 'high' ? 'med' : 'low', true);
          toast('⚙ برای روانی بیشتر، گرافیک خودکار تنظیم شد');
        }
      } else lowFpsTime = 0;
    }
  }
  renderer.render(scene, camera);
}

/* --------------------------------------------------------- input */
function bindInput() {
  var keymap = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'nitro', KeyW: 'nitro', Space: 'nitro', ShiftLeft: 'nitro', ShiftRight: 'nitro',
    KeyF: 'fire', KeyJ: 'fire', KeyX: 'fire'
  };
  window.addEventListener('keydown', function (e) {
    SFX.init();
    if (keymap[e.code]) { input[keymap[e.code]] = true; e.preventDefault(); }
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state.mode === 'paused') resumeGame(); else pauseGame();
    }
    if (e.code === 'KeyM') toggleMute();
    if ((e.code === 'Enter' || e.code === 'Space') && (state.mode === 'menu' || state.mode === 'gameover') && !e.repeat) startGame();
  });
  window.addEventListener('keyup', function (e) { if (keymap[e.code]) input[keymap[e.code]] = false; });
  window.addEventListener('blur', function () { input.left = input.right = input.nitro = input.fire = false; });

  function hold(id, prop) {
    var b = $(id);
    var on = function (e) { e.preventDefault(); SFX.init(); input[prop] = true; b.classList.add('held'); };
    var off = function (e) { if (e) e.preventDefault(); input[prop] = false; b.classList.remove('held'); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('pointerleave', off);
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
  hold('btn-left', 'left'); hold('btn-right', 'right');
  hold('btn-nitro', 'nitro'); hold('btn-fire', 'fire');

  // drag-to-steer on the canvas (great on touchscreens)
  var dragId = null, lastX = 0;
  var cv = renderer.domElement;
  cv.addEventListener('pointerdown', function (e) { SFX.init(); dragId = e.pointerId; lastX = e.clientX; });
  cv.addEventListener('pointermove', function (e) {
    if (e.pointerId !== dragId || (state.mode !== 'playing' && state.mode !== 'countdown')) return;
    var dx = e.clientX - lastX; lastX = e.clientX;
    player.vx = clamp(player.vx + dx * 0.22, -34, 34);
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) { cv.addEventListener(ev, function () { dragId = null; }); });

  // buttons
  $('btn-start').addEventListener('click', startGame);
  $('btn-again').addEventListener('click', startGame);
  $('btn-resume').addEventListener('click', resumeGame);
  $('btn-restart-pause').addEventListener('click', startGame);
  $('btn-menu-pause').addEventListener('click', toMenu);
  $('btn-menu-over').addEventListener('click', toMenu);
  $('btn-pause').addEventListener('click', function () { SFX.init(); pauseGame(); });
  $('btn-sound').addEventListener('click', function () { SFX.init(); toggleMute(); });
  $('btn-fullscreen').addEventListener('click', function () {
    SFX.click();
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
  });
  ['quality-btns', 'quality-btns-pause'].forEach(function (id) {
    var box = $(id);
    if (!box) return;
    Array.prototype.forEach.call(box.children, function (b) {
      b.addEventListener('click', function () { SFX.init(); SFX.click(); applyQuality(b.dataset.q); });
    });
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pauseGame(); });
  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}
function toggleMute() {
  SFX.setMuted(!SFX.muted);
  el['btn-sound'].textContent = SFX.muted ? '🔇' : '🔊';
  toast(SFX.muted ? '🔇 بی‌صدا' : '🔊 صدا روشن');
}

/* --------------------------------------------------------- boot */
function boot() {
  if (typeof THREE === 'undefined') { $('webgl-error').classList.remove('hidden'); return; }
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (e) { $('webgl-error').classList.remove('hidden'); return; }
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  $('app').insertBefore(renderer.domElement, $('app').firstChild);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070312);
  scene.fog = new THREE.FogExp2(0x070312, 0.0075);
  camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 700);
  camera.position.set(0, 5.4, 11);
  clock = new THREE.Clock();

  hemi = new THREE.HemisphereLight(0x8a7bff, 0x12041f, 0.75); scene.add(hemi);
  dirLight = new THREE.DirectionalLight(0xbfd4ff, 0.85);
  dirLight.position.set(18, 36, 10);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.left = -42; dirLight.shadow.camera.right = 42;
  dirLight.shadow.camera.top = 42; dirLight.shadow.camera.bottom = -42;
  dirLight.shadow.camera.near = 1; dirLight.shadow.camera.far = 130;
  dirLight.shadow.bias = -0.0006;
  scene.add(dirLight);
  dirLight.target.position.set(0, 0, -25); scene.add(dirLight.target);
  var wash1 = new THREE.PointLight(0xff2d78, 0.9, 90, 1.6); wash1.position.set(-16, 10, -35); scene.add(wash1);
  var wash2 = new THREE.PointLight(0x00aaff, 0.9, 90, 1.6); wash2.position.set(16, 10, -70); scene.add(wash2);

  makeTextures();
  buildEnvironment();
  buildPlayer();
  makePools();
  applyTheme(0);
  bindInput();
  el['btn-sound'].textContent = SFX.muted ? '🔇' : '🔊';
  el['best-menu'].textContent = fmt(state.best);
  applyQuality(state.quality === 'low' || state.quality === 'med' ? state.quality : 'high', true);
  state.speed = 30;
  animate();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
