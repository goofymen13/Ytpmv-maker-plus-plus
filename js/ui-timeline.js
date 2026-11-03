/* Timeline: MP3 waveform plus every track's notes, labelled with the word each note will sing. */
(function (YT) {
  'use strict';
  const U = YT.util, { el, clamp } = U;
  const A = YT.app;
  const RULER = 16, SONG_ROW = 34;

  const T = {
    from: 0, span: 30, canvas: null, g: null, dragging: null, wordsByNote: new Map(),
    init() {
      this.canvas = U.$('timeline');
      this.g = this.canvas.getContext('2d');
      new ResizeObserver(() => this.draw()).observe(this.canvas);
      A.on('plan', () => { this.indexWords(); this.fit(); this.draw(); });
      A.on('song', () => this.draw());
      A.on('tick', t => this.onTick(t));
      this.canvas.addEventListener('pointerdown', e => this.down(e));
      this.canvas.addEventListener('pointermove', e => this.move(e));
      this.canvas.addEventListener('pointerup', e => this.up(e));
      this.canvas.addEventListener('wheel', e => this.wheel(e), { passive: false });
      document.addEventListener('pointerdown', e => {
        if (!e.target.closest('#note-menu') && !e.target.closest('#timeline')) U.$('note-menu').hidden = true;
      });
      this.fit();
    },

    fit() {
      if (!A.plan) return;
      if (this.userZoomed) {
        this.span = clamp(this.span, .5, Math.max(1, A.plan.duration));
        return;
      }
      this.from = 0;
      this.span = Math.max(1, A.plan.duration);
    },

    indexWords() {
      this.wordsByNote = new Map();
      for (const e of A.plan.events) {
        const key = `${e.ti}:${e.ni}`;
        if (!this.wordsByNote.has(key)) this.wordsByNote.set(key, e);
      }
    },

    x(t) { return (t - this.from) / this.span * this.w; },
    time(x) { return this.from + x / this.w * this.span; },

    noteOut(n) {
      const o = A.prj.options;
      const speed = A.plan.speed, scale = o.midiScale / 100;
      return { start: n.time * scale / speed + A.plan.midiStart, dur: n.duration * scale / speed };
    },

    trackRows() {
      const tracks = A.prj.midi?.tracks || [];
      const avail = this.h - RULER - SONG_ROW;
      const rowH = tracks.length ? Math.max(8, avail / tracks.length) : avail;
      return { tracks, rowH };
    },

    draw() {
      const c = this.canvas, g = this.g;
      if (!c.clientWidth) return;
      const dpr = window.devicePixelRatio || 1;
      this.w = c.clientWidth;
      this.h = c.clientHeight;
      const bw = Math.round(this.w * dpr), bh = Math.round(this.h * dpr);
      if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, this.w, this.h);
      g.fillStyle = '#11131a';
      g.fillRect(0, 0, this.w, this.h);
      if (!A.plan) return;

      /* Beat grid. */
      const beats = A.plan.beats;
      const pxPerSec = this.w / this.span;
      const showBeats = beats.length > 1 && (beats[1].time - beats[0].time) * pxPerSec > 7;
      g.font = '10px Consolas, monospace';
      g.textBaseline = 'middle';
      for (const b of beats) {
        const x = this.x(b.time);
        if (x < -2 || x > this.w + 2) continue;
        if (!b.strong && !showBeats) continue;
        g.fillStyle = b.strong ? '#2f3442' : '#1e212c';
        g.fillRect(x, RULER, 1, this.h - RULER);
      }
      g.fillStyle = '#191c25';
      g.fillRect(0, 0, this.w, RULER);
      g.fillStyle = '#8087a0';
      let lastLabel = -100;
      for (const b of beats) {
        if (!b.strong) continue;
        const x = this.x(b.time);
        if (x < 0 || x > this.w || x - lastLabel < 30) continue;
        g.fillText(String(b.bar + 1), x + 2, RULER / 2);
        lastLabel = x;
      }
      this.drawSong(g);

      /* Notes. */
      const { tracks, rowH } = this.trackRows();
      tracks.forEach((track, ti) => {
        const y = RULER + SONG_ROW + ti * rowH;
        const color = U.COLORS[ti % U.COLORS.length];
        const cfg = A.prj.tracks[ti];
        const silent = !cfg || cfg.mute || !cfg.source;
        g.fillStyle = 'rgba(255,255,255,.035)';
        g.fillRect(0, y, this.w, 1);
        let lo = 127, hi = 0;
        for (const n of track.notes) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); }
        const span = Math.max(1, hi - lo);
        const noteH = Math.max(2, Math.min(rowH - 2, (rowH - 2) / Math.min(span + 1, 14)));
        g.globalAlpha = silent ? .25 : 1;
        for (const n of track.notes) {
          const { start, dur } = this.noteOut(n);
          const x = this.x(start), w = Math.max(1.5, dur * pxPerSec);
          if (x > this.w || x + w < 0) continue;
          const ny = y + 1 + (1 - (n.midi - lo) / span) * (rowH - 2 - noteH);
          g.fillStyle = color;
          g.fillRect(x, ny, w, noteH);
          if (w > 26 && noteH > 9) {
            const ev = this.wordsByNote.get(`${ti}:${n.index}`);
            if (ev) {
              g.save();
              g.beginPath();
              g.rect(x, ny, w, noteH);
              g.clip();
              g.fillStyle = '#0a0b10';
              g.font = '600 10px system-ui';
              g.fillText(ev.word.name, x + 3, ny + noteH / 2);
              g.restore();
            }
          }
        }
        g.globalAlpha = 1;
        if (rowH > 13) {
          g.fillStyle = 'rgba(17,19,26,.75)';
          g.font = '10px system-ui';
          const name = cfg?.name || track.name;
          const tw = g.measureText(name).width;
          g.fillRect(2, y + 2, tw + 6, 12);
          g.fillStyle = color;
          g.fillText(name, 5, y + 8);
        }
      });

      /* Playhead. */
      const px = this.x(A.currentTime());
      g.fillStyle = '#fff';
      g.fillRect(px, 0, 1.5, this.h);
    },

    drawSong(g) {
      const y = RULER, h = SONG_ROW;
      g.fillStyle = '#161922';
      g.fillRect(0, y, this.w, h);
      const song = A.prj.song;
      if (!song) {
        g.fillStyle = '#5c6275';
        g.font = '11px system-ui';
        g.fillText('MP3 goes here. Drop one in the Song panel.', 8, y + h / 2);
        return;
      }
      const an = song.analysis, o = A.prj.options, plan = A.plan;
      const xStart = this.x(plan.songStart), xEnd = this.x(plan.songEnd);
      g.fillStyle = 'rgba(61,220,255,.12)';
      g.fillRect(xStart, y, xEnd - xStart, h);
      if (an) {
        g.fillStyle = '#3ddcff';
        let peak = 1e-6;
        for (let i = 0; i < an.rms.length; i += 8) peak = Math.max(peak, an.rms[i]);
        for (let px = Math.max(0, Math.floor(xStart)); px < Math.min(this.w, xEnd); px++) {
          const t0 = this.time(px), t1 = this.time(px + 1);
          const s0 = Math.floor(((t0 - plan.songStart) * plan.speed + o.songTrim) * an.rate);
          const s1 = Math.ceil(((t1 - plan.songStart) * plan.speed + o.songTrim) * an.rate);
          let v = 0;
          for (let i = Math.max(0, s0); i < Math.min(an.rms.length, Math.max(s1, s0 + 1)); i++) v = Math.max(v, an.rms[i]);
          const bar = v / peak * (h - 6);
          g.fillRect(px, y + h / 2 - bar / 2, 1, Math.max(.5, bar));
        }
      }
      g.fillStyle = '#c8eefa';
      g.font = '10px system-ui';
      g.fillText(song.name, Math.max(4, xStart + 4), y + 8);
    },

    onTick() {
      if (!A.playing || !this.w) { this.draw(); return; }
      const t = A.currentTime();
      if (t > this.from + this.span * .92 || t < this.from) this.from = clamp(t - this.span * .05, 0, Math.max(0, A.plan.duration - this.span));
      this.draw();
    },

    down(e) {
      if (!A.plan) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      this.canvas.setPointerCapture(e.pointerId);
      if (A.prj.song && y >= RULER && y < RULER + SONG_ROW) {
        this.dragging = { type: 'song', startX: x, startShift: A.prj.options.midiShift };
        this.canvas.style.cursor = 'grabbing';
        return;
      }
      const hit = y >= RULER + SONG_ROW ? this.noteAt(x, y) : null;
      if (hit) {
        this.dragging = { type: 'note', hit, startX: x, startY: y };
        return;
      }
      this.dragging = { type: 'seek' };
      A.seek(this.time(x));
    },

    move(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const d = this.dragging;
      if (!d) {
        const y = e.clientY - rect.top;
        this.canvas.style.cursor = A.prj.song && y >= RULER && y < RULER + SONG_ROW ? 'grab' : this.noteAt(x, y) ? 'pointer' : 'crosshair';
        return;
      }
      if (d.type === 'seek') A.seek(this.time(x));
      if (d.type === 'song') {
        // Dragging the song right means the MIDI has to start earlier against it.
        const delta = (x - d.startX) / this.w * this.span * A.plan.speed;
        const value = Math.round((d.startShift - delta) * 1000) / 1000;
        A.prj.options.midiShift = clamp(value, -120, 120);
        A.invalidate('compile');
        A.emit('options-external-soft');
        this.draw();
      }
    },

    up(e) {
      const d = this.dragging;
      this.dragging = null;
      this.canvas.style.cursor = 'crosshair';
      if (d?.type === 'note') this.openNoteMenu(d.hit, e.clientX, e.clientY);
    },

    wheel(e) {
      if (!A.plan) return;
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, at = this.time(x);
      this.userZoomed = true;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const dx = (e.deltaX || e.deltaY) / this.w * this.span;
        this.from = clamp(this.from + dx, 0, Math.max(0, A.plan.duration - this.span));
      } else {
        const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18;
        this.span = clamp(this.span * factor, .5, Math.max(1, A.plan.duration));
        this.from = clamp(at - x / this.w * this.span, 0, Math.max(0, A.plan.duration - this.span));
      }
      this.draw();
    },

    noteAt(x, y) {
      const { tracks, rowH } = this.trackRows();
      const ti = Math.floor((y - RULER - SONG_ROW) / rowH);
      const track = tracks[ti];
      if (!track) return null;
      const t = this.time(x);
      const pad = 3 / this.w * this.span;
      for (const n of track.notes) {
        const { start, dur } = this.noteOut(n);
        if (t >= start - pad && t <= start + dur + pad) return { ti, note: n };
      }
      return null;
    },

    /* Pick a specific word for one note: the finest level of order control. */
    openNoteMenu({ ti, note }, cx, cy) {
      const menu = U.$('note-menu');
      const key = `${ti}:${note.index}`;
      const words = A.allWords();
      const choose = value => {
        if (value == null) delete A.prj.overrides[key];
        else A.prj.overrides[key] = value;
        menu.hidden = true;
        A.invalidate('compile');
      };
      const current = this.wordsByNote.get(key);
      menu.replaceChildren(
        el('b', null, `${U.noteName(note.midi)}, currently “${current?.word.name ?? 'silent'}”. Sing instead:`),
        ...words.map(w => el('button', { class: 'chip', style: { '--chip': w.color }, onclick: () => choose(w.id) }, el('span', null, w.name))),
        el('button', { class: 'chip rest', onclick: () => choose('rest') }, el('span', null, 'silent')),
        el('button', { class: 'chip hold', onclick: () => choose(null) }, el('span', null, 'back to phrase'))
      );
      menu.hidden = false;
      menu.style.left = `${Math.min(cx, innerWidth - 270)}px`;
      menu.style.top = `${Math.max(8, cy - menu.offsetHeight - 6)}px`;
    }
  };

  YT.timeline = T;
})(window.YT);
