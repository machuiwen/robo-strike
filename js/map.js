import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { floorTexture, wallTexture, crateTexture, shadowTexture } from './textures.js';

export const STEP = 0.45;
export const GRAVITY = 20;

const COL = {
  cream: 0xf1e4cb, coral: 0xff8b7b, mint: 0x78d9bd, sky: 0x86c3ff, lav: 0xb4a0ff,
  orange: 0xff9a3c, teal: 0x2bbfb0, yellow: 0xffcf4a, pink: 0xff74ad, blue: 0x5c9dff,
};
const NEON = { cyan: [0.25, 1.9, 2.4], yellow: [2.4, 1.8, 0.3], pink: [2.4, 0.45, 1.6], lime: [0.9, 2.4, 0.45], violet: [1.3, 0.6, 2.5] };

// ---------------------------------------------------------------- collision world
export class World {
  constructor() {
    this.boxes = [];
    this.ramps = [];
    this.nodes = [];
    this._hit = { t: 0, nx: 0, ny: 0, nz: 0, x: 0, y: 0, z: 0 };
  }

  addBox(minX, minY, minZ, maxX, maxY, maxZ) {
    const b = { minX, minY, minZ, maxX, maxY, maxZ };
    this.boxes.push(b);
    return b;
  }

  // Ramp rising along z. hMin is the height at minZ, hMax at maxZ.
  addRamp(minX, minZ, maxX, maxZ, hMin, hMax) {
    const r = { minX, minZ, maxX, maxZ, hMin, hMax, k: (hMax - hMin) / (maxZ - minZ) };
    this.ramps.push(r);
    return r;
  }

