import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeColored } from './geo.js';
import { flashTexture } from './textures.js';
import { damp, clamp, rand } from './util.js';

// spread values are radians (cone half-angle)
export const WEAPONS = {
  rifle: {
    id: 'rifle', name: '激光步枪', short: '步枪', auto: true, interval: 0.1, dmg: 24, head: 2.4, mag: 30, reserve: 150, reload: 1.8,
    spreadBase: 0.004, spreadMove: 0.045, spreadAir: 0.11, spreadShot: 0.009, spreadMax: 0.06, recoil: 0.011, kick: 0.05,
    tracer: 0x46e8ff, flash: [0.5, 2.6, 3.2], sound: 'rifle', speedMul: 1, price: 0, hold: [0.25, -0.23, -0.56], muzzle: [0, 0.01, -0.66],
  },
  pistol: {
    id: 'pistol', name: '光子手枪', short: '手枪', auto: false, interval: 0.16, dmg: 34, head: 2.6, mag: 12, reserve: Infinity, reload: 1.2,
    spreadBase: 0.003, spreadMove: 0.03, spreadAir: 0.08, spreadShot: 0.012, spreadMax: 0.05, recoil: 0.02, kick: 0.06,
    tracer: 0xc59bff, flash: [2.6, 1.0, 3.2], sound: 'pistol', speedMul: 1.08, price: 0, hold: [0.23, -0.21, -0.44], muzzle: [0, 0.03, -0.25],
  },
  bubble: {
    id: 'bubble', name: '泡泡炮', short: '泡泡', auto: false, interval: 0.55, dmg: 85, head: 1, mag: 5, reserve: 15, reload: 2.0,
    projectile: true, splash: 3.6, spreadBase: 0.004, spreadMove: 0.02, spreadAir: 0.04, spreadShot: 0, spreadMax: 0.04, recoil: 0.03, kick: 0.09,
    tracer: 0xff8fd8, flash: [3.2, 1.2, 2.6], sound: 'bubble', speedMul: 1, price: 0, hold: [0.25, -0.23, -0.52], muzzle: [0, 0, -0.44],
  },
  scatter: {
    id: 'scatter', name: '散射炮', short: '散射', auto: false, interval: 0.72, dmg: 13, head: 1.8, pellets: 9, mag: 8, reserve: 32, reload: 2.3,
    spreadBase: 0.06, spreadMove: 0.02, spreadAir: 0.04, spreadShot: 0, spreadMax: 0.09, recoil: 0.05, kick: 0.12,
    tracer: 0xffd23f, flash: [3.4, 2.6, 0.6], sound: 'scatter', speedMul: 0.98, price: 1000, hold: [0.25, -0.24, -0.54], muzzle: [0, 0.02, -0.5],
  },
  rail: {
    id: 'rail', name: '电磁狙击枪', short: '狙击', auto: false, interval: 1.15, dmg: 140, head: 2.5, pierce: true, mag: 5, reserve: 15, reload: 2.4,
    spreadBase: 0.02, spreadMove: 0.05, spreadAir: 0.1, spreadShot: 0, spreadMax: 0.1, zoomSpread: 0.0005, recoil: 0.06, kick: 0.14,
    tracer: 0xff4fd8, flash: [3.2, 0.6, 2.8], sound: 'rail', speedMul: 0.92, price: 1600, hold: [0.25, -0.23, -0.52], muzzle: [0, 0, -0.62],
  },
};
export const WEAPON_ORDER = ['rifle', 'pistol', 'bubble', 'scatter', 'rail'];

// ---------------------------------------------------------------- view-model meshes
const RB = (w, h, d, r = 0.015) => new RoundedBoxGeometry(w, h, d, 2, r);
const CYL = (r0, r1, h, n = 14) => new THREE.CylinderGeometry(r0, r1, h, n);
const GLOVE = 0xfdfdfd, CUFF = 0x3ad6ff, SLEEVE = 0x3a4a7a, DARK = 0x323a52;
const RX = [Math.PI / 2, 0, 0];

