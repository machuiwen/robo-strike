export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

// localStorage can be missing or throw (private mode, blocked storage), so every access is guarded.
export const store = {
  get(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  },
  set(k, v) {
    try { window.localStorage.setItem(k, String(v)); } catch (e) { /* ignore */ }
  },
};

// Ray helpers. All return the hit distance t or -1.
export function raySphere(o, d, c, r, maxT) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  if (t < 0 || t > maxT) return -1;
  return t;
}

// Vertical cylinder at (cx, cz), from y0 to y1.
export function rayCylinder(o, d, cx, cz, r, y0, y1, maxT) {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) {
    if (ox * ox + oz * oz > r * r) return -1;
    const t = d.y > 0 ? (y0 - o.y) / d.y : (y1 - o.y) / d.y;
    return t >= 0 && t <= maxT ? t : -1;
  }
  const b = ox * d.x + oz * d.z;
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let best = -1;
  const t0 = (-b - s) / a, t1 = (-b + s) / a;
  for (const t of [t0, t1]) {
    if (t < 0 || t > maxT) continue;
    const y = o.y + d.y * t;
    if (y >= y0 && y <= y1 && (best < 0 || t < best)) best = t;
  }
  if (Math.abs(d.y) > 1e-6) {
    for (const yc of [y0, y1]) {
      const t = (yc - o.y) / d.y;
      if (t < 0 || t > maxT) continue;
      const x = ox + d.x * t, z = oz + d.z * t;
      if (x * x + z * z <= r * r && (best < 0 || t < best)) best = t;
    }
  }
  return best;
}
