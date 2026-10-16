import { fmtTime } from './util.js';

const $ = (id) => document.getElementById(id);

// HUD writes only touch the DOM when a value changes.
export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), wave: $('hud-wave'), timer: $('hud-timer'), left: $('hud-left'), score: $('hud-score'), coins: $('hud-coins'),
      hp: $('hud-hp'), hpFill: $('hp-fill'), ar: $('hud-ar'), arFill: $('ar-fill'), lives: $('hud-lives'),
      wname: $('hud-wname'), ammo: $('hud-ammo'), reserve: $('hud-reserve'), reload: $('hud-reload'), reloadFill: $('reload-fill'),
      slots: $('slots'), hint: $('hint'), center: $('center-msg'), coinpop: $('coinpop'), killfeed: $('killfeed'),
      cross: $('crosshair'), hit: $('hitmarker'), scope: $('scope'), hurt: $('hurt'), lowhp: $('lowhp'), dirs: $('dmgdirs'),
      toast: $('toast'), boss: $('bossbar'), bossFill: $('bb-fill'),
    };
    this.cache = {};
    this.centerT = 0;
    this.hurtT = 0;
  }

  set(key, el, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    if (fn) fn(el, value); else el.textContent = value;
  }

  update(s) {
    const e = this.el;
    this.set('wave', e.wave, `第 ${s.wave}/${s.totalWaves} 波`);
    this.set('timer', e.timer, s.timerText);
    this.set('timerCls', e.timer, s.timerCls, (el, v) => { el.className = 'tag timer ' + v; });
    this.set('left', e.left, s.leftText);
    this.set('score', e.score, String(s.score));
    this.set('coins', e.coins, String(s.coins));
    this.set('hp', e.hp, String(Math.ceil(s.hp)));
    this.set('hpw', e.hpFill, Math.round((s.hp / s.maxHp) * 100), (el, v) => { el.style.width = v + '%'; });
    this.set('low', e.hp.parentElement, s.hp > 0 && s.hp <= 30, (el, v) => el.classList.toggle('low', v));
    this.set('lowv', e.lowhp, s.hp > 0 && s.hp <= 30 && s.playing, (el, v) => el.classList.toggle('on', v));
    this.set('ar', e.ar, String(Math.ceil(s.armor)));
    this.set('arw', e.arFill, Math.round(s.armor), (el, v) => { el.style.width = v + '%'; });
    this.set('lives', e.lives, s.livesHtml, (el, v) => { el.innerHTML = v; });
    this.set('wname', e.wname, s.wname);
    this.set('ammo', e.ammo, String(s.mag));
    this.set('ammoEmpty', e.ammo, s.mag === 0, (el, v) => el.classList.toggle('empty', v));
    this.set('reserve', e.reserve, s.reserve === Infinity ? '∞' : String(s.reserve));
    this.set('reloading', e.reload, s.reloadK >= 0, (el, v) => el.classList.toggle('on', v));
    if (s.reloadK >= 0) e.reloadFill.style.width = Math.round(s.reloadK * 100) + '%';
    this.set('slots', e.slots, s.slotsHtml, (el, v) => { el.innerHTML = v; });
    this.set('hint', e.hint, s.hint);
    this.set('gap', e.cross, Math.round(s.gap), (el, v) => el.style.setProperty('--gap', v + 'px'));
    this.set('onT', e.cross, s.onTarget, (el, v) => el.classList.toggle('on-target', v));
    this.set('scope', e.scope, s.scoped, (el, v) => el.classList.toggle('hidden', !v));
    this.set('crossVis', e.cross, s.scoped || !s.alive, (el, v) => { el.style.visibility = v ? 'hidden' : 'visible'; });
    this.set('boss', e.boss, s.bossK >= 0, (el, v) => el.classList.toggle('hidden', !v));
    if (s.bossK >= 0) this.set('bossw', e.bossFill, Math.round(s.bossK * 100), (el, v) => { el.style.width = v + '%'; });
  }

  center(html, time = 2) {
    const c = this.el.center;
    c.innerHTML = html;
    c.classList.remove('pop');
    void c.offsetWidth;
    c.classList.add('pop');
    this.centerT = time;
  }

  tick(dt) {
    if (this.centerT > 0) {
      this.centerT -= dt;
      if (this.centerT <= 0) this.el.center.innerHTML = '';
    }
    if (this.hurtT > 0) {
      this.hurtT -= dt;
      if (this.hurtT <= 0) this.el.hurt.style.opacity = '0';
    }
  }

  hitMarker(kind) {
    const h = this.el.hit;
    h.className = '';
    void h.offsetWidth;
    h.className = 'show' + (kind ? ' ' + kind : '');
  }

  coinPop(text) {
    const c = this.el.coinpop;
    c.textContent = text;
    c.classList.remove('show');
    void c.offsetWidth;
    c.classList.add('show');
    const coins = this.el.coins.parentElement;
    coins.classList.remove('bump');
    void coins.offsetWidth;
    coins.classList.add('bump');
  }

  toast(text) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
  }

  hurt(amount) {
    this.el.hurt.style.opacity = String(Math.min(1, 0.35 + amount / 30));
    this.hurtT = 0.18;
  }

  damageDir(angle) {
    const d = document.createElement('div');
    d.className = 'dd';
    d.style.transform = `rotate(${angle}rad)`;
    this.el.dirs.appendChild(d);
    setTimeout(() => d.remove(), 1150);
    while (this.el.dirs.children.length > 5) this.el.dirs.firstChild.remove();
  }

  kill(weapon, bot, head) {
    const k = document.createElement('div');
    k.className = 'kf';
    k.innerHTML = `<span class="you">你</span><span class="w">[${weapon}]</span>击毁 <span class="bot">${bot}</span>${head ? '<span class="hs">爆头</span>' : ''}`;
    const f = this.el.killfeed;
    f.prepend(k);
    while (f.children.length > 5) f.lastChild.remove();
    setTimeout(() => k.classList.add('fade'), 4600);
    setTimeout(() => k.remove(), 5100);
  }

  clearFeed() {
    this.el.killfeed.innerHTML = '';
    this.el.dirs.innerHTML = '';
    this.el.center.innerHTML = '';
    this.centerT = 0;
  }
}

export { fmtTime };
