/* =========================================================================
   MAGIC MERMAID QUEST
   A gentle underwater collecting game for young children.

   How this file is organised (search for the ===== banners):
     1. CONFIG      - tuning numbers and level definitions
     2. ASSETS      - loads every sprite frame listed in assets/manifest.js
     3. AUDIO       - tiny WebAudio synth (no sound files needed)
     4. HELPERS     - sprite/word/number drawing utilities
     5. PARTICLES   - the sparkle system
     6. SAVE        - progress kept in localStorage
     7. INPUT       - keyboard + touch/mouse ("swim toward your finger")
     8. WORLD       - building a level from the asset packs
     9. ENTITIES    - mermaid, clams, pearls, sea stars, fish buddies
    10. SCENES      - loading, title screen, play, pause/complete overlays
    11. MAIN LOOP

   There is no way to lose: no enemies, no timers, no game over.
   ========================================================================= */

"use strict";

/* ===== 1. CONFIG ======================================================== */

const VIEW_W = 1280, VIEW_H = 720;      // logical screen size (scaled to fit)
const WORLD_W = 3800, WORLD_H = 1150;   // swimmable area per level

const SWIM_ACCEL = 900;                 // how quickly the mermaid speeds up
const SWIM_MAX = 330;                   // top swimming speed (px/s)
const WATER_DRAG = 2.2;                 // exponential drag -> floaty feel

const SONG_RADIUS = 380;                // Song of the Tide opens clams here
const SPIN_RADIUS = 340;                // Sparkle Tail Spin attracts goodies
const METER_STAR = 0.25;                // magic gained per sea star
const METER_REGEN = 0.025;              // magic slowly refills by itself
const METER_SONG_COST = 0.3;            // song uses magic if there is any
                                        // (it still works at zero - no
                                        //  frustration for little players)

const UNLOCK_PINK = 15;                 // total pearls to unlock each
const UNLOCK_BLONDE = 30;               // alternative mermaid

// The five levels. Each uses one scene painting, tiled with every other
// tile mirrored so the seams line up; fish lists say which buddies live there.
const LEVELS = [
  { name: "CORAL GARDENS", bg: "coral-reef-path",
    fish: ["clownfish", "fish-purple", "fish-teal-yellow"], clams: 6, stars: 9 },
  { name: "KELP FOREST", bg: "kelp-forest",
    fish: ["seahorse", "fish-pink-spotted", "fish-purple-round"], clams: 7, stars: 10 },
  { name: "BUBBLE MEADOW", bg: "bubble-open-water",
    fish: ["jellyfish", "fish-teal-yellow", "fish-purple"], clams: 7, stars: 10 },
  { name: "CRYSTAL SHALLOWS", bg: "crystal-cave",
    fish: ["fancy-blue-fish", "seahorse-teal", "fish-purple-round"], clams: 8, stars: 11 },
  { name: "STARFISH PICNIC", bg: "starfish-beach",
    fish: ["fish-pink-spotted", "pufferfish", "clownfish"], clams: 8, stars: 12 },
];

const MERMAIDS = [
  { key: "purple", swim: "mermaid-purple-swim", need: 0 },
  { key: "pink",   swim: "mermaid-pink-swim",   need: UNLOCK_PINK },
  { key: "blonde", swim: "mermaid-blonde-swim", need: UNLOCK_BLONDE },
];

/* ===== 2. ASSETS ======================================================== */

const SPRITES = {};        // key -> {kind, frames:[{img,w,h}]}
const BACKGROUNDS = {};    // name -> Image
let assetsTotal = 0, assetsDone = 0;

// Files are normally relative paths under assets/, but the standalone
// single-file build (tools/build-standalone.py) inlines them as data URIs.
const assetURL = f => f.startsWith("data:") ? f : "assets/" + f;

function loadAssets(onDone) {
  const m = window.ASSET_MANIFEST;
  const tick = () => { assetsDone++; if (assetsDone >= assetsTotal) onDone(); };
  for (const [key, spec] of Object.entries(m.sprites)) {
    SPRITES[key] = { kind: spec.kind, frames: [] };
    for (const fr of spec.frames) {
      assetsTotal++;
      const img = new Image();
      img.onload = tick; img.onerror = tick;
      img.src = assetURL(fr.file);
      SPRITES[key].frames.push({ img, w: fr.w, h: fr.h });
    }
  }
  for (const [name, file] of Object.entries(m.backgrounds)) {
    assetsTotal++;
    const img = new Image();
    img.onload = tick; img.onerror = tick;
    img.src = assetURL(file);
    BACKGROUNDS[name] = img;
  }
}

const frames = key => SPRITES[key].frames;
const frameCount = key => SPRITES[key].frames.length;

/* ===== 3. AUDIO ========================================================= */
/* Small procedural sounds so the game needs no audio files. Everything is
   soft and low-volume; audio starts on the first tap (browser rule). */

let audio = null;
function initAudio() {
  if (audio || !(window.AudioContext || window.webkitAudioContext)) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
    audio = { ctx, master };
    startAmbience();
  } catch (e) { audio = null; }
}

// One soft note. type: oscillator shape, f: frequency, t: start delay (s).
function note(f, t, dur, vol, type) {
  if (!audio) return;
  const { ctx, master } = audio;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type || "sine"; o.frequency.value = f;
  const t0 = ctx.currentTime + (t || 0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol || 0.2, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + (dur || 0.3));
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + (dur || 0.3) + 0.05);
}

