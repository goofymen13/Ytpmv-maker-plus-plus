/* Standard MIDI file parser. Extended from the original project: pitch bends, bend range,
   lyrics, bar numbers, instrument names, and tolerance for files with damaged track lengths. */
(function (YT) {
  'use strict';
  const GM = ('Acoustic Grand Piano,Bright Piano,Electric Grand,Honky-tonk Piano,Electric Piano 1,Electric Piano 2,Harpsichord,Clavinet,Celesta,Glockenspiel,Music Box,Vibraphone,Marimba,Xylophone,Tubular Bells,Dulcimer,Drawbar Organ,Percussive Organ,Rock Organ,Church Organ,Reed Organ,Accordion,Harmonica,Tango Accordion,Nylon Guitar,Steel Guitar,Jazz Guitar,Clean Guitar,Muted Guitar,Overdrive Guitar,Distortion Guitar,Guitar Harmonics,Acoustic Bass,Finger Bass,Pick Bass,Fretless Bass,Slap Bass 1,Slap Bass 2,Synth Bass 1,Synth Bass 2,Violin,Viola,Cello,Contrabass,Tremolo Strings,Pizzicato Strings,Orchestral Harp,Timpani,String Ensemble 1,String Ensemble 2,Synth Strings 1,Synth Strings 2,Choir Aahs,Voice Oohs,Synth Voice,Orchestra Hit,Trumpet,Trombone,Tuba,Muted Trumpet,French Horn,Brass Section,Synth Brass 1,Synth Brass 2,Soprano Sax,Alto Sax,Tenor Sax,Baritone Sax,Oboe,English Horn,Bassoon,Clarinet,Piccolo,Flute,Recorder,Pan Flute,Blown Bottle,Shakuhachi,Whistle,Ocarina,Square Lead,Saw Lead,Calliope Lead,Chiff Lead,Charang Lead,Voice Lead,Fifths Lead,Bass Lead,New Age Pad,Warm Pad,Polysynth Pad,Choir Pad,Bowed Pad,Metallic Pad,Halo Pad,Sweep Pad,Rain FX,Soundtrack FX,Crystal FX,Atmosphere FX,Brightness FX,Goblins FX,Echoes FX,Sci-fi FX,Sitar,Banjo,Shamisen,Koto,Kalimba,Bagpipe,Fiddle,Shanai,Tinkle Bell,Agogo,Steel Drums,Woodblock,Taiko Drum,Melodic Tom,Synth Drum,Reverse Cymbal,Guitar Fret Noise,Breath Noise,Seashore,Bird Tweet,Telephone Ring,Helicopter,Applause,Gunshot').split(',');

  function parseMidi(buffer) {
    const bytes = new Uint8Array(buffer);
    let pos = 0, limit = bytes.length;
    const need = n => { if (pos + n > limit) throw new Error('The MIDI file is truncated or has an invalid event length.'); };
    const byte = () => { need(1); return bytes[pos++]; };
    const u16 = () => byte() * 256 + byte();
    const u32 = () => byte() * 16777216 + byte() * 65536 + byte() * 256 + byte();
    const tag = () => String.fromCharCode(byte(), byte(), byte(), byte());
    const variable = () => {
      let n = 0;
      for (let i = 0; i < 4; i++) {
        const b = byte();
        n = n * 128 + (b & 127);
        if (!(b & 128)) return n;
      }
      throw new Error('Invalid MIDI variable-length number.');
    };

    if (tag() !== 'MThd') throw new Error('Choose a standard .mid or .midi file.');
    const headerSize = u32();
    if (headerSize < 6) throw new Error('Invalid MIDI header.');
    const format = u16(), count = u16(), division = u16();
    if (format > 1) throw new Error('This file uses independent MIDI sequences (format 2). Export it as a format 0 or 1 MIDI first.');
    if (!division || !count) throw new Error('The MIDI has no valid timing or tracks.');
    need(headerSize - 6);
    pos += headerSize - 6;

    const tempos = [{ ticks: 0, bpm: 120 }], meters = [{ ticks: 0, numerator: 4, denominator: 4 }], rawTracks = [], lyrics = [];
    let maxTick = 0, eventCount = 0, trackIndex = 0;

    while (trackIndex < count && pos + 8 <= bytes.length) {
      const chunk = tag();
      const declared = u32();
      if (chunk !== 'MTrk') {
        // The spec says unknown chunks must be skipped.
        pos = Math.min(bytes.length, pos + declared);
        continue;
      }
      const end = Math.min(bytes.length, pos + declared);
      limit = end;
      let ticks = 0, running = 0, trackName = '';
      const channels = new Map();
      const channel = ch => {
        if (!channels.has(ch)) channels.set(ch, { channel: ch, program: 0, notes: [], down: new Map(), held: [], sustain: false, bends: [], bendRange: 2, rpn: [127, 127] });
        return channels.get(ch);
      };
      const finish = (c, note) => { note.endTicks = Math.max(note.ticks + 1, ticks); c.notes.push(note); };

      while (pos < end) {
        if (++eventCount > 2000000) throw new Error('This MIDI exceeds the two million event limit.');
        ticks += variable();
        maxTick = Math.max(maxTick, ticks);
        let status = byte();
        if (status < 128) {
          if (!running) throw new Error('Invalid MIDI running status.');
          pos--;
          status = running;
        } else if (status < 240) running = status;
        else running = 0;

        if (status === 255) {
          const type = byte(), length = variable();
          need(length);
          if (type === 3) trackName = new TextDecoder().decode(bytes.subarray(pos, pos + length)).replace(/[\x00-\x1f]/g, '').slice(0, 120);
          if (type === 5) lyrics.push({ ticks, text: new TextDecoder().decode(bytes.subarray(pos, pos + length)) });
          if (type === 81 && length === 3) {
            const micros = bytes[pos] * 65536 + bytes[pos + 1] * 256 + bytes[pos + 2];
            if (micros) tempos.push({ ticks, bpm: 60000000 / micros });
          }
          if (type === 88 && length >= 2) meters.push({ ticks, numerator: bytes[pos], denominator: 2 ** bytes[pos + 1] });
          pos += length;
          if (type === 47) break;
          continue;
        }
        if (status === 240 || status === 247) { const length = variable(); need(length); pos += length; continue; }
        if (status >= 240) throw new Error('Unsupported system event in MIDI track.');

        const kind = status >> 4, c = channel(status & 15), a = byte(), b = kind === 12 || kind === 13 ? 0 : byte();
        if (a > 127 || b > 127) throw new Error('Invalid MIDI channel data.');
        if (kind === 9 && b > 0) {
          if (!c.down.has(a)) c.down.set(a, []);
          c.down.get(a).push({ midi: a, ticks, velocity: b / 127 });
        } else if (kind === 8 || (kind === 9 && b === 0)) {
          const note = c.down.get(a)?.shift();
          if (note) {
            if (c.sustain) { note.pedal = true; c.held.push(note); } else finish(c, note);
          }
        } else if (kind === 12) c.program = a;
        else if (kind === 14) c.bends.push([ticks, ((b << 7 | a) - 8192) / 8192 * c.bendRange]);
        else if (kind === 11) {
          if (a === 64) {
            c.sustain = b >= 64;
            if (!c.sustain) { c.held.forEach(n => finish(c, n)); c.held = []; }
          } else if (a === 101) c.rpn[0] = b;
          else if (a === 100) c.rpn[1] = b;
          else if (a === 6 && c.rpn[0] === 0 && c.rpn[1] === 0) c.bendRange = b;
          else if (a === 120 || a === 123) {
            c.down.forEach(q => q.forEach(n => finish(c, n)));
            c.down.clear();
            c.held.forEach(n => finish(c, n));
            c.held = [];
          }
        }
      }

      channels.forEach(c => {
        c.down.forEach(q => q.forEach(n => finish(c, n)));
        c.held.forEach(n => finish(c, n));
        if (c.notes.length) {
          const percussion = c.channel === 9;
          rawTracks.push({
            name: trackName || (percussion ? 'Drums' : GM[c.program]) || `Track ${trackIndex + 1}`,
            channel: c.channel, program: c.program, instrument: percussion ? 'Drum Kit' : GM[c.program],
            percussion, notes: c.notes, bendTicks: c.bends
          });
        }
      });
      pos = end;
      limit = bytes.length;
      trackIndex++;
    }

    if (!trackIndex) throw new Error('Expected a MIDI track chunk.');

    const uniqueEvents = list => [...new Map(list.sort((a, b) => a.ticks - b.ticks).map(e => [e.ticks, e])).values()];
    const tempoMap = uniqueEvents(tempos), meterMap = uniqueEvents(meters);
    let ticksPerSecond = 0;
    if (division & 32768) {
      const fpsByte = (division >> 8) - 256, fps = fpsByte === -29 ? 30000 / 1001 : -fpsByte;
      if (![24, 25, 30, 30000 / 1001].includes(fps) || !(division & 255)) throw new Error('Invalid SMPTE MIDI timing.');
      ticksPerSecond = fps * (division & 255);
    }
    let lastTick = 0, seconds = 0, lastBpm = 120;
    tempoMap.forEach(t => {
      seconds += ticksPerSecond ? (t.ticks - lastTick) / ticksPerSecond : (t.ticks - lastTick) * 60 / (lastBpm * division);
      t.time = seconds;
      lastTick = t.ticks;
      lastBpm = t.bpm;
    });
    const toSeconds = tick => {
      if (ticksPerSecond) return tick / ticksPerSecond;
      let lo = 0, hi = tempoMap.length;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (tempoMap[mid].ticks <= tick) lo = mid; else hi = mid;
      }
      const t = tempoMap[lo];
      return t.time + (tick - t.ticks) * 60 / (t.bpm * division);
    };

    const tracks = rawTracks.map(t => {
      const bends = t.bendTicks.map(([tick, semis]) => [toSeconds(tick), semis]);
      const notes = t.notes.map(n => {
        const time = toSeconds(n.ticks), duration = Math.max(.001, toSeconds(n.endTicks) - time);
        const note = { midi: n.midi, velocity: n.velocity, ticks: n.ticks, time, duration };
        if (bends.length) note.bend = noteBend(bends, time, duration);
        return note;
      }).sort((a, b) => a.time - b.time || a.midi - b.midi);
      notes.forEach((n, i) => { n.index = i; });
      const { bendTicks, ...rest } = t;
      return { ...rest, notes };
    });

    if (!tracks.length) throw new Error('This MIDI contains no playable notes.');
    const duration = Math.max(toSeconds(maxTick), ...tracks.map(t => t.notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0)));
    if (duration > 3600) throw new Error('Please use a MIDI shorter than one hour.');

    const beats = [];
    if (!ticksPerSecond) {
      let bar = 0;
      for (let i = 0; i < meterMap.length; i++) {
        const m = meterMap[i], until = meterMap[i + 1]?.ticks ?? (maxTick + 1), step = division * 4 / m.denominator;
        if (step <= 0 || !m.numerator) continue;
        for (let tick = m.ticks, beat = 0; tick < until && beats.length < 100000; tick += step, beat++) {
          if (beat && beat % m.numerator === 0) bar++;
          beats.push({ time: toSeconds(tick), strong: beat % m.numerator === 0, bar, beat: beat % m.numerator });
        }
        bar++;
      }
    } else {
      for (let t = 0, i = 0; t < duration; t += .5, i++) beats.push({ time: t, strong: i % 4 === 0, bar: Math.floor(i / 4), beat: i % 4 });
    }

    return {
      tracks, duration, tempos: tempoMap, beats, format,
      lyrics: lyrics.map(l => ({ time: toSeconds(l.ticks), text: l.text }))
    };
  }

  /* Reduce a channel's bend stream to the points relevant to one note, in note-relative time. */
  function noteBend(bends, time, duration) {
    let i = 0;
    while (i < bends.length && bends[i][0] <= time) i++;
    const before = i ? bends[i - 1][1] : 0;
    const pts = [0, before];
    for (; i < bends.length && bends[i][0] < time + duration; i++) pts.push(bends[i][0] - time, bends[i][1]);
    if (pts.length === 2 && Math.abs(before) < .001) return null;
    if (pts.length > 80) {
      // Very dense bend streams add nothing audible but bloat the voice cache key.
      const stride = Math.ceil(pts.length / 80) * 2, thin = [];
      for (let k = 0; k < pts.length; k += stride) thin.push(pts[k], pts[k + 1]);
      return thin;
    }
    return pts;
  }

  YT.parseMidi = parseMidi;
  YT.GM_NAMES = GM;
})(window.YT);
