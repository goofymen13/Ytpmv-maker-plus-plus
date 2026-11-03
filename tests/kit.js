/* A tiny test runner, so the tests work by opening a page: no Node, no install. */
(function () {
  'use strict';
  const list = [];
  const kit = window.TestKit = {
    test: (name, fn) => list.push({ name, fn }),
    assert(ok, message = 'assertion failed') { if (!ok) throw new Error(message); },
    near(a, b, tolerance = 1e-6, label = '') {
      if (!(Math.abs(a - b) <= tolerance)) throw new Error(`${label ? label + ': ' : ''}expected ${b} (within ${tolerance}), got ${a}`);
    },
    async run(filter) {
      const out = document.getElementById('results');
      let passed = 0;
      const failures = [];
      const started = performance.now();
      for (const t of list) {
        if (filter && !t.name.includes(filter)) continue;
        const row = document.createElement('div');
        const begin = performance.now();
        try {
          await t.fn();
          passed++;
          row.className = 'pass';
          row.textContent = `PASS  ${t.name}  (${Math.round(performance.now() - begin)} ms)`;
        } catch (err) {
          failures.push(`${t.name}: ${err.message}`);
          row.className = 'fail';
          row.textContent = `FAIL  ${t.name}: ${err.message}`;
        }
        out.append(row);
        await new Promise(r => setTimeout(r, 0));
      }
      const summary = document.getElementById('summary');
      summary.textContent = `${passed} passed, ${failures.length} failed in ${((performance.now() - started) / 1000).toFixed(1)} s`;
      summary.className = failures.length ? 'fail' : 'pass';
      window.TEST_DONE = { passed, failed: failures.length, failures };
      // Lets a headless run hand its result back, for example when testing from file://.
      const report = new URLSearchParams(location.search).get('report');
      if (report) {
        const extra = { origin: location.protocol, secure: isSecureContext, workers: window.YT?.app?.farm?.workers.length, exports: window.EXPORT_REPORT, playback: window.PLAYBACK_NOTE };
        await fetch(report, { method: 'POST', body: JSON.stringify({ ...window.TEST_DONE, ...extra }) }).catch(() => {});
      }
      return window.TEST_DONE;
    }
  };
  window.addEventListener('load', () => setTimeout(() => kit.run(new URLSearchParams(location.search).get('only')), 50));
})();
