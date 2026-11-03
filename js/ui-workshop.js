/* The word editor: cut a clip into words, mark each word's vowel, and audition it at different note lengths. */
(function (YT) {
  'use strict';
  const U = YT.util, { el, clamp } = U;
  const A = YT.app;

  const S = { clip: null, sel: null, from: 0, to: 1, cursor: 0, drag: null, testMidi: 60, stretch: 'smart', engine: 'auto', follow: 30, hold: 'stretch', threshold: -32, count: 0 };
  let wave, g, preview, pg, tableBody, frameTimer = 0;

  /* Peaks at two resolutions so a long source still redraws instantly. */
  function peaksFor(clip) {
    if (clip.peaks || !clip.pcm) return clip.peaks;
    const stride = 256, n = Math.ceil(clip.pcm.length / stride);
    const min = new Float32Array(n), max = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let lo = 0, hi = 0;
      const end = Math.min(clip.pcm.length, (i + 1) * stride);
      for (let j = i * stride; j < end; j++) {
        const v = clip.pcm[j];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      min[i] = lo;
      max[i] = hi;
    }
    clip.peaks = { stride, min, max };
    return clip.peaks;
  }

  const px = t => (t - S.from) / (S.to - S.from) * wave.clientWidth;
  const timeAt = x => S.from + x / wave.clientWidth * (S.to - S.from);

  function draw() {
    if (!S.clip || !wave.clientWidth) return;
    const dpr = window.devicePixelRatio || 1, w = wave.clientWidth, h = wave.clientHeight;
    if (wave.width !== Math.round(w * dpr) || wave.height !== Math.round(h * dpr)) {
      wave.width = Math.round(w * dpr);
      wave.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0a0b10';
    g.fillRect(0, 0, w, h);

    const clip = S.clip, TOP = 18, BOTTOM = 18, mid = TOP + (h - TOP - BOTTOM) / 2, amp = (h - TOP - BOTTOM) / 2;

    /* Word regions under the waveform. */
    for (const word of clip.words) {
      const x0 = px(word.start), x1 = px(word.end);
      if (x1 < 0 || x0 > w) continue;
      const on = word === S.sel;
      g.fillStyle = hexA(word.color, on ? .28 : .14);
      g.fillRect(x0, 0, x1 - x0, h);
      const a = px(word.susStart), b = px(word.susEnd);
      g.fillStyle = hexA(word.color, on ? .3 : .12);
      g.fillRect(a, TOP, b - a, h - TOP);
    }

    /* Waveform. */
    if (clip.pcm) {
      const samplesPerPx = (S.to - S.from) * YT.SR / w;
      g.fillStyle = '#a6adc2';
      if (samplesPerPx > 256) {
        const p = peaksFor(clip);
        for (let x = 0; x < w; x++) {
          const a = Math.floor(timeAt(x) * YT.SR / p.stride), b = Math.max(a + 1, Math.floor(timeAt(x + 1) * YT.SR / p.stride));
          let lo = 0, hi = 0;
          for (let i = a; i < b && i < p.min.length; i++) {
            if (i < 0) continue;
            if (p.min[i] < lo) lo = p.min[i];
            if (p.max[i] > hi) hi = p.max[i];
          }
          g.fillRect(x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
        }
      } else {
        for (let x = 0; x < w; x++) {
          const a = Math.floor(timeAt(x) * YT.SR), b = Math.max(a + 1, Math.floor(timeAt(x + 1) * YT.SR));
          let lo = 0, hi = 0;
          for (let i = a; i < b && i < clip.pcm.length; i++) {
            if (i < 0) continue;
            if (clip.pcm[i] < lo) lo = clip.pcm[i];
            if (clip.pcm[i] > hi) hi = clip.pcm[i];
          }
          g.fillRect(x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
        }
      }
    } else {
      g.fillStyle = '#5c6275';
      g.font = '12px system-ui';
      g.fillText('This clip has no sound. It can still be used as a picture on notes.', 12, mid);
    }

    /* Word handles and labels. */
    for (const word of clip.words) {
      const x0 = px(word.start), x1 = px(word.end);
      if (x1 < 0 || x0 > w) continue;
      const on = word === S.sel;
      g.fillStyle = word.color;
      g.fillRect(x0, 0, on ? 2 : 1, h);
      g.fillRect(x1 - (on ? 2 : 1), 0, on ? 2 : 1, h);
      g.fillStyle = hexA(word.color, .9);
      g.fillRect(x0, 0, x1 - x0, TOP - 3);
      g.save();
      g.beginPath();
      g.rect(x0, 0, x1 - x0, TOP);
      g.clip();
      g.fillStyle = '#08090d';
      g.font = '700 11px system-ui';
      g.textBaseline = 'middle';
      g.fillText(word.name, x0 + 4, 7);
      g.restore();
      const a = px(word.susStart), b = px(word.susEnd);
      if (on) {
        g.fillStyle = '#fff';
        for (const hx of [a, b]) {
          g.beginPath();
          g.moveTo(hx, h - BOTTOM);
          g.lineTo(hx - 6, h - 2);
          g.lineTo(hx + 6, h - 2);
          g.closePath();
          g.fill();
        }
        g.fillStyle = 'rgba(255,255,255,.55)';
        g.font = '10px system-ui';
        g.textBaseline = 'middle';
        if (b - a > 62) g.fillText('vowel: stretches', a + 8, h - 9);
      }
    }

    const cx = px(S.cursor);
    g.fillStyle = '#ffd23f';
    g.fillRect(cx, 0, 1, h);
  }

  const hexA = (hex, alpha) => {
    const v = parseInt(hex.slice(1), 16);
    return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${alpha})`;
  };

  function showFrame(t) {
    const clip = S.clip;
    const pw = preview.width, ph = preview.height;
    pg.fillStyle = '#000';
    pg.fillRect(0, 0, pw, ph);
    const media = clip.image || clip.frames?.get(t);
    if (media) {
      const s = Math.min(pw / media.width, ph / media.height);
      const dw = media.width * s, dh = media.height * s;
      pg.drawImage(media, (pw - dw) / 2, (ph - dh) / 2, dw, dh);
    } else {
      pg.fillStyle = '#5c6275';
      pg.font = '16px system-ui';
      pg.textAlign = 'center';
      pg.fillText(clip.kind === 'audio' ? 'Audio clip' : 'Decoding…', pw / 2, ph / 2);
    }
  }

  function ensureFramesFor(word) {
    const clip = S.clip;
    if (clip.kind !== 'video' || !word) return Promise.resolve();
    return clip.frames.ensure([[word.start, word.end]], () => {
      clearTimeout(frameTimer);
      frameTimer = setTimeout(() => showFrame(S.cursor), 40);
    });
  }

  /* After a cut changes: fresh samples for the worker, re-analyse, tell the rest of the app. */
  async function cutChanged(word) {
    if (!word.clip.words.includes(word)) return;
    A.farm.dropWord(`${word.id}.${word.ver}`);
    word.ver++;
    word.clip.words.sort((a, b) => a.start - b.start);
    await A.analyzeWord(word);
    if (word.susStart < word.start || word.susEnd > word.end || word.susEnd <= word.susStart) {
      word.susStart = word.start + (word.end - word.start) * .3;
      word.susEnd = word.start + (word.end - word.start) * .7;
    }
    renderTable();
    draw();
    A.wordsChanged(word.clip);
    ensureFramesFor(word);
  }

  function select(word, { seek = true } = {}) {
    S.sel = word;
    if (word && seek) {
      S.cursor = word.start;
      showFrame(word.start);
      ensureFramesFor(word);
    }
    renderTable();
    draw();
  }

  /* ---------- Pointer editing on the waveform ---------- */
  function hit(x, y) {
    const h = wave.clientHeight;
    const near = (a, b) => Math.abs(a - b) <= 6;
    const sel = S.sel;
    if (sel && y > h - 20) {
      if (near(x, px(sel.susStart))) return { type: 'susStart', word: sel };
      if (near(x, px(sel.susEnd))) return { type: 'susEnd', word: sel };
    }
    const order = sel ? [sel, ...S.clip.words.filter(w => w !== sel)] : S.clip.words;
    for (const word of order) {
      if (near(x, px(word.start))) return { type: 'start', word };
      if (near(x, px(word.end))) return { type: 'end', word };
    }
    for (const word of order) {
      if (x > px(word.start) && x < px(word.end)) return { type: y < 18 ? 'move' : 'body', word };
    }
    return { type: 'empty' };
  }

  function pointerDown(e) {
    const rect = wave.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const target = hit(x, y);
    wave.setPointerCapture(e.pointerId);
    S.drag = { ...target, startX: x, moved: false, t0: timeAt(x), start0: target.word?.start, end0: target.word?.end };
    if (target.word && target.word !== S.sel) select(target.word, { seek: false });
    if (target.type === 'empty' || target.type === 'body') {
      S.cursor = clamp(timeAt(x), 0, S.clip.dur);
      showFrame(S.cursor);
      draw();
    }
  }

  function pointerMove(e) {
    const rect = wave.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const d = S.drag;
    if (!d) {
      const h = hit(x, y).type;
      wave.style.cursor = h === 'start' || h === 'end' || h === 'susStart' || h === 'susEnd' ? 'ew-resize' : h === 'move' ? 'grab' : 'text';
      return;
    }
    const t = clamp(timeAt(x), 0, S.clip.dur);
    if (Math.abs(x - d.startX) > 2) d.moved = true;
    if (!d.moved) return;
    const w = d.word, MIN = .01;
    switch (d.type) {
      case 'start': w.start = Math.min(t, w.end - MIN); break;
      case 'end': w.end = Math.max(t, w.start + MIN); break;
      case 'susStart': w.susStart = clamp(t, w.start, w.susEnd - .005); w.susAuto = false; break;
      case 'susEnd': w.susEnd = clamp(t, w.susStart + .005, w.end); w.susAuto = false; break;
      case 'move': {
        const len = d.end0 - d.start0, delta = t - d.t0;
        const start = clamp(d.start0 + delta, 0, S.clip.dur - len);
        const shift = start - w.start;
        w.start = start;
        w.end = start + len;
        w.susStart += shift;
        w.susEnd += shift;
        break;
      }
      case 'empty':
      case 'body': {
        // Dragging across empty space sweeps out a new word.
        S.cursor = t;
        d.sweep = [Math.min(d.t0, t), Math.max(d.t0, t)];
        break;
      }
    }
    if (d.type === 'susStart' || d.type === 'susEnd') showFrame(t);
    draw();
    if (d.sweep) {
      g.fillStyle = 'rgba(61,220,255,.25)';
      g.fillRect(px(d.sweep[0]), 0, px(d.sweep[1]) - px(d.sweep[0]), wave.clientHeight);
    }
  }

  async function pointerUp() {
    const d = S.drag;
    S.drag = null;
    if (!d || !d.moved) {
      if (d?.word && d.type === 'body') A.audition(d.word, { onFrame: t => showFrame(t) }).catch(fail);
      return;
    }
    if (d.type === 'susStart' || d.type === 'susEnd') {
      renderTable();
      A.wordsChanged(S.clip, { structural: false });
    } else if (d.type === 'start' || d.type === 'end' || d.type === 'move') {
      await cutChanged(d.word);
    } else if (d.sweep && d.sweep[1] - d.sweep[0] > .02) {
      await addWord(d.sweep[0], d.sweep[1]);
    }
  }

  function wheel(e) {
    e.preventDefault();
    const rect = wave.getBoundingClientRect();
    const x = e.clientX - rect.left, at = timeAt(x), dur = S.clip.dur;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const span = S.to - S.from, dt = (e.deltaX || e.deltaY) / wave.clientWidth * span;
      S.from = clamp(S.from + dt, 0, Math.max(0, dur - span));
      S.to = S.from + span;
    } else {
      const span = clamp((S.to - S.from) * (e.deltaY > 0 ? 1.2 : 1 / 1.2), .02, dur);
      S.from = clamp(at - x / wave.clientWidth * span, 0, Math.max(0, dur - span));
      S.to = S.from + span;
    }
    draw();
  }

  /* ---------- Word actions ---------- */
  async function addWord(start, end) {
    const word = A.makeWord(S.clip, start, end);
    S.clip.words.push(word);
    S.clip.words.sort((a, b) => a.start - b.start);
    await A.analyzeWord(word);
    S.sel = word;
    renderTable();
    draw();
    A.wordsChanged(S.clip);
    ensureFramesFor(word);
  }

  async function splitAtCursor() {
    const word = S.clip.words.find(w => S.cursor > w.start + .01 && S.cursor < w.end - .01);
    if (!word) return A.status('Put the yellow cursor inside a word first (click the waveform).');
    const end = word.end;
    word.end = S.cursor;
    word.susAuto = true;
    const next = A.makeWord(S.clip, S.cursor, end);
    S.clip.words.push(next);
    await cutChanged(word);
    await cutChanged(next);
    S.sel = next;
    renderTable();
    draw();
  }

  function removeWord(word) {
    const clip = S.clip;
    clip.words = clip.words.filter(w => w !== word);
    A.farm.dropWord(`${word.id}.${word.ver}`);
    for (const p of A.prj.phrases) p.steps = p.steps.filter(s => s.wordId !== word.id);
    for (const key of Object.keys(A.prj.overrides)) if (A.prj.overrides[key] === word.id) delete A.prj.overrides[key];
    if (S.sel === word) S.sel = clip.words[0] || null;
    renderTable();
    draw();
    A.wordsChanged(clip);
  }

  async function findWords() {
    const clip = S.clip;
    if (!clip.pcm) return;
    A.status(`Finding words in ${clip.name}…`);
    await A.detectWords(clip, { count: S.count, thresholdDb: S.threshold });
    for (const p of A.prj.phrases) {
      if (p.clipId === clip.id && !p.auto) {
        const valid = new Set(A.allWords().map(w => w.id));
        p.steps = p.steps.filter(s => s.type !== 'word' || valid.has(s.wordId));
      }
    }
    S.sel = clip.words[0] || null;
    renderTable();
    draw();
    A.wordsChanged(clip);
    if (S.sel) ensureFramesFor(S.sel);
    A.status(`Found ${clip.words.length} word${clip.words.length === 1 ? '' : 's'}. Name them in the table, then drag the edges to perfect the cuts.`);
  }

  function fail(err) {
    console.error(err);
    A.status(err.message, 'error');
  }

  /* Hear the selected word at a chosen length: this is the MR / MRR / MRRRRR test. */
  async function test(seconds) {
    const word = S.sel;
    if (!word) return;
    await ensureFramesFor(word);
    A.audition(word, {
      midi: S.testMidi === 'root' ? (word.root ?? 60) : +S.testMidi,
      dur: seconds,
      cfg: { stretch: S.stretch, engine: S.engine, follow: S.follow, holdMode: S.hold },
      onFrame: t => { S.cursor = t; showFrame(t); draw(); }
    }).catch(fail);
  }

  function renderTable() {
    tableBody.replaceChildren();
    const noteOptions = () => {
      const list = [el('option', { value: 'auto' }, 'Auto')];
      for (let m = 96; m >= 24; m--) list.push(el('option', { value: m }, U.noteName(m)));
      return list;
    };
    for (const word of S.clip.words) {
      const name = el('input', { type: 'text', value: word.name, 'aria-label': 'Word name', maxLength: 24 });
      name.addEventListener('change', () => {
        word.name = name.value.trim() || word.name;
        A.emit('words', S.clip);
        draw();
        A.invalidate('compile');
      });
      name.addEventListener('focus', () => { if (S.sel !== word) { S.sel = word; draw(); markSelected(); } });

      const num = (value, onSet) => {
        const input = el('input', { type: 'number', step: .001, min: 0, value: value.toFixed(3) });
        input.addEventListener('change', () => onSet(+input.value));
        return input;
      };
      const start = num(word.start, v => { word.start = clamp(v, 0, word.end - .01); cutChanged(word); });
      const end = num(word.end, v => { word.end = clamp(v, word.start + .01, S.clip.dur); cutChanged(word); });

      const root = el('select', { 'aria-label': 'Pitch of this word' }, noteOptions());
      root.value = word.rootAuto ? 'auto' : Math.round(word.root ?? 60);
      root.title = word.root != null ? `Detected ${U.noteName(word.root)} (${word.root.toFixed(2)})` : 'No pitch found';
      root.addEventListener('change', async () => {
        if (root.value === 'auto') {
          word.rootAuto = true;
          await A.analyzeWord(word);
        } else {
          word.rootAuto = false;
          word.root = +root.value;
        }
        renderTable();
        A.wordsChanged(S.clip, { structural: false });
      });

      const gain = el('input', { type: 'range', min: 0, max: 2, step: .05, value: word.gain ?? 1, title: 'Word volume', 'aria-label': 'Word volume' });
      gain.addEventListener('change', () => { word.gain = +gain.value; A.invalidate('compile'); });
      const reverse = el('input', { type: 'checkbox', title: 'Play this word backwards, sound and picture', 'aria-label': 'Reverse' });
      reverse.checked = !!word.reverse;
      reverse.addEventListener('change', () => { word.reverse = reverse.checked; A.invalidate('compile'); });

      const row = el('tr', { class: word === S.sel ? 'selected' : '', dataset: { word: word.id } },
        el('td', null, el('span', { class: 'ws-dot', style: { background: word.color } })),
        el('td', null, name),
        el('td', null, start),
        el('td', null, end),
        el('td', null, root),
        el('td', null, gain),
        el('td', null, reverse),
        el('td', null,
          el('button', { class: 'ghost small icon', title: 'Hear it as cut', 'aria-label': `Play ${word.name}`, onclick: () => { select(word, { seek: false }); A.audition(word, { onFrame: t => showFrame(t) }).catch(fail); } }, '▶'),
          ' ',
          el('button', { class: 'ghost small icon', title: 'Delete word', 'aria-label': `Delete ${word.name}`, onclick: () => removeWord(word) }, '✕'))
      );
      row.addEventListener('click', e => { if (!e.target.closest('input,select,button')) select(word); });
      tableBody.append(row);
    }
  }

  function markSelected() {
    for (const row of tableBody.children) row.classList.toggle('selected', row.dataset.word === S.sel?.id);
  }

  /* ---------- Build ---------- */
  function open(clip) {
    A.pause();
    S.clip = clip;
    S.from = 0;
    S.to = Math.max(.1, clip.dur);
    S.sel = clip.words[0] || null;
    S.cursor = S.sel?.start ?? 0;
    const dialog = U.$('workshop');

    wave = el('canvas', { id: 'ws-wave', 'aria-label': 'Waveform. Drag edges to cut, scroll to zoom.' });
    g = wave.getContext('2d');
    wave.addEventListener('pointerdown', pointerDown);
    wave.addEventListener('pointermove', pointerMove);
    wave.addEventListener('pointerup', pointerUp);
    wave.addEventListener('wheel', wheel, { passive: false });

    preview = el('canvas', { class: 'ws-preview', width: 480, height: 270 });
    pg = preview.getContext('2d');
    tableBody = el('tbody');

    const testPitch = el('select', { 'aria-label': 'Test note' }, el('option', { value: 'root' }, 'Its own pitch'), ...Array.from({ length: 49 }, (_, i) => { const m = 84 - i; return el('option', { value: m }, U.noteName(m)); }));
    testPitch.value = S.testMidi;
    testPitch.addEventListener('change', () => { S.testMidi = testPitch.value === 'root' ? 'root' : +testPitch.value; });
    const stretchMeta = YT.options.trackById.stretch;
    const stretch = el('select', { 'aria-label': 'Stretch mode' }, stretchMeta.choices.filter(([v]) => !v.startsWith('tape') && v !== 'oneshot').map(([v, label]) => el('option', { value: v }, label)));
    stretch.value = S.stretch;
    stretch.addEventListener('change', () => { S.stretch = stretch.value; });
    const engine = el('select', { 'aria-label': 'Stretch engine' }, YT.options.trackById.engine.choices.map(([v, label]) => el('option', { value: v }, label)));
    engine.value = S.engine;
    engine.addEventListener('change', () => { S.engine = engine.value; });
    const hold = el('select', { 'aria-label': 'Long-note vowel' }, YT.options.trackById.holdMode.choices.map(([v, label]) => el('option', { value: v }, label)));
    hold.value = S.hold;
    hold.addEventListener('change', () => { S.hold = hold.value; });

    const countSelect = el('select', { 'aria-label': 'How many words' }, el('option', { value: 0 }, 'Auto'), ...Array.from({ length: 15 }, (_, i) => el('option', { value: i + 2 }, `${i + 2} words`)), el('option', { value: 1 }, '1 word'));
    countSelect.value = S.count;
    countSelect.addEventListener('change', () => { S.count = +countSelect.value; });
    const threshold = el('input', { type: 'range', min: -60, max: -10, step: 1, value: S.threshold, title: 'How quiet counts as a gap between words', 'aria-label': 'Gap sensitivity' });
    threshold.addEventListener('input', () => { S.threshold = +threshold.value; });

    const attachAudio = el('input', { type: 'file', accept: 'audio/*,video/*', hidden: true });
    attachAudio.addEventListener('change', async () => {
      if (!attachAudio.files[0]) return;
      try {
        const buffer = await A.audio.decode(await attachAudio.files[0].arrayBuffer());
        clip.pcm = YT.mixdown(buffer);
        clip.peaks = null;
        clip.dur = clip.kind === 'video' ? Math.min(clip.dur, buffer.duration) : buffer.duration;
        S.to = Math.max(.1, clip.dur);
        for (const w of clip.words) { w.ver++; w.silent = false; }
        await findWords();
      } catch (err) { fail(new Error(`Could not read that audio: ${err.message}`)); }
    });
    const attachImage = el('input', { type: 'file', accept: 'image/*', hidden: true });
    attachImage.addEventListener('change', async () => {
      if (!attachImage.files[0]) return;
      try {
        clip.image = await createImageBitmap(attachImage.files[0]);
        showFrame(S.cursor);
        A.requestRender();
        A.emit('clips');
      } catch (err) { fail(new Error(`Could not read that image: ${err.message}`)); }
    });

    dialog.replaceChildren(el('div', { class: 'ws' },
      el('div', { class: 'ws-head' },
        el('b', null, clip.name),
        el('span', { class: 'hint', style: { margin: 0 } }, `${clip.dur.toFixed(2)} s`),
        el('span', { class: 'spacer' }),
        el('button', { class: 'primary', onclick: () => dialog.close() }, 'Done')),
      el('div', { class: 'ws-body' },
        el('div', { class: 'ws-side' },
          preview,
          el('div', { class: 'ws-card' },
            el('h3', null, 'Test the stretch'),
            el('p', { class: 'hint', style: { margin: 0 } }, 'Each button sings the selected word over a note of that length.'),
            el('div', { class: 'row' },
              el('button', { class: 'ghost small', onclick: () => test(.18) }, 'Short'),
              el('button', { class: 'primary small', onclick: () => test(.45) }, 'Normal'),
              el('button', { class: 'ghost small', onclick: () => test(1.2) }, 'Long'),
              el('button', { class: 'ghost small', onclick: () => test(3) }, 'Very long')),
            el('label', null, 'Sing it on', testPitch),
            el('label', null, 'Stretch style', stretch),
            el('label', null, 'Engine', engine),
            el('label', null, 'Long-note vowel', hold)),
          el('div', { class: 'row', style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } },
            clip.kind !== 'image' ? el('button', { class: 'ghost small', onclick: () => attachAudio.click() }, 'Replace audio') : null,
            clip.kind === 'audio' ? el('button', { class: 'ghost small', onclick: () => attachImage.click() }, 'Add picture') : null,
            attachAudio, attachImage)),
        el('div', { class: 'ws-main' },
          el('div', { class: 'ws-tools' },
            el('button', { class: 'primary small', onclick: () => findWords().catch(fail), disabled: !clip.pcm }, 'Find words'),
            countSelect,
            el('label', null, 'Gap sensitivity', threshold),
            el('button', { class: 'ghost small', onclick: () => splitAtCursor().catch(fail) }, '✂ Split at cursor'),
            el('button', { class: 'ghost small', onclick: () => addWord(S.cursor, Math.min(clip.dur, S.cursor + .3)).catch(fail) }, '＋ Word at cursor')),
          wave,
          el('p', { class: 'hint', style: { margin: 0 } }, 'Drag a word’s edges to cut. Drag its top bar to move it. Drag across empty space to add a word. The white triangles mark the vowel, the part that stretches on long notes. Scroll to zoom, shift-scroll to pan.'),
          el('table', { class: 'ws-table' },
            el('thead', null, el('tr', null, ['', 'Word', 'Start', 'End', 'Pitch', 'Vol', 'Rev', ''].map(h => el('th', null, h)))),
            tableBody))
      )));

    dialog.onclose = () => {
      A.audio.stopAudition();
      A.emit('clips');
      A.emit('phrases-edited');
      S.clip = null;
    };
    dialog.showModal();
    renderTable();
    requestAnimationFrame(() => {
      draw();
      showFrame(S.cursor);
      if (S.sel) ensureFramesFor(S.sel);
    });
  }

  YT.workshop = { open };
  window.addEventListener('resize', () => { if (S.clip) draw(); });
})(window.YT);