function hands(grip, fore) {
  const out = [
    { g: RB(0.085, 0.1, 0.11, 0.03), c: GLOVE, p: grip },
    { g: CYL(0.05, 0.05, 0.04), c: CUFF, p: [grip[0] + 0.02, grip[1] - 0.06, grip[2] + 0.08], dir: [0.25, -0.5, 1] },
    { g: CYL(0.055, 0.065, 0.4), c: SLEEVE, p: [grip[0] + 0.07, grip[1] - 0.15, grip[2] + 0.26], dir: [0.25, -0.5, 1] },
  ];
  if (fore) {
    out.push(
      { g: RB(0.1, 0.085, 0.12, 0.03), c: GLOVE, p: fore },
    );
  }
  return out;
}

function buildModel(id) {
  let solid = [], glow = [], extra = null;
  if (id === 'rifle') {
    solid = [
      { g: RB(0.1, 0.13, 0.5, 0.03), c: 0xdfe6f0, p: [0, 0, -0.1] },
      { g: RB(0.06, 0.04, 0.36), c: DARK, p: [0, 0.085, -0.12] },
      { g: CYL(0.034, 0.034, 0.26), c: 0x2bbfb0, p: [0, 0.01, -0.47], r: RX },
      { g: CYL(0.05, 0.05, 0.05), c: 0xff9a3c, p: [0, 0.01, -0.61], r: RX },
      { g: RB(0.07, 0.16, 0.09, 0.02), c: 0xff9a3c, p: [0, -0.13, -0.15], r: [0.2, 0, 0] },
      { g: RB(0.07, 0.14, 0.08, 0.02), c: DARK, p: [0, -0.11, 0.08], r: [-0.3, 0, 0] },
      { g: RB(0.03, 0.05, 0.03, 0.01), c: DARK, p: [0, 0.12, -0.27] },
      { g: RB(0.09, 0.07, 0.16, 0.02), c: DARK, p: [0, -0.04, -0.33] },
      ...hands([0, -0.12, 0.08], [-0.01, -0.085, -0.33]),
    ];
    glow = [
      { g: RB(0.012, 0.05, 0.2, 0.004), c: [0.4, 2.4, 3.0], p: [0.052, 0.0, -0.12] },
      { g: RB(0.012, 0.05, 0.2, 0.004), c: [0.4, 2.4, 3.0], p: [-0.052, 0.0, -0.12] },
      { g: CYL(0.038, 0.038, 0.012), c: [0.4, 2.4, 3.0], p: [0, 0.01, -0.64], r: RX },
    ];
  } else if (id === 'pistol') {
    solid = [
      { g: RB(0.07, 0.08, 0.26, 0.02), c: 0x8f6bff, p: [0, 0.03, -0.08] },
      { g: RB(0.064, 0.05, 0.2, 0.015), c: DARK, p: [0, -0.025, -0.07] },
      { g: RB(0.064, 0.15, 0.08, 0.02), c: DARK, p: [0, -0.1, 0.04], r: [-0.25, 0, 0] },
      { g: CYL(0.026, 0.026, 0.04), c: 0xffcf4a, p: [0, 0.03, -0.22], r: RX },
      ...hands([0, -0.1, 0.05]),
    ];
    glow = [{ g: RB(0.074, 0.014, 0.18, 0.004), c: [3.0, 0.8, 2.4], p: [0, 0.068, -0.08] }];
  } else if (id === 'bubble') {
    solid = [
      { g: CYL(0.075, 0.09, 0.42), c: 0xff74ad, p: [0, 0, -0.1], r: RX },
      { g: CYL(0.06, 0.125, 0.14, 18), c: 0x7cf0d0, p: [0, 0, -0.36], r: RX },
      { g: CYL(0.03, 0.03, 0.08), c: DARK, p: [0, 0.07, -0.05] },
      { g: RB(0.07, 0.15, 0.08, 0.02), c: DARK, p: [0, -0.12, 0.05], r: [-0.25, 0, 0] },
      { g: RB(0.06, 0.12, 0.07, 0.02), c: DARK, p: [0, -0.1, -0.22] },
      ...hands([0, -0.12, 0.05], [-0.01, -0.12, -0.22]),
    ];
    glow = [
      { g: CYL(0.13, 0.13, 0.012, 18), c: [2.6, 1.0, 3.0], p: [0, 0, -0.43], r: RX },
      { g: new THREE.SphereGeometry(0.025, 8, 6), c: [3, 2.2, 3], p: [0.02, 0.15, -0.04] },
      { g: new THREE.SphereGeometry(0.018, 8, 6), c: [2, 3, 3], p: [-0.025, 0.12, -0.07] },
    ];
    extra = new THREE.Mesh(new THREE.SphereGeometry(0.085, 18, 12), new THREE.MeshStandardMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.2 }));
    extra.position.set(0, 0.14, -0.05);
  } else if (id === 'scatter') {
    solid = [
      { g: RB(0.14, 0.12, 0.42, 0.03), c: 0xffcf4a, p: [0, 0, -0.08] },
      { g: CYL(0.03, 0.03, 0.2), c: DARK, p: [0.035, 0.02, -0.38], r: RX },
      { g: CYL(0.03, 0.03, 0.2), c: DARK, p: [-0.035, 0.02, -0.38], r: RX },
      { g: RB(0.12, 0.07, 0.15, 0.02), c: 0xff9a3c, p: [0, -0.07, -0.3] },
      { g: RB(0.09, 0.12, 0.2, 0.03), c: DARK, p: [0, -0.03, 0.22] },
      { g: RB(0.07, 0.14, 0.08, 0.02), c: DARK, p: [0, -0.11, 0.06], r: [-0.3, 0, 0] },
      ...hands([0, -0.12, 0.06], [-0.01, -0.1, -0.3]),
    ];
    glow = [{ g: RB(0.145, 0.02, 0.3, 0.005), c: [0.4, 2.6, 3.0], p: [0, 0.04, -0.06] }];
  } else if (id === 'rail') {
    solid = [
      { g: RB(0.08, 0.09, 0.72, 0.025), c: 0x34407a, p: [0, 0, -0.2] },
      { g: CYL(0.035, 0.035, 0.22), c: DARK, p: [0, 0.095, -0.06], r: RX },
      { g: RB(0.02, 0.04, 0.02, 0.005), c: DARK, p: [0, 0.06, -0.06] },
      { g: RB(0.08, 0.12, 0.2, 0.03), c: 0xb4a0ff, p: [0, -0.03, 0.24] },
      { g: RB(0.07, 0.14, 0.08, 0.02), c: DARK, p: [0, -0.11, 0.06], r: [-0.3, 0, 0] },
      ...hands([0, -0.12, 0.06], [-0.01, -0.08, -0.32]),
    ];
    glow = [
      { g: new THREE.TorusGeometry(0.06, 0.013, 6, 18), c: [3.2, 0.6, 2.8], p: [0, 0, -0.4] },
      { g: new THREE.TorusGeometry(0.06, 0.013, 6, 18), c: [3.2, 0.6, 2.8], p: [0, 0, -0.48] },
      { g: new THREE.TorusGeometry(0.06, 0.013, 6, 18), c: [3.2, 0.6, 2.8], p: [0, 0, -0.56] },
      { g: CYL(0.03, 0.03, 0.01), c: [0.6, 2.6, 3.2], p: [0, 0.095, -0.175], r: RX },
    ];
  }
  const group = new THREE.Group();
  group.add(new THREE.Mesh(mergeColored(solid), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.1 })));
  if (glow.length) group.add(new THREE.Mesh(mergeColored(glow), new THREE.MeshBasicMaterial({ vertexColors: true })));
  if (extra) group.add(extra);
  const w = WEAPONS[id];
  const muzzle = new THREE.Object3D();
  muzzle.position.set(...w.muzzle);
  group.add(muzzle);
  group.userData.muzzle = muzzle;
  return group;
}

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96b0, 1.25));
    const dl = new THREE.DirectionalLight(0xffffff, 1.25);
    dl.position.set(0.6, 1, 0.4);
    this.scene.add(dl);
    this.holder = new THREE.Group();
    this.holder.scale.setScalar(0.8);
    this.camera.add(this.holder);
    this.models = {};
    for (const id of Object.keys(WEAPONS)) {
      const m = buildModel(id);
      m.visible = false;
      this.holder.add(m);
      this.models[id] = m;
    }
    const ft = flashTexture();
    const fmat = new THREE.MeshBasicMaterial({ map: ft, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffffff });
    this.flash = new THREE.Group();
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), fmat);
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), fmat);
    p2.rotation.y = Math.PI / 2;
    const p3 = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), fmat);
    p3.rotation.x = Math.PI / 2;
    this.flash.add(p1, p2, p3);
    this.flash.visible = false;
    this.flashMat = fmat;
    this.flashT = 0;
    this.current = null;
    this.bob = 0;
    this.swayX = 0; this.swayY = 0;
    this.kick = 0; this.kickRot = 0; this.kickVel = 0;
    this.land = 0;
    this.switchT = 0;
    this.aim = 0;
  }

  setWeapon(id) {
    if (this.current) this.models[this.current].visible = false;
    this.current = id;
    const m = this.models[id];
    m.visible = true;
    m.userData.muzzle.add(this.flash);
    this.switchT = 1;
  }

  fire(w) {
    this.kickVel += w.kick * 6;
    this.kickRot += w.kick * 1.8;
    this.flashT = 0.055;
    this.flash.visible = true;
    this.flash.rotation.z = rand(0, Math.PI);
    const s = w.id === 'scatter' || w.id === 'rail' ? 1.5 : w.id === 'pistol' ? 0.8 : 1;
    this.flash.scale.setScalar(s * rand(0.8, 1.2));
    this.flashMat.color.setRGB(w.flash[0], w.flash[1], w.flash[2]);
  }

  // Muzzle position in world space for tracers.
  muzzleWorld(mainCam, out) {
    const m = this.models[this.current].userData.muzzle;
    this.holder.updateMatrixWorld(true);
    m.getWorldPosition(out);
    // view camera sits at the origin; map to the main camera frame
    out.applyMatrix4(this.camera.matrixWorldInverse);
    return mainCam.localToWorld(out);
  }

  update(dt, s) {
    const w = WEAPONS[this.current];
    if (!w) return;
    this.bob += dt * s.speed * 1.7;
    const mv = Math.min(1, s.speed / 6) * (s.grounded ? 1 : 0.3) * (1 - this.aim * 0.8);
    const bx = Math.sin(this.bob) * 0.014 * mv;
    const by = -Math.abs(Math.cos(this.bob)) * 0.016 * mv;
    this.swayX = damp(this.swayX, clamp(-s.lookDX * 0.0009, -0.05, 0.05), 10, dt);
    this.swayY = damp(this.swayY, clamp(s.lookDY * 0.0009, -0.05, 0.05), 10, dt);
    // spring back from recoil
    this.kickVel += (-this.kick * 220 - this.kickVel * 22) * dt;
    this.kick += this.kickVel * dt;
    this.kickRot = damp(this.kickRot, 0, 12, dt);
    this.land = damp(this.land, 0, 8, dt);
    this.switchT = Math.max(0, this.switchT - dt * 4.5);
    this.aim = damp(this.aim, s.aim ? 1 : 0, 14, dt);
    let rx = this.kickRot * 0.6 + this.swayY * 2, ry = this.swayX * 2, rz = 0;
    let ox = w.hold[0] * (1 - this.aim * 0.75) + bx + this.swayX;
    let oy = w.hold[1] * (1 + this.aim * 0.15) + by + this.swayY - this.land * 0.05 - this.switchT * this.switchT * 0.35;
    let oz = w.hold[2] + this.kick;
    if (s.reload > 0) {
      const k = Math.sin(Math.PI * s.reload);
      oy -= k * 0.12;
      rx -= k * 0.5;
      rz += k * 0.6;
    }
    rx -= this.switchT * 0.6;
    this.holder.position.set(ox, oy, oz);
    this.holder.rotation.set(rx, ry, rz);
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.visible = false;
    }
    this.holder.visible = !s.hide;
  }
}
