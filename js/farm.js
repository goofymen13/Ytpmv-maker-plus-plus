/* Worker pool for rendering voices, plus the cache of finished voices. */
(function (YT) {
  'use strict';
  YT.SR = 48000;

  const workerSource = () => `
    const DSP = (${YT.dspFactory.toString()})();
    const sources = new Map();
    self.onmessage = e => {
      const m = e.data;
      try {
        if (m.t === 'src') { sources.set(m.key, { pcm: m.pcm, sr: m.sr }); return; }
        if (m.t === 'drop') { sources.delete(m.key); return; }
        if (m.t === 'voice') {
          const result = DSP.renderVoice(sources.get(m.key), m.params);
          self.postMessage({ id: m.id, ok: true, result }, [result.buffer]);
          return;
        }
        if (m.t === 'call') {
          self.postMessage({ id: m.id, ok: true, result: DSP[m.fn](...m.args) });
        }
      } catch (err) {
        self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
      }
    };`;

  class Farm {
    constructor() {
      this.workers = [];
      this.queue = [];
      this.jobs = new Map();
      this.nextId = 1;
      const count = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
      try {
        const url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
        for (let i = 0; i < count; i++) {
          const worker = new Worker(url);
          const slot = { worker, busy: 0, sent: new Set() };
          worker.onmessage = e => this._done(slot, e.data);
          worker.onerror = e => {
            console.error('Voice worker error', e.message);
            e.preventDefault();
            this._workerDied(slot);
          };
          this.workers.push(slot);
        }
      } catch (err) {
        console.warn('Workers unavailable; rendering on the main thread.', err);
        this.workers = [];
      }
      this.local = new Map();
    }

    _done(slot, msg) {
      slot.busy--;
      const job = this.jobs.get(msg.id);
      this.jobs.delete(msg.id);
      if (job) { msg.ok ? job.resolve(msg.result) : job.reject(new Error(msg.error)); }
      this._pump();
    }

    _pump() {
      while (this.queue.length) {
        if (!this.workers.length) {
          // No workers left: finish the queue here rather than leaving the app waiting forever.
          const job = this.queue.shift();
          this._runLocal(job);
          continue;
        }
        const slot = this.workers.slice().sort((a, b) => a.busy - b.busy)[0];
        if (slot.busy >= 3) return;
        const job = this.queue.shift();
        if (job.cancelled && job.cancelled()) { job.reject(new Error('cancelled')); continue; }
        slot.busy++;
        job.slot = slot;
        this.jobs.set(job.id, job);
        if (job.prepare) job.prepare(slot);
        slot.worker.postMessage(job.msg);
      }
    }

    _runLocal(job) {
      YT.util.yieldToUI().then(job.local).then(job.resolve, job.reject);
    }

    _workerDied(slot) {
      this.workers = this.workers.filter(s => s !== slot);
      slot.worker.terminate();
      for (const [id, job] of this.jobs) {
        if (job.slot !== slot) continue;
        this.jobs.delete(id);
        this._runLocal(job);
      }
      this._pump();
    }

    _submit(msg, local, prepare, cancelled) {
      return new Promise((resolve, reject) => {
        const id = this.nextId++;
        msg.id = id;
        this.queue.push({ id, msg, local, prepare, cancelled, resolve, reject });
        this._pump();
      });
    }

    /* Run a DSP function by name off the main thread. */
    call(fn, ...args) {
      return this._submit({ t: 'call', fn, args }, () => YT.dsp[fn](...args));
    }

    /* `getPcm` is lazy so a word's samples only travel to workers that actually need them. */
    voice(wordKey, getPcm, params, cancelled) {
      const local = () => {
        if (!this.local.has(wordKey)) this.local.set(wordKey, { pcm: getPcm(), sr: YT.SR });
        return YT.dsp.renderVoice(this.local.get(wordKey), params);
      };
      const prepare = slot => {
        if (!slot.sent.has(wordKey)) {
          slot.worker.postMessage({ t: 'src', key: wordKey, pcm: getPcm(), sr: YT.SR });
          slot.sent.add(wordKey);
        }
      };
      return this._submit({ t: 'voice', key: wordKey, params }, local, prepare, cancelled);
    }

    dropWord(wordKey) {
      this.local.delete(wordKey);
      for (const slot of this.workers) {
        if (slot.sent.delete(wordKey)) slot.worker.postMessage({ t: 'drop', key: wordKey });
      }
    }
  }

  /* Rendered voices, shared by preview and export. */
  class VoiceBank {
    constructor(farm) {
      this.farm = farm;
      this.cache = new Map();
      this.pending = new Map();
      this.bytes = 0;
      this.token = 0;
    }

    get(key) { return this.cache.get(key); }

    render(key, word, params, cancelled) {
      if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
      if (this.pending.has(key)) return this.pending.get(key);
      const wordKey = `${word.id}.${word.ver}`;
      const clip = word.clip;
      const getPcm = () => {
        const from = Math.floor(word.start * YT.SR), to = Math.ceil(word.end * YT.SR);
        return clip.pcm.slice(Math.max(0, from), Math.min(clip.pcm.length, to));
      };
      const promise = this.farm.voice(wordKey, getPcm, params, cancelled).then(data => {
        const buffer = new AudioBuffer({ length: Math.max(1, data.length), numberOfChannels: 1, sampleRate: YT.SR });
        buffer.copyToChannel(data, 0);
        this.cache.set(key, buffer);
        this.bytes += data.length * 4;
        this.pending.delete(key);
        return buffer;
      }).catch(err => {
        this.pending.delete(key);
        throw err;
      });
      this.pending.set(key, promise);
      return promise;
    }

    /* Renders everything a plan needs. A newer call cancels the older one's queued work. */
    async prepare(plan, onProgress) {
      const token = ++this.token;
      const cancelled = () => token !== this.token;
      const entries = [...plan.voices.entries()];
      const missing = entries.filter(([key]) => !this.cache.has(key));
      const total = missing.length;
      if (!total) { onProgress?.(1, 0, 0); return true; }
      let done = 0;
      onProgress?.(0, 0, total);
      const results = await Promise.allSettled(missing.map(([key, v]) => this.render(key, v.word, v.params, cancelled).then(() => {
        done++;
        if (!cancelled()) onProgress?.(done / total, done, total);
      })));
      if (cancelled()) return false;
      const failed = results.find(r => r.status === 'rejected' && r.reason?.message !== 'cancelled');
      if (failed) throw failed.reason;
      this.prune(plan);
      return true;
    }

    /* Only clears old voices when memory is getting tight, so undoing a tweak stays instant. */
    prune(plan) {
      const LIMIT = 1.2e9;
      if (this.bytes < LIMIT) return;
      for (const [key, buffer] of this.cache) {
        if (plan.voices.has(key)) continue;
        this.bytes -= buffer.length * 4;
        this.cache.delete(key);
        if (this.bytes < LIMIT * .7) break;
      }
    }
  }

  YT.Farm = Farm;
  YT.VoiceBank = VoiceBank;
})(window.YT);
