// Keyboard, mouse (pointer lock with a drag fallback) and touch controls.
export class Input {
  constructor(canvas, touchRoot) {
    this.canvas = canvas;
    this.keys = new Set();
    this.lookDX = 0;
    this.lookDY = 0;
    this.fire = false;
    this.aim = false;
    this.aimToggle = false;
    this.jumpQueued = false;
    this.crouchToggle = false;
    this.joyX = 0;
    this.joyY = 0;
    this.locked = false;
    this.hadLock = false;
    this.touchMode = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
    this.on = {};
    this.active = false; // true while playing (not in menus)
    this.mouseDown = false;
    this.debug = { x: 0, y: 0, active: false };

    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.fire = false; this.aim = false; });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (e.button === 0) { this.fire = true; this.mouseDown = true; }
      if (e.button === 2) this.aim = true;
      if (!this.locked && !this.touchMode) this.emit('wantLock');
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.fire = false; this.mouseDown = false; }
      if (e.button === 2) this.aim = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.active) return;
      if (this.locked || this.mouseDown) {
        this.lookDX += e.movementX || 0;
        this.lookDY += e.movementY || 0;
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (!this.active) return;
      this.emit('cycle', e.deltaY > 0 ? 1 : -1);
    }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) this.hadLock = true;
      if (was && !this.locked) { this.fire = false; this.aim = false; this.mouseDown = false; this.emit('lockLost'); }
    });

    this.setupTouch(touchRoot);
    // Block pinch zoom and double-tap zoom on iOS.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || this.active) e.preventDefault(); }, { passive: false });
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTouchEnd < 320 && this.active) e.preventDefault();
      lastTouchEnd = now;
    }, { passive: false });
  }

  emit(name, arg) { const f = this.on[name]; if (f) f(arg); }

  keyDown(e) {
    const c = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(c)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(c);
    if (this.touchMode && /^Key[WASD]$/.test(c)) this.setTouchMode(false);
    if (c === 'Escape' || c === 'KeyP') this.emit('pause');
    if (c === 'KeyM') this.emit('mute');
    if (c === 'KeyB') this.emit('shop');
    if (c === 'Enter' || c === 'NumpadEnter') this.emit('enter');
    if (!this.active) return;
    if (c === 'Space') this.jumpQueued = true;
    if (c === 'KeyR') this.emit('reload');
    if (c === 'KeyQ') this.emit('quick');
    if (c.startsWith('Digit')) {
      const n = parseInt(c.slice(5), 10);
      if (n >= 1 && n <= 9) this.emit('slot', n - 1);
    }
  }

  setTouchMode(on) {
    if (this.touchMode === on) return;
    this.touchMode = on;
    this.emit('touchMode', on);
  }

  get crouch() {
    return this.keys.has('KeyC') || this.keys.has('ControlLeft') || this.crouchToggle;
  }

  get moveX() {
    let x = 0;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.debug.active) x += this.debug.x;
    return Math.max(-1, Math.min(1, x + this.joyX));
  }

  get moveY() {
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.debug.active) y += this.debug.y;
    return Math.max(-1, Math.min(1, y + this.joyY));
  }

  consumeLook() {
    const r = [this.lookDX, this.lookDY];
    this.lookDX = 0;
    this.lookDY = 0;
    return r;
  }

  // ---------------------------------------------------------------- touch
  setupTouch(root) {
    this.root = root;
    this.joyEl = document.getElementById('joy');
    this.knob = document.getElementById('joy-knob');
    this.joyId = null;
    this.lookIds = new Map(); // touch id -> {x, y}
    this.btnIds = new Map(); // touch id -> element
    this.touchLookScale = 1;
    const opt = { passive: false };
    root.addEventListener('touchstart', (e) => this.tStart(e), opt);
    root.addEventListener('touchmove', (e) => this.tMove(e), opt);
    root.addEventListener('touchend', (e) => this.tEnd(e), opt);
    root.addEventListener('touchcancel', (e) => this.tEnd(e), opt);
  }

  tStart(e) {
    e.preventDefault();
    this.setTouchMode(true);
    this.emit('touchAny');
    for (const t of e.changedTouches) {
      const el = t.target && t.target.closest ? t.target.closest('[data-b]') : null;
      if (el) {
        this.btnIds.set(t.identifier, el);
        el.classList.add('down');
        const b = el.dataset.b;
        if (b === 'fire') { this.fire = true; this.lookIds.set(t.identifier, { x: t.clientX, y: t.clientY }); }
        else if (b === 'jump') this.jumpQueued = true;
        else if (b === 'crouch') { this.crouchToggle = !this.crouchToggle; el.classList.toggle('on', this.crouchToggle); }
        else if (b === 'reload') this.emit('reload');
        else if (b === 'switch') this.emit('cycle', 1);
        else if (b === 'aim') { this.aimToggle = !this.aimToggle; this.aim = this.aimToggle; el.classList.toggle('on', this.aimToggle); }
        else if (b === 'shop') this.emit('shop');
        else if (b === 'go') this.emit('enter');
        continue;
      }
      const slot = t.target && t.target.closest ? t.target.closest('[data-slot]') : null;
      if (slot) { this.emit('slot', parseInt(slot.dataset.slot, 10)); continue; }
      const W = window.innerWidth;
      if (t.clientX < W * 0.42 && this.joyId === null) {
        this.joyId = t.identifier;
        this.joyCX = t.clientX;
        this.joyCY = t.clientY;
        const r = this.joyEl.getBoundingClientRect();
        this.joyEl.style.left = (t.clientX - r.width / 2) + 'px';
        this.joyEl.style.top = (t.clientY - r.height / 2) + 'px';
        this.joyEl.style.bottom = 'auto';
        this.joyEl.classList.add('active');
        this.setKnob(0, 0);
      } else {
        this.lookIds.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    }
  }

  tMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.joyId) {
        const R = 60;
        let dx = t.clientX - this.joyCX, dy = t.clientY - this.joyCY;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
        this.setKnob(dx, dy);
        // small dead zone, then full speed quickly
        const k = Math.max(0, Math.min(1, (Math.min(d, R) - 8) / (R - 20)));
        const n = d > 0.01 ? 1 / d : 0;
        this.joyX = dx * n * k;
        this.joyY = -dy * n * k;
        continue;
      }
      const l = this.lookIds.get(t.identifier);
      if (l) {
        this.lookDX += (t.clientX - l.x) * this.touchLookScale;
        this.lookDY += (t.clientY - l.y) * this.touchLookScale;
        l.x = t.clientX;
        l.y = t.clientY;
      }
    }
  }

  tEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.joyId) {
        this.joyId = null;
        this.joyX = 0;
        this.joyY = 0;
        this.setKnob(0, 0);
        this.joyEl.classList.remove('active');
        this.joyEl.style.left = '';
        this.joyEl.style.top = '';
        this.joyEl.style.bottom = '';
      }
      this.lookIds.delete(t.identifier);
      const el = this.btnIds.get(t.identifier);
      if (el) {
        el.classList.remove('down');
        if (el.dataset.b === 'fire') this.fire = false;
        this.btnIds.delete(t.identifier);
      }
    }
  }

  setKnob(x, y) { this.knob.style.transform = `translate(${x}px, ${y}px)`; }

  resetTouch() {
    this.joyId = null; this.joyX = 0; this.joyY = 0; this.setKnob(0, 0);
    this.lookIds.clear();
    for (const el of this.btnIds.values()) el.classList.remove('down');
    this.btnIds.clear();
    this.fire = false;
    this.crouchToggle = false;
    this.aimToggle = false;
    this.aim = false;
    document.querySelectorAll('.tb.on').forEach((el) => el.classList.remove('on'));
  }
}