  rampHeight(x, z) {
    let h = -1;
    for (const r of this.ramps) {
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
        const y = r.hMin + (z - r.minZ) * r.k;
        if (y > h) h = y;
      }
    }
    return h;
  }

  // Highest walkable surface under a square footprint that is not above maxY.
  support(x, z, r, maxY) {
    let g = 0;
    for (const b of this.boxes) {
      if (b.maxY <= maxY && b.maxY > g && x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) g = b.maxY;
    }
    const rh = this.rampHeight(x, z);
    if (rh <= maxY && rh > g) g = rh;
    return g;
  }

  blockedAt(x, z, r, y0, y1) {
    for (const b of this.boxes) {
      if (b.maxY > y0 && b.minY < y1 && x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return true;
    }
    return this.rampHeight(x, z) > y0;
  }

  // Horizontal move with sliding along walls. body: { pos, r, h, step }
  move(body, dx, dz) {
    const p = body.pos, r = body.r;
    const y0 = p.y + body.step, y1 = p.y + body.h;
    body.hitWall = false;
    if (dx !== 0) {
      p.x += dx;
      for (const b of this.boxes) {
        if (b.maxY > y0 && b.minY < y1 && p.z + r > b.minZ && p.z - r < b.maxZ && p.x + r > b.minX && p.x - r < b.maxX) {
          p.x = dx > 0 ? b.minX - r - 1e-4 : b.maxX + r + 1e-4;
          body.hitWall = true;
        }
      }
      if (this.rampHeight(p.x, p.z) > y0) { p.x -= dx; body.hitWall = true; }
    }
    if (dz !== 0) {
      p.z += dz;
      for (const b of this.boxes) {
        if (b.maxY > y0 && b.minY < y1 && p.x + r > b.minX && p.x - r < b.maxX && p.z + r > b.minZ && p.z - r < b.maxZ) {
          p.z = dz > 0 ? b.minZ - r - 1e-4 : b.maxZ + r + 1e-4;
          body.hitWall = true;
        }
      }
      if (this.rampHeight(p.x, p.z) > y0) { p.z -= dz; body.hitWall = true; }
    }
  }

  // Gravity, landing and ceilings. Returns landing speed (>0) on the frame the body lands.
  fall(body, dt) {
    const p = body.pos, v = body.vel, r = body.r;
    const prevY = p.y;
    v.y -= GRAVITY * dt;
    if (v.y < -40) v.y = -40;
    p.y += v.y * dt;
    if (v.y > 0) {
      for (const b of this.boxes) {
        if (b.minY >= prevY + body.h - 0.05 && p.y + body.h > b.minY && p.x + r > b.minX && p.x - r < b.maxX && p.z + r > b.minZ && p.z - r < b.maxZ) {
          p.y = b.minY - body.h;
          v.y = 0;
        }
      }
    }
    const g = this.support(p.x, p.z, r * 0.9, Math.max(p.y, prevY) + body.step);
    let landed = 0;
    if (p.y <= g) {
      if (!body.grounded) landed = -v.y;
      p.y = g;
      v.y = 0;
      body.grounded = true;
    } else if (body.grounded && v.y <= 0 && p.y - g < 0.38) {
      p.y = g;
      v.y = 0;
    } else {
      body.grounded = false;
    }
    return landed;
  }

  // Ray against floor, boxes and ramp tops. d must be normalized. Returns the shared hit object or null.
  raycast(o, d, maxT) {
    let best = maxT, nx = 0, ny = 0, nz = 0, hit = false;
    if (d.y < -1e-6) {
      const t = -o.y / d.y;
      if (t >= 0 && t < best) { best = t; nx = 0; ny = 1; nz = 0; hit = true; }
    }
    for (const b of this.boxes) {
      let tmin = -Infinity, tmax = Infinity, ax = 0, sg = 0;
      // x
      if (Math.abs(d.x) < 1e-9) { if (o.x < b.minX || o.x > b.maxX) continue; }
      else {
        let t1 = (b.minX - o.x) / d.x, t2 = (b.maxX - o.x) / d.x, s = -1;
        if (t1 > t2) { const q = t1; t1 = t2; t2 = q; s = 1; }
        if (t1 > tmin) { tmin = t1; ax = 0; sg = s; }
        if (t2 < tmax) tmax = t2;
      }
      if (Math.abs(d.y) < 1e-9) { if (o.y < b.minY || o.y > b.maxY) continue; }
      else {
        let t1 = (b.minY - o.y) / d.y, t2 = (b.maxY - o.y) / d.y, s = -1;
        if (t1 > t2) { const q = t1; t1 = t2; t2 = q; s = 1; }
        if (t1 > tmin) { tmin = t1; ax = 1; sg = s; }
        if (t2 < tmax) tmax = t2;
      }
      if (Math.abs(d.z) < 1e-9) { if (o.z < b.minZ || o.z > b.maxZ) continue; }
      else {
        let t1 = (b.minZ - o.z) / d.z, t2 = (b.maxZ - o.z) / d.z, s = -1;
        if (t1 > t2) { const q = t1; t1 = t2; t2 = q; s = 1; }
        if (t1 > tmin) { tmin = t1; ax = 2; sg = s; }
        if (t2 < tmax) tmax = t2;
      }
      if (tmax < tmin || tmin < 0 || tmin >= best) continue;
      best = tmin; hit = true;
      nx = ax === 0 ? sg : 0; ny = ax === 1 ? sg : 0; nz = ax === 2 ? sg : 0;
    }
    for (const r of this.ramps) {
      const den = d.y - d.z * r.k;
      if (Math.abs(den) < 1e-9) continue;
      const t = (r.hMin + (o.z - r.minZ) * r.k - o.y) / den;
      if (t < 0 || t >= best) continue;
      const x = o.x + d.x * t, z = o.z + d.z * t;
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      best = t; hit = true;
      const l = Math.hypot(1, r.k);
      nx = 0; ny = 1 / l; nz = -r.k / l;
    }
    if (!hit) return null;
    const h = this._hit;
    h.t = best; h.nx = nx; h.ny = ny; h.nz = nz;
    h.x = o.x + d.x * best; h.y = o.y + d.y * best; h.z = o.z + d.z * best;
    return h;
  }

  los(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-4) return true;
    _d.set(dx / L, dy / L, dz / L);
    return !this.raycast(a, _d, L - 0.05);
  }

  solidAt(x, y, z) {
    if (y < 0) return true;
    if (y < this.rampHeight(x, z)) return true;
    for (const b of this.boxes) {
      if (x > b.minX && x < b.maxX && y > b.minY && y < b.maxY && z > b.minZ && z < b.maxZ) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ navigation
  walkable(ax, ay, az, bx, by, bz, r = 0.45) {
    const dx = bx - ax, dz = bz - az;
    const d = Math.hypot(dx, dz);
    const n = Math.max(2, Math.ceil(d / 0.35));
    let y = ay;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const px = ax + dx * t, pz = az + dz * t;
      if (this.blockedAt(px, pz, r, y + STEP, y + 1.7)) return false;
      y = this.support(px, pz, r * 0.9, y + STEP);
    }
    return Math.abs(y - by) < 0.3;
  }

  buildNav(startX, startZ) {
    const S = 2.5;
    const grid = new Map();
    const raw = [];
    for (let i = 0, x = -28.75; x <= 28.8; x += S, i++) {
      for (let j = 0, z = -32.5; z <= 32.6; z += S, j++) {
        const y = this.support(x, z, 0.3, 3.0);
        if (this.blockedAt(x, z, 0.65, y + 0.3, y + 1.8)) continue;
        const n = { x, y, z, i, j, id: raw.length, nb: [] };
        raw.push(n);
        grid.set(i * 1000 + j, n);
      }
    }
    for (const a of raw) {
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const b = grid.get((a.i + di) * 1000 + a.j + dj);
        if (b && this.walkable(a.x, a.y, a.z, b.x, b.y, b.z)) a.nb.push(b);
      }
    }
    // Keep only nodes reachable from the start area.
    let start = null, bd = Infinity;
    for (const n of raw) {
      const d = (n.x - startX) ** 2 + (n.z - startZ) ** 2;
      if (d < bd) { bd = d; start = n; }
    }
    const seen = new Set([start]);
    const q = [start];
    while (q.length) {
      const n = q.pop();
      for (const m of n.nb) if (!seen.has(m)) { seen.add(m); q.push(m); }
    }
    // A node also needs a way back to the start (so robots never get trapped on a crate).
    const back = new Map();
    for (const n of raw) for (const m of n.nb) { if (!back.has(m)) back.set(m, []); back.get(m).push(n); }
    const seenBack = new Set([start]);
    q.push(start);
    while (q.length) {
      const n = q.pop();
      for (const m of back.get(n) || []) if (!seenBack.has(m)) { seenBack.add(m); q.push(m); }
    }
    const nodes = raw.filter((n) => seen.has(n) && seenBack.has(n));
    nodes.forEach((n, k) => { n.id = k; });
    for (const n of nodes) n.nb = n.nb.filter((m) => seen.has(m) && seenBack.has(m));
    this.nodes = nodes;
    this._g = new Float32Array(nodes.length);
    this._f = new Float32Array(nodes.length);
    this._from = new Int32Array(nodes.length);
    this._state = new Uint8Array(nodes.length);
  }

  nearestNode(x, y, z) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) {
      const dy = (n.y - y) * 3;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2 + dy * dy;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  findPath(from, to) {
    const s = this.nearestNode(from.x, from.y, from.z);
    const t = this.nearestNode(to.x, to.y, to.z);
    if (!s || !t) return null;
    if (s === t) return [t];
    const g = this._g, f = this._f, came = this._from, st = this._state;
    st.fill(0);
    const open = [s];
    g[s.id] = 0;
    f[s.id] = Math.hypot(t.x - s.x, t.z - s.z);
    came[s.id] = -1;
    st[s.id] = 1;
    let iter = 0;
    while (open.length && iter++ < 2000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i].id] < f[open[bi].id]) bi = i;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (cur === t) break;
      st[cur.id] = 2;
      for (const m of cur.nb) {
        if (st[m.id] === 2) continue;
        const ng = g[cur.id] + Math.hypot(m.x - cur.x, m.z - cur.z, (m.y - cur.y) * 2);
        if (st[m.id] === 0 || ng < g[m.id]) {
          g[m.id] = ng;
          f[m.id] = ng + Math.hypot(t.x - m.x, t.z - m.z);
          came[m.id] = cur.id;
          if (st[m.id] === 0) { st[m.id] = 1; open.push(m); }
        }
      }
    }
    if (st[t.id] === 0) return null;
    const path = [];
    let c = t.id;
    let guard = 0;
    while (c !== -1 && guard++ < 1000) { path.push(this.nodes[c]); c = came[c]; }
    path.reverse();
    return path;
  }
}
const _d = new THREE.Vector3();

