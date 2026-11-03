/* Sample DSP. This factory is stringified into Blob workers (so it also runs from file://),
   which means it must stay self-contained: no references to window, document or YT.

   The important idea: pitch and time are independent here. A voice is rendered from
     - a time map: output seconds -> position inside the word
     - a pitch curve: output seconds -> semitones away from the word's own pitch
   The video uses the same time map, so a stretched vowel also slows the mouth down. */
window.YT = window.YT || {};
YT.dspFactory = function dspFactory() {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const hannCache = new Map();
  function hann(n) {
    let w = hannCache.get(n);
    if (!w) {
      w = new Float32Array(n);
      for (let i = 0; i < n; i++) w[i] = .5 - .5 * Math.cos(TAU * i / n);
      if (hannCache.size > 128) hannCache.clear();
      hannCache.set(n, w);
    }
    return w;
  }

  /* Time map is a flat [t0,u0,t1,u1,...] list with ascending t. */
  function evalMap(pts, t) {
    const n = pts.length;
    if (t <= pts[0]) return pts[1];
    for (let i = 2; i < n; i += 2) {
      if (t <= pts[i]) {
        const a = pts[i - 2], b = pts[i];
        const k = b > a ? (t - a) / (b - a) : 1;
        return pts[i - 1] + (pts[i + 1] - pts[i - 1]) * k;
      }
    }
    return pts[n - 1];
  }

  function readCubic(x, pos) {
    const i = Math.floor(pos), f = pos - i, n = x.length;
    if (i < -1 || i >= n) return 0;
    const a = i > 0 ? x[i - 1] : 0, b = i >= 0 ? x[i] : 0, c = i + 1 < n ? x[i + 1] : 0, d = i + 2 < n ? x[i + 2] : 0;
    const c1 = .5 * (c - a), c2 = a - 2.5 * b + 2 * c - .5 * d, c3 = .5 * (d - a) + 1.5 * (b - c);
    return ((c3 * f + c2) * f + c1) * f + b;
  }

  /* Semitones away from the word's root at output time t. */
  function semisAt(p, t) {
    let s = p.semis || 0;
    if (p.bend && p.bend.length) s += evalMap(p.bend, t);
    if (p.vibDepth) {
      const d = p.vibDelay || 0;
      if (t > d) s += (p.vibDepth / 100) * Math.min(1, (t - d) / .15) * Math.sin(TAU * p.vibRate * (t - d));
    }
    return s;
  }

  function decimate(x, D) {
    if (D <= 1) return x;
    const out = new Float32Array(Math.floor(x.length / D));
    for (let i = 0; i < out.length; i++) {
      let s = 0;
      for (let j = 0; j < D; j++) s += x[i * D + j];
      out[i] = s / D;
    }
    return out;
  }

  /* ---------- Pitch tracking (YIN) ---------- */
  function pitchTrack(x, sr, fmin = 55, fmax = 1000) {
    const D = Math.max(1, Math.floor(sr / 12000));
    const d = decimate(x, D), dsr = sr / D;
    const hop = Math.max(1, Math.round(dsr * .005)), W = Math.round(dsr * .032);
    const tauMin = Math.max(2, Math.floor(dsr / fmax)), tauMax = Math.ceil(dsr / fmin);
    const frames = Math.max(1, Math.ceil(d.length / hop));
    const f0 = new Float32Array(frames), conf = new Float32Array(frames);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    const diff = new Float32Array(tauMax + 2);
    const len = d.length;
    for (let fr = 0; fr < frames; fr++) {
      const s = Math.round(fr * hop - W / 2);
      let e = 0;
      for (let j = 0; j < W; j++) {
        const k = s + j;
        if (k >= 0 && k < len) e += d[k] * d[k];
      }
      if (Math.sqrt(e / W) < peak * .03) continue;
      diff[0] = 1;
      let run = 0;
      for (let tau = 1; tau <= tauMax; tau++) {
        let sum = 0;
        for (let j = 0; j < W; j++) {
          const k = s + j, l = k + tau;
          const v = (k >= 0 && k < len ? d[k] : 0) - (l >= 0 && l < len ? d[l] : 0);
          sum += v * v;
        }
        run += sum;
        diff[tau] = run > 0 ? sum * tau / run : 1;
      }
      let best = -1;
      for (let t = tauMin; t <= tauMax; t++) {
        if (diff[t] < .15) {
          while (t + 1 <= tauMax && diff[t + 1] < diff[t]) t++;
          best = t;
          break;
        }
      }
      if (best < 0) {
        let low = 2;
        for (let t = tauMin; t <= tauMax; t++) if (diff[t] < low) { low = diff[t]; best = t; }
      }
      if (best < 1) continue;
      let refined = best;
      if (best > 1 && best < tauMax) {
        const a = diff[best - 1], b = diff[best], c = diff[best + 1], den = a - 2 * b + c;
        if (Math.abs(den) > 1e-9) refined = best + clamp(.5 * (a - c) / den, -1, 1);
      }
      f0[fr] = dsr / refined;
      conf[fr] = clamp(1 - diff[best], 0, 1);
    }
    return { f0, conf, hop: hop * D };
  }

  /* Pitch-mark analysis used by PSOLA, plus a summary used to place the sustained vowel. */
  function analyze(x, sr) {
    const { f0, conf, hop } = pitchTrack(x, sr);
    const VOICED = .72;
    const frames = f0.length;
    const voicedFreqs = [];
    for (let i = 0; i < frames; i++) if (conf[i] >= VOICED && f0[i] > 0) voicedFreqs.push(f0[i]);
    voicedFreqs.sort((a, b) => a - b);
    const median = voicedFreqs.length ? voicedFreqs[voicedFreqs.length >> 1] : 0;

    // Octave-jump repair and light smoothing, so one bad frame cannot derail the marks.
    const clean = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      let f = conf[i] >= VOICED ? f0[i] : 0;
      if (f && median) {
        if (f / median > 1.7) f /= 2;
        else if (f / median < .6) f *= 2;
      }
      clean[i] = f;
    }
    const smooth = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      if (!clean[i]) continue;
      const near = [];
      for (let j = Math.max(0, i - 2); j <= Math.min(frames - 1, i + 2); j++) if (clean[j]) near.push(clean[j]);
      near.sort((a, b) => a - b);
      smooth[i] = near[near.length >> 1];
    }

    // Smoothed waveform for peak picking.
    const lpLen = Math.max(1, Math.round(sr / 2500));
    const lp = new Float32Array(x.length);
    let acc = 0;
    for (let i = 0; i < x.length; i++) {
      acc += x[i];
      if (i >= lpLen) acc -= x[i - lpLen];
      lp[i] = acc / lpLen;
    }
    let polarityPos = 0, polarityNeg = 0;
    for (let i = 0; i < x.length; i++) {
      if (lp[i] > polarityPos) polarityPos = lp[i];
      if (-lp[i] > polarityNeg) polarityNeg = -lp[i];
    }
    const sign = polarityPos >= polarityNeg ? 1 : -1;

    const marks = [], markP = [], markV = [];
    const unvoicedStep = Math.round(sr * .006);
    let p = 0, last = -1;
    while (p < x.length) {
      const fr = Math.min(frames - 1, Math.floor(p / hop));
      const f = smooth[fr];
      if (f > 0) {
        const period = sr / f;
        let from, to;
        if (last >= 0) { from = Math.round(last + period * .75); to = Math.round(last + period * 1.25); }
        else { from = p; to = Math.round(p + period); }
        to = Math.min(to, x.length - 1);
        let bestI = from, bestV = -Infinity;
        for (let i = from; i <= to; i++) {
          const v = lp[i] * sign;
          if (v > bestV) { bestV = v; bestI = i; }
        }
        if (bestI <= last) bestI = Math.round(last + period);
        if (bestI >= x.length) break;
        marks.push(bestI); markP.push(period); markV.push(1);
        last = bestI;
        p = bestI + 1;
      } else {
        marks.push(p); markP.push(unvoicedStep); markV.push(0);
        last = -1;
        p += unvoicedStep;
      }
    }

    let voicedFrames = 0, loudFrames = 0;
    for (let i = 0; i < frames; i++) {
      if (f0[i] > 0) loudFrames++;
      if (smooth[i] > 0) voicedFrames++;
    }
    return {
      f0: smooth, hop, median,
      voiced: loudFrames ? voicedFrames / loudFrames : 0,
      marks: Int32Array.from(marks), markP: Float32Array.from(markP), markV: Uint8Array.from(markV)
    };
  }

  function nearestMark(marks, pos) {
    let lo = 0, hi = marks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (marks[mid] < pos) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(marks[lo - 1] - pos) <= Math.abs(marks[lo] - pos)) return lo - 1;
    return lo;
  }

  /* ---------- PSOLA: pitch-synchronous grains. Best for voices. ---------- */
  function psola(x, sr, an, p, N) {
    const out = new Float32Array(N), wsum = new Float32Array(N);
    const rootHz = an.median || p.rootHz || 220;
    const flatten = p.flatten == null ? 1 : p.flatten;
    const follow = p.follow || 0;
    let seed = (p.seed | 0) * 2654435761 >>> 0 || 1;
    const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
    const f0Hop = an.hop, f0Track = an.f0, marks = an.marks, markP = an.markP, markV = an.markV;
    const lastMark = marks.length - 1;
    if (lastMark < 0) return out;
    let tau = 0;
    while (tau < N) {
      const t = tau / sr;
      const u = evalMap(p.map, t);
      const srcPos = u * sr;
      const slope = (evalMap(p.map, t + .004) - u) / .004;
      let k = nearestMark(marks, srcPos);
      // Noise repeated verbatim sounds like a buzz; scatter it only where it is being stretched.
      if (!markV[k] && slope < .7) k = clamp(k + Math.floor(rand() * 7) - 3, 0, lastMark);
      const m = marks[k], P = markP[k], voiced = markV[k];
      const ratio = 2 ** (semisAt(p, t) / 12);
      let outP = P;
      if (voiced && p.pitched !== false) {
        const here = f0Track[Math.min(f0Track.length - 1, Math.floor(m / f0Hop))] || rootHz;
        const micro = (here / rootHz) ** (1 - flatten);
        outP = sr / (rootHz * ratio * micro);
      }
      const gamma = p.pitched === false ? 1 : ratio ** follow;
      const L = Math.max(8, Math.round(P / gamma));
      const pos = Math.round(tau);
      for (let i = -L + 1; i < L; i++) {
        const o = pos + i;
        if (o < 0 || o >= N) continue;
        const w = .5 + .5 * Math.cos(Math.PI * i / L);
        out[o] += readCubic(x, m + i * gamma) * w;
        wsum[o] += w;
      }
      tau += Math.max(12, outP);
    }
    for (let i = 0; i < N; i++) if (wsum[i] > 1) out[i] /= wsum[i];
    return matchLevel(out, x, p, sr);
  }

  /* Grains overlap differently at different pitches; pull the level back to the source's. */
  function matchLevel(out, x, p, sr) {
    const N = out.length;
    if (!N) return out;
    let srcE = 0, outE = 0, count = 0;
    const step = Math.max(1, Math.floor(N / 2000));
    for (let n = 0; n < N; n += step) {
      const u = evalMap(p.map, n / sr) * sr, i = Math.floor(u);
      // Local RMS of the source around the mapped position.
      const a = Math.max(0, i - 64), b = Math.min(x.length, i + 64);
      let e = 0;
      for (let j = a; j < b; j += 4) e += x[j] * x[j];
      srcE += e / Math.max(1, (b - a) / 4);
      count++;
    }
    for (let n = 0; n < N; n++) outE += out[n] * out[n];
    srcE /= Math.max(1, count);
    outE /= N;
    if (outE < 1e-9 || srcE < 1e-9) return out;
    const g = clamp(Math.sqrt(srcE / outE), .4, 4);
    for (let n = 0; n < N; n++) out[n] *= g;
    return out;
  }

  /* ---------- WSOLA + resample: works on anything; formants move with pitch (classic sampler timbre). ---------- */
  function wsola(x, sr, p, N) {
    const win = Math.max(128, Math.round((p.grainMs || 30) / 1000 * sr)) & ~1;
    const hop = win >> 1, tol = Math.round(win * .4), W = hann(win), len = x.length;
    const ctrl = 64, cn = Math.ceil(N / ctrl) + 2;
    const cum = new Float64Array(cn);
    for (let i = 1; i < cn; i++) cum[i] = cum[i - 1] + ctrl * 2 ** (semisAt(p, (i - 1) * ctrl / sr) / 12);
    const M = Math.ceil(cum[cn - 1]) + win;
    const y = new Float32Array(M);
    let natural = -1, ci = 0;
    for (let syn = -hop; syn < M; syn += hop) {
      const c = syn + hop;
      while (ci + 2 < cn && cum[ci + 1] < c) ci++;
      const frac = clamp((c - cum[ci]) / (cum[ci + 1] - cum[ci] || 1), 0, 1);
      const t = (ci + frac) * ctrl / sr;
      let pos = Math.round(evalMap(p.map, t) * sr - hop);
      if (natural >= 0 && len > win) {
        const lo = clamp(pos - tol, 0, len - win), hi = clamp(pos + tol, 0, len - win);
        let bestScore = -Infinity, bestPos = clamp(pos, 0, len - win);
        for (let cand = lo; cand <= hi; cand += 2) {
          let cross = 0, energy = 1e-9;
          for (let j = 0; j < win; j += 4) {
            const a = x[cand + j], ni = natural + j, b = ni < len ? x[ni] : 0;
            cross += a * b;
            energy += a * a;
          }
          const score = cross / Math.sqrt(energy);
          if (score > bestScore) { bestScore = score; bestPos = cand; }
        }
        pos = bestPos;
      }
      for (let j = 0; j < win; j++) {
        const yi = syn + j, si = pos + j;
        if (yi >= 0 && yi < M && si >= 0 && si < len) y[yi] += x[si] * W[j];
      }
      natural = pos + hop;
    }
    const out = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      const k = n / ctrl, i = Math.floor(k);
      out[n] = readCubic(y, cum[i] + (cum[i + 1] - cum[i]) * (k - i));
    }
    return out;
  }

  /* ---------- Granular cloud: thick, smeared sustain. ---------- */
  function granular(x, sr, p, N) {
    const out = new Float32Array(N), wsum = new Float32Array(N);
    const grain = Math.max(256, Math.round((p.grainMs || 60) / 1000 * sr * 2));
    const step = Math.max(32, grain >> 3), W = hann(grain);
    let seed = (p.seed | 0) * 2654435761 >>> 0 || 7;
    const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
    for (let start = -grain >> 1; start < N; start += step) {
      const t = Math.max(0, (start + grain / 2) / sr);
      const u = evalMap(p.map, t) * sr;
      const slope = (evalMap(p.map, t + .004) - evalMap(p.map, t)) / .004;
      const scatter = slope < .9 ? grain * .6 * (rand() - .5) : 0;
      const rate = 2 ** (semisAt(p, t) / 12);
      const read = u + scatter - rate * grain / 2;
      for (let j = 0; j < grain; j++) {
        const o = start + j;
        if (o < 0 || o >= N) continue;
        const w = W[j];
        out[o] += readCubic(x, read + j * rate) * w;
        wsum[o] += w;
      }
    }
    for (let i = 0; i < N; i++) if (wsum[i] > .01) out[i] /= wsum[i];
    return out;
  }

  /* ---------- Classic sampler: speed and pitch are one control. ---------- */
  function tape(x, sr, p, N) {
    const out = new Float32Array(N), len = x.length;
    const mode = p.tape;
    const a = clamp(Math.round((p.loopA || 0) * sr), 0, Math.max(0, len - 2));
    const b = clamp(Math.round((p.loopB || len / sr) * sr), a + 2, len);
    const loopLen = b - a, xf = Math.min(Math.round(.006 * sr), loopLen >> 1);
    let pos = 0, dir = 1, rate = 1, ended = N;
    for (let n = 0; n < N; n++) {
      if ((n & 63) === 0) rate = 2 ** (semisAt(p, n / sr) / 12);
      if (mode === 'loop') {
        let s = readCubic(x, pos);
        const toEnd = b - pos;
        if (toEnd < xf && pos >= a) {
          const k = toEnd / xf;
          s = s * k + readCubic(x, pos - loopLen) * (1 - k);
        }
        out[n] = s;
        pos += rate;
        if (pos >= b) pos -= loopLen;
      } else if (mode === 'ping') {
        out[n] = readCubic(x, pos);
        pos += rate * dir;
        if (pos >= b - 1) { pos = b - 1; dir = -1; }
        else if (pos <= a && dir < 0) { pos = a; dir = 1; }
      } else {
        if (pos >= len) { ended = n; break; }
        out[n] = readCubic(x, pos);
        pos += rate;
      }
    }
    if (ended < N) {
      const fade = Math.min(ended, Math.round(.003 * sr));
      for (let i = 0; i < fade; i++) out[ended - 1 - i] *= i / fade;
    }
    return out;
  }

  /* ---------- Envelope, drive and crush are baked into the rendered voice. ---------- */
  function finish(out, sr, p) {
    const n = out.length;
    const a = Math.max(Math.round(.0008 * sr), Math.round((p.attack || 0) / 1000 * sr));
    const d = Math.round((p.decay || 0) / 1000 * sr);
    const s = p.sustain == null ? 1 : p.sustain;
    const r = Math.min(n >> 1, Math.max(Math.round(.003 * sr), Math.round((p.release || 0) / 1000 * sr)));
    for (let i = 0; i < n; i++) {
      let g = 1;
      if (i < a) g = i / a;
      else if (d && i < a + d) g = 1 - (1 - s) * (i - a) / d;
      else if (d || s !== 1) g = s;
      const tail = n - i;
      if (tail < r) g *= tail / r;
      out[i] *= g;
    }
    if (p.drive > 0) {
      const k = 1 + p.drive * 12, norm = 1 / Math.tanh(k);
      for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * k) * norm * (1 - p.drive * .4);
    }
    if ((p.bits && p.bits < 16) || (p.down && p.down > 1)) {
      const q = p.bits && p.bits < 16 ? 2 ** (p.bits - 1) : 0, hold = Math.max(1, p.down | 0);
      let v = 0;
      for (let i = 0; i < n; i++) {
        if (i % hold === 0) v = q ? Math.round(out[i] * q) / q : out[i];
        out[i] = v;
      }
    }
    return out;
  }

  function isIdentity(p) {
    if (p.semis || p.bend || p.vibDepth) return false;
    const m = p.map;
    return m.length === 4 && m[0] === 0 && m[1] === 0 && Math.abs(m[3] - m[2]) < 1e-6;
  }

  /* Entry point. `source` is {pcm, sr}; analysis is memoised on it. */
  function renderVoice(source, p) {
    const sr = source.sr;
    let x = source.pcm;
    let key = 'an';
    if (p.reverse) {
      if (!source.rev) source.rev = Float32Array.from(x).reverse();
      x = source.rev;
      key = 'anRev';
    }
    const N = Math.max(16, Math.ceil(p.T * sr));
    let out;
    if (p.tape) out = tape(x, sr, p, N);
    else if (isIdentity(p)) {
      out = new Float32Array(N);
      out.set(x.subarray(0, Math.min(N, x.length)));
    } else {
      let engine = p.engine || 'auto';
      if (engine === 'auto' || engine === 'psola') {
        if (!source[key]) source[key] = analyze(x, sr);
        const an = source[key];
        if (engine === 'auto') engine = an.voiced > .35 && an.median > 0 && p.pitched !== false ? 'psola' : 'wsola';
        else if (!an.marks.length) engine = 'wsola';
      }
      if (engine === 'psola') out = psola(x, sr, source[key], p, N);
      else if (engine === 'granular') out = granular(x, sr, p, N);
      else out = wsola(x, sr, p, N);
    }
    return finish(out, sr, p);
  }

  /* ---------- Word detection on a whole clip ---------- */
  function envelope(x, sr, hopSec = .005) {
    const hop = Math.max(1, Math.round(sr * hopSec)), n = Math.ceil(x.length / hop);
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = i * hop, b = Math.min(x.length, a + hop);
      let e = 0;
      for (let j = a; j < b; j++) e += x[j] * x[j];
      env[i] = Math.sqrt(e / Math.max(1, b - a));
    }
    // 25 ms smoothing so pitch periods do not look like gaps.
    const smoothed = new Float32Array(n), r = Math.max(1, Math.round(.0125 / hopSec));
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) { s += env[j]; c++; }
      smoothed[i] = s / c;
    }
    return { env: smoothed, hop: hop / sr };
  }

  /* Returns [{start,end}] in seconds. With `count` it finds that many words by cutting at the deepest dips. */
  function detectWords(x, sr, opts = {}) {
    const { env, hop } = envelope(x, sr);
    const n = env.length;
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, env[i]);
    if (peak < 1e-4) return [];
    const th = peak * 10 ** ((opts.thresholdDb == null ? -32 : opts.thresholdDb) / 20);
    const minGap = Math.round((opts.minGapMs == null ? 35 : opts.minGapMs) / 1000 / hop);
    const minWord = Math.round((opts.minWordMs == null ? 50 : opts.minWordMs) / 1000 / hop);

    let first = 0, last = n - 1;
    while (first < n && env[first] < th) first++;
    while (last > first && env[last] < th) last--;
    if (first >= last) return [];

    const toSec = ([a, b]) => ({
      start: Math.max(0, a * hop - .008),
      end: Math.min(x.length / sr, (b + 1) * hop + .012)
    });

    if (opts.count > 0) {
      // Rank every local dip by how far it sits below the louder of its neighbouring peaks.
      const dips = [];
      for (let i = first + minWord; i < last - minWord; i++) {
        if (env[i] <= env[i - 1] && env[i] < env[i + 1]) {
          let leftPeak = 0, rightPeak = 0;
          for (let j = Math.max(first, i - 80); j < i; j++) leftPeak = Math.max(leftPeak, env[j]);
          for (let j = i + 1; j <= Math.min(last, i + 80); j++) rightPeak = Math.max(rightPeak, env[j]);
          // A real gap between words is long; a dip inside a word ("mis-ter") is brief. Width decides.
          const shoulder = Math.min(leftPeak, rightPeak), low = shoulder * .15;
          let a = i, b = i, widthSec = 0;
          if (env[i] < low) {
            while (a > first && env[a - 1] < low) a--;
            while (b < last && env[b + 1] < low) b++;
            widthSec = (b - a + 1) * hop;
          }
          // Compared as a ratio so a soft word next to the gap does not make the gap look unimportant.
          const depth = shoulder > 0 ? (shoulder - env[i]) / shoulder : 0;
          dips.push({ i: Math.round((a + b) / 2), score: depth * (widthSec + .005) });
        }
      }
      dips.sort((a, b) => b.score - a.score);
      const cuts = [];
      for (const dip of dips) {
        if (cuts.length >= opts.count - 1) break;
        if (cuts.every(c => Math.abs(c - dip.i) >= minWord)) cuts.push(dip.i);
      }
      cuts.sort((a, b) => a - b);
      const out = [];
      let from = first;
      for (const c of cuts) { out.push([from, c]); from = c + 1; }
      out.push([from, last]);
      return out.map(([a, b]) => {
        // Trim the silence inside each part so a word does not begin with its leading gap.
        let s = a, e = b;
        while (s < e && env[s] < th) s++;
        while (e > s && env[e] < th) e--;
        return toSec([s, e]);
      });
    }

    const segments = [];
    let inWord = false, begin = 0, quiet = 0;
    for (let i = first; i <= last; i++) {
      if (env[i] >= th) {
        if (!inWord) { inWord = true; begin = i; }
        quiet = 0;
      } else if (inWord && ++quiet > minGap) {
        segments.push([begin, i - quiet]);
        inWord = false;
        quiet = 0;
      }
    }
    if (inWord) segments.push([begin, last]);
    return segments.filter(([a, b]) => b - a >= minWord).map(toSec);
  }

  /* Finds a word's root pitch and its sustained vowel. Times are relative to the slice. */
  function wordInfo(x, sr) {
    const dur = x.length / sr;
    let energy = 0, peak = 0;
    for (let i = 0; i < x.length; i++) { energy += x[i] * x[i]; peak = Math.max(peak, Math.abs(x[i])); }
    const rms = Math.sqrt(energy / Math.max(1, x.length));
    const an = analyze(x, sr);
    const hopSec = an.hop / sr, frames = an.f0.length;
    const { env, hop: envHop } = envelope(x, sr);
    let envPeak = 0;
    for (let i = 0; i < env.length; i++) envPeak = Math.max(envPeak, env[i]);

    // The longest run of voiced, reasonably loud frames is the vowel.
    let bestA = -1, bestB = -1, runA = -1;
    for (let i = 0; i <= frames; i++) {
      const e = i < frames ? env[Math.min(env.length - 1, Math.round(i * hopSec / envHop))] : 0;
      const good = i < frames && an.f0[i] > 0 && e > envPeak * .25;
      if (good && runA < 0) runA = i;
      if (!good && runA >= 0) {
        if (i - runA > bestB - bestA) { bestA = runA; bestB = i; }
        runA = -1;
      }
    }

    let susStart, susEnd, rootHz = 0;
    if (bestA >= 0 && (bestB - bestA) * hopSec >= Math.min(.03, dur * .2)) {
      const trim = Math.min(.25, .012 / ((bestB - bestA) * hopSec));
      susStart = (bestA + (bestB - bestA) * trim) * hopSec;
      susEnd = (bestB - (bestB - bestA) * trim) * hopSec;
      const freqs = [];
      for (let i = bestA; i < bestB; i++) if (an.f0[i] > 0) freqs.push(an.f0[i]);
      freqs.sort((a, b) => a - b);
      rootHz = freqs[freqs.length >> 1] || an.median;
    } else {
      // Nothing tonal: treat the middle as the stretchable part.
      susStart = dur * .3;
      susEnd = dur * .7;
      rootHz = an.median;
    }
    return {
      susStart: clamp(susStart, 0, dur), susEnd: clamp(susEnd, 0, dur),
      rootMidi: rootHz > 0 ? 69 + 12 * Math.log2(rootHz / 440) : null,
      voiced: an.voiced, rms, peak
    };
  }

  /* ---------- Backing-track analysis ---------- */
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -TAU / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j = 0; j < len >> 1; j++) {
          const k = i + j, l = k + (len >> 1);
          const tr = re[l] * cr - im[l] * ci, ti = re[l] * ci + im[l] * cr;
          re[l] = re[k] - tr; im[l] = im[k] - ti;
          re[k] += tr; im[k] += ti;
          const nr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = nr;
        }
      }
    }
  }

  /* 100 Hz band energies (for the spectrum overlay), RMS, and an onset curve (for auto-align). */
  function analyzeSong(x, sr) {
    const rate = 100, hop = Math.round(sr / rate), size = 1024, bandsN = 32;
    const frames = Math.max(1, Math.floor(x.length / hop));
    const bands = new Uint8Array(frames * bandsN), rms = new Float32Array(frames), flux = new Float32Array(frames);
    const edges = [];
    for (let b = 0; b <= bandsN; b++) edges.push(Math.min(size / 2, Math.max(1, Math.round((40 * (16000 / 40) ** (b / bandsN)) / (sr / size)))));
    const win = hann(size), re = new Float32Array(size), im = new Float32Array(size);
    const prev = new Float32Array(bandsN), cur = new Float32Array(bandsN);
    for (let fr = 0; fr < frames; fr++) {
      const start = fr * hop - (size >> 1);
      let e = 0;
      for (let i = 0; i < size; i++) {
        const k = start + i, v = k >= 0 && k < x.length ? x[k] : 0;
        re[i] = v * win[i];
        im[i] = 0;
        e += v * v;
      }
      rms[fr] = Math.sqrt(e / size);
      fft(re, im);
      let f = 0;
      for (let b = 0; b < bandsN; b++) {
        let sum = 0, c = 0;
        for (let k = edges[b]; k < Math.max(edges[b] + 1, edges[b + 1]); k++) { sum += re[k] * re[k] + im[k] * im[k]; c++; }
        const level = Math.log10(1 + 40 * Math.sqrt(sum / Math.max(1, c)));
        cur[b] = level;
        f += Math.max(0, level - prev[b]);
        bands[fr * bandsN + b] = clamp(Math.round(level * 90), 0, 255);
        prev[b] = level;
      }
      flux[fr] = f;
    }
    // Remove the slow trend so only onsets remain.
    const radius = 25, onset = new Float32Array(frames);
    let acc = 0;
    for (let i = 0; i < frames; i++) {
      acc += flux[i];
      if (i > 2 * radius) acc -= flux[i - 2 * radius - 1];
      const center = i - radius;
      if (center >= 0) onset[center] = Math.max(0, flux[center] - acc / Math.min(i + 1, 2 * radius + 1));
    }
    return { rate, bandsN, frames, bands, rms, onset };
  }

  /* Finds the shift (and optional tempo scale) that lines the MIDI's onsets up with the song's. */
  function alignMidi(onset, rate, hits, opts = {}) {
    const frames = onset.length;
    const smooth = new Float32Array(frames);
    for (let i = 1; i < frames - 1; i++) smooth[i] = onset[i - 1] * .5 + onset[i] + onset[i + 1] * .5;
    const maxHits = opts.maxHits || 1500;
    const list = hits.slice().sort((a, b) => b[1] - a[1]).slice(0, maxHits);
    const maxLag = Math.round((opts.maxShift == null ? 60 : opts.maxShift) * rate);
    const scales = opts.scales && opts.scales.length ? opts.scales : [1];
    let best = { shift: 0, scale: 1, score: -Infinity, confidence: 0 };
    for (const scale of scales) {
      const idx = new Int32Array(list.length), w = new Float32Array(list.length);
      for (let i = 0; i < list.length; i++) { idx[i] = Math.round(list[i][0] * scale * rate); w[i] = list[i][1]; }
      let total = 0, total2 = 0, count = 0;
      for (let lag = -maxLag; lag <= maxLag; lag++) {
        let s = 0;
        for (let i = 0; i < idx.length; i++) {
          const at = idx[i] + lag;
          if (at >= 0 && at < frames) s += smooth[at] * w[i];
        }
        total += s; total2 += s * s; count++;
        if (s > best.score) best = { shift: lag / rate, scale, score: s, confidence: 0 };
      }
      best.mean = total / count;
      best.std = Math.sqrt(Math.max(1e-9, total2 / count - best.mean ** 2));
      if (best.scale === scale) best.confidence = (best.score - best.mean) / best.std;
    }
    return { shift: best.shift, scale: best.scale, confidence: best.confidence || 0 };
  }

  return { evalMap, semisAt, readCubic, pitchTrack, analyze, renderVoice, detectWords, wordInfo, envelope, analyzeSong, alignMidi, fft };
};
YT.dsp = YT.dspFactory();