const sfx = {
  pearl:  () => { note(1047, 0, .35, .25, "triangle"); note(1319, .07, .35, .2, "triangle"); note(1568, .14, .5, .18, "triangle"); },
  star:   () => { note(1568, 0, .3, .2, "sine"); note(2093, .06, .4, .14, "sine"); },
  clam:   () => { note(523, 0, .25, .18, "sine"); note(784, .1, .3, .15, "sine"); },
  buddy:  () => { note(880, 0, .18, .2, "triangle"); note(1175, .1, .25, .2, "triangle"); },
  song:   () => { [523, 659, 784, 1047, 1319].forEach((f, i) => note(f, i * .09, .5, .12, "sine")); },
  spin:   () => { [784, 988, 1175, 1568].forEach((f, i) => note(f, i * .05, .3, .15, "triangle")); },
  tap:    () => note(660, 0, .12, .15, "sine"),
  fanfare:() => { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => note(f, i * .12, .5, .16, "triangle")); },
};

// A very quiet two-tone underwater pad, plus an occasional bubble "bloop".
function startAmbience() {
  if (!audio) return;
  const { ctx, master } = audio;
  const pad = ctx.createGain(); pad.gain.value = 0.05; pad.connect(master);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 500; lp.connect(pad);
  [131, 196, 262.5].forEach(f => {
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
    o.connect(lp); o.start();
  });
  (function bloop() {
    if (audio) note(200 + Math.random() * 250, 0, .2, .05, "sine");
    setTimeout(bloop, 2500 + Math.random() * 4000);
  })();
}

/* ===== 4. HELPERS ======================================================= */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
let viewScale = 1;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const s = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  canvas.style.width = VIEW_W * s + "px";
  canvas.style.height = VIEW_H * s + "px";
  canvas.width = Math.round(VIEW_W * s * dpr);
  canvas.height = Math.round(VIEW_H * s * dpr);
  viewScale = s;
  ctx.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
  ctx.imageSmoothingQuality = "high";
}
window.addEventListener("resize", resize);
document.addEventListener("fullscreenchange", resize);
window.addEventListener("orientationchange", () => setTimeout(resize, 100));
resize();

// Go fullscreen and lock to landscape. Browsers only allow this from a
// user gesture, so it is called from the tap handler; everything is
// best-effort because support varies (iPhone Safari has neither API -
// there the CSS "turn your device" overlay does the asking instead).
function goFullscreen() {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: "hide" })
        .then(() => screen.orientation && screen.orientation.lock &&
                    screen.orientation.lock("landscape"))
        .catch(() => {});
    }
  } catch (e) { /* not supported - the game still plays in the page */ }
}

// Draw one frame of a sprite, centred at x,y, scaled so its longest side
// is `size`. flip mirrors horizontally, rot is radians.
function drawSprite(key, idx, x, y, size, flip, rot, alpha) {
  const fs = frames(key);
  const f = fs[Math.max(0, Math.min(fs.length - 1, idx | 0))];
  const k = size / Math.max(f.w, f.h);
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  if (flip) ctx.scale(-1, 1);
  if (alpha !== undefined) ctx.globalAlpha *= alpha;
  ctx.drawImage(f.img, -f.w * k / 2, -f.h * k / 2, f.w * k, f.h * k);
  ctx.restore();
}

// Words rendered from the cookie-style alphabet sprites (A-Z only).
function wordWidth(word, h) {
  let w = 0;
  for (const ch of word) {
    if (ch === " ") { w += h * 0.45; continue; }
    const i = ch.charCodeAt(0) - 65;
    if (i < 0 || i > 25) continue;
    const f = frames("alphabet-upper")[i];
    w += (f.w / f.h) * h + h * 0.08;
  }
  return w;
}
function drawWord(word, x, y, h, align) {
  const total = wordWidth(word, h);
  let cx = x - (align === "center" ? total / 2 : align === "right" ? total : 0);
  for (const ch of word) {
    if (ch === " ") { cx += h * 0.45; continue; }
    const i = ch.charCodeAt(0) - 65;
    if (i < 0 || i > 25) continue;
    const f = frames("alphabet-upper")[i];
    const w = (f.w / f.h) * h;
    ctx.drawImage(f.img, cx, y - h / 2, w, h);
    cx += w + h * 0.08;
  }
  return total;
}

// Numbers rendered from the number sprites.
function drawNumber(n, x, y, h, align) {
  const s = String(Math.max(0, n | 0));
  const widths = [...s].map(d => {
    const f = frames("numbers")[+d];
    return (f.w / f.h) * h;
  });
  const total = widths.reduce((a, b) => a + b + h * 0.06, -h * 0.06);
  let cx = x - (align === "center" ? total / 2 : align === "right" ? total : 0);
  [...s].forEach((d, i) => {
    ctx.drawImage(frames("numbers")[+d].img, cx, y - h / 2, widths[i], h);
    cx += widths[i] + h * 0.06;
  });
  return total;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const lerp = (a, b, t) => a + (b - a) * t;

// Seeded random so each level always looks the same.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ===== 5. PARTICLES ===================================================== */

const particles = [];
function sparkle(x, y, n, spread, speed) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = (speed || 90) * (0.3 + Math.random());
    particles.push({
      x: x + (Math.random() - 0.5) * (spread || 20),
      y: y + (Math.random() - 0.5) * (spread || 20),
      vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30,
      life: 0.7 + Math.random() * 0.8, age: 0,
      size: 18 + Math.random() * 26,
      frame: (Math.random() * frameCount("sparkles")) | 0,
      rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 3,
    });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.life) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.98; p.vy *= 0.98;
    p.rot += p.vr * dt;
  }
}
function drawParticles(camX, camY) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of particles) {
    const fade = 1 - p.age / p.life;
    drawSprite("sparkles", p.frame, p.x - camX, p.y - camY,
               p.size * (0.6 + fade * 0.6), false, p.rot, fade);
  }
  ctx.restore();
}

/* ===== 6. SAVE ========================================================== */

