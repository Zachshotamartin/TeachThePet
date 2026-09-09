import assert from 'node:assert/strict';

export async function verifyImportRaces(page) {
  const results = await page.evaluate(async () => {
    const { mountExperiment } = await import('/src/index.js');
    const { PRESETS } = await import('/src/core/maze.js');
    const { exportExperiment } = await import('/src/core/serialization.js');
    const originalText = File.prototype.text, pending = new Map(), failures = [], results = [];
    let sequence = 0;
    const onRejected = event => { failures.push(String(event.reason?.message || event.reason)); };
    window.addEventListener('unhandledrejection', onRejected);
    File.prototype.text = function () { return pending.get(this.name)?.promise || originalText.call(this); };
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));
    function fixture() {
      const host = document.createElement('div'); document.body.append(host);
      const experiment = mountExperiment(host, { embedded: true });
      const query = selector => host.querySelector(selector);
      const change = (field, value) => { const input = query(`[data-field="${field}"]`); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); };
      const click = selector => query(selector).click();
      function readDelayed() {
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        const name = `delayed-${++sequence}.json`, input = query('.tp-file'), transfer = new DataTransfer();
        pending.set(name, { promise });
        transfer.items.add(new File(['{}'], name, { type: 'application/json' }));
        input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
        return { resolve, reject };
      }
      const snapshot = () => ({
        preset: query('[data-field="preset"]').value,
        policy: query('.teach-pet').dataset.policy,
        description: query('[data-output="description"]').textContent,
        trainingStatus: query('[data-output="training-status"]').textContent,
        fileStatus: query('[data-output="file-status"]').textContent,
        cell: query('[data-cell="2"]').className,
        layout: Array.from(query('.tp-board').children, cell => cell.getAttribute('aria-label')),
        hazard: query('[data-field="hazard"]').value,
        steps: query('[data-output="steps"]').textContent
      });
      return { query, change, click, readDelayed, snapshot, dispose: () => { experiment.dispose(); host.remove(); } };
    }
    try {
      const incoming = exportExperiment(PRESETS[2], null);
      const cases = [
        ['preset change', f => f.change('preset', 'switchbacks')],
        ['restore preset', f => f.click('[data-action="restore"]')],
        ['reset run', f => f.click('[data-action="reset"]')],
        ['paint cell', f => { f.click('[data-brush="wall"]'); f.click('[data-cell="2"]'); }],
        ['reward edit', f => f.change('hazard', '-20')]
      ];
      for (const [name, mutate] of cases) {
        const f = fixture();
        try {
          const read = f.readDelayed(); mutate(f); const before = f.snapshot();
          read.resolve(incoming); await flush();
          results.push({ name, preserved: JSON.stringify(before) === JSON.stringify(f.snapshot()) });
        } finally { f.dispose(); }
      }

      const staleMalformed = fixture();
      try {
        const read = staleMalformed.readDelayed(); staleMalformed.change('preset', 'switchbacks'); const before = staleMalformed.snapshot();
        read.resolve('invalid JSON from the obsolete file'); await flush();
        results.push({ name: 'obsolete malformed read ignored', preserved: JSON.stringify(before) === JSON.stringify(staleMalformed.snapshot()) });
      } finally { staleMalformed.dispose(); }

      const newest = fixture();
      try {
        const older = newest.readDelayed(), newer = newest.readDelayed();
        newer.resolve(exportExperiment(PRESETS[1], null)); await flush(); const before = newest.snapshot();
        older.resolve(incoming); await flush();
        results.push({ name: 'newest import wins', preserved: before.description === 'An imported learning environment.' && JSON.stringify(before) === JSON.stringify(newest.snapshot()) });
      } finally { newest.dispose(); }

      const rejected = fixture();
      let detachedWrites = 0;
      const detachedObserver = new MutationObserver(records => { detachedWrites += records.length; });
      const rejectedRead = rejected.readDelayed();
      detachedObserver.observe(rejected.query('.teach-pet'), { subtree: true, childList: true, characterData: true, attributes: true });
      rejected.dispose(); await flush(); detachedWrites = 0;
      rejectedRead.reject(new Error('Delayed file read failed after disposal')); await flush(); await flush();
      detachedObserver.disconnect();
      results.push({ name: 'rejected read after dispose', preserved: failures.length === 0 && detachedWrites === 0 });
    } finally {
      File.prototype.text = originalText;
      window.removeEventListener('unhandledrejection', onRejected);
    }
    return { results, failures };
  });
  assert.deepEqual(results.failures, [], 'Delayed reads must not create unhandled promise rejections.');
  for (const result of results.results) assert.equal(result.preserved, true, result.name);
  console.log('PASS: delayed imports cannot overwrite preset/reset/paint/reward changes or newer imports; rejected reads after disposal are ignored');
}
