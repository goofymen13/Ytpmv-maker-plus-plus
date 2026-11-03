/* Application core: owns the project, loads media, keeps the plan current, runs the transport. No DOM layout here. */
(function (YT) {
  'use strict';
  const U = YT.util, O = YT.options;
  const WORD_COLORS = U.COLORS;

  const A = YT.app = Object.assign(U.emitter(), {
    prj: { midi: null, midiName: '', midiBytes: null, song: null, clips: [], phrases: [], tracks: [], options: O.defaults(), overrides: {}, bgImage: null, pendingClips: {} },
    plan: null,
    playing: false,
    position: 0,
    loop: false,
    prepareToken: 0,
    prepared: Promise.resolve(true),
    selectedTrack: 0,
    exporting: false,
    lookKey: 'classic',

    init(stageCanvas) {
      this.farm = new YT.Farm();
      this.bank = new YT.VoiceBank(this.farm);
      this.audio = new YT.AudioEngine(this.bank);
      this.scene = new YT.Scene(stageCanvas);
      this.applyStageSize();
      this.recompile();
      window.addEventListener('beforeunload', () => this.audio.stop());
    },

    status(message, kind = '') { this.emit('status', message, kind); },
    progress(kind, value, label) { this.emit('progress', kind, value, label); },

    stageSize(width = +this.prj.options.previewRes) {
      const [a, b] = this.prj.options.aspect.split(':').map(Number);
      const portrait = a < b;
      const longSide = width;
      const w = portrait ? Math.round(longSide * a / b) : longSide;
      const h = portrait ? longSide : Math.round(longSide * b / a);
      return [w & ~1, h & ~1];
    },

    applyStageSize() {
      const [w, h] = this.stageSize();
      this.scene.resize(w, h);
      this.emit('stage-size', w, h);
      this.requestRender();
    },

    /* ---------- Loading ---------- */
    setMidi(parsed, name, bytes) {
      this.prj.midi = parsed;
      this.prj.midiName = name;
      this.prj.midiBytes = bytes || null;
      this.prj.overrides = {};
      this.setupTracks();
      this.position = 0;
      this.recompile();
      this.emit('midi');
    },

    async loadMidi(file) {
      this.pause();
      const bytes = await file.arrayBuffer();
      const parsed = YT.parseMidi(bytes);
      this.setMidi(parsed, file.name, new Uint8Array(bytes));
      this.status(`Loaded ${file.name}: ${parsed.tracks.length} tracks, ${U.fmtTime(parsed.duration)}.`);
      this.autoAlignIfBothLoaded();
    },

    /* Picks a role per track so the first play already sounds and looks reasonable. */
    setupTracks() {
      const midi = this.prj.midi;
      if (!midi) { this.prj.tracks = []; return; }
      const stats = midi.tracks.map((t, i) => {
        const avg = t.notes.reduce((s, n) => s + n.midi, 0) / Math.max(1, t.notes.length);
        const times = new Set(t.notes.map(n => Math.round(n.time * 100)));
        return { i, avg, count: t.notes.length, poly: t.notes.length / Math.max(1, times.size), drums: t.percussion };
      });
      const melodic = stats.filter(s => !s.drums);
      const lowest = melodic.length > 1 ? melodic.slice().sort((a, b) => a.avg - b.avg)[0] : null;
      const lead = melodic.filter(s => s !== lowest && s.poly < 1.6).sort((a, b) => b.count * (b.avg > 55 ? 1.4 : 1) - a.count * (a.avg > 55 ? 1.4 : 1))[0] || melodic.find(s => s !== lowest) || melodic[0];
      this.prj.tracks = midi.tracks.map((t, i) => {
        const s = stats[i];
        let role = 'fx';
        if (s.drums) role = 'drums';
        else if (s === lead) role = 'lead';
        else if (s === lowest && s.avg < 58) role = 'bass';
        else if (s.poly >= 1.3) role = 'chords';
        else role = 'chords';
        return { ...O.trackDefaults(), ...O.ROLES[role].values, name: t.name, role, source: '', mute: false, solo: false };
      });
      const look = O.LOOKS[this.lookKey];
      if (look?.track) this.prj.tracks.forEach(cfg => Object.assign(cfg, look.track, O.ROLES[cfg.role]?.values && pickKeys(O.ROLES[cfg.role].values, ['motionIn', 'flipMode', 'motionTime'])));
      this.autoAssign();
      this.selectedTrack = Math.max(0, this.prj.tracks.findIndex(t => t.role === 'lead'));
    },

    /* Gives unassigned tracks something to say, without touching tracks the user has set. */
    autoAssign(force = false) {
      const { tracks, phrases, clips } = this.prj;
      const usable = phrases.filter(p => p.steps.length);
      if (!usable.length) return;
      const drumClip = clips.find(c => /drum|kick|snare|perc|beat/i.test(c.name));
      const drumPhrase = drumClip && phrases.find(p => p.clipId === drumClip.id);
      const melodic = usable.filter(p => p !== drumPhrase);
      let next = 0;
      tracks.forEach(cfg => {
        if (cfg.source && !force) return;
        if (cfg.role === 'drums') {
          cfg.source = (drumPhrase || usable[usable.length - 1]).id;
          return;
        }
        const list = melodic.length ? melodic : usable;
        cfg.source = list[next++ % list.length].id;
      });
    },

    async loadSong(file) {
      this.pause();
      this.status(`Decoding ${file.name}…`);
      const bytes = await file.arrayBuffer();
      let buffer;
      try {
        buffer = await this.audio.decode(bytes);
      } catch (_) {
        throw new Error(`${file.name} could not be decoded. Use MP3, WAV, OGG, FLAC or M4A.`);
      }
      await this.setSong(buffer, file.name);
      this.status(`Backing track ready: ${file.name}. It plays underneath the clips.`);
      this.autoAlignIfBothLoaded();
    },

    async setSong(buffer, name) {
      const mono = new Float32Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const d = buffer.getChannelData(c);
        for (let i = 0; i < mono.length; i++) mono[i] += d[i] / buffer.numberOfChannels;
      }
      this.prj.song = { name, buffer, analysis: null };
      this.recompile();
      this.emit('song');
      const analysis = await this.farm.call('analyzeSong', mono, YT.SR);
      if (this.prj.song && this.prj.song.buffer === buffer) {
        this.prj.song.analysis = analysis;
        this.recompile();
        this.emit('song');
      }
    },

    removeSong() {
      this.pause();
      this.prj.song = null;
      this.recompile();
      this.emit('song');
    },

    autoAlignIfBothLoaded() { if (this.prj.midi && this.prj.song) this.emit('both-loaded'); },

    /* Lines the MIDI up against the MP3 by comparing note starts with audio onsets. */
    async autoAlign({ searchTempo = false, maxShift = 45 } = {}) {
      const { midi, song } = this.prj;
      if (!midi || !song) throw new Error('Load both a MIDI and an MP3 first.');
      for (let i = 0; i < 200 && !this.prj.song.analysis; i++) await U.sleep(100);
      const analysis = this.prj.song.analysis;
      if (!analysis) throw new Error('The MP3 is still being analysed. Try again in a moment.');
      const hits = new Map();
      for (const t of midi.tracks) {
        for (const n of t.notes) {
          const key = Math.round(n.time * 100);
          hits.set(key, Math.max(hits.get(key) || 0, n.velocity * (t.percussion ? 1.2 : 1)));
        }
      }
      const list = [...hits.entries()].map(([k, v]) => [k / 100, v]);
      const scales = [];
      if (searchTempo) for (let s = .95; s <= 1.0501; s += .0025) scales.push(+s.toFixed(4));
      const result = await this.farm.call('alignMidi', analysis.onset, analysis.rate, list, { maxShift, scales: scales.length ? scales : [1], maxHits: searchTempo ? 700 : 1500 });
      const o = this.prj.options;
      o.midiShift = Math.round(result.shift * 1000) / 1000;
      if (searchTempo) o.midiScale = Math.round(result.scale * 10000) / 100;
      this.invalidate('compile');
      this.emit('options-external');
      return result;
    },

    /* Clips. Each file becomes one clip with its words found automatically. */
    async addClips(files) {
      const added = [];
      for (const file of Array.from(files)) {
        try {
          this.status(`Reading ${file.name}…`);
          added.push(await this.addClip(file));
        } catch (err) {
          console.error(err);
          this.status(`${file.name}: ${err.message}`, 'error');
        }
      }
      if (added.length) {
        this.autoAssign();
        this.recompile();
        this.emit('clips');
        this.status(`Added ${added.map(c => c.name).join(', ')}. Press Edit words to fine-tune the cuts.`);
      }
      return added;
    },

    async addClip(file) {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const kind = file.type.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi'].includes(ext) ? 'video'
        : file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'].includes(ext) ? 'image' : 'audio';
      const url = URL.createObjectURL(file);
      const clip = { id: U.uid('c'), name: file.name, kind, file, url, pcm: null, dur: 1, image: null, frames: null, words: [], color: WORD_COLORS[this.prj.clips.length % WORD_COLORS.length] };
      if (kind === 'image') {
        const img = new Image();
        img.src = url;
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('This image could not be opened.')); });
        clip.image = await createImageBitmap(img);
      } else {
        if (kind === 'video') {
          clip.frames = new YT.FrameStore(clip);
          clip.frames.configure(+this.prj.options.frameFps, +this.prj.options.frameHeight);
          const probe = await clip.frames._video();
          clip.dur = probe.duration;
          clip.w = probe.videoWidth;
          clip.h = probe.videoHeight;
        }
        try {
          const buffer = await this.audio.decode(await file.arrayBuffer());
          clip.pcm = mixdown(buffer);
          clip.dur = kind === 'video' ? Math.min(clip.dur, buffer.duration) : buffer.duration;
        } catch (err) {
          if (kind === 'audio') throw new Error('This audio could not be decoded. Use MP3, WAV, OGG or M4A.');
          this.status(`${file.name} has no readable audio; its picture still works.`, 'error');
        }
      }
      this.prj.clips.push(clip);
      if (this.prj.pendingClips[file.name]) this.restoreClipWords(clip);
      else await this.detectWords(clip, {});
      this.syncAutoPhrase(clip);
      await this.makeThumb(clip);
      return clip;
    },

    addClipObject(clip) {
      this.prj.clips.push(clip);
      this.syncAutoPhrase(clip);
    },

    removeClip(id) {
      const clip = this.prj.clips.find(c => c.id === id);
      if (!clip) return;
      this.pause();
      this.prj.clips = this.prj.clips.filter(c => c !== clip);
      const wordIds = new Set(clip.words.map(w => w.id));
      this.prj.phrases = this.prj.phrases.filter(p => p.clipId !== id || !p.auto);
      for (const p of this.prj.phrases) p.steps = p.steps.filter(s => !wordIds.has(s.wordId));
      this.prj.phrases = this.prj.phrases.filter(p => p.steps.length || !p.auto);
      for (const cfg of this.prj.tracks) {
        if (!this.prj.phrases.some(p => p.id === cfg.source)) cfg.source = '';
      }
      clip.frames?.destroy();
      URL.revokeObjectURL(clip.url);
      this.autoAssign();
      this.recompile();
      this.emit('clips');
    },

    makeWord(clip, start, end, name) {
      const index = clip.words.length;
      this.wordColorCursor = (this.wordColorCursor || 0) + 1;
      return {
        id: U.uid('w'), clip, ver: 1, name: name || `word${index + 1}`, start, end,
        susStart: start + (end - start) * .3, susEnd: start + (end - start) * .7,
        root: null, rootAuto: true, susAuto: true, gain: 1, reverse: false, rms: .14, voiced: 0,
        silent: !clip.pcm, color: WORD_COLORS[this.wordColorCursor % WORD_COLORS.length]
      };
    },

    /* Finds the vowel and pitch of a word. Keeps values the user has set by hand. */
    async analyzeWord(word) {
      const clip = word.clip;
      if (!clip.pcm) { word.silent = true; return; }
      const a = Math.floor(word.start * YT.SR), b = Math.ceil(word.end * YT.SR);
      const info = await this.farm.call('wordInfo', clip.pcm.slice(a, b), YT.SR);
      word.rms = info.rms;
      word.voiced = info.voiced;
      word.silent = false;
      if (word.susAuto) {
        word.susStart = word.start + info.susStart;
        word.susEnd = word.start + info.susEnd;
      }
      if (word.rootAuto) word.root = info.rootMidi != null ? Math.round(info.rootMidi * 100) / 100 : 60;
    },

    async detectWords(clip, opts) {
      let found = clip.pcm ? await this.farm.call('detectWords', clip.pcm, YT.SR, opts) : [];
      if (found.length > 64) found = found.slice(0, 64);
      if (!found.length) found = [{ start: 0, end: clip.dur }];
      clip.words = [];
      for (const f of found) {
        const word = this.makeWord(clip, f.start, Math.min(clip.dur, f.end));
        clip.words.push(word);
      }
      await Promise.all(clip.words.map(w => this.analyzeWord(w)));
      if (clip.words.length && !clip.pcm) clip.words[0].root = 60;
    },

    /* Every clip has one phrase kept in step with its words until the user customises it. */
    syncAutoPhrase(clip) {
      let phrase = this.prj.phrases.find(p => p.clipId === clip.id && p.auto);
      const steps = clip.words.map(w => ({ type: 'word', wordId: w.id }));
      if (!phrase) {
        const stillCustom = this.prj.phrases.some(p => p.clipId === clip.id);
        if (stillCustom) return;
        phrase = { id: U.uid('p'), name: U.safeName(clip.name), clipId: clip.id, auto: true, steps };
        this.prj.phrases.push(phrase);
      } else {
        phrase.steps = steps;
      }
    },

    addPhrase(name) {
      const phrase = { id: U.uid('p'), name: name || `Phrase ${this.prj.phrases.length + 1}`, auto: false, steps: [] };
      this.prj.phrases.push(phrase);
      this.emit('phrases');
      return phrase;
    },

    wordsChanged(clip, { structural = true } = {}) {
      if (structural) this.syncAutoPhrase(clip);
      this.makeThumb(clip);
      this.emit('words', clip);
      this.invalidate('compile');
    },

    async makeThumb(clip) {
      const first = clip.words[0];
      if (!first) return;
      if (clip.kind === 'video' && !clip.frames.synthetic) {
        await clip.frames.ensure([[first.start, first.start + .05]]).catch(() => {});
        this.emit('clips');
      }
    },

    allWords() { return this.prj.clips.flatMap(c => c.words); },

    /* ---------- Options ---------- */
    setOption(id, value) {
      const meta = O.globalById[id];
      this.prj.options[id] = value;
      this.invalidate(meta?.scope, id);
    },

    setTrackOption(ti, id, value) {
      const meta = O.trackById[id];
      this.prj.tracks[ti][id] = value;
      this.invalidate(id === 'source' ? 'compile' : meta?.scope, id);
    },

    invalidate(scope, id) {
      if (scope === 'compile') { this.recompileSoon(); return; }
      if (scope === 'audio') {
        this.audio.applyMix(this.prj);
        // Fades live on nodes made at play time; pick them up by restarting from here.
        if (this.playing && (id === 'songFadeIn' || id === 'songFadeOut')) this.restartPlayback();
        return;
      }
      if (scope === 'frames') {
        for (const c of this.prj.clips) c.frames?.configure(+this.prj.options.frameFps, +this.prj.options.frameHeight);
        this.ensureFrames();
      }
      if (id === 'aspect' || id === 'previewRes') this.applyStageSize();
      this.requestRender();
    },

    recompileSoon: U.debounce(function () { YT.app.recompile(); }, 140),

    recompile() {
      this.plan = YT.compile(this.prj);
      this.position = Math.min(this.position, this.plan.duration);
      this.emit('plan', this.plan);
      this.prepare();
      this.requestRender();
    },

    prepare() {
      const token = ++this.prepareToken;
      const plan = this.plan;
      this.voicesReady = false;
      const wasPlaying = this.playing;
      this.prepared = this.bank.prepare(plan, (k, done, total) => {
        if (token === this.prepareToken && total) this.progress('voices', k, `Rendering voices ${done} / ${total}`);
      }).then(async ok => {
        if (token !== this.prepareToken || !ok) return false;
        this.progress('voices', 1, '');
        this.voicesReady = true;
        if (wasPlaying && this.playing) this.restartPlayback();
        this.ensureFrames();
        return true;
      }).catch(err => {
        console.error(err);
        this.status(`Voice rendering failed: ${err.message}`, 'error');
        return false;
      });
      return this.prepared;
    },

    /* Decodes the video frames for every word the plan actually uses. */
    ensureFrames() {
      const token = ++this.frameToken || (this.frameToken = 1);
      const perClip = new Map();
      for (const c of this.prj.clips) if (c.kind === 'video') perClip.set(c, new Set());
      for (const e of this.plan.events) perClip.get(e.clip)?.add(e.word);
      const jobs = [];
      let total = 0, done = 0;
      for (const [clip, words] of perClip) {
        const ranges = [...words].map(w => [w.start, w.end]);
        const count = clip.frames.missing(ranges).length;
        total += count;
        if (count) jobs.push(clip.frames.ensure(ranges, () => {
          done++;
          if (token === this.frameToken) this.progress('frames', done / total, `Decoding video frames ${done} / ${total}`);
          if (!this.playing && done % 6 === 0) this.requestRender();
        }, () => token !== this.frameToken));
      }
      this.framesReady = Promise.allSettled(jobs).then(() => {
        if (token === this.frameToken) {
          this.progress('frames', 1, '');
          this.requestRender();
        }
        for (const clip of perClip.keys()) if (clip.frames?.overBudget) this.status('Video frame memory is full, so some frames are skipped. Lower Video frame quality in Mix → Quality.', 'error');
      });
      return this.framesReady;
    },

    /* ---------- Transport ---------- */
    currentTime() {
      return this.playing ? U.clamp(this.audio.now(), 0, this.plan.duration) : this.position;
    },

    async play(from) {
      if (from != null) this.position = from;
      await this.audio.ensure(this.prj);
      const hasContent = this.plan.events.length || this.prj.song;
      if (!hasContent) return;
      if (this.position >= this.plan.duration - .01) this.position = 0;
      this.audio.stopAudition();
      await this.prepared;
      this.scene.post.reset();
      this.audio.start(this.prj, this.plan, this.position);
      this.playing = true;
      this.emit('transport');
      this._loop();
    },

    restartPlayback() {
      if (!this.playing) return;
      const t = this.currentTime();
      this.position = t;
      this.audio.start(this.prj, this.plan, t);
    },

    pause() {
      if (!this.playing) return;
      this.position = this.currentTime();
      this.playing = false;
      this.audio.stop();
      cancelAnimationFrame(this.raf);
      this.emit('transport');
      this.requestRender();
    },

    stop() {
      this.pause();
      this.position = 0;
      this.scene.post.reset();
      this.emit('tick', 0);
      this.requestRender();
    },

    seek(t) {
      const target = U.clamp(t, 0, this.plan.duration);
      this.position = target;
      if (this.playing) this.audio.start(this.prj, this.plan, target);
      else this.requestRender();
      this.scene.post.reset();
      this.emit('tick', target);
    },

    _loop() {
      if (!this.playing) return;
      const t = this.currentTime();
      this.scene.render(this.prj, this.plan, t);
      this.emit('tick', t);
      if (t >= this.plan.duration - .005) {
        if (this.loop) {
          this.audio.start(this.prj, this.plan, 0);
          this.scene.post.reset();
        } else {
          this.pause();
          this.position = this.plan.duration;
          return;
        }
      }
      this.raf = requestAnimationFrame(() => this._loop());
    },

    requestRender() {
      if (this.playing || this.exporting || this.renderQueued || !this.scene) return;
      this.renderQueued = true;
      requestAnimationFrame(() => {
        this.renderQueued = false;
        if (!this.playing && !this.exporting) this.scene.render(this.prj, this.plan, this.position);
      });
    },

    /* ---------- Hearing one word ---------- */
    async audition(word, { midi = null, dur = null, cfg = {}, onFrame } = {}) {
      await this.audio.ensure(this.prj);
      this.pause();
      if (word.silent) return;
      const natural = YT.wordDur(word);
      const made = YT.auditionVoice(word, { midi, dur: dur ?? natural, cfg: { stretch: midi == null && dur == null ? 'natural' : 'smart', ...cfg } });
      const key = `audition|${word.id}.${word.ver}|${JSON.stringify(made.params)}`;
      const buffer = await this.bank.render(key, word, made.params);
      const ended = this.audio.audition(buffer, .9);
      if (onFrame) {
        const startAt = this.audio.ctx.currentTime;
        const step = () => {
          const age = this.audio.ctx.currentTime - startAt;
          onFrame(YT.sourceTime(made.ev, age), age, made.ev);
          if (age < made.ev.T && this.audio.auditionNode) requestAnimationFrame(step);
        };
        step();
      }
      return ended;
    },

    /* ---------- Looks ---------- */
    applyLook(key) {
      const look = O.LOOKS[key];
      if (!look) return;
      this.lookKey = key;
      const opts = this.prj.options;
      for (const g of O.GLOBAL) {
        if (g.tab !== 'stage' && g.tab !== 'fx') continue;
        // Text the user typed is theirs; a look should not wipe a title.
        for (const it of g.items) if (it.type !== 'text') opts[it.id] = it.def;
      }
      Object.assign(opts, look.global);
      if (!('aspect' in look.global) && opts.aspect === '9:16') opts.aspect = '16:9';
      const visualGroups = new Set(['Clip on screen', 'Clip motion', 'Clip colour']);
      const visualKeys = O.TRACK.filter(g => visualGroups.has(g.group)).flatMap(g => g.items);
      for (const cfg of this.prj.tracks) {
        const role = O.ROLES[cfg.role]?.values || {};
        for (const it of visualKeys) {
          if (it.id === 'showCaption' || it.id === 'showVisual') continue;
          cfg[it.id] = it.id in role ? role[it.id] : it.def;
        }
        Object.assign(cfg, look.track);
        delete cfg.win;
      }
      this.applyStageSize();
      this.audio.applyMix(this.prj);
      this.emit('options-external');
      this.recompile();
    },

    /* ---------- Project files ---------- */
    serialize() {
      const p = this.prj;
      return {
        app: 'ytpmv-maker-ultra', version: 1,
        options: p.options,
        tracks: p.tracks,
        phrases: p.phrases,
        overrides: p.overrides,
        lookKey: this.lookKey,
        midiName: p.midiName,
        songName: p.song?.name || '',
        midi: p.midiBytes ? bytesToBase64(p.midiBytes) : null,
        clips: p.clips.map(c => ({
          id: c.id, name: c.name, kind: c.kind,
          words: c.words.map(({ clip, ...w }) => w)
        }))
      };
    },

    /* Restores settings. Media files cannot be stored in the project, so it lists what to add back. */
    load(data) {
      if (data.app !== 'ytpmv-maker-ultra') throw new Error('This is not a YTPMV Maker project file.');
      this.pause();
      const p = this.prj;
      p.options = { ...O.defaults(), ...data.options };
      this.lookKey = data.lookKey || 'classic';
      p.pendingClips = Object.fromEntries((data.clips || []).map(c => [c.name, c]));
      p.clips.forEach(c => { c.frames?.destroy(); URL.revokeObjectURL(c.url); });
      p.clips = [];
      p.song = null;
      p.phrases = data.phrases || [];
      p.overrides = data.overrides || {};
      if (data.midi) {
        const bytes = base64ToBytes(data.midi);
        p.midi = YT.parseMidi(bytes.buffer);
        p.midiName = data.midiName;
        p.midiBytes = bytes;
      } else {
        p.midi = null;
        p.midiName = '';
        p.midiBytes = null;
      }
      p.tracks = (data.tracks || []).map(t => ({ ...O.trackDefaults(), ...t }));
      this.applyStageSize();
      this.audio.applyMix(p);
      this.emit('midi');
      this.emit('song');
      this.emit('clips');
      this.emit('phrases');
      this.emit('options-external');
      this.recompile();
      return { needClips: Object.keys(p.pendingClips), needSong: data.songName };
    },

    restoreClipWords(clip) {
      const saved = this.prj.pendingClips[clip.name];
      delete this.prj.pendingClips[clip.name];
      clip.id = saved.id;
      clip.words = saved.words.map(w => ({ ...w, clip, silent: !clip.pcm }));
    }
  });

  function pickKeys(source, keys) {
    const out = {};
    for (const k of keys) if (k in source) out[k] = source[k];
    return out;
  }
  function mixdown(buffer) {
    const mono = new Float32Array(buffer.length), c = buffer.numberOfChannels;
    for (let ch = 0; ch < c; ch++) {
      const d = buffer.getChannelData(ch);
      for (let i = 0; i < mono.length; i++) mono[i] += d[i] / c;
    }
    return mono;
  }
  function bytesToBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(s);
  }
  function base64ToBytes(text) {
    const s = atob(text), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  YT.mixdown = mixdown;
})(window.YT);