let save = { totalPearls: 0, totalStars: 0, level: 0, mermaid: 0 };
try {
  const s = JSON.parse(localStorage.getItem("mmq-save"));
  if (s && typeof s === "object") save = Object.assign(save, s);
} catch (e) { /* private mode etc. - just play without saving */ }
function persist() {
  try { localStorage.setItem("mmq-save", JSON.stringify(save)); } catch (e) {}
}

/* ===== 7. INPUT ========================================================= */

const keys = {};
window.addEventListener("keydown", e => {
  keys[e.key.toLowerCase()] = true;
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase()))
    e.preventDefault();
  handleKey(e.key.toLowerCase());
});
window.addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });

// Pointer: while held, the mermaid swims toward the finger/cursor.
const pointer = { down: false, x: 0, y: 0 };
function toLogical(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / viewScale, y: (e.clientY - r.top) / viewScale };
}
canvas.addEventListener("pointerdown", e => {
  initAudio();
  goFullscreen();
  const p = toLogical(e);
  pointer.down = true; pointer.x = p.x; pointer.y = p.y;
  handleTap(p.x, p.y);
  e.preventDefault();
});
canvas.addEventListener("pointermove", e => {
  const p = toLogical(e);
  pointer.x = p.x; pointer.y = p.y;
});
window.addEventListener("pointerup", () => { pointer.down = false; });
window.addEventListener("pointercancel", () => { pointer.down = false; });

/* ===== 8. WORLD ========================================================= */

let scene = "loading";       // loading | title | play
let overlay = null;          // null | pause | complete | end
let level = null;            // the currently built level
let introTimer = 0;          // "level name" banner countdown
let time = 0;                // global clock for gentle wobbles

function buildLevel(idx) {
  const def = LEVELS[idx];
  const rand = rng(1234 + idx * 777);
  const L = {
    idx, def,
    clams: [], pearls: [], seaStars: [], wildFish: [], props: [], treasures: [],
    ambient: [],           // decorative rising bubbles
    collected: 0,          // pearls banked this level
    done: false,
  };

  // --- scenery along the sea floor ---------------------------------------
  const propKeys = ["coral", "kelp", "rocks"];
  for (let x = 120; x < WORLD_W - 100; x += 130 + rand() * 160) {
    const key = propKeys[(rand() * propKeys.length) | 0];
    const size = 130 + rand() * 170;
    L.props.push({ key, frame: (rand() * frameCount(key)) | 0, x,
                   y: WORLD_H - 30 - size * 0.45, size, flip: rand() < 0.5,
                   sway: rand() * Math.PI * 2 });
  }
  // The shipwreck is a landmark somewhere in the middle of the level.
  L.shipwreck = { x: WORLD_W * (0.4 + rand() * 0.25), y: WORLD_H - 210, size: 520 };
  // A few treasures tucked between the plants.
  for (let i = 0; i < 4; i++) {
    L.treasures.push({ frame: (rand() * frameCount("treasure")) | 0,
                       x: 300 + rand() * (WORLD_W - 600),
                       y: WORLD_H - 60 - rand() * 40, size: 110 + rand() * 60 });
  }

  // --- things to collect --------------------------------------------------
  for (let i = 0; i < def.clams; i++) {
    L.clams.push({ x: 350 + (i + rand() * 0.6) * ((WORLD_W - 700) / def.clams),
                   y: WORLD_H - 90 - rand() * 160,
                   size: 95, anim: -1, open: false });   // anim<0 = closed
  }
  for (let i = 0; i < def.stars; i++) {
    L.seaStars.push({ x: 250 + rand() * (WORLD_W - 500),
                      y: 180 + rand() * (WORLD_H - 420),
                      size: 78, t: rand() * 10, taken: false });
  }
  // Three wild fish that become buddies when touched.
  def.fish.forEach((key, i) => {
    L.wildFish.push({ key, x: 500 + (i + 0.5) * (WORLD_W - 1000) / def.fish.length,
                      y: 250 + rand() * (WORLD_H - 600),
                      size: 105, t: rand() * 10, r: 60 + rand() * 50, joined: false });
  });

  // --- decorative bubbles -------------------------------------------------
  for (let i = 0; i < 26; i++) {
    L.ambient.push({ x: rand() * WORLD_W, y: rand() * WORLD_H,
                     size: 16 + rand() * 34, v: 14 + rand() * 24,
                     frame: (rand() * frameCount("bubbles")) | 0, ph: rand() * 9 });
  }
  return L;
}

/* ===== 9. ENTITIES ====================================================== */

const player = {
  x: 400, y: 500, vx: 0, vy: 0,
  facing: 1,                    // 1 = right, -1 = left
  state: "idle",                // idle | swim | song | spin
  animT: 0, actionT: 0,         // actionT counts down song/spin
  meter: 0.6,
  buddies: [],                  // fish following the mermaid
  trail: [],                    // recent positions, buddies follow this
};

function resetPlayer() {
  player.x = 400; player.y = 500; player.vx = player.vy = 0;
  player.state = "idle"; player.animT = 0; player.actionT = 0;
  player.buddies = []; player.trail = [];
}

// Which sprite sheet to use for the current mermaid + state. Only the
// purple mermaid has song/spin sheets, so the others borrow hers for
// those moves (she is "singing along"). Swim/idle use the chosen skin.
function playerSheet() {
  const skin = MERMAIDS[save.mermaid];
  if (player.state === "song") return "mermaid-purple-song";
  if (player.state === "spin") return "mermaid-purple-spin";
  if (player.state === "swim") return skin.swim;
  return save.mermaid === 0 ? "mermaid-purple-idle" : skin.swim;
}

