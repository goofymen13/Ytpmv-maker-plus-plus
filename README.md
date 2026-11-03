# YTPMV Maker Ultra++

A full rebuild of [coolioman13/ytpmv-creator-public](https://github.com/coolioman13/ytpmv-creator-public) for making actual YTPMVs.

**To run it:** open `index.html` in Chrome or Edge. Nothing to install, nothing is uploaded, and it works offline. Press **Load demo** to see it working.

## Making one

1. **Song.** Drop a MIDI, then drop the MP3 of the same song. Press **Auto-sync** to line them up, then fine-tune by dragging the MP3 row in the timeline.
2. **Clips.** Drop your video, audio or image files. Words are found automatically. Press **Edit words** to name them and perfect the cuts.
3. **Word order.** Click words to build a phrase, drag to reorder, or type it: `mr beast mr mr beast`. `_` is a rest. `~` keeps holding the last vowel on the next note.
4. **Tracks.** Each MIDI track picks a phrase. Press play.
5. **Look.** Pick a look from the top bar, then change anything in **Screen** and **Effects**.
6. **Export.** Renders MP4 or WebM frame by frame, usually faster than real time.

Files can be dropped anywhere on the page. Space plays and pauses.

## How long and short notes work

Each word has a marked vowel, shown between the white triangles in the word editor. With the default **Word stretch** setting:

| Note | What happens | Sounds like |
| --- | --- | --- |
| Long | Consonants stay natural, the vowel takes up all the extra time | `MRRRRRRR` |
| Normal | Close to natural speed | `MRR` |
| Short | The vowel gives up time first, then the whole word speeds up | `MR` |

The picture uses the same timing as the sound, so the mouth slows down on a long note. Pitch is separate from timing, so a long note stays in tune. The older sampler behaviour, where speed and pitch move together, is still there under **How clips fit a note**.

Use the **Short / Normal / Long / Very long** buttons in the word editor to hear this on your own clip.

## Controlling word order

- **Phrases:** any words from any clips, in any order, with rests and holds.
- **Next word comes on:** each note, each note in a chord, the whole phrase inside one note, by pitch, by beat, by velocity, ping-pong, random or shuffled.
- **Restart phrase after a rest:** every musical line starts on word one, so `mr` and `beast` stay in the right places.
- **One specific note:** click it in the timeline and choose its word.

## Good to know

- **The MP3 and MIDI must be the same arrangement** for sync to hold. If a MIDI drifts against the MP3, use **+ tempo** or **MIDI tempo stretch** in Mix.
- **Word finding is a starting point.** It looks for quiet gaps, so words spoken with no gap need a manual cut. Use **✂ Split at cursor**.
- **Pitch detection** works best on clear speech and singing. If a word sounds off-key, set its pitch by hand in the word editor.
- **Memory:** clip video is decoded into memory for instant cuts. If you use a lot of clip footage, lower **Mix → Quality → Video frame quality**.
- **Project files** save settings, cuts and word order, plus the MIDI. Video, audio and image files are not stored, so add them back after opening.
- **Video export format:** MP4 needs a browser with H.264 and AAC encoding, which Chrome and Edge have. Otherwise it falls back to WebM.

## Tests

Open `tests/tests.html` through a local server to run the suite. It records and exports real video, so it takes about 20 seconds:

```bash
python -m http.server 8765 --bind 127.0.0.1
```

Then visit `http://127.0.0.1:8765/tests/tests.html`.

## How it is built

No dependencies and no build step; the scripts in `js/` load in order from `index.html`.

| File | Does |
| --- | --- |
| `midi.js` | MIDI parsing, extended from the original project |
| `dsp.js` | Stretch engines, pitch tracking, word detection, MP3 analysis and sync |
| `compiler.js` | Turns notes, phrases and settings into a plan of sung words |
| `farm.js` | Renders voices on background threads and caches them |
| `audio.js` | Mixer, playback and offline mixdown |
| `frames.js` | Decodes clip video into memory for frame-accurate cuts |
| `scene.js`, `postfx.js` | Layouts, motion, overlays and full-screen effects |
| `mux.js`, `export.js` | MP4 and WebM writing, and frame-by-frame export |
| `options.js` | Every setting and preset; the UI is generated from this table |
| `app.js`, `ui*.js` | Project state, transport and interface |
| `demo.js` | The generated demo song |
