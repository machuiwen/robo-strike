import { store, rand } from './util.js';

// All sound is synthesized live with Web Audio. No audio files.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.muted = store.get('roboStrike.muted') === '1';
    this.musicOn = store.get('roboStrike.music') !== '0';
    this.listener = null; // { pos, yaw }
    this.musicPlaying = false;
    this.step = 0;
    this.nextTime = 0;
    this.intensity = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { this.ctx = null; return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(c.destination);
    this.sfx = c.createGain();
    this.sfx.gain.value = 0.8;
    this.sfx.connect(this.master);
    this.mus = c.createGain();
    this.mus.gain.value = this.musicOn ? 0.22 : 0;
    this.mus.connect(this.master);
    const len = c.sampleRate;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // unlock on iOS
    const b = c.createBuffer(1, 1, c.sampleRate);
    const s = c.createBufferSource();
    s.buffer = b;
    s.connect(c.destination);
    s.start(0);
    this.startMusic();
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }

  setMuted(m) {
    this.muted = m;
    store.set('roboStrike.muted', m ? '1' : '0');
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.02);
  }

  setMusic(on) {
    this.musicOn = on;
    store.set('roboStrike.music', on ? '1' : '0');
    if (this.mus) this.mus.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.05);
  }

  // ---------------------------------------------------------------- building blocks
  tone({ type = 'sine', f0 = 440, f1 = null, dur = 0.1, vol = 0.2, attack = 0.003, delay = 0, dest = null, curve = 'exp' }) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== null) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      else o.frequency.linearRampToValueAtTime(f1, t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise({ dur = 0.1, vol = 0.2, type = 'bandpass', f0 = 1000, f1 = null, q = 1, delay = 0, dest = null, attack = 0.002 }) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== null) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest || this.sfx);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  // A panned, distance-faded output for sounds in the world.
  spatial(at, maxD = 40) {
    if (!at || !this.listener) return { dest: this.sfx, vol: 1 };
    const L = this.listener;
    const dx = at.x - L.pos.x, dz = at.z - L.pos.z;
    const d = Math.hypot(dx, dz);
    const vol = Math.max(0, 1 - d / maxD) ** 1.3;
    // right vector of the listener: (cos yaw, 0, -sin yaw)
    const pan = d > 0.1 ? (dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d : 0;
    const c = this.ctx;
    if (!c.createStereoPanner) return { dest: this.sfx, vol };
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan * 0.8));
    p.connect(this.sfx);
    setTimeout(() => { try { p.disconnect(); } catch (e) { /* ignore */ } }, 1500);
    return { dest: p, vol };
  }

  play(name, o = {}) {
    if (!this.ctx || this.muted) return;
    const fn = SFX[name];
    if (!fn) return;
    const sp = o.at ? this.spatial(o.at, o.maxD) : { dest: this.sfx, vol: 1 };
    if (sp.vol < 0.02) return;
    try { fn(this, sp.dest, sp.vol * (o.vol ?? 1), o); } catch (e) { /* ignore audio errors */ }
  }

  // ---------------------------------------------------------------- music
  startMusic() {
    if (this.musicPlaying || !this.ctx) return;
    this.musicPlaying = true;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  schedule() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const spb = 60 / 124 / 4; // 16th notes
    while (this.nextTime < c.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += spb;
      this.step = (this.step + 1) % 64;
    }
  }

  playStep(step, t) {
    if (!this.musicOn) return;
    const c = this.ctx;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    // C - G - Am - F, bright and simple
    const roots = [48, 43, 45, 41];
    const chords = [[0, 4, 7], [0, 4, 7], [0, 3, 7], [0, 4, 7]];
    const root = roots[bar];
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const env = (o, g, t0, dur, vol) => {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(this.mus);
      o.start(t0); o.stop(t0 + dur + 0.02);
    };
    // kick
    if (s % 4 === 0) {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      env(o, g, t, 0.16, 0.9);
    }
    // hats
    if (s % 2 === 1) {
      const n = c.createBufferSource(); n.buffer = this.noiseBuf;
      const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      n.connect(f); f.connect(g); g.connect(this.mus);
      n.start(t, Math.random() * 0.5); n.stop(t + 0.06);
    }
    // snare clap
    if (s === 4 || s === 12) {
      const n = c.createBufferSource(); n.buffer = this.noiseBuf;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      n.connect(f); f.connect(g); g.connect(this.mus);
      n.start(t, Math.random() * 0.5); n.stop(t + 0.16);
    }
    // bass
    if (s % 2 === 0) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle';
      const oct = s % 4 === 2 ? 12 : 0;
      o.frequency.value = hz(root - 12 + oct);
      env(o, g, t, 0.18, 0.5);
    }
    // arpeggio
    const ch = chords[bar];
    const arp = [0, 1, 2, 1, 0, 2, 1, 2];
    if (s % 2 === 0) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'square';
      const n = root + 12 + ch[arp[(s / 2) % 8]] + (s >= 8 ? 12 : 0);
      o.frequency.value = hz(n);
      env(o, g, t, 0.12, 0.07);
    }
    // a little lead melody on the last bar
    if (bar === 3 && (s === 0 || s === 6 || s === 10 || s === 12)) {
      const mel = { 0: 77, 6: 76, 10: 74, 12: 72 };
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle';
      o.frequency.value = hz(mel[s]);
      env(o, g, t, 0.25, 0.12);
    }
  }
}