function castSong() {
  if (player.actionT > 0) return;
  player.state = "song"; player.actionT = 1.1; player.animT = 0;
  player.meter = Math.max(0, player.meter - METER_SONG_COST);
  sfx.song();
  // A ring of sparkles, then open every clam within range.
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * Math.PI * 2;
    sparkle(player.x + Math.cos(a) * 120, player.y + Math.sin(a) * 120, 2, 30, 60);
  }
  for (const c of level.clams) {
    if (c.anim < 0 && dist(player.x, player.y, c.x, c.y) < SONG_RADIUS) openClam(c);
  }
}

function castSpin() {
  if (player.actionT > 0) return;
  player.state = "spin"; player.actionT = 0.9; player.animT = 0;
  sfx.spin();
  sparkle(player.x, player.y, 34, 90, 160);
  // Pull nearby pearls and sea stars toward the mermaid.
  for (const p of level.pearls) if (dist(player.x, player.y, p.x, p.y) < SPIN_RADIUS) p.pull = true;
  for (const s of level.seaStars) if (!s.taken && dist(player.x, player.y, s.x, s.y) < SPIN_RADIUS) s.pull = true;
}

function openClam(c) {
  c.anim = 0; sfx.clam();
  sparkle(c.x, c.y - 20, 10, 40, 70);
}

function updatePlayer(dt) {
  // --- input to acceleration ---
  let ax = 0, ay = 0;
  if (keys["arrowleft"] || keys["a"]) ax -= 1;
  if (keys["arrowright"] || keys["d"]) ax += 1;
  if (keys["arrowup"] || keys["w"]) ay -= 1;
  if (keys["arrowdown"] || keys["s"]) ay += 1;
  if (pointer.down && !uiTouched) {
    // Swim toward the finger (world position under the pointer).
    const tx = pointer.x + cam.x, ty = pointer.y + cam.y;
    const d = dist(player.x, player.y, tx, ty);
    if (d > 30) { ax += (tx - player.x) / d; ay += (ty - player.y) / d; }
  }
  const len = Math.hypot(ax, ay);
  if (len > 1) { ax /= len; ay /= len; }

  player.vx += ax * SWIM_ACCEL * dt;
  player.vy += ay * SWIM_ACCEL * dt;
  // Water drag gives the floaty "swimming" feel.
  const drag = Math.exp(-WATER_DRAG * dt);
  player.vx *= drag; player.vy *= drag;
  const sp = Math.hypot(player.vx, player.vy);
  if (sp > SWIM_MAX) { player.vx *= SWIM_MAX / sp; player.vy *= SWIM_MAX / sp; }

  player.x = clamp(player.x + player.vx * dt, 60, WORLD_W - 60);
  player.y = clamp(player.y + player.vy * dt + Math.sin(time * 1.4) * 8 * dt, 70, WORLD_H - 70);

  if (Math.abs(player.vx) > 25) player.facing = player.vx > 0 ? 1 : -1;

  // --- animation state ---
  if (player.actionT > 0) {
    player.actionT -= dt;
    if (player.actionT <= 0) player.state = "idle";
  } else {
    player.state = sp > 40 ? "swim" : "idle";
  }
  player.animT += dt;

  // --- trail for the buddies ---
  player.trail.unshift({ x: player.x, y: player.y });
  if (player.trail.length > 600) player.trail.length = 600;

  // --- magic meter ---
  player.meter = clamp(player.meter + METER_REGEN * dt, 0, 1);
}

function updateBuddies(dt) {
  player.buddies.forEach((b, i) => {
    // Follow a point some way back along the mermaid's trail, with a
    // little sine bobbing so the group feels alive.
    const back = Math.min(player.trail.length - 1, (i + 1) * 22);
    const t = player.trail[back] || player.trail[player.trail.length - 1];
    if (!t) return;
    const side = (i % 2 ? 1 : -1) * (28 + i * 8);
    const tx = t.x, ty = t.y + Math.sin(time * 2 + i * 1.7) * 14 + side * 0.4;
    b.x = lerp(b.x, tx, 1 - Math.exp(-3.2 * dt));
    b.y = lerp(b.y, ty, 1 - Math.exp(-3.2 * dt));
    b.flip = b.x > tx + 2 ? true : b.x < tx - 2 ? false : b.flip;
  });
}

