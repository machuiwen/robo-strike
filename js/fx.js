import * as THREE from 'three';
import { glowTexture, scorchTexture } from './textures.js';
import { rand } from './util.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3(0, 0, 1);
const _c = new THREE.Color();
const _e = new THREE.Euler();

// Sparks and glows: one Points draw call with per-particle size and color.
export class Sparks {
  constructor(scene, max = 900) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.p = [];
    for (let i = 0; i < max; i++) this.p.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s: 1, r: 1, g: 1, b: 1, grav: 0, drag: 0, floor: 0 });
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('color', this.aCol);
    geo.setAttribute('size', this.aSize);
    geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: glowTexture() }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC;
        uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = clamp(size * scale / -mv.z, 1.0, 96.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.a, 1.0); }`,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setScale(px) { this.mat.uniforms.scale.value = px; }

  emit(x, y, z, vx, vy, vz, life, size, r, g, b, grav = 9, drag = 1.5) {
    if (this.n >= this.max) return;
    const p = this.p[this.n++];
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.max = life; p.s = size; p.r = r; p.g = g; p.b = b; p.grav = grav; p.drag = drag;
  }

  burst(pos, normal, count, speed, color, opts = {}) {
    const c = _c.set(color);
    const hdr = opts.hdr ?? 3;
    for (let i = 0; i < count; i++) {
      _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
      if (normal) { _v.addScaledVector(normal, 1.3); }
      _v.normalize().multiplyScalar(speed * rand(0.35, 1));
      const life = rand(0.25, 0.6) * (opts.life ?? 1);
      this.emit(pos.x, pos.y, pos.z, _v.x, _v.y, _v.z, life, (opts.size ?? 0.07) * rand(0.6, 1.3), c.r * hdr, c.g * hdr, c.b * hdr, opts.grav ?? 12, opts.drag ?? 2);
    }
  }

  update(dt, world) {
    let i = 0;
    while (i < this.n) {
      const p = this.p[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.n--;
        const last = this.p[this.n];
        this.p[this.n] = p;
        this.p[i] = last;
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k - p.grav * dt; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02 && p.vy < 0) { p.y = 0.02; p.vy *= -0.45; p.vx *= 0.7; p.vz *= 0.7; }
      const f = Math.min(1, p.life / p.max * 1.6);
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.col[i * 3] = p.r * f; this.col[i * 3 + 1] = p.g * f; this.col[i * 3 + 2] = p.b * f;
      this.size[i] = p.s * (0.5 + 0.5 * f);
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    if (this.n) {
      this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true;
    }
  }
}

// Small bolts, nuts, gears and plates that bounce around when a robot breaks.
export class Debris {
  constructor(scene, max = 140) {
    const shapes = [
      new THREE.CylinderGeometry(0.07, 0.07, 0.06, 6), // nut
      new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6), // bolt
      new THREE.CylinderGeometry(0.13, 0.13, 0.04, 10), // gear
      new THREE.BoxGeometry(0.22, 0.03, 0.16), // plate
    ];
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.35 });
    this.meshes = shapes.map((g) => {
      const m = new THREE.InstancedMesh(g, mat, max);
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, _c.set(0xffffff));
      scene.add(m);
      return m;
    });
    this.items = shapes.map(() => []);
    this.max = max;
  }

  spawn(pos, color, n, power = 1) {
    for (let i = 0; i < n; i++) {
      const s = i % 4;
      const list = this.items[s];
      if (list.length >= this.max) list.shift();
      list.push({
        p: new THREE.Vector3(pos.x + rand(-0.3, 0.3), pos.y + rand(-0.3, 0.3), pos.z + rand(-0.3, 0.3)),
        v: new THREE.Vector3(rand(-4, 4) * power, rand(3, 8) * power, rand(-4, 4) * power),
        r: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)),
        w: new THREE.Vector3(rand(-14, 14), rand(-14, 14), rand(-14, 14)),
        life: rand(2.5, 4),
        c: new THREE.Color(Math.random() < 0.55 ? 0xb8c2d0 : color),
        sc: rand(0.8, 1.5),
      });
    }
  }

  update(dt, world) {
    for (let s = 0; s < this.meshes.length; s++) {
      const list = this.items[s];
      const mesh = this.meshes[s];
      let w = 0;
      for (let i = 0; i < list.length; i++) {
        const d = list[i];
        d.life -= dt;
        if (d.life <= 0) continue;
        d.v.y -= 20 * dt;
        d.p.addScaledVector(d.v, dt);
        const g = world.support(d.p.x, d.p.z, 0.02, d.p.y + 0.3);
        if (d.p.y < g + 0.03) {
          d.p.y = g + 0.03;
          if (d.v.y < 0) d.v.y *= -0.35;
          d.v.x *= 0.75; d.v.z *= 0.75; d.w.multiplyScalar(0.7);
        }
        d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
        const sc = d.sc * Math.min(1, d.life * 2);
        _q.setFromEuler(d.r);
        _s.set(sc, sc, sc);
        _m.compose(d.p, _q, _s);
        mesh.setMatrixAt(w, _m);
        mesh.setColorAt(w, d.c);
        list[w++] = d;
      }
      list.length = w;
      mesh.count = w;
      if (w) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}

// Big robot pieces (head, arms, ...) that fly off and bounce, then shrink away.
export class Chunks {
  constructor(scene) { this.scene = scene; this.list = []; }

  add(obj, vel, spin, life = 2.6) {
    this.scene.attach(obj);
    this.list.push({ o: obj, v: vel, w: spin, life, max: life, s0: obj.scale.clone() });
  }

  update(dt, world) {
    let w = 0;
    for (const c of this.list) {
      c.life -= dt;
      if (c.life <= 0) {
        this.scene.remove(c.o);
        continue;
      }
      c.v.y -= 20 * dt;
      c.o.position.addScaledVector(c.v, dt);
      const g = world.support(c.o.position.x, c.o.position.z, 0.1, c.o.position.y + 0.4);
      if (c.o.position.y < g + 0.12) {
        c.o.position.y = g + 0.12;
        if (c.v.y < 0) c.v.y *= -0.4;
        c.v.x *= 0.7; c.v.z *= 0.7; c.w.multiplyScalar(0.6);
      }
      c.o.rotation.x += c.w.x * dt; c.o.rotation.y += c.w.y * dt; c.o.rotation.z += c.w.z * dt;
      const f = Math.min(1, c.life / 0.5);
      c.o.scale.copy(c.s0).multiplyScalar(Math.max(0.001, f));
      this.list[w++] = c;
    }
    this.list.length = w;
  }

  clear() {
    for (const c of this.list) this.scene.remove(c.o);
    this.list.length = 0;
  }
}

// Tracer beams: stretched glowing boxes that thin out quickly.
export class Tracers {
  constructor(scene, max = 48) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0, 0.5);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, _c.set(0xffffff));
    scene.add(this.mesh);
    this.list = [];
    this.max = max;
  }

  add(from, to, color, width = 0.035, life = 0.09) {
    if (this.list.length >= this.max) this.list.shift();
    const len = from.distanceTo(to);
    this.list.push({ a: from.clone(), len, dir: _v.subVectors(to, from).normalize().clone(), c: new THREE.Color(color).multiplyScalar(3), w: width, life, max: life });
  }

  update(dt) {
    let w = 0;
    for (const t of this.list) {
      t.life -= dt;
      if (t.life <= 0) continue;
      const f = t.life / t.max;
      _q.setFromUnitVectors(_z, t.dir);
      // the beam's tail catches up with its head as it fades
      const tail = (1 - f) * 0.6;
      _v.copy(t.a).addScaledVector(t.dir, t.len * tail);
      _s.set(t.w * (0.4 + f), t.w * (0.4 + f), Math.max(0.01, t.len * (1 - tail)));
      _m.compose(_v, _q, _s);
      this.mesh.setMatrixAt(w, _m);
      this.mesh.setColorAt(w, _c.copy(t.c).multiplyScalar(f));
      this.list[w++] = t;
    }
    this.list.length = w;
    this.mesh.count = w;
    if (w) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

// Burn marks on walls.
export class Decals {
  constructor(scene, max = 60) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.i = 0;
    this.max = max;
  }

  add(x, y, z, nx, ny, nz, size = 0.28) {
    _v.set(nx, ny, nz);
    _q.setFromUnitVectors(_z, _v);
    _e.set(0, 0, rand(0, Math.PI * 2));
    _q.multiply(new THREE.Quaternion().setFromEuler(_e));
    _s.set(size, size, size);
    _m.compose(new THREE.Vector3(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01), _q, _s);
    this.mesh.setMatrixAt(this.i, _m);
    this.i = (this.i + 1) % this.max;
    this.mesh.count = Math.min(this.max, this.mesh.count + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() { this.mesh.count = 0; this.i = 0; }
}

// Expanding rings and flashes (bubble pops, warp-ins, explosions).
export class Rings {
  constructor(scene, max = 10) {
    this.list = [];
    const sphere = new THREE.SphereGeometry(1, 20, 12);
    const ring = new THREE.TorusGeometry(1, 0.06, 6, 32);
    ring.rotateX(Math.PI / 2);
    this.pool = [];
    for (let i = 0; i < max; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const m = new THREE.Mesh(i % 2 ? ring : sphere, mat);
      m.visible = false;
      scene.add(m);
      this.pool.push({ m, kind: i % 2 ? 'ring' : 'sphere', busy: false });
    }
  }

  add(pos, color, radius, life = 0.35, kind = 'sphere', opacity = 0.7) {
    const slot = this.pool.find((p) => !p.busy && p.kind === kind);
    if (!slot) return;
    slot.busy = true;
    slot.m.visible = true;
    slot.m.position.copy(pos);
    slot.m.material.color.set(color).multiplyScalar(1.6);
    slot.life = life; slot.max = life; slot.r = radius; slot.o = opacity;
    slot.m.scale.setScalar(0.01);
    this.list.push(slot);
  }

  update(dt) {
    let w = 0;
    for (const s of this.list) {
      s.life -= dt;
      if (s.life <= 0) { s.busy = false; s.m.visible = false; continue; }
      const t = 1 - s.life / s.max;
      const e = 1 - (1 - t) * (1 - t);
      s.m.scale.setScalar(Math.max(0.01, s.r * e));
      s.m.material.opacity = s.o * (1 - t);
      this.list[w++] = s;
    }
    this.list.length = w;
  }
}

// Instanced glowing orbs: used for robot shots and the player's bubbles.
export class OrbPool {
  constructor(scene, max, radius, material, stretch = 1) {
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(radius, 14, 10), material, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.set(0xffffff));
    scene.add(this.mesh);
    this.list = [];
    this.max = max;
    this.stretch = stretch;
  }

  add(o) {
    if (this.list.length >= this.max) return null;
    this.list.push(o);
    return o;
  }

  sync() {
    let i = 0;
    for (const o of this.list) {
      const sp = o.v.length();
      if (this.stretch > 1 && sp > 0.1) {
        _q.setFromUnitVectors(_z, _v.copy(o.v).divideScalar(sp));
        _s.set(o.scale || 1, o.scale || 1, (o.scale || 1) * this.stretch);
      } else {
        _q.identity();
        _s.setScalar(o.scale || 1);
      }
      _m.compose(o.p, _q, _s);
      if (o.c) this.mesh.setColorAt(i, o.c);
      this.mesh.setMatrixAt(i++, _m);
    }
    this.mesh.count = i;
    if (i) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

export { _up };
