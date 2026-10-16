import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function noise(g, w, h, amt, alpha = 0.05) {
  for (let i = 0; i < amt; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${alpha * Math.random()})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

// Floor: 2 x 2 tiles per texture repeat. Light tiles with soft grout and corner studs.
export function floorTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#efefef';
  g.fillRect(0, 0, S, S);
  const T = S / 2;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const shade = (i + j) % 2 ? '#ebebeb' : '#f7f7f7';
      g.fillStyle = shade;
      g.fillRect(i * T + 3, j * T + 3, T - 6, T - 6);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(i * T + 6, j * T + 6, T - 12, 3);
    }
  }
  g.strokeStyle = '#cdcdcd';
  g.lineWidth = 4;
  for (let k = 0; k <= 2; k++) {
    g.beginPath(); g.moveTo(k * T, 0); g.lineTo(k * T, S); g.stroke();
    g.beginPath(); g.moveTo(0, k * T); g.lineTo(S, k * T); g.stroke();
  }
  g.fillStyle = '#c0c0c0';
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) {
    g.beginPath(); g.arc(i * T, j * T, 6, 0, Math.PI * 2); g.fill();
  }
  noise(g, S, S, 3000, 0.06);
  return tex(c);
}

// Wall panels: mostly white so vertex colors can tint them.
export function wallTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#f4f4f4';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#e6e6e6';
  g.fillRect(0, 0, S, 40);
  g.fillStyle = '#dcdcdc';
  g.fillRect(0, 36, S, 4);
  g.strokeStyle = '#cfcfcf';
  g.lineWidth = 3;
  g.strokeRect(8, 52, S / 2 - 16, S - 64);
  g.strokeRect(S / 2 + 8, 52, S / 2 - 16, S - 64);
  g.fillStyle = '#d2d2d2';
  for (const [x, y] of [[16, 60], [S / 2 - 16, 60], [16, S - 20], [S / 2 - 16, S - 20], [S / 2 + 16, 60], [S - 16, 60], [S / 2 + 16, S - 20], [S - 16, S - 20]]) {
    g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.fillRect(12, 56, S / 2 - 24, 6);
  g.fillRect(S / 2 + 12, 56, S / 2 - 24, 6);
  noise(g, S, S, 2000, 0.05);
  return tex(c);
}

// Crate: frame, X brace, mostly light so vertex color tints it.
export function crateTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#c9c9c9';
  g.fillRect(0, 0, S, 26); g.fillRect(0, S - 26, S, 26);
  g.fillRect(0, 0, 26, S); g.fillRect(S - 26, 0, 26, S);
  g.strokeStyle = '#d0d0d0';
  g.lineWidth = 22;
  g.beginPath(); g.moveTo(30, 30); g.lineTo(S - 30, S - 30); g.stroke();
  g.beginPath(); g.moveTo(S - 30, 30); g.lineTo(30, S - 30); g.stroke();
  g.fillStyle = '#ffffff';
  g.fillRect(S / 2 - 50, S / 2 - 22, 100, 44);
  g.fillStyle = '#9a9a9a';
  g.font = 'bold 30px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('ROBO', S / 2, S / 2 + 2);
  g.fillStyle = '#a8a8a8';
  for (const [x, y] of [[13, 13], [S - 13, 13], [13, S - 13], [S - 13, S - 13]]) {
    g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
  }
  noise(g, S, S, 1500, 0.06);
  return tex(c, false);
}

// Robot faces. kind: 'idle' | 'alert' | 'hit'; drone: one big eye.
export function eyeTexture(kind, drone = false) {
  const W = 128, H = drone ? 128 : 72;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#0b1020';
  if (drone) {
    g.beginPath(); g.arc(W / 2, H / 2, 62, 0, Math.PI * 2); g.fill();
  } else {
    const r = 22;
    g.beginPath();
    g.moveTo(r, 0); g.arcTo(W, 0, W, H, r); g.arcTo(W, H, 0, H, r); g.arcTo(0, H, 0, 0, r); g.arcTo(0, 0, W, 0, r);
    g.fill();
  }
  const col = kind === 'alert' ? '#ff5a4f' : kind === 'hit' ? '#ffe14f' : '#4ff2ff';
  g.fillStyle = col;
  g.strokeStyle = col;
  g.lineCap = 'round';
  if (drone) {
    if (kind === 'hit') {
      g.lineWidth = 14;
      g.beginPath(); g.moveTo(40, 40); g.lineTo(88, 88); g.moveTo(88, 40); g.lineTo(40, 88); g.stroke();
    } else {
      g.beginPath(); g.arc(W / 2, H / 2, 34, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0b1020';
      g.beginPath(); g.arc(W / 2, H / 2, 14, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath(); g.arc(W / 2 - 14, H / 2 - 14, 7, 0, Math.PI * 2); g.fill();
      if (kind === 'alert') {
        g.fillStyle = '#0b1020';
        g.fillRect(20, 20, 88, 22);
      }
    }
  } else if (kind === 'hit') {
    g.lineWidth = 9;
    for (const cx of [38, 90]) {
      const s = cx < 64 ? 1 : -1;
      g.beginPath(); g.moveTo(cx - 12 * s, 22); g.lineTo(cx + 10 * s, 36); g.lineTo(cx - 12 * s, 50); g.stroke();
    }
  } else {
    for (const cx of [38, 90]) {
      g.beginPath(); g.ellipse(cx, 36, 14, 18, 0, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (const cx of [33, 85]) { g.beginPath(); g.arc(cx, 29, 5, 0, Math.PI * 2); g.fill(); }
    if (kind === 'alert') {
      g.fillStyle = '#0b1020';
      g.beginPath(); g.moveTo(16, 8); g.lineTo(60, 26); g.lineTo(60, 8); g.fill();
      g.beginPath(); g.moveTo(112, 8); g.lineTo(68, 26); g.lineTo(68, 8); g.fill();
    }
  }
  return tex(c, false);
}

// Soft round sprite for sparks and glows.
export function glowTexture() {
  const S = 64;
  const [c, g] = canvas(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return tex(c, false, false);
}

// Star-shaped muzzle flash.
export function flashTexture() {
  const S = 128;
  const [c, g] = canvas(S, S);
  g.translate(S / 2, S / 2);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.3, 'rgba(255,255,255,0.8)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath();
  const n = 7;
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 ? 18 : 62;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  return tex(c, false, false);
}

// Dark laser burn mark.
export function scorchTexture() {
  const S = 64;
  const [c, g] = canvas(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(20,20,30,0.6)');
  gr.addColorStop(0.3, 'rgba(30,30,40,0.35)');
  gr.addColorStop(1, 'rgba(30,30,40,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return tex(c, false, false);
}

// Soft gradient used for contact shadows at the base of walls and under robots.
export function shadowTexture(radial) {
  const S = 64;
  const [c, g] = canvas(S, S);
  let gr;
  if (radial) {
    gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(0,0,0,0.5)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
  } else {
    gr = g.createLinearGradient(0, 0, 0, S);
    gr.addColorStop(0, 'rgba(0,0,0,0.42)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
  }
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  const t = tex(c, false, false);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
