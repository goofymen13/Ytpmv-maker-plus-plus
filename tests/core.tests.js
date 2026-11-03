/* Core tests: MIDI parsing, the stretch engine and the word sequencer. No browser features beyond typed arrays. */
(function () {
  'use strict';
  const { test, assert, near } = window.TestKit;
  const SR = 48000;
  const DSP = YT.dsp;

  /* Vowel-like test tone: harmonics + slight vibrato, so the pitch tracker has real work to do. */
  function vowel(seconds, hz, sr = SR) {
    const n = Math.floor(seconds * sr), x = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      ph += hz / sr;
      let s = 0;
      for (let h = 1; h <= 12; h++) s += Math.sin(2 * Math.PI * h * ph) / h * (h === 3 || h === 7 ? 1.4 : 1);
      x[i] = s * .22;
    }
    return x;
  }
  /* "MR"-like word: 80 ms of noisy consonant, then the vowel. */
  function word(hz = 130, consonant = .08, voweled = .25) {
    const a = Math.floor(consonant * SR), v = vowel(voweled, hz), x = new Float32Array(a + v.length);
    const rnd = YT.util.rng(5);
    for (let i = 0; i < a; i++) x[i] = (rnd() * 2 - 1) * .12;
    x.set(v, a);
    return x;
  }
  /* Autocorrelation pitch of the last part of a render, for checking tuning. */
  function measureHz(x, from = .3, to = .95, sr = SR) {
    const a = Math.floor(x.length * from), b = Math.floor(x.length * to), seg = x.subarray(a, b);
    const track = DSP.pitchTrack(seg, sr);
    const f = [];
    for (let i = 0; i < track.f0.length; i++) if (track.conf[i] > .7 && track.f0[i] > 0) f.push(track.f0[i]);
    f.sort((p, q) => p - q);
    return f.length ? f[f.length >> 1] : 0;
  }
  const rms = x => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));
  const cents = (a, b) => 1200 * Math.log2(a / b);

  const baseWord = (over = {}) => ({ id: 'w', ver: 1, start: 0, end: .33, susStart: .08, susEnd: .3, root: 48, ...over });
  const cfg = over => ({ ...YT.options.trackDefaults(), ...over });

  /* --------- Time map behaviour: this is the MRRRR requirement --------- */
  test('long note: consonant stays natural, vowel takes all the extra time', () => {
    const m = YT.buildMap(baseWord(), 2, cfg({ stretch: 'smart' }));
    near(DSP.evalMap(m, .04), .04, .001, 'consonant runs at natural speed');
    near(DSP.evalMap(m, .08), .08, .001, 'vowel starts where it should');
    near(DSP.evalMap(m, 2), .33, .001, 'word finishes exactly at note end');
    near(DSP.evalMap(m, 1.97), .3, .001, 'tail is natural too');
    const mid = (DSP.evalMap(m, 1.2) - DSP.evalMap(m, 1)) / .2;
    assert(mid < .15, `vowel should crawl on a long note, speed was ${mid}`);
  });
  test('short note: word speeds up, and the whole word still fits', () => {
    const m = YT.buildMap(baseWord(), .15, cfg({ stretch: 'smart', maxSpeed: 300 }));
    near(m[m.length - 2], .15, .01, 'fits the note');
    near(m[m.length - 1], .33, .001, 'whole word is said');
  });
  test('three note lengths give three different word speeds', () => {
    const c = cfg({ stretch: 'smart', maxSpeed: 300 });
    const speed = T => { const m = YT.buildMap(baseWord(), T, c); return (DSP.evalMap(m, T * .45) - DSP.evalMap(m, T * .35)) / (T * .1); };
    const short = speed(.15), normal = speed(.5), long = speed(3);
    assert(short > normal && normal > long, `expected short > normal > long, got ${short} ${normal} ${long}`);
  });
  test('short note past the speed limit gets cut rather than turned into noise', () => {
    const m = YT.buildMap(baseWord(), .04, cfg({ stretch: 'smart', maxSpeed: 200 }));
    assert(m[m.length - 2] > .04, 'map runs past the note, so the note cuts it');
  });
  test('turning the tail off holds the vowel to the very end', () => {
    const m = YT.buildMap(baseWord(), 2, cfg({ stretch: 'smart', keepTail: false }));
    near(DSP.evalMap(m, 2), .3, .001, 'ends on the vowel');
  });
  test('frozen hold parks on one position', () => {
    const m = YT.buildMap(baseWord(), 2, cfg({ stretch: 'smart', holdMode: 'freeze' }));
    near(DSP.evalMap(m, 1), DSP.evalMap(m, 1.2), .001, 'position does not move during the hold');
  });
  test('uniform stretch is a straight line', () => {
    const m = YT.buildMap(baseWord(), 1, cfg({ stretch: 'uniform' }));
    near(DSP.evalMap(m, .5), .165, .001);
  });

  /* --------- Rendered audio --------- */
  const render = (x, p) => DSP.renderVoice({ pcm: x, sr: SR }, { pitched: true, flatten: 1, follow: 0, grainMs: 30, seed: 3, attack: 1, release: 5, sustain: 1, ...p });

  for (const engine of ['psola', 'wsola', 'granular']) {
    test(`${engine}: holds a 2 second note and keeps the note in tune`, () => {
      const x = vowel(.4, 130.81);
      const y = render(x, { engine, T: 2, map: [0, 0, 2, .4], semis: 7 });
      near(y.length, 96000, 2, 'exact output length');
      const hz = measureHz(y), want = 130.81 * 2 ** (7 / 12);
      assert(hz > 0, 'found a pitch');
      assert(Math.abs(cents(hz, want)) < 30, `${hz.toFixed(1)} Hz vs ${want.toFixed(1)} Hz, ${cents(hz, want).toFixed(0)} cents off`);
      assert(rms(y.subarray(20000, 80000)) > .02, 'no dropout while sustained');
    });
    test(`${engine}: stays in tune an octave down and two octaves up`, () => {
      const x = vowel(.4, 220);
      for (const semis of [-12, 12, 24]) {
        const y = render(x, { engine, T: 1, map: [0, 0, 1, .4], semis });
        const hz = measureHz(y), want = 220 * 2 ** (semis / 12);
        assert(Math.abs(cents(hz, want)) < 40, `${semis} st: ${hz.toFixed(1)} vs ${want.toFixed(1)}`);
      }
    });
  }
  test('voice engine: chipmunk slider moves timbre, not pitch', () => {
    const x = vowel(.4, 200);
    const plain = render(x, { engine: 'psola', T: 1, map: [0, 0, 1, .4], semis: 7, follow: 0 });
    const munk = render(x, { engine: 'psola', T: 1, map: [0, 0, 1, .4], semis: 7, follow: 1 });
    const a = measureHz(plain), b = measureHz(munk);
    assert(Math.abs(cents(a, b)) < 30, `pitch should match: ${a} vs ${b}`);
    let diff = 0;
    for (let i = 0; i < plain.length; i++) diff += Math.abs(plain[i] - munk[i]);
    assert(diff / plain.length > .005, 'timbre should change');
  });
  test('no clicks: envelope reaches silence at both ends', () => {
    const y = render(word(), { engine: 'psola', T: .6, map: [0, 0, .08, .08, .6, .33], semis: 3, release: 10 });
    assert(Math.abs(y[0]) < .01, 'starts near silence');
    assert(Math.abs(y[y.length - 1]) < .01, 'ends near silence');
  });
  test('nothing unstable: no NaN or wild peaks on any engine at extreme settings', () => {
    const x = word();
    for (const engine of ['psola', 'wsola', 'granular']) {
      for (const semis of [-30, 30]) {
        const y = render(x, { engine, T: 3, map: [0, 0, .08, .08, 3, .33], semis });
        let peak = 0;
        for (const v of y) { assert(Number.isFinite(v), `${engine} produced NaN`); peak = Math.max(peak, Math.abs(v)); }
        assert(peak < 4, `${engine} at ${semis} st peaked at ${peak}`);
      }
    }
  });
  test('old-sampler mode: speed and pitch move together and it ends early', () => {
    const x = vowel(.5, 200);
    const y = render(x, { tape: 'cut', T: .25, map: null, semis: 12 });
    near(measureHz(y, .1, .9), 400, 12, 'one octave up');
  });
  test('old-sampler loop fills a long note with no gap', () => {
    const y = render(vowel(.3, 200), { tape: 'loop', T: 2, map: null, semis: 0, loopA: .1, loopB: .25 });
    assert(rms(y.subarray(40000, 90000)) > .05, 'loop still sounding near the end');
  });
  test('reverse plays the word backwards', () => {
    const x = new Float32Array(SR / 2);
    for (let i = 0; i < 2000; i++) x[i] = Math.sin(i * .2);
    const y = render(x, { engine: 'wsola', T: .5, map: [0, 0, .5, .5], reverse: true, semis: 0, pitched: false, attack: 0, release: 0 });
    const head = rms(y.subarray(0, 5000)), tail = rms(y.subarray(y.length - 5000));
    assert(tail > head * 5, `energy should be at the end: head ${head} tail ${tail}`);
  });
  test('identity voice is sample-accurate (drums stay crisp)', () => {
    const x = vowel(.1, 300);
    const y = DSP.renderVoice({ pcm: x, sr: SR }, { T: .1, map: [0, 0, .1, .1], semis: 0, pitched: false, attack: 0, release: 0, sustain: 1 });
    near(y[2000], x[2000], .0001);
  });

  /* --------- Word finding --------- */
  test('finds two words separated by silence', () => {
    const a = word(130), b = word(150, .05, .3), gap = Math.floor(.12 * SR);
    const x = new Float32Array(a.length + gap + b.length + SR / 5);
    x.set(a, SR / 10);
    x.set(b, SR / 10 + a.length + gap);
    const found = DSP.detectWords(x, SR);
    assert(found.length === 2, `found ${found.length} words`);
    near(found[0].start, .1, .03);
    near(found[1].start, .1 + a.length / SR + .12, .03);
  });
  test('asking for a word count splits at the deepest dip, even with no real silence', () => {
    const a = vowel(.3, 130), b = vowel(.3, 150), x = new Float32Array(a.length + b.length);
    x.set(a); x.set(b, a.length);
    // A dip rather than silence in the middle.
    for (let i = 0; i < x.length; i++) x[i] *= 1 - .85 * Math.exp(-(((i - a.length) / 1200) ** 2));
    const found = DSP.detectWords(x, SR, { count: 2 });
    assert(found.length === 2, `found ${found.length}`);
    near(found[0].end, .3, .04);
  });
  test('word analysis finds the vowel and its pitch', () => {
    const info = DSP.wordInfo(word(146.83), SR);
    near(info.rootMidi, 50, .4, 'root pitch');
    assert(info.susStart >= .05 && info.susStart < .15, `vowel starts ${info.susStart}`);
    assert(info.susEnd > .25, `vowel ends ${info.susEnd}`);
  });
  test('noise has no root pitch, and still gets a stretch region', () => {
    const rnd = YT.util.rng(9), x = new Float32Array(SR / 3).map(() => (rnd() * 2 - 1) * .3);
    const info = DSP.wordInfo(x, SR);
    assert(info.voiced < .4, `voiced ${info.voiced}`);
    assert(info.susEnd > info.susStart);
  });

  /* --------- Sequencer --------- */
  const mkWord = (id, name) => ({ id, name, ver: 1, start: 0, end: .3, susStart: .05, susEnd: .25, root: 60, rms: .14, clip: {} });
  const mr = mkWord('mr', 'mr'), beast = mkWord('beast', 'beast'), yeah = mkWord('yeah', 'yeah');
  const n = (time, midi = 60, duration = .2, velocity = .8) => ({ time, midi, duration, velocity });
  function project(notes, trackOver = {}, phrase = [mr, beast], extra = {}) {
    notes.forEach((x, i) => { x.index = i; });
    const clip = { id: 'c', words: [mr, beast, yeah] };
    return {
      midi: { tracks: [{ name: 'T', notes }], duration: 8, tempos: [{ time: 0, bpm: 120 }], beats: Array.from({ length: 32 }, (_, i) => ({ time: i * .5, strong: i % 4 === 0, bar: Math.floor(i / 4), beat: i % 4 })) },
      song: null, clips: [clip],
      phrases: [{ id: 'p', steps: phrase.map(w => (w === 'rest' || w === 'hold' ? { type: w } : { type: 'word', wordId: w.id })) }],
      // Sequencer tests want exact note times and pitches, so the two musical helpers start off here.
      tracks: [{ ...YT.options.trackDefaults(), source: 'p', role: 'lead', preUtter: 0, autoOctave: false, ...trackOver }],
      options: { ...YT.options.defaults(), ...extra.options }, overrides: extra.overrides || {}
    };
  }
  const said = plan => plan.events.map(e => e.word.name).join(' ');

  test('words say one after another, in order', () => {
    const plan = YT.compile(project([n(0), n(.5), n(1), n(1.5)]));
    assert(said(plan) === 'mr beast mr beast', said(plan));
  });
  test('custom order is respected, with repeats', () => {
    const plan = YT.compile(project([n(0), n(.5), n(1), n(1.5), n(2)], {}, [mr, mr, beast, yeah]));
    assert(said(plan) === 'mr mr beast yeah mr', said(plan));
  });
  test('a chord says one word together', () => {
    const plan = YT.compile(project([n(0, 60), n(0, 64), n(0, 67), n(.5)]));
    assert(said(plan) === 'mr mr mr beast', said(plan));
  });
  test('"each note" mode gives chord notes their own word', () => {
    const plan = YT.compile(project([n(0, 60), n(0, 64)], { order: 'note' }));
    assert(said(plan) === 'mr beast', said(plan));
  });
  test('a rest brings the phrase back to word one', () => {
    const plan = YT.compile(project([n(0), n(.25), n(.5), n(3), n(3.25)], { restartRest: 2 }));
    assert(said(plan) === 'mr beast mr mr beast', said(plan));
  });
  test('restart every bar', () => {
    const plan = YT.compile(project([n(0), n(.5), n(1), n(2), n(2.5)], { restartRest: 0, restartBars: 1 }));
    assert(said(plan) === 'mr beast mr mr beast', said(plan));
  });
  test('whole phrase inside one note splits it by word length', () => {
    const plan = YT.compile(project([n(0, 60, 1)], { order: 'fit' }));
    assert(said(plan) === 'mr beast', said(plan));
    near(plan.events[1].start, .5, .01);
    near(plan.events[0].T + plan.events[1].T, 1, .05);
  });
  test('rest steps swallow notes and hold steps continue the last word without its consonant', () => {
    const plan = YT.compile(project([n(0), n(.5), n(1), n(1.5)], { restartRest: 0 }, [mr, 'hold', 'rest', beast]));
    assert(said(plan) === 'mr mr beast', said(plan));
    near(plan.events[1].map[1], .05, .001, 'hold starts at the vowel');
  });
  test('different pitches pick different words (drum maps)', () => {
    const plan = YT.compile(project([n(0, 36), n(.5, 38), n(1, 36), n(1.5, 42)], { order: 'pitch' }, [mr, beast, yeah]));
    assert(said(plan) === 'mr beast mr yeah', said(plan));
  });
  test('random and shuffle are repeatable with the same seed', () => {
    const notes = () => Array.from({ length: 24 }, (_, i) => n(i * .25));
    for (const order of ['random', 'shuffle']) {
      const a = said(YT.compile(project(notes(), { order, restartRest: 0 }, [mr, beast, yeah])));
      const b = said(YT.compile(project(notes(), { order, restartRest: 0 }, [mr, beast, yeah])));
      assert(a === b, `${order} differed`);
    }
    const shuffled = YT.compile(project(notes(), { order: 'shuffle', restartRest: 0 }, [mr, beast, yeah])).events.map(e => e.word.name);
    for (let i = 0; i + 3 <= 24; i += 3) assert(new Set(shuffled.slice(i, i + 3)).size === 3, 'each bag uses every word once');
  });
  test('a hand-picked word on one note overrides the phrase', () => {
    const plan = YT.compile(project([n(0), n(.5), n(1)], {}, [mr, beast], { overrides: { '0:1': 'yeah' } }));
    assert(said(plan) === 'mr yeah mr', said(plan));
  });
  test('note length reaches the stretch', () => {
    const plan = YT.compile(project([n(0, 60, .1), n(1, 60, 2)], { maxSpeed: 500, restartRest: 0 }));
    assert(plan.events[0].T < .15, `short ${plan.events[0].T}`);
    near(plan.events[1].T, 2, .01, 'long note lasts the full note');
  });
  test('identical notes share one rendered voice', () => {
    const plan = YT.compile(project([n(0), n(.5), n(1), n(1.5)], {}, [mr]));
    assert(plan.voices.size === 1, `rendered ${plan.voices.size}`);
  });
  test('tuning uses the word root, and octave fold keeps extremes singable', () => {
    const plan = YT.compile(project([n(0, 67), n(.5, 120)], { maxShift: 24, restartRest: 0 }, [mr]));
    near(YT.util.clamp(plan.events[0].key.length, 0, 1), 1, 0);
    const voices = [...plan.voices.values()].map(v => v.params.semis);
    assert(voices.includes(7), `semis ${voices}`);
    assert(voices.every(s => Math.abs(s) <= 24), `semis ${voices}`);
  });
  test('vocal-range move shifts the whole part by octaves and keeps the melody shape', () => {
    const notes = () => [n(0, 84), n(.5, 88), n(1, 91), n(1.5, 96)];
    const plan = YT.compile(project(notes(), { autoOctave: true, restartRest: 0, maxShift: 72 }, [mr]));
    const semis = plan.events.map(e => [...plan.voices.values()].find(v => e.key.includes(JSON.stringify(v.params)))?.params.semis);
    assert(semis.every(s => Math.abs(s) <= 13 + 12), `moved near the voice: ${semis}`);
    assert(semis[1] - semis[0] === 4 && semis[2] - semis[0] === 7 && semis[3] - semis[0] === 12, `interval shape kept: ${semis}`);
    assert(semis[0] % 12 === 0, `whole octaves only: ${semis}`);
  });
  test('vocal-range move leaves a part alone if it is already in range', () => {
    const plan = YT.compile(project([n(0, 64), n(.5, 67)], { autoOctave: true, restartRest: 0 }, [mr]));
    const semis = [...plan.voices.values()].map(v => v.params.semis).sort((a, b) => a - b);
    assert(semis[0] === 4 && semis[1] === 7, `semis ${semis}`);
  });
  test('vowel on the beat: consonant starts early and the note end does not move', () => {
    const plan = YT.compile(project([n(1, 60, .5)], { preUtter: 100 }, [mr]));
    const e = plan.events[0];
    near(e.start, 1 - .05, .001, 'starts one consonant early');
    near(e.start + e.T, 1.5, .002, 'still ends at note end');
    near(YT.sourceTime(e, 1 - e.start), .05, .002, 'vowel begins exactly on the note');
  });
  test('MIDI offset and tempo stretch move notes, and speed scales everything', () => {
    let plan = YT.compile(project([n(1)], {}, [mr], { options: { midiShift: 2 } }));
    near(plan.events[0].start, 3, .001);
    plan = YT.compile(project([n(1)], {}, [mr], { options: { midiScale: 110 } }));
    near(plan.events[0].start, 1.1, .001);
    plan = YT.compile(project([n(1)], {}, [mr], { options: { songSpeed: 200 } }));
    near(plan.events[0].start, .5, .001);
  });
  test('negative MIDI offset delays the song instead of losing notes', () => {
    const plan = YT.compile(project([n(1)], {}, [mr], { options: { midiShift: -2 } }));
    near(plan.events[0].start, 1, .001);
    near(plan.songStart, 2, .001);
  });
  test('video follows the audio time map', () => {
    const plan = YT.compile(project([n(0, 60, 2)], {}, [mr]));
    const e = plan.events[0];
    near(YT.sourceTime(e, 0), 0, .001);
    near(YT.sourceTime(e, e.T), .3, .001);
    assert(YT.sourceTime(e, 1) > .05 && YT.sourceTime(e, 1) < .25, 'mid-note is in the vowel');
  });
  test('reversed word plays the picture backwards too', () => {
    const w = { ...mr, id: 'rev', reverse: true };
    const prj = project([n(0, 60, 1)], {}, [w]);
    prj.clips[0].words.push(w);
    const plan = YT.compile(prj);
    near(YT.sourceTime(plan.events[0], 0), .3, .001, 'starts at word end');
    near(YT.sourceTime(plan.events[0], plan.events[0].T), 0, .001, 'ends at word start');
  });
  test('picture holds until the next note by default', () => {
    const plan = YT.compile(project([n(0, 60, .1), n(1)], {}, [mr]));
    near(plan.events[0].visEnd, 1, .001);
  });
  test('reactive envelopes exist and spike on hits', () => {
    const plan = YT.compile(project([n(1)], {}, [mr]));
    assert(plan.env.notes[Math.floor(1.0 * plan.env.rate) + 1] > .5, 'spike at the hit');
    assert(plan.env.notes[Math.floor(.5 * plan.env.rate)] === 0, 'silent before it');
  });

  /* --------- MIDI parser (ported from the original project's tests) --------- */
  function midiFile(track, division = 480) {
    const name = s => [...s].map(c => c.charCodeAt(0));
    const b = Uint8Array.from([...name('MThd'), 0, 0, 0, 6, 0, 0, 0, 1, division >> 8, division & 255, ...name('MTrk'), track.length >>> 24, track.length >>> 16 & 255, track.length >>> 8 & 255, track.length & 255, ...track]);
    return b.buffer;
  }
  test('parser: tempo changes, running status, channel separation', () => {
    const score = YT.parseMidi(midiFile([
      0, 255, 81, 3, 7, 161, 32,
      0, 144, 60, 100, 0, 64, 80,
      0, 153, 36, 100,
      0x83, 0x60, 128, 60, 0, 0, 64, 0, 0, 137, 36, 0,
      0, 255, 81, 3, 15, 66, 64,
      0, 144, 62, 90, 0x83, 0x60, 128, 62, 0, 0, 255, 47, 0
    ]));
    assert(score.tracks.length === 2);
    near(score.tracks[0].notes[0].duration, .5, .0001);
    near(score.tracks[0].notes[2].time, .5, .0001);
    near(score.tracks[0].notes[2].duration, 1, .0001);
    assert(score.tracks[1].percussion === true);
    near(score.duration, 1.5, .0001);
  });
  test('parser: sustain pedal, SMPTE timing and useful errors', () => {
    const pedal = YT.parseMidi(midiFile([0, 144, 60, 100, 0, 176, 64, 127, 120, 128, 60, 0, 120, 176, 64, 0, 0, 255, 47, 0]));
    near(pedal.tracks[0].notes[0].duration, .25, .0001);
    const smpte = YT.parseMidi(midiFile([0, 144, 60, 100, 100, 128, 60, 0, 0, 255, 47, 0], 0xe728));
    near(smpte.tracks[0].notes[0].duration, .1, .0001);
    let message = '';
    try { YT.parseMidi(new ArrayBuffer(2)); } catch (e) { message = e.message; }
    assert(/truncated/.test(message), message);
    try { YT.parseMidi(midiFile([0, 60, 100])); } catch (e) { message = e.message; }
    assert(/running status/.test(message), message);
  });
  test('parser: pitch bends reach the notes', () => {
    const score = YT.parseMidi(midiFile([0, 144, 60, 100, 120, 224, 0, 96, 120, 128, 60, 0, 0, 255, 47, 0]));
    const bend = score.tracks[0].notes[0].bend;
    assert(bend && bend.length >= 4, 'has bend points');
    near(bend[3], 1, .01, 'half way up a 2-semitone range');
  });
  test('parser: skips unknown chunks and tolerates a bad final length', () => {
    const name = s => [...s].map(c => c.charCodeAt(0));
    const track = [0, 144, 60, 100, 120, 128, 60, 0, 0, 255, 47, 0];
    const junk = [...name('JUNK'), 0, 0, 0, 2, 9, 9];
    const f = Uint8Array.from([...name('MThd'), 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, ...junk, ...name('MTrk'), 0, 0, 255, 255, ...track]);
    assert(YT.parseMidi(f.buffer).tracks.length === 1);
  });

  /* --------- Auto-align --------- */
  test('auto-align finds a known offset between MIDI and audio', () => {
    const rate = 100, frames = 3000, onset = new Float32Array(frames);
    const hits = [];
    const rnd = YT.util.rng(3);
    let t = 0;
    while (t < 22) { hits.push([t, .5 + rnd() * .5]); t += .2 + Math.floor(rnd() * 4) * .2; }
    const shift = 3.37;
    for (const [time, w] of hits) onset[Math.round((time + shift) * rate)] = w;
    const result = DSP.alignMidi(onset, rate, hits, { maxShift: 15 });
    near(result.shift, shift, .02, 'shift');
    assert(result.confidence > 4, `confidence ${result.confidence}`);
  });
  test('auto-align finds a tempo mismatch too', () => {
    const rate = 100, frames = 5000, onset = new Float32Array(frames), hits = [];
    const rnd = YT.util.rng(4);
    let t = 0;
    while (t < 40) { hits.push([t, 1]); t += .2 + Math.floor(rnd() * 3) * .2; }
    for (const [time] of hits) onset[Math.round((time * 1.02 + 1) * rate)] = 1;
    const scales = [];
    for (let s = .96; s <= 1.04; s += .005) scales.push(+s.toFixed(3));
    const result = DSP.alignMidi(onset, rate, hits, { maxShift: 5, scales });
    near(result.scale, 1.02, .006, 'scale');
    near(result.shift, 1, .05, 'shift');
  });
})();