// ---------------------------------------------------------------- geometry builder
class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; }
  vert(x, y, z, nx, ny, nz, u, v, col) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.c.push(col[0], col[1], col[2]);
  }
  // 4 points in CCW order seen from outside.
  quad(pts, normal, uvs, cols) {
    const idx = [0, 1, 2, 0, 2, 3];
    for (const i of idx) {
      const q = pts[i];
      this.vert(q[0], q[1], q[2], normal[0], normal[1], normal[2], uvs[i][0], uvs[i][1], cols[i]);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

function rgb(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}
const scale3 = (c, s) => [c[0] * s, c[1] * s, c[2] * s];

function worldUV(q, normal, s) {
  if (Math.abs(normal[0]) > 0.5) return [q[2] * s, q[1] * s];
  if (Math.abs(normal[1]) > 0.5) return [q[0] * s, q[2] * s];
  return [q[0] * s, q[1] * s];
}

// Adds a box. mode 'world' tiles the texture in world space; 'face' maps each face 0..1.
function addBoxGeo(geo, b, color, mode, s = 0.25) {
  const { minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y1, maxZ: z1 } = b;
  const base = rgb(color);
  const ao = y0 < 0.01 ? 0.7 : 0.92;
  const lo = scale3(base, ao), hi = base, top = scale3(base, 1.04);
  const faces = [
    { n: [1, 0, 0], p: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]] },
    { n: [-1, 0, 0], p: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]] },
    { n: [0, 0, 1], p: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
    { n: [0, 0, -1], p: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]] },
    { n: [0, 1, 0], p: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]] },
  ];
  if (y0 > 0.01) faces.push({ n: [0, -1, 0], p: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] });
  for (const f of faces) {
    const uvs = mode === 'world' ? f.p.map((q) => worldUV(q, f.n, s)) : [[0, 0], [1, 0], [1, 1], [0, 1]];
    const cols = f.n[1] !== 0 ? [top, top, top, top] : [lo, lo, hi, hi];
    geo.quad(f.p, f.n, uvs, cols);
  }
}

