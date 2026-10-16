import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildMap, buildSky } from './map.js';
import { Sparks, Debris, Chunks, Tracers, Decals, Rings, OrbPool } from './fx.js';
import { Robot, ROBOTS } from './robots.js';
import { WEAPONS, WEAPON_ORDER, ViewModel } from './weapons.js';
import { AudioSys } from './audio.js';
import { Input } from './input.js';
import { Hud } from './ui.js';
import { mergeColored } from './geo.js';
import { shadowTexture } from './textures.js';
import { clamp, damp, rand, pick, wrapAngle, store, fmtTime } from './util.js';

const $ = (id) => document.getElementById(id);
const show = (el, on) => el.classList.toggle('hidden', !on);

// ---------------------------------------------------------------- renderer
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.info.autoReset = false;
const MAX_PR = Math.min(window.devicePixelRatio || 1, 2);
let pixelRatio = MAX_PR;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe6ff, 80, 330);
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 700);
camera.rotation.order = 'YXZ';
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xe4f2ff, 0xb39a80, 1.35));
const sun = new THREE.DirectionalLight(0xfff0d8, 1.6);
sun.position.set(30, 60, 18);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xa8ccff, 0.45);
fill.position.set(-30, 25, -40);
scene.add(fill);
const muzzleLight = new THREE.PointLight(0xffffff, 0, 10, 2);
scene.add(muzzleLight);

const world = buildMap(scene);
buildSky(scene);
const vm = new ViewModel();

class ViewModelPass extends Pass {
  constructor(s, c) { super(); this.scene = s; this.camera = c; this.needsSwap = false; }
  render(r, writeBuffer, readBuffer) {
    const ac = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.renderToScreen ? null : readBuffer);
    r.clearDepth();
    r.render(this.scene, this.camera);
    r.autoClear = ac;
  }
}
class HalfBloom extends UnrealBloomPass {
  setSize(w, h) { super.setSize(Math.max(2, Math.round(w * 0.5)), Math.max(2, Math.round(h * 0.5))); }
}
const samples = renderer.capabilities.isWebGL2 && MAX_PR < 1.75 ? 4 : 0;
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new ViewModelPass(vm.scene, vm.camera));
const bloom = new HalfBloom(new THREE.Vector2(256, 256), 0.5, 0.35, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- effects
const fx = {
  sparks: new Sparks(scene),
  debris: new Debris(scene),
  chunks: new Chunks(scene),
  tracers: new Tracers(scene),
  decals: new Decals(scene),
  rings: new Rings(scene, 12),
};
const enemyOrbs = new OrbPool(scene, 90, 0.17, new THREE.MeshBasicMaterial({ color: 0xffffff }), 2.2);
const bubbleOrbs = new OrbPool(scene, 24, 0.24, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff5fd0, emissiveIntensity: 0.7, transparent: true, opacity: 0.78, roughness: 0.1, metalness: 0 }));
const blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: shadowTexture(true), transparent: true, depthWrite: false, color: 0x000000, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 16);
blobs.count = 0;
blobs.frustumCulled = false;
scene.add(blobs);

const audio = new AudioSys();
const hud = new Hud();
const input = new Input(canvas, $('touch'));

// ---------------------------------------------------------------- settings
const TOTAL_WAVES = 8;
const DIFF = {
  easy: {
    key: 'easy', name: '简单', hpMul: 0.7, dmgMul: 0.35, projSpeed: 0.65, speedMul: 0.8, reaction: 0.9, pauseMul: 1.6, spread: 0.07, lead: 0,
    count: 0.6, maxAlive: 3, lives: 3, assist: 1, regen: true, scoreMul: 1, buyTime: 45, startCoins: 400, overtime: false, drop: 0.35,
  },
  normal: {
    key: 'normal', name: '普通', hpMul: 1, dmgMul: 1, projSpeed: 0.9, speedMul: 1, reaction: 0.5, pauseMul: 1.1, spread: 0.045, lead: 0.4,
    count: 1, maxAlive: 5, lives: 2, assist: 0, regen: false, scoreMul: 1.5, buyTime: 30, startCoins: 300, overtime: true, drop: 0.2,
  },
  hard: {
    key: 'hard', name: '困难', hpMul: 1.25, dmgMul: 1.35, projSpeed: 1.15, speedMul: 1.12, reaction: 0.3, pauseMul: 0.85, spread: 0.025, lead: 0.85,
    count: 1.3, maxAlive: 7, lives: 1, assist: 0, regen: false, scoreMul: 2, buyTime: 25, startCoins: 200, overtime: true, drop: 0.12,
  },
};
const settings = {
  diff: store.get('roboStrike.diff') in DIFF ? store.get('roboStrike.diff') : 'normal',
  sens: parseFloat(store.get('roboStrike.sens')) || 1,
};

// ---------------------------------------------------------------- state
const player = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), r: 0.38, h: 1.75, height: 1.75, step: 0.45, grounded: true, hitWall: false,
  eye: new THREE.Vector3(), eyeH: 1.62, stepOffset: 0, yaw: 0, pitch: 0, recoilP: 0, recoilY: 0,
  hp: 100, maxHp: 100, armor: 0, alive: true, invuln: 0, lastHurt: -99,
  weapons: {}, cur: 'rifle', last: 'pistol', fireT: 0, reloadT: 0, reloading: false, switchT: 0, bloom: 0, crouch: 0,
  speedLvl: 0, vitalLvl: 0, stepT: 0, alt: false, triggerHeld: false, deadT: 0,
};
const G = {
  mode: 'title', paused: false, diff: DIFF.normal, time: 0, wave: 1, waveTimer: 0, overtime: false, countdown: 0,
  score: 0, coins: 0, kills: 0, shots: 0, hits: 0, headshots: 0, robots: [], queue: [], maxAlive: 5, spawnT: 0,
  buyT: 0, shopOpen: false, shopAutoT: 0, lives: 1, hitStop: 0, trauma: 0, fovKick: 0, waveDone: false, endT: 0, endWin: false,
  respawnT: 0, warnT: 0, startTime: 0, lowWarned: false,
  world, scene, fx, audio, player, enemyShoot,
};
const pickups = [];

// ---------------------------------------------------------------- pickups
const PICK = {
  health: { label: '+50 生命' },
  ammo: { label: '弹药补充' },
  armor: { label: '+50 护甲' },
};
const pickupGeo = {
  health: mergeColored([
    { g: new RoundedBoxGeometry(0.5, 0.5, 0.5, 2, 0.1), c: 0x3fd18a },
    { g: new THREE.BoxGeometry(0.32, 0.1, 0.54), c: 0xffffff },
    { g: new THREE.BoxGeometry(0.1, 0.32, 0.54), c: 0xffffff },
    { g: new THREE.BoxGeometry(0.54, 0.1, 0.32), c: 0xffffff, r: [0, Math.PI / 2, 0] },
  ]),
  ammo: mergeColored([
    { g: new RoundedBoxGeometry(0.6, 0.32, 0.4, 2, 0.06), c: 0xff9a3c },
    { g: new THREE.BoxGeometry(0.62, 0.06, 0.42), c: 0x3a4560, p: [0, 0.06, 0] },
    { g: new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10), c: 0xffd04a, p: [-0.15, 0.27, 0] },
    { g: new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10), c: 0xffd04a, p: [0, 0.27, 0] },
    { g: new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10), c: 0xffd04a, p: [0.15, 0.27, 0] },
  ]),
  armor: mergeColored([
    { g: new THREE.CylinderGeometry(0.34, 0.34, 0.12, 6), c: 0x3d7bff, r: [Math.PI / 2, 0, 0] },
    { g: new THREE.CylinderGeometry(0.22, 0.22, 0.14, 6), c: 0x9fd8ff, r: [Math.PI / 2, 0, 0] },
  ]),
  ring: mergeColored([{ g: new THREE.TorusGeometry(0.5, 0.04, 6, 28), c: [0.6, 2.8, 2.2], r: [Math.PI / 2, 0, 0] }]),
};
const pickupMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.12 });
const ringMat = new THREE.MeshBasicMaterial({ vertexColors: true });

function makePickup(kind, pos, temp) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(pickupGeo[kind], pickupMat);
  body.position.y = 0.55;
  g.add(body);
  const ring = new THREE.Mesh(pickupGeo.ring, ringMat);
  ring.position.y = 0.05;
  g.add(ring);
  g.position.copy(pos);
  scene.add(g);
  const p = { kind, pos: pos.clone(), mesh: g, body, active: true, respawn: 0, temp, life: temp ? 16 : 0, phase: rand(0, 6) };
  pickups.push(p);
  return p;
}