const SFX = {
  rifle(a, d, v) {
    a.tone({ type: 'square', f0: 1300, f1: 220, dur: 0.09, vol: 0.12 * v, dest: d });
    a.noise({ type: 'bandpass', f0: 2600, f1: 500, dur: 0.07, vol: 0.28 * v, q: 0.8, dest: d });
    a.tone({ type: 'sine', f0: 160, f1: 50, dur: 0.1, vol: 0.35 * v, dest: d });
  },
  pistol(a, d, v) {
    a.tone({ type: 'square', f0: 1800, f1: 300, dur: 0.08, vol: 0.12 * v, dest: d });
    a.noise({ type: 'highpass', f0: 1500, dur: 0.05, vol: 0.2 * v, dest: d });
    a.tone({ type: 'sine', f0: 200, f1: 60, dur: 0.08, vol: 0.25 * v, dest: d });
  },
  scatter(a, d, v) {
    a.noise({ type: 'lowpass', f0: 4000, f1: 300, dur: 0.3, vol: 0.55 * v, dest: d });
    a.tone({ type: 'sine', f0: 110, f1: 40, dur: 0.22, vol: 0.5 * v, dest: d });
    a.tone({ type: 'square', f0: 700, f1: 120, dur: 0.12, vol: 0.08 * v, dest: d });
  },
  rail(a, d, v) {
    a.tone({ type: 'sawtooth', f0: 180, f1: 2200, dur: 0.16, vol: 0.12 * v, dest: d });
    a.tone({ type: 'sine', f0: 3200, f1: 600, dur: 0.35, vol: 0.18 * v, dest: d, delay: 0.02 });
    a.noise({ type: 'bandpass', f0: 5000, f1: 800, dur: 0.3, vol: 0.2 * v, q: 2, dest: d });
    a.tone({ type: 'sine', f0: 90, f1: 40, dur: 0.25, vol: 0.4 * v, dest: d });
  },
  bubble(a, d, v) {
    a.tone({ type: 'sine', f0: 260, f1: 900, dur: 0.14, vol: 0.35 * v, dest: d });
    a.tone({ type: 'sine', f0: 520, f1: 1400, dur: 0.1, vol: 0.15 * v, dest: d, delay: 0.05 });
  },
  pop(a, d, v) {
    a.tone({ type: 'sine', f0: 1400, f1: 300, dur: 0.12, vol: 0.4 * v, dest: d });
    a.noise({ type: 'highpass', f0: 2500, dur: 0.08, vol: 0.3 * v, dest: d });
    a.tone({ type: 'triangle', f0: 600, f1: 1800, dur: 0.15, vol: 0.12 * v, dest: d, delay: 0.04 });
  },
  hit(a, d, v) {
    a.tone({ type: 'square', f0: 2200, f1: 1600, dur: 0.05, vol: 0.07 * v, dest: d });
    a.tone({ type: 'triangle', f0: 3100, dur: 0.07, vol: 0.06 * v, dest: d });
  },
  headshot(a, d, v) {
    a.tone({ type: 'sine', f0: 1760, dur: 0.22, vol: 0.2 * v, dest: d });
    a.tone({ type: 'sine', f0: 2637, dur: 0.3, vol: 0.14 * v, dest: d, delay: 0.05 });
  },
  wallHit(a, d, v) {
    a.noise({ type: 'bandpass', f0: 3000, dur: 0.04, vol: 0.06 * v, q: 3, dest: d });
  },
  robotDie(a, d, v) {
    a.noise({ type: 'bandpass', f0: 1800, f1: 200, dur: 0.4, vol: 0.45 * v, q: 0.7, dest: d });
    a.tone({ type: 'sine', f0: 180, f1: 40, dur: 0.3, vol: 0.45 * v, dest: d });
    a.tone({ type: 'square', f0: 900, f1: 90, dur: 0.35, vol: 0.06 * v, dest: d });
    for (let i = 0; i < 5; i++) {
      a.tone({ type: 'triangle', f0: rand(1800, 4200), dur: 0.08, vol: 0.08 * v, dest: d, delay: 0.15 + i * rand(0.06, 0.14) });
    }
  },
  enemyShot(a, d, v) {
    a.tone({ type: 'sawtooth', f0: 900, f1: 260, dur: 0.18, vol: 0.06 * v, dest: d });
    a.tone({ type: 'sine', f0: 600, f1: 200, dur: 0.15, vol: 0.12 * v, dest: d });
  },
  whiz(a, d, v) {
    a.tone({ type: 'sine', f0: 1400, f1: 500, dur: 0.18, vol: 0.08 * v, dest: d });
  },
  zap(a, d, v) {
    a.noise({ type: 'bandpass', f0: 1200, dur: 0.08, vol: 0.12 * v, q: 4, dest: d });
  },
  hurt(a, d, v) {
    a.tone({ type: 'sine', f0: 260, f1: 110, dur: 0.2, vol: 0.4 * v, dest: d });
    a.noise({ type: 'lowpass', f0: 900, dur: 0.15, vol: 0.3 * v, dest: d });
  },
  armorHit(a, d, v) {
    a.tone({ type: 'triangle', f0: 900, f1: 500, dur: 0.12, vol: 0.2 * v, dest: d });
    a.noise({ type: 'bandpass', f0: 2500, dur: 0.06, vol: 0.12 * v, q: 3, dest: d });
  },
  step(a, d, v, o) {
    a.noise({ type: 'lowpass', f0: o.alt ? 420 : 340, dur: 0.07, vol: 0.13 * v, dest: d });
    a.tone({ type: 'sine', f0: o.alt ? 95 : 80, f1: 50, dur: 0.06, vol: 0.12 * v, dest: d });
  },
  botStep(a, d, v) {
    a.tone({ type: 'triangle', f0: 180, f1: 90, dur: 0.06, vol: 0.12 * v, dest: d });
  },
  jump(a, d, v) { a.tone({ type: 'sine', f0: 320, f1: 560, dur: 0.1, vol: 0.06 * v, dest: d }); },
  land(a, d, v) {
    a.noise({ type: 'lowpass', f0: 300, dur: 0.12, vol: 0.25 * v, dest: d });
    a.tone({ type: 'sine', f0: 90, f1: 40, dur: 0.1, vol: 0.2 * v, dest: d });
  },
  reloadOut(a, d, v) {
    a.noise({ type: 'highpass', f0: 3000, dur: 0.03, vol: 0.15 * v, dest: d });
    a.tone({ type: 'square', f0: 500, f1: 300, dur: 0.05, vol: 0.05 * v, dest: d });
  },
  reloadIn(a, d, v) {
    a.noise({ type: 'bandpass', f0: 2000, dur: 0.04, vol: 0.2 * v, q: 2, dest: d });
    a.tone({ type: 'square', f0: 800, f1: 1200, dur: 0.06, vol: 0.06 * v, dest: d, delay: 0.05 });
    a.tone({ type: 'sine', f0: 600, f1: 1400, dur: 0.15, vol: 0.06 * v, dest: d, delay: 0.08 });
  },
  empty(a, d, v) { a.tone({ type: 'square', f0: 1200, dur: 0.03, vol: 0.05 * v, dest: d }); },
  switch(a, d, v) {
    a.noise({ type: 'highpass', f0: 2500, dur: 0.04, vol: 0.12 * v, dest: d });
    a.tone({ type: 'triangle', f0: 700, f1: 1000, dur: 0.06, vol: 0.05 * v, dest: d, delay: 0.04 });
  },
  pickup(a, d, v) {
    [660, 880, 1320].forEach((f, i) => a.tone({ type: 'triangle', f0: f, dur: 0.12, vol: 0.14 * v, dest: d, delay: i * 0.06 }));
  },
  coin(a, d, v) {
    a.tone({ type: 'square', f0: 1320, dur: 0.07, vol: 0.06 * v, dest: d });
    a.tone({ type: 'square', f0: 1760, dur: 0.18, vol: 0.06 * v, dest: d, delay: 0.07 });
  },
  buy(a, d, v) {
    a.tone({ type: 'square', f0: 990, dur: 0.06, vol: 0.07 * v, dest: d });
    a.tone({ type: 'square', f0: 1480, dur: 0.08, vol: 0.07 * v, dest: d, delay: 0.06 });
    a.tone({ type: 'triangle', f0: 1980, dur: 0.2, vol: 0.1 * v, dest: d, delay: 0.12 });
  },
  deny(a, d, v) { a.tone({ type: 'square', f0: 220, f1: 160, dur: 0.18, vol: 0.08 * v, dest: d }); },
  click(a, d, v) { a.tone({ type: 'triangle', f0: 900, dur: 0.04, vol: 0.08 * v, dest: d }); },
  warn(a, d, v) {
    a.tone({ type: 'sine', f0: 880, dur: 0.09, vol: 0.12 * v, dest: d });
    a.tone({ type: 'sine', f0: 660, dur: 0.12, vol: 0.12 * v, dest: d, delay: 0.14 });
  },
  spawn(a, d, v) {
    a.tone({ type: 'sine', f0: 200, f1: 1400, dur: 0.4, vol: 0.12 * v, dest: d });
    a.tone({ type: 'triangle', f0: 400, f1: 2000, dur: 0.35, vol: 0.06 * v, dest: d, delay: 0.05 });
  },
  waveStart(a, d, v) {
    [0, 4, 7, 12].forEach((n, i) => a.tone({ type: 'sawtooth', f0: 262 * Math.pow(2, n / 12), dur: 0.35, vol: 0.06 * v, dest: d, delay: i * 0.09 }));
    a.tone({ type: 'sine', f0: 130, f1: 65, dur: 0.6, vol: 0.3 * v, dest: d });
  },
  waveClear(a, d, v) {
    [0, 4, 7, 12, 7, 12, 16].forEach((n, i) => a.tone({ type: 'triangle', f0: 523 * Math.pow(2, n / 12), dur: 0.22, vol: 0.14 * v, dest: d, delay: i * 0.09 }));
  },
  gameOver(a, d, v) {
    [7, 4, 0, -5].forEach((n, i) => a.tone({ type: 'triangle', f0: 392 * Math.pow(2, n / 12), dur: 0.35, vol: 0.14 * v, dest: d, delay: i * 0.2 }));
  },
  victory(a, d, v) {
    [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => a.tone({ type: 'square', f0: 523 * Math.pow(2, n / 12), dur: 0.3, vol: 0.07 * v, dest: d, delay: i * 0.1 }));
    [0, 4, 7].forEach((n) => a.tone({ type: 'triangle', f0: 523 * Math.pow(2, n / 12), dur: 1.2, vol: 0.1 * v, dest: d, delay: 0.75 }));
  },
  countdown(a, d, v) { a.tone({ type: 'sine', f0: 660, dur: 0.12, vol: 0.15 * v, dest: d }); },
  go(a, d, v) { a.tone({ type: 'sine', f0: 1320, dur: 0.3, vol: 0.18 * v, dest: d }); },
};
