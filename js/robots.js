import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeColored as merge } from './geo.js';
import { eyeTexture } from './textures.js';
import { rand, randInt, wrapAngle, raySphere, rayCylinder, clamp } from './util.js';

export const ROBOTS = {
  walker: {
    name: '巡逻机器人', hp: 100, speed: 3.3, scale: 1, r: 0.45, h: 1.85, eyeY: 1.6,
    head: { y: 1.62, r: 0.31 }, body: { y0: 0.05, y1: 1.42, r: 0.47 },
    burst: [2, 3], gap: 0.32, pause: [1.5, 2.6], dmg: 8, projSpeed: 1, shotColor: 0xff7a2f, shotSize: 1,
    prefer: [7, 15], cover: true, score: 100, coins: 120,
    colors: { main: 0x5ec8ff, accent: 0xffd04a, dark: 0x3a4560, glow: [0.4, 2.6, 3.0] },
  },
  drone: {
    name: '侦察无人机', hp: 55, speed: 4.6, scale: 1, r: 0.5, h: 0.9, eyeY: 0.45, fly: true, hover: 2.1,
    burst: [1, 2], gap: 0.25, pause: [1.1, 2.0], dmg: 6, projSpeed: 1.15, shotColor: 0xff4fd8, shotSize: 0.85,
    prefer: [6, 13], cover: false, score: 150, coins: 160,
    colors: { main: 0xff8fc8, accent: 0x7cf0d0, dark: 0x3a4560, glow: [0.6, 3.0, 2.2] },
  },
  heavy: {
    name: '重装机器人', hp: 320, speed: 2.3, scale: 1.3, r: 0.6, h: 2.4, eyeY: 1.6,
    head: { y: 1.62, r: 0.28 }, body: { y0: 0.05, y1: 1.45, r: 0.55 },
    burst: [4, 6], gap: 0.2, pause: [2.0, 3.0], dmg: 9, projSpeed: 0.85, shotColor: 0xff5533, shotSize: 1.15,
    prefer: [6, 12], cover: true, score: 300, coins: 320, heavyBuild: true,
    colors: { main: 0xff9a3c, accent: 0x5c6cff, dark: 0x2f3548, glow: [3.0, 1.6, 0.4] },
  },
  boss: {
    name: '巨无霸机甲', hp: 2400, speed: 2.0, scale: 2.0, r: 0.95, h: 3.7, eyeY: 1.6,
    head: { y: 1.62, r: 0.3 }, body: { y0: 0.05, y1: 1.45, r: 0.55 },
    burst: [3, 4], gap: 0.45, pause: [1.5, 2.3], dmg: 11, volley: 5, projSpeed: 0.8, shotColor: 0xb04fff, shotSize: 1.7,
    prefer: [8, 18], cover: false, score: 2500, coins: 1200, heavyBuild: true, crown: true,
    colors: { main: 0xa77bff, accent: 0xffd04a, dark: 0x2a2440, glow: [2.6, 0.6, 3.2] },
  },
};

// ---------------------------------------------------------------- shared assets
const cache = {};
let eyeMats = null;

function eyes() {
  if (eyeMats) return eyeMats;
  const mk = (kind, drone) => new THREE.MeshBasicMaterial({ map: eyeTexture(kind, drone), color: new THREE.Color(1.8, 1.8, 1.8) });
  eyeMats = {
    walker: { idle: mk('idle'), alert: mk('alert'), hit: mk('hit') },
    drone: { idle: mk('idle', true), alert: mk('alert', true), hit: mk('hit', true) },
  };
  return eyeMats;
}

const RB = (w, h, d, r = 0.08) => new RoundedBoxGeometry(w, h, d, 2, r);
const CYL = (r0, r1, h, n = 12) => new THREE.CylinderGeometry(r0, r1, h, n);
const SPH = (r) => new THREE.SphereGeometry(r, 14, 10);