function resetPickups() {
  for (const p of pickups) scene.remove(p.mesh);
  pickups.length = 0;
  for (const s of world.pickupSpots) makePickup(s.kind, s.pos, false);
}

function weaponState(id) { return player.weapons[id]; }
function magSize(id) { const w = WEAPONS[id], s = weaponState(id); return Math.round(w.mag * (1 + 0.2 * (s.level - 1))); }
function maxReserve(id) { const w = WEAPONS[id], s = weaponState(id); return w.reserve === Infinity ? Infinity : Math.round(w.reserve * (1 + 0.2 * (s.level - 1))); }
function dmgMul(id) { return 1 + 0.25 * (weaponState(id).level - 1); }

function ammoMissing() {
  for (const id of WEAPON_ORDER) {
    const s = weaponState(id);
    if (!s.owned) continue;
    if (s.reserve < maxReserve(id) || s.mag < magSize(id)) return true;
  }
  return false;
}

function updatePickups(dt) {
  for (const p of pickups) {
    if (!p.active) {
      if (!p.temp) {
        p.respawn -= dt;
        if (p.respawn <= 0) { p.active = true; p.mesh.visible = true; fx.rings.add(_v.copy(p.pos).setY(p.pos.y + 0.5), 0x7cf0d0, 1.2, 0.4, 'ring'); }
      }
      continue;
    }
    p.phase += dt;
    p.body.rotation.y += dt * 1.8;
    p.body.position.y = 0.55 + Math.sin(p.phase * 2.4) * 0.08;
    if (p.temp) {
      p.life -= dt;
      p.mesh.visible = p.life > 3 || Math.floor(p.life * 6) % 2 === 0;
      if (p.life <= 0) { p.active = false; scene.remove(p.mesh); continue; }
    }
    if (!player.alive) continue;
    const dx = player.pos.x - p.pos.x, dz = player.pos.z - p.pos.z, dy = player.pos.y + 0.8 - (p.pos.y + 0.5);
    if (dx * dx + dz * dz + dy * dy > 1.5 * 1.5) continue;
    let used = false;
    if (p.kind === 'health' && player.hp < player.maxHp) { player.hp = Math.min(player.maxHp, player.hp + 50); used = true; }
    if (p.kind === 'armor' && player.armor < 100) { player.armor = Math.min(100, player.armor + 50); used = true; }
    if (p.kind === 'ammo' && ammoMissing()) {
      for (const id of WEAPON_ORDER) {
        const s = weaponState(id);
        if (!s.owned || maxReserve(id) === Infinity) continue;
        s.reserve = Math.min(maxReserve(id), s.reserve + Math.ceil(maxReserve(id) * 0.5));
      }
      used = true;
    }
    if (!used) continue;
    audio.play('pickup');
    hud.toast(PICK[p.kind].label);
    fx.sparks.burst(_v.copy(p.pos).setY(p.pos.y + 0.6), null, 24, 4, p.kind === 'health' ? 0x4fe08a : p.kind === 'armor' ? 0x5c9dff : 0xffc23d, { size: 0.08, grav: -2, life: 1.2 });
    p.active = false;
    p.mesh.visible = false;
    if (p.temp) scene.remove(p.mesh); else p.respawn = 25;
  }
  for (let i = pickups.length - 1; i >= 0; i--) if (pickups[i].temp && !pickups[i].active) pickups.splice(i, 1);
}

// ---------------------------------------------------------------- shop
const SHOP_COL = { armor: '#3d7bff', heal: '#3fd18a', ammo: '#ff9a3c', weapon: '#ff74ad', up: '#8f6bff', boots: '#2bbfb0', vital: '#ff5a4f' };
function shopItems() {
  const it = [];
  it.push({ id: 'armor', ic: '盾', col: SHOP_COL.armor, name: '护甲', desc: '护甲补满 100，帮你挡住一半伤害', price: 300, ok: player.armor < 100, note: player.armor >= 100 ? '已满' : '' });
  it.push({ id: 'heal', ic: '+', col: SHOP_COL.heal, name: '修复包', desc: '生命值马上回满', price: 200, ok: player.hp < player.maxHp, note: player.hp >= player.maxHp ? '已满' : '' });
  it.push({ id: 'ammo', ic: '弹', col: SHOP_COL.ammo, name: '弹药箱', desc: '所有武器的弹药都补满', price: 150, ok: ammoMissing(), note: ammoMissing() ? '' : '已满' });
  const wdesc = { scatter: '近距离一下打出 9 颗弹丸', rail: '一枪穿透好几个机器人，可以开镜' };
  for (const id of ['scatter', 'rail']) {
    if (!weaponState(id).owned) it.push({ id: 'buy_' + id, ic: WEAPONS[id].short[0], col: SHOP_COL.weapon, name: WEAPONS[id].name, desc: wdesc[id], price: WEAPONS[id].price, ok: true });
  }
  for (const id of WEAPON_ORDER) {
    const s = weaponState(id);
    if (!s.owned) continue;
    const lv = s.level;
    if (lv < 3) it.push({ id: 'up_' + id, ic: '↑', col: SHOP_COL.up, name: `${WEAPONS[id].name} 升级`, desc: `等级 ${lv} → ${lv + 1}：伤害 +25%，弹匣变大`, price: 350 + 250 * lv, ok: true });
    else it.push({ id: 'up_' + id, ic: '★', col: SHOP_COL.up, name: `${WEAPONS[id].name}`, desc: '已经是最高等级', price: 0, ok: false, note: '满级' });
  }
  it.push({ id: 'boots', ic: '跑', col: SHOP_COL.boots, name: '飞毛腿', desc: '移动速度 +8%', price: 450 + 300 * player.speedLvl, ok: player.speedLvl < 2, note: player.speedLvl >= 2 ? '满级' : '' });
  it.push({ id: 'vital', ic: '心', col: SHOP_COL.vital, name: '超级体能', desc: '生命上限 +25', price: 600 + 300 * player.vitalLvl, ok: player.vitalLvl < 2, note: player.vitalLvl >= 2 ? '满级' : '' });
  return it;
}

function renderShop() {
  $('shop-coins').textContent = G.coins;
  const box = $('shop-items');
  box.innerHTML = '';
  for (const item of shopItems()) {
    const d = document.createElement('div');
    const afford = G.coins >= item.price;
    d.className = 'item' + (!item.ok || !afford ? ' off' : '');
    d.dataset.id = item.id;
    const price = item.note ? `<span>${item.note}</span>` : `<b class="coin"></b>${item.price}`;
    d.innerHTML = `<div class="ic" style="background:${item.col}">${item.ic}</div><div class="nm">${item.name}</div><div class="ds">${item.desc}</div><div class="pr">${price}</div>`;
    d.addEventListener('click', () => buy(item.id));
    box.appendChild(d);
  }
}

function buy(id) {
  const item = shopItems().find((i) => i.id === id);
  if (!item) return false;
  if (!item.ok || G.coins < item.price) {
    audio.play('deny');
    if (item.ok) hud.toast('金币不够');
    return false;
  }
  G.coins -= item.price;
  if (id === 'armor') player.armor = 100;
  else if (id === 'heal') player.hp = player.maxHp;
  else if (id === 'ammo') {
    for (const w of WEAPON_ORDER) { const s = weaponState(w); if (s.owned) { s.reserve = maxReserve(w); s.mag = magSize(w); } }
  } else if (id.startsWith('buy_')) {
    const w = id.slice(4);
    const s = weaponState(w);
    s.owned = true; s.level = 1; s.mag = magSize(w); s.reserve = maxReserve(w);
    switchWeapon(w);
  } else if (id.startsWith('up_')) {
    const w = id.slice(3);
    const s = weaponState(w);
    s.level++;
    s.mag = magSize(w);
    s.reserve = maxReserve(w);
  } else if (id === 'boots') player.speedLvl++;
  else if (id === 'vital') { player.vitalLvl++; player.maxHp += 25; player.hp += 25; }
  audio.play('buy');
  renderShop();
  const el = document.querySelector(`.item[data-id="${id}"]`);
  if (el) el.classList.add('flash');
  return true;
}

function openShop() {
  if (G.mode !== 'buy' || G.paused || G.shopOpen) return;
  G.shopOpen = true;
  G.shopAutoT = 0;
  renderShop();
  show($('shop'), true);
  input.active = false;
  input.fire = false;
  input.resetTouch();
  unlock();
}

