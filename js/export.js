/* Frame-by-frame video export with WebCodecs: faster than real time on most machines and it never drops a frame.
   If a browser lacks WebCodecs, it falls back to recording the preview in real time. */
(function (YT) {
  'use strict';
  const U = YT.util;

  /* setTimeout gets throttled in hidden tabs; this does not, so exports survive switching tabs. */
  const channel = new MessageChannel();
  const waiting = [];
  channel.port1.onmessage = () => waiting.shift()?.();
  const fastYield = () => new Promise(r => { waiting.push(r); channel.port2.postMessage(0); });

  const h264Codec = (w, h, fps) => {
    const mbps = (w * h * fps);
    const level = mbps <= 1280 * 720 * 30 ? '1f' : mbps <= 1280 * 720 * 60 ? '20' : mbps <= 1920 * 1088 * 30 ? '28' : mbps <= 1920 * 1088 * 60 ? '2a' : mbps <= 2560 * 1440 * 60 ? '33' : '34';
    return [`avc1.6400${level}`, `avc1.4d00${level}`, `avc1.4200${level}`];
  };

  async function pickFormat(pref, w, h, fps, videoBitrate, audioBitrate) {
    if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') return null;
    const vBase = { width: w, height: h, framerate: fps, bitrate: videoBitrate, latencyMode: 'quality' };
    const aBase = { numberOfChannels: 2, sampleRate: YT.SR, bitrate: audioBitrate };
    const testVideo = async (codec, extra = {}) => {
      const cfg = { ...vBase, codec, ...extra };
      try { return (await VideoEncoder.isConfigSupported(cfg)).supported ? cfg : null; } catch (_) { return null; }
    };
    const testAudio = async codec => {
      const cfg = { ...aBase, codec };
      try { return (await AudioEncoder.isConfigSupported(cfg)).supported ? cfg : null; } catch (_) { return null; }
    };
    const options = [];
    if (pref !== 'webm') {
      options.push(async () => {
        const audio = await testAudio('mp4a.40.2');
        if (!audio) return null;
        for (const codec of h264Codec(w, h, fps)) {
          const video = await testVideo(codec, { avc: { format: 'avc' } });
          if (video) return { container: 'mp4', video, audio };
        }
        return null;
      });
    }
    options.push(async () => {
      const audio = await testAudio('opus');
      if (!audio) return null;
      const vp9 = await testVideo(w * h > 2048 * 1088 ? 'vp09.00.51.08' : 'vp09.00.41.08');
      if (vp9) return { container: 'webm', video: vp9, audio, codecId: 'V_VP9' };
      const vp8 = await testVideo('vp8');
      if (vp8) return { container: 'webm', video: vp8, audio, codecId: 'V_VP8' };
      return null;
    });
    for (const attempt of options) {
      const found = await attempt();
      if (found) return found;
    }
    return null;
  }

  async function encodeAudio(buffer, config, onProgress, cancelled, startSec = 0, endSec = Infinity) {
    const samples = [];
    let description = null, failure = null;
    const encoder = new AudioEncoder({
      output: (chunk, meta) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        if (meta?.decoderConfig?.description && !description) description = new Uint8Array(meta.decoderConfig.description.buffer || meta.decoderConfig.description);
        samples.push({ data, ts: chunk.timestamp, dur: chunk.duration || 0, key: true });
      },
      error: e => { failure = e; }
    });
    encoder.configure(config);
    const rate = buffer.sampleRate;
    const from = Math.floor(startSec * rate), to = Math.min(buffer.length, Math.floor(Math.min(endSec, buffer.duration) * rate));
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1), step = 4800;
    for (let at = from; at < to; at += step) {
      if (cancelled()) { encoder.close(); return null; }
      if (failure) throw failure;
      const count = Math.min(step, to - at), planar = new Float32Array(count * 2);
      planar.set(left.subarray(at, at + count), 0);
      planar.set(right.subarray(at, at + count), count);
      const frame = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: count, numberOfChannels: 2, timestamp: Math.round((at - from) / rate * 1e6), data: planar });
      encoder.encode(frame);
      frame.close();
      if (encoder.encodeQueueSize > 16) await U.sleep(1);
      if ((at - from) % (step * 40) === 0) {
        onProgress((at - from) / Math.max(1, to - from));
        await fastYield();
      }
    }
    await encoder.flush();
    encoder.close();
    if (failure) throw failure;
    return { samples, description };
  }

  /* Exports with WebCodecs. Reports progress as (fraction 0..1, message). */
  async function exportVideo(A, opts, onProgress, cancelled) {
    const prj = A.prj, plan = A.plan;
    const w = opts.width & ~1, h = opts.height & ~1, fps = opts.fps;
    const videoBitrate = opts.videoMbps * 1e6, audioBitrate = opts.audioKbps * 1000;
    const startSec = Math.max(0, opts.start || 0);
    const endSec = Math.min(plan.duration, opts.end || plan.duration);
    const total = Math.max(1, Math.ceil((endSec - startSec) * fps));

    const format = await pickFormat(opts.format, w, h, fps, videoBitrate, audioBitrate);
    if (!format) return null;

    onProgress(.01, 'Mixing audio…');
    const audioBuffer = await A.audio.renderOffline(prj, plan);
    if (cancelled()) return { cancelled: true };

    onProgress(.03, 'Encoding audio…');
    const audioOut = await encodeAudio(audioBuffer, format.audio, k => onProgress(.03 + k * .05, 'Encoding audio…'), cancelled, startSec, endSec);
    if (!audioOut) return { cancelled: true };

    const samples = [];
    let description = null, failure = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        if (meta?.decoderConfig?.description && !description) {
          const d = meta.decoderConfig.description;
          description = new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d);
        }
        samples.push({ data, ts: chunk.timestamp, dur: chunk.duration || Math.round(1e6 / fps), key: chunk.type === 'key' });
      },
      error: e => { failure = e; }
    });
    encoder.configure(format.video);

    A.scene.post.reset();
    const started = performance.now();
    for (let i = 0; i < total; i++) {
      if (cancelled()) { encoder.close(); return { cancelled: true }; }
      if (failure) throw failure;
      A.scene.render(prj, plan, startSec + i / fps);
      const frame = new VideoFrame(A.scene.output, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 8) await U.sleep(1);
      if (i % 3 === 0) {
        const speed = ((i + 1) / fps) / ((performance.now() - started) / 1000);
        onProgress(.08 + .9 * (i / total), `Frame ${i + 1} of ${total} · ${speed.toFixed(1)}× real time`);
        await fastYield();
      }
    }
    await encoder.flush();
    encoder.close();
    if (failure) throw failure;

    onProgress(.99, 'Writing the file…');
    const audioTrack = { samples: audioOut.samples, description: audioOut.description, channels: 2, sampleRate: YT.SR, bitrate: audioBitrate };
    let blob;
    if (format.container === 'mp4') {
      if (!description) throw new Error('The H.264 encoder did not provide its configuration.');
      if (!audioOut.description) throw new Error('The AAC encoder did not provide its configuration.');
      blob = YT.mux.buildMp4({ video: { samples, description, width: w, height: h }, audio: audioTrack });
    } else {
      blob = YT.mux.buildWebm({ video: { samples, codecId: format.codecId, width: w, height: h }, audio: audioTrack });
    }
    return { blob, extension: format.container, label: format.container === 'mp4' ? 'MP4 (H.264 + AAC)' : `WebM (${format.codecId === 'V_VP9' ? 'VP9' : 'VP8'} + Opus)`, frames: total };
  }

  /* Fallback: plays the song and records the canvas. Tab must stay visible. */
  async function recordRealtime(A, opts, onProgress, cancelled) {
    if (!window.MediaRecorder || !A.scene.output.captureStream) throw new Error('This browser cannot export video. Use a recent Chrome or Edge.');
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
    if (!mime) throw new Error('This browser cannot record a supported video format.');
    await A.audio.ensure(A.prj);
    const out = A.audio.ctx.createMediaStreamDestination();
    A.audio.G.limiter.connect(out);
    const video = A.scene.output.captureStream(opts.fps);
    const stream = new MediaStream([...video.getVideoTracks(), ...out.stream.getAudioTracks()]);
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: opts.videoMbps * 1e6, audioBitsPerSecond: opts.audioKbps * 1000 });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise(r => { recorder.onstop = r; });
    recorder.start(500);
    await A.play(0);
    const dur = A.plan.duration;
    while (A.playing && !cancelled()) {
      onProgress(A.currentTime() / dur, `Recording in real time: ${U.fmtTime(A.currentTime())} / ${U.fmtTime(dur)}`);
      await U.sleep(100);
    }
    A.pause();
    recorder.stop();
    await stopped;
    stream.getTracks().forEach(t => t.stop());
    A.audio.G.limiter.disconnect(out);
    if (cancelled()) return { cancelled: true };
    return { blob: new Blob(chunks, { type: recorder.mimeType }), extension: recorder.mimeType.includes('mp4') ? 'mp4' : 'webm', label: 'Real-time recording', frames: 0 };
  }

  YT.exporter = { exportVideo, recordRealtime, pickFormat, encodeAudio };
})(window.YT);