function updateLevel(dt) {
  // Clam opening animation, then a pearl pops out.
  for (const c of level.clams) {
    if (c.anim >= 0 && !c.open) {
      c.anim += dt * 9;
      if (c.anim >= frameCount("clam") - 1) {
        c.anim = frameCount("clam") - 1; c.open = true;
        level.pearls.push({ x: c.x, y: c.y - 60, size: 56, t: 0,
                            frame: (Math.random() * frameCount("pearl")) | 0 });
        sparkle(c.x, c.y - 50, 14, 40, 90);
      }
    } else if (c.anim < 0 &&
               dist(player.x, player.y, c.x, c.y) < 120) {
      openClam(c);          // swimming into a clam opens it too
    }
  }

  // Pearls float gently; touched (or spin-pulled) pearls are banked.
  for (let i = level.pearls.length - 1; i >= 0; i--) {
    const p = level.pearls[i];
    p.t += dt;
    if (p.pull || dist(player.x, player.y, p.x, p.y) < 190) {
      p.x = lerp(p.x, player.x, 1 - Math.exp(-4 * dt));
      p.y = lerp(p.y, player.y, 1 - Math.exp(-4 * dt));
    } else {
      p.y += Math.sin(p.t * 1.6) * 12 * dt - 6 * dt;
      p.x += Math.sin(p.t * 0.9) * 10 * dt;
    }
    if (dist(player.x, player.y, p.x, p.y) < 80) {
      level.pearls.splice(i, 1);
      level.collected++; save.totalPearls++; persist();
      sfx.pearl(); sparkle(p.x, p.y, 16, 30, 110);
    }
  }

  // Sea stars twinkle in place until gathered.
  for (const s of level.seaStars) {
    if (s.taken) continue;
    s.t += dt;
    if (s.pull || dist(player.x, player.y, s.x, s.y) < 160) {
      s.x = lerp(s.x, player.x, 1 - Math.exp(-4 * dt));
      s.y = lerp(s.y, player.y, 1 - Math.exp(-4 * dt));
    }
    if (dist(player.x, player.y, s.x, s.y) < 80) {
      s.taken = true; save.totalStars++; persist();
      player.meter = clamp(player.meter + METER_STAR, 0, 1);
      sfx.star(); sparkle(s.x, s.y, 12, 30, 90);
    }
  }

  // Wild fish patrol until the mermaid touches them, then join the line.
  for (const f of level.wildFish) {
    if (f.joined) continue;
    f.t += dt;
    f.px = f.x + Math.cos(f.t * 0.8) * f.r;
    f.py = f.y + Math.sin(f.t * 1.3) * f.r * 0.5;
    if (dist(player.x, player.y, f.px, f.py) < 85) {
      f.joined = true; sfx.buddy();
      sparkle(f.px, f.py, 18, 50, 100);
      player.buddies.push({ key: f.key, x: f.px, y: f.py, flip: false,
                            size: f.size });
    }
  }

  // Decorative bubbles drift upward forever.
  for (const b of level.ambient) {
    b.y -= b.v * dt; b.x += Math.sin(time + b.ph) * 8 * dt;
    if (b.y < -50) { b.y = WORLD_H + 40; b.x = Math.random() * WORLD_W; }
  }

  // Level complete = every clam's pearl banked. Purely celebratory.
  if (!level.done && level.collected >= level.def.clams) {
    level.done = true; overlay = "complete"; sfx.fanfare();
    for (let i = 0; i < 60; i++)
      sparkle(player.x + (Math.random() - .5) * 500,
              player.y + (Math.random() - .5) * 350, 2, 40, 120);
    if (level.idx === LEVELS.length - 1) overlay = "end";
    save.level = Math.min(LEVELS.length - 1, Math.max(save.level, level.idx + 1));
    persist();
  }
}

/* ===== 10. SCENES ======================================================= */

const cam = { x: 0, y: 0 };
let uiTouched = false;   // true while a tap started on a HUD button

function updateCamera(dt) {
  const tx = clamp(player.x - VIEW_W / 2, 0, WORLD_W - VIEW_W);
  const ty = clamp(player.y - VIEW_H / 2, 0, WORLD_H - VIEW_H);
  const k = 1 - Math.exp(-4 * dt);
  cam.x = lerp(cam.x, tx, k);
  cam.y = lerp(cam.y, ty, k);
}

// --- backgrounds: two scene paintings tiled with a parallax factor ------
function drawBackground() {
  const name = level ? level.def.bg : "open-blue-bubbles";
  const bgH = 950;                              // taller than the view so
  const scale = bgH / 784;                      // vertical parallax works
  const tileW = Math.round(1168 * scale);
  const px = cam.x * 0.4;                       // horizontal parallax
  const py = (cam.y / Math.max(1, WORLD_H - VIEW_H)) * (bgH - VIEW_H);
  const first = Math.floor(px / tileW) - 1;
  for (let i = first; (i - first) * tileW < VIEW_W + 2 * tileW; i++) {
    const img = BACKGROUNDS[name];
    const x = Math.round(i * tileW - px);
    // Mirror every second tile so the seams line up naturally.
    if (((i % 2) + 2) % 2 === 1) {
      ctx.save(); ctx.translate(x + tileW / 2, 0); ctx.scale(-1, 1);
      ctx.drawImage(img, -tileW / 2, -py, tileW, bgH); ctx.restore();
    } else {
      ctx.drawImage(img, x, -py, tileW, bgH);
    }
  }
}

// Soft light rays shining from the surface (screen space, slow pulse).
function drawLightRays() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const pulse = 0.24 + Math.sin(time * 0.6) * 0.08;
  for (let i = 0; i < 3; i++) {
    const x = ((i * 520 - cam.x * 0.25) % (VIEW_W + 600) + VIEW_W + 600) % (VIEW_W + 600) - 300;
    drawSprite("light-rays", i % 2,
               x, 130 - cam.y * 0.08, 700, false, 0, pulse);
  }
  ctx.restore();
}