function closeShop(relock = true) {
  if (!G.shopOpen) return;
  G.shopOpen = false;
  show($('shop'), false);
  if (G.mode === 'buy' || G.mode === 'play') {
    input.active = true;
    if (relock) lock();
  }
}

// ---------------------------------------------------------------- pointer lock
function lock() {
  if (input.touchMode || input.locked) return;
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* not available */ }
}
function unlock() {
  if (document.pointerLockElement) { try { document.exitPointerLock(); } catch (e) { /* ignore */ } }
}

// ---------------------------------------------------------------- game flow
function clearWorld() {
  for (const r of G.robots) scene.remove(r.root);
  G.robots.length = 0;
  G.queue.length = 0;
  enemyOrbs.list.length = 0;
  bubbleOrbs.list.length = 0;
  fx.chunks.clear();
  fx.decals.clear();
}

function resetPlayer() {
  player.pos.copy(world.playerSpawn);
  player.vel.set(0, 0, 0);
  player.yaw = 0; player.pitch = 0; player.recoilP = 0; player.recoilY = 0;
  player.maxHp = 100; player.hp = 100; player.armor = 0;
  player.alive = true; player.invuln = 0; player.lastHurt = -99;
  player.speedLvl = 0; player.vitalLvl = 0;
  player.h = 1.75; player.height = 1.75; player.crouch = 0; player.grounded = true;
  for (const id of WEAPON_ORDER) {
    player.weapons[id] = { owned: id === 'rifle' || id === 'pistol' || id === 'bubble', level: 1, mag: 0, reserve: 0 };
    const s = player.weapons[id];
    s.mag = magSize(id);
    s.reserve = maxReserve(id);
  }
  player.reloading = false;
  player.fireT = 0;
  player.cur = 'rifle';
  player.last = 'pistol';
  vm.setWeapon('rifle');
}

function startGame(diffKey) {
  audio.init();
  settings.diff = diffKey || settings.diff;
  store.set('roboStrike.diff', settings.diff);
  G.diff = DIFF[settings.diff];
  clearWorld();
  resetPlayer();
  resetPickups();
  hud.clearFeed();
  Object.assign(G, {
    paused: false, time: 0, wave: 0, waveTimer: 0, overtime: false, countdown: 0, score: 0, coins: G.diff.startCoins, kills: 0, shots: 0, hits: 0,
    headshots: 0, spawnT: 0, shopOpen: false, shopAutoT: 0, lives: G.diff.lives, hitStop: 0, trauma: 0, fovKick: 0, waveDone: false, endT: 0,
    respawnT: 0, warnT: 0, lowWarned: false, startTime: performance.now(),
  });
  G.mode = 'buy';
  G.buyT = 12;
  for (const id of ['title', 'pause', 'shop', 'over']) show($(id), false);
  show($('hud'), true);
  show($('topbtns'), true);
  input.active = true;
  input.resetTouch();
  applyTouchMode();
  hud.center('准备战斗！<small>机器人马上就要来了</small>', 3);
  lock();
}

function buildQueue(n) {
  const d = G.diff;
  const q = [];
  const walkers = Math.max(2, Math.round((2 + n * 1.2) * d.count));
  const drones = n >= 2 ? Math.max(1, Math.round((n - 1) * 0.8 * d.count)) : 0;
  const heavies = n >= 4 ? Math.max(1, Math.round((n - 3) * 0.6 * d.count)) : n === 3 ? 1 : 0;
  for (let i = 0; i < walkers; i++) q.push('walker');
  for (let i = 0; i < drones; i++) q.push('drone');
  for (let i = 0; i < heavies; i++) q.push('heavy');
  for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
  if (n === TOTAL_WAVES) q.splice(Math.min(2, q.length), 0, 'boss');
  return q;
}

function startWave() {
  closeShop(false);
  G.wave++;
  G.mode = 'play';
  G.countdown = 3;
  G.waveTimer = 75 + 12 * G.wave;
  G.overtime = false;
  G.waveDone = false;
  G.queue = buildQueue(G.wave);
  G.maxAlive = G.diff.maxAlive + Math.floor(G.wave / 3);
  G.spawnT = 0;
  const last = G.wave === TOTAL_WAVES;
  hud.center(`第 ${G.wave} 波${last ? '：最终决战' : ''}<small>${last ? '小心巨无霸机甲！' : `${G.queue.length} 个机器人来袭`}</small>`, 2.6);
  audio.play('waveStart');
}

function spawnRobot(kind) {
  const P = player;
  const pts = world.enemySpawns.slice().sort(() => Math.random() - 0.5);
  let best = null;
  for (const p of pts) {
    const d = Math.hypot(p.x - P.pos.x, p.z - P.pos.z);
    if (d < 18) continue;
    _v.set(p.x, p.y + 1.5, p.z);
    if (!world.los(_v, P.eye)) { best = p; break; }
    if (!best) best = p;
  }
  if (!best) best = pts.reduce((a, b) => (Math.hypot(a.x - P.pos.x, a.z - P.pos.z) > Math.hypot(b.x - P.pos.x, b.z - P.pos.z) ? a : b));
  const pos = best.clone();
  pos.x += rand(-1, 1); pos.z += rand(-1, 1);
  const r = new Robot(kind, pos, G);
  G.robots.push(r);
  fx.rings.add(_v.set(pos.x, pos.y + 0.1, pos.z), 0x7cf0ff, 1.8 * r.t.scale, 0.5, 'ring', 1);
  fx.rings.add(_v.set(pos.x, pos.y + 1, pos.z), 0xb8f4ff, 1.2 * r.t.scale, 0.45, 'sphere', 0.5);
  fx.sparks.burst(_v.set(pos.x, pos.y + 1, pos.z), null, 30, 4, 0x7cf0ff, { grav: -3, size: 0.09, life: 1.2 });
  audio.play('spawn', { at: pos, maxD: 50 });
  return r;
}

function waveCleared() {
  G.waveDone = true;
  const timeBonus = Math.max(0, Math.ceil(G.waveTimer)) * 3;
  const bonus = 250 + 50 * G.wave + timeBonus;
  G.coins += bonus;
  G.score += Math.round(400 * G.wave * G.diff.scoreMul);
  enemyOrbs.list.length = 0;
  audio.play('waveClear');
  hud.coinPop(`+${bonus}`);
  if (G.wave >= TOTAL_WAVES) {
    hud.center('全部清除！<small>你打败了所有机器人</small>', 3);
    G.endT = 2.6;
    G.endWin = true;
    G.mode = 'ending';
    return;
  }
  hud.center(`第 ${G.wave} 波 完成！<small>奖励 ${bonus} 金币</small>`, 3);
  G.mode = 'buy';
  G.buyT = G.diff.buyTime;
  G.shopAutoT = 1.8;
}

function endGame(win) {
  G.mode = 'over';
  G.paused = false;
  input.active = false;
  input.resetTouch();
  closeShop(false);
  unlock();
  const key = 'roboStrike.best.' + G.diff.key;
  const prev = parseInt(store.get(key), 10) || 0;
  const record = G.score > prev;
  if (record) store.set(key, G.score);
  hud.clearFeed();
  $('over-title').textContent = win ? '胜利！' : '游戏结束';
  show($('over-record'), record && G.score > 0);
  const acc = G.shots ? Math.round((G.hits / G.shots) * 100) : 0;
  const secs = (performance.now() - G.startTime) / 1000;
  const waves = win ? TOTAL_WAVES : Math.max(0, G.wave - (G.waveDone ? 0 : 1));
  $('over-stats').innerHTML = [
    ['得分', G.score], ['最高分', Math.max(prev, G.score)], ['完成波数', `${waves}/${TOTAL_WAVES}`], ['击毁机器人', G.kills],
    ['爆头', G.headshots], ['命中率', acc + '%'], ['难度', G.diff.name], ['用时', fmtTime(secs)],
  ].map(([a, b]) => `<div>${a}<b>${b}</b></div>`).join('');
  show($('over'), true);
  show($('touch'), false);
  audio.play(win ? 'victory' : 'gameOver');
}

function pause() {
  if (!(G.mode === 'play' || G.mode === 'buy' || G.mode === 'ending') || G.paused) return;
  if (G.shopOpen) { closeShop(false); }
  G.paused = true;
  G.pauseTime = performance.now();
  input.active = false;
  input.resetTouch();
  unlock();
  $('opt-music').checked = audio.musicOn;
  $('opt-sound').checked = !audio.muted;
  $('opt-sens').value = settings.sens;
  show($('pause'), true);
}

function resume() {
  if (!G.paused) return;
  G.paused = false;
  show($('pause'), false);
  input.active = true;
  audio.resume();
  lock();
}

