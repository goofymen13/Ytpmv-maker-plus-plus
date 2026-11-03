/* Shared helpers. Everything hangs off window.YT so the app can run from file:// with no build step. */
window.YT = window.YT || {};
(function (YT) {
  'use strict';
  const U = YT.util = {};

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, k) => a + (b - a) * k;
  U.mtof = m => 440 * 2 ** ((m - 69) / 12);
  U.ftom = f => 69 + 12 * Math.log2(f / 440);
  U.smooth = k => k * k * (3 - 2 * k);

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  U.noteName = m => {
    const r = Math.round(m);
    return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
  };

  U.rng = seed => {
    let a = seed >>> 0;
    return () => {
      a += 0x6D2B79F5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* Stateless 0..1 noise from two integers. Scene code uses this so every frame is reproducible on export. */
  U.noise2 = (a, b = 0) => {
    let h = Math.imul((a | 0) ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul((b | 0) + 0x165667B1, 0xC2B2AE35);
    h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D);
    h = Math.imul(h ^ (h >>> 12), 0x297A2D39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  };

  U.hash = str => {
    let h = 0x811C9DC5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  };

  let uidCounter = 0;
  U.uid = prefix => `${prefix}${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

  U.fmtTime = t => {
    const s = Math.max(0, t || 0);
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;
  };

  U.$ = id => document.getElementById(id);

  /* el('div', {class:'x', onclick:fn}, child, 'text') */
  U.el = (tag, props, ...children) => {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const [name, value] of Object.entries(v)) {
            if (name.startsWith('--')) node.style.setProperty(name, value);
            else node.style[name] = value;
          }
        }
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (k in node && k !== 'list') node[k] = v;
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) if (c != null && c !== false) node.append(c);
    return node;
  };

  U.debounce = (fn, ms) => {
    let timer = 0;
    const wrapped = (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
    wrapped.cancel = () => clearTimeout(timer);
    return wrapped;
  };

  U.sleep = ms => new Promise(r => setTimeout(r, ms));
  U.yieldToUI = () => new Promise(r => setTimeout(r, 0));

  /* Index of the first item whose key is > value. */
  U.upperBound = (list, value, key) => {
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (key(list[mid]) <= value) lo = mid + 1; else hi = mid;
    }
    return lo;
  };

  U.COLORS = ['#ff4d7d', '#3ddcff', '#ffd23f', '#7cff6b', '#c58bff', '#ff9248', '#5effc8', '#ff7ae6', '#8ea7ff', '#e8ff5a', '#ff6b6b', '#6be0ff', '#ffb86b', '#a0ff9e', '#d4a5ff', '#ffa5c0'];

  U.download = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = U.el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    return url;
  };

  U.safeName = s => (s || 'ytpmv').replace(/\.[^.]+$/, '').replace(/[^a-z0-9 _-]/gi, '_').trim() || 'ytpmv';

  U.encodeWav = buffer => {
    const channels = Math.min(2, buffer.numberOfChannels), frames = buffer.length, rate = buffer.sampleRate;
    const bytes = new ArrayBuffer(44 + frames * channels * 2), view = new DataView(bytes);
    const tag = (at, text) => { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };
    tag(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true);
    view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); tag(36, 'data');
    view.setUint32(40, frames * channels * 2, true);
    const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
    let at = 44;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++) {
        view.setInt16(at, Math.round(U.clamp(data[c][i], -1, 1) * 32767), true);
        at += 2;
      }
    }
    return new Blob([bytes], { type: 'audio/wav' });
  };

  /* Tiny event emitter used by the app core. */
  U.emitter = () => {
    const map = new Map();
    return {
      on(name, fn) { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(fn); return () => map.get(name).delete(fn); },
      emit(name, ...args) { const set = map.get(name); if (set) for (const fn of [...set]) fn(...args); }
    };
  };
})(window.YT);