function drawWorld() {
  drawBackground();
  drawLightRays();
  const cx = cam.x, cy = cam.y;
  const onScreen = (x, m) => x - cx > -m && x - cx < VIEW_W + m;

  // Shipwreck first (biggest, furthest back landmark).
  const sw = level.shipwreck;
  if (onScreen(sw.x, 400))
    drawSprite("shipwreck", 0, sw.x - cx, sw.y - cy, sw.size);

  // Sea-floor sand strip tiled across the level (every other tile
  // mirrored so the dune shapes meet seamlessly). Drawn before the
  // plants and treasures so they stand rooted in it, and after the
  // shipwreck so its hull sits buried in the sand.
  {
    const f = frames("sand")[0];
    const tileW = f.w - 14;               // slight overlap hides seams
    const sandY = WORLD_H - f.h / 2 + 26; // small overhang past the bottom
    const first = Math.floor(cx / tileW) - 1;
    for (let i = first; i * tileW < cx + VIEW_W + tileW; i++)
      drawSprite("sand", 0, i * tileW + f.w / 2 - cx, sandY - cy, f.w,
                 ((i % 2) + 2) % 2 === 1);
  }

  for (const t of level.treasures)
    if (onScreen(t.x, 150))
      drawSprite("treasure", t.frame, t.x - cx, t.y - cy, t.size);

  for (const p of level.props)
    if (onScreen(p.x, 250))
      drawSprite(p.key, p.frame, p.x - cx, p.y - cy, p.size, p.flip,
                 p.key === "kelp" ? Math.sin(time * 0.9 + p.sway) * 0.05 : 0);

  for (const c of level.clams)
    if (onScreen(c.x, 120))
      drawSprite("clam", c.anim < 0 ? 0 : c.anim, c.x - cx,
                 c.y - cy + Math.sin(time * 1.3 + c.x) * 4, c.size);

  for (const s of level.seaStars)
    if (!s.taken && onScreen(s.x, 120))
      drawSprite("sea-star", (s.t * 4 | 0) % frameCount("sea-star"),
                 s.x - cx, s.y - cy + Math.sin(s.t * 1.5) * 8, s.size,
                 false, Math.sin(s.t) * 0.15);

  for (const p of level.pearls)
    if (onScreen(p.x, 120)) {
      // A soft glow behind every pearl so it reads as precious.
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      drawSprite("sparkles", 4, p.x - cx, p.y - cy, 90, false, p.t, 0.5);
      ctx.restore();
      drawSprite("pearl", p.frame, p.x - cx, p.y - cy, p.size);
    }

  for (const f of level.wildFish)
    if (!f.joined && onScreen(f.px || f.x, 150))
      drawSprite(f.key, 1 % frameCount(f.key), (f.px || f.x) - cx, (f.py || f.y) - cy,
                 f.size, Math.cos(f.t * 0.8) < 0, Math.sin(f.t * 2) * 0.08);

  for (const b of player.buddies)
    drawSprite(b.key, 1 % frameCount(b.key), b.x - cx, b.y - cy, b.size,
               b.flip, Math.sin(time * 2.4 + b.x) * 0.07);

  drawMermaid();

  // Sparkle guide: a soft trail of sparkles leading from the mermaid
  // toward the nearest unopened clam or loose pearl. A five-year-old
  // can't read a map - but everyone can follow the sparkles. It only
  // appears when the target is off at a distance.
  if (!level.done) {
    let tx = 0, ty = 0, best = Infinity;
    for (const c of level.clams)
      if (c.anim < 0) {
        const d = dist(player.x, player.y, c.x, c.y);
        if (d < best) { best = d; tx = c.x; ty = c.y; }
      }
    for (const p of level.pearls) {
      const d = dist(player.x, player.y, p.x, p.y);
      if (d < best) { best = d; tx = p.x; ty = p.y; }
    }
    if (best > 320 && best < Infinity) {
      const a = Math.atan2(ty - player.y, tx - player.x);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 4; i++) {
        const d = 105 + i * 55 + Math.sin(time * 3 - i * 1.2) * 10;
        drawSprite("sparkles", i % 4,
                   player.x + Math.cos(a) * d - cx,
                   player.y + Math.sin(a) * d - cy,
                   34 - i * 4, false, time * 1.5 + i, 0.8 - i * 0.13);
      }
      ctx.restore();
    }
  }

  for (const b of level.ambient)
    if (onScreen(b.x, 60))
      drawSprite("bubbles", b.frame, b.x - cx, b.y - cy, b.size, false, 0, 0.55);

  drawParticles(cx, cy);
}

function drawMermaid() {
  const sheet = playerSheet();
  const n = frameCount(sheet);
  let idx;
  if (player.actionT > 0) {
    // Song/spin play once across their duration.
    const total = player.state === "song" ? 1.1 : 0.9;
    idx = clamp(((total - player.actionT) / total) * n, 0, n - 1);
  } else {
    idx = (player.animT * (player.state === "swim" ? 9 : 6)) % n;
  }
  const bob = Math.sin(time * 1.6) * 5;
  // Trailing sparkles while swimming fast - pure joy.
  if (Math.hypot(player.vx, player.vy) > 240 && Math.random() < 0.35)
    sparkle(player.x - player.facing * 60, player.y + 20, 1, 30, 30);
  drawSprite(sheet, idx, player.x - cam.x, player.y - cam.y + bob,
             170, player.facing < 0);
}

/* --- HUD ---------------------------------------------------------------- */
/* Buttons are stored each frame so the tap handler can hit-test them.    */
let hud = {};