function walkerGeos(key, t) {
  if (cache[key]) return cache[key];
  const { main, accent, dark, glow } = t.colors;
  const hv = !!t.heavyBuild;
  const G = {};
  G.pelvis = merge([{ g: RB(0.58, 0.22, 0.36, 0.06), c: dark }]);
  const leg = [
    { g: RB(hv ? 0.26 : 0.2, 0.56, hv ? 0.28 : 0.24, 0.07), c: main, p: [0, -0.3, 0] },
    { g: RB(hv ? 0.34 : 0.28, 0.13, 0.4, 0.05), c: dark, p: [0, -0.66, 0.05] },
    { g: SPH(0.1), c: dark, p: [0, -0.02, 0] },
  ];
  G.leg = merge(leg);
  const torso = [
    { g: RB(hv ? 0.92 : 0.78, 0.62, hv ? 0.6 : 0.5, 0.13), c: main },
    { g: RB(0.5, 0.2, 0.05, 0.03), c: accent, p: [0, -0.12, hv ? 0.3 : 0.25] },
    { g: CYL(0.16, 0.16, 0.12, 14), c: dark, p: [0, 0.34, 0] },
  ];
  if (hv) {
    torso.push({ g: RB(0.3, 0.42, 0.3, 0.06), c: dark, p: [0, 0.05, -0.38] });
  }
  G.torso = merge(torso);
  G.chest = merge([{ g: CYL(0.085, 0.085, 0.04, 16), c: glow, p: [0, 0.12, hv ? 0.31 : 0.26], r: [Math.PI / 2, 0, 0] }]);
  const arm = [
    { g: SPH(0.12), c: dark },
    { g: RB(0.18, 0.46, 0.18, 0.07), c: main, p: [0, -0.26, 0] },
    { g: SPH(0.12), c: accent, p: [0, -0.52, 0] },
  ];
  if (hv) arm.push({ g: RB(0.36, 0.2, 0.42, 0.07), c: accent, p: [0, 0.06, 0] });
  G.armL = merge(arm);
  G.armR = merge([
    ...arm,
    { g: CYL(0.075, 0.095, 0.5, 12), c: dark, p: [0, -0.68, 0.02] },
    { g: CYL(0.1, 0.1, 0.06, 12), c: accent, p: [0, -0.9, 0.02] },
  ]);
  if (hv) {
    G.armL = merge([
      ...arm,
      { g: CYL(0.075, 0.095, 0.5, 12), c: dark, p: [0, -0.68, 0.02] },
      { g: CYL(0.1, 0.1, 0.06, 12), c: accent, p: [0, -0.9, 0.02] },
    ]);
  }
  const head = [
    { g: RB(0.56, 0.44, 0.48, 0.14), c: main },
    { g: CYL(0.09, 0.09, 0.06, 12), c: accent, p: [0.3, 0, 0], r: [0, 0, Math.PI / 2] },
    { g: CYL(0.09, 0.09, 0.06, 12), c: accent, p: [-0.3, 0, 0], r: [0, 0, Math.PI / 2] },
    { g: CYL(0.015, 0.015, 0.24, 6), c: dark, p: [0, 0.32, 0] },
    { g: SPH(0.055), c: accent, p: [0, 0.46, 0] },
  ];
  if (t.crown) {
    for (const x of [-0.17, 0, 0.17]) head.push({ g: new THREE.ConeGeometry(0.07, 0.24, 8), c: accent, p: [x, 0.32 + (x === 0 ? 0.05 : 0), -0.05] });
  }
  G.head = merge(head);
  G.visor = new THREE.PlaneGeometry(0.44, 0.25);
  cache[key] = G;
  return G;
}