function toTitle() {
  G.mode = 'title';
  G.paused = false;
  input.active = false;
  input.resetTouch();
  unlock();
  clearWorld();
  for (const id of ['pause', 'shop', 'over', 'hud', 'topbtns', 'touch']) show($(id), false);
  show($('title'), true);
  updateTitle();
  spawnTitleBots();
}

function spawnTitleBots() {
  G.diff = DIFF[settings.diff];
  G.wave = 1;
  player.alive = false;
  player.pos.set(0, -50, 0);
  player.eye.set(0, -50, 0);
  for (const k of ['walker', 'drone', 'heavy', 'walker', 'drone']) {
    const n = pick(world.nodes);
    const r = new Robot(k, new THREE.Vector3(n.x, n.y, n.z), G);
    r.spawnT = 0.01;
    G.robots.push(r);
  }
}

function updateTitle() {
  document.querySelectorAll('#diff button').forEach((b) => b.classList.toggle('sel', b.dataset.diff === settings.diff));
  $('best-diff').textContent = DIFF[settings.diff].name;
  $('best').textContent = parseInt(store.get('roboStrike.best.' + settings.diff), 10) || 0;
}

// ---------------------------------------------------------------- player
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _d = new THREE.Vector3();
const _o = new THREE.Vector3();
const _m = new THREE.Vector3();
const _hitN = new THREE.Vector3();

function updatePlayer(dt) {
  const P = player;
  if (P.invuln > 0) P.invuln -= dt;
  if (!P.alive) return;
  const w = WEAPONS[P.cur];
  let mx = input.active ? input.moveX : 0;
  let my = input.active ? input.moveY : 0;
  const ml = Math.hypot(mx, my);
  if (ml > 1) { mx /= ml; my /= ml; }
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  // forward (-sin, -cos), right (cos, -sin)
  const wx = -sy * my + cy * mx;
  const wz = -cy * my - sy * mx;
  const crouchWant = input.active && input.crouch;
  const standBlocked = world.blockedAt(P.pos.x, P.pos.z, P.r, P.pos.y + 1.1, P.pos.y + 1.76);
  const crouching = crouchWant || (P.crouch > 0.5 && standBlocked);
  P.crouch = damp(P.crouch, crouching ? 1 : 0, 14, dt);
  P.h = crouching ? 1.15 : 1.75;
  P.height = 1.75 - 0.6 * P.crouch;
  const aiming = input.aim && input.active;
  const maxSpeed = 6.2 * w.speedMul * (1 + 0.08 * P.speedLvl) * (crouching ? 0.5 : 1) * (aiming ? 0.72 : 1);
  const k = 1 - Math.exp(-(P.grounded ? 12 : 2.2) * dt);
  P.vel.x += (wx * maxSpeed - P.vel.x) * k;
  P.vel.z += (wz * maxSpeed - P.vel.z) * k;
  if (input.jumpQueued) {
    input.jumpQueued = false;
    if (P.grounded && input.active) {
      P.vel.y = 7.3;
      P.grounded = false;
      audio.play('jump');
    }
  }
  const y0 = P.pos.y;
  world.move(P, P.vel.x * dt, P.vel.z * dt);
  const landed = world.fall(P, dt);
  if (landed > 4) {
    audio.play('land', { vol: Math.min(1, landed / 10) });
    vm.land = Math.min(1, landed / 12);
    G.trauma += Math.min(0.15, landed * 0.01);
  }
  // smooth out step-ups
  if (P.grounded && P.pos.y - y0 > 0.05 && P.pos.y - y0 < 0.6) P.stepOffset -= P.pos.y - y0;
  P.stepOffset = damp(P.stepOffset, 0, 14, dt);
  // safety net: never fall out of the arena
  if (P.pos.y < -5 || Math.abs(P.pos.x) > 30 || Math.abs(P.pos.z) > 34) { P.pos.copy(world.playerSpawn); P.vel.set(0, 0, 0); }
  const hs = Math.hypot(P.vel.x, P.vel.z);
  if (P.grounded && hs > 2.4 && !crouching) {
    P.stepT -= dt * hs;
    if (P.stepT <= 0) { P.stepT = 2.3; P.alt = !P.alt; audio.play('step', { alt: P.alt, vol: aiming ? 0.5 : 1 }); }
  }
  // easy mode slowly repairs you
  if (G.diff.regen && G.time - P.lastHurt > 4 && P.hp < P.maxHp) P.hp = Math.min(P.maxHp, P.hp + 6 * dt);
  // low health warning
  if (P.hp <= 30) {
    G.warnT -= dt;
    if (G.warnT <= 0) { G.warnT = 1.6; audio.play('warn'); }
    if (!G.lowWarned) { G.lowWarned = true; hud.toast('生命值低！快去找绿色的修复包'); }
  } else if (P.hp > 45) G.lowWarned = false;
}

function updateEye() {
  const P = player;
  P.eyeH = P.height - 0.13;
  P.eye.set(P.pos.x, P.pos.y + P.eyeH + P.stepOffset, P.pos.z);
}

// ---------------------------------------------------------------- looking and aim assist
function assistStrength() {
  return Math.min(1, G.diff.assist + (input.touchMode ? 0.75 : 0));
}

function aimBasis(yaw, pitch) {
  const cp = Math.cos(pitch);
  _f.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  _r.set(Math.cos(yaw), 0, -Math.sin(yaw));
  _u.crossVectors(_r, _f);
}

// Nearest visible robot point within maxAng of the crosshair.
function assistTarget(maxAng) {
  aimBasis(player.yaw, player.pitch + player.recoilP);
  let best = null, bestA = maxAng;
  for (const r of G.robots) {
    if (!r.alive || r.spawnT > 0) continue;
    for (const pt of [r.bodyC, r.headC]) {
      _d.subVectors(pt, player.eye);
      const dist = _d.length();
      if (dist > 45 || dist < 0.5) continue;
      const a = Math.acos(clamp(_d.dot(_f) / dist, -1, 1));
      // allow a little more slack up close
      const lim = bestA + Math.min(0.08, 0.6 / dist);
      if (a < lim && world.los(player.eye, pt)) {
        bestA = a;
        best = { r, pt, a, head: pt === r.headC, dist };
      }
    }
  }
  return best;
}

let assistCache = null;
function updateLook(dt) {
  const P = player;
  const [dx, dy] = input.consumeLook();
  if (!input.active || !P.alive) return { dx, dy };
  const scoped = isScoped();
  const aimK = scoped ? 0.32 : input.aim ? 0.65 : 1;
  const base = input.touchMode ? 0.0052 : 0.0022;
  const A = assistStrength();
  assistCache = A > 0 ? assistTarget(0.11) : null;
  const friction = assistCache ? 1 - 0.35 * A : 1;
  const s = base * settings.sens * aimK * friction;
  P.yaw -= dx * s;
  P.pitch -= dy * s;
  // gentle pull toward a nearby target while the player is moving or turning
  if (assistCache && A > 0) {
    const pt = assistCache.r.bodyC;
    _d.subVectors(pt, P.eye);
    const tyaw = Math.atan2(-_d.x, -_d.z);
    const tpitch = Math.atan2(_d.y, Math.hypot(_d.x, _d.z));
    const moving = Math.hypot(P.vel.x, P.vel.z) > 0.5 || Math.abs(dx) + Math.abs(dy) > 0.5 || input.fire;
    const pull = (moving ? 3.2 : 1.2) * A * dt;
    P.yaw += wrapAngle(tyaw - P.yaw) * Math.min(1, pull);
    P.pitch += (tpitch - P.recoilP - P.pitch) * Math.min(1, pull * 0.6);
  }
  P.pitch = clamp(P.pitch, -1.45, 1.45);
  P.yaw = wrapAngle(P.yaw);
  return { dx, dy };
}

// ---------------------------------------------------------------- weapons
function isScoped() { return player.cur === 'rail' && input.aim && input.active && player.alive && !player.reloading && player.switchT <= 0; }

function switchWeapon(id) {
  const P = player;
  if (!weaponState(id) || !weaponState(id).owned || P.cur === id) return;
  P.last = P.cur;
  P.cur = id;
  P.reloading = false;
  P.switchT = 0.32;
  P.fireT = 0;
  P.bloom = 0;
  vm.setWeapon(id);
  audio.play('switch');
}

function cycleWeapon(dir) {
  const owned = WEAPON_ORDER.filter((id) => weaponState(id).owned);
  const i = owned.indexOf(player.cur);
  switchWeapon(owned[(i + dir + owned.length) % owned.length]);
}

