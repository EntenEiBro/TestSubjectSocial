/**
 * hud.js — in-round heads-up display (DOM overlay above the canvas).
 *
 * Minigames talk to the HUD through a tiny API:
 *   hud.setPlayers(seats)            build corner panels
 *   hud.setTimer(seconds | null)     big top-centre clock
 *   hud.setStat(seat, text)          per-player stat line ("PUFFS 4")
 *   hud.setStatus(seat, text)        per-player status tag ("HUNTER")
 *   hud.banner(text, ms)             centre announcement
 *   hud.prompt(text | null)          bottom instruction strip
 *   hud.feed(text, color)            kill feed line
 *   hud.tag(seat, {x,y} | null)      floating name tag (normalized screen coords)
 */
import { formatTime } from '../core/util.js';
import { t, tr } from '../i18n/i18n.js'; // every HUD message is translated with tr()

export class Hud {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-timer hidden"></div>
      <div class="hud-panels"></div>
      <div class="hud-banner hidden"></div>
      <div class="hud-prompt hidden"></div>
      <div class="hud-feed"></div>
      <div class="hud-tags"></div>`;
    this.el = {
      timer: root.querySelector('.hud-timer'),
      panels: root.querySelector('.hud-panels'),
      banner: root.querySelector('.hud-banner'),
      prompt: root.querySelector('.hud-prompt'),
      feed: root.querySelector('.hud-feed'),
      tags: root.querySelector('.hud-tags'),
    };
    this.panelMap = new Map();
    this.tagMap = new Map();
    this._bannerTimeout = null;
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  /** Build per-player corner panels for this round. */
  setPlayers(seats) {
    this.el.panels.innerHTML = '';
    this.el.tags.innerHTML = '';
    this.panelMap.clear();
    this.tagMap.clear();
    seats.forEach((seat, i) => {
      const p = seat.player;
      const div = document.createElement('div');
      div.className = `hud-panel corner-${i}`;
      div.style.setProperty('--pc', p.color);
      div.innerHTML = `<div class="hp-name">${p.name}${p.isBot ? ` <span class="bot">${t('BOT')}</span>` : ''}</div><div class="hp-status"></div><div class="hp-stat"></div>`;
      this.el.panels.appendChild(div);
      this.panelMap.set(seat, div);
      const tag = document.createElement('div');
      tag.className = 'hud-tag hidden';
      tag.style.setProperty('--pc', p.color);
      tag.textContent = `P${p.slot + 1}`;
      this.el.tags.appendChild(tag);
      this.tagMap.set(seat, tag);
    });
  }

  setTimer(sec) {
    if (sec === null || sec === undefined) { this.el.timer.classList.add('hidden'); return; }
    this.el.timer.classList.remove('hidden');
    const txt = formatTime(sec);
    if (this.el.timer.textContent !== txt) this.el.timer.textContent = txt;
    this.el.timer.classList.toggle('urgent', sec <= 5);
  }

  setStat(seat, text) {
    const div = this.panelMap.get(seat);
    if (!div) return;
    const s = div.querySelector('.hp-stat');
    text = tr(text);
    if (s.textContent !== text) s.textContent = text;
  }

  setStatus(seat, text) {
    const div = this.panelMap.get(seat);
    if (!div) return;
    const s = div.querySelector('.hp-status');
    text = tr(text);
    if (s.textContent !== text) s.textContent = text;
  }

  /** Mark a panel as dead (greyed with a skull stamp). */
  markDead(seat, dead = true) {
    const div = this.panelMap.get(seat);
    if (div) div.classList.toggle('dead', dead);
  }

  banner(text, ms = 1600, cls = '') {
    const b = this.el.banner;
    b.className = `hud-banner ${cls}`;
    b.textContent = tr(text);
    clearTimeout(this._bannerTimeout);
    if (ms > 0) this._bannerTimeout = setTimeout(() => b.classList.add('hidden'), ms);
  }

  prompt(text) {
    const p = this.el.prompt;
    if (!text) { p.classList.add('hidden'); return; }
    p.classList.remove('hidden');
    text = tr(text);
    if (p.innerHTML !== text) p.innerHTML = text;
  }

  feed(text, color = '#c33') {
    const line = document.createElement('div');
    line.className = 'feed-line';
    line.style.setProperty('--pc', color);
    line.textContent = tr(text);
    this.el.feed.prepend(line);
    setTimeout(() => line.classList.add('fade'), 3200);
    setTimeout(() => line.remove(), 4000);
  }

  tag(seat, pos) {
    const t = this.tagMap.get(seat);
    if (!t) return;
    if (!pos) { if (!t.classList.contains('hidden')) t.classList.add('hidden'); return; }
    t.classList.remove('hidden');
    t.style.left = `${pos.x * 100}%`;
    t.style.top = `${pos.y * 100}%`;
  }

  /** Remove everything (between rounds). */
  clear() {
    this.el.panels.innerHTML = '';
    this.el.tags.innerHTML = '';
    this.el.feed.innerHTML = '';
    this.el.banner.classList.add('hidden');
    this.el.prompt.classList.add('hidden');
    this.el.timer.classList.add('hidden');
    this.panelMap.clear();
    this.tagMap.clear();
  }
}
