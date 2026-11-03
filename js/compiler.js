/* Turns MIDI + phrases + track settings into a playable plan: one event per sung word.
   Audio and video both read these events, so they can never disagree about what happens when. */
(function (YT) {
  'use strict';
  const U = YT.util, clamp = U.clamp;
  const SYNC_BEATS = { '1/4': 1, '1/8': .5, '1/8d': .75, '1/8t': 1 / 3, '1/16': .25, '1/16t': 1 / 6, '1/32': .125 };

  const wordDur = w => Math.max(.001, w.end - w.start);

  /* The heart of the "MR / MRR / MRRRRRR" behaviour.
     Builds a time map (output seconds -> seconds inside the word):
       A = consonant before the vowel, S = vowel, R = whatever follows it.
     Long note: A and R stay natural and S takes up all the extra time.
     Short note: S gives up time first, then the whole word speeds up, then it is cut. */
  function buildMap(word, T, cfg, skipAttack) {
    const N = wordDur(word);
    let A = clamp(word.susStart - word.start, 0, N);
    let R = clamp(word.end - word.susEnd, 0, N - A);
    if (word.reverse) [A, R] = [R, A];
    const S = Math.max(.001, N - A - R);
    const from = skipAttack ? A : 0;
    const a = A - from;

    if (cfg.stretch === 'uniform') return [0, from, T, N];
    if (cfg.stretch === 'natural') {
      const len = Math.min(T, N - from);
      return [0, from, len, from + len];
    }

    const tail = cfg.keepTail ? R : 0;
    const endU = cfg.keepTail ? N : A + S;
    if (cfg.shortNote === 'cut' && T < a + S + tail) return [0, from, T, from + T];

    const SUS_MAX_SPEED = 3;
    const minBody = a + tail + S / SUS_MAX_SPEED;
    if (T >= minBody) {
      const hold = T - a - tail;
      if (cfg.holdMode === 'freeze' && hold > S) {
        // Sing into the vowel, park on one spot, then come out of it.
        const lead = S * .5, out = S * .25;
        const pts = [0, from];
        if (a > 0) pts.push(a, A);
        pts.push(a + lead, A + lead, T - tail - out, A + lead, T - tail, A + S);
        if (tail > 0) pts.push(T, endU);
        return pts;
      }
      const pts = [0, from];
      if (a > 0) pts.push(a, A);
      pts.push(T - tail, A + S);
      if (tail > 0) pts.push(T, endU);
      return pts;
    }
    // Faster than natural: squeeze everything, up to the speed limit, and past that it just ends early.
    const maxSpeed = Math.max(1, cfg.maxSpeed / 100);
    const c = Math.max(T / minBody, 1 / maxSpeed);
    const pts = [0, from];
    let t = 0;
    if (a > 0) { t += a * c; pts.push(t, A); }
    t += (S / SUS_MAX_SPEED) * c;
    pts.push(t, A + S);
    if (tail > 0) { t += tail * c; pts.push(t, endU); }
    return pts;
  }

  /* Word position at a given age. Shared by the video so picture and sound stay locked. */
  function wordTimeAt(ev, age) {
    const t = clamp(age, 0, ev.T);
    if (ev.tape) {
      const rate = ev.tapeRate, N = ev.wordLen;
      const u = t * rate;
      if (ev.tape === 'cut') return Math.min(u, N);
      const a = ev.loopA, b = ev.loopB, len = Math.max(.001, b - a);
      if (u < b) return u;
      if (ev.tape === 'loop') return a + ((u - b) % len);
      const phase = (u - b) % (2 * len);
      return phase < len ? b - phase : a + (phase - len);
    }
    return YT.dsp.evalMap(ev.map, t);
  }

  /* Maps a word position to a time inside the source clip. */
  YT.sourceTime = (ev, age) => {
    const u = wordTimeAt(ev, age);
    const w = ev.word;
    return w.reverse ? w.end - u : w.start + u;
  };

  function resolveSteps(selection, phrases, clips) {
    if (!selection) return null;
    const words = new Map();
    for (const c of clips) for (const w of c.words) words.set(w.id, w);
    if (selection.startsWith('clip:')) {
      const clip = clips.find(c => c.id === selection.slice(5));
      return clip && clip.words.length ? clip.words.map(word => ({ word })) : null;
    }
    if (selection.startsWith('word:')) {
      const word = words.get(selection.slice(5));
      return word ? [{ word }] : null;
    }
    const phrase = phrases.find(p => p.id === selection);
    if (!phrase) return null;
    const steps = [];
    for (const s of phrase.steps) {
      if (s.type === 'rest') steps.push({ rest: true });
      else if (s.type === 'hold') steps.push({ hold: true });
      else {
        const word = words.get(s.wordId);
        if (word) steps.push({ word });
      }
    }
    return steps.length ? steps : null;
  }

  function secPerBeatAt(midi, time) {
    const list = midi.tempos || [];
    let bpm = list[0]?.bpm || 120;
    for (const t of list) {
      if ((t.time ?? 0) <= time) bpm = t.bpm; else break;
    }
    return 60 / bpm;
  }

  /* Index of the beat at or before a score time. Used by "restart every N bars" and "beat picks the word". */
  function beatInfo(beats, time) {
    if (!beats || !beats.length) return { bar: 0, beat: 0 };
    const i = U.upperBound(beats, time + .0005, b => b.time) - 1;
    return i < 0 ? { bar: 0, beat: 0 } : { bar: beats[i].bar || 0, beat: beats[i].beat || 0 };
  }

  function compile(prj) {
    const o = prj.options, midi = prj.midi;
    const speed = clamp((o.songSpeed || 100) / 100, .05, 8);
    const scale = (o.midiScale || 100) / 100;
    const shift = o.midiShift || 0;
    const midiStart = Math.max(0, shift) / speed, songStart = Math.max(0, -shift) / speed;
    const toOut = t => t * scale / speed + midiStart;
    const song = prj.song;
    const songEnd = song ? songStart + Math.max(0, song.buffer.duration - (o.songTrim || 0)) / speed : 0;
    const speedSemis = o.speedPitch && song ? 12 * Math.log2(speed) : 0;

    const events = [], trackPlans = [];
    const voices = new Map();
    const anySolo = prj.tracks.some(t => t && t.solo && !t.mute);
    const overrides = prj.overrides || {};
    const allWords = new Map();
    for (const c of prj.clips) for (const w of c.words) allWords.set(w.id, w);

    if (midi) midi.tracks.forEach((track, ti) => {
      const cfg = prj.tracks[ti];
      if (!cfg) return;
      const color = U.COLORS[ti % U.COLORS.length];
      const plan = { ti, name: cfg.name || track.name, color, cfg, events: [], maxVis: 0, percussion: track.percussion, role: cfg.role };
      trackPlans.push(plan);
      if (cfg.mute || (anySolo && !cfg.solo)) return;
      const steps = resolveSteps(cfg.source, prj.phrases, prj.clips);
      if (!steps) return;

      const rnd = U.rng(((o.seed || 1) * 7919 + ti * 131) >>> 0);
      const stepRepeat = Math.max(1, cfg.stepRepeat | 0);
      const beatsPerRest = cfg.restartRest;

      /* Filter, then group into hits so chords share a word. */
      let notes = track.notes.filter(n => n.midi >= cfg.pitchMin && n.midi <= cfg.pitchMax && n.velocity * 127 >= cfg.velMin);
      if (cfg.skipEvery > 1) notes = notes.filter((_, i) => (i + 1) % cfg.skipEvery !== 0);
      const hits = [];
      for (const n of notes) {
        const last = hits[hits.length - 1];
        if (last && Math.abs(n.time - last.time) <= .012) last.notes.push(n);
        else hits.push({ time: n.time, notes: [n] });
      }
      for (const h of hits) {
        if (cfg.chordPick === 'top') h.notes = [h.notes[h.notes.length - 1]];
        else if (cfg.chordPick === 'bottom') h.notes = [h.notes[0]];
        else if (h.notes.length > cfg.chordMax) h.notes = h.notes.slice(-cfg.chordMax);
      }

      const pitches = [...new Set(notes.map(n => n.midi))].sort((a, b) => a - b);
      const pitchRange = pitches.length ? [pitches[0], pitches[pitches.length - 1]] : [60, 60];
      const midPitch = (pitchRange[0] + pitchRange[1]) / 2;

      /* Whole-part octave move: keeps the melody's shape, unlike folding single notes. */
      let octaveShift = 0;
      if (cfg.autoOctave && cfg.pitched && notes.length) {
        const roots = steps.filter(s => s.word && s.word.root != null).map(s => s.word.root).sort((a, b) => a - b);
        if (roots.length) {
          const sung = notes.map(n => n.midi + (cfg.transpose | 0) + o.globalTranspose).sort((a, b) => a - b);
          const gap = sung[sung.length >> 1] - roots[roots.length >> 1];
          // Aiming a little above the speaker's own pitch keeps words clear in a mix.
          octaveShift = -12 * Math.round((gap - 7) / 12);
        }
      }

      /* Sequencer state. */
      let cursor = (cfg.startStep | 0) - 1;
      let bag = [], direction = 1, lastBar = -1, prevEnd = -Infinity, prevMidi = null, lastWord = null;

      const nextStep = (hit, note) => {
        const n = steps.length;
        switch (cfg.order) {
          case 'pitch': return steps[pitches.indexOf(note.midi) % n];
          case 'velocity': return steps[Math.min(n - 1, Math.floor(note.velocity * n))];
          case 'beat': return steps[beatInfo(midi.beats, hit.time).beat % n];
          case 'random': return steps[Math.floor(rnd() * n)];
          case 'shuffle': {
            if (!bag.length) {
              bag = steps.map((_, i) => i);
              for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
            }
            return steps[bag.pop()];
          }
          case 'pingpong': {
            const span = Math.max(1, n * stepRepeat);
            const step = steps[Math.floor(clamp(cursor, 0, span - 1) / stepRepeat)];
            if (n > 1) {
              if (cursor + direction >= span || cursor + direction < 0) direction = -direction;
              cursor += direction;
            }
            return step;
          }
          default: {
            const step = steps[Math.floor(cursor / stepRepeat) % n];
            cursor++;
            return step;
          }
        }
      };

      /* Adds one sung word. `dur` and `time` are in score seconds, before tempo scaling. */
      const addEvent = (args) => {
        const { word, note, hitIndex, stepIndex, time, dur, velocity, skipAttack, chop } = args;
        const human = cfg.humanT ? (rnd() - .5) * cfg.humanT / 500 : 0;
        const silent = word.silent;

        const isTape = cfg.stretch.startsWith('tape') || cfg.stretch === 'oneshot';
        const N = wordDur(word);

        /* The consonant goes before the beat so the vowel lands on it, and the end of the note does not move. */
        const leadIn = word.reverse ? word.end - word.susEnd : word.susStart - word.start;
        const early = cfg.stretch === 'smart' && !skipAttack && !chop ? Math.min(.15, clamp(leadIn, 0, N) * cfg.preUtter / 100) : 0;
        const noteOn = toOut(time) + human;
        const start = Math.max(0, noteOn - early);
        const T0 = Math.max(.01, dur * scale / speed + (noteOn - start));

        /* Pitch. */
        let target = note.midi + octaveShift + (cfg.transpose | 0) + o.globalTranspose + (cfg.fine + o.globalFine) / 100 + speedSemis;
        let semis = 0;
        if (cfg.pitched && word.root != null) {
          semis = target - word.root;
          while (semis > cfg.maxShift) { semis -= 12; target -= 12; }
          while (semis < -cfg.maxShift) { semis += 12; target += 12; }
        }
        const bend = [];
        if (cfg.pitched) {
          if (cfg.useBend && note.bend) for (let i = 0; i < note.bend.length; i += 2) bend.push(Math.round(note.bend[i] * 1000) / 1000, Math.round(note.bend[i + 1] * 100) / 100);
        }
        let curve = bend.length ? bend : null;
        if (cfg.pitched && (cfg.scoop || cfg.fall || (cfg.glide && prevMidi != null && time - prevEnd < .25))) {
          // These three share one breakpoint curve; MIDI bends win if the note has any.
          if (!curve) {
            const pts = [];
            const glideFrom = cfg.glide && prevMidi != null && time - prevEnd < .25 ? prevMidi - note.midi : 0;
            const startOffset = glideFrom || -cfg.scoop;
            const inTime = Math.min(T0 * .6, (glideFrom ? cfg.glide : 90) / 1000);
            pts.push(0, startOffset, inTime, 0);
            if (cfg.fall) pts.push(Math.max(inTime + .001, T0 - Math.min(.15, T0 * .4)), 0, T0, -cfg.fall);
            curve = pts;
          }
        }

        /* Length, envelope and time map. */
        const releaseS = cfg.release / 1000;
        let T = T0;
        let map = null, tapeMode = null, loopA = 0, loopB = N, tapeRate = 1;
        const A = clamp(word.susStart - word.start, 0, N), R = clamp(word.end - word.susEnd, 0, N - A);
        if (isTape) {
          tapeRate = 2 ** (semis / 12);
          tapeMode = cfg.stretch === 'tapeLoop' ? 'loop' : cfg.stretch === 'tapePing' ? 'ping' : 'cut';
          loopA = word.reverse ? R : A;
          loopB = Math.max(loopA + .01, N - (word.reverse ? A : R));
          if (cfg.stretch === 'oneshot') T = N / tapeRate;
          else if (tapeMode === 'cut') T = Math.min(T0, N / tapeRate);
        } else {
          map = buildMap(word, T0, cfg, skipAttack);
          if (cfg.stretch === 'natural') T = Math.min(T0, N - (skipAttack ? A : 0));
          else if (map[map.length - 2] < T0) T = Math.max(.01, map[map.length - 2]);
        }
        const totalT = Math.round((T + releaseS) * 250) / 250;

        const seed = U.hash(`${ti}:${note.index}:${hitIndex}:${chop || 0}`);
        const velScale = cfg.velCurve / 100;
        let vel = 1 - (1 - velocity) * velScale;
        if (cfg.humanV) vel *= 1 - (rnd() * cfg.humanV) / 100;
        if (args.gainScale != null) vel *= args.gainScale;
        const autoLevel = o.autoLevel && word.rms > 1e-5 ? clamp(.14 / word.rms, .3, 4) : 1;

        let pan = 0;
        if (cfg.panMode === 'alternate') pan = (hitIndex % 2 ? 1 : -1) * cfg.panSpread / 100;
        else if (cfg.panMode === 'random') pan = (rnd() * 2 - 1) * cfg.panSpread / 100;
        else if (cfg.panMode === 'pitch') pan = (pitchRange[1] > pitchRange[0] ? (note.midi - pitchRange[0]) / (pitchRange[1] - pitchRange[0]) * 2 - 1 : 0) * cfg.panSpread / 100;

        const flip = (mode) => {
          switch (mode) {
            case 'hit': return hitIndex % 2 === 1;
            case 'word': return stepIndex % 2 === 1;
            case 'random': return U.noise2(seed, 11) > .5;
            case 'pitch': return note.midi > midPitch;
            case 'always': return true;
            default: return false;
          }
        };

        const params = silent ? null : {
          T: totalT, map, tape: tapeMode, loopA, loopB,
          semis: Math.round(semis * 100) / 100, bend: curve, pitched: cfg.pitched,
          vibDepth: cfg.pitched ? cfg.vibDepth : 0, vibRate: cfg.vibRate, vibDelay: cfg.vibDelay / 1000,
          flatten: cfg.flatten / 100, follow: cfg.follow / 100, engine: cfg.engine, grainMs: cfg.grainMs,
          attack: cfg.attack, decay: cfg.decay, sustain: cfg.sustain / 100, release: cfg.release,
          drive: cfg.drive / 100, bits: cfg.bits, down: cfg.down, reverse: !!word.reverse,
          rootHz: word.root != null ? U.mtof(word.root) : 0, seed: U.hash(word.id) & 0xffff
        };
        if (map) params.map = map.map(v => Math.round(v * 1000) / 1000);
        const key = silent ? null : `${word.id}.${word.ver}|${JSON.stringify(params)}`;
        if (key && !voices.has(key)) voices.set(key, { word, params });

        const ev = {
          id: events.length, ti, ni: note.index, hit: hitIndex, step: stepIndex,
          word, clip: word.clip, key, midi: note.midi, velocity,
          start, end: start + T, T, wordLen: N,
          map, tape: tapeMode, tapeRate, loopA, loopB,
          gain: vel * (word.gain ?? 1) * autoLevel, pan, seed, cfg, color,
          flipX: flip(cfg.flipMode), flipY: flip(cfg.flipY),
          lane: pitchRange[1] > pitchRange[0] ? (note.midi - pitchRange[0]) / (pitchRange[1] - pitchRange[0]) : .5,
          phraseSteps: steps
        };
        plan.events.push(ev);
        events.push(ev);
        return ev;
      };

      /* Walk the hits. */
      hits.forEach((hit, hitIndex) => {
        const nextHit = hits[hitIndex + 1];
        const beatSec = secPerBeatAt(midi, hit.time);

        // Phrase restarts: a rest long enough, or a new bar boundary, sends it back to word 1.
        let hitEnd = 0;
        for (const n of hit.notes) hitEnd = Math.max(hitEnd, n.time + n.duration);
        if (beatsPerRest > 0 && hitIndex > 0 && hit.time - prevEnd >= beatsPerRest * beatSec - .001) { cursor = (cfg.startStep | 0) - 1; direction = 1; bag = []; }
        if (cfg.restartBars > 0) {
          const bar = beatInfo(midi.beats, hit.time).bar;
          const block = Math.floor(bar / cfg.restartBars);
          if (block !== lastBar) { if (lastBar >= 0) { cursor = (cfg.startStep | 0) - 1; direction = 1; } lastBar = block; }
        }

        const sharedStep = cfg.order === 'note' || cfg.order === 'pitch' || cfg.order === 'velocity' ? null : (cfg.order === 'fit' ? { fit: true } : nextStep(hit, hit.notes[0]));

        hit.notes.forEach((note, chordIndex) => {
          const noteKey = `${ti}:${note.index}`;
          let step = sharedStep;
          if (!step) step = nextStep(hit, note);

          // Hand-picked word on this exact note, from the timeline.
          const override = overrides[noteKey];
          if (override === 'rest') return;
          if (override && allWords.has(override)) step = { word: allWords.get(override) };

          /* Note length. */
          let dur = note.duration * cfg.gate / 100;
          if (cfg.legato && nextHit) dur = Math.max(dur, nextHit.time - note.time);
          if (cfg.mono && nextHit) dur = Math.min(dur, nextHit.time - note.time);
          dur = clamp(dur, cfg.minLen / 1000, cfg.maxLen);
          const strum = cfg.strum / 1000 * chordIndex;
          const time = note.time + strum;

          if (step.rest) return;
          if (step.hold && !lastWord) return;

          const word = step.hold ? lastWord : (step.fit ? null : step.word);
          const stepIndex = word ? Math.max(0, steps.findIndex(s => s.word === word)) : 0;

          /* The whole phrase inside one note: split the note by each word's natural length. */
          if (step.fit) {
            const words = steps.filter(s => s.word);
            const natural = words.reduce((sum, s) => sum + wordDur(s.word), 0) || 1;
            let t = time;
            words.forEach((s, i) => {
              const share = dur * wordDur(s.word) / natural;
              addEvent({ word: s.word, note, hitIndex, stepIndex: i, time: t, dur: share, velocity: note.velocity, chop: i + 1 });
              t += share;
            });
            lastWord = words[words.length - 1]?.word || lastWord;
            return;
          }

          /* Stutter: the note becomes a burst of re-attacks. */
          const chopBeats = SYNC_BEATS[cfg.retrig];
          if (chopBeats) {
            const chopLen = chopBeats * beatSec;
            const count = Math.max(1, Math.floor(dur / chopLen + .001));
            for (let c = 0; c < count; c++) {
              addEvent({
                word, note, hitIndex: hitIndex + c, stepIndex, time: time + c * chopLen, dur: Math.min(chopLen, dur - c * chopLen), velocity: note.velocity,
                gainScale: 1 - (cfg.retrigDecay / 100) * (c / Math.max(1, count - 1)), chop: c + 1
              });
            }
          } else {
            addEvent({ word, note, hitIndex, stepIndex, time, dur, velocity: note.velocity, skipAttack: !!step.hold });
          }
          lastWord = word;
        });

        prevEnd = Math.max(prevEnd, hitEnd);
        prevMidi = hit.notes[hit.notes.length - 1].midi;
      });

      /* How long each picture stays up. */
      const list = plan.events;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        let j = i + 1;
        while (j < list.length && list[j].start <= e.start + .0005) j++;
        const next = j < list.length ? list[j].start : Infinity;
        let visEnd;
        if (cfg.visHold === 'note') visEnd = e.end;
        else if (cfg.visHold === 'fixed') visEnd = e.end + cfg.holdTime;
        else visEnd = next === Infinity ? e.end + .6 : Math.min(next, e.end + 4);
        e.visEnd = Math.max(visEnd, e.start + cfg.visMin / 1000);
        plan.maxVis = Math.max(plan.maxVis, e.visEnd - e.start);
      }
    });

    events.sort((a, b) => a.start - b.start || a.ti - b.ti || a.midi - b.midi);
    events.forEach((e, i) => { e.order = i; });
    for (const t of trackPlans) t.events.sort((a, b) => a.start - b.start);

    /* Polyphony cap: dense passages drop their newest quiet voices, the picture still shows. */
    const maxVoices = o.maxVoices || 96;
    const sounding = [];
    for (const e of events) {
      for (let i = sounding.length - 1; i >= 0; i--) if (sounding[i] <= e.start) sounding.splice(i, 1);
      if (sounding.length >= maxVoices) e.muted = true;
      else sounding.push(e.end);
    }

    const midiEnd = midi ? toOut(midi.duration) : 0;
    const lastSound = events.reduce((m, e) => Math.max(m, e.end), 0);
    let duration = o.endMode === 'song' && song ? songEnd : o.endMode === 'midi' && midi ? Math.max(midiEnd, lastSound) : Math.max(midiEnd, songEnd, lastSound);
    duration = Math.max(duration, .1);

    const scaleBeat = b => ({ ...b, time: toOut(b.time) });
    const beats = midi ? (midi.beats || []).map(scaleBeat) : [];

    /* Lead = the busiest non-drum track, bass = the lowest one. Layouts and "on hit" effects use these. */
    const melodic = trackPlans.filter(t => t.events.length && !t.percussion);
    const lead = melodic.slice().sort((a, b) => (roleWeight(b) - roleWeight(a)) || b.events.length - a.events.length)[0];
    const bass = melodic.slice().sort((a, b) => avgPitch(a) - avgPitch(b))[0];
    const order = trackPlans.filter(t => t.events.length).sort((a, b) => {
      if (a === lead) return -1;
      if (b === lead) return 1;
      return (a.percussion ? 1 : 0) - (b.percussion ? 1 : 0) || b.events.length - a.events.length;
    });

    return {
      events, tracks: trackPlans, ordered: order, voices, beats, duration, speed, midiStart, songStart, songEnd,
      leadTi: lead?.ti ?? -1, bassTi: bass?.ti ?? -1,
      env: buildEnvelopes(events, beats, duration, midi, lead, bass, o, prj)
    };
  }
  const roleWeight = t => (t.role === 'lead' ? 2 : t.role === 'chords' || t.role === 'bass' ? 0 : 1);
  const avgPitch = t => t.events.reduce((s, e) => s + e.midi, 0) / Math.max(1, t.events.length);

  /* Stateless reactive curves at 120 Hz. Export renders frames out of order safely because of this. */
  function buildEnvelopes(events, beats, duration, midi, lead, bass, o, prj) {
    const rate = 120, n = Math.ceil((duration + .5) * rate);
    const channels = { notes: new Float32Array(n), kick: new Float32Array(n), snare: new Float32Array(n), hat: new Float32Array(n), lead: new Float32Array(n), bass: new Float32Array(n), beat: new Float32Array(n), bar: new Float32Array(n), duck: new Float32Array(n) };
    const impulse = (arr, t, v) => { const i = Math.floor(t * rate); if (i >= 0 && i < n) arr[i] = Math.max(arr[i], v); };
    const hasDrums = events.some(e => midiIsDrum(e));
    for (const e of events) {
      const v = clamp(e.velocity, .2, 1);
      impulse(channels.notes, e.start, v);
      if (midiIsDrum(e)) {
        if (e.midi === 35 || e.midi === 36) impulse(channels.kick, e.start, v);
        else if (e.midi === 38 || e.midi === 40 || e.midi === 37 || e.midi === 39) impulse(channels.snare, e.start, v);
        else impulse(channels.hat, e.start, v);
      }
      if (lead && e.ti === lead.ti) impulse(channels.lead, e.start, v);
      if (bass && e.ti === bass.ti) impulse(channels.bass, e.start, v);
      if (e.cfg.duck) impulse(channels.duck, e.start, v);
    }
    for (const b of beats) {
      impulse(channels.beat, b.time, b.strong ? 1 : .6);
      if (b.strong) impulse(channels.bar, b.time, 1);
      // Without a drum track, the kick and snare fall on the beat so camera moves still work.
      if (!hasDrums) {
        if (b.strong || b.beat === 2) impulse(channels.kick, b.time, .9);
        if (b.beat === 1 || b.beat === 3) impulse(channels.snare, b.time, .8);
      }
    }
    const decay = (arr, seconds) => {
      const k = Math.exp(-1 / (seconds * rate));
      let v = 0;
      for (let i = 0; i < n; i++) { v = Math.max(arr[i], v * k); arr[i] = v; }
    };
    decay(channels.notes, .09); decay(channels.kick, .11); decay(channels.snare, .1); decay(channels.hat, .05);
    decay(channels.lead, .1); decay(channels.bass, .13); decay(channels.beat, .13); decay(channels.bar, .28);
    decay(channels.duck, Math.max(.02, (o.duckRelease || 180) / 1000));

    const song = prj.song?.analysis;
    if (song) {
      channels.song = new Float32Array(n);
      const speed = clamp((o.songSpeed || 100) / 100, .05, 8);
      const songStart = Math.max(0, -(o.midiShift || 0)) / speed;
      let peak = 1e-6;
      for (let i = 0; i < song.rms.length; i++) peak = Math.max(peak, song.rms[i]);
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const at = Math.floor(((t - songStart) * speed + (o.songTrim || 0)) * song.rate);
        channels.song[i] = at >= 0 && at < song.rms.length ? song.rms[at] / peak : 0;
      }
    }
    return { rate, ...channels };
  }
  const midiIsDrum = e => e.cfg.role === 'drums';

  /* A one-off voice for auditioning a word in the editor, using the same code path as the song. */
  function auditionVoice(word, opts) {
    const cfg = { ...YT.options.trackDefaults(), ...opts.cfg };
    const T = opts.dur;
    const map = cfg.stretch === 'natural' ? [0, 0, wordDur(word), wordDur(word)] : buildMap(word, T, cfg, false);
    const semis = opts.midi == null || word.root == null ? 0 : opts.midi - word.root;
    const realT = cfg.stretch === 'natural' ? wordDur(word) : Math.min(T, map[map.length - 2]);
    const params = {
      T: realT, map, tape: null, semis, pitched: opts.midi != null, flatten: cfg.flatten / 100, follow: cfg.follow / 100,
      engine: cfg.engine, grainMs: cfg.grainMs, attack: 1, release: 8, reverse: !!word.reverse, rootHz: word.root != null ? U.mtof(word.root) : 0, seed: 1
    };
    return {
      params,
      ev: { word, map, T: realT, wordLen: wordDur(word), tape: null }
    };
  }

  YT.compile = compile;
  YT.SYNC_BEATS = SYNC_BEATS;
  YT.buildMap = buildMap;
  YT.auditionVoice = auditionVoice;
  YT.wordDur = wordDur;
  YT.resolveSteps = resolveSteps;
})(window.YT);