function startReload() {
  const P = player, id = P.cur, s = weaponState(id);
  if (P.reloading || s.mag >= magSize(id) || s.reserve <= 0 || P.switchT > 0) return;
  P.reloading = true;
  P.reloadT = WEAPONS[id].reload;
  audio.play('reloadOut');
}

function finishReload() {
  const P = player, id = P.cur, s = weaponState(id);
  const need = magSize(id) - s.mag;
  const take = Math.min(need, s.reserve);
  s.mag += take;
  if (s.reserve !== Infinity) s.reserve -= take;
  P.reloading = false;
  audio.play('reloadIn');
}

function currentSpread(w) {
  const P = player;
  const hs = Math.hypot(P.vel.x, P.vel.z);
  const air = P.grounded ? 0 : w.spreadAir;
  let s = w.spreadBase + w.spreadMove * Math.min(1, hs / 6) + air + P.bloom;
  s = Math.min(s, w.spreadBase + w.spreadMax + air);
  if (P.crouch > 0.5) s *= 0.65;
  if (isScoped()) s = w.zoomSpread + w.spreadMove * Math.min(1, hs / 6) * 0.5 + air;
  else if (input.aim) s *= 0.6;
  if (G.diff.key === 'easy') s *= 0.8;
  return s;
}

function updateWeapon(dt) {
  const P = player;
  const id = P.cur, w = WEAPONS[id], s = weaponState(id);
  P.fireT -= dt;
  P.bloom = Math.max(0, P.bloom - dt * 0.12);
  if (P.switchT > 0) P.switchT -= dt;
  if (P.reloading) {
    P.reloadT -= dt;
    if (P.reloadT <= 0) finishReload();
  }
  const want = input.fire && input.active && P.alive && G.mode !== 'ending';
  if (want && P.fireT <= 0 && !P.reloading && P.switchT <= 0) {
    const semiBlocked = !w.auto && P.triggerHeld && !input.touchMode;
    if (!semiBlocked) {
      if (s.mag <= 0) {
        P.fireT = 0.3;
        audio.play('empty');
        if (s.reserve > 0) startReload();
      } else {
        shoot(id);
      }
    }
  }
  P.triggerHeld = want;
  if (s.mag <= 0 && s.reserve > 0 && !P.reloading && P.fireT <= -0.15 && P.switchT <= 0) startReload();
}

function shoot(id) {
  const P = player, w = WEAPONS[id], s = weaponState(id);
  s.mag--;
  G.shots++;
  P.fireT = w.interval;
  const spread = currentSpread(w);
  aimBasis(P.yaw, P.pitch + P.recoilP);
  _m.copy(_f);
  // aim assist bends the shot onto a target very close to the crosshair
  const A = assistStrength();
  if (A > 0) {
    const t = assistTarget(0.035 + 0.035 * A);
    if (t) {
      const head = t.r.headC;
      _d.subVectors(head, P.eye).normalize();
      const headA = Math.acos(clamp(_d.dot(_f), -1, 1));
      const pt = headA < 0.02 ? head : t.r.bodyC;
      _m.subVectors(pt, P.eye).normalize();
    }
  }
  const muzzle = vm.muzzleWorld(camera, _o);
  if (w.projectile) {
    _d.copy(_m);
    _d.x += rand(-spread, spread); _d.y += rand(-spread, spread); _d.z += rand(-spread, spread);
    _d.normalize();
    const start = P.eye.clone().addScaledVector(_d, 0.6);
    start.y -= 0.12;
    bubbleOrbs.add({ p: start, v: _d.clone().multiplyScalar(24).add(_v.set(P.vel.x * 0.3, 1.2, P.vel.z * 0.3)), life: 3, dmg: w.dmg * dmgMul(id), splash: w.splash, scale: 1, c: new THREE.Color(1, 1, 1) });
  } else {
    const n = w.pellets || 1;
    let anyHit = false, anyHead = false, anyKill = false;
    for (let i = 0; i < n; i++) {
      aimBasis(P.yaw, P.pitch + P.recoilP);
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * spread;
      _d.copy(_m).addScaledVector(_r, Math.cos(a) * rr).addScaledVector(_u, Math.sin(a) * rr).normalize();
      const res = hitscan(P.eye, _d, id);
      if (res.hit) anyHit = true;
      if (res.head) anyHead = true;
      if (res.kill) anyKill = true;
      const width = id === 'rail' ? 0.07 : id === 'scatter' ? 0.02 : 0.035;
      fx.tracers.add(muzzle, res.end, w.tracer, width, id === 'rail' ? 0.35 : 0.09);
    }
    if (anyHit) {
      G.hits++;
      hud.hitMarker(anyKill ? 'kill' : anyHead ? 'head' : '');
      audio.play(anyHead ? 'headshot' : 'hit');
    }
  }
  // recoil and juice
  P.recoilP += w.recoil * rand(0.85, 1.15);
  P.recoilY += rand(-1, 1) * w.recoil * 0.35;
  P.bloom += w.spreadShot;
  vm.fire(w);
  muzzleLight.color.setRGB(w.flash[0] / 3, w.flash[1] / 3, w.flash[2] / 3);
  muzzleLight.intensity = 6;
  muzzleLight.position.copy(muzzle);
  G.muzzleT = 0.05;
  audio.play(w.sound);
  G.trauma += id === 'scatter' || id === 'rail' ? 0.14 : id === 'bubble' ? 0.06 : 0.025;
  // robots nearby hear the shot
  for (const r of G.robots) {
    if (r.alive && !r.alert && r.pos.distanceTo(P.pos) < 24) { r.alert = true; r.lastSeen.copy(P.pos); r.lastSeenT = G.time; }
  }
}

// Instant-hit shot. Returns where the beam ends and what it hit.
function hitscan(o, d, id) {
  const w = WEAPONS[id];
  const wh = world.raycast(o, d, 200);
  let wallT = 200;
  if (wh) { wallT = wh.t; _hitN.set(wh.nx, wh.ny, wh.nz); }
  const hits = [];
  for (const r of G.robots) {
    const h = r.rayHit(o, d, wallT);
    if (h) hits.push({ r, t: h.t, head: h.head });
  }
  hits.sort((a, b) => a.t - b.t);
  const res = { hit: false, head: false, kill: false, end: new THREE.Vector3() };
  const list = w.pierce ? hits : hits.slice(0, 1);
  for (const h of list) {
    res.hit = true;
    if (h.head) res.head = true;
    const dmg = w.dmg * dmgMul(id) * (h.head ? w.head : 1);
    _v.copy(o).addScaledVector(d, h.t);
    fx.sparks.burst(_v, _w.copy(d).negate(), h.head ? 16 : 9, 6, h.head ? 0xffe14f : 0xffb347, { size: 0.07 });
    fx.sparks.burst(_v, _w.copy(d).negate(), 4, 3, 0x7cf0ff, { size: 0.1, grav: 2 });
    if (damageRobot(h.r, dmg, h.head, id, d)) res.kill = true;
  }
  if (list.length && !w.pierce) {
    res.end.copy(o).addScaledVector(d, list[0].t);
  } else {
    res.end.copy(o).addScaledVector(d, wallT);
    if (wh) {
      fx.sparks.burst(res.end, _hitN, id === 'scatter' ? 3 : 7, 4.5, w.tracer, { size: 0.06, life: 0.7 });
      fx.decals.add(res.end.x, res.end.y, res.end.z, _hitN.x, _hitN.y, _hitN.z, id === 'rail' ? 0.35 : id === 'scatter' ? 0.12 : 0.17);
      if (Math.random() < 0.5) audio.play('wallHit', { at: res.end, maxD: 25 });
    }
  }
  return res;
}

function damageRobot(r, amount, head, weaponId, dir) {
  const killed = r.damage(amount, head, dir, G);
  if (killed) onKill(r, head, weaponId, dir);
  return killed;
}

function onKill(r, head, weaponId, dir) {
  const t = r.t;
  G.kills++;
  if (head) G.headshots++;
  G.score += Math.round(t.score * G.diff.scoreMul * (head ? 1.5 : 1));
  const coins = t.coins + (head ? 40 : 0);
  G.coins += coins;
  hud.coinPop(`+${coins}`);
  hud.kill(WEAPONS[weaponId].name, t.name, head);
  if (head) hud.toast('爆头！');
  r.explode(G, dir || _v.set(0, 0, 0));
  audio.play('robotDie', { at: r.pos, maxD: 60 });
  G.hitStop = t.crown ? 0.4 : 0.07;
  G.trauma += t.crown ? 0.7 : 0.14;
  G.fovKick = t.crown ? 8 : 3;
  const i = G.robots.indexOf(r);
  if (i >= 0) G.robots.splice(i, 1);
  if (Math.random() < G.diff.drop || t.crown) {
    const kind = player.hp < player.maxHp * 0.5 ? 'health' : pick(['health', 'ammo', 'ammo', 'armor']);
    const g = world.support(r.pos.x, r.pos.z, 0.2, r.pos.y + 0.5);
    makePickup(kind, new THREE.Vector3(r.pos.x, g, r.pos.z), true);
  }
}

