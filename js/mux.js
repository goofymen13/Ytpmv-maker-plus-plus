/* MP4 and WebM file writers for the encoded chunks WebCodecs produces. Both write in one pass from memory. */
(function (YT) {
  'use strict';
  const text = s => Uint8Array.from([...s].map(c => c.charCodeAt(0)));
  const u8 = (...v) => Uint8Array.from(v);
  const u16 = v => u8((v >> 8) & 255, v & 255);
  const u24 = v => u8((v >> 16) & 255, (v >> 8) & 255, v & 255);
  const u32 = v => u8((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const u64 = v => {
    const hi = Math.floor(v / 4294967296), lo = v >>> 0;
    return u8((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  };
  const concat = parts => {
    let size = 0;
    for (const p of parts) size += p.length;
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const zeros = n => new Uint8Array(n);

  /* ---------- MP4 ---------- */
  const box = (type, ...parts) => {
    const body = concat(parts);
    return concat([u32(body.length + 8), text(type), body]);
  };
  const fullBox = (type, version, flags, ...parts) => box(type, u8(version), u24(flags), ...parts);
  const MATRIX = concat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)]);

  function descriptor(tag, ...parts) {
    const body = concat(parts);
    return concat([u8(tag, body.length), body]);
  }

  function esds(asc, trackId, bitrate) {
    const specific = descriptor(5, asc);
    const config = descriptor(4, u8(0x40, 0x15), u24(0), u32(bitrate), u32(bitrate), specific);
    const es = descriptor(3, u16(trackId), u8(0), config, descriptor(6, u8(2)));
    return fullBox('esds', 0, 0, es);
  }

  function runLengths(values) {
    const runs = [];
    for (const v of values) {
      const last = runs[runs.length - 1];
      if (last && last[1] === v) last[0]++;
      else runs.push([1, v]);
    }
    return runs;
  }

  function trackBox(track, offsets, useCo64, movieDurationMs) {
    const { samples, timescale } = track;
    const durations = samples.map(s => s.scaledDur);
    const stts = runLengths(durations);
    const totalScaled = durations.reduce((a, b) => a + b, 0);
    const isVideo = track.kind === 'video';

    const stsdEntry = isVideo
      ? box('avc1', zeros(6), u16(1), zeros(16), u16(track.width), u16(track.height), u32(0x480000), u32(0x480000), zeros(4), u16(1), zeros(32), u16(0x18), u16(0xffff), box('avcC', track.description))
      : box('mp4a', zeros(6), u16(1), zeros(8), u16(track.channels), u16(16), u16(0), u16(0), u32(track.sampleRate * 65536), esds(track.description, track.id, track.bitrate));

    const stblParts = [
      fullBox('stsd', 0, 0, u32(1), stsdEntry),
      fullBox('stts', 0, 0, u32(stts.length), ...stts.map(([n, d]) => concat([u32(n), u32(d)]))),
      fullBox('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
      fullBox('stsz', 0, 0, u32(0), u32(samples.length), ...samples.map(s => u32(s.data.length))),
      useCo64
        ? fullBox('co64', 0, 0, u32(offsets.length), ...offsets.map(u64))
        : fullBox('stco', 0, 0, u32(offsets.length), ...offsets.map(u32))
    ];
    if (isVideo) {
      const keys = samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
      stblParts.push(fullBox('stss', 0, 0, u32(keys.length), ...keys.map(u32)));
      if (samples.some(s => s.ctsOffset)) {
        const ctts = runLengths(samples.map(s => s.ctsOffset));
        stblParts.push(fullBox('ctts', 1, 0, u32(ctts.length), ...ctts.map(([n, d]) => concat([u32(n), u32(d >>> 0)]))));
      }
    }

    const tkhd = fullBox('tkhd', 0, 3, u32(0), u32(0), u32(track.id), zeros(4), u32(movieDurationMs), zeros(8), u16(0), u16(0), u16(isVideo ? 0 : 0x100), zeros(2), MATRIX, u32(isVideo ? track.width * 65536 : 0), u32(isVideo ? track.height * 65536 : 0));
    const mdhd = fullBox('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(totalScaled), u16(0x55C4), u16(0));
    const hdlr = fullBox('hdlr', 0, 0, u32(0), text(isVideo ? 'vide' : 'soun'), zeros(12), text(isVideo ? 'Video\0' : 'Sound\0'));
    const mediaHeader = isVideo ? fullBox('vmhd', 0, 1, zeros(8)) : fullBox('smhd', 0, 0, zeros(4));
    const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));
    return box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', mediaHeader, dinf, box('stbl', ...stblParts))));
  }

  /* video/audio: {samples:[{data,ts,dur,key}], description, ...}. Timestamps are microseconds. */
  function buildMp4({ video, audio }) {
    const vt = { ...video, kind: 'video', id: 1, timescale: 90000 };
    const at = audio ? { ...audio, kind: 'audio', id: 2, timescale: audio.sampleRate } : null;
    const scale = (track) => {
      const us = 1e6;
      let dts = 0;
      track.samples = track.samples.map((s, i) => {
        const next = track.samples[i + 1];
        const durUs = next && track.kind === 'audio' ? next.ts - s.ts : s.dur;
        const scaledDur = Math.max(1, Math.round(durUs / us * track.timescale));
        const pts = Math.round(s.ts / us * track.timescale);
        const out = { ...s, scaledDur, ctsOffset: track.kind === 'video' ? pts - dts : 0 };
        dts += scaledDur;
        return out;
      });
    };
    scale(vt);
    if (at) scale(at);

    /* Interleave samples by time so players do not have to seek around the file. */
    const order = [];
    let vi = 0, ai = 0;
    while (vi < vt.samples.length || (at && ai < at.samples.length)) {
      const useVideo = !at || ai >= at.samples.length || (vi < vt.samples.length && vt.samples[vi].ts <= at.samples[ai].ts);
      order.push(useVideo ? { track: vt, sample: vt.samples[vi++] } : { track: at, sample: at.samples[ai++] });
    }
    const mdatSize = order.reduce((n, o) => n + o.sample.data.length, 0);
    const useCo64 = mdatSize > 3.9e9;
    const ftyp = box('ftyp', text('isom'), u32(0x200), text('isom'), text('iso2'), text('avc1'), text('mp41'));
    const seconds = Math.max(...[vt, at].filter(Boolean).map(t => t.samples.reduce((n, s) => n + s.scaledDur, 0) / t.timescale));
    const durMs = Math.round(seconds * 1000);

    const makeMoov = base => {
      const voff = [], aoff = [];
      let at2 = base;
      for (const o of order) {
        (o.track === vt ? voff : aoff).push(at2);
        at2 += o.sample.data.length;
      }
      const mvhd = fullBox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(durMs), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(at ? 3 : 2));
      const parts = [mvhd, trackBox(vt, voff, useCo64, durMs)];
      if (at) parts.push(trackBox(at, aoff, useCo64, durMs));
      return box('moov', ...parts);
    };
    // The moov goes first (fast start). Its size does not depend on the offset values.
    const moovSize = makeMoov(0).length;
    const headerSize = useCo64 ? 16 : 8;
    const moov = makeMoov(ftyp.length + moovSize + headerSize);
    const mdatHeader = useCo64 ? concat([u32(1), text('mdat'), u64(mdatSize + 16)]) : concat([u32(mdatSize + 8), text('mdat')]);
    return new Blob([ftyp, moov, mdatHeader, ...order.map(o => o.sample.data)], { type: 'video/mp4' });
  }

  /* ---------- WebM ---------- */
  const vintSize = n => {
    // Always 8 bytes when the value is large; shortest legal form otherwise.
    for (let len = 1; len <= 7; len++) {
      if (n < 2 ** (7 * len) - 1) {
        const out = new Uint8Array(len);
        let v = n;
        for (let i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
        out[0] |= 0x80 >> (len - 1);
        return out;
      }
    }
    const out = u64(n);
    out[0] = 1;
    return out;
  };
  const idBytes = id => {
    const out = [];
    for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256);
    return Uint8Array.from(out);
  };
  const ebml = (id, ...parts) => {
    const body = concat(parts);
    return concat([idBytes(id), vintSize(body.length), body]);
  };
  const ebmlUint = (id, v) => {
    const out = [];
    let n = v;
    do { out.unshift(n % 256); n = Math.floor(n / 256); } while (n > 0);
    return ebml(id, Uint8Array.from(out));
  };
  const ebmlFloat = (id, v) => {
    const b = new ArrayBuffer(8);
    new DataView(b).setFloat64(0, v);
    return ebml(id, new Uint8Array(b));
  };
  const ebmlText = (id, s) => ebml(id, text(s));

  function opusHead(channels, rate) {
    const b = new Uint8Array(19);
    b.set(text('OpusHead'), 0);
    b[8] = 1;
    b[9] = channels;
    new DataView(b.buffer).setUint32(12, rate, true);
    return b;
  }

  function buildWebm({ video, audio }) {
    const ID = { Segment: 0x18538067, SeekHead: 0x114D9B74, Seek: 0x4DBB, SeekID: 0x53AB, SeekPos: 0x53AC, Info: 0x1549A966, Tracks: 0x1654AE6B, Cluster: 0x1F43B675, Cues: 0x1C53BB6B };
    const header = ebml(0x1A45DFA3, ebmlUint(0x4286, 1), ebmlUint(0x42F7, 1), ebmlUint(0x42F2, 4), ebmlUint(0x42F3, 8), ebmlText(0x4282, 'webm'), ebmlUint(0x4287, 4), ebmlUint(0x4285, 2));

    const durationMs = Math.max(...[video, audio].filter(Boolean).map(t => {
      const last = t.samples[t.samples.length - 1];
      return (last.ts + (last.dur || 0)) / 1000;
    }));
    const info = ebml(ID.Info, ebmlUint(0x2AD7B1, 1000000), ebmlFloat(0x4489, durationMs), ebmlText(0x4D80, 'YTPMV Maker'), ebmlText(0x5741, 'YTPMV Maker'));
    const videoEntry = ebml(0xAE, ebmlUint(0xD7, 1), ebmlUint(0x73C5, 1), ebmlUint(0x83, 1), ebmlText(0x86, video.codecId), ebml(0xE0, ebmlUint(0xB0, video.width), ebmlUint(0xBA, video.height)));
    const trackEntries = [videoEntry];
    if (audio) {
      const priv = audio.description && audio.description.length >= 19 ? audio.description : opusHead(audio.channels, audio.sampleRate);
      trackEntries.push(ebml(0xAE, ebmlUint(0xD7, 2), ebmlUint(0x73C5, 2), ebmlUint(0x83, 2), ebmlText(0x86, 'A_OPUS'), ebml(0x63A2, priv), ebml(0xE1, ebmlFloat(0xB5, audio.sampleRate), ebmlUint(0x9F, audio.channels))));
    }
    const tracks = ebml(ID.Tracks, ...trackEntries);

    /* Merge samples in time order into clusters that begin on video keyframes. */
    const merged = [];
    for (const s of video.samples) merged.push({ ...s, track: 1 });
    if (audio) for (const s of audio.samples) merged.push({ ...s, track: 2 });
    merged.sort((a, b) => a.ts - b.ts || a.track - b.track);

    const clusterParts = [];
    const cues = [];
    let clusterSize = 0;
    let i = 0;
    while (i < merged.length) {
      const start = Math.round(merged[i].ts / 1000);
      const blocks = [ebmlUint(0xE7, start)];
      let startsWithKey = false;
      let j = i;
      for (; j < merged.length; j++) {
        const s = merged[j], rel = Math.round(s.ts / 1000) - start;
        if (j > i && (rel > 30000 || (s.track === 1 && s.key && rel > 1000))) break;
        if (s.track === 1 && s.key && !startsWithKey) { startsWithKey = true; cues.push({ time: Math.round(s.ts / 1000), at: clusterSize }); }
        const head = new Uint8Array(4);
        head[0] = 0x80 | s.track;
        new DataView(head.buffer).setInt16(1, rel);
        head[3] = s.key || s.track === 2 ? 0x80 : 0;
        blocks.push(idBytes(0xA3), vintSize(4 + s.data.length), head, s.data);
      }
      let body = 0;
      for (const b of blocks) body += b.length;
      const clusterHead = concat([idBytes(ID.Cluster), vintSize(body)]);
      clusterParts.push(clusterHead, ...blocks);
      clusterSize += clusterHead.length + body;
      i = j;
    }

    const seekEntry = (id, pos) => {
      const posBytes = u64(pos);
      return ebml(ID.Seek, ebml(ID.SeekID, idBytes(id)), ebml(ID.SeekPos, posBytes));
    };
    const buildSeek = (infoAt, tracksAt, cuesAt) => ebml(ID.SeekHead, seekEntry(ID.Info, infoAt), seekEntry(ID.Tracks, tracksAt), seekEntry(ID.Cues, cuesAt));
    const seekSize = buildSeek(0, 0, 0).length;
    const infoAt = seekSize, tracksAt = infoAt + info.length, clustersAt = tracksAt + tracks.length, cuesAt = clustersAt + clusterSize;
    const seek = buildSeek(infoAt, tracksAt, cuesAt);
    const cueData = ebml(ID.Cues, ...cues.map(c => ebml(0xBB, ebmlUint(0xB3, c.time), ebml(0xB7, ebmlUint(0xF7, 1), ebmlUint(0xF1, clustersAt + c.at)))));
    const segmentSize = cuesAt + cueData.length;
    const segmentHead = concat([idBytes(ID.Segment), (() => { const b = u64(segmentSize); b[0] = 1; return b; })()]);
    return new Blob([header, segmentHead, seek, info, tracks, ...clusterParts, cueData], { type: 'video/webm' });
  }

  YT.mux = { buildMp4, buildWebm };
})(window.YT);
