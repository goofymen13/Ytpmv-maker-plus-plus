/* Mixer and playback. The same graph is built for the live AudioContext and for the offline export,
   so what you hear in the preview is what lands in the video. */
(function (YT) {
  'use strict';
  const U = YT.util, clamp = U.clamp;

  function makeImpulse(ctx, seconds, damp) {
    const rate = ctx.sampleRate, len = Math.max(1, Math.floor(seconds * rate));
    const ir = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c), rnd = U.rng(77 + c);
      let lp = 0;
      const k = clamp(damp / 100, 0, .98) * .9;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp = lp * k + (rnd() * 2 - 1) * (1 - k);
        d[i] = lp * (1 - t) ** 2.4 * Math.exp(-t * 4);
      }
    }
    return ir;
  }

  function driveCurve(amount) {
    const n = 2048, curve = new Float32Array(n), k = 1 + amount * 18, norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1) * 2 - 1;
      curve[i] = Math.tanh(x * k) / norm;
    }
    return curve;
  }

  /* Builds the whole mixer. Everything downstream of a voice is here. */
  function buildGraph(ctx, destination) {
    const G = { ctx, strips: new Map(), reverbKey: '' };
    G.samples = ctx.createGain();
    G.song = ctx.createGain();
    G.master = ctx.createGain();
    G.low = ctx.createBiquadFilter(); G.low.type = 'lowshelf'; G.low.frequency.value = 180;
    G.mid = ctx.createBiquadFilter(); G.mid.type = 'peaking'; G.mid.frequency.value = 1300; G.mid.Q.value = .8;
    G.high = ctx.createBiquadFilter(); G.high.type = 'highshelf'; G.high.frequency.value = 6000;
    G.shaper = ctx.createWaveShaper();
    G.limiter = ctx.createDynamicsCompressor();
    G.limiter.attack.value = .002;
    G.limiter.release.value = .12;
    G.limiter.knee.value = 0;
    G.samples.connect(G.master);
    G.song.connect(G.master);
    G.master.connect(G.low).connect(G.mid).connect(G.high).connect(G.shaper).connect(G.limiter).connect(destination);

    G.reverbIn = ctx.createGain();
    G.convolver = ctx.createConvolver();
    G.reverbOut = ctx.createGain();
    G.reverbIn.connect(G.convolver).connect(G.reverbOut).connect(G.master);

    G.delayIn = ctx.createGain();
    G.delay = ctx.createDelay(4);
    G.delayFb = ctx.createGain();
    G.delayTone = ctx.createBiquadFilter(); G.delayTone.type = 'lowpass';
    G.delayOut = ctx.createGain();
    G.delayIn.connect(G.delay).connect(G.delayTone).connect(G.delayOut).connect(G.master);
    G.delayTone.connect(G.delayFb).connect(G.delay);

    /* Backing track: dry path and a side (L-R) path for the vocal remover. */
    G.songIn = ctx.createGain();
    G.songDry = ctx.createGain();
    G.songSide = ctx.createGain();
    G.songBass = ctx.createGain();
    G.songMix = ctx.createGain();
    G.songHP = ctx.createBiquadFilter(); G.songHP.type = 'highpass';
    G.songLP = ctx.createBiquadFilter(); G.songLP.type = 'lowpass';
    const split = ctx.createChannelSplitter(2), left = ctx.createGain(), right = ctx.createGain();
    right.gain.value = -1;
    const bassLP = ctx.createBiquadFilter(); bassLP.type = 'lowpass'; bassLP.frequency.value = 140;
    G.songIn.connect(G.songDry).connect(G.songMix);
    G.songIn.connect(split);
    split.connect(left, 0);
    split.connect(right, 1);
    left.connect(G.songSide);
    right.connect(G.songSide);
    G.songSide.connect(G.songMix);
    G.songIn.connect(bassLP).connect(G.songBass).connect(G.songMix);
    G.songMix.connect(G.songHP).connect(G.songLP).connect(G.song);
    return G;
  }

  function stripFor(G, ti) {
    if (G.strips.has(ti)) return G.strips.get(ti);
    const ctx = G.ctx;
    const s = {
      input: ctx.createGain(), hp: ctx.createBiquadFilter(), lp: ctx.createBiquadFilter(),
      pan: ctx.createStereoPanner(), out: ctx.createGain(), rev: ctx.createGain(), del: ctx.createGain()
    };
    s.hp.type = 'highpass';
    s.lp.type = 'lowpass';
    s.input.connect(s.hp).connect(s.lp).connect(s.pan).connect(s.out).connect(G.samples);
    s.out.connect(s.rev).connect(G.reverbIn);
    s.out.connect(s.del).connect(G.delayIn);
    G.strips.set(ti, s);
    return s;
  }

  function firstBeatSec(prj) {
    const bpm = prj.midi?.tempos?.[0]?.bpm || 120;
    return 60 / bpm / clamp((prj.options.songSpeed || 100) / 100, .05, 8) * ((prj.options.midiScale || 100) / 100);
  }

  /* Pushes every mixer setting into the graph. Used on build and for live slider moves. */
  function applyMix(G, prj) {
    const o = prj.options;
    const set = (param, v) => { param.value = v; };
    set(G.samples.gain, o.sampleVol / 100 * .55);
    set(G.song.gain, o.songVol / 100);
    set(G.master.gain, o.masterVol / 100);
    set(G.low.gain, o.eqLow);
    set(G.mid.gain, o.eqMid);
    set(G.high.gain, o.eqHigh);
    G.shaper.curve = o.masterDrive > 0 ? driveCurve(o.masterDrive / 100) : null;
    set(G.limiter.threshold, o.limiter ? -2.5 : 0);
    set(G.limiter.ratio, o.limiter ? 20 : 1);

    const reverbKey = `${o.reverbSize}|${o.reverbDamp}`;
    if (G.reverbKey !== reverbKey) {
      G.convolver.buffer = makeImpulse(G.ctx, o.reverbSize, o.reverbDamp);
      G.reverbKey = reverbKey;
    }
    set(G.reverbOut.gain, o.reverbReturn / 100 * .8);

    const beats = YT.SYNC_BEATS[o.delayTime] || .5;
    set(G.delay.delayTime, clamp(beats * firstBeatSec(prj), .01, 3.9));
    set(G.delayFb.gain, o.delayFeedback / 100);
    set(G.delayTone.frequency, o.delayTone);
    set(G.delayOut.gain, o.delayReturn / 100);

    const cut = o.vocalCut / 100;
    set(G.songDry.gain, 1 - cut);
    set(G.songSide.gain, cut * .75);
    set(G.songBass.gain, cut);
    set(G.songHP.frequency, o.songHP);
    set(G.songLP.frequency, o.songLP);

    prj.tracks.forEach((cfg, ti) => {
      if (!cfg) return;
      const s = stripFor(G, ti);
      set(s.out.gain, cfg.vol / 100);
      set(s.pan.pan, cfg.pan / 100);
      set(s.hp.frequency, cfg.hp);
      set(s.lp.frequency, cfg.lp);
      set(s.rev.gain, cfg.reverb / 100);
      set(s.del.gain, cfg.delay / 100);
    });
  }

  /* Starts the backing track so that output time `pos` lines up. Returns the live nodes. */
  function startSong(G, prj, plan, whenAt, pos) {
    const song = prj.song;
    if (!song) return null;
    const o = prj.options, ctx = G.ctx, speed = plan.speed;
    const songPos = (o.songTrim || 0) + Math.max(0, pos - plan.songStart) * speed;
    if (songPos >= song.buffer.duration) return null;
    const source = ctx.createBufferSource();
    source.buffer = song.buffer;
    source.playbackRate.value = speed;
    const fade = ctx.createGain(), duck = ctx.createGain();
    source.connect(fade).connect(duck).connect(G.songIn);

    const startAt = whenAt + Math.max(0, plan.songStart - pos);
    const endOut = plan.songEnd;
    const toCtx = t => whenAt + (t - pos);

    // Fades are defined in song time, then re-entered at the seek position.
    const inEnd = plan.songStart + o.songFadeIn, outStart = endOut - o.songFadeOut;
    const levelAt = t => {
      let v = 1;
      if (o.songFadeIn > 0 && t < inEnd) v = Math.min(v, clamp((t - plan.songStart) / o.songFadeIn, 0, 1));
      if (o.songFadeOut > 0 && t > outStart) v = Math.min(v, clamp((endOut - t) / o.songFadeOut, 0, 1));
      return v;
    };
    fade.gain.setValueAtTime(levelAt(pos), whenAt);
    if (o.songFadeIn > 0 && pos < inEnd) fade.gain.linearRampToValueAtTime(1, toCtx(inEnd));
    if (o.songFadeOut > 0 && outStart > pos) {
      fade.gain.setValueAtTime(levelAt(outStart), toCtx(outStart));
      fade.gain.linearRampToValueAtTime(0, toCtx(endOut));
    }

    if (o.duckAmount > 0 && plan.env.duck) {
      const rate = plan.env.rate, from = Math.floor(pos * rate);
      const src = plan.env.duck, amount = o.duckAmount / 100;
      const len = src.length - from;
      if (len > 2) {
        const curve = new Float32Array(len);
        for (let i = 0; i < len; i++) curve[i] = 1 - amount * Math.min(1, src[from + i]);
        duck.gain.setValueCurveAtTime(curve, whenAt, len / rate);
      }
    }
    source.start(startAt, songPos);
    return { source, fade, duck };
  }

  function playVoice(G, ev, buffer, when, offset, live) {
    if (!buffer || offset >= buffer.duration) return null;
    const ctx = G.ctx, source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = ev.gain;
    source.connect(gain);
    let last = gain, panner = null;
    if (ev.pan) {
      panner = ctx.createStereoPanner();
      panner.pan.value = clamp(ev.pan, -1, 1);
      gain.connect(panner);
      last = panner;
    }
    last.connect(stripFor(G, ev.ti).input);
    source.start(when, offset);
    if (live) {
      const voice = { source, gain, panner };
      live.add(voice);
      source.onended = () => {
        live.delete(voice);
        source.disconnect();
        gain.disconnect();
        panner?.disconnect();
      };
    }
    return source;
  }

  class AudioEngine {
    constructor(bank) {
      this.bank = bank;
      this.ctx = null;
      this.G = null;
      this.live = new Set();
      this.songNodes = null;
      this.origin = 0;
      this.timer = 0;
      this.cursor = 0;
      this.auditionNode = null;
    }

    async ensure(prj) {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) throw new Error('This browser has no Web Audio. Use a recent Chrome or Edge.');
        this.ctx = new AC({ sampleRate: YT.SR, latencyHint: 'interactive' });
        this.G = buildGraph(this.ctx, this.ctx.destination);
        if (prj) applyMix(this.G, prj);
      }
      if (this.ctx.state !== 'running') {
        // A browser will not start audio without a click; never hang the app waiting on that.
        await Promise.race([this.ctx.resume(), U.sleep(400)]);
      }
      return this.ctx;
    }

    /* Decoding uses a context fixed at 48 kHz so all sources share one rate. */
    async decode(arrayBuffer) {
      if (!this.decoder) this.decoder = new OfflineAudioContext(2, 1, YT.SR);
      return this.decoder.decodeAudioData(arrayBuffer);
    }

    applyMix(prj) { if (this.G) applyMix(this.G, prj); }

    now() { return this.ctx ? this.ctx.currentTime - this.origin : 0; }

    start(prj, plan, pos) {
      this.stop();
      const G = this.G;
      applyMix(G, prj);
      const when = this.ctx.currentTime + .08;
      this.origin = when - pos;
      this.plan = plan;
      this.songNodes = startSong(G, prj, plan, when, pos);
      // Voices already sounding at the seek point come in mid-word.
      let i = 0;
      for (; i < plan.events.length; i++) {
        const e = plan.events[i];
        if (e.start >= pos) break;
        if (!e.muted && e.start + (this.bank.get(e.key)?.duration || 0) > pos) playVoice(G, e, this.bank.get(e.key), when, pos - e.start, this.live);
      }
      this.cursor = i;
      this._schedule();
      this.timer = setInterval(() => this._schedule(), 30);
    }

    _schedule() {
      const plan = this.plan, G = this.G;
      if (!plan) return;
      const until = this.now() + .25;
      while (this.cursor < plan.events.length && plan.events[this.cursor].start <= until) {
        const e = plan.events[this.cursor++];
        if (e.muted || !e.key) continue;
        const when = this.origin + e.start;
        const late = Math.max(0, this.ctx.currentTime - when);
        playVoice(G, e, this.bank.get(e.key), Math.max(when, this.ctx.currentTime), late, this.live);
      }
    }

    stop() {
      clearInterval(this.timer);
      this.plan = null;
      for (const v of this.live) {
        try { v.source.stop(); } catch (_) { /* already ended */ }
        v.source.disconnect();
        v.gain.disconnect();
        v.panner?.disconnect();
      }
      this.live.clear();
      if (this.songNodes) {
        try { this.songNodes.source.stop(); } catch (_) { /* already ended */ }
        this.songNodes.source.disconnect();
        this.songNodes.fade.disconnect();
        this.songNodes.duck.disconnect();
        this.songNodes = null;
      }
    }

    audition(buffer, gain = 1) {
      this.stopAudition();
      const source = this.ctx.createBufferSource(), g = this.ctx.createGain();
      source.buffer = buffer;
      g.gain.value = gain;
      source.connect(g).connect(this.G.samples);
      source.start();
      this.auditionNode = source;
      return new Promise(resolve => { source.onended = resolve; });
    }

    stopAudition() {
      if (this.auditionNode) {
        try { this.auditionNode.stop(); } catch (_) { /* already ended */ }
        this.auditionNode = null;
      }
    }

    /* Faster-than-real-time mixdown for WAV and video export. */
    async renderOffline(prj, plan, { song = true, samples = true, onlyTrack = null } = {}) {
      const frames = Math.ceil((plan.duration + .05) * YT.SR);
      if (frames > YT.SR * 60 * 40) throw new Error('Exports are limited to 40 minutes.');
      const ctx = new OfflineAudioContext(2, frames, YT.SR);
      const G = buildGraph(ctx, ctx.destination);
      applyMix(G, prj);
      if (song && prj.song) startSong(G, prj, plan, 0, 0);
      if (samples) {
        for (const e of plan.events) {
          if (e.muted || !e.key || (onlyTrack != null && e.ti !== onlyTrack)) continue;
          playVoice(G, e, this.bank.get(e.key), e.start, 0, null);
        }
      }
      return ctx.startRendering();
    }
  }

  YT.AudioEngine = AudioEngine;
})(window.YT);