function droneGeos(t) {
  if (cache.drone) return cache.drone;
  const { main, accent, dark } = t.colors;
  const G = {};
  G.body = merge([
    { g: new THREE.SphereGeometry(0.45, 18, 12), c: main, s: [1, 0.86, 1] },
    { g: new THREE.TorusGeometry(0.47, 0.05, 6, 24), c: accent, r: [Math.PI / 2, 0, 0] },
    { g: RB(1.3, 0.08, 0.14, 0.03), c: dark, p: [0, 0.12, 0] },
    { g: CYL(0.06, 0.08, 0.3, 10), c: dark, p: [0, -0.4, 0.12], r: [Math.PI / 2.4, 0, 0] },
    { g: CYL(0.012, 0.012, 0.24, 6), c: dark, p: [0, 0.48, 0] },
    { g: SPH(0.05), c: accent, p: [0, 0.6, 0] },
  ]);
  G.rotor = merge([
    { g: CYL(0.05, 0.05, 0.1, 8), c: dark },
    { g: RB(0.62, 0.02, 0.09, 0.01), c: accent, p: [0, 0.05, 0] },
    { g: RB(0.09, 0.02, 0.62, 0.01), c: accent, p: [0, 0.05, 0] },
  ]);
  G.eye = new THREE.CircleGeometry(0.27, 24);
  cache.drone = G;
  return G;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _t = new THREE.Vector3();

let ROBOT_ID = 0;

export class Robot {
  constructor(kind, pos, game) {
    this.id = ++ROBOT_ID;
    this.kind = kind;
    this.t = ROBOTS[kind];
    const t = this.t;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15, emissive: 0xffffff, emissiveIntensity: 0 });
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.root = new THREE.Group();
    this.parts = {};
    if (t.fly) this.buildDrone(); else this.buildWalker();
    this.pos = this.root.position;
    this.pos.copy(pos);
    if (t.fly) this.pos.y = pos.y + t.hover;
    this.vel = new THREE.Vector3();
    this.body = { pos: this.pos, vel: this.vel, r: t.r, h: t.fly ? 0.9 : t.h, step: t.fly ? 0 : 0.45, grounded: true, hitWall: false };
    const waveScale = 1 + 0.07 * (game.wave - 1);
    this.maxHp = Math.round(t.hp * game.diff.hpMul * waveScale);
    this.hp = this.maxHp;
    this.alive = true;
    this.spawnT = 0.55;
    this.yaw = Math.atan2(game.player.pos.x - pos.x, game.player.pos.z - pos.z);
    this.root.rotation.y = this.yaw;
    this.state = 'patrol';
    this.alert = false;
    this.sees = false;
    this.think = rand(0, 0.2);
    this.react = 0;
    this.lastSeen = new THREE.Vector3();
    this.lastSeenT = -99;
    this.path = null;
    this.pi = 0;
    this.repathT = 0;
    this.strafeDir = 1;
    this.strafeT = 0;
    this.shotT = rand(0.8, 1.6);
    this.burstLeft = 0;
    this.coverWait = 0;
    this.usedCover = false;
    this.wantCover = false;
    this.stuckT = 0;
    this.lastPos = this.pos.clone();
    this.phase = rand(0, 6);
    this.flash = 0;
    this.eyeState = 'idle';
    this.eyeT = 0;
    this.crouch = 0;
    this.recoil = 0;
    this.eye = new THREE.Vector3();
    this._np = new THREE.Vector3();
    this.headC = new THREE.Vector3();
    this.bodyC = new THREE.Vector3();
    this.root.scale.setScalar(0.01);
    game.scene.add(this.root);
  }

  buildWalker() {
    const t = this.t;
    const G = walkerGeos(this.kind, t);
    const M = this.mat;
    const P = this.parts;
    const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    const hv = !!t.heavyBuild;
    P.pelvis = add(this.root, G.pelvis, M, 0, 0.74, 0);
    P.legL = add(this.root, G.leg, M, -0.17, 0.74, 0);
    P.legR = add(this.root, G.leg, M, 0.17, 0.74, 0);
    P.torso = new THREE.Group();
    P.torso.position.set(0, 1.08, 0);
    this.root.add(P.torso);
    P.torsoMesh = add(P.torso, G.torso, M);
    add(P.torso, G.chest, this.glowMat);
    const ax = hv ? 0.6 : 0.5;
    P.armL = add(P.torso, G.armL, M, -ax, 0.18, 0);
    P.armR = add(P.torso, G.armR, M, ax, 0.18, 0);
    P.muzzle = new THREE.Object3D();
    P.muzzle.position.set(0, -0.95, 0.02);
    P.armR.add(P.muzzle);
    if (hv) {
      P.muzzle2 = new THREE.Object3D();
      P.muzzle2.position.set(0, -0.95, 0.02);
      P.armL.add(P.muzzle2);
    }
    P.head = new THREE.Group();
    P.head.position.set(0, 0.54, 0);
    P.torso.add(P.head);
    add(P.head, G.head, M);
    const em = eyes().walker;
    P.visor = add(P.head, G.visor, em.idle, 0, 0.0, 0.245);
    this.eyeMats = em;
  }

  buildDrone() {
    const G = droneGeos(this.t);
    const P = this.parts;
    P.torso = new THREE.Group();
    P.torso.position.y = 0.45;
    this.root.add(P.torso);
    P.bodyMesh = new THREE.Mesh(G.body, this.mat);
    P.torso.add(P.bodyMesh);
    P.rotors = [];
    for (const x of [-0.68, 0.68]) {
      const r = new THREE.Mesh(G.rotor, this.mat);
      r.position.set(x, 0.18, 0);
      P.torso.add(r);
      P.rotors.push(r);
    }
    const em = eyes().drone;
    P.visor = new THREE.Mesh(G.eye, em.idle);
    P.visor.position.set(0, 0.02, 0.4);
    P.torso.add(P.visor);
    P.muzzle = new THREE.Object3D();
    P.muzzle.position.set(0, -0.48, 0.3);
    P.torso.add(P.muzzle);
    P.head = P.visor;
    this.eyeMats = em;
  }

  navPos() {
    if (!this.t.fly) return this.pos;
    return this._np.set(this.pos.x, this.pos.y - this.t.hover, this.pos.z);
  }

  setEyes(kind, time = 0) {
    if (this.eyeState === kind && !time) return;
    this.eyeState = kind;
    this.eyeT = time;
    this.parts.visor.material = this.eyeMats[kind];
  }

  // Hit volumes in world space.
  updateVolumes() {
    const t = this.t, s = t.scale, p = this.pos;
    const cy = 1 - this.crouch * 0.18;
    if (t.fly) {
      this.bodyC.set(p.x, p.y + 0.45, p.z);
      this.headC.set(p.x + Math.sin(this.yaw) * 0.3, p.y + 0.47, p.z + Math.cos(this.yaw) * 0.3);
      this.eye.copy(this.bodyC);
    } else {
      this.headC.set(p.x, p.y + t.head.y * s * cy, p.z);
      this.eye.set(p.x, p.y + t.eyeY * s * cy, p.z);
      this.bodyC.set(p.x, p.y + (t.body.y0 + t.body.y1) * 0.5 * s * cy, p.z);
    }
  }

  // Returns { t, head } or null.
  rayHit(o, d, maxT) {
    if (!this.alive || this.spawnT > 0.2) return null;
    const t = this.t, s = t.scale, p = this.pos;
    if (t.fly) {
      const tb = raySphere(o, d, this.bodyC, 0.55, maxT);
      const th = raySphere(o, d, this.headC, 0.25, maxT);
      if (th >= 0 && (tb < 0 || th < tb + 0.25)) return { t: th, head: true };
      if (tb >= 0) return { t: tb, head: false };
      return null;
    }
    const cy = 1 - this.crouch * 0.18;
    const th = raySphere(o, d, this.headC, t.head.r * s, maxT);
    const tb = rayCylinder(o, d, p.x, p.z, t.body.r * s, p.y + t.body.y0 * s, p.y + t.body.y1 * s * cy, maxT);
    if (th >= 0 && (tb < 0 || th <= tb + 0.05)) return { t: th, head: true };
    if (tb >= 0) return { t: tb, head: false };
    return null;
  }

  // Distance from a point to this robot's body (for splash and bubbles).
  distTo(pt) {
    const dy = pt.y - this.bodyC.y;
    const half = this.t.fly ? 0.3 : (this.t.body.y1 - this.t.body.y0) * 0.5 * this.t.scale;
    const ey = Math.max(0, Math.abs(dy) - half);
    const dx = pt.x - this.pos.x, dz = pt.z - this.pos.z;
    const rr = this.t.fly ? 0.55 : this.t.body.r * this.t.scale;
    return Math.max(0, Math.hypot(Math.hypot(dx, dz) - rr * 0.6, ey) - rr * 0.4);
  }

  damage(amount, head, dir, game) {
    if (!this.alive) return false;
    this.hp -= amount;
    this.flash = 1;
    this.setEyes('hit', 0.25);
    this.alert = true;
    if (this.state === 'patrol') { this.state = 'hunt'; this.path = null; }
    this.lastSeen.copy(game.player.pos);
    this.lastSeenT = game.time;
    if (dir && !this.t.crown) {
      const k = this.t.fly ? 2.2 : 1.2;
      this.vel.x += dir.x * k; this.vel.z += dir.z * k;
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      return true;
    }
    if (this.t.cover && !this.usedCover && this.hp < this.maxHp * 0.45) this.wantCover = true;
    return false;
  }

  // Break into pieces.
  explode(game, dir) {
    const fx = game.fx;
    const s = this.t.scale;
    this.root.updateMatrixWorld(true);
    const parts = this.t.fly ? [this.parts.torso] : [this.parts.head, this.parts.armL, this.parts.armR, this.parts.legL, this.parts.legR, this.parts.pelvis, this.parts.torsoMesh];
    if (this.t.fly) this.parts.rotors.forEach((r) => parts.push(r));
    for (const p of parts) {
      const v = new THREE.Vector3(rand(-3, 3) + dir.x * 4, rand(3, 7.5), rand(-3, 3) + dir.z * 4);
      if (p === this.parts.head) v.y += 3;
      fx.chunks.add(p, v, new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)), rand(2.2, 3));
    }
    game.scene.remove(this.root);
    const c = this.bodyC;
    fx.debris.spawn(c, this.t.colors.main, Math.round(14 * Math.min(2.5, s)), Math.min(1.6, s));
    fx.sparks.burst(c, null, Math.round(55 * Math.min(2, s)), 9 * Math.min(1.5, s), 0xffc83d, { size: 0.09, life: 1.2 });
    fx.sparks.burst(c, null, 20, 5, 0x6ff3ff, { size: 0.12, life: 1.0, grav: 4 });
    fx.rings.add(c, 0xffe08a, 1.1 * s, 0.25, 'sphere', 0.32);
    fx.rings.add(c, 0x7cf0ff, 2.6 * s, 0.45, 'ring', 0.9);
  }

  update(dt, g) {
    const t = this.t;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 7);
    this.mat.emissiveIntensity = this.flash * 0.9;
    if (this.eyeT > 0) {
      this.eyeT -= dt;
      if (this.eyeT <= 0) this.setEyes(this.alert ? 'alert' : 'idle');
    }
    if (this.spawnT > 0) {
      this.spawnT -= dt;
      const k = clamp(1 - this.spawnT / 0.55, 0, 1);
      const c1 = 1.70158, c3 = c1 + 1;
      const e = 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
      this.root.scale.setScalar(Math.max(0.01, t.scale * e));
      this.updateVolumes();
      return;
    }
    this.root.scale.set(t.scale, t.scale * (1 - this.crouch * 0.18), t.scale);
    const P = g.player;
    const p = this.pos;
    this.updateVolumes();
    const dx = P.pos.x - p.x, dz = P.pos.z - p.z;
    const dist = Math.hypot(dx, dz) || 0.001;

    // perception
    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.12 + Math.random() * 0.1;
      let sees = false;
      if (P.alive && dist < 50) {
        const fwd = (Math.sin(this.yaw) * dx + Math.cos(this.yaw) * dz) / dist;
        if (this.alert || dist < 8 || fwd > 0.3) sees = g.world.los(this.eye, P.eye);
      }
      if (sees && !this.sees) this.react = g.diff.reaction * (this.alert ? 0.6 : 1) * rand(0.8, 1.3);
      this.sees = sees;
      if (sees) {
        if (!this.alert) this.setEyes('alert');
        this.alert = true;
        this.lastSeen.copy(P.pos);
        this.lastSeenT = g.time;
      }
      // stuck check
      const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
      this.lastPos.copy(p);
      if (this.wantsMove && moved < 0.04) this.stuckT += 0.17; else this.stuckT = Math.max(0, this.stuckT - 0.1);
      if (this.stuckT > 1.2) {
        this.stuckT = 0;
        this.path = null;
        this.strafeDir = -this.strafeDir;
        this.vel.x += rand(-3, 3); this.vel.z += rand(-3, 3);
      }
    }

    let mx = 0, mz = 0;
    let speed = t.speed * g.diff.speedMul * (g.overtime ? 1.2 : 1);
    let faceYaw = this.yaw;
    const toPYaw = Math.atan2(dx, dz);
    let aiming = false;
    let crouchTarget = 0;

    if (this.wantCover && this.state === 'combat') {
      this.wantCover = false;
      if (this.findCover(g)) { this.state = 'cover'; this.usedCover = true; this.coverWait = rand(1.4, 2.6); }
    }

    switch (this.state) {
      case 'patrol': {
        if (!this.path || this.pi >= this.path.length) this.pickPatrol(g);
        const s = this.followPath(g);
        mx = s.x; mz = s.z;
        speed *= 0.45;
        if (mx || mz) faceYaw = Math.atan2(mx, mz);
        if (this.alert) { this.state = this.sees ? 'combat' : 'hunt'; this.path = null; }
        break;
      }
      case 'combat': {
        faceYaw = toPYaw;
        aiming = true;
        this.strafeT -= dt;
        if (this.strafeT <= 0) {
          this.strafeT = rand(0.7, 2.0);
          const r = Math.random();
          this.strafeDir = r < 0.4 ? -1 : r < 0.8 ? 1 : 0;
        }
        if (this.body.hitWall) { this.strafeDir = -this.strafeDir || 1; this.strafeT = rand(0.6, 1.3); }
        const nx = dx / dist, nz = dz / dist;
        let fwd = 0;
        if (dist > t.prefer[1]) fwd = 1; else if (dist < t.prefer[0]) fwd = -0.7;
        const sd = this.strafeDir * (t.fly ? 1 : 0.85);
        mx = nx * fwd + nz * sd;
        mz = nz * fwd - nx * sd;
        speed *= t.fly ? 0.9 : 0.7;
        this.shoot(dt, g, dist);
        if (!this.sees && g.time - this.lastSeenT > 1.2) { this.state = 'hunt'; this.path = null; }
        break;
      }
      case 'hunt': {
        this.repathT -= dt;
        if (!this.path || this.pi >= this.path.length || this.repathT <= 0) {
          this.repathT = rand(1.0, 1.6);
          const target = g.time - this.lastSeenT < 5 ? this.lastSeen : P.pos;
          this.path = g.world.findPath(this.navPos(), target);
          this.pi = 0;
        }
        const s = this.followPath(g);
        mx = s.x; mz = s.z;
        speed *= 0.85;
        if (mx || mz) faceYaw = Math.atan2(mx, mz);
        if (this.sees) { this.state = 'combat'; this.strafeT = 0; }
        break;
      }
      case 'cover': {
        const s = this.followPath(g);
        mx = s.x; mz = s.z;
        if (mx || mz) faceYaw = Math.atan2(mx, mz);
        else {
          faceYaw = toPYaw;
          crouchTarget = 1;
          this.coverWait -= dt;
          if (this.coverWait <= 0 || dist < 5) { this.state = 'combat'; this.strafeT = 0; this.shotT = Math.min(this.shotT, 0.3); }
        }
        break;
      }
    }

    // keep apart from other robots
    for (const o of g.robots) {
      if (o === this || !o.alive) continue;
      const ox = p.x - o.pos.x, oz = p.z - o.pos.z;
      const d2 = ox * ox + oz * oz;
      const min = (t.r + o.t.r) * 1.6;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        mx += (ox / d) * (1 - d / min) * 1.5;
        mz += (oz / d) * (1 - d / min) * 1.5;
      }
    }
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    this.wantsMove = ml > 0.2;
    const k = 1 - Math.exp(-8 * dt);
    this.vel.x += (mx * speed - this.vel.x) * k;
    this.vel.z += (mz * speed - this.vel.z) * k;
    g.world.move(this.body, this.vel.x * dt, this.vel.z * dt);
    if (t.fly) {
      const ground = g.world.support(p.x, p.z, 0.4, p.y + 0.2);
      const target = ground + t.hover + Math.sin(g.time * 2 + this.phase) * 0.18;
      p.y += (target - p.y) * (1 - Math.exp(-3 * dt));
    } else {
      g.world.fall(this.body, dt);
    }

    // turn
    const dy = wrapAngle(faceYaw - this.yaw);
    const turn = (t.fly ? 6 : 5) * dt;
    this.yaw += clamp(dy, -turn, turn);
    this.root.rotation.y = this.yaw;
    this.crouch += (crouchTarget - this.crouch) * (1 - Math.exp(-8 * dt));

    this.animate(dt, g, aiming, dist);
  }

  animate(dt, g, aiming, dist) {
    const P = this.parts;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    if (this.t.fly) {
      for (const r of P.rotors) r.rotation.y += dt * 30;
      P.torso.rotation.x = clamp(this.vel.z * Math.cos(this.yaw) + this.vel.x * Math.sin(this.yaw), -4, 4) * 0.06;
      P.torso.rotation.z = -(this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw)) * 0.06;
      return;
    }
    this.phase += dt * sp * 2.6;
    const sw = Math.sin(this.phase) * Math.min(1, sp / 2) * 0.6;
    P.legL.rotation.x = sw;
    P.legR.rotation.x = -sw;
    P.torso.position.y = 1.08 + Math.abs(Math.cos(this.phase)) * 0.04 * Math.min(1, sp / 2);
    // aim arms and head at the player
    const ph = g.player.eye.y - 0.4 - this.eye.y;
    const pitch = Math.atan2(ph, dist);
    if (aiming) {
      P.armR.rotation.x = -Math.PI / 2 - pitch + this.recoil * 0.5;
      P.armL.rotation.x = this.t.heavyBuild ? -Math.PI / 2 - pitch + this.recoil * 0.5 : -0.5;
      P.head.rotation.x = -pitch * 0.6;
    } else {
      P.armR.rotation.x += (-sw * 0.8 - 0.2 - P.armR.rotation.x) * 0.2;
      P.armL.rotation.x += (sw * 0.8 - P.armL.rotation.x) * 0.2;
      P.head.rotation.x *= 0.9;
    }
    P.head.rotation.z = Math.sin(g.time * 1.3 + this.phase) * 0.05;
  }

  pickPatrol(g) {
    const nodes = g.world.nodes;
    for (let i = 0; i < 8; i++) {
      const n = nodes[randInt(0, nodes.length - 1)];
      const d = Math.hypot(n.x - this.pos.x, n.z - this.pos.z);
      if (d > 4 && d < 16) {
        this.path = g.world.findPath(this.navPos(), n);
        this.pi = 0;
        return;
      }
    }
    this.path = null;
  }

  followPath(g) {
    _v.set(0, 0, 0);
    if (!this.path) return _v;
    while (this.pi < this.path.length) {
      const n = this.path[this.pi];
      const d = Math.hypot(n.x - this.pos.x, n.z - this.pos.z);
      if (d < 0.8) { this.pi++; continue; }
      // shortcut to the next node when the way is clear
      if (this.pi + 1 < this.path.length && Math.random() < 0.15) {
        const m = this.path[this.pi + 1];
        if (this.t.fly ? g.world.los(_t.set(this.pos.x, this.pos.y + 0.45, this.pos.z), _w.set(m.x, this.pos.y + 0.45, m.z)) : g.world.walkable(this.pos.x, this.pos.y, this.pos.z, m.x, m.y, m.z, this.t.r)) { this.pi++; continue; }
      }
      _v.set((n.x - this.pos.x) / d, 0, (n.z - this.pos.z) / d);
      return _v;
    }
    return _v;
  }

  findCover(g) {
    const P = g.player;
    const cands = [];
    for (const n of g.world.nodes) {
      const d2 = (n.x - this.pos.x) ** 2 + (n.z - this.pos.z) ** 2;
      if (d2 > 14 * 14 || d2 < 4) continue;
      const pd2 = (n.x - P.pos.x) ** 2 + (n.z - P.pos.z) ** 2;
      if (pd2 < 49) continue;
      cands.push([d2, n]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < Math.min(12, cands.length); i++) {
      const n = cands[i][1];
      _t.set(n.x, n.y + 1.2 * this.t.scale, n.z);
      if (!g.world.los(_t, P.eye)) {
        this.path = g.world.findPath(this.navPos(), n);
        this.pi = 0;
        return !!this.path;
      }
    }
    return false;
  }

  shoot(dt, g, dist) {
    if (this.react > 0) { this.react -= dt; return; }
    this.shotT -= dt;
    if (this.shotT > 0 || !this.sees || !g.player.alive) return;
    const t = this.t;
    if (this.burstLeft <= 0) this.burstLeft = randInt(t.burst[0], t.burst[1]);
    this.burstLeft--;
    if (this.burstLeft > 0) this.shotT = t.gap;
    else {
      this.shotT = rand(t.pause[0], t.pause[1]) * g.diff.pauseMul * (g.overtime ? 0.6 : 1);
      if (t.cover && Math.random() < 0.28) this.wantCover = true;
    }
    this.fire(g, dist);
  }

  fire(g, dist) {
    const t = this.t;
    const P = g.player;
    const muzzles = [this.parts.muzzle];
    if (this.parts.muzzle2) muzzles.push(this.parts.muzzle2);
    const m = muzzles[this.burstLeft % muzzles.length];
    m.getWorldPosition(_w);
    const speed = 13 * t.projSpeed * g.diff.projSpeed;
    _t.set(P.pos.x, P.pos.y + P.height * 0.62, P.pos.z);
    const lead = g.diff.lead * (dist / speed);
    _t.x += P.vel.x * lead; _t.z += P.vel.z * lead;
    _v.subVectors(_t, _w).normalize();
    const n = t.volley || 1;
    for (let i = 0; i < n; i++) {
      const d = _v.clone();
      const spread = g.diff.spread + (n > 1 ? 0.05 : 0);
      d.x += rand(-spread, spread); d.y += rand(-spread, spread) * 0.6; d.z += rand(-spread, spread);
      if (n > 1) {
        const a = (i - (n - 1) / 2) * 0.16;
        const c = Math.cos(a), s = Math.sin(a);
        const x = d.x * c - d.z * s, z = d.x * s + d.z * c;
        d.x = x; d.z = z;
      }
      d.normalize();
      g.enemyShoot(_w, d, speed, t.dmg * g.diff.dmgMul, t.shotColor, t.shotSize, this);
    }
    this.recoil = 1;
    g.audio.play('enemyShot', { at: _w });
  }
}