function addRampGeo(geo, r, color) {
  const { minX: x0, maxX: x1, minZ: z0, maxZ: z1, hMin: a, hMax: c } = r;
  const base = rgb(color), lo = scale3(base, 0.75);
  const s = 0.25;
  const top = [[x0, a, z0], [x1, a, z0], [x1, c, z1], [x0, c, z1]];
  // CCW from above: order must give an upward normal.
  const topCCW = [top[3], top[2], top[1], top[0]];
  const l = Math.hypot(1, r.k);
  const tn = [0, 1 / l, -r.k / l];
  geo.quad(topCCW, tn, topCCW.map((q) => [q[0] * s, q[2] * s]), [base, base, base, base]);
  geo.quad([[x1, 0, z1], [x1, 0, z0], [x1, a, z0], [x1, c, z1]], [1, 0, 0], [[z1 * s, 0], [z0 * s, 0], [z0 * s, a * s], [z1 * s, c * s]], [lo, lo, base, base]);
  geo.quad([[x0, 0, z0], [x0, 0, z1], [x0, c, z1], [x0, a, z0]], [-1, 0, 0], [[z0 * s, 0], [z1 * s, 0], [z1 * s, c * s], [z0 * s, a * s]], [lo, lo, base, base]);
  if (a > 0.01) geo.quad([[x1, 0, z0], [x0, 0, z0], [x0, a, z0], [x1, a, z0]], [0, 0, -1], [[x1 * s, 0], [x0 * s, 0], [x0 * s, a * s], [x1 * s, a * s]], [lo, lo, base, base]);
  if (c > 0.01) geo.quad([[x0, 0, z1], [x1, 0, z1], [x1, c, z1], [x0, c, z1]], [0, 0, 1], [[x0 * s, 0], [x1 * s, 0], [x1 * s, c * s], [x0 * s, c * s]], [lo, lo, base, base]);
}

