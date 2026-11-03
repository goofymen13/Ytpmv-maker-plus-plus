/* Wires the page to the app core: panels, tabs, transport, drag and drop, export. */
(function (YT) {
  'use strict';
  const U = YT.util, O = YT.options, { $, el } = U;
  const A = YT.app;

  const fail = err => {
    console.error(err);
    A.status(err.message || 'Something went wrong.', 'error');
  };
  const guard = fn => (...args) => Promise.resolve().then(() => fn(...args)).catch(fail);

  /* ---------- Status and progress ---------- */
  const progressBars = new Map();
  A.on('status', (message, kind) => {
    const s = $('status');
    s.textContent = message;
    s.title = message;
    s.className = `status ${kind}`;
  });
  A.on('progress', (kind, value, label) => {
    let bar = progressBars.get(kind);
    if (!bar) {
      bar = el('i');
      $('progress-strip').append(bar);
      progressBars.set(kind, bar);
    }
    const running = value < 1 && label;
    bar.style.width = running ? `${value * 100}%` : '0';
    if (running) { $('status').textContent = label; $('status').className = 'status'; }
    else if (label === '' && /Rendering voices|Decoding video/.test($('status').textContent)) $('status').textContent = 'Ready.';
  });

  /* ---------- Song panel ---------- */
  function renderSong() {
    const { midi, midiName, song } = A.prj;
    $('midi-drop').classList.toggle('loaded', !!midi);
    $('midi-name').textContent = midi ? midiName : 'Drop a MIDI';
    $('midi-info').textContent = midi
      ? `${midi.tracks.length} track${midi.tracks.length === 1 ? '' : 's'} · ${U.fmtTime(midi.duration)} · ${Math.round(midi.tempos[0]?.bpm || 120)} BPM`
      : 'Plays the clips: its notes decide what gets sung and when.';
    $('song-drop').classList.toggle('loaded', !!song);
    $('song-name').textContent = song ? song.name : 'Drop an MP3';
    $('song-info').textContent = song
      ? `${U.fmtTime(song.buffer.duration)}${song.analysis ? '' : ' · analysing…'}`
      : 'The real music. It plays underneath, in sync with the MIDI.';
    $('song-actions').hidden = !song;
    $('align-btn').disabled = !midi || !song;
    $('align-tempo-btn').disabled = !midi || !song;
    updateEmpty();
  }

  function updateEmpty() {
    const hasPlan = A.plan && (A.plan.events.length || A.prj.song);
    $('stage-empty').hidden = !!hasPlan;
  }

  const align = searchTempo => guard(async () => {
    A.status(searchTempo ? 'Searching offset and tempo…' : 'Lining the MIDI up with the MP3…');
    const r = await A.autoAlign({ searchTempo });
    const box = $('align-result');
    box.hidden = false;
    const sure = r.confidence > 6 ? 'Strong match.' : r.confidence > 3.5 ? 'Decent match, check by ear.' : 'Weak match. This MIDI may not be the same arrangement as the MP3, so check by ear and drag the MP3 row in the timeline.';
    box.textContent = `MIDI starts ${r.shift >= 0 ? 'at' : 'before the MP3 by'} ${Math.abs(r.shift).toFixed(3)} s${searchTempo ? `, tempo ${(r.scale * 100).toFixed(2)}%` : ''}. ${sure}`;
    A.status('Sync done. Press play and listen; fine-tune in Mix → Syncing.');
  })();

  /* ---------- Clip list ---------- */
  function clipThumb(clip) {
    const canvas = el('canvas', { width: 108, height: 80 });
    const g = canvas.getContext('2d');
    const first = clip.words[0];
    const media = clip.image || (first && clip.frames?.get(first.start));
    if (media) {
      const s = Math.max(108 / media.width, 80 / media.height);
      g.drawImage(media, (108 - media.width * s) / 2, (80 - media.height * s) / 2, media.width * s, media.height * s);
    } else {
      g.fillStyle = '#1b1e27';
      g.fillRect(0, 0, 108, 80);
      g.fillStyle = clip.color;
      g.font = '34px system-ui';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('♪', 54, 40);
    }
    return canvas;
  }

  function renderClips() {
    const box = $('clip-list');
    box.replaceChildren();
    $('clip-count').textContent = A.prj.clips.length;
    for (const clip of A.prj.clips) {
      const words = clip.words.map(w => el('button', {
        class: 'chip', style: { '--chip': w.color }, title: `Hear “${w.name}”`,
        onclick: () => A.audition(w).catch(fail)
      }, el('span', null, w.name)));
      box.append(el('div', { class: 'clip' },
        el('div', { class: 'clip-thumb' }, clipThumb(clip)),
        el('div', { style: { minWidth: 0 } },
          el('div', { class: 'clip-name', title: clip.name }, clip.name),
          el('div', { class: 'clip-meta' }, `${clip.kind} · ${clip.dur.toFixed(2)} s · ${clip.words.length} word${clip.words.length === 1 ? '' : 's'}`)),
        el('div', { class: 'clip-buttons' },
          el('button', { class: 'small', onclick: () => YT.workshop.open(clip) }, 'Edit words'),
          el('button', { class: 'ghost small icon', title: `Remove ${clip.name}`, 'aria-label': `Remove ${clip.name}`, onclick: () => A.removeClip(clip.id) }, '✕')),
        el('div', { class: 'clip-words' }, words)
      ));
    }
    const pending = Object.keys(A.prj.pendingClips);
    if (pending.length) box.append(el('p', { class: 'hint' }, `Add these files back to restore your cuts: ${pending.join(', ')}`));
    updateEmpty();
  }

  /* ---------- Tabs ---------- */
  const TABS = [['tracks', 'Tracks'], ['stage', 'Screen'], ['fx', 'Effects'], ['mix', 'Mix'], ['export', 'Export']];
  let activeTab = 'tracks';

  function renderTabs() {
    $('tabs').replaceChildren(...TABS.map(([id, label]) => el('button', {
      class: id === activeTab ? 'active' : '', role: 'tab', 'aria-selected': id === activeTab ? 'true' : 'false',
      onclick: () => { activeTab = id; $('opt-search').value = ''; renderTabs(); renderTab(); }
    }, label)));
  }

  const getGlobal = id => A.prj.options[id];
  const setGlobal = (id, v) => A.setOption(id, v);

  function renderGlobalTab(tab) {
    const body = $('tab-body');
    for (const g of O.GLOBAL) {
      if (g.tab !== tab) continue;
      body.append(YT.forms.group(g.group, g.items, getGlobal, setGlobal, { open: g.open, key: `g:${g.group}` }));
    }
    if (tab === 'stage') {
      const pickImage = el('input', { type: 'file', accept: 'image/*', hidden: true });
      pickImage.addEventListener('change', guard(async () => {
        if (!pickImage.files[0]) return;
        A.prj.bgImage = await createImageBitmap(pickImage.files[0]);
        A.setOption('bgType', 'image');
        renderTab();
      }));
      body.append(el('div', { class: 'track-actions' }, el('button', { class: 'ghost small', onclick: () => pickImage.click() }, 'Choose background image'), pickImage));
    }
  }

  /* Source dropdown: phrases first, then whole clips, then single words. */
  function sourceSelect(cfg, ti) {
    const { phrases, clips } = A.prj;
    const select = el('select', { 'aria-label': `What ${cfg.name} sings` },
      el('option', { value: '' }, '(silent)'),
      phrases.length ? el('optgroup', { label: 'Phrases' }, phrases.map(p => el('option', { value: p.id }, p.name))) : null,
      clips.length ? el('optgroup', { label: 'Single word' }, clips.flatMap(c => c.words.map(w => el('option', { value: `word:${w.id}` }, `${w.name} (${c.name})`)))) : null
    );
    select.value = cfg.source;
    select.addEventListener('change', () => A.setTrackOption(ti, 'source', select.value));
    select.addEventListener('click', e => e.stopPropagation());
    return select;
  }

  function renderTracks(body) {
    const { tracks } = A.prj;
    if (!tracks.length) {
      body.append(el('div', { class: 'empty' }, 'Load a MIDI to see its tracks here.'));
      return;
    }
    tracks.forEach((cfg, ti) => {
      const color = U.COLORS[ti % U.COLORS.length];
      const count = A.prj.midi.tracks[ti]?.notes.length || 0;
      const role = el('select', { 'aria-label': `Role of ${cfg.name}`, title: 'Applies sensible settings for this kind of part' },
        Object.entries(O.ROLES).map(([k, v]) => el('option', { value: k }, v.label)));
      role.value = cfg.role;
      role.addEventListener('click', e => e.stopPropagation());
      role.addEventListener('change', () => {
        cfg.role = role.value;
        Object.assign(cfg, O.ROLES[role.value].values);
        A.invalidate('compile');
        renderTab();
      });
      const mute = el('button', { class: `ghost ${cfg.mute ? 'mute-on' : ''}`, title: 'Mute', 'aria-pressed': cfg.mute ? 'true' : 'false', onclick: e => { e.stopPropagation(); cfg.mute = !cfg.mute; A.invalidate('compile'); renderTab(); } }, 'M');
      const solo = el('button', { class: `ghost ${cfg.solo ? 'solo-on' : ''}`, title: 'Solo', 'aria-pressed': cfg.solo ? 'true' : 'false', onclick: e => { e.stopPropagation(); cfg.solo = !cfg.solo; A.invalidate('compile'); renderTab(); } }, 'S');
      const row = el('div', { class: `track-row ${ti === A.selectedTrack ? 'selected' : ''}`, tabIndex: 0, role: 'button', onclick: () => { A.selectedTrack = ti; renderTab(); } },
        el('span', { class: 'track-dot', style: { background: color } }),
        el('div', { class: 'track-title', title: cfg.name }, cfg.name, ' ', el('small', null, `${count} notes`)),
        el('div', { class: 'track-buttons' }, mute, solo),
        el('div', { class: 'track-source' }, sourceSelect(cfg, ti), role)
      );
      row.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === row) { A.selectedTrack = ti; renderTab(); } });
      body.append(row);
    });
    const cfg = tracks[A.selectedTrack] || tracks[0];
    const ti = tracks.indexOf(cfg);
    body.append(el('div', { class: 'track-actions' },
      el('button', { class: 'ghost small', onclick: () => {
        const visualOnly = new Set(['source', 'name', 'role', 'mute', 'solo', 'win']);
        for (const other of tracks) {
          if (other === cfg) continue;
          for (const [k, v] of Object.entries(cfg)) if (!visualOnly.has(k)) other[k] = v;
        }
        A.invalidate('compile');
        A.status(`Copied ${cfg.name}’s settings to the other tracks.`);
      } }, 'Copy settings to all tracks'),
      el('button', { class: 'ghost small', onclick: () => {
        Object.assign(cfg, O.trackDefaults(), O.ROLES[cfg.role].values);
        delete cfg.win;
        A.invalidate('compile');
        renderTab();
      } }, 'Reset this track')
    ));
    body.append(el('div', { class: 'track-heading' }, 'Settings for ', el('b', null, cfg.name)));
    const get = id => cfg[id];
    const set = (id, v) => A.setTrackOption(ti, id, v);
    for (const g of O.TRACK) body.append(YT.forms.group(g.group, g.items, get, set, { open: g.open, key: `t:${g.group}` }));
  }

  /* ---------- Export tab ---------- */
  const EXP = { size: '1920', fps: 30, videoMbps: 12, audioKbps: 256, format: 'auto', range: 'all' };
  const EXPORT_FIELDS = [
    { id: 'size', label: 'Resolution', type: 'select', choices: [['960', '540p'], ['1280', '720p'], ['1920', '1080p'], ['2560', '1440p'], ['3840', '4K']] },
    { id: 'fps', label: 'Frame rate', type: 'select', choices: [['24', '24 fps'], ['25', '25 fps'], ['30', '30 fps'], ['50', '50 fps'], ['60', '60 fps']] },
    { id: 'videoMbps', label: 'Video quality', type: 'range', min: 2, max: 60, step: 1, unit: 'Mbps' },
    { id: 'audioKbps', label: 'Audio quality', type: 'select', choices: [['128', '128 kbps'], ['192', '192 kbps'], ['256', '256 kbps'], ['320', '320 kbps']] },
    { id: 'format', label: 'Format', type: 'select', choices: [['auto', 'Best available (MP4 first)'], ['webm', 'WebM']] },
    { id: 'range', label: 'Length', type: 'select', choices: [['all', 'Whole song'], ['ten', '10 second test from the playhead']] }
  ];

  let exportCancelled = false;

  async function runExport() {
    if (A.exporting) return;
    A.pause();
    await A.prepared;
    A.status('Preparing video frames…');
    await A.ensureFrames();
    if (!A.plan.events.length && !A.prj.song) throw new Error('Nothing to render yet. Add a MIDI and a clip first.');
    exportCancelled = false;
    A.exporting = true;
    $('export-cover').hidden = false;
    $('export-meter').value = 0;
    const cancelled = () => exportCancelled;
    const onProgress = (value, label) => {
      $('export-meter').value = value;
      $('export-label').textContent = label;
    };
    const [w, h] = A.stageSize(+EXP.size);
    const previous = [A.scene.w, A.scene.h];
    const options = {
      width: w, height: h, fps: +EXP.fps, videoMbps: +EXP.videoMbps, audioKbps: +EXP.audioKbps, format: EXP.format,
      start: EXP.range === 'ten' ? A.position : 0,
      end: EXP.range === 'ten' ? A.position + 10 : undefined
    };
    let result = null;
    try {
      A.scene.resize(w, h);
      result = await YT.exporter.exportVideo(A, options, onProgress, cancelled);
      if (result === null) {
        A.scene.resize(...previous);
        A.exporting = false;
        result = await YT.exporter.recordRealtime(A, options, onProgress, cancelled);
      }
    } finally {
      A.exporting = false;
      A.scene.resize(...previous);
      $('export-cover').hidden = true;
      A.requestRender();
    }
    if (!result || result.cancelled) {
      A.status('Render cancelled.');
      return;
    }
    const name = `${U.safeName(A.prj.midiName || 'ytpmv')}-ytpmv.${result.extension}`;
    const url = U.download(result.blob, name);
    addDownload(url, name, result);
    A.status(`Rendered ${name}: ${result.label}, ${(result.blob.size / 1048576).toFixed(1)} MB.`);
  }

  const downloads = [];
  function addDownload(url, name, result) {
    downloads.unshift({ url, name, label: `${name} (${(result.blob.size / 1048576).toFixed(1)} MB, ${result.label})` });
    if (activeTab === 'export') renderTab();
    A.lastExport = result;
  }

  async function exportWav(mode) {
    A.pause();
    await A.prepared;
    A.status('Mixing audio…');
    const opts = mode === 'samples' ? { song: false } : {};
    const buffer = await A.audio.renderOffline(A.prj, A.plan, opts);
    const name = `${U.safeName(A.prj.midiName || 'ytpmv')}-${mode === 'samples' ? 'clips-only' : 'mix'}.wav`;
    const blob = U.encodeWav(buffer);
    const url = U.download(blob, name);
    addDownload(url, name, { blob, label: 'WAV' });
    A.status(`Saved ${name}.`);
  }

  function renderExport(body) {
    const box = el('div', { class: 'export-body' });
    for (const field of EXPORT_FIELDS) {
      box.append(YT.forms.row({ ...field, def: EXP[field.id] }, id => EXP[id], (id, v) => { EXP[id] = v; }));
    }
    box.append(
      el('div', { class: 'button-row' },
        el('button', { class: 'primary', onclick: guard(runExport) }, 'Render video'),
        el('button', { class: 'ghost', onclick: guard(() => exportWav('mix')) }, 'Audio WAV'),
        el('button', { class: 'ghost', onclick: guard(() => exportWav('samples')) }, 'Clips only WAV'),
        el('button', { class: 'ghost', onclick: () => A.scene.output.toBlob(b => U.download(b, 'ytpmv-frame.png')) }, 'Save frame PNG')),
      el('p', { class: 'hint', style: { margin: 0 } }, 'Renders frame by frame, so nothing is dropped, usually faster than real time. You can use other tabs meanwhile.'));
    if (downloads.length) {
      box.append(el('div', { class: 'downloads' }, el('b', null, 'This session'), downloads.map(d => el('a', { href: d.url, download: d.name }, d.label))));
    }
    body.append(box);
  }

  /* ---------- Search across every setting ---------- */
  function renderSearch(body, query) {
    const q = query.toLowerCase();
    const matches = meta => meta.label.toLowerCase().includes(q) || meta.id.toLowerCase().includes(q) || (meta.help || '').toLowerCase().includes(q);
    let found = 0;
    for (const g of O.GLOBAL) {
      const items = g.items.filter(matches);
      if (items.length) {
        found += items.length;
        body.append(YT.forms.group(g.group, items, getGlobal, setGlobal, { open: true, key: `search:${g.group}` }));
      }
    }
    const cfg = A.prj.tracks[A.selectedTrack];
    if (cfg) {
      for (const g of O.TRACK) {
        const items = g.items.filter(matches);
        if (items.length) {
          found += items.length;
          body.append(YT.forms.group(`${cfg.name}: ${g.group}`, items, id => cfg[id], (id, v) => A.setTrackOption(A.selectedTrack, id, v), { open: true, key: `search:t:${g.group}` }));
        }
      }
    }
    if (!found) body.append(el('div', { class: 'empty' }, `No settings match “${query}”.`));
  }

  function renderTab() {
    const body = $('tab-body');
    const scroll = body.scrollTop;
    body.replaceChildren();
    const query = $('opt-search').value.trim();
    if (query) renderSearch(body, query);
    else if (activeTab === 'tracks') renderTracks(body);
    else if (activeTab === 'export') renderExport(body);
    else renderGlobalTab(activeTab);
    body.scrollTop = scroll;
  }

  /* ---------- Look presets ---------- */
  function renderLooks() {
    $('look-select').replaceChildren(...Object.entries(O.LOOKS).map(([k, v]) => el('option', { value: k }, v.label)));
    $('look-select').value = A.lookKey;
  }

  function randomLook() {
    const keys = Object.keys(O.LOOKS).filter(k => k !== 'clean' && k !== 'vertical');
    const key = keys[Math.floor(Math.random() * keys.length)];
    A.applyLook(key);
    $('look-select').value = key;
    const motions = O.trackById.motionIn.choices.map(c => c[0]);
    for (const cfg of A.prj.tracks) cfg.motionIn = motions[Math.floor(Math.random() * motions.length)];
    A.prj.options.fxHue = Math.random() < .25 ? Math.round(Math.random() * 120 - 60) : 0;
    renderTab();
    A.requestRender();
    A.status(`Random look: ${O.LOOKS[key].label}.`);
  }

  /* ---------- Stage sizing, and dragging track windows ---------- */
  function fitStage() {
    const wrap = $('stage-wrap'), stage = $('stage');
    if (document.fullscreenElement === wrap) {
      stage.style.width = '';
      stage.style.height = '';
    }
    const bw = wrap.clientWidth, bh = wrap.clientHeight;
    const ratio = stage.width / stage.height;
    const w = Math.min(bw, bh * ratio), h = w / ratio;
    stage.style.width = `${Math.floor(w)}px`;
    stage.style.height = `${Math.floor(h)}px`;
    const overlay = $('stage-overlay');
    overlay.style.width = stage.style.width;
    overlay.style.height = stage.style.height;
    if (!overlay.hidden) drawWindows();
  }

  let editWindows = false, winDrag = null;

  function toggleWindows() {
    editWindows = !editWindows;
    $('windows-btn').classList.toggle('on', editWindows);
    $('stage-overlay').hidden = !editWindows;
    if (editWindows) {
      if (A.prj.options.layout !== 'stage') {
        A.setOption('layout', 'stage');
        if (activeTab === 'stage') renderTab();
      }
      A.status('Drag a window to move it. Drag its corner to resize. Reset this track puts it back.');
      A.requestRender();
      requestAnimationFrame(() => { fitStage(); drawWindows(); });
    }
  }

  function windowRects() {
    const list = A.scene.windowRects || [];
    return list.map(w => {
      const cfg = A.prj.tracks[w.ti];
      return { ti: w.ti, rect: cfg.win || w.rect, cfg };
    });
  }

  function drawWindows() {
    const c = $('stage-overlay');
    c.width = c.clientWidth;
    c.height = c.clientHeight;
    const g = c.getContext('2d'), W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    g.font = '600 12px system-ui';
    g.textBaseline = 'top';
    for (const win of windowRects()) {
      const [x, y, w, h] = win.rect;
      const color = U.COLORS[win.ti % U.COLORS.length];
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.strokeRect(x * W + 1, y * H + 1, w * W - 2, h * H - 2);
      g.fillStyle = 'rgba(0,0,0,.65)';
      const label = win.cfg.name;
      g.fillRect(x * W + 2, y * H + 2, g.measureText(label).width + 8, 17);
      g.fillStyle = color;
      g.fillText(label, x * W + 6, y * H + 4);
      g.fillRect((x + w) * W - 12, (y + h) * H - 12, 12, 12);
    }
  }

  function windowPointer() {
    const c = $('stage-overlay');
    const pos = e => {
      const r = c.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, r];
    };
    c.addEventListener('pointerdown', e => {
      const [px, py, r] = pos(e);
      const list = windowRects();
      for (let i = list.length - 1; i >= 0; i--) {
        const win = list[i], [x, y, w, h] = win.rect;
        const handleX = 14 / r.width, handleY = 14 / r.height;
        if (px >= x + w - handleX && px <= x + w && py >= y + h - handleY && py <= y + h) {
          winDrag = { win, mode: 'size', px, py, rect: [...win.rect] };
          break;
        }
        if (px >= x && px <= x + w && py >= y && py <= y + h) {
          winDrag = { win, mode: 'move', px, py, rect: [...win.rect] };
          break;
        }
      }
      if (winDrag) {
        c.setPointerCapture(e.pointerId);
        A.selectedTrack = winDrag.win.ti;
      }
    });
    c.addEventListener('pointermove', e => {
      if (!winDrag) return;
      const [px, py] = pos(e);
      const dx = px - winDrag.px, dy = py - winDrag.py, [x, y, w, h] = winDrag.rect;
      winDrag.win.cfg.win = winDrag.mode === 'move'
        ? [U.clamp(x + dx, -w * .5, 1 - w * .5), U.clamp(y + dy, -h * .5, 1 - h * .5), w, h]
        : [x, y, U.clamp(w + dx, .05, 1.5), U.clamp(h + dy, .05, 1.5)];
      drawWindows();
      A.requestRender();
    });
    c.addEventListener('pointerup', () => { winDrag = null; });
  }

  /* ---------- Page wiring ---------- */
  function wireDrop(zoneId, inputId, handler, multiple) {
    const zone = $(zoneId), input = $(inputId);
    input.addEventListener('change', guard(async () => {
      if (input.files.length) await handler(multiple ? input.files : input.files[0]);
      input.value = '';
    }));
    for (const type of ['dragenter', 'dragover']) zone.addEventListener(type, e => { e.preventDefault(); zone.classList.add('over'); });
    for (const type of ['dragleave', 'drop']) zone.addEventListener(type, e => { e.preventDefault(); zone.classList.remove('over'); });
    zone.addEventListener('drop', guard(e => {
      const files = e.dataTransfer.files;
      if (files.length) return handler(multiple ? files : files[0]);
      return null;
    }));
  }

  /* Dropping anywhere: work out what each file is. */
  function wirePageDrop() {
    window.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
    window.addEventListener('drop', guard(async e => {
      if (e.defaultPrevented || !e.dataTransfer?.files?.length) return;
      e.preventDefault();
      const clips = [];
      for (const f of e.dataTransfer.files) {
        if (/\.midi?$/i.test(f.name)) await A.loadMidi(f);
        else if (/\.json$|\.ytpmv$/i.test(f.name)) await openProject(f);
        else clips.push(f);
      }
      if (clips.length) await A.addClips(clips);
    }));
  }

  async function openProject(file) {
    const data = JSON.parse(await file.text());
    const info = A.load(data);
    $('look-select').value = A.lookKey;
    const need = [...info.needClips, info.needSong].filter(Boolean);
    A.status(need.length ? `Project opened. Add these files back: ${need.join(', ')}.` : 'Project opened.');
  }

  async function loadDemo() {
    await YT.demo.load();
    renderTab();
    renderClips();
    YT.phrasesUI.render();
    renderSong();
    A.status('Demo loaded. Press play. The robot says MR, then BEAST, stretching on the long notes.');
  }

  function wire() {
    wireDrop('midi-drop', 'midi-input', f => A.loadMidi(f));
    wireDrop('song-drop', 'song-input', f => A.loadSong(f));
    wireDrop('clip-drop', 'clip-input', f => A.addClips(f), true);
    wirePageDrop();

    $('align-btn').addEventListener('click', () => align(false));
    $('align-tempo-btn').addEventListener('click', () => align(true));
    $('song-remove').addEventListener('click', () => A.removeSong());

    $('play-btn').addEventListener('click', guard(() => (A.playing ? A.pause() : A.play())));
    $('stop-btn').addEventListener('click', () => A.stop());
    $('loop-check').addEventListener('change', e => { A.loop = e.target.checked; });
    $('seek').addEventListener('input', e => A.seek(+e.target.value / 1000 * A.plan.duration));
    $('windows-btn').addEventListener('click', toggleWindows);
    $('full-btn').addEventListener('click', guard(() => (document.fullscreenElement ? document.exitFullscreen() : $('stage-wrap').requestFullscreen())));
    document.addEventListener('fullscreenchange', fitStage);

    $('demo-btn').addEventListener('click', guard(loadDemo));
    $('demo-btn-2').addEventListener('click', guard(loadDemo));
    $('look-select').addEventListener('change', e => { A.applyLook(e.target.value); renderTab(); });
    $('look-random').addEventListener('click', guard(randomLook));
    $('opt-search').addEventListener('input', U.debounce(renderTab, 120));
    $('export-cancel').addEventListener('click', () => { exportCancelled = true; });

    $('save-btn').addEventListener('click', () => {
      U.download(new Blob([JSON.stringify(A.serialize())], { type: 'application/json' }), `${U.safeName(A.prj.midiName || 'project')}.ytpmv.json`);
      A.status('Project saved. Media files are not included, so keep them nearby to add back.');
    });
    $('open-btn').addEventListener('click', () => $('open-input').click());
    $('open-input').addEventListener('change', guard(async e => {
      if (e.target.files[0]) await openProject(e.target.files[0]);
      e.target.value = '';
    }));

    document.addEventListener('keydown', guard(async e => {
      if ($('workshop').open) return;
      const typing = /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox';
      if (typing) return;
      if (e.code === 'Space' && !/BUTTON/.test(e.target.tagName)) {
        e.preventDefault();
        if (A.playing) A.pause(); else await A.play();
      }
      if (e.code === 'Home') A.seek(0);
    }));

    A.on('transport', () => {
      const btn = $('play-btn');
      btn.textContent = A.playing ? '❚❚' : '▶';
      btn.setAttribute('aria-label', A.playing ? 'Pause' : 'Play');
    });
    A.on('tick', t => {
      $('time').textContent = `${U.fmtTime(t)} / ${U.fmtTime(A.plan.duration)}`;
      if (document.activeElement !== $('seek')) $('seek').value = t / A.plan.duration * 1000;
    });
    A.on('plan', () => {
      $('time').textContent = `${U.fmtTime(A.currentTime())} / ${U.fmtTime(A.plan.duration)}`;
      updateEmpty();
      if (!$('stage-overlay').hidden) requestAnimationFrame(drawWindows);
    });
    A.on('midi', () => { renderSong(); renderTab(); });
    A.on('song', renderSong);
    A.on('clips', () => { renderClips(); YT.phrasesUI.render(); if (activeTab === 'tracks') renderTab(); });
    A.on('words', () => { renderClips(); YT.phrasesUI.render(); if (activeTab === 'tracks') renderTab(); });
    A.on('phrases', () => { YT.phrasesUI.render(); if (activeTab === 'tracks') renderTab(); });
    A.on('phrases-edited', () => { if (activeTab === 'tracks') renderTab(); });
    A.on('options-external', renderTab);
    A.on('options-external-soft', () => { if (activeTab === 'mix') refreshValue('midiShift'); });
    A.on('both-loaded', () => {
      if (A.prj.options.midiShift === 0) A.status('MIDI and MP3 are both in. Press Auto-sync to line them up.');
    });
    A.on('stage-size', () => requestAnimationFrame(fitStage));
    new ResizeObserver(fitStage).observe($('stage-wrap'));
    windowPointer();
  }

  function refreshValue(id) {
    const row = $('tab-body').querySelector(`[data-id="${id}"]`);
    if (!row) return;
    const meta = O.globalById[id], input = row.querySelector('input');
    if (input) input.value = A.prj.options[id];
    const val = row.querySelector('.val');
    if (val && meta) val.textContent = YT.forms.fmt(meta, A.prj.options[id]);
  }

  /* ---------- Start ---------- */
  function start() {
    $('opt-search').placeholder = `Search all ${O.count} settings…`;
    A.init($('stage'));
    YT.timeline.init();
    wire();
    renderTabs();
    renderTab();
    renderLooks();
    renderSong();
    renderClips();
    YT.phrasesUI.render();
    fitStage();
    A.requestRender();
  }

  YT.ui = { renderTab, renderClips, renderSong };
  start();
})(window.YT);