// ---------------------------------------------------------------- projectiles
function enemyShoot(origin, dir, speed, dmg, color, size) {
  enemyOrbs.add({ p: origin.clone(), v: dir.clone().multiplyScalar(speed), dmg, life: 6, c: new THREE.Color(color).multiplyScalar(2.6), scale: size, whiz: false, col: color });
}

function hurtPlayer(dmg, from) {
  const P = player;
  if (!P.alive || P.invuln > 0 || !(G.mode === 'play')) return;
  if (P.armor > 0) {
    const ab = Math.min(P.armor, dmg * 0.5);
    P.armor -= ab;
    dmg -= ab;
    audio.play('armorHit');
  }
  P.hp -= dmg;
  P.lastHurt = G.time;
  G.trauma += 0.22 + dmg * 0.01;
  hud.hurt(dmg);
  audio.play('hurt', { vol: 0.7 });
  if (from) {
    aimBasis(P.yaw, 0);
    _d.set(from.x - P.pos.x, 0, from.z - P.pos.z).normalize();
    hud.damageDir(Math.atan2(_d.dot(_r), _d.dot(_f)));
  }
  if (P.hp <= 0) playerDown();
}

function playerDown() {
  const P = player;
  P.hp = 0;
  P.alive = false;
  P.deadT = 0;
  P.reloading = false;
  G.lives--;
  input.fire = false;
  audio.play('gameOver', { vol: 0.6 });
  if (G.lives > 0) {
    G.respawnT = 3;
    hud.center(`你被击倒了！<small>还剩 ${G.lives} 次机会，马上回来</small>`, 3);
  } else {
    G.endT = 2.2;
    G.endWin = false;
    G.mode = 'ending';
    hud.center('你被击倒了！', 2.2);
  }
}

function respawn() {
  const P = player;
  P.pos.copy(world.playerSpawn);
  P.vel.set(0, 0, 0);
  P.hp = P.maxHp;
  P.alive = true;
  P.invuln = 2.5;
  P.yaw = 0; P.pitch = 0;
  enemyOrbs.list.length = 0;
  const s = weaponState(P.cur);
  if (s.mag === 0 && s.reserve > 0) { const take = Math.min(magSize(P.cur), s.reserve); s.mag = take; if (s.reserve !== Infinity) s.reserve -= take; }
  hud.toast('回到战场！');
  audio.play('spawn');
}

function updateProjectiles(dt) {
  const P = player;
  // robot shots
  const L = enemyOrbs.list;
  let w = 0;
  outer: for (let i = 0; i < L.length; i++) {
    const o = L[i];
    o.life -= dt;
    const steps = Math.max(1, Math.ceil((o.v.length() * dt) / 0.25));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      o.p.addScaledVector(o.v, sdt);
      if (P.alive) {
        const py = clamp(o.p.y, P.pos.y + 0.25, P.pos.y + P.height - 0.1);
        const dx = o.p.x - P.pos.x, dy = o.p.y - py, dz = o.p.z - P.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const rr = 0.36 + 0.12 * o.scale;
        if (d2 < rr * rr) {
          hurtPlayer(o.dmg, o.p);
          fx.sparks.burst(o.p, null, 12, 4, o.col, { size: 0.09 });
          continue outer;
        }
        if (!o.whiz && d2 < 2.0 * 2.0) { o.whiz = true; audio.play('whiz', { at: o.p, vol: 0.8 }); }
      }
      if (o.life <= 0 || world.solidAt(o.p.x, o.p.y, o.p.z)) {
        fx.sparks.burst(o.p, null, 8, 3.5, o.col, { size: 0.08, life: 0.7 });
        continue outer;
      }
    }
    L[w++] = o;
  }
  L.length = w;
  // bubbles
  const B = bubbleOrbs.list;
  w = 0;
  outerB: for (let i = 0; i < B.length; i++) {
    const o = B[i];
    o.life -= dt;
    o.v.y -= 4 * dt;
    o.scale = Math.min(1.25, o.scale + dt * 0.6);
    const steps = Math.max(1, Math.ceil((o.v.length() * dt) / 0.3));
    for (let s = 0; s < steps; s++) {
      o.p.addScaledVector(o.v, dt / steps);
      let hit = o.life <= 0 || world.solidAt(o.p.x, o.p.y, o.p.z);
      if (!hit) for (const r of G.robots) { if (r.alive && r.spawnT <= 0 && r.distTo(o.p) < 0.3) { hit = true; break; } }
      if (hit) { popBubble(o); continue outerB; }
    }
    B[w++] = o;
  }
  B.length = w;
}

function popBubble(o) {
  const p = o.p;
  // step back out of the wall a little so the splash is not blocked by it
  p.addScaledVector(_v.copy(o.v).normalize(), -0.25);
  fx.rings.add(p, 0xff8fd8, o.splash * 0.8, 0.35, 'sphere', 0.45);
  fx.rings.add(p, 0x7cf0ff, o.splash, 0.4, 'ring', 0.9);
  fx.sparks.burst(p, null, 40, 7, 0xff8fd8, { size: 0.12, grav: 3, life: 1 });
  fx.sparks.burst(p, null, 24, 5, 0x9ff6ff, { size: 0.1, grav: 2, life: 1.1 });
  audio.play('pop', { at: p });
  G.trauma += Math.max(0, 0.3 - p.distanceTo(player.eye) * 0.02);
  let hitAny = false, kill = false;
  for (const r of G.robots.slice()) {
    if (!r.alive || r.spawnT > 0) continue;
    const d = r.distTo(p);
    if (d > o.splash) continue;
    if (!world.los(p, r.bodyC) && d > 0.6) continue;
    const dmg = o.dmg * (1 - 0.6 * (d / o.splash));
    _d.subVectors(r.bodyC, p).setY(0).normalize();
    r.vel.addScaledVector(_d, 4);
    hitAny = true;
    if (damageRobot(r, dmg, false, 'bubble', _d)) kill = true;
  }
  if (hitAny) { G.hits++; hud.hitMarker(kill ? 'kill' : ''); audio.play('hit'); }
}