function flatQuad(geo, x0, z0, x1, z1, y, color, uvScale = 0.25) {
  const c = rgb(color);
  const p = [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]];
  geo.quad(p, [0, 1, 0], p.map((q) => [q[0] * uvScale, q[2] * uvScale]), [c, c, c, c]);
}

// ---------------------------------------------------------------- the arena
export function buildMap(scene) {
  const world = new World();
  const wallGeo = new Geo(), crateGeo = new Geo(), platGeo = new Geo(), neonGeo = new Geo(), floorGeo = new Geo(), paintGeo = new Geo(), shadowGeo = new Geo();
  const solids = [];

  const neonCap = (b, color) => {
    const e = 0.03;
    addBoxGeo(neonGeo, { minX: b.minX - e, maxX: b.maxX + e, minZ: b.minZ - e, maxZ: b.maxZ + e, minY: b.maxY - 0.12, maxY: b.maxY + 0.03 }, 0xffffff, 'face');
    tintLast(neonGeo, color);
  };
  const wall = (x0, z0, x1, z1, h, color, neon, y0 = 0) => {
    const b = world.addBox(x0, y0, z0, x1, h, z1);
    addBoxGeo(wallGeo, b, color, 'world');
    if (neon) neonCap(b, neon);
    solids.push(b);
    return b;
  };
  const plat = (x0, z0, x1, z1, h, color, neon) => {
    const b = world.addBox(x0, 0, z0, x1, h, z1);
    addBoxGeo(platGeo, b, color, 'world');
    if (neon) neonCap(b, neon);
    solids.push(b);
    return b;
  };
  const crate = (cx, cz, w, h, color, y0 = 0, d = w) => {
    const b = world.addBox(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2);
    addBoxGeo(crateGeo, b, color, 'face');
    solids.push(b);
    return b;
  };
  const ramp = (x0, z0, x1, z1, hMin, hMax, color) => {
    const r = world.addRamp(x0, z0, x1, z1, hMin, hMax);
    addRampGeo(platGeo, r, color);
    return r;
  };

  // Outer walls
  wall(-31, -35, 31, -34, 6, COL.cream, NEON.cyan);
  wall(-31, 34, 31, 35, 6, COL.cream, NEON.cyan);
  wall(-31, -34, -30, 34, 6, COL.cream, NEON.cyan);
  wall(30, -34, 31, 34, 6, COL.cream, NEON.cyan);
  // Neon belt on the inside of the outer walls
  for (const b of [
    { minX: -30, maxX: 30, minZ: -34.05, maxZ: -33.97 }, { minX: -30, maxX: 30, minZ: 33.97, maxZ: 34.05 },
    { minX: -30.05, maxX: -29.97, minZ: -34, maxZ: 34 }, { minX: 29.97, maxX: 30.05, minZ: -34, maxZ: 34 },
  ]) {
    addBoxGeo(neonGeo, { ...b, minY: 1.0, maxY: 1.12 }, 0xffffff, 'face');
    tintLast(neonGeo, NEON.violet);
  }

  // Lane dividers with doorways
  wall(-11, -20, -10, -4, 4.5, COL.coral, NEON.yellow);
  wall(-11, 2, -10, 20, 4.5, COL.coral, NEON.yellow);
  wall(-11, -4, -10, 2, 4.5, COL.coral, NEON.yellow, 3.2);
  wall(10, -20, 11, -8, 4.5, COL.coral, NEON.yellow);
  wall(10, -2, 11, 20, 4.5, COL.coral, NEON.yellow);
  wall(10, -8, 11, -2, 4.5, COL.coral, NEON.yellow, 3.2);
  // West lane splitter
  wall(-21, -10, -20, 10, 4.5, COL.mint, NEON.pink);
  // North site cover walls
  wall(-20, -29, -19, -22, 3, COL.sky, NEON.lime);
  wall(19, -29, 20, -22, 3, COL.sky, NEON.lime);
  // Low cover walls
  wall(-6, 10, -2, 10.8, 1.1, COL.mint, NEON.cyan);
  wall(2, -10.8, 6, -10, 1.1, COL.mint, NEON.cyan);
  wall(-8, 24, -3, 24.8, 1.2, COL.mint, NEON.pink);
  wall(3, 24, 8, 24.8, 1.2, COL.mint, NEON.pink);
  wall(-28, 15, -24, 15.8, 1.2, COL.sky, NEON.yellow);
  wall(13, -24, 17, -23.2, 1.2, COL.sky, NEON.yellow);

  // East catwalk and ramp
  plat(24, -18, 30, 4, 2.6, COL.lav, NEON.pink);
  ramp(24, 4, 30, 12, 2.6, 0, COL.lav);
  // North platform and ramp
  plat(-7, -31, 7, -25, 1.6, COL.lav, NEON.cyan);
  ramp(-3, -25, 3, -20, 1.6, 0, COL.lav);

  // Crates
  crate(0, 0, 2.2, 2.2, COL.orange);
  crate(1.95, -0.6, 1.2, 1.2, COL.teal);
  crate(-1.7, 1.3, 1.2, 1.2, COL.yellow);
  crate(0, 0, 1.2, 1.0, COL.pink, 2.2);
  crate(6, 8, 1.6, 1.6, COL.pink);
  crate(-6, -8, 1.6, 1.6, COL.teal);
  crate(-7, 16, 1.2, 1.2, COL.orange);
  crate(7, -16, 1.2, 1.2, COL.yellow);
  crate(-25, 5, 2, 2, COL.orange);
  crate(-15, -13, 1.2, 1.2, COL.teal);
  crate(-25, -15, 1.6, 1.6, COL.pink);
  crate(-15, 13, 1.6, 1.6, COL.yellow);
  crate(-27.5, -26, 1.2, 1.2, COL.teal);
  crate(16, 10, 2, 2, COL.teal);
  crate(15, -13, 1.2, 1.2, COL.orange);
  crate(19, -4, 1.8, 2.4, COL.pink);
  crate(20.5, -26, 1.6, 1.6, COL.yellow);
  crate(-10, -28, 1.6, 1.6, COL.orange);
  crate(10, -28, 1.6, 1.6, COL.teal);
  crate(-25, -31, 2, 2, COL.yellow);
  crate(25, -31, 2, 2, COL.pink);
  crate(-5, -32.8, 1.2, 1.2, COL.orange, 1.6);
  crate(5, -32.8, 1.2, 1.2, COL.teal, 1.6);
  crate(-20, 28, 1.6, 1.6, COL.teal);
  crate(20, 28, 1.6, 1.6, COL.orange);
  crate(-26.5, 24, 1.2, 1.2, COL.yellow);
  crate(26.5, 31.5, 1.2, 1.2, COL.pink);
  crate(27, 16, 1.6, 1.6, COL.yellow);
  crate(27.5, -6, 1.0, 1.0, COL.orange, 2.6);

  // Floor zones with gentle tints
  const zones = [
    [-30, -34, 30, -20, 0xe2d4ff], // north
    [-30, 20, 30, 34, 0xc9f2df], // south
    [-30, -20, -11, 20, 0xc8e0ff], // west lane
    [11, -20, 30, 20, 0xffd2e2], // east lane
    [-11, -20, 11, 20, 0xffeac4], // mid
  ];
  for (const z of zones) flatQuad(floorGeo, z[0], z[1], z[2], z[3], 0, z[4]);

  // Painted lines and spawn pad
  const paint = (x0, z0, x1, z1, c) => flatQuad(paintGeo, x0, z0, x1, z1, 0.012, c);
  paint(-10, -20.15, 10, -19.85, 0xffc23d);
  paint(-10, 19.85, 10, 20.15, 0xffc23d);
  paint(-30, -20.15, -11, -19.85, 0x6aa8ff);
  paint(-30, 19.85, -11, 20.15, 0x6aa8ff);
  paint(11, -20.15, 30, -19.85, 0xff6fa5);
  paint(11, 19.85, 30, 20.15, 0xff6fa5);
  for (let i = 0; i < 6; i++) paint(-3 + i, -20, -2.5 + i, -19.2, i % 2 ? 0x333344 : 0xffc23d);
  for (let z = -16; z <= 16; z += 4) paint(-0.12, z, 0.12, z + 2, 0xffffff);
  // spawn ring
  const ringSeg = 28;
  for (let i = 0; i < ringSeg; i++) {
    if (i % 2) continue;
    const a0 = (i / ringSeg) * Math.PI * 2, a1 = ((i + 1) / ringSeg) * Math.PI * 2;
    const r0 = 2.4, r1 = 2.8, cx = 0, cz = 29;
    const c = rgb(0x3ad6ff);
    const p = [
      [cx + Math.cos(a0) * r0, 0.012, cz + Math.sin(a0) * r0], [cx + Math.cos(a0) * r1, 0.012, cz + Math.sin(a0) * r1],
      [cx + Math.cos(a1) * r1, 0.012, cz + Math.sin(a1) * r1], [cx + Math.cos(a1) * r0, 0.012, cz + Math.sin(a1) * r0],
    ];
    paintGeo.quad([p[0], p[3], p[2], p[1]], [0, 1, 0], [[0, 0], [0, 0], [0, 0], [0, 0]], [c, c, c, c]);
  }

  // Soft contact shadows around everything that stands on the floor
  for (const b of solids) {
    if (b.minY > 0.01) continue;
    const w = 0.9, y = 0.006;
    const k = [0, 0, 0];
    const quads = [
      { p: [[b.maxX, y, b.maxZ], [b.maxX + w, y, b.maxZ], [b.maxX + w, y, b.minZ], [b.maxX, y, b.minZ]], uv: [[0, 1], [0, 0], [0, 0], [0, 1]] },
      { p: [[b.minX - w, y, b.maxZ], [b.minX, y, b.maxZ], [b.minX, y, b.minZ], [b.minX - w, y, b.minZ]], uv: [[0, 0], [0, 1], [0, 1], [0, 0]] },
      { p: [[b.minX, y, b.maxZ + w], [b.maxX, y, b.maxZ + w], [b.maxX, y, b.maxZ], [b.minX, y, b.maxZ]], uv: [[0, 0], [0, 0], [0, 1], [0, 1]] },
      { p: [[b.minX, y, b.minZ], [b.maxX, y, b.minZ], [b.maxX, y, b.minZ - w], [b.minX, y, b.minZ - w]], uv: [[0, 1], [0, 1], [0, 0], [0, 0]] },
    ];
    for (const q of quads) shadowGeo.quad(q.p, [0, 1, 0], q.uv.map(([u, v]) => [u + 0.5, v]), [k, k, k, k]);
  }

  const floorTex = floorTexture();
  const wallTex = wallTexture();
  const crateTex = crateTexture();
  const shTex = shadowTexture(false);
  const meshes = [
    new THREE.Mesh(floorGeo.build(), new THREE.MeshStandardMaterial({ map: floorTex, vertexColors: true, roughness: 0.92, metalness: 0 })),
    new THREE.Mesh(paintGeo.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })),
    new THREE.Mesh(shadowGeo.build(), new THREE.MeshBasicMaterial({ map: shTex, color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
    new THREE.Mesh(wallGeo.build(), new THREE.MeshStandardMaterial({ map: wallTex, vertexColors: true, roughness: 0.85 })),
    new THREE.Mesh(platGeo.build(), new THREE.MeshStandardMaterial({ map: wallTex, vertexColors: true, roughness: 0.8 })),
    new THREE.Mesh(crateGeo.build(), new THREE.MeshStandardMaterial({ map: crateTex, vertexColors: true, roughness: 0.75 })),
    new THREE.Mesh(neonGeo.build(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true })),
  ];
  for (const m of meshes) { m.matrixAutoUpdate = false; m.updateMatrix(); scene.add(m); }

  scene.add(buildDecor());

  world.playerSpawn = new THREE.Vector3(0, 0, 29);
  world.enemySpawns = [
    [-24, -28], [24, -28], [0, -28], [-14, -24], [14, -24], [-26, -18], [17, -20], [27, -12], [-25, -6], [0, -22],
  ].map(([x, z]) => new THREE.Vector3(x, world.support(x, z, 0.3, 3), z));
  world.pickupSpots = [
    ['health', -25.5, -2], ['ammo', -15, 3], ['health', 27, -10], ['ammo', 16, 3], ['health', 0, 14], ['ammo', 0, -27.5],
    ['ammo', -22, 31], ['health', 22, 31], ['armor', -25, 28], ['armor', 25, -26],
  ].map(([kind, x, z]) => ({ kind, pos: new THREE.Vector3(x, world.support(x, z, 0.3, 3), z) }));
  world.buildNav(0, 22);
  return world;
}

