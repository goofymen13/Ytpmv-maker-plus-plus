/* Draws one frame of the YTPMV for a given time. Everything is a pure function of the plan and t,
   except trails, so preview and export show the same picture. */
(function (YT) {
  'use strict';
  const U = YT.util, { clamp, lerp, noise2 } = U;
  const TAU = Math.PI * 2, DEG = Math.PI / 180;

  const hexRgb = hex => {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  };
  const hexAlpha = (hex, a) => {
    const [r, g, b] = hexRgb(hex);
    return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
  };
  const envAt = (env, name, t) => {
    const arr = env && env[name];
    if (!arr) return 0;
    const i = Math.floor(t * env.rate);
    return i >= 0 && i < arr.length ? arr[i] : 0;
  };
  const easeOut = k => 1 - (1 - k) ** 3;
  const backOut = k => { const c = 1.9; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; };
  const elasticOut = k => (k <= 0 ? 0 : k >= 1 ? 1 : 2 ** (-9 * k) * Math.sin((k * 10 - .75) * TAU / 3) + 1);

  /* ---------- Stage window arrangements, in 0..1 screen space ---------- */
  function subdivide(rect, count) {
    if (count <= 1) return [rect];
    const [x, y, w, h] = rect;
    const landscape = w >= h;
    const cols = count === 2 ? (landscape ? 2 : 1) : count === 3 ? (landscape ? 3 : 1) : Math.ceil(Math.sqrt(count * (landscape ? 1.3 : .8)));
    const rows = Math.ceil(count / cols);
    const out = [];
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / cols);
      const inRow = row === rows - 1 ? count - cols * (rows - 1) : cols;
      const col = i % cols;
      out.push([x + col * w / inRow, y + row * h / rows, w / inRow, h / rows]);
    }
    return out;
  }

  function arrangeWindows(n, mode) {
    if (n <= 0) return [];
    if (n === 1) return [[0, 0, 1, 1]];
    const others = n - 1;
    switch (mode) {
      case 'columns': return Array.from({ length: n }, (_, i) => [i / n, 0, 1 / n, 1]);
      case 'rows': return Array.from({ length: n }, (_, i) => [0, i / n, 1, 1 / n]);
      case 'grid': return subdivide([0, 0, 1, 1], n);
      case 'leadTop': {
        const rest = subdivide([0, .68, 1, .32], others);
        return [[0, 0, 1, .68], ...rest];
      }
      case 'corners': {
        const spots = [[.01, .02, .22, .27], [.77, .02, .22, .27], [.01, .71, .22, .27], [.77, .71, .22, .27], [.01, .365, .18, .27], [.81, .365, .18, .27], [.39, .01, .22, .2], [.39, .79, .22, .2]];
        return [[.17, .12, .66, .76], ...Array.from({ length: others }, (_, i) => spots[i % spots.length])];
      }
      default: {
        if (n === 2) return [[0, 0, .6, 1], [.6, 0, .4, 1]];
        return [[0, 0, .62, 1], ...subdivide([.62, 0, .38, 1], others)];
      }
    }
  }

  function shapePath(g, shape, w, h, radius) {
    const x = -w / 2, y = -h / 2;
    g.beginPath();
    switch (shape) {
      case 'round': {
        const r = Math.min(w, h) * (radius ?? .12);
        g.roundRect(x, y, w, h, r);
        break;
      }
      case 'circle': g.ellipse(0, 0, w / 2, h / 2, 0, 0, TAU); break;
      case 'diamond': g.moveTo(0, y); g.lineTo(-x, 0); g.lineTo(0, -y); g.lineTo(x, 0); g.closePath(); break;
      case 'hex': for (let i = 0; i < 6; i++) { const a = i * TAU / 6; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * w / 2, Math.sin(a) * h / 2); } g.closePath(); break;
      case 'star':
        for (let i = 0; i < 10; i++) {
          const a = i * TAU / 10 - Math.PI / 2, r = i % 2 ? .46 : 1;
          g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * w / 2 * r, Math.sin(a) * h / 2 * r);
        }
        g.closePath();
        break;
      case 'heart':
        g.moveTo(0, h * .38);
        g.bezierCurveTo(-w * .62, -h * .02, -w * .34, -h * .55, 0, -h * .16);
        g.bezierCurveTo(w * .34, -h * .55, w * .62, -h * .02, 0, h * .38);
        g.closePath();
        break;
      default: g.rect(x, y, w, h);
    }
  }

  /* Per-note motion: how a clip moves for a short time after it is hit. */
  function motionIn(cfg, age, tw, th, W, H, seed) {
    const m = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, alpha: 1 };
    const len = Math.max(.001, cfg.motionTime / 1000), k = clamp(age / len, 0, 1), amt = cfg.motionAmt / 100;
    if (k >= 1 || cfg.motionIn === 'none') return m;
    const left = 1 - k;
    switch (cfg.motionIn) {
      case 'punch': { const s = 1 + .13 * amt * left ** 2; m.sx = m.sy = s; break; }
      case 'pop': { const s = lerp(1 - .4 * amt, 1, backOut(k)); m.sx = m.sy = s; break; }
      case 'elastic': { const s = lerp(1 - .6 * amt, 1, elasticOut(k)); m.sx = m.sy = s; break; }
      case 'squash': { const w = Math.cos(k * Math.PI * 3) * left * .28 * amt; m.sx = 1 + w; m.sy = 1 - w; break; }
      case 'bounce': m.dy = -Math.abs(Math.sin(k * Math.PI * 2.5)) * left * th * .22 * amt; break;
      case 'shake':
        m.dx = (noise2(seed, Math.floor(age * 60)) - .5) * tw * .16 * amt * left;
        m.dy = (noise2(seed + 1, Math.floor(age * 60)) - .5) * th * .16 * amt * left;
        break;
      case 'wobble': m.rot = Math.sin(k * Math.PI * 4) * left * .22 * amt; break;
      case 'slideL': m.dx = -(1 - easeOut(k)) * tw * .8 * amt; break;
      case 'slideR': m.dx = (1 - easeOut(k)) * tw * .8 * amt; break;
      case 'slideU': m.dy = -(1 - easeOut(k)) * th * .8 * amt; break;
      case 'slideD': m.dy = (1 - easeOut(k)) * th * .8 * amt; break;
      case 'drop': m.dy = -(1 - elasticOut(k)) * H * .4 * amt; break;
      case 'whip': m.dx = -(1 - easeOut(k)) * W * .7 * amt; m.sx = 1 + left * .6 * amt; break;
      case 'spin': m.rot = -(1 - easeOut(k)) * TAU * amt; { const s = easeOut(k); m.sx = m.sy = s; } break;
      case 'flipX': m.sx = Math.max(.02, easeOut(k)); break;
      case 'flipY': m.sy = Math.max(.02, easeOut(k)); break;
      case 'zoomIn': { const s = 1 + (1 - easeOut(k)) * 1.4 * amt; m.sx = m.sy = s; m.alpha = easeOut(k); break; }
      case 'zoomOut': { const s = lerp(.15, 1, easeOut(k)); m.sx = m.sy = s; break; }
    }
    return m;
  }

  function motionHold(cfg, m, age, beat, tw, th, seed) {
    const a = cfg.susAmt / 100;
    switch (cfg.motionSus) {
      case 'breathe': { const s = 1 + Math.sin(age * 5) * .025 * a; m.sx *= s; m.sy *= s; break; }
      case 'kenburns': { const s = 1 + Math.min(1, age * .35) * .12 * a; m.sx *= s; m.sy *= s; break; }
      case 'sway': m.rot += Math.sin(age * 4) * .05 * a; break;
      case 'spin': m.rot += age * .6 * a; break;
      case 'jitter':
        m.dx += (noise2(seed, Math.floor(age * 30)) - .5) * tw * .03 * a;
        m.dy += (noise2(seed + 1, Math.floor(age * 30)) - .5) * th * .03 * a;
        break;
      case 'pulse': { const s = 1 + beat * .08 * a; m.sx *= s; m.sy *= s; break; }
    }
  }

  function motionOut(cfg, m, remaining, tw, th, H) {
    if (cfg.motionOut === 'cut') return;
    const len = Math.max(.001, cfg.outTime / 1000);
    if (remaining >= len) return;
    const k = 1 - clamp(remaining / len, 0, 1);
    switch (cfg.motionOut) {
      case 'fade': m.alpha *= 1 - k; break;
      case 'shrink': m.sx *= 1 - k; m.sy *= 1 - k; break;
      case 'slide': m.dx += k * k * tw; m.alpha *= 1 - k * .3; break;
      case 'drop': m.dy += k * k * H * .7; break;
      case 'spin': m.rot += k * 2; m.sx *= 1 - k; m.sy *= 1 - k; break;
      case 'flash': m.flash = Math.max(m.flash || 0, k); m.alpha *= 1 - k * .5; break;
    }
  }

  function tileFilter(cfg, ev) {
    const hue = cfg.hueShift + (cfg.hueByPitch ? ((ev.midi % 12) / 12) * 360 * cfg.hueByPitch / 100 : 0) + (cfg.hueByWord ? ev.step * cfg.hueByWord : 0);
    const inverted = cfg.invertMode === 'always' || (cfg.invertMode === 'hit' && ev.hit % 2 === 1);
    let f = '';
    if (hue) f += `hue-rotate(${hue}deg) `;
    if (cfg.sat !== 100) f += `saturate(${cfg.sat}%) `;
    if (cfg.bright !== 100) f += `brightness(${cfg.bright}%) `;
    if (cfg.contrast !== 100) f += `contrast(${cfg.contrast}%) `;
    if (cfg.gray) f += `grayscale(${cfg.gray}%) `;
    if (cfg.sepia) f += `sepia(${cfg.sepia}%) `;
    if (inverted) f += 'invert(100%) ';
    if (cfg.blurPx) f += `blur(${cfg.blurPx}px) `;
    return f || 'none';
  }

  class Scene {
    constructor(output) {
      this.output = output;
      this.canvas = document.createElement('canvas');
      this.g = this.canvas.getContext('2d', { alpha: false });
      this.post = new YT.PostFX(output);
      this.bgThumb = document.createElement('canvas');
      this.bgThumb.width = 64;
      this.bgThumb.height = 36;
      this.bgThumbG = this.bgThumb.getContext('2d');
      this.hasBg = false;
      this.w = 0;
      this.h = 0;
      this.lastTime = 0;
      this.windowRects = [];
    }

    resize(w, h) {
      if (this.w === w && this.h === h) return;
      this.w = w;
      this.h = h;
      this.canvas.width = w;
      this.canvas.height = h;
      this.post.resize(w, h);
    }

    /* ---------- What is on screen right now ---------- */
    activeEvents(plan, t) {
      const out = [];
      for (const tr of plan.ordered) {
        if (!tr.cfg.showVisual) continue;
        const list = tr.events;
        let i = U.upperBound(list, t, e => e.start) - 1;
        for (; i >= 0; i--) {
          const e = list[i];
          if (t - e.start > tr.maxVis) break;
          if (t < e.visEnd) out.push(e);
        }
      }
      return out;
    }

    /* Events inside a time window, for the scrolling layouts. */
    eventsAround(plan, from, to) {
      const out = [];
      for (const tr of plan.ordered) {
        if (!tr.cfg.showVisual) continue;
        const list = tr.events;
        let i = U.upperBound(list, to, e => e.start) - 1;
        for (; i >= 0; i--) {
          const e = list[i];
          if (e.start + e.T < from && e.start < from - tr.maxVis) break;
          if (e.start + e.T >= from) out.push(e);
        }
      }
      return out;
    }

    lastEventOn(tr, t) {
      const i = U.upperBound(tr.events, t, e => e.start) - 1;
      return i >= 0 ? tr.events[i] : null;
    }

    /* ---------- Layouts: produce a list of tiles {ev, x, y, w, h} ---------- */
    layout(plan, o, t, active) {
      const W = this.w, H = this.h;
      const margin = o.margin / 100 * Math.min(W, H), gap = o.gap / 100 * Math.min(W, H);
      const ax = margin, ay = margin, aw = W - margin * 2, ah = H - margin * 2;
      const tiles = [];
      const cell = (rect, ev, extra) => {
        const [x, y, w, h] = rect;
        tiles.push({ ev, x: ax + x * aw + gap / 2, y: ay + y * ah + gap / 2, w: Math.max(2, w * aw - gap), h: Math.max(2, h * ah - gap), ...extra });
      };
      const byImportance = list => list.slice().sort((a, b) => b.cfg.layer - a.cfg.layer || b.start - a.start || b.velocity - a.velocity);
      const newestFirst = list => list.slice().sort((a, b) => b.start - a.start || b.midi - a.midi);
      const limit = list => list.slice(0, Math.max(1, o.maxTiles));

      switch (o.layout) {
        case 'full': {
          const pick = byImportance(active)[0];
          if (pick) cell([0, 0, 1, 1], pick);
          break;
        }
        case 'chord': {
          const list = limit(active.slice().sort((a, b) => a.cfg.layer - b.cfg.layer || a.ti - b.ti || a.midi - b.midi));
          const rects = subdivide([0, 0, 1, 1], list.length);
          list.forEach((e, i) => cell(rects[i], e));
          break;
        }
        case 'side': {
          const sides = [null, null];
          for (const e of newestFirst(active)) {
            const s = (e.hit + e.ti) % 2;
            if (!sides[s]) sides[s] = e;
          }
          if (sides[0]) cell([0, 0, .5, 1], sides[0]);
          if (sides[1]) cell([.5, 0, .5, 1], sides[1]);
          break;
        }
        case 'pitchgrid': {
          const cols = o.gridCols, rows = o.gridRows, count = cols * rows;
          for (const e of limit(newestFirst(active)).reverse()) {
            const c = ((e.midi % count) + count) % count;
            cell([(c % cols) / cols, Math.floor(c / cols) / rows, 1 / cols, 1 / rows], e);
          }
          break;
        }
        case 'grid': {
          const cols = o.gridCols, rows = o.gridRows, count = cols * rows;
          const used = new Set();
          for (const e of limit(active.slice().sort((a, b) => a.start - b.start))) {
            let c = e.seed % count;
            for (let n = 0; n < count && used.has(c); n++) c = (c + 1) % count;
            used.add(c);
            cell([(c % cols) / cols, Math.floor(c / cols) / rows, 1 / cols, 1 / rows], e);
          }
          break;
        }
        case 'popup': {
          for (const e of limit(newestFirst(active)).reverse()) {
            const size = o.popupSize / 100 * (1 - o.popupVar / 100 * noise2(e.seed, 3));
            const th = H * size, tw = th * 16 / 9;
            const x = noise2(e.seed, 1) * Math.max(0, W - tw), y = noise2(e.seed, 2) * Math.max(0, H - th);
            tiles.push({ ev: e, x, y, w: tw, h: th, rot: (noise2(e.seed, 4) - .5) * 2 * o.popupRot * DEG });
          }
          break;
        }
        case 'keyboard': {
          const [lo, hi] = plan.pitchSpan;
          for (const e of limit(newestFirst(active)).reverse()) {
            const k = hi > lo ? (e.midi - lo) / (hi - lo) : .5;
            const tw = W * lerp(.18, .3, e.velocity), th = tw * 9 / 16;
            const age = t - e.start;
            tiles.push({ ev: e, x: k * (W - tw), y: H - th - easeOut(clamp(age / .25, 0, 1)) * H * .08 - k * H * .32, w: tw, h: th });
          }
          break;
        }
        case 'scroll':
        case 'roll': {
          const speed = o.scrollSpeed / 100 * W, hit = o.scrollPlayhead / 100 * W;
          const back = hit / speed + .2, ahead = (W - hit) / speed + .2;
          const list = limit(this.eventsAround(plan, t - back, t + ahead).sort((a, b) => Math.abs(a.start - t) - Math.abs(b.start - t)));
          const lanes = plan.ordered.length || 1;
          const [lo, hi] = plan.pitchSpan;
          const span = Math.max(12, hi - lo + 1);
          for (const e of list.reverse()) {
            const x = hit + (e.start - t) * speed;
            const tw = Math.max(W * .05, e.T * speed);
            let y, th;
            if (o.layout === 'scroll') {
              const lane = plan.ordered.findIndex(tr => tr.ti === e.ti);
              th = H / lanes;
              y = lane * th;
            } else {
              th = Math.max(H / span * 3, H * .12);
              y = (1 - (e.midi - lo) / span) * (H - th);
            }
            const playing = t >= e.start && t < e.start + e.T;
            tiles.push({ ev: e, x, y: y + gap / 2, w: tw - gap, h: th - gap, dim: playing ? 0 : .45, noMotion: true });
          }
          break;
        }
        case 'orbit': {
          const spin = t * plan.beatsPerSec * o.orbitSpin * DEG;
          const size = o.orbitSize / 100 * H, radius = o.orbitRadius / 100 * Math.min(W, H);
          const list = limit(newestFirst(active));
          for (const e of list.slice().reverse()) {
            const a = (e.midi % 12) / 12 * TAU + e.ti * .7 + spin;
            const cx = W / 2 + Math.cos(a) * radius * (W / H > 1.2 ? 1.5 : 1), cy = H / 2 + Math.sin(a) * radius;
            const tw = size * (e.cfg.shape === 'circle' ? 1 : 16 / 9);
            tiles.push({ ev: e, x: cx - tw / 2, y: cy - size / 2, w: tw, h: size });
          }
          break;
        }
        case 'spiral': {
          const list = limit(newestFirst(active));
          for (let i = list.length - 1; i >= 0; i--) {
            const s = .78 ** i;
            tiles.push({ ev: list[i], x: W / 2 - W * s / 2, y: H / 2 - H * s / 2, w: W * s, h: H * s, rot: i * 12 * DEG * (i % 2 ? -1 : 1) });
          }
          break;
        }
        case 'cascade': {
          const list = limit(newestFirst(active)).reverse();
          const tw = W * .52, th = tw * 9 / 16;
          const n = list.length;
          list.forEach((e, i) => {
            const k = n > 1 ? i / (n - 1) : .5;
            tiles.push({ ev: e, x: k * (W - tw), y: k * (H - th), w: tw, h: th });
          });
          break;
        }
        case 'stack': {
          for (const e of limit(newestFirst(active)).reverse()) {
            tiles.push({ ev: e, x: 0, y: 0, w: W, h: H, blend: o.stackBlend, alpha: o.stackAlpha / 100 });
          }
          break;
        }
        case 'wall': {
          const cols = o.wallCols, rows = o.wallRows;
          const everyone = plan.events;
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const delay = (r + c) * o.wallDelay / 1000, at = t - delay;
              let i = U.upperBound(everyone, at, e => e.start) - 1, pick = null;
              for (let n = 0; i >= 0 && n < 32; i--, n++) {
                const e = everyone[i];
                if (e.cfg.showVisual && at < e.visEnd && (!pick || e.cfg.layer > pick.cfg.layer)) pick = e;
              }
              if (pick) cell([c / cols, r / rows, 1 / cols, 1 / rows], pick, { atTime: at, flipGrid: o.wallFlip && (r + c) % 2 === 1 });
            }
          }
          break;
        }
        default: {
          /* Stage: every track has its own window. Most YTPMVs are built like this. */
          const ordered = plan.ordered.filter(tr => tr.cfg.showVisual);
          const rects = arrangeWindows(ordered.length, o.arrange);
          this.windowRects = ordered.map((tr, i) => ({ ti: tr.ti, rect: tr.cfg.win || rects[i] }));
          ordered.forEach((tr, i) => {
            const rect = tr.cfg.win || rects[i];
            let list = active.filter(e => e.ti === tr.ti);
            if (!list.length) {
              if (tr.cfg.idleMode === 'freeze') {
                const last = this.lastEventOn(tr, t);
                if (last) cell(rect, last, { idle: true });
              }
              return;
            }
            // Only the newest attack belongs to the window when older notes linger.
            const newest = Math.max(...list.map(e => e.start));
            list = list.filter(e => e.start > newest - .03).sort((a, b) => a.midi - b.midi);
            if (o.chordStyle === 'top') list = [list[list.length - 1]];
            else if (o.chordStyle === 'bottom') list = [list[0]];
            if (o.chordStyle === 'stack') {
              list.forEach((e, n) => {
                const off = n / Math.max(1, list.length);
                cell(rect, e, { offset: off, alpha: n === list.length - 1 ? 1 : .55 });
              });
            } else {
              const parts = subdivide(rect, list.length);
              list.forEach((e, n) => cell(parts[n], e));
            }
          });
        }
      }
      return tiles;
    }

    /* ---------- Backgrounds ---------- */
    drawBackground(g, o, t, plan, primaryFrame, prj) {
      const W = this.w, H = this.h;
      const beat = plan ? envAt(plan.env, 'beat', t) : 0;
      const beatIndex = plan && plan.beats.length ? U.upperBound(plan.beats, t, b => b.time) : 0;
      const speed = o.bgSpeed / 100;
      const pulse = beat * o.bgPulse / 100;
      const hueAngle = beatIndex * o.bgHueBeat;
      const fill = (hex, boost = 0) => {
        const [r, gg, b] = hexRgb(hex).map(v => clamp(v + boost, 0, 1));
        return `rgb(${Math.round(r * 255)},${Math.round(gg * 255)},${Math.round(b * 255)})`;
      };
      const A = fill(o.bgColorA, pulse * .12), B = fill(o.bgColorB, pulse * .2);
      g.filter = hueAngle ? `hue-rotate(${hueAngle}deg)` : 'none';
      switch (o.bgType) {
        case 'gradient': {
          const grad = g.createLinearGradient(0, 0, W * .3, H);
          grad.addColorStop(0, A);
          grad.addColorStop(1, B);
          g.fillStyle = grad;
          g.fillRect(0, 0, W, H);
          break;
        }
        case 'checker': {
          g.fillStyle = A;
          g.fillRect(0, 0, W, H);
          const s = Math.round(H / 8), off = (t * speed * s) % (s * 2);
          g.fillStyle = B;
          for (let y = -2; y < H / s + 2; y++) {
            for (let x = -2; x < W / s + 2; x++) {
              if ((x + y) % 2 === 0) g.fillRect(x * s + off, y * s + off, s, s);
            }
          }
          break;
        }
        case 'stripes': {
          g.fillStyle = A;
          g.fillRect(0, 0, W, H);
          g.fillStyle = B;
          const s = H / 6, off = (t * speed * s * 2) % (s * 2);
          g.save();
          g.translate(W / 2, H / 2);
          g.rotate(-.35);
          for (let i = -8; i < 8; i++) g.fillRect(-W * 1.2, i * s * 2 + off, W * 2.4, s);
          g.restore();
          break;
        }
        case 'tunnel': {
          g.fillStyle = A;
          g.fillRect(0, 0, W, H);
          const max = Math.hypot(W, H) / 2;
          g.lineWidth = H * .012 * (1 + pulse * 2);
          g.strokeStyle = B;
          for (let i = 0; i < 12; i++) {
            const k = ((i / 12 + t * speed * .25) % 1);
            g.globalAlpha = k * k;
            g.strokeRect(W / 2 - max * k * k * 1.6, H / 2 - max * k * k * .9, max * k * k * 3.2, max * k * k * 1.8);
          }
          g.globalAlpha = 1;
          break;
        }
        case 'rays': {
          g.fillStyle = A;
          g.fillRect(0, 0, W, H);
          g.fillStyle = B;
          const max = Math.hypot(W, H), rays = 14, spin = t * speed * .4;
          for (let i = 0; i < rays; i++) {
            const a = i * TAU / rays + spin;
            g.beginPath();
            g.moveTo(W / 2, H / 2);
            g.lineTo(W / 2 + Math.cos(a) * max, H / 2 + Math.sin(a) * max);
            g.lineTo(W / 2 + Math.cos(a + TAU / rays / 2) * max, H / 2 + Math.sin(a + TAU / rays / 2) * max);
            g.closePath();
            g.fill();
          }
          break;
        }
        case 'stars': {
          g.fillStyle = A;
          g.fillRect(0, 0, W, H);
          g.fillStyle = B;
          for (let i = 0; i < 160; i++) {
            const k = (noise2(i, 9) + t * speed * .2) % 1, a = noise2(i, 8) * TAU;
            const r = k * k * Math.hypot(W, H) * .6, size = 1 + k * k * H * .006 * (1 + pulse * 2);
            g.globalAlpha = k;
            g.fillRect(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r, size, size);
          }
          g.globalAlpha = 1;
          break;
        }
        case 'image': {
          g.fillStyle = A;
          g.fillRect(0, 0, W, H);
          if (prj.bgImage) {
            const s = Math.max(W / prj.bgImage.width, H / prj.bgImage.height);
            g.drawImage(prj.bgImage, (W - prj.bgImage.width * s) / 2, (H - prj.bgImage.height * s) / 2, prj.bgImage.width * s, prj.bgImage.height * s);
          }
          break;
        }
        case 'blur': {
          g.fillStyle = A;
          g.fillRect(0, 0, W, H);
          if (primaryFrame) {
            // Blur by shrinking: fast at any resolution and needs no filter support.
            const size = clamp(Math.round(90 - o.bgBlur), 6, 90);
            this.bgThumb.width = size;
            this.bgThumb.height = Math.max(4, Math.round(size * H / W));
            this.bgThumbG.imageSmoothingQuality = 'high';
            this.bgThumbG.drawImage(primaryFrame, 0, 0, this.bgThumb.width, this.bgThumb.height);
            this.hasBg = true;
          }
          if (this.hasBg) {
            g.imageSmoothingEnabled = true;
            g.imageSmoothingQuality = 'high';
            g.drawImage(this.bgThumb, 0, 0, W, H);
            g.fillStyle = `rgba(0,0,0,${clamp(o.bgDim / 100 - pulse * .25, 0, 1)})`;
            g.fillRect(0, 0, W, H);
          }
          break;
        }
        default:
          g.fillStyle = A;
          g.fillRect(0, 0, W, H);
      }
      g.filter = 'none';
    }

    /* ---------- One clip tile ---------- */
    frameFor(ev, age) {
      const clip = ev.clip;
      if (clip.image) return clip.image;
      if (clip.frames) return clip.frames.get(YT.sourceTime(ev, age));
      return null;
    }

    drawCard(g, ev, w, h, age) {
      const k = Math.exp(-age * 7);
      const grad = g.createLinearGradient(0, -h / 2, 0, h / 2);
      grad.addColorStop(0, hexAlpha(ev.color, .55 + k * .4));
      grad.addColorStop(1, hexAlpha(ev.color, .12 + k * .2));
      g.fillStyle = grad;
      g.fillRect(-w / 2, -h / 2, w, h);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const name = (ev.word.name || '♪').toUpperCase();
      const size = Math.min(h * .5, w / Math.max(2, name.length) * 1.4);
      g.font = `900 ${Math.max(8, size)}px Impact, "Arial Black", sans-serif`;
      g.fillText(name, 0, 0);
    }

    drawTile(g, tile, t, plan, o) {
      const ev = tile.ev, cfg = ev.cfg, W = this.w, H = this.h;
      const at = tile.atTime ?? t;
      const age = at - ev.start;
      const m = tile.noMotion ? { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, alpha: 1 } : motionIn(cfg, age, tile.w, tile.h, W, H, ev.seed);
      if (!tile.noMotion) {
        motionHold(cfg, m, age, envAt(plan.env, 'beat', t), tile.w, tile.h, ev.seed);
        if (!tile.idle) motionOut(cfg, m, ev.visEnd - at, tile.w, tile.h, H);
      }
      const size = cfg.tileScale / 100 * (1 + (cfg.velScale / 100) * (ev.velocity - .6));
      let cx = tile.x + tile.w / 2 + m.dx, cy = tile.y + tile.h / 2 + m.dy;
      if (cfg.posJitter) {
        cx += (noise2(ev.seed, 5) - .5) * tile.w * cfg.posJitter / 100;
        cy += (noise2(ev.seed, 6) - .5) * tile.h * cfg.posJitter / 100;
      }
      if (cfg.pitchLift) cy -= (ev.lane - .5) * tile.h * cfg.pitchLift / 100;
      if (tile.offset) { cx += tile.offset * tile.w * .12; cy += tile.offset * tile.h * .12; }
      const rot = (tile.rot || 0) + m.rot + (cfg.rotJitter ? (noise2(ev.seed, 7) - .5) * 2 * cfg.rotJitter * DEG : 0);
      const w = tile.w * size, h = tile.h * size;
      const alpha = (tile.alpha ?? 1) * m.alpha * cfg.opacity / 100;
      if (alpha <= .002) return;

      g.save();
      g.globalAlpha = alpha;
      g.globalCompositeOperation = tile.blend || cfg.blend;
      g.translate(cx, cy);
      g.rotate(rot);
      g.scale(m.sx, m.sy);

      const hitGlow = cfg.glow && !tile.idle ? Math.exp(-age * 7) : 0;
      if (hitGlow > .02 || cfg.shape !== 'rect') {
        // Glow is drawn behind so the clip stays sharp.
        if (hitGlow > .02) {
          g.save();
          g.shadowColor = ev.color;
          g.shadowBlur = cfg.glow * hitGlow * (H / 720);
          g.fillStyle = '#000';
          shapePath(g, cfg.shape, w, h);
          g.fill();
          g.restore();
        }
      }
      g.save();
      shapePath(g, cfg.shape, w, h);
      g.clip();

      const media = this.frameFor(ev, age);
      if (media) {
        const flip = (ev.flipX ? -1 : 1) * (tile.flipGrid ? -1 : 1);
        g.save();
        g.scale(flip, ev.flipY ? -1 : 1);
        const filter = tileFilter(cfg, ev);
        if (filter !== 'none') g.filter = filter;
        const mw = media.width, mh = media.height, zoom = cfg.cropZoom / 100;
        if (cfg.fit === 'stretch') g.drawImage(media, -w / 2, -h / 2, w, h);
        else if (cfg.fit === 'contain') {
          const s = Math.min(w / mw, h / mh) * zoom, dw = mw * s, dh = mh * s;
          g.drawImage(media, -dw / 2, -dh / 2, dw, dh);
        } else {
          const ta = w / h, ma = mw / mh;
          let sw, sh;
          if (ma > ta) { sh = mh / zoom; sw = sh * ta; } else { sw = mw / zoom; sh = sw / ta; }
          g.drawImage(media, (mw - sw) * cfg.focusX / 100, (mh - sh) * cfg.focusY / 100, sw, sh, -w / 2, -h / 2, w, h);
        }
        g.restore();
      } else {
        this.drawCard(g, ev, w, h, Math.max(0, age));
      }

      if (cfg.tintAlpha) {
        g.fillStyle = hexAlpha(cfg.tint, cfg.tintAlpha / 100);
        g.fillRect(-w / 2, -h / 2, w, h);
      }
      const dim = tile.idle ? cfg.idleDim / 100 : (tile.dim || 0);
      if (dim) {
        g.fillStyle = `rgba(0,0,0,${dim})`;
        g.fillRect(-w / 2, -h / 2, w, h);
      }
      const flash = Math.max(m.flash || 0, cfg.hitFlash && !tile.idle ? cfg.hitFlash / 100 * Math.exp(-age * 16) : 0);
      if (flash > .01) {
        g.fillStyle = `rgba(255,255,255,${flash})`;
        g.fillRect(-w / 2, -h / 2, w, h);
      }
      g.restore();

      if (cfg.borderW) {
        shapePath(g, cfg.shape, w, h);
        g.lineWidth = cfg.borderW * H / 720;
        g.strokeStyle = cfg.borderTrack ? ev.color : cfg.borderColor;
        g.stroke();
      }

      if (o.ovTrackLabels || o.ovNoteLabels) {
        const text = [o.ovTrackLabels ? plan.tracks[ev.ti]?.name : '', o.ovNoteLabels ? U.noteName(ev.midi) : ''].filter(Boolean).join('  ');
        const font = Math.max(10, H * .022);
        g.font = `600 ${font}px system-ui`;
        g.textAlign = 'left';
        g.textBaseline = 'bottom';
        g.fillStyle = 'rgba(0,0,0,.65)';
        g.fillRect(-w / 2, h / 2 - font * 1.5, Math.min(w, g.measureText(text).width + font), font * 1.5);
        g.fillStyle = ev.color;
        g.fillText(text, -w / 2 + font * .5, h / 2 - font * .25);
      }
      g.restore();
    }

    /* ---------- Captions ---------- */
    caption(g, o, text, x, y, size, age, color) {
      const shown = o.capUpper ? text.toUpperCase() : text;
      let scale = 1, dx = 0, dy = 0;
      if (o.capAnim === 'pop') scale = lerp(.72, 1, backOut(clamp(age / .12, 0, 1)));
      else if (o.capAnim === 'shake') {
        const k = Math.max(0, 1 - age / .2);
        dx = (noise2(Math.floor(age * 60), 3) - .5) * size * .25 * k;
        dy = (noise2(Math.floor(age * 60), 4) - .5) * size * .25 * k;
      } else if (o.capAnim === 'drop') dy = -(1 - easeOut(clamp(age / .14, 0, 1))) * size;
      g.save();
      g.translate(x + dx, y + dy);
      g.scale(scale, scale);
      g.font = `900 ${size}px ${o.capFont}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      if (o.capStrokeW) {
        g.lineWidth = size * o.capStrokeW / 100;
        g.strokeStyle = o.capStroke;
        g.strokeText(shown, 0, 0);
      }
      g.fillStyle = color;
      g.fillText(shown, 0, 0);
      g.restore();
    }

    drawCaptions(g, o, t, plan, tiles, active) {
      if (o.capMode === 'off') return;
      const W = this.w, H = this.h, size = o.capSize / 100 * H;
      const y = o.capPos === 'top' ? size * .9 : o.capPos === 'middle' ? H / 2 : H - size * .9;
      const eligible = active.filter(e => e.cfg.showCaption && t < e.start + Math.max(e.T, .12));
      if (o.capMode === 'tile') {
        for (const tile of tiles) {
          if (tile.idle || !tile.ev.cfg.showCaption) continue;
          const s = Math.min(size, tile.h * .28);
          const ty = o.capPos === 'top' ? tile.y + s * .8 : o.capPos === 'middle' ? tile.y + tile.h / 2 : tile.y + tile.h - s * .8;
          this.caption(g, o, tile.ev.word.name || '', tile.x + tile.w / 2, ty, s, t - tile.ev.start, o.capTrackColor ? tile.ev.color : o.capColor);
        }
        return;
      }
      const pick = eligible.slice().sort((a, b) => (b.ti === plan.leadTi) - (a.ti === plan.leadTi) || b.start - a.start)[0];
      if (o.capMode === 'word') {
        if (pick) this.caption(g, o, pick.word.name || '', W / 2, y, size, t - pick.start, o.capTrackColor ? pick.color : o.capColor);
        return;
      }
      // Karaoke line: the whole phrase with the current word lit.
      const lineEv = pick || eligible[0];
      if (!lineEv) return;
      const words = lineEv.phraseSteps.filter(s => s.word).map(s => s.word);
      const lineSize = size * .72;
      g.font = `900 ${lineSize}px ${o.capFont}`;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.lineJoin = 'round';
      const texts = words.map(w => (o.capUpper ? (w.name || '').toUpperCase() : w.name || ''));
      const space = lineSize * .35;
      const widths = texts.map(s => g.measureText(s).width);
      let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + space * (texts.length - 1)) / 2;
      const current = lineEv.step;
      texts.forEach((s, i) => {
        const on = i === current;
        if (o.capStrokeW) {
          g.lineWidth = lineSize * o.capStrokeW / 100;
          g.strokeStyle = o.capStroke;
          g.strokeText(s, x, y);
        }
        g.fillStyle = on ? (o.capTrackColor ? lineEv.color : o.capColor) : hexAlpha(o.capColor, .38);
        g.fillText(s, x, y);
        x += widths[i] + space;
      });
    }

    /* ---------- Overlays ---------- */
    drawParticles(g, o, t, plan, tileMap) {
      const W = this.w, H = this.h, type = o.ovParticles;
      const scale = o.ovPartSize / 100 * H / 720, life = .75;
      let i = U.upperBound(plan.events, t, e => e.start) - 1;
      for (let drawn = 0; i >= 0 && drawn < 48; i--, drawn++) {
        const e = plan.events[i], age = t - e.start;
        if (age > life) break;
        const tile = tileMap.get(e.id);
        const ox = tile ? tile.x + tile.w / 2 : noise2(e.seed, 21) * W;
        const oy = tile ? tile.y + tile.h / 2 : noise2(e.seed, 22) * H;
        const k = age / life;
        if (type === 'rings') {
          g.strokeStyle = hexAlpha(e.color, (1 - k) * .9);
          g.lineWidth = 6 * scale * (1 - k);
          g.beginPath();
          g.arc(ox, oy, 20 * scale + easeOut(k) * 260 * scale, 0, TAU);
          g.stroke();
          continue;
        }
        const count = o.ovPartCount;
        for (let p = 0; p < count; p++) {
          const a = noise2(e.seed + p, 23) * TAU, sp = (.3 + noise2(e.seed + p, 24)) * 420 * scale;
          const px = ox + Math.cos(a) * sp * easeOut(k), py = oy + Math.sin(a) * sp * easeOut(k) + k * k * 180 * scale;
          g.globalAlpha = 1 - k;
          if (type === 'sparks') {
            g.fillStyle = e.color;
            g.fillRect(px, py, 5 * scale, 5 * scale);
          } else if (type === 'confetti') {
            g.fillStyle = U.COLORS[(e.seed + p) % U.COLORS.length];
            g.save();
            g.translate(px, py);
            g.rotate(k * 9 + p);
            g.fillRect(-5 * scale, -3 * scale, 10 * scale, 6 * scale);
            g.restore();
          } else {
            g.fillStyle = e.color;
            g.font = `${22 * scale}px system-ui`;
            g.textAlign = 'center';
            g.fillText(p % 2 ? '♪' : '♫', px, py - k * 120 * scale);
          }
        }
        g.globalAlpha = 1;
      }
    }

    drawSpectrum(g, o, t, plan, prj) {
      const W = this.w, H = this.h, mode = o.ovSpectrum;
      const an = prj.song?.analysis;
      const bars = an ? an.bandsN : 32;
      const values = new Float32Array(bars);
      if (an) {
        const pos = (t - plan.songStart) * plan.speed + (prj.options.songTrim || 0);
        const at = Math.floor(pos * an.rate);
        if (at >= 0 && at < an.frames) for (let b = 0; b < bars; b++) values[b] = an.bands[at * bars + b] / 255;
      } else {
        // Without an MP3, approximate from the notes currently sounding.
        const span = plan.pitchSpan[1] - plan.pitchSpan[0] || 1;
        for (const e of this.activeEvents(plan, t)) {
          if (t > e.end) continue;
          const b = clamp(Math.floor((e.midi - plan.pitchSpan[0]) / span * (bars - 1)), 0, bars - 1);
          for (let n = -2; n <= 2; n++) if (b + n >= 0 && b + n < bars) values[b + n] = Math.max(values[b + n], e.velocity * (1 - Math.abs(n) * .3));
        }
      }
      g.globalAlpha = o.ovSpecAlpha / 100;
      g.fillStyle = o.ovSpecColor;
      const maxH = o.ovSpecH / 100 * H;
      if (mode === 'ring') {
        const r = Math.min(W, H) * .24;
        g.lineWidth = Math.max(2, W / 360);
        g.strokeStyle = o.ovSpecColor;
        g.beginPath();
        for (let i = 0; i < bars * 2; i++) {
          const a = i / (bars * 2) * TAU - Math.PI / 2, v = values[i < bars ? i : bars * 2 - 1 - i];
          g.moveTo(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r);
          g.lineTo(W / 2 + Math.cos(a) * (r + v * maxH), H / 2 + Math.sin(a) * (r + v * maxH));
        }
        g.stroke();
      } else {
        const bw = W / bars;
        for (let b = 0; b < bars; b++) {
          const h = values[b] * values[b] * maxH;
          if (mode === 'bottom' || mode === 'mirror') g.fillRect(b * bw + 1, H - h, bw - 2, h);
          if (mode === 'top' || mode === 'mirror') g.fillRect(b * bw + 1, 0, bw - 2, h);
        }
      }
      g.globalAlpha = 1;
    }

    drawRoll(g, o, t, plan) {
      const W = this.w, H = this.h, h = o.ovRollH / 100 * H, y0 = H - h;
      g.globalAlpha = o.ovRollAlpha / 100;
      g.fillStyle = 'rgba(0,0,0,.72)';
      g.fillRect(0, y0, W, h);
      const span = Math.max(12, plan.pitchSpan[1] - plan.pitchSpan[0] + 1), secs = 6, pps = W / secs, hitX = W * .25;
      const noteH = Math.max(2, h / span);
      for (const e of this.eventsAround(plan, t - hitX / pps, t + (W - hitX) / pps)) {
        const x = hitX + (e.start - t) * pps, w = Math.max(2, e.T * pps);
        const y = y0 + (1 - (e.midi - plan.pitchSpan[0]) / span) * (h - noteH);
        const on = t >= e.start && t < e.start + e.T;
        g.fillStyle = on ? '#fff' : e.color;
        g.fillRect(x, y, w, noteH);
      }
      g.fillStyle = '#fff';
      g.fillRect(hitX, y0, 2, h);
      g.globalAlpha = 1;
    }

    drawOverlays(g, o, t, plan, prj, tiles) {
      const W = this.w, H = this.h;
      if (o.ovSpectrum !== 'off') this.drawSpectrum(g, o, t, plan, prj);
      if (o.ovRoll) this.drawRoll(g, o, t, plan);
      if (o.ovParticles !== 'off') {
        const map = new Map();
        for (const tile of tiles) map.set(tile.ev.id, tile);
        this.drawParticles(g, o, t, plan, map);
      }
      if (o.ovProgress) {
        g.fillStyle = 'rgba(255,255,255,.2)';
        g.fillRect(0, H - H * .007, W, H * .007);
        g.fillStyle = '#ff4d7d';
        g.fillRect(0, H - H * .007, W * clamp(t / plan.duration, 0, 1), H * .007);
      }
      if (o.ovOsd) {
        const size = H * .05;
        g.font = `700 ${size}px "Courier New", monospace`;
        g.fillStyle = 'rgba(255,255,255,.88)';
        g.textAlign = 'left';
        g.textBaseline = 'top';
        g.fillText('PLAY ▶', size, size * .8);
        g.textAlign = 'right';
        g.textBaseline = 'bottom';
        const mm = Math.floor(t / 60), ss = Math.floor(t % 60), ff = Math.floor((t % 1) * 30);
        g.fillText(`SP 0:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`, W - size, H - size * .8);
      }
      if (o.ovWatermark) {
        const size = H * .032;
        g.font = `700 ${size}px system-ui`;
        g.fillStyle = `rgba(255,255,255,${o.ovWatermarkAlpha / 100})`;
        const pos = o.ovWatermarkPos;
        g.textAlign = pos[1] === 'r' ? 'right' : 'left';
        g.textBaseline = pos[0] === 'b' ? 'bottom' : 'top';
        g.fillText(o.ovWatermark, pos[1] === 'r' ? W - size : size, pos[0] === 'b' ? H - size : size);
      }
      this.drawCards(g, o, t, plan);
    }

    drawCards(g, o, t, plan) {
      const W = this.w, H = this.h;
      const card = (title, sub, alpha, style) => {
        g.save();
        g.globalAlpha = alpha;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        if (style === 'block') {
          g.fillStyle = '#000';
          g.fillRect(0, 0, W, H);
        }
        if (style === 'lower') {
          g.fillStyle = 'rgba(0,0,0,.72)';
          g.fillRect(0, H * .72, W, H * .2);
          g.textAlign = 'left';
          g.fillStyle = '#fff';
          g.font = `900 ${H * .075}px Impact, "Arial Black", sans-serif`;
          g.fillText(title, W * .05, H * .79);
          if (sub) {
            g.font = `500 ${H * .036}px system-ui`;
            g.fillText(sub, W * .05, H * .865);
          }
        } else {
          g.lineJoin = 'round';
          g.font = `900 ${H * .13}px Impact, "Arial Black", sans-serif`;
          g.lineWidth = H * .018;
          g.strokeStyle = '#000';
          g.strokeText(title, W / 2, H * .46);
          g.fillStyle = '#fff';
          g.fillText(title, W / 2, H * .46);
          if (sub) {
            g.font = `600 ${H * .042}px system-ui`;
            g.lineWidth = H * .008;
            g.strokeText(sub, W / 2, H * .58);
            g.fillText(sub, W / 2, H * .58);
          }
        }
        g.restore();
      };
      if (o.titleText && t < o.titleDur) {
        const a = Math.min(1, t / .25, (o.titleDur - t) / .4);
        card(o.titleText, o.titleSub, clamp(a, 0, 1), o.titleStyle);
      }
      if (o.endText && t > plan.duration - o.endDur) {
        card(o.endText, '', clamp((t - (plan.duration - o.endDur)) / .4, 0, 1), 'center');
      }
    }

    /* ---------- FX uniforms ---------- */
    fxParams(o, t, plan) {
      const hit = plan ? envAt(plan.env, o.fxSource, t) : 0;
      return {
        t, rgb: o.fxRgb + o.fxRgbHit * hit, pix: Math.round(o.fxPixel + o.fxPixelHit * hit),
        wave: (o.fxWave + o.fxWaveHit * hit) / 100, swirl: (o.fxSwirl + o.fxSwirlHit * hit) / 100, bulge: (o.fxBulge + o.fxBulgeHit * hit) / 100,
        glitch: clamp((o.fxGlitch + o.fxGlitchHit * hit) / 100, 0, 1), vhs: o.fxVhs / 100, crt: o.fxCrt / 100,
        kal: o.fxKaleido, kalRot: t * o.fxKaleidoSpin * DEG, mirX: o.fxMirrorX, mirY: o.fxMirrorY,
        zblur: (o.fxZoomBlur + o.fxZoomBlurHit * hit) / 100, bloom: (o.fxBloom + o.fxBloomHit * hit) / 100,
        sharp: o.fxSharpen / 100, edge: o.fxEdge / 100,
        fb: o.fxTrail / 100, fbz: o.fxTrailZoom / 100, fbr: o.fxTrailRot * DEG,
        hue: (o.fxHue + o.fxHueHit * hit + t * o.fxHueSpin) * DEG,
        sat: o.fxSat / 100, con: o.fxContrast / 100, bri: o.fxBright / 100, post: o.fxPosterize / 100,
        inv: clamp((o.fxInvert + o.fxInvertHit * hit) / 100, 0, 1), duo: o.fxDuo / 100, duoA: hexRgb(o.fxDuoA), duoB: hexRgb(o.fxDuoB),
        dith: o.fxDither / 100, vig: o.fxVignette / 100, scan: o.fxScan / 100, grain: o.fxGrain / 100
      };
    }

    /* ---------- The frame ---------- */
    render(prj, plan, t) {
      const g = this.g, o = prj.options, W = this.w, H = this.h;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.filter = 'none';
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'medium';

      if (!plan) {
        g.fillStyle = '#07070c';
        g.fillRect(0, 0, W, H);
        this.post.render(this.canvas, this.fxParams(o, t, null));
        return;
      }
      if (!plan.pitchSpan) {
        let lo = 127, hi = 0;
        for (const e of plan.events) { lo = Math.min(lo, e.midi); hi = Math.max(hi, e.midi); }
        plan.pitchSpan = lo > hi ? [48, 72] : [lo, hi];
        const beatGap = plan.beats.length > 1 ? plan.beats[1].time - plan.beats[0].time : .5;
        plan.beatsPerSec = 1 / Math.max(.01, beatGap);
      }

      const active = this.activeEvents(plan, t);
      const tiles = this.layout(plan, o, t, active);

      /* Blur fill uses whichever clip matters most right now. */
      let primaryFrame = null;
      if (o.bgType === 'blur') {
        const leadEv = active.slice().sort((a, b) => b.cfg.layer - a.cfg.layer || b.start - a.start)[0];
        if (leadEv) primaryFrame = this.frameFor(leadEv, t - leadEv.start);
      }
      this.drawBackground(g, o, t, plan, primaryFrame, prj);

      /* Camera. */
      const beat = envAt(plan.env, 'beat', t), kick = envAt(plan.env, 'kick', t), snare = envAt(plan.env, 'snare', t);
      const barIndex = plan.beats.length ? (plan.beats[Math.max(0, U.upperBound(plan.beats, t, b => b.time) - 1)]?.bar || 0) : 0;
      const zoom = 1 + o.camBeat / 100 * beat + o.camKick / 100 * kick + (o.camZoom ? o.camZoom / 100 * (.5 + .5 * Math.sin(t * .6)) : 0);
      const shake = o.camSnare / 100 * snare * H * .05;
      const rot = (o.camBarRot ? o.camBarRot * DEG * (barIndex % 2 ? 1 : -1) : 0) + (o.camSway ? Math.sin(t * .9) * o.camSway * DEG : 0) + t * o.camSpin * DEG;
      g.save();
      g.translate(W / 2 + (shake ? (noise2(Math.floor(t * 60), 31) - .5) * 2 * shake : 0), H / 2 + (shake ? (noise2(Math.floor(t * 60), 32) - .5) * 2 * shake : 0));
      if (rot) g.rotate(rot);
      g.scale(zoom * (o.camBarFlip && barIndex % 2 ? -1 : 1), zoom);
      g.translate(-W / 2, -H / 2);

      const sorted = tiles.slice().sort((a, b) => (a.ev.cfg.layer - b.ev.cfg.layer) || (o.layout === 'stage' ? 0 : a.ev.start - b.ev.start));
      for (const tile of sorted) this.drawTile(g, tile, t, plan, o);
      g.restore();

      /* Flashes. */
      const flash = o.flashBeat / 100 * beat + o.flashBar / 100 * envAt(plan.env, 'bar', t) + o.flashKick / 100 * kick + o.flashSnare / 100 * snare;
      if (flash > .004) {
        g.fillStyle = hexAlpha(o.flashColor, clamp(flash, 0, 1));
        g.fillRect(0, 0, W, H);
      }

      this.drawCaptions(g, o, t, plan, tiles, active);
      this.drawOverlays(g, o, t, plan, prj, tiles);

      this.post.render(this.canvas, this.fxParams(o, t, plan));
      this.lastTiles = tiles;
    }
  }

  YT.Scene = Scene;
  YT.arrangeWindows = arrangeWindows;
})(window.YT);