function drawHUD() {
  hud = {};

  // Pearl counter (top-left) using the real number sprites.
  drawSprite("pearl", 3, 46, 46, 52);
  drawNumber(level.collected, 84, 46, 44);
  // Clams still holding pearls, next to it.
  drawSprite("clam", 0, 190, 46, 52);
  drawNumber(level.def.clams - level.collected, 228, 46, 44);
  // Sea star tally below.
  drawSprite("sea-star", 3, 46, 104, 46);
  drawNumber(save.totalStars, 84, 104, 38);

  // Magic meter (bottom-left): pick the fill frame for the current level.
  const mf = clamp(Math.round(player.meter * (frameCount("magic-meter") - 1)),
                   0, frameCount("magic-meter") - 1);
  drawSprite("magic-meter", mf, 170, VIEW_H - 44, 300);

  // Action buttons (bottom-right). Second frame = glowing pressed look.
  // The magic button pulses whenever a closed clam is in song range -
  // it teaches "press me now" without a word of text.
  const clamNear = level.clams.some(c =>
    c.anim < 0 && dist(player.x, player.y, c.x, c.y) < SONG_RADIUS);
  if (clamNear) {
    const pulse = 0.5 + Math.sin(time * 5) * 0.3;
    const g = ctx.createRadialGradient(VIEW_W - 216, VIEW_H - 86, 20,
                                       VIEW_W - 216, VIEW_H - 86, 95);
    g.addColorStop(0, `rgba(255, 230, 255, ${pulse})`);
    g.addColorStop(1, "rgba(255, 230, 255, 0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(VIEW_W - 216, VIEW_H - 86, 95, 0, Math.PI * 2); ctx.fill();
  }
  const magicOn = player.state === "song" ? 1 : 0;
  const spinOn = player.state === "spin" ? 1 : 0;
  drawSprite("button-magic", magicOn, VIEW_W - 216, VIEW_H - 86, 120 + magicOn * 10);
  drawSprite("button-spin", spinOn, VIEW_W - 84, VIEW_H - 86, 120 + spinOn * 10);
  hud.magic = { x: VIEW_W - 216, y: VIEW_H - 86, r: 66 };
  hud.spin = { x: VIEW_W - 84, y: VIEW_H - 86, r: 66 };

  // Pause (top-right).
  drawSprite("button-pause", 0, VIEW_W - 56, 52, 76);
  hud.pause = { x: VIEW_W - 56, y: 52, r: 46 };

  // Level-name banner for the first moments of a level, with a
  // picture goal a pre-reader understands: FIND [clam] [count].
  if (introTimer > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(introTimer, 0, 1);
    drawWord(level.def.name, VIEW_W / 2, 120, 58, "center");
    drawWord("FIND", VIEW_W / 2 - 64, 196, 40, "right");
    drawSprite("clam", 0, VIEW_W / 2 - 14, 196, 56);
    drawNumber(level.def.clams, VIEW_W / 2 + 34, 196, 46);
    ctx.restore();
  }
}

/* --- overlays ----------------------------------------------------------- */

function drawPanel(w, h) {
  ctx.fillStyle = "rgba(40, 70, 140, 0.35)";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawSprite("panel-frame", 0, VIEW_W / 2, VIEW_H / 2, Math.max(w, h * 1168 / 784));
}

function drawOverlay() {
  if (overlay === "pause") {
    drawPanel(760, 500);
    drawWord("PAUSED", VIEW_W / 2, VIEW_H / 2 - 105, 62, "center");
    drawWord("SWIM ON", VIEW_W / 2, VIEW_H / 2 + 5, 44, "center");
    hud.resume = { x: VIEW_W / 2, y: VIEW_H / 2 + 5, r: 120 };
    drawSprite("button-restart", 0, VIEW_W / 2 - 160, VIEW_H / 2 + 105, 86);
    hud.restart = { x: VIEW_W / 2 - 160, y: VIEW_H / 2 + 105, r: 50 };
    drawWord("NEXT", VIEW_W / 2, VIEW_H / 2 + 105, 36, "center");
    hud.skip = { x: VIEW_W / 2, y: VIEW_H / 2 + 105, r: 70 };
    drawWord("HOME", VIEW_W / 2 + 160, VIEW_H / 2 + 105, 36, "center");
    hud.home = { x: VIEW_W / 2 + 160, y: VIEW_H / 2 + 105, r: 80 };
  } else if (overlay === "complete" || overlay === "end") {
    drawPanel(820, 540);
    drawWord(overlay === "end" ? "ALL DONE" : "WONDERFUL", VIEW_W / 2, VIEW_H / 2 - 110, 58, "center");
    drawSprite("pearl", 5, VIEW_W / 2 - 85, VIEW_H / 2 - 20, 60);
    drawNumber(level.collected, VIEW_W / 2 + 10, VIEW_H / 2 - 20, 56, "center");
    if (overlay === "end") {
      drawWord("YOU FOUND EVERY PEARL", VIEW_W / 2, VIEW_H / 2 + 50, 30, "center");
      drawWord("STAY", VIEW_W / 2 - 120, VIEW_H / 2 + 120, 40, "center");
      hud.stay = { x: VIEW_W / 2 - 120, y: VIEW_H / 2 + 120, r: 95 };
      drawWord("HOME", VIEW_W / 2 + 110, VIEW_H / 2 + 120, 42, "center");
      hud.home = { x: VIEW_W / 2 + 110, y: VIEW_H / 2 + 120, r: 100 };
    } else {
      drawWord("NEXT", VIEW_W / 2 + 110, VIEW_H / 2 + 90, 46, "center");
      hud.next = { x: VIEW_W / 2 + 110, y: VIEW_H / 2 + 90, r: 100 };
      drawWord("STAY", VIEW_W / 2 - 130, VIEW_H / 2 + 90, 40, "center");
      hud.stay = { x: VIEW_W / 2 - 130, y: VIEW_H / 2 + 90, r: 95 };
    }
    // Gentle celebratory sparkle rain while the panel is up.
    if (Math.random() < 0.4)
      sparkle(cam.x + Math.random() * VIEW_W, cam.y + Math.random() * 200, 1, 60, 40);
  }
}

/* --- title screen -------------------------------------------------------- */

let titleT = 0;

function drawTitle(dt) {
  titleT += dt;
  // Ocean backdrop with rays and drifting bubbles.
  const img = BACKGROUNDS["open-blue-bubbles"];
  ctx.drawImage(img, 0, -100, VIEW_W, VIEW_H + 200);
  drawLightRays();

  // A mermaid glides across the title forever.
  const mx = ((titleT * 90) % (VIEW_W + 500)) - 250;
  drawSprite("mermaid-purple-swim", (titleT * 8) % 8, mx, 470 + Math.sin(titleT * 1.3) * 30, 150);

  drawSprite("title-logo", 0, VIEW_W / 2, 185, 500 + Math.sin(titleT * 1.5) * 8);

  const blink = 0.65 + Math.sin(titleT * 3) * 0.35;
  ctx.save(); ctx.globalAlpha = blink;
  drawWord("TAP TO SWIM", VIEW_W / 2, 428, 44, "center");
  ctx.restore();
  hud.start = { x: VIEW_W / 2, y: 428, r: 220 };

  // Mermaid picker.
  drawWord("PICK A MERMAID", VIEW_W / 2, 520, 26, "center");
  hud.picks = [];
  MERMAIDS.forEach((m, i) => {
    const x = VIEW_W / 2 + (i - 1) * 170, y = 615;
    const locked = save.totalPearls < m.need;
    ctx.save();
    if (i === save.mermaid) {          // soft glow behind the choice
      const g = ctx.createRadialGradient(x, y, 10, x, y, 85);
      g.addColorStop(0, "rgba(255,240,255,0.85)");
      g.addColorStop(1, "rgba(255,240,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 85, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha *= locked ? 0.35 : 1;
    drawSprite(m.swim, 0, x, y, 120, false, Math.sin(titleT * 1.5 + i) * 0.06);
    ctx.restore();
    if (locked) {                       // show how many pearls unlock her
      drawSprite("pearl", 0, x - 22, y + 44, 30);
      drawNumber(m.need, x + 2, y + 44, 28);
    }
    hud.picks.push({ x, y, r: 70, i, locked });
  });

  if (Math.random() < 0.12)
    sparkle(cam.x + Math.random() * VIEW_W, cam.y + Math.random() * VIEW_H, 1, 40, 30);
  updateParticles(dt);
  drawParticles(0, 0);
}

/* --- input routing ------------------------------------------------------- */

const inCircle = (x, y, c) => c && dist(x, y, c.x, c.y) <= c.r;

function handleTap(x, y) {
  uiTouched = false;
  if (scene === "title") {
    for (const p of hud.picks || []) {
      if (inCircle(x, y, p)) {
        if (!p.locked) { save.mermaid = p.i; persist(); sfx.tap(); }
        return;
      }
    }
    if (inCircle(x, y, hud.start)) { startLevel(save.level); return; }
    // Tapping anywhere else also starts - young players just tap.
    startLevel(save.level);
    return;
  }
  if (scene !== "play") return;

  if (overlay === "pause") {
    if (inCircle(x, y, hud.restart)) { sfx.tap(); startLevel(level.idx); }
    else if (inCircle(x, y, hud.skip)) {
      sfx.tap();
      if (level.idx + 1 < LEVELS.length) startLevel(level.idx + 1);
      else goHome();
    }
    else if (inCircle(x, y, hud.home)) { sfx.tap(); goHome(); }
    else { sfx.tap(); overlay = null; }
    uiTouched = true; return;
  }
  if (overlay === "complete") {
    if (inCircle(x, y, hud.next)) { sfx.tap(); startLevel(level.idx + 1); }
    else if (inCircle(x, y, hud.stay)) { sfx.tap(); overlay = null; }
    uiTouched = true; return;
  }
  if (overlay === "end") {
    if (inCircle(x, y, hud.home)) { sfx.tap(); goHome(); }
    else if (inCircle(x, y, hud.stay)) { sfx.tap(); overlay = null; }
    uiTouched = true; return;
  }

  if (inCircle(x, y, hud.pause)) { sfx.tap(); overlay = "pause"; uiTouched = true; return; }
  if (inCircle(x, y, hud.magic)) { castSong(); uiTouched = true; return; }
  if (inCircle(x, y, hud.spin)) { castSpin(); uiTouched = true; return; }
}

function handleKey(k) {
  if (k === "f") {   // toggle fullscreen from the keyboard too
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else goFullscreen();
    return;
  }
  if (scene === "title" && (k === "enter" || k === " ")) { initAudio(); startLevel(save.level); return; }
  if (scene !== "play") return;
  if (k === " " || k === "e") { if (!overlay) castSong(); }
  if (k === "shift" || k === "x") { if (!overlay) castSpin(); }
  if (k === "p" || k === "escape") overlay = overlay === "pause" ? null : "pause";
}

function startLevel(idx) {
  idx = clamp(idx, 0, LEVELS.length - 1);
  level = buildLevel(idx);
  resetPlayer();
  overlay = null; scene = "play"; introTimer = 4.5;
  cam.x = clamp(player.x - VIEW_W / 2, 0, WORLD_W - VIEW_W);
  cam.y = clamp(player.y - VIEW_H / 2, 0, WORLD_H - VIEW_H);
  sfx.tap();
}

function goHome() { scene = "title"; overlay = null; level = null; }

/* ===== 11. MAIN LOOP ==================================================== */

function drawLoading() {
  ctx.fillStyle = "#4a90c9"; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const p = assetsTotal ? assetsDone / assetsTotal : 0;
  ctx.fillStyle = "rgba(255,255,255,.4)";
  ctx.fillRect(VIEW_W / 2 - 200, VIEW_H / 2 - 12, 400, 24);
  ctx.fillStyle = "#ffe9f7";
  ctx.fillRect(VIEW_W / 2 - 200, VIEW_H / 2 - 12, 400 * p, 24);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; time += dt;
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);

  if (scene === "loading") {
    drawLoading();
  } else if (scene === "title") {
    drawTitle(dt);
  } else if (scene === "play") {
    if (!overlay) {
      if (introTimer > 0) introTimer -= dt;
      updatePlayer(dt);
      updateBuddies(dt);
      updateLevel(dt);
      updateCamera(dt);
      updateParticles(dt);
    } else {
      updateParticles(dt);   // sparkle rain keeps falling on overlays
    }
    drawWorld();
    drawHUD();
    drawOverlay();
  }
  requestAnimationFrame(frame);
}

loadAssets(() => { scene = "title"; });
requestAnimationFrame(frame);

// A tiny debug handle for automated tests (harmless in normal play).
window.MMQ = {
  get state() {
    return { scene, overlay, level: level && level.idx,
             collected: level && level.collected, buddies: player.buddies.length };
  },
  openAllClams() { if (level) for (const c of level.clams) if (c.anim < 0) openClam(c); },
  bankPearls() {   // pretend the mermaid picked up every loose pearl
    if (!level) return;
    level.collected += level.pearls.length;
    level.pearls.length = 0;
  },
};