function tintLast(geo, c) {
  // Recolor the 30 vertices of the last box (5 faces) or 36 (6 faces) with an HDR neon color.
  const n = geo.c.length;
  for (let i = n - 36 * 3; i < n; i += 3) {
    if (i < 0) continue;
    geo.c[i] = c[0]; geo.c[i + 1] = c[1]; geo.c[i + 2] = c[2];
  }
}

// Colorful towers and clouds outside the arena.
function buildDecor() {
  const group = new THREE.Group();
  const towers = [];
  const cols = [0xff9fc8, 0x9fd8ff, 0xffe08a, 0xb8a6ff, 0x8ff0cf, 0xffb38a];
  let k = 0;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2;
    const r = 58 + (i % 3) * 14;
    const h = 14 + ((i * 7) % 5) * 6;
    const w = 6 + (i % 4) * 2;
    const g = new RoundedBoxGeometry(w, h, w, 2, 1.2);
    g.translate(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
    const c = new THREE.Color(cols[k++ % cols.length]);
    const arr = new Float32Array(g.attributes.position.count * 3);
    for (let j = 0; j < arr.length; j += 3) { arr[j] = c.r; arr[j + 1] = c.g; arr[j + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    towers.push(g);
    // glowing cap
    const cap = new THREE.CylinderGeometry(w * 0.32, w * 0.32, 0.6, 12);
    cap.translate(Math.cos(a) * r, h - 0.6, Math.sin(a) * r);
    const cc = i % 2 ? NEON.cyan : NEON.pink;
    const arr2 = new Float32Array(cap.attributes.position.count * 3);
    for (let j = 0; j < arr2.length; j += 3) { arr2[j] = cc[0]; arr2[j + 1] = cc[1]; arr2[j + 2] = cc[2]; }
    cap.setAttribute('color', new THREE.BufferAttribute(arr2, 3));
    cap.deleteAttribute('uv');
    g.deleteAttribute('uv');
    towers.push(cap);
  }
  const tg = mergeGeometries(towers.map((g) => (g.index ? g.toNonIndexed() : g)));
  const tMesh = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true }));
  group.add(tMesh);

  const blobs = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = 120 + (i % 3) * 40;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r, cy = 55 + (i % 4) * 10;
    for (let j = 0; j < 5; j++) {
      const s = 7 + ((i + j) % 3) * 3;
      const g = new THREE.IcosahedronGeometry(s, 1);
      g.scale(1.3, 0.75, 1);
      g.translate(cx + (j - 2) * s * 1.1, cy + (j % 2) * 3, cz + ((j * 5) % 3 - 1) * 4);
      g.deleteAttribute('uv');
      blobs.push(g);
    }
  }
  const cMesh = new THREE.Mesh(mergeGeometries(blobs), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9aa6c8, emissiveIntensity: 0.35, flatShading: true }));
  group.add(cMesh);
  group.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
  return group;
}

export function buildSky(scene) {
  const geo = new THREE.SphereGeometry(500, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(0x3d8bff) }, mid: { value: new THREE.Color(0x9fd0ff) }, bot: { value: new THREE.Color(0xffe6c8) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = h > 0.15 ? mix(mid, top, smoothstep(0.15, 0.8, h)) : mix(bot, mid, smoothstep(-0.05, 0.15, h)); gl_FragColor = vec4(c, 1.0);\n#include <colorspace_fragment>\n}',
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1;
  m.frustumCulled = false;
  scene.add(m);
  return m;
}
