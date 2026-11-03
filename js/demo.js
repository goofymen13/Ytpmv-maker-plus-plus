/* The built-in demo: a robot says MR, then BEAST, over a generated song. All sound and pictures are synthesised,
   so nothing needs downloading, and it exercises the same code paths as real clips. */
(function (YT) {
  'use strict';
  const U = YT.util;

  /* ---------- Formant voice ---------- */
  function synthVoice(phones, { f0a = 128, f0b = 104, gain = .7 } = {}) {
    const sr = YT.SR, total = phones.reduce((s, p) => s + p[1], 0);
    const n = Math.ceil(total * sr), out = new Float32Array(n);
    const rnd = U.rng(17);
    const res = [[0, 0], [0, 0], [0, 0]];
    let phase = 0, t0 = 0, cur = 0;
    let F = [500, 1500, 2500], voiced = 0, noise = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      while (cur < phones.length - 1 && t >= t0 + phones[cur][1]) { t0 += phones[cur][1]; cur++; }
      const [, , v, nz, f1, f2, f3] = phones[cur];
      // Glide between phonemes rather than jumping.
      const k = .0035;
      voiced += (v - voiced) * k * 2;
      noise += (nz - noise) * k * 6;
      if (f1) { F[0] += (f1 - F[0]) * k; F[1] += (f2 - F[1]) * k; F[2] += (f3 - F[2]) * k; }
      const f0 = f0a + (f0b - f0a) * (t / total);
      phase += f0 / sr;
      if (phase >= 1) phase -= 1;
      const pulse = (phase < .4 ? Math.sin(Math.PI * phase / .4) ** 2 : 0) - .2;
      const excite = pulse * voiced + (rnd() * 2 - 1) * noise * .35;
      let s = 0;
      for (let f = 0; f < 3; f++) {
        const bw = f === 0 ? 70 : f === 1 ? 110 : 170;
        const r = Math.exp(-Math.PI * bw / sr), c = 2 * r * Math.cos(2 * Math.PI * F[f] / sr);
        const y = c * res[f][0] - r * r * res[f][1] + excite * (1 - r) * (f === 0 ? 3.2 : f === 1 ? 2.4 : 1.4);
        res[f][1] = res[f][0];
        res[f][0] = y;
        s += y;
      }
      out[i] = s + (rnd() * 2 - 1) * noise * .45;
    }
    let peak = 1e-6;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
    for (let i = 0; i < n; i++) out[i] *= gain / peak;
    return out;
  }

  /* name, seconds, voiced, noise, F1, F2, F3, mouth */
  const MR_BEAST = [
    ['_', .10, 0, 0, 0, 0, 0, 0],
    ['m', .08, .5, 0, 270, 1000, 2300, .06],
    ['i', .09, 1, 0, 400, 1950, 2600, .35],
    ['s', .08, 0, .55, 0, 0, 0, .18],
    ['t', .03, 0, .3, 0, 0, 0, .12],
    ['er', .19, 1, 0, 480, 1350, 1700, .55],
    ['_', .16, 0, 0, 0, 0, 0, 0],
    ['b', .03, .35, .08, 220, 900, 2200, .05],
    ['ee', .30, 1, 0, 280, 2300, 3000, .42],
    ['s', .11, 0, .55, 0, 0, 0, .2],
    ['t', .04, 0, .35, 0, 0, 0, .12],
    ['_', .1, 0, 0, 0, 0, 0, 0]
  ];
  const AAH = [
    ['_', .05, 0, 0, 0, 0, 0, 0],
    ['a', .9, 1, 0, 760, 1200, 2500, .95],
    ['_', .05, 0, 0, 0, 0, 0, 0]
  ];

  function mouthAt(phones, t) {
    let at = 0;
    for (const p of phones) {
      if (t < at + p[1]) return p[7];
      at += p[1];
    }
    return 0;
  }

  /* ---------- Pictures ---------- */
  async function bitmap(draw, w = 640, h = 360) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    return createImageBitmap(c);
  }

  function robot(g, w, h, open, wide, bg, face, blink) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, bg[0]);
    grad.addColorStop(1, bg[1]);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h * .52, hw = h * .4;
    g.fillStyle = face;
    g.beginPath();
    g.roundRect(cx - hw, cy - hw * .92, hw * 2, hw * 1.84, hw * .32);
    g.fill();
    g.fillStyle = '#10121a';
    g.fillRect(cx - 4, cy - hw * 1.3, 8, hw * .4);
    g.beginPath();
    g.arc(cx, cy - hw * 1.32, hw * .09, 0, 7);
    g.fillStyle = '#ff3d78';
    g.fill();
    g.fillStyle = '#fff';
    for (const side of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + side * hw * .45, cy - hw * .3, hw * .23, blink ? hw * .03 : hw * .25, 0, 0, 7);
      g.fill();
    }
    g.fillStyle = '#10121a';
    for (const side of [-1, 1]) {
      g.beginPath();
      g.arc(cx + side * hw * .4, cy - hw * .28, blink ? 1 : hw * .1, 0, 7);
      g.fill();
    }
    g.fillStyle = '#2a0f18';
    g.beginPath();
    g.ellipse(cx, cy + hw * .42, hw * (.28 + wide * .3), Math.max(hw * .025, hw * .42 * open), 0, 0, 7);
    g.fill();
    if (open > .2) {
      g.fillStyle = '#ff6b8a';
      g.beginPath();
      g.ellipse(cx, cy + hw * .42 + hw * .24 * open, hw * .16, hw * .14 * open, 0, 0, 7);
      g.fill();
    }
  }

  async function voiceFrames(store, phones, bg, face) {
    const total = phones.reduce((s, p) => s + p[1], 0), fps = 30;
    for (let i = 0; i <= Math.ceil(total * fps); i++) {
      const t = i / fps;
      const open = mouthAt(phones, t), wide = open > 0 && open < .5 ? .7 : .2;
      store.put(i, await bitmap((g, w, h) => robot(g, w, h, open, wide, bg, face, i % 37 === 0)));
    }
  }

  /* ---------- Other sounds ---------- */
  function drums() {
    const sr = YT.SR, n = sr * 1.2, x = new Float32Array(n), rnd = U.rng(3);
    const hit = (at, len, fn) => {
      const a = Math.floor(at * sr);
      for (let i = 0; i < len * sr; i++) x[a + i] += fn(i / sr);
    };
    hit(.05, .24, t => Math.sin(2 * Math.PI * (48 * t + 16 * (1 - Math.exp(-t * 34)))) * Math.exp(-t * 15) * .95);
    hit(.45, .2, t => ((rnd() * 2 - 1) * .7 + Math.sin(2 * Math.PI * 190 * t) * .4) * Math.exp(-t * 20));
    hit(.85, .1, t => { const v = rnd() * 2 - 1; return (v - (hit.prev || 0) * .8) * Math.exp(-t * 55) * .6 + ((hit.prev = v) && 0); });
    return x;
  }

  function womp() {
    const sr = YT.SR, n = Math.floor(sr * .8), x = new Float32Array(n);
    let phase = 0, lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      phase += 65.41 / sr;
      if (phase > 1) phase -= 1;
      const saw = phase * 2 - 1;
      const cut = .03 + .1 * Math.abs(Math.sin(t * 6));
      lp += (saw - lp) * cut;
      x[i] = lp * Math.min(1, t * 80) * Math.min(1, (.8 - t) * 40) * .9;
    }
    return x;
  }

  /* ---------- Score ---------- */
  const BPM = 124, BEAT = 60 / BPM;
  const LEAD = [
    [0, .5, 69], [.5, .5, 69], [1, 1, 72], [2, .5, 76], [2.5, .5, 74], [3, 1, 72],
    [4, .5, 71], [4.5, .5, 71], [5, 1.5, 67], [7, .25, 67], [7.25, .25, 69], [7.5, .5, 71],
    [8, 3, 69], [11, .5, 76], [11.5, .5, 74],
    [12, .5, 72], [12.5, .5, 71], [13, 3, 69]
  ];
  const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 55, 60], [55, 59, 62]];
  const BASS_ROOT = [33, 29, 36, 31];

  function score() {
    const tracks = [
      { name: 'Lead', channel: 0, program: 80, percussion: false, instrument: 'Square Lead', notes: [] },
      { name: 'Chords', channel: 1, program: 88, percussion: false, instrument: 'New Age Pad', notes: [] },
      { name: 'Bass', channel: 2, program: 38, percussion: false, instrument: 'Synth Bass 1', notes: [] },
      { name: 'Drums', channel: 9, program: 0, percussion: true, instrument: 'Drum Kit', notes: [] }
    ];
    const add = (track, beat, len, midi, velocity = .85) => track.notes.push({ midi, velocity, time: beat * BEAT, duration: len * BEAT, ticks: Math.round(beat * 480) });
    const bars = 16;
    for (let rep = 0; rep < bars / 4; rep++) {
      const o = rep * 16;
      for (const [b, l, m] of LEAD) add(tracks[0], o + b, l, m, l >= 2 ? 1 : .85);
      for (let bar = 0; bar < 4; bar++) {
        const base = o + bar * 4;
        for (const m of CHORDS[bar]) add(tracks[1], base, 3.75, m + 12, .55);
        for (let e = 0; e < 8; e++) add(tracks[2], base + e * .5, .42, BASS_ROOT[bar] + (e % 4 === 3 ? 12 : 0), e % 2 ? .7 : .95);
        for (let e = 0; e < 8; e++) {
          if (e % 4 === 0) add(tracks[3], base + e * .5, .25, 36, 1);
          if (e % 4 === 2) add(tracks[3], base + e * .5, .2, 38, .9);
          add(tracks[3], base + e * .5, .1, 42, e % 2 ? .45 : .65);
        }
      }
    }
    for (const t of tracks) {
      t.notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
      t.notes.forEach((n, i) => { n.index = i; });
    }
    const beats = Array.from({ length: bars * 4 }, (_, i) => ({ time: i * BEAT, strong: i % 4 === 0, bar: Math.floor(i / 4), beat: i % 4 }));
    return { tracks, duration: bars * 4 * BEAT, tempos: [{ ticks: 0, time: 0, bpm: BPM }], beats, format: 1, lyrics: [] };
  }

  /* The "MP3": an instrumental of the same score, rendered to audio. */
  function backingTrack(midi) {
    const sr = YT.SR, n = Math.ceil((midi.duration + .3) * sr), L = new Float32Array(n), R = new Float32Array(n);
    const rnd = U.rng(21);
    const put = (at, len, fn, pan = 0) => {
      const a = Math.floor(at * sr), count = Math.floor(len * sr);
      const lg = Math.cos((pan + 1) * Math.PI / 4), rg = Math.sin((pan + 1) * Math.PI / 4);
      for (let i = 0; i < count && a + i < n; i++) {
        const v = fn(i / sr, len);
        L[a + i] += v * lg;
        R[a + i] += v * rg;
      }
    };
    midi.tracks.forEach((track, ti) => {
      for (const note of track.notes) {
        const f = U.mtof(note.midi), v = note.velocity;
        if (track.percussion) {
          if (note.midi === 36) put(note.time, .28, t => Math.sin(2 * Math.PI * (50 * t + 15 * (1 - Math.exp(-t * 30)))) * Math.exp(-t * 13) * .62 * v);
          else if (note.midi === 38) put(note.time, .2, t => ((rnd() * 2 - 1) * .34 + Math.sin(2 * Math.PI * 185 * t) * .18) * Math.exp(-t * 21) * v);
          else put(note.time, .07, t => (rnd() * 2 - 1) * .13 * Math.exp(-t * 60) * v, .25);
        } else if (ti === 2) {
          put(note.time, note.duration, (t, len) => {
            const saw = ((f * t) % 1) * 2 - 1;
            return (Math.sin(2 * Math.PI * f * t) * .7 + saw * .18) * .26 * v * Math.min(1, t * 200) * Math.min(1, (len - t) * 80);
          });
        } else if (ti === 1) {
          put(note.time, note.duration, (t, len) => {
            const a = ((f * t) % 1) * 2 - 1, b = ((f * 1.005 * t) % 1) * 2 - 1;
            return (a + b) * .028 * v * Math.min(1, t * 8) * Math.min(1, (len - t) * 8);
          }, (note.midi % 3 - 1) * .5);
        }
        // The lead stays out: the clips sing it.
      }
    });
    const buffer = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr });
    buffer.copyToChannel(L, 0);
    buffer.copyToChannel(R, 1);
    return buffer;
  }

  /* ---------- Assemble ---------- */
  async function makeClip(A, name, kind, pcm, words) {
    const clip = { id: U.uid('c'), name, kind, file: null, url: '', pcm, dur: pcm.length / YT.SR, image: null, frames: null, words: [], color: U.COLORS[A.prj.clips.length % U.COLORS.length] };
    if (kind === 'video') {
      clip.frames = new YT.FrameStore(clip);
      clip.frames.synthetic = true;
      clip.frames.fps = 30;
    }
    const found = words.count ? await A.farm.call('detectWords', pcm, YT.SR, { count: words.count }) : await A.farm.call('detectWords', pcm, YT.SR, {});
    clip.words = found.slice(0, words.names.length).map((f, i) => A.makeWord(clip, f.start, Math.min(clip.dur, f.end), words.names[i]));
    await Promise.all(clip.words.map(w => A.analyzeWord(w)));
    return clip;
  }

  async function load() {
    const A = YT.app;
    A.pause();
    A.status('Building the demo…');
    await A.audio.ensure(A.prj);

    A.prj.clips.forEach(c => { c.frames?.destroy(); if (c.url) URL.revokeObjectURL(c.url); });
    A.prj.clips = [];
    A.prj.phrases = [];

    const midi = score();

    const voiceClip = await makeClip(A, 'robot says mr beast', 'video', synthVoice(MR_BEAST), { count: 2, names: ['MR', 'BEAST'] });
    await voiceFrames(voiceClip.frames, MR_BEAST, ['#2b1055', '#7597de'], '#d9dde8');

    const aahClip = await makeClip(A, 'choir aah', 'video', synthVoice(AAH, { f0a: 165, f0b: 160, gain: .55 }), { names: ['AAH'] });
    await voiceFrames(aahClip.frames, AAH, ['#0b3d2e', '#37c978'], '#f4d8a8');

    const wompPcm = womp();
    const wompClip = await makeClip(A, 'bass womp', 'video', wompPcm, { names: ['WOMP'] });
    for (let i = 0; i <= 26; i++) {
      const k = Math.abs(Math.sin(i / 30 * 6));
      wompClip.frames.put(i, await bitmap((g, w, h) => {
        g.fillStyle = '#23061f';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#ff7a2e';
        g.beginPath();
        g.arc(w / 2, h / 2, h * (.25 + .17 * k), 0, 7);
        g.fill();
        g.fillStyle = '#23061f';
        g.beginPath();
        g.arc(w / 2, h / 2, h * (.1 + .05 * k), 0, 7);
        g.fill();
      }));
    }

    const drumClip = await makeClip(A, 'drum kit', 'video', drums(), { names: ['KICK', 'SNARE', 'HAT'] });
    const paints = [['#ffd23f', '#3a2c00', 'KICK'], ['#3ddcff', '#00303b', 'SNARE'], ['#ff4d7d', '#3b0016', 'HAT']];
    for (let i = 0; i <= Math.ceil(drumClip.dur * 30); i++) {
      const t = i / 30;
      const which = drumClip.words.findIndex(w => t >= w.start - .04 && t <= w.end + .04);
      const [fg, bg, label] = paints[Math.max(0, which)];
      drumClip.frames.put(i, await bitmap((g, w, h) => {
        g.fillStyle = bg;
        g.fillRect(0, 0, w, h);
        g.fillStyle = fg;
        g.font = `900 ${h * .34}px Impact, "Arial Black", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(label, w / 2, h / 2);
      }));
    }

    A.prj.clips = [voiceClip, aahClip, wompClip, drumClip];
    for (const c of A.prj.clips) A.syncAutoPhrase(c);
    A.prj.song = null;
    A.prj.options.midiShift = 0;
    A.prj.options.titleText = '';
    A.setMidi(midi, 'demo-song.mid', null);

    const phraseOf = c => A.prj.phrases.find(p => p.clipId === c.id).id;
    const byName = name => A.prj.tracks[midi.tracks.findIndex(t => t.name === name)];
    byName('Lead').source = phraseOf(voiceClip);
    byName('Chords').source = phraseOf(aahClip);
    byName('Bass').source = phraseOf(wompClip);
    byName('Drums').source = phraseOf(drumClip);
    byName('Bass').transpose = 12;
    await A.setSong(backingTrack(midi), 'demo-backing-track.wav');
    A.prj.options.songVol = 75;
    A.applyLook('classic');
    A.emit('clips');
    A.emit('phrases');
    await A.prepared;
    return { voiceClip, aahClip, wompClip, drumClip };
  }

  YT.demo = { load, score, synthVoice, MR_BEAST };
})(window.YT);