// ---------------------------------------------------------------- robots
const _bm = new THREE.Matrix4();
const _bq = new THREE.Quaternion();
const _bs = new THREE.Vector3();
function updateRobots(dt) {
  for (let i = G.robots.length - 1; i >= 0; i--) {
    const r = G.robots[i];
    r.update(dt, G);
    if (!r.t.fly && r.alive && player.alive) {
      const ph = Math.floor(r.phase / Math.PI);
      if (ph !== r._step) {
        r._step = ph;
        if (Math.hypot(r.vel.x, r.vel.z) > 1 && r.pos.distanceTo(player.pos) < 16) audio.play('botStep', { at: r.pos, maxD: 16, vol: r.t.scale });
      }
    }
  }
  // blob shadows
  let n = 0;
  for (const r of G.robots) {
    if (n >= 16) break;
    const g = world.support(r.pos.x, r.pos.z, 0.2, r.pos.y + 0.3);
    const lift = r.pos.y - g;
    const sz = r.t.r * 2.8 * (r.t.fly ? Math.max(0.4, 1 - lift * 0.15) : 1) * Math.min(1, r.root.scale.x / r.t.scale + 0.01);
    _bs.set(sz, 1, sz);
    _bm.compose(_v.set(r.pos.x, g + 0.02, r.pos.z), _bq, _bs);
    blobs.setMatrixAt(n++, _bm);
  }
  blobs.count = n;
  if (n) blobs.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- camera and HUD
function baseFov() {
  const a = camera.aspect;
  if (a < 1) return Math.min(100, (2 * Math.atan(Math.tan((35 * Math.PI) / 180) / a) * 180) / Math.PI);
  return a < 1.45 ? 74 : 70;
}

const shakeSeed = Math.random() * 100;
function updateCamera(dt) {
  const P = player;
  G.trauma = Math.max(0, Math.min(1, G.trauma) - dt * 1.7);
  G.fovKick = damp(G.fovKick, 0, 6, dt);
  P.recoilP = damp(P.recoilP, 0, 4.5, dt);
  P.recoilY = damp(P.recoilY, 0, 6, dt);
  const sh = G.trauma * G.trauma;
  const t = G.time * 30 + shakeSeed;
  const sx = (Math.sin(t * 1.3) + Math.sin(t * 2.7)) * 0.5;
  const sy = (Math.sin(t * 1.7 + 1) + Math.sin(t * 3.1)) * 0.5;
  updateEye();
  camera.position.copy(P.eye);
  let roll = sx * sh * 0.04;
  if (!P.alive) {
    P.deadT += dt;
    const k = Math.min(1, P.deadT / 0.6);
    camera.position.y = P.pos.y + P.eyeH * (1 - k * 0.7);
    roll += k * 0.45;
  }
  camera.position.x += sx * sh * 0.08;
  camera.position.y += sy * sh * 0.06;
  camera.rotation.set(P.pitch + P.recoilP + sy * sh * 0.03, P.yaw + P.recoilY + sx * sh * 0.03, roll);
  const scoped = isScoped();
  let fov = baseFov();
  if (scoped) fov = 24;
  else if (input.aim && input.active) fov *= 0.85;
  fov += G.fovKick;
  camera.fov = damp(camera.fov, fov, scoped ? 25 : 14, dt);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const vfov = camera.aspect < 1 ? Math.min(95, (2 * Math.atan(Math.tan((33 * Math.PI) / 180) / camera.aspect) * 180) / Math.PI) : 60;
  if (Math.abs(vm.camera.fov - vfov) > 0.01) { vm.camera.fov = vfov; vm.camera.updateProjectionMatrix(); }
  audio.listener = { pos: P.pos, yaw: P.yaw };
  if (G.muzzleT > 0) { G.muzzleT -= dt; if (G.muzzleT <= 0) muzzleLight.intensity = 0; }
}

function titleCamera(dt) {
  const a = performance.now() * 0.00005;
  camera.position.set(Math.sin(a) * 24, 10, Math.cos(a) * 26);
  camera.fov = baseFov();
  camera.updateProjectionMatrix();
  camera.lookAt(0, 1.5, 0);
  camera.updateMatrixWorld();
}

function hudState(lookD) {
  const P = player, id = P.cur, w = WEAPONS[id], s = weaponState(id);
  let timerText, timerCls = '';
  if (G.mode === 'buy') { timerText = `准备 ${fmtTime(G.buyT)}`; timerCls = 'buy'; }
  else if (G.countdown > 0) timerText = fmtTime(G.waveTimer);
  else if (G.overtime || G.waveTimer <= 0) { timerText = '超时'; timerCls = 'warn'; }
  else { timerText = fmtTime(G.waveTimer); if (G.waveTimer < 15) timerCls = 'warn'; }
  const spread = currentSpread(w);
  const H = window.innerHeight;
  const gap = 3 + (Math.tan(spread) / Math.tan((camera.fov * Math.PI) / 360)) * (H / 2);
  let hint = '';
  if (G.mode === 'buy' && !G.shopOpen) hint = input.touchMode ? '点「商店」买装备，点「开始下一波」出发' : '按 B 打开商店 · 按 回车 开始下一波';
  else if (G.mode === 'play' && P.alive && s.mag === 0 && s.reserve === 0) hint = input.touchMode ? '没有弹药了！点「换枪」' : '没有弹药了！按数字键换枪';
  else if (!input.touchMode && !input.locked && P.alive && (G.mode === 'play' || G.mode === 'buy') && input.hadLock) hint = '点击画面继续瞄准';
  const owned = WEAPON_ORDER.map((wid, i) => [wid, i]).filter(([wid]) => weaponState(wid).owned);
  const slotsHtml = owned.map(([wid, i]) => {
    const lv = weaponState(wid).level;
    return `<div class="slot${wid === id ? ' on' : ''}" data-slot="${i}"><b>${i + 1}</b>${WEAPONS[wid].short}${lv > 1 ? `<span class="lv">+${lv - 1}</span>` : ''}</div>`;
  }).join('');
  let livesHtml = '';
  if (G.diff.lives > 1) for (let i = 0; i < G.diff.lives; i++) livesHtml += `<span class="life${i < G.lives ? '' : ' off'}"></span>`;
  const boss = G.robots.find((r) => r.t.crown && r.alive);
  return {
    wave: Math.min(TOTAL_WAVES, G.mode === 'buy' ? G.wave + 1 : Math.max(1, G.wave)), totalWaves: TOTAL_WAVES,
    timerText, timerCls, leftText: `剩余 ${G.robots.length + G.queue.length}`,
    score: G.score, coins: G.coins, hp: Math.max(0, P.hp), maxHp: P.maxHp, armor: P.armor, livesHtml,
    wname: w.name, mag: s.mag, reserve: s.reserve, reloadK: P.reloading ? 1 - P.reloadT / w.reload : -1,
    slotsHtml, hint, gap, onTarget: !!assistCache && assistCache.a < 0.04, scoped: isScoped(), alive: P.alive,
    playing: G.mode === 'play', bossK: boss ? boss.hp / boss.maxHp : -1,
  };
}

function applyTouchMode() {
  document.body.classList.toggle('touch', input.touchMode);
  const playing = (G.mode === 'play' || G.mode === 'buy') && !G.paused && !G.shopOpen;
  show($('touch'), input.touchMode && playing);
  $('tb-shop').classList.toggle('tb-hide', G.mode !== 'buy');
  $('tb-go').classList.toggle('tb-hide', G.mode !== 'buy');
  $('tb-aim').classList.toggle('tb-hide', player.cur !== 'rail' && player.cur !== 'rifle');
}

// ---------------------------------------------------------------- main loop
let last = performance.now();
let perfAcc = 0, perfN = 0;
const stats = { fps: 0, calls: 0, tris: 0 };
let fpsAcc = 0, fpsN = 0;

function step(dt) {
  if (G.mode === 'title') {
    G.time += dt;
    updateRobots(dt);
    fx.sparks.update(dt, world);
    fx.rings.update(dt);
    titleCamera(dt);
    vm.holder.visible = false;
    return;
  }
  if (G.mode === 'over') {
    G.time += dt;
    fx.sparks.update(dt, world); fx.debris.update(dt, world); fx.chunks.update(dt, world); fx.tracers.update(dt); fx.rings.update(dt);
    updateCamera(dt);
    return;
  }
  if (G.paused) { updateCamera(0); return; }
  let sdt = dt;
  if (G.hitStop > 0) { G.hitStop -= dt; sdt = dt * 0.08; }
  G.time += sdt;
  const look = updateLook(dt);
  updatePlayer(sdt);
  updateWeapon(sdt);
  updateRobots(sdt);
  updateProjectiles(sdt);
  updatePickups(sdt);
  // wave flow
  if (G.mode === 'buy') {
    G.buyT -= sdt;
    if (G.shopAutoT > 0) { G.shopAutoT -= sdt; if (G.shopAutoT <= 0 && !G.shopOpen) openShop(); }
    if (G.shopOpen) $('shop-time').textContent = `${fmtTime(G.buyT)} 后自动开始`;
    if (G.buyT <= 0) startWave();
  } else if (G.mode === 'play') {
    if (G.countdown > 0) {
      const prev = Math.ceil(G.countdown);
      G.countdown -= sdt;
      const now = Math.ceil(G.countdown);
      if (G.countdown <= 0) { hud.center('出击！', 0.9); audio.play('go'); }
      else if (now !== prev) { hud.center(String(now), 0.9); audio.play('countdown'); }
    } else {
      G.waveTimer -= sdt;
      if (G.waveTimer <= 0 && !G.overtime && G.diff.overtime) { G.overtime = true; hud.center('超时！<small>机器人变得更快了</small>', 2.5); audio.play('warn'); }
      G.spawnT -= sdt;
      if (G.queue.length && G.robots.length < G.maxAlive && G.spawnT <= 0) {
        spawnRobot(G.queue.shift());
        G.spawnT = rand(1.1, 2.2) * (G.wave === 1 ? 1.4 : 1);
      }
      if (!G.queue.length && !G.robots.length && !G.waveDone) waveCleared();
    }
  }
  if (G.respawnT > 0) { G.respawnT -= sdt; if (G.respawnT <= 0) respawn(); }
  if (G.mode === 'ending') { G.endT -= dt; if (G.endT <= 0) endGame(G.endWin); }
  fx.sparks.update(sdt, world);
  fx.debris.update(sdt, world);
  fx.chunks.update(sdt, world);
  fx.tracers.update(sdt);
  fx.rings.update(sdt);
  enemyOrbs.sync();
  bubbleOrbs.sync();
  updateCamera(sdt);
  vm.update(dt, {
    speed: Math.hypot(player.vel.x, player.vel.z), grounded: player.grounded, lookDX: look.dx, lookDY: look.dy,
    reload: player.reloading ? 1 - player.reloadT / WEAPONS[player.cur].reload : 0, aim: input.aim && input.active && player.cur !== 'bubble',
    hide: isScoped() || !player.alive,
  });
  hud.update(hudState(look));
  hud.tick(dt);
}

function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.min(0.05, Math.max(0, raw));
  try {
    step(dt);
  } catch (e) {
    console.error(e);
  }
  fx.sparks.setScale((window.innerHeight * pixelRatio) / (2 * Math.tan((camera.fov * Math.PI) / 360)));
  renderer.info.reset();
  composer.render(dt);
  stats.calls = renderer.info.render.calls;
  stats.tris = renderer.info.render.triangles;
  fpsAcc += raw; fpsN++;
  if (fpsAcc > 1) { stats.fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  perfCheck(raw);
}

// Lower the resolution if the device cannot keep up.
function perfCheck(raw) {
  if (G.mode !== 'play' || G.paused || raw > 0.25) { perfAcc = 0; perfN = 0; return; }
  perfAcc += raw;
  perfN++;
  if (perfN < 120) return;
  const avg = perfAcc / perfN;
  perfAcc = 0; perfN = 0;
  if (avg > 1 / 45 && pixelRatio > 0.8) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); resize(); }
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = baseFov();
  camera.updateProjectionMatrix();
  vm.camera.aspect = w / h;
  vm.camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- wiring
