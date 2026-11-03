/* Pre-decodes clip video into memory, one bitmap per frame.
   This is what makes cuts frame-perfect: the renderer never waits on a video seek, any number of
   copies can show different frames at once, and words can play backwards or in slow motion. */
(function (YT) {
  'use strict';
  const BUDGET = 2.5e9;
  let usedBytes = 0;

  class FrameStore {
    constructor(clip) {
      this.clip = clip;
      this.frames = new Map();
      this.fps = 30;
      this.height = 480;
      this.width = 854;
      this.video = null;
      this.queue = Promise.resolve();
      this.generation = 0;
      this.synthetic = false;
      this.overBudget = false;
    }

    configure(fps, height) {
      if (this.synthetic || (this.fps === fps && this.height === height)) return;
      this.fps = fps;
      this.height = height;
      this.clear();
    }

    clear() {
      this.generation++;
      for (const bitmap of this.frames.values()) bitmap.close?.();
      usedBytes -= this.frames.size * this.width * this.height * 4;
      this.frames.clear();
      this.overBudget = false;
    }

    /* For generated demo clips and tests. */
    put(index, bitmap) {
      this.synthetic = true;
      this.width = bitmap.width;
      this.height = bitmap.height;
      this.frames.set(index, bitmap);
    }

    /* The bitmap nearest to a source time. Falls outward when a frame has not been decoded yet. */
    get(t) {
      if (!this.frames.size) return null;
      const i = Math.round(t * this.fps);
      const exact = this.frames.get(i);
      if (exact) return exact;
      for (let d = 1; d <= this.fps * 4; d++) {
        const f = this.frames.get(i - d) || this.frames.get(i + d);
        if (f) return f;
      }
      return this.frames.values().next().value;
    }

    missing(ranges) {
      const need = new Set();
      for (const [a, b] of ranges) {
        const from = Math.floor(a * this.fps), to = Math.ceil(b * this.fps);
        for (let i = from; i <= to; i++) if (!this.frames.has(i)) need.add(i);
      }
      return [...need].sort((x, y) => x - y);
    }

    async _video() {
      if (this.video) return this.video;
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.src = this.clip.url;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The browser took too long to open this video.')), 20000);
        v.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true });
        v.addEventListener('error', () => { clearTimeout(timer); reject(new Error('This video format is not supported by your browser. Try MP4 (H.264) or WebM.')); }, { once: true });
      });
      this.width = Math.max(2, Math.round(v.videoWidth / v.videoHeight * this.height / 2) * 2);
      this.video = v;
      return v;
    }

    /* Decodes the listed ranges. Calls are queued so only one seek sequence runs per clip. */
    ensure(ranges, onProgress, cancelled) {
      this.queue = this.queue.then(() => this._ensure(ranges, onProgress, cancelled)).catch(err => { console.error(err); throw err; });
      const settled = this.queue;
      this.queue = this.queue.catch(() => {});
      return settled;
    }

    async _ensure(ranges, onProgress, cancelled) {
      if (this.synthetic || this.clip.kind !== 'video') return;
      const generation = this.generation;
      const list = this.missing(ranges);
      if (!list.length) return;
      const video = await this._video();
      const limit = Math.max(.001, (video.duration || 1) - .001);
      const bytesPerFrame = this.width * this.height * 4;
      for (let n = 0; n < list.length; n++) {
        if (generation !== this.generation || (cancelled && cancelled())) return;
        if (usedBytes + bytesPerFrame > BUDGET) { this.overBudget = true; return; }
        const index = list[n];
        const t = Math.min(limit, Math.max(0, index / this.fps));
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 3000);
          video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
          video.currentTime = t;
        });
        try {
          const bitmap = await createImageBitmap(video, { resizeWidth: this.width, resizeHeight: this.height, resizeQuality: 'medium' });
          if (generation !== this.generation) { bitmap.close(); return; }
          this.frames.set(index, bitmap);
          usedBytes += bytesPerFrame;
        } catch (err) {
          console.warn('Could not capture frame', index, err);
        }
        onProgress?.(n + 1, list.length);
      }
    }

    /* Closes the decoder once nothing is queued; frames stay. */
    releaseVideo() {
      if (!this.video) return;
      this.video.removeAttribute('src');
      this.video.load();
      this.video = null;
    }

    destroy() {
      this.clear();
      this.releaseVideo();
    }
  }

  YT.FrameStore = FrameStore;
})(window.YT);
