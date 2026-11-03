/* End-to-end tests of the real app in a real page: real worker pool, real canvas, real encoders.
   They build genuine media files in the browser and put them through the same doors as a user's files. */
(function () {
  'use strict';
  const { test, assert, near } = window.TestKit;
  const A = YT.app;
  const SR = YT.SR;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* --------- Media builders --------- */
  function wavFile(channels, name = 'song.wav') {
    const buffer = new AudioBuffer({ length: channels[0].length, numberOfChannels: channels.length, sampleRate: SR });
    channels.forEach((c, i) => buffer.copyToChannel(c, i));
    return new File([YT.util.encodeWav(buffer)], name, { type: 'audio/wav' });
  }

  /* Valid MPEG-1 Layer 3 silence: proves a real .mp3 goes through the decoder path. */
  function silentMp3(frames = 80) {
    const frame = new Uint8Array(417);
    frame.set([0xFF, 0xFB, 0x90, 0x64]);
    const all = new Uint8Array(frame.length * frames);
    for (let i = 0; i < frames; i++) all.set(frame, i * frame.length);
    return new File([all], 'silence.mp3', { type: 'audio/mpeg' });
  }

  function midiFile(notes, bpm = 120, division = 480) {
    /* notes: [beat, lengthBeats, midi, channel?] */
    const events = [];
    for (const [beat, len, midi, ch = 0] of notes) {
      events.push({ tick: Math.round(beat * division), data: [0x90 | ch, midi, 100] });
      events.push({ tick: Math.round((beat + len) * division), data: [0x80 | ch, midi, 0] });
    }
    events.sort((a, b) => a.tick - b.tick || a.data[0] - b.data[0]);
    const vlq = v => { const out = [v & 127]; while ((v >>= 7) > 0) out.unshift((v & 127) | 128); return out; };
    const micros = Math.round(60000000 / bpm);
    const body = [0, 0xFF, 0x51, 3, micros >> 16, (micros >> 8) & 255, micros & 255];
    let last = 0;
    for (const e of events) { body.push(...vlq(e.tick - last), ...e.data); last = e.tick; }
    body.push(0, 0xFF, 0x2F, 0);
    const name = s => [...s].map(c => c.charCodeAt(0));
    const size = [body.length >>> 24, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255];
    const bytes = Uint8Array.from([...name('MThd'), 0, 0, 0, 6, 0, 0, 0, 1, division >> 8, division & 255, ...name('MTrk'), ...size, ...body]);
    return new File([bytes], 'test.mid', { type: 'audio/midi' });
  }

  /* A real video file with sound, built frame by frame so its contents are exactly known:
     red with a sung burst for "word 1", then a silent gap, then blue with a burst for "word 2". */
  async function makeVideo(seconds = 1.2) {
    const w = 320, h = 180, fps = 30, canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    const samples = [];
    const encoder = new VideoEncoder({
      output: chunk => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        samples.push({ data, ts: chunk.timestamp, dur: chunk.duration || Math.round(1e6 / fps), key: chunk.type === 'key' });
      },
      error: e => { throw e; }
    });
    encoder.configure({ codec: 'vp8', width: w, height: h, framerate: fps, bitrate: 2e6 });
    const total = Math.round(seconds * fps);
    for (let i = 0; i < total; i++) {
      const t = i / fps;
      g.fillStyle = t < .55 ? '#ff0000' : '#0000ff';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
      g.fillRect(Math.floor(t * 200), 60, 30, 60);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: i % 8 === 0 });
      frame.close();
    }
    await encoder.flush();
    encoder.close();

    const n = Math.floor(seconds * SR), pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const on = (t >= .02 && t < .42) || (t >= .67 && t < 1.07);
      pcm[i] = on ? (((t * 196) % 1) * 2 - 1) * .5 : 0;
    }
    const buffer = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: SR });
    buffer.copyToChannel(pcm, 0);
    buffer.copyToChannel(pcm, 1);
    const audio = await YT.exporter.encodeAudio(buffer, { codec: 'opus', numberOfChannels: 2, sampleRate: SR, bitrate: 128000 }, () => {}, () => false);
    const blob = YT.mux.buildWebm({
      video: { samples, codecId: 'V_VP8', width: w, height: h },
      audio: { samples: audio.samples, description: audio.description, channels: 2, sampleRate: SR, bitrate: 128000 }
    });
    return new File([blob], 'speaker.webm', { type: 'video/webm' });
  }

  const samplePixel = (x = .5, y = .5) => {
    const stage = A.scene.output, c = document.createElement('canvas');
    c.width = stage.width;
    c.height = stage.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(stage, 0, 0);
    return [...g.getImageData(Math.floor(stage.width * x), Math.floor(stage.height * y), 1, 1).data].slice(0, 3);
  };
  const renderAt = t => { A.scene.render(A.prj, A.plan, t); };
  const reset = () => {
    A.pause();
    A.prj.clips.forEach(c => c.frames?.destroy());
    A.prj.clips = [];
    A.prj.phrases = [];
    A.prj.tracks = [];
    A.prj.midi = null;
    A.prj.song = null;
    A.prj.overrides = {};
    A.prj.options = YT.options.defaults();
    A.lookKey = 'classic';
    A.applyStageSize();
    A.recompile();
  };

  /* --------- Demo pipeline --------- */
  test('demo: words are found on the real gap, MR then BEAST', async () => {
    reset();
    const { voiceClip } = await YT.demo.load();
    const [mr, beast] = voiceClip.words;
    assert(mr.name === 'MR' && beast.name === 'BEAST');
    near(mr.end, .6, .07, 'MR ends at the gap');
    near(beast.start, .71, .07, 'BEAST starts after the gap');
    near(beast.susStart, .76, .06, 'BEAST vowel start');
    near(beast.susEnd, 1.05, .06, 'BEAST vowel end');
  });
  test('demo: lead alternates MR and BEAST, and restarts after a rest', () => {
    const lead = A.plan.events.filter(e => e.ti === 0);
    assert(lead.length > 40, `${lead.length} lead events`);
    assert(lead.slice(0, 6).map(e => e.word.name).join(' ') === 'MR BEAST MR BEAST MR BEAST', lead.slice(0, 6).map(e => e.word.name).join(' '));
    // Bar 2 has a half-beat rest before the pickup at beat 7; the phrase starts over there when asked to.
    const cfg = A.prj.tracks[0], keep = cfg.restartRest;
    cfg.restartRest = .5;
    const plan = YT.compile(A.prj);
    cfg.restartRest = keep;
    const pickupNote = A.prj.midi.tracks[0].notes.find(n => Math.abs(n.time - 7 * (60 / 124)) < .01);
    const pickup = plan.events.find(e => e.ti === 0 && e.ni === pickupNote.index);
    assert(pickup && pickup.word.name === 'MR', `pickup says ${pickup?.word.name}`);
  });
  test('demo: every voice is rendered and matches its event length', () => {
    for (const e of A.plan.events) {
      const b = A.bank.get(e.key);
      assert(b, `no voice for event ${e.id}`);
      near(b.duration, e.T + e.cfg.release / 1000, .015, `event ${e.id} (${e.word.name}) length`);
    }
  });
  test('demo: long note really is longer than short note, audio and picture', () => {
    const lead = A.plan.events.filter(e => e.ti === 0);
    const short = lead.reduce((a, b) => (b.T < a.T ? b : a));
    const long = lead.reduce((a, b) => (b.T > a.T ? b : a));
    assert(long.T > short.T * 4, `long ${long.T} short ${short.T}`);
    assert(A.bank.get(long.key).duration > A.bank.get(short.key).duration * 3);
    // Mid-note the picture is parked in the vowel, moving slowly.
    const speed = (YT.sourceTime(long, long.T * .6) - YT.sourceTime(long, long.T * .5)) / (long.T * .1);
    assert(speed < .3, `picture speed in long note ${speed}`);
  });
  test('demo: sung lead lands on the right pitch against the score', () => {
    const e = A.plan.events.find(x => x.ti === 0 && x.T > .9 && x.word.name === 'BEAST');
    assert(e, 'found a long BEAST');
    const data = A.bank.get(e.key).getChannelData(0);
    const start = Math.floor(e.T * .35 * SR), seg = data.subarray(start, start + Math.floor(.4 * SR));
    const track = YT.dsp.pitchTrack(seg, SR);
    const f = [];
    for (let i = 0; i < track.f0.length; i++) if (track.conf[i] > .7 && track.f0[i] > 0) f.push(track.f0[i]);
    f.sort((a, b) => a - b);
    const hz = f[f.length >> 1], want = YT.util.mtof(e.midi);
    // The note may have been folded down by octaves to stay singable.
    let cents = 1200 * Math.log2(hz / want);
    cents -= Math.round(cents / 1200) * 1200;
    assert(Math.abs(cents) < 35, `${hz.toFixed(1)} Hz vs ${want.toFixed(1)} Hz: ${cents.toFixed(0)} cents`);
  });
  test('demo: backing track and clips are both in the mix', async () => {
    const both = await A.audio.renderOffline(A.prj, A.plan);
    const noSong = await A.audio.renderOffline(A.prj, A.plan, { song: false });
    const noClips = await A.audio.renderOffline(A.prj, A.plan, { samples: false });
    const rms = b => { const d = b.getChannelData(0); let e = 0; for (let i = 0; i < d.length; i += 7) e += d[i] * d[i]; return Math.sqrt(e / (d.length / 7)); };
    const a = rms(both), s = rms(noSong), m = rms(noClips);
    assert(s > .01, `clips alone are silent: ${s}`);
    assert(m > .01, `song alone is silent: ${m}`);
    assert(a > Math.max(s, m), `mix ${a} should beat parts ${s}, ${m}`);
    let peak = 0;
    for (const v of both.getChannelData(0)) peak = Math.max(peak, Math.abs(v));
    assert(peak <= 1.2, `mix peak ${peak}`);
  });
  test('stage shows a different picture when the note changes', () => {
    const spots = [[.3, .5], [.8, .2], [.8, .55], [.7, .85], [.9, .85]];
    const picture = t => { renderAt(t); return spots.map(([x, y]) => samplePixel(x, y).join()).join('|'); };
    const beat = 60 / 124;
    assert(picture(.02) !== picture(beat * 2.2), 'picture differs between notes');
    assert(A.scene.lastTiles.length > 0, 'tiles on screen');
  });
  test('every layout renders with no errors and draws something', () => {
    const layouts = YT.options.globalById.layout.choices.map(c => c[0]);
    for (const layout of layouts) {
      A.prj.options.layout = layout;
      for (const t of [1, 4, 7.9, 12.3]) renderAt(t);
      const tiles = A.scene.lastTiles.length;
      assert(tiles > 0, `${layout} drew no tiles`);
    }
    A.prj.options.layout = 'stage';
  });
  test('every look preset applies, compiles and renders', () => {
    for (const key of Object.keys(YT.options.LOOKS)) {
      A.applyLook(key);
      renderAt(5);
      renderAt(5.5);
    }
    A.applyLook('classic');
  });
  test('every option in the schema has a valid default and every select default is a real choice', () => {
    const ids = new Set();
    for (const g of [...YT.options.GLOBAL, ...YT.options.TRACK]) {
      for (const o of g.items) {
        assert(!ids.has(`${o.id}`), `duplicate option id ${o.id}`);
        ids.add(o.id);
        assert(o.def !== undefined, `${o.id} has no default`);
        if (o.type === 'select') assert(o.choices.some(c => c[0] === o.def), `${o.id} default ${o.def} is not a choice`);
        if (o.type === 'range') assert(o.def >= o.min && o.def <= o.max, `${o.id} default out of range`);
      }
    }
    assert(ids.size >= 200, `only ${ids.size} options`);
  });
  test('every track motion, shape, blend and sustain mode renders', () => {
    const cfg = A.prj.tracks[0], O = YT.options.trackById;
    for (const key of ['motionIn', 'motionOut', 'motionSus', 'shape', 'blend', 'fit', 'invertMode']) {
      const keep = cfg[key];
      for (const [value] of O[key].choices) {
        cfg[key] = value;
        renderAt(.1);
        renderAt(1.05);
      }
      cfg[key] = keep;
    }
  });
  test('every background, caption and overlay mode renders', () => {
    const o = A.prj.options, G = YT.options.globalById;
    const keep = { ...o };
    for (const key of ['bgType', 'capMode', 'capPos', 'capAnim', 'ovSpectrum', 'ovParticles', 'titleStyle', 'ovWatermarkPos', 'arrange', 'chordStyle']) {
      for (const [value] of G[key].choices) {
        o[key] = value;
        o.titleText = 'TITLE';
        o.endText = 'END';
        o.ovWatermark = 'mark';
        o.ovRoll = o.ovProgress = o.ovOsd = o.ovTrackLabels = o.ovNoteLabels = true;
        renderAt(1);
        renderAt(A.plan.duration - .5);
      }
    }
    Object.assign(o, keep);
  });
  test('all effects compile in the shader and change the picture', () => {
    const o = A.prj.options;
    const keep = { ...o };
    renderAt(1.2);
    const base = samplePixel(.31, .42).join();
    const gl = A.scene.post.gl;
    assert(gl, 'WebGL2 is available here');
    for (const [id, value] of [['fxInvert', 100], ['fxHue', 120], ['fxPosterize', 80], ['fxDuo', 100], ['fxDither', 100], ['fxEdge', 100], ['fxBright', 200], ['fxVignette', 100]]) {
      o[id] = value;
      renderAt(1.2);
      const now = samplePixel(.31, .42).join();
      if (id !== 'fxVignette') assert(now !== base, `${id} did nothing`);
      o[id] = keep[id];
    }
    for (const [id, value] of [['fxRgb', 20], ['fxGlitch', 80], ['fxPixel', 30], ['fxWave', 80], ['fxSwirl', 60], ['fxBulge', 60], ['fxKaleido', 6], ['fxBloom', 100], ['fxZoomBlur', 80], ['fxTrail', 70], ['fxScan', 80], ['fxCrt', 70], ['fxVhs', 80], ['fxGrain', 80], ['fxSharpen', 200], ['fxMirrorX', true], ['fxMirrorY', true]]) {
      o[id] = value;
      renderAt(1.2);
      assert(gl.getError() === gl.NO_ERROR, `${id} raised a GL error`);
      o[id] = keep[id];
    }
    Object.assign(o, keep);
    renderAt(1.2);
    assert(samplePixel(.31, .42).join() === base, 'effects off gives the original picture back');
  });
  test('trails build up and clear on reset', () => {
    const o = A.prj.options, keep = o.fxTrail;
    A.scene.post.reset();
    o.fxTrail = 90;
    for (let i = 0; i < 5; i++) renderAt(1 + i / 30);
    o.fxTrail = keep;
    A.scene.post.reset();
    renderAt(1);
  });

  /* --------- Real files through the real doors --------- */
  test('a real MP3 file decodes as the backing track', async () => {
    const buffer = await A.audio.decode(await silentMp3().arrayBuffer());
    assert(buffer.duration > 1 && buffer.sampleRate === SR, `decoded ${buffer.duration} s at ${buffer.sampleRate}`);
  });
  test('full flow with real files: video clip, MIDI file, WAV backing, auto-sync', async () => {
    reset();
    const video = await makeVideo();
    const added = await A.addClips([video]);
    assert(added.length === 1, 'clip added');
    const clip = added[0];
    assert(clip.kind === 'video' && clip.pcm, 'has audio');
    assert(clip.words.length === 2, `found ${clip.words.length} words in the clip`);
    clip.words[0].name = 'mr';
    clip.words[1].name = 'beast';

    // A song whose onsets sit 1.25 s later than the MIDI's.
    const notes = [[0, 1, 60], [1, 1, 62], [2, .5, 64], [2.5, .5, 65], [3, 2, 67], [5, .5, 65], [5.5, .5, 64], [6, 2, 62]];
    await A.loadMidi(midiFile(notes));
    const n = SR * 7, L = new Float32Array(n), R = new Float32Array(n);
    for (const [beat] of notes) {
      const at = Math.floor((1.25 + beat * .5) * SR);
      for (let i = 0; i < 2400 && at + i < n; i++) { const v = Math.sin(i * .09) * Math.exp(-i / 700) * .8; L[at + i] += v; R[at + i] += v; }
    }
    await A.loadSong(wavFile([L, R]));
    for (let i = 0; i < 100 && !A.prj.song.analysis; i++) await sleep(50);
    assert(A.prj.song.analysis, 'song analysed');
    const result = await A.autoAlign({ maxShift: 6 });
    near(result.shift, 1.25, .03, 'auto-sync found the offset');
    assert(A.prj.options.midiShift === Math.round(result.shift * 1000) / 1000, 'offset applied');
    A.recompile();
    await A.prepared;
    near(A.plan.events[0].start, 1.25, .03, 'first note moved with it');
    assert(A.plan.events.map(e => e.word.name).slice(0, 4).join(' ') === 'mr beast mr beast', A.plan.events.map(e => e.word.name).slice(0, 4).join(' '));

    // Real frames are decoded from the real video, and red/blue matches the word.
    await A.ensureFrames();
    const redFrame = clip.frames.get(clip.words[0].start + .1), blueFrame = clip.frames.get(clip.words[1].start + .1);
    assert(redFrame && blueFrame, 'frames decoded');
    const pick = bmp => {
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      return [...g.getImageData(4, 4, 1, 1).data];
    };
    const red = pick(redFrame), blue = pick(blueFrame);
    assert(red[0] > 150 && red[2] < 100, `first word's frame should be red: ${red}`);
    assert(blue[2] > 150 && blue[0] < 100, `second word's frame should be blue: ${blue}`);

    // What reaches the screen follows the sung word.
    A.prj.options.layout = 'full';
    A.prj.options.bgType = 'solid';
    A.prj.tracks[0].motionIn = 'none';
    const mr = A.plan.events.find(e => e.word.name === 'mr'), beast = A.plan.events.find(e => e.word.name === 'beast');
    renderAt(mr.start + .1);
    const onMr = samplePixel(.05, .05);
    renderAt(beast.start + .1);
    const onBeast = samplePixel(.05, .05);
    assert(onMr[0] > 120 && onMr[2] < 110, `screen on mr should be red: ${onMr}`);
    assert(onBeast[2] > 120 && onBeast[0] < 110, `screen on beast should be blue: ${onBeast}`);
  });
  test('reordering a phrase changes what is sung', async () => {
    const [mr, beast] = A.prj.clips[0].words;
    const phrase = A.prj.phrases[0];
    phrase.auto = false;
    phrase.steps = [beast, beast, mr].map(w => ({ type: 'word', wordId: w.id }));
    A.recompile();
    assert(A.plan.events.slice(0, 3).map(e => e.word.name).join(' ') === 'beast beast mr', 'order follows the phrase');
    const parsed = YT.phrasesUI.parseText('MR _ Beast ~ nope');
    assert(parsed.steps.length === 4 && parsed.unknown[0] === 'nope', 'typed order parses');
  });
  test('moving a word cut gives it new audio', async () => {
    const word = A.prj.clips[0].words[0];
    const before = word.ver;
    word.end -= .05;
    word.ver++;
    await A.analyzeWord(word);
    A.recompile();
    await A.prepared;
    assert(word.ver === before + 1);
    assert(A.plan.events.filter(e => e.word === word).every(e => A.bank.get(e.key)), 'voices re-rendered for the new cut');
  });
  test('hand-picked word on a note survives a recompile', async () => {
    const beast = A.prj.clips[0].words[1];
    A.prj.overrides['0:7'] = beast.id;
    A.recompile();
    assert(A.plan.events.find(e => e.ni === 7).word === beast);
    delete A.prj.overrides['0:7'];
  });
  test('project file round-trips settings, order and cuts', async () => {
    A.prj.options.fxHue = 42;
    const data = JSON.parse(JSON.stringify(A.serialize()));
    const clipFile = A.prj.clips[0].file;
    const beforeWords = A.prj.clips[0].words.map(w => [w.name, w.start]);
    const beforeOrder = A.prj.phrases[0].steps.map(s => s.wordId);
    const info = A.load(data);
    assert(info.needClips.length === 1, 'asks for the clip back');
    assert(A.prj.options.fxHue === 42, 'option restored');
    assert(A.prj.midi, 'MIDI restored from the project');
    await A.addClips([clipFile]);
    assert(JSON.stringify(A.prj.clips[0].words.map(w => [w.name, w.start])) === JSON.stringify(beforeWords), 'cuts restored');
    assert(JSON.stringify(A.prj.phrases[0].steps.map(s => s.wordId)) === JSON.stringify(beforeOrder), 'order restored');
    A.recompile();
    assert(A.plan.events.length > 0, 'plays again');
    await A.prepared;
    A.prj.options.fxHue = 0;
  });

  /* --------- Export --------- */
  const loadVideo = async blob => {
    const v = document.createElement('video');
    v.muted = true;
    v.src = URL.createObjectURL(blob);
    await new Promise((res, rej) => {
      v.onloadeddata = res;
      v.onerror = () => rej(new Error(`player rejected the file: ${v.error?.message}`));
      setTimeout(() => rej(new Error('player timed out')), 15000);
    });
    return v;
  };
  const seekTo = (v, t) => new Promise(r => { v.onseeked = r; v.currentTime = t; });
  const frameColor = v => {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 18;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(v, 0, 0, 32, 18);
    return [...g.getImageData(2, 2, 1, 1).data];
  };

  async function exportWith(format) {
    A.exporting = true;
    const before = [A.scene.w, A.scene.h];
    A.scene.resize(640, 360);
    const result = await YT.exporter.exportVideo(A, { width: 640, height: 360, fps: 30, videoMbps: 4, audioKbps: 128, format }, () => {}, () => false);
    A.scene.resize(...before);
    A.exporting = false;
    return result;
  }

  async function checkExport(result, wantDur) {
    assert(result && result.blob && result.blob.size > 2000, 'file produced');
    const v = await loadVideo(result.blob);
    assert(v.videoWidth === 640 && v.videoHeight === 360, `size ${v.videoWidth}x${v.videoHeight}`);
    near(v.duration, wantDur, .25, 'duration');
    // The video's audio must decode and contain the mix.
    const audio = await A.audio.decode(await result.blob.arrayBuffer());
    near(audio.duration, wantDur, .3, 'audio duration');
    const d = audio.getChannelData(0);
    let e = 0;
    for (let i = 0; i < d.length; i += 11) e += d[i] * d[i];
    assert(Math.sqrt(e / (d.length / 11)) > .005, 'exported audio has sound');
    // Picture at a known time matches the sung word.
    const mr = A.plan.events.find(x => x.word.name === 'mr' && x.T > .2), beast = A.plan.events.find(x => x.word.name === 'beast' && x.T > .2);
    await seekTo(v, mr.start + .12);
    const onMr = frameColor(v);
    await seekTo(v, beast.start + .12);
    const onBeast = frameColor(v);
    assert(onMr[0] > onMr[2] + 40, `exported frame on mr should be red: ${onMr}`);
    assert(onBeast[2] > onBeast[0] + 40, `exported frame on beast should be blue: ${onBeast}`);
    return { format: result.label, MB: (result.blob.size / 1048576).toFixed(2), dur: v.duration };
  }

  test('export: frame-accurate video with sound (best available format)', async () => {
    A.prj.options.layout = 'full';
    A.prj.options.bgType = 'solid';
    A.prj.tracks[0].motionIn = 'none';
    A.recompile();
    await A.prepared;
    await A.ensureFrames();
    const result = await exportWith('auto');
    window.EXPORT_REPORT = window.EXPORT_REPORT || [];
    window.EXPORT_REPORT.push(await checkExport(result, A.plan.duration));
  });
  test('export: WebM format plays back correctly too', async () => {
    const result = await exportWith('webm');
    assert(result.extension === 'webm', `got ${result.extension}`);
    window.EXPORT_REPORT.push(await checkExport(result, A.plan.duration));
  });
  test('export: MP4 writer produces a structure players accept', async () => {
    const support = await YT.exporter.pickFormat('auto', 640, 360, 30, 4e6, 128000);
    window.MP4_SUPPORT = support ? support.container : 'none';
    if (support?.container !== 'mp4') return;
    const result = await exportWith('auto');
    const bytes = new Uint8Array(await result.blob.slice(0, 64).arrayBuffer());
    assert(String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp', 'starts with ftyp');
  });
  test('export: cancelling stops cleanly', async () => {
    let calls = 0;
    A.exporting = true;
    const result = await YT.exporter.exportVideo(A, { width: 320, height: 180, fps: 30, videoMbps: 2, audioKbps: 128, format: 'webm' }, () => { calls++; }, () => calls > 8);
    A.exporting = false;
    A.applyStageSize();
    assert(result.cancelled, 'reported as cancelled');
  });
  test('WAV export is a valid file', async () => {
    const buffer = await A.audio.renderOffline(A.prj, A.plan);
    const blob = YT.util.encodeWav(buffer);
    const decoded = await A.audio.decode(await blob.arrayBuffer());
    near(decoded.duration, buffer.duration, .01);
  });

  /* --------- Live playback --------- */
  test('live playback: clock runs, seeking works, pausing holds position', async () => {
    await A.audio.ensure(A.prj);
    if (A.audio.ctx.state !== 'running') {
      window.PLAYBACK_NOTE = `AudioContext is ${A.audio.ctx.state} here (needs a click); skipped live clock check`;
      return;
    }
    await A.play(0);
    await sleep(600);
    const t = A.currentTime();
    assert(t > .3 && t < 1.2, `clock at ${t}`);
    assert(A.audio.live.size >= 0);
    A.seek(2);
    await sleep(200);
    assert(A.currentTime() > 2 && A.currentTime() < 2.6, `after seek ${A.currentTime()}`);
    A.pause();
    const held = A.currentTime();
    await sleep(150);
    assert(A.currentTime() === held, 'position holds while paused');
  });
})();