input.on.pause = () => {
  if (G.shopOpen) closeShop();
  else if (G.paused) { if (performance.now() - G.pauseTime > 400) resume(); }
  else pause();
};
input.on.mute = () => toggleMute();
input.on.shop = () => {
  if (G.paused || G.mode === 'title' || G.mode === 'over') return;
  if (G.shopOpen) closeShop();
  else if (G.mode === 'buy') openShop();
  else hud.toast('商店只在两波之间开放');
};
input.on.enter = () => { if (G.mode === 'buy' && !G.paused) { startWave(); lock(); } };
input.on.reload = () => startReload();
input.on.quick = () => switchWeapon(player.last);
input.on.slot = (i) => { const id = WEAPON_ORDER[i]; if (id) switchWeapon(id); };
input.on.cycle = (d) => cycleWeapon(d);
input.on.wantLock = () => lock();
input.on.lockLost = () => {
  if ((G.mode === 'play' || G.mode === 'buy') && !G.paused && !G.shopOpen && !input.touchMode) pause();
};
input.on.touchMode = () => applyTouchMode();
input.on.touchAny = () => audio.init();
$('slots').addEventListener('touchstart', (e) => {
  const el = e.target.closest('[data-slot]');
  if (el) { e.preventDefault(); input.emit('slot', parseInt(el.dataset.slot, 10)); }
}, { passive: false });

function toggleMute() {
  audio.init();
  audio.setMuted(!audio.muted);
  $('btn-mute').classList.toggle('muted', audio.muted);
}
$('btn-mute').classList.toggle('muted', audio.muted);

const click = (id, fn) => $(id).addEventListener('click', (e) => { audio.init(); audio.play('click'); fn(); e.currentTarget.blur(); });
click('btn-start', () => startGame(settings.diff));
click('btn-again', () => startGame(settings.diff));
click('btn-menu', toTitle);
click('btn-resume', resume);
click('btn-restart', () => startGame(settings.diff));
click('btn-quit', toTitle);
click('btn-pause', () => (G.paused ? resume() : pause()));
click('btn-mute', toggleMute);
click('btn-shop-close', () => closeShop());
click('btn-next', () => { startWave(); lock(); });
document.querySelectorAll('#diff button').forEach((b) => b.addEventListener('click', () => {
  audio.init();
  audio.play('click');
  settings.diff = b.dataset.diff;
  store.set('roboStrike.diff', settings.diff);
  updateTitle();
}));
$('opt-music').addEventListener('change', (e) => { audio.init(); audio.setMusic(e.target.checked); });
$('opt-sound').addEventListener('change', (e) => { audio.init(); audio.setMuted(!e.target.checked); $('btn-mute').classList.toggle('muted', audio.muted); });
$('opt-sens').addEventListener('input', (e) => { settings.sens = parseFloat(e.target.value) || 1; store.set('roboStrike.sens', settings.sens); });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pause(); audio.suspend(); } else audio.resume();
});
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 300));

// keep touch layout in sync with the mode
let lastLayout = '';
setInterval(() => {
  const k = [input.touchMode, G.mode, G.paused, G.shopOpen, player.cur].join();
  if (k !== lastLayout) { lastLayout = k; applyTouchMode(); }
}, 100);

// ---------------------------------------------------------------- debug hook for automated tests
window.__game = {
  get G() { return G; },
  get player() { return player; },
  state() {
    const s = weaponState(player.cur);
    return {
      mode: G.mode, paused: G.paused, shopOpen: G.shopOpen, wave: G.wave, buyT: +G.buyT.toFixed(1), countdown: +G.countdown.toFixed(1),
      waveTimer: +G.waveTimer.toFixed(1), robots: G.robots.length, queue: G.queue.length, kills: G.kills, score: G.score, coins: G.coins,
      hp: Math.round(player.hp), armor: Math.round(player.armor), alive: player.alive, lives: G.lives, weapon: player.cur, mag: s.mag, reserve: s.reserve,
      pos: [+player.pos.x.toFixed(2), +player.pos.y.toFixed(2), +player.pos.z.toFixed(2)], yaw: +player.yaw.toFixed(3), pitch: +player.pitch.toFixed(3),
      shots: G.shots, hits: G.hits, headshots: G.headshots, orbs: enemyOrbs.list.length, fps: stats.fps, calls: stats.calls, tris: stats.tris,
      touch: input.touchMode, nodes: world.nodes.length, pixelRatio,
    };
  },
  start: (d) => startGame(d || 'normal'),
  move(x, y) { input.debug.active = true; input.debug.x = x; input.debug.y = y; },
  stop() { input.debug.active = false; input.debug.x = 0; input.debug.y = 0; },
  look(yaw, pitch) { player.yaw = yaw; player.pitch = pitch; },
  jump() { input.jumpQueued = true; },
  fire(on) { input.fire = !!on; },
  // point the camera at the nearest robot's body (or head)
  aimAt(head) {
    const P = player;
    let best = null, bd = Infinity;
    for (const r of G.robots) { if (!r.alive || r.spawnT > 0) continue; const d = r.pos.distanceTo(P.pos); if (d < bd) { bd = d; best = r; } }
    if (!best) return null;
    updateEye();
    const pt = head ? best.headC : best.bodyC;
    _d.subVectors(pt, P.eye);
    P.yaw = Math.atan2(-_d.x, -_d.z);
    P.pitch = Math.atan2(_d.y, Math.hypot(_d.x, _d.z));
    P.recoilP = 0;
    return { kind: best.kind, dist: +bd.toFixed(1), visible: world.los(P.eye, pt) };
  },
  teleportNear(dist = 7) {
    const r = G.robots.find((x) => x.alive && x.spawnT <= 0);
    if (!r) return false;
    for (let a = 0; a < Math.PI * 2; a += 0.4) {
      const x = r.pos.x + Math.sin(a) * dist, z = r.pos.z + Math.cos(a) * dist;
      if (Math.abs(x) > 29 || Math.abs(z) > 33) continue;
      const y = world.support(x, z, 0.4, 3);
      if (world.blockedAt(x, z, 0.4, y + 0.3, y + 1.8)) continue;
      player.pos.set(x, y, z);
      updateEye();
      if (world.los(player.eye, r.bodyC)) return true;
    }
    return false;
  },
  hurt(n) { hurtPlayer(n, null); },
  coins(n) { G.coins += n; },
  openShop, closeShop, buy, startWave,
  killAll() { for (const r of G.robots.slice()) damageRobot(r, 99999, false, 'rifle', new THREE.Vector3(0, 0, -1)); G.queue.length = 0; },
  slot(i) { input.emit('slot', i); },
  reload() { startReload(); },
  pause, resume,
  setTouch(on) { input.setTouchMode(on); },
};

// ---------------------------------------------------------------- go
resize();
resetPlayer();
toTitle();
$('loading').remove();
requestAnimationFrame(frame);
