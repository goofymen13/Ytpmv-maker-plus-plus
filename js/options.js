/* Every setting in the app is declared here. The UI, search, presets and project files are all
   generated from this table, so an option only has to be described once.
   scope: 'compile' re-renders voices, 'audio' updates the live mixer, default is visual-only. */
(function (YT) {
  'use strict';
  const R = (id, label, def, min, max, step, extra) => ({ id, label, type: 'range', def, min, max, step, ...extra });
  const S = (id, label, def, choices, extra) => ({ id, label, type: 'select', def, choices, ...extra });
  const C = (id, label, def, extra) => ({ id, label, type: 'check', def, ...extra });
  const K = (id, label, def, extra) => ({ id, label, type: 'color', def, ...extra });
  const T = (id, label, def, extra) => ({ id, label, type: 'text', def, ...extra });
  const compile = { scope: 'compile' }, audio = { scope: 'audio' };

  const BLENDS = [['source-over', 'Normal'], ['screen', 'Screen'], ['lighter', 'Add'], ['multiply', 'Multiply'], ['overlay', 'Overlay'], ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['hard-light', 'Hard light'], ['color-dodge', 'Dodge'], ['hue', 'Hue'], ['luminosity', 'Luminosity']];
  const FONTS = [['Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif', 'Impact (meme)'], ['"Arial Black", Arial, sans-serif', 'Arial Black'], ['"Comic Sans MS", "Comic Sans", cursive', 'Comic Sans'], ['"Times New Roman", Times, serif', 'Times'], ['"Courier New", monospace', 'Courier'], ['Georgia, serif', 'Georgia'], ['Verdana, sans-serif', 'Verdana'], ['"Trebuchet MS", sans-serif', 'Trebuchet'], ['system-ui, sans-serif', 'System']];
  const SYNC = [['1/4', '1/4 note'], ['1/8', '1/8 note'], ['1/8d', 'Dotted 1/8'], ['1/8t', '1/8 triplet'], ['1/16', '1/16 note'], ['1/16t', '1/16 triplet'], ['1/32', '1/32 note']];

  /* ---------- Global settings, grouped by the tab they appear in ---------- */
  const GLOBAL = [
    { tab: 'stage', group: 'Layout', open: true, items: [
      S('layout', 'Screen layout', 'stage', [
        ['stage', 'Stage: each track gets a window'],
        ['full', 'Fullscreen: newest note takes the screen'],
        ['chord', 'Chord split: screen divides per note'],
        ['side', 'Ping-pong: left / right per hit'],
        ['pitchgrid', 'Pitch grid: every pitch has a cell'],
        ['grid', 'Shuffle grid: random free cell'],
        ['popup', 'Pop-ups: windows appear anywhere'],
        ['keyboard', 'Keyboard: left = low, right = high'],
        ['scroll', 'Scroller: clips slide across'],
        ['roll', 'Piano roll made of video'],
        ['orbit', 'Orbit: clips circle the centre'],
        ['spiral', 'Spiral: nested shrinking clips'],
        ['cascade', 'Cascade: stacked diagonal windows'],
        ['stack', 'Layered: all fullscreen, blended'],
        ['wall', 'Tile wall: mirrored repeating wall']
      ]),
      S('arrange', 'Stage arrangement', 'lead', [['lead', 'Lead big, others beside it'], ['leadTop', 'Lead big, others below'], ['corners', 'Lead centre, others in corners'], ['grid', 'Even grid'], ['columns', 'Columns'], ['rows', 'Rows']], { help: 'Used by the Stage layout. Drag windows on the preview for a custom spot.' }),
      S('chordStyle', 'Chords inside a window', 'split', [['split', 'Split the window'], ['stack', 'Overlap with offset'], ['top', 'Show top note only'], ['bottom', 'Show bottom note only']]),
      R('gap', 'Gap between clips', .6, 0, 8, .1, { unit: '%' }),
      R('margin', 'Screen margin', 0, 0, 15, .5, { unit: '%' }),
      R('maxTiles', 'Max clips on screen', 24, 1, 64, 1),
      R('gridCols', 'Grid columns', 4, 1, 12, 1),
      R('gridRows', 'Grid rows', 4, 1, 12, 1),
      R('popupSize', 'Pop-up size', 42, 10, 100, 1, { unit: '%' }),
      R('popupVar', 'Pop-up size variation', 40, 0, 100, 1, { unit: '%' }),
      R('popupRot', 'Pop-up tilt', 8, 0, 45, 1, { unit: '°' }),
      R('wallCols', 'Wall columns', 3, 1, 12, 1),
      R('wallRows', 'Wall rows', 3, 1, 12, 1),
      R('wallDelay', 'Wall ripple delay', 40, 0, 400, 5, { unit: 'ms' }),
      C('wallFlip', 'Wall mirrors alternate tiles', true),
      R('orbitRadius', 'Orbit radius', 34, 5, 60, 1, { unit: '%' }),
      R('orbitSpin', 'Orbit spin', 12, -120, 120, 1, { unit: '°/beat' }),
      R('orbitSize', 'Orbit clip size', 30, 8, 70, 1, { unit: '%' }),
      R('scrollSpeed', 'Scroll speed', 30, 5, 120, 1, { unit: '%/s' }),
      R('scrollPlayhead', 'Scroll hit line', 30, 0, 100, 1, { unit: '%' }),
      S('stackBlend', 'Layered blend mode', 'screen', BLENDS),
      R('stackAlpha', 'Layered opacity', 75, 5, 100, 1, { unit: '%' })
    ] },
    { tab: 'stage', group: 'Background', items: [
      S('bgType', 'Background', 'blur', [['solid', 'Solid colour'], ['gradient', 'Gradient'], ['blur', 'Blurred clip fill'], ['checker', 'Scrolling checkers'], ['stripes', 'Moving stripes'], ['tunnel', 'Tunnel rings'], ['rays', 'Sun rays'], ['stars', 'Starfield'], ['image', 'Your image']]),
      K('bgColorA', 'Colour A', '#07070c'),
      K('bgColorB', 'Colour B', '#2a0a3a'),
      R('bgPulse', 'Pulse on beat', 30, 0, 100, 1, { unit: '%' }),
      R('bgHueBeat', 'Hue step each beat', 0, 0, 180, 1, { unit: '°' }),
      R('bgSpeed', 'Motion speed', 40, 0, 200, 1, { unit: '%' }),
      R('bgBlur', 'Fill blur', 26, 0, 80, 1, { unit: 'px' }),
      R('bgDim', 'Fill darkening', 62, 0, 100, 1, { unit: '%' })
    ] },
    { tab: 'stage', group: 'Camera', items: [
      R('camBeat', 'Zoom bump on beat', 2, 0, 30, .5, { unit: '%' }),
      R('camKick', 'Zoom bump on kick', 3, 0, 30, .5, { unit: '%' }),
      R('camSnare', 'Shake on snare', 0, 0, 100, 1, { unit: '%' }),
      R('camBarRot', 'Tilt alternates each bar', 0, 0, 20, .5, { unit: '°' }),
      C('camBarFlip', 'Mirror whole screen each bar', false),
      R('camZoom', 'Slow zoom drift', 0, 0, 30, .5, { unit: '%' }),
      R('camSway', 'Slow sway', 0, 0, 15, .5, { unit: '°' }),
      R('camSpin', 'Constant spin', 0, -90, 90, 1, { unit: '°/s' })
    ] },
    { tab: 'stage', group: 'Screen flashes', items: [
      R('flashBeat', 'Flash on beat', 0, 0, 100, 1, { unit: '%' }),
      R('flashBar', 'Flash on bar', 0, 0, 100, 1, { unit: '%' }),
      R('flashKick', 'Flash on kick', 0, 0, 100, 1, { unit: '%' }),
      R('flashSnare', 'Flash on snare', 0, 0, 100, 1, { unit: '%' }),
      K('flashColor', 'Flash colour', '#ffffff')
    ] },
    { tab: 'stage', group: 'Word captions', items: [
      S('capMode', 'Captions', 'off', [['off', 'Off'], ['word', 'Big centre word'], ['tile', 'On each clip'], ['line', 'Karaoke phrase line']]),
      S('capFont', 'Font', FONTS[0][0], FONTS),
      R('capSize', 'Size', 11, 2, 40, .5, { unit: '%' }),
      S('capPos', 'Position', 'bottom', [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']]),
      K('capColor', 'Text colour', '#ffffff'),
      K('capStroke', 'Outline colour', '#000000'),
      R('capStrokeW', 'Outline width', 14, 0, 40, 1, { unit: '%' }),
      S('capAnim', 'Hit animation', 'pop', [['none', 'None'], ['pop', 'Pop'], ['shake', 'Shake'], ['drop', 'Drop in']]),
      C('capUpper', 'ALL CAPS', true),
      C('capTrackColor', 'Use track colour', false)
    ] },
    { tab: 'stage', group: 'Overlays', items: [
      C('ovRoll', 'Piano roll strip', false),
      R('ovRollH', 'Piano roll height', 14, 4, 50, 1, { unit: '%' }),
      R('ovRollAlpha', 'Piano roll opacity', 70, 5, 100, 1, { unit: '%' }),
      S('ovSpectrum', 'Spectrum bars', 'off', [['off', 'Off'], ['bottom', 'Bottom'], ['top', 'Top'], ['mirror', 'Top and bottom'], ['ring', 'Ring']]),
      R('ovSpecH', 'Spectrum height', 18, 2, 60, 1, { unit: '%' }),
      R('ovSpecAlpha', 'Spectrum opacity', 75, 5, 100, 1, { unit: '%' }),
      K('ovSpecColor', 'Spectrum colour', '#3ddcff'),
      S('ovParticles', 'Hit particles', 'off', [['off', 'Off'], ['sparks', 'Sparks'], ['confetti', 'Confetti'], ['rings', 'Shock rings'], ['notes', 'Music notes']]),
      R('ovPartCount', 'Particles per hit', 10, 1, 60, 1),
      R('ovPartSize', 'Particle size', 100, 20, 400, 5, { unit: '%' }),
      C('ovProgress', 'Progress bar', false),
      C('ovOsd', 'VHS on-screen display', false),
      C('ovTrackLabels', 'Track name labels', false),
      C('ovNoteLabels', 'Note name labels', false),
      T('ovWatermark', 'Watermark text', ''),
      S('ovWatermarkPos', 'Watermark position', 'br', [['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']]),
      R('ovWatermarkAlpha', 'Watermark opacity', 60, 5, 100, 1, { unit: '%' })
    ] },
    { tab: 'stage', group: 'Title and end cards', items: [
      T('titleText', 'Title', ''),
      T('titleSub', 'Subtitle', ''),
      R('titleDur', 'Title on screen', 3, .5, 15, .1, { unit: 's' }),
      S('titleStyle', 'Title style', 'center', [['center', 'Centre, faded'], ['lower', 'Lower third'], ['block', 'Solid block']]),
      T('endText', 'End card text', ''),
      R('endDur', 'End card on screen', 3, .5, 15, .1, { unit: 's' })
    ] },

    { tab: 'fx', group: 'What drives the “on hit” sliders', open: true, items: [
      S('fxSource', 'Reacts to', 'notes', [['notes', 'Any note'], ['lead', 'Lead track'], ['bass', 'Bass track'], ['kick', 'Kick'], ['snare', 'Snare'], ['beat', 'Beat'], ['bar', 'Bar'], ['song', 'Backing track level']])
    ] },
    { tab: 'fx', group: 'Colour', open: true, items: [
      R('fxHue', 'Hue shift', 0, -180, 180, 1, { unit: '°' }),
      R('fxHueHit', 'Hue shift on hit', 0, 0, 180, 1, { unit: '°' }),
      R('fxHueSpin', 'Hue cycling', 0, 0, 360, 1, { unit: '°/s' }),
      R('fxSat', 'Saturation', 100, 0, 300, 1, { unit: '%' }),
      R('fxContrast', 'Contrast', 100, 30, 300, 1, { unit: '%' }),
      R('fxBright', 'Brightness', 100, 20, 250, 1, { unit: '%' }),
      R('fxPosterize', 'Posterize', 0, 0, 100, 1, { unit: '%' }),
      R('fxInvert', 'Invert', 0, 0, 100, 1, { unit: '%' }),
      R('fxInvertHit', 'Invert on hit', 0, 0, 100, 1, { unit: '%' }),
      R('fxDuo', 'Duotone', 0, 0, 100, 1, { unit: '%' }),
      K('fxDuoA', 'Duotone shadow', '#14062e'),
      K('fxDuoB', 'Duotone light', '#ff4d7d'),
      R('fxDither', '1-bit dither', 0, 0, 100, 1, { unit: '%' }),
      R('fxSharpen', 'Sharpen', 0, 0, 300, 1, { unit: '%' }),
      R('fxEdge', 'Edge outlines', 0, 0, 100, 1, { unit: '%' })
    ] },
    { tab: 'fx', group: 'Glitch and warp', items: [
      R('fxRgb', 'RGB split', 0, 0, 40, .5, { unit: 'px' }),
      R('fxRgbHit', 'RGB split on hit', 0, 0, 60, .5, { unit: 'px' }),
      R('fxGlitch', 'Block glitch', 0, 0, 100, 1, { unit: '%' }),
      R('fxGlitchHit', 'Block glitch on hit', 0, 0, 100, 1, { unit: '%' }),
      R('fxPixel', 'Pixelate', 0, 0, 64, 1, { unit: 'px' }),
      R('fxPixelHit', 'Pixelate on hit', 0, 0, 64, 1, { unit: 'px' }),
      R('fxWave', 'Wave warp', 0, 0, 100, 1, { unit: '%' }),
      R('fxWaveHit', 'Wave warp on hit', 0, 0, 100, 1, { unit: '%' }),
      R('fxSwirl', 'Swirl', 0, -100, 100, 1, { unit: '%' }),
      R('fxSwirlHit', 'Swirl on hit', 0, 0, 100, 1, { unit: '%' }),
      R('fxBulge', 'Bulge', 0, -100, 100, 1, { unit: '%' }),
      R('fxBulgeHit', 'Bulge on hit', 0, 0, 100, 1, { unit: '%' })
    ] },
    { tab: 'fx', group: 'Mirrors', items: [
      C('fxMirrorX', 'Mirror left to right', false),
      C('fxMirrorY', 'Mirror top to bottom', false),
      R('fxKaleido', 'Kaleidoscope segments', 0, 0, 16, 1),
      R('fxKaleidoSpin', 'Kaleidoscope spin', 0, -180, 180, 1, { unit: '°/s' })
    ] },
    { tab: 'fx', group: 'Light', items: [
      R('fxBloom', 'Bloom', 0, 0, 200, 1, { unit: '%' }),
      R('fxBloomHit', 'Bloom on hit', 0, 0, 200, 1, { unit: '%' }),
      R('fxZoomBlur', 'Zoom blur', 0, 0, 100, 1, { unit: '%' }),
      R('fxZoomBlurHit', 'Zoom blur on hit', 0, 0, 100, 1, { unit: '%' }),
      R('fxVignette', 'Vignette', 0, 0, 100, 1, { unit: '%' })
    ] },
    { tab: 'fx', group: 'Video trails', items: [
      R('fxTrail', 'Feedback trails', 0, 0, 98, 1, { unit: '%' }),
      R('fxTrailZoom', 'Trail zoom', 1, -10, 10, .1, { unit: '%' }),
      R('fxTrailRot', 'Trail rotate', 0, -10, 10, .1, { unit: '°' })
    ] },
    { tab: 'fx', group: 'Old TV', items: [
      R('fxScan', 'Scanlines', 0, 0, 100, 1, { unit: '%' }),
      R('fxCrt', 'CRT curve', 0, 0, 100, 1, { unit: '%' }),
      R('fxVhs', 'VHS tracking', 0, 0, 100, 1, { unit: '%' }),
      R('fxGrain', 'Film grain', 0, 0, 100, 1, { unit: '%' })
    ] },

    { tab: 'mix', group: 'Levels', open: true, items: [
      R('songVol', 'Backing track (MP3)', 80, 0, 150, 1, { unit: '%', ...audio }),
      R('sampleVol', 'Clips', 100, 0, 250, 1, { unit: '%', ...audio }),
      R('masterVol', 'Master', 90, 0, 150, 1, { unit: '%', ...audio }),
      C('autoLevel', 'Even out word loudness', true, compile),
      R('maxVoices', 'Max clip voices at once', 96, 4, 256, 1, compile)
    ] },
    { tab: 'mix', group: 'Syncing the MP3 to the MIDI', open: true, items: [
      R('midiShift', 'MIDI start offset', 0, -120, 120, .001, { unit: 's', ...compile, help: 'Positive starts the MIDI later than the MP3. Also set by dragging the MP3 in the timeline.' }),
      R('midiScale', 'MIDI tempo stretch', 100, 80, 125, .01, { unit: '%', ...compile, help: 'For a MIDI that drifts against the MP3. Above 100 makes the MIDI slower.' }),
      R('songTrim', 'Skip start of MP3', 0, 0, 600, .01, { unit: 's', ...compile }),
      S('endMode', 'Video ends with', 'longest', [['longest', 'Whichever is longer'], ['midi', 'The MIDI'], ['song', 'The MP3']], compile)
    ] },
    { tab: 'mix', group: 'Whole-song speed and key', items: [
      R('songSpeed', 'Song speed', 100, 25, 200, 1, { unit: '%', ...compile }),
      C('speedPitch', 'Clips follow the sped-up pitch', true, { ...compile, help: 'Speed also changes the MP3’s pitch, like a tape. Keep this on so clips stay in key with it.' }),
      R('globalTranspose', 'Transpose all notes', 0, -24, 24, 1, { unit: 'st', ...compile }),
      R('globalFine', 'Fine tune all notes', 0, -100, 100, 1, { unit: 'ct', ...compile })
    ] },
    { tab: 'mix', group: 'Backing track shaping', items: [
      R('songFadeIn', 'Fade in', 0, 0, 15, .1, { unit: 's', ...audio }),
      R('songFadeOut', 'Fade out', 0, 0, 15, .1, { unit: 's', ...audio }),
      R('songHP', 'Low cut', 20, 20, 2000, 5, { unit: 'Hz', ...audio }),
      R('songLP', 'High cut', 20000, 500, 20000, 50, { unit: 'Hz', ...audio }),
      R('vocalCut', 'Vocal remover (centre cut)', 0, 0, 100, 1, { unit: '%', ...audio, help: 'Removes what is panned dead centre, so clips can take over the lead. Works best on older stereo mixes.' }),
      R('duckAmount', 'Duck MP3 when clips hit', 0, 0, 100, 1, { unit: '%', ...compile, help: 'Sidechain: lowers the MP3 under tracks with “Ducks the MP3” on.' }),
      R('duckRelease', 'Duck release', 180, 20, 1000, 10, { unit: 'ms', ...compile })
    ] },
    { tab: 'mix', group: 'Master bus', items: [
      C('limiter', 'Limiter', true, audio),
      R('masterDrive', 'Saturation', 0, 0, 100, 1, { unit: '%', ...audio }),
      R('eqLow', 'Low EQ', 0, -18, 18, .5, { unit: 'dB', ...audio }),
      R('eqMid', 'Mid EQ', 0, -18, 18, .5, { unit: 'dB', ...audio }),
      R('eqHigh', 'High EQ', 0, -18, 18, .5, { unit: 'dB', ...audio })
    ] },
    { tab: 'mix', group: 'Reverb and delay returns', items: [
      R('reverbSize', 'Reverb size', 1.6, .1, 8, .1, { unit: 's', ...audio }),
      R('reverbDamp', 'Reverb darkness', 40, 0, 100, 1, { unit: '%', ...audio }),
      R('reverbReturn', 'Reverb level', 100, 0, 200, 1, { unit: '%', ...audio }),
      S('delayTime', 'Delay time', '1/8d', SYNC, audio),
      R('delayFeedback', 'Delay feedback', 35, 0, 92, 1, { unit: '%', ...audio }),
      R('delayTone', 'Delay tone', 4500, 300, 16000, 100, { unit: 'Hz', ...audio }),
      R('delayReturn', 'Delay level', 100, 0, 200, 1, { unit: '%', ...audio })
    ] },
    { tab: 'mix', group: 'Quality', items: [
      S('previewRes', 'Preview resolution', '1280', [['640', 'Low (fast)'], ['960', 'Medium'], ['1280', 'High'], ['1920', 'Full HD']]),
      S('aspect', 'Aspect ratio', '16:9', [['16:9', '16:9 widescreen'], ['4:3', '4:3 classic'], ['1:1', '1:1 square'], ['9:16', '9:16 vertical'], ['21:9', '21:9 cinema']]),
      S('frameHeight', 'Video frame quality', '480', [['240', '240p (lightest)'], ['360', '360p'], ['480', '480p'], ['720', '720p'], ['1080', '1080p (heaviest)']], { scope: 'frames', help: 'Clip frames are decoded ahead of time so cuts are instant. Higher quality uses more memory.' }),
      S('frameFps', 'Video frame rate', '30', [['15', '15 fps'], ['24', '24 fps'], ['30', '30 fps'], ['60', '60 fps (heavy)']], { scope: 'frames' })
    ] }
  ];

  /* ---------- Per-track settings ---------- */
  const TRACK = [
    { group: 'Word stretch', open: true, items: [
      S('stretch', 'How clips fit a note', 'smart', [
        ['smart', 'Word stretch: consonants natural, vowel holds (MRRRRR)'],
        ['uniform', 'Even stretch: whole word slows to fit'],
        ['natural', 'Natural speed: tune it, cut at note end'],
        ['tape', 'Old sampler: speed = pitch, cut at note end'],
        ['tapeLoop', 'Old sampler: loop vowel to fill note'],
        ['tapePing', 'Old sampler: ping-pong vowel to fill note'],
        ['oneshot', 'Old sampler: whole word, ignore note length']
      ], compile),
      S('engine', 'Stretch engine', 'auto', [['auto', 'Auto (voice vs other sounds)'], ['psola', 'Voice engine (PSOLA)'], ['wsola', 'General engine (WSOLA)'], ['granular', 'Granular cloud']], { ...compile, help: 'Voice engine sings in tune and keeps a human timbre. General engine works on anything.' }),
      S('holdMode', 'Long-note vowel', 'stretch', [['stretch', 'Smooth slow-motion'], ['freeze', 'Frozen buzz (robot)']], compile),
      S('shortNote', 'Short notes', 'compress', [['compress', 'Speed the word up to fit'], ['cut', 'Natural speed, cut off']], compile),
      R('maxSpeed', 'Fastest word speed', 200, 100, 500, 5, { unit: '%', ...compile }),
      C('keepTail', 'Finish the word at note end', true, { ...compile, help: 'On: “beeeeast”. Off: “beeeee” and cut.' }),
      R('preUtter', 'Land the vowel on the beat', 60, 0, 100, 1, { unit: '%', ...compile, help: 'Starts the consonant slightly before the note, the way singers do, so the word feels on time. 0 starts the word exactly on the note.' }),
      R('follow', 'Chipmunk amount', 30, 0, 100, 1, { unit: '%', ...compile, help: '0 keeps a human timbre at any pitch. 100 is the classic sped-up sampler sound. Voice engine only.' }),
      R('flatten', 'Pitch lock', 100, 0, 100, 1, { unit: '%', ...compile, help: '100 sings dead on the note. Lower keeps the speaker’s natural melody. Voice engine only.' }),
      R('grainMs', 'Grain size', 30, 8, 120, 1, { unit: 'ms', ...compile })
    ] },
    { group: 'Word order', open: true, items: [
      S('order', 'Next word comes on', 'next', [
        ['next', 'Each new note: in order'],
        ['fit', 'Every note says the whole phrase'],
        ['note', 'Each note, even within a chord'],
        ['pitch', 'Different pitch = different word'],
        ['beat', 'Beat of the bar picks the word'],
        ['velocity', 'Harder notes = later words'],
        ['pingpong', 'Each new note: forward then back'],
        ['random', 'Random (repeatable)'],
        ['shuffle', 'Shuffled, no repeats until all used']
      ], compile),
      R('restartRest', 'Restart phrase after a rest of', 1, 0, 16, .25, { unit: 'beats', ...compile, help: 'So every line starts on its first word. 0 turns this off.' }),
      R('restartBars', 'Restart phrase every', 0, 0, 32, 1, { unit: 'bars', ...compile }),
      R('stepRepeat', 'Say each word this many times', 1, 1, 16, 1, compile),
      R('startStep', 'Start on word number', 1, 1, 32, 1, compile)
    ] },
    { group: 'Pitch', items: [
      C('pitched', 'Tune to the notes', true, compile),
      C('autoOctave', 'Move part into the clip’s vocal range', true, { ...compile, help: 'Shifts the whole part by octaves so a voice is not forced two octaves above itself, which sounds thin. The melody stays intact.' }),
      R('transpose', 'Transpose', 0, -48, 48, 1, { unit: 'st', ...compile }),
      R('fine', 'Fine tune', 0, -100, 100, 1, { unit: 'ct', ...compile }),
      R('maxShift', 'Fold octaves beyond', 30, 6, 72, 1, { unit: 'st', ...compile, help: 'Keeps extreme notes singable by moving them whole octaves toward the clip’s pitch.' }),
      C('useBend', 'Follow MIDI pitch bends', true, compile),
      R('glide', 'Glide between notes', 0, 0, 500, 5, { unit: 'ms', ...compile }),
      R('scoop', 'Scoop up into notes', 0, 0, 12, .5, { unit: 'st', ...compile }),
      R('fall', 'Fall off at note end', 0, 0, 12, .5, { unit: 'st', ...compile }),
      R('vibDepth', 'Vibrato depth', 0, 0, 200, 1, { unit: 'ct', ...compile }),
      R('vibRate', 'Vibrato speed', 5.5, .5, 14, .1, { unit: 'Hz', ...compile }),
      R('vibDelay', 'Vibrato delay', 250, 0, 2000, 10, { unit: 'ms', ...compile })
    ] },
    { group: 'Note length and envelope', items: [
      R('gate', 'Note length', 100, 10, 300, 1, { unit: '%', ...compile }),
      R('minLen', 'Shortest note', 30, 5, 1000, 5, { unit: 'ms', ...compile }),
      R('maxLen', 'Longest note', 30, .1, 30, .1, { unit: 's', ...compile }),
      C('legato', 'Stretch notes to meet the next', false, compile),
      C('mono', 'New note cuts the last one', false, compile),
      R('attack', 'Attack', 2, 0, 400, 1, { unit: 'ms', ...compile }),
      R('decay', 'Decay', 0, 0, 2000, 5, { unit: 'ms', ...compile }),
      R('sustain', 'Sustain level', 100, 0, 100, 1, { unit: '%', ...compile }),
      R('release', 'Release', 12, 0, 1500, 1, { unit: 'ms', ...compile })
    ] },
    { group: 'Note filter and chops', items: [
      S('chordPick', 'Chord notes used', 'all', [['all', 'All notes'], ['top', 'Top note only'], ['bottom', 'Bottom note only']], compile),
      R('chordMax', 'Max notes in a chord', 12, 1, 12, 1, compile),
      R('strum', 'Strum chords', 0, 0, 200, 1, { unit: 'ms', ...compile }),
      S('retrig', 'Stutter long notes', 'off', [['off', 'Off'], ...SYNC], compile),
      R('retrigDecay', 'Stutter fade', 0, 0, 100, 1, { unit: '%', ...compile }),
      R('pitchMin', 'Lowest pitch played', 0, 0, 127, 1, compile),
      R('pitchMax', 'Highest pitch played', 127, 0, 127, 1, compile),
      R('velMin', 'Skip notes softer than', 0, 0, 127, 1, compile),
      R('skipEvery', 'Skip every Nth note', 0, 0, 16, 1, compile),
      R('humanT', 'Loose timing', 0, 0, 60, 1, { unit: 'ms', ...compile }),
      R('humanV', 'Loose velocity', 0, 0, 50, 1, { unit: '%', ...compile })
    ] },
    { group: 'Mixer', items: [
      R('vol', 'Volume', 90, 0, 200, 1, { unit: '%', ...audio }),
      R('pan', 'Pan', 0, -100, 100, 1, audio),
      S('panMode', 'Auto pan', 'fixed', [['fixed', 'Fixed'], ['alternate', 'Alternate per hit'], ['random', 'Random'], ['pitch', 'Low left, high right']], compile),
      R('panSpread', 'Auto-pan width', 50, 0, 100, 1, { unit: '%', ...compile }),
      R('velCurve', 'Velocity sensitivity', 70, 0, 200, 1, { unit: '%', ...compile }),
      R('hp', 'Low cut', 20, 20, 3000, 5, { unit: 'Hz', ...audio }),
      R('lp', 'High cut', 20000, 300, 20000, 50, { unit: 'Hz', ...audio }),
      R('drive', 'Distortion', 0, 0, 100, 1, { unit: '%', ...compile }),
      R('bits', 'Bit crush', 16, 2, 16, 1, { unit: 'bits', ...compile }),
      R('down', 'Sample-rate crush', 1, 1, 32, 1, { unit: '×', ...compile }),
      R('reverb', 'Reverb send', 0, 0, 100, 1, { unit: '%', ...audio }),
      R('delay', 'Delay send', 0, 0, 100, 1, { unit: '%', ...audio }),
      C('duck', 'Ducks the MP3', true, compile)
    ] },
    { group: 'Clip on screen', items: [
      C('showVisual', 'Show on screen', true),
      R('layer', 'Layer (higher is in front)', 0, -8, 8, 1),
      R('tileScale', 'Size', 100, 10, 200, 1, { unit: '%' }),
      R('opacity', 'Opacity', 100, 0, 100, 1, { unit: '%' }),
      S('blend', 'Blend mode', 'source-over', BLENDS),
      S('fit', 'Fit', 'cover', [['cover', 'Fill (crop)'], ['contain', 'Fit whole picture'], ['stretch', 'Stretch']]),
      R('cropZoom', 'Crop zoom', 100, 100, 400, 1, { unit: '%' }),
      R('focusX', 'Crop focus X', 50, 0, 100, 1, { unit: '%' }),
      R('focusY', 'Crop focus Y', 50, 0, 100, 1, { unit: '%' }),
      S('shape', 'Shape', 'rect', [['rect', 'Rectangle'], ['round', 'Rounded'], ['circle', 'Circle'], ['diamond', 'Diamond'], ['hex', 'Hexagon'], ['star', 'Star'], ['heart', 'Heart']]),
      R('borderW', 'Border', 0, 0, 40, .5, { unit: 'px' }),
      C('borderTrack', 'Border uses track colour', true),
      K('borderColor', 'Border colour', '#ffffff'),
      R('glow', 'Glow on hit', 0, 0, 100, 1, { unit: 'px' }),
      S('flipMode', 'Mirror left/right', 'hit', [['none', 'Never'], ['hit', 'Every other hit'], ['word', 'Every other word'], ['random', 'Random'], ['pitch', 'Higher notes mirror'], ['always', 'Always']], compile),
      S('flipY', 'Mirror up/down', 'none', [['none', 'Never'], ['hit', 'Every other hit'], ['random', 'Random'], ['always', 'Always']], compile),
      R('rotJitter', 'Random tilt per hit', 0, 0, 45, 1, { unit: '°' }),
      R('posJitter', 'Random nudge per hit', 0, 0, 40, 1, { unit: '%' }),
      R('pitchLift', 'Higher notes rise', 0, 0, 100, 1, { unit: '%' }),
      R('velScale', 'Loud notes are bigger', 0, 0, 100, 1, { unit: '%' })
    ] },
    { group: 'Clip motion', items: [
      S('motionIn', 'Note starts with', 'punch', [['none', 'Hard cut'], ['punch', 'Punch zoom'], ['pop', 'Pop in'], ['elastic', 'Elastic'], ['squash', 'Squash and stretch'], ['bounce', 'Bounce'], ['shake', 'Shake'], ['wobble', 'Wobble'], ['slideL', 'Slide from left'], ['slideR', 'Slide from right'], ['slideU', 'Slide from top'], ['slideD', 'Slide from bottom'], ['drop', 'Drop in'], ['whip', 'Whip pan'], ['spin', 'Spin in'], ['flipX', 'Card flip'], ['flipY', 'Card tumble'], ['zoomIn', 'Zoom in from huge'], ['zoomOut', 'Grow from tiny']]),
      R('motionTime', 'Motion length', 160, 20, 1200, 10, { unit: 'ms' }),
      R('motionAmt', 'Motion strength', 100, 0, 300, 5, { unit: '%' }),
      S('motionSus', 'While the note holds', 'none', [['none', 'Stay still'], ['breathe', 'Breathe'], ['kenburns', 'Slow push-in'], ['sway', 'Sway'], ['spin', 'Slow spin'], ['jitter', 'Jitter'], ['pulse', 'Pulse with beat']]),
      R('susAmt', 'Hold motion strength', 100, 0, 300, 5, { unit: '%' }),
      S('motionOut', 'Note ends with', 'cut', [['cut', 'Hard cut'], ['fade', 'Fade'], ['shrink', 'Shrink'], ['slide', 'Slide off'], ['drop', 'Fall'], ['spin', 'Spin away'], ['flash', 'Flash out']]),
      R('outTime', 'Exit length', 120, 10, 1500, 10, { unit: 'ms' }),
      S('visHold', 'Picture stays until', 'next', [['note', 'Note ends'], ['next', 'Next note on this track'], ['fixed', 'Note end + hold time']], compile),
      R('holdTime', 'Hold time', .25, 0, 8, .05, { unit: 's', ...compile }),
      R('visMin', 'Shortest time on screen', 60, 0, 500, 5, { unit: 'ms', ...compile }),
      S('idleMode', 'Stage window when silent', 'freeze', [['freeze', 'Freeze last frame'], ['hide', 'Empty']]),
      R('idleDim', 'Dim when silent', 55, 0, 100, 1, { unit: '%' })
    ] },
    { group: 'Clip colour', items: [
      R('hueShift', 'Hue', 0, -180, 180, 1, { unit: '°' }),
      R('hueByPitch', 'Hue follows pitch', 0, 0, 100, 1, { unit: '%' }),
      R('hueByWord', 'Hue differs per word', 0, 0, 180, 1, { unit: '°' }),
      R('sat', 'Saturation', 100, 0, 300, 1, { unit: '%' }),
      R('bright', 'Brightness', 100, 0, 300, 1, { unit: '%' }),
      R('contrast', 'Contrast', 100, 0, 300, 1, { unit: '%' }),
      R('gray', 'Black and white', 0, 0, 100, 1, { unit: '%' }),
      R('sepia', 'Sepia', 0, 0, 100, 1, { unit: '%' }),
      R('blurPx', 'Blur', 0, 0, 30, .5, { unit: 'px' }),
      S('invertMode', 'Invert', 'none', [['none', 'Never'], ['hit', 'Every other hit'], ['always', 'Always']]),
      K('tint', 'Tint colour', '#ff4d7d'),
      R('tintAlpha', 'Tint amount', 0, 0, 100, 1, { unit: '%' }),
      R('hitFlash', 'White flash on hit', 0, 0, 100, 1, { unit: '%' }),
      C('showCaption', 'Show this track’s captions', true)
    ] }
  ];

  const flat = groups => groups.flatMap(g => g.items);
  const ALL_GLOBAL = flat(GLOBAL), ALL_TRACK = flat(TRACK);
  const byId = list => Object.fromEntries(list.map(o => [o.id, o]));

  YT.options = {
    GLOBAL, TRACK,
    globalById: byId(ALL_GLOBAL),
    trackById: byId(ALL_TRACK),
    defaults: () => Object.fromEntries(ALL_GLOBAL.map(o => [o.id, o.def])),
    trackDefaults: () => Object.fromEntries(ALL_TRACK.map(o => [o.id, o.def])),
    count: ALL_GLOBAL.length + ALL_TRACK.length,

    /* Starting points for detected track types. */
    ROLES: {
      lead: { label: 'Lead / melody', values: { layer: 2 } },
      bass: { label: 'Bass', values: { layer: 0, transpose: 0, follow: 15, duck: false, motionIn: 'squash', maxShift: 36 } },
      chords: { label: 'Chords', values: { layer: 1, vol: 55, motionIn: 'none', follow: 20, duck: false } },
      drums: { label: 'Drums', values: { pitched: false, stretch: 'natural', order: 'pitch', restartRest: 0, duck: false, preUtter: 0, motionIn: 'pop', motionTime: 110, flipMode: 'random', vol: 80, release: 25, visHold: 'next', layer: 1 } },
      fx: { label: 'Background / FX', values: { layer: -1, vol: 50, duck: false, opacity: 70, motionIn: 'none', visHold: 'note' } }
    },

    /* Whole-look presets. Each one starts from the defaults for every visual option,
       so switching presets never leaves stray effects behind. */
    LOOKS: {
      classic: { label: 'Classic YTPMV', global: { layout: 'stage', arrange: 'lead', bgType: 'blur', camBeat: 2, camKick: 3 }, track: { motionIn: 'punch', flipMode: 'hit', visHold: 'next', idleMode: 'freeze' } },
      full: { label: 'Fullscreen cuts', global: { layout: 'full', bgType: 'solid', camKick: 4 }, track: { motionIn: 'punch', motionTime: 120, flipMode: 'hit', visHold: 'next' } },
      chord: { label: 'Chord split', global: { layout: 'chord', bgType: 'solid', gap: 0, camBeat: 1 }, track: { motionIn: 'none', flipMode: 'hit', visHold: 'note', visMin: 80 } },
      pingpong: { label: 'Left-right ping-pong', global: { layout: 'side', bgType: 'solid', gap: 0, camKick: 2 }, track: { motionIn: 'slideL', motionTime: 90, flipMode: 'hit', visHold: 'next' } },
      pitchgrid: { label: 'Pitch grid wall', global: { layout: 'pitchgrid', gridCols: 4, gridRows: 3, bgType: 'solid', gap: 1 }, track: { motionIn: 'pop', visHold: 'note', motionOut: 'fade', outTime: 200 } },
      popups: { label: 'Pop-up chaos', global: { layout: 'popup', bgType: 'checker', bgColorA: '#1b0833', bgColorB: '#2d0f4f', camSnare: 25, flashSnare: 12 }, track: { motionIn: 'elastic', motionOut: 'shrink', visHold: 'fixed', holdTime: .4, borderW: 4, shape: 'round', rotJitter: 6 } },
      wall: { label: 'Mirror wall', global: { layout: 'wall', wallCols: 4, wallRows: 4, wallDelay: 30, bgType: 'solid', gap: 0 }, track: { visHold: 'next', motionIn: 'none' } },
      kaleido: { label: 'Kaleidoscope trip', global: { layout: 'chord', gap: 0, fxKaleido: 8, fxKaleidoSpin: 20, fxHueSpin: 40, fxBloomHit: 40, camKick: 5, bgType: 'solid' }, track: { visHold: 'next', motionIn: 'none' } },
      roll: { label: 'Video piano roll', global: { layout: 'roll', bgType: 'gradient', bgColorA: '#04060c', bgColorB: '#101a33', scrollSpeed: 26 }, track: { motionIn: 'none', visHold: 'note', shape: 'round', borderW: 1.5 } },
      scroller: { label: 'Scrolling film strip', global: { layout: 'scroll', bgType: 'stripes', bgColorA: '#0b0b12', bgColorB: '#14141f', scrollSpeed: 36 }, track: { motionIn: 'none', visHold: 'note' } },
      orbit: { label: 'Orbit', global: { layout: 'orbit', bgType: 'rays', bgColorA: '#120422', bgColorB: '#3b0f5e', camKick: 4, fxBloom: 30 }, track: { motionIn: 'pop', visHold: 'note', visMin: 120, motionOut: 'shrink', shape: 'circle', borderW: 3, glow: 24 } },
      vhs: { label: 'VHS 2007', global: { layout: 'stage', bgType: 'solid', fxVhs: 45, fxScan: 35, fxGrain: 25, fxRgb: 2, fxCrt: 18, fxSat: 80, fxVignette: 40, ovOsd: true }, track: { motionIn: 'none', flipMode: 'hit' } },
      fried: { label: 'Deep fried', global: { layout: 'stage', bgType: 'blur', fxSat: 260, fxContrast: 190, fxSharpen: 200, fxPosterize: 30, fxBloom: 60, fxGrain: 30, fxRgbHit: 14, camKick: 8, camSnare: 40, capMode: 'word' }, track: { motionIn: 'shake', flipMode: 'random' } },
      neon: { label: 'Neon club', global: { layout: 'chord', gap: 1, bgType: 'tunnel', bgColorA: '#04010f', bgColorB: '#ff2bd6', fxBloom: 28, fxBloomHit: 30, fxRgbHit: 8, fxHueHit: 25, flashKick: 12, camKick: 6, ovSpectrum: 'mirror', ovSpecColor: '#ff4de1' }, track: { glow: 40, borderW: 2, motionIn: 'pop', visHold: 'note', visMin: 90 } },
      bit: { label: '1-bit retro', global: { layout: 'stage', fxDither: 100, fxPixel: 4, bgType: 'solid', camBeat: 0, camKick: 0 }, track: { motionIn: 'none' } },
      glitch: { label: 'Datamosh glitch', global: { layout: 'full', fxGlitchHit: 60, fxRgbHit: 26, fxPixelHit: 18, fxTrail: 60, fxTrailZoom: 2, bgType: 'solid' }, track: { motionIn: 'none', flipMode: 'random', visHold: 'next' } },
      trails: { label: 'Liquid trails', global: { layout: 'popup', popupSize: 50, fxTrail: 88, fxTrailZoom: 1.6, fxTrailRot: .6, fxHueSpin: 30, bgType: 'solid' }, track: { motionIn: 'pop', visHold: 'note', motionOut: 'fade' } },
      stacked: { label: 'Layered ghosts', global: { layout: 'stack', stackBlend: 'lighter', stackAlpha: 42, bgType: 'solid', fxContrast: 115 }, track: { motionIn: 'zoomIn', motionTime: 260, motionOut: 'fade', outTime: 260, visHold: 'note', visMin: 120 } },
      clean: { label: 'Clean, no effects', global: { layout: 'stage', bgType: 'solid', camBeat: 0, camKick: 0 }, track: { motionIn: 'none', flipMode: 'none' } },
      meme: { label: 'Meme captions', global: { layout: 'stage', capMode: 'word', capSize: 14, bgType: 'blur', camKick: 4 }, track: { motionIn: 'pop' } },
      vertical: { label: 'Vertical short', global: { aspect: '9:16', layout: 'chord', bgType: 'blur', capMode: 'word', capPos: 'middle', camKick: 3 }, track: { motionIn: 'punch', visHold: 'next' } }
    }
  };
})(window.YT);
