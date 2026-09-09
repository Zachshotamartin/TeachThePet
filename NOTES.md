# TeachThePet integration notes

## API and integration

- Package: `@zachshotamartin/teach-the-pet`.
- `import { mountExperiment, metadata } from './src/index.js'`.
- `mountExperiment(element, { embedded: true })` returns `{ dispose() }` synchronously. `embedded` hides only the standalone heading/intro.
- Import `./src/style.css` once. Export path `@zachshotamartin/teach-the-pet/style.css` is configured.
- Root DOM selector: `.teach-pet`. All CSS scoped; no host body/font reset. No runtime dependencies, external assets, backend, or paid API.
- Vite packs the worker through `new Worker(new URL('./training-worker.js', import.meta.url), { type: 'module' })`.
- `instructions` and `limitations` metadata are arrays, matching the Portfolio detail renderer.
- Only TeachThePet files were edited. Git was not initialized; no commit, push, GitHub repo, or Actions workflow was created.

## Implementation

Real epsilon-greedy tabular Q-learning, separate from transitions/maze validation, JSON import/export, and rendering. BFS is evaluation-only. User-editable hazard/treat costs and all map edits are included in mapKey and invalidate policies. Job IDs plus worker termination protect against stale outputs. Hidden/offscreen work pauses. dispose() is idempotent.

## Verified results

`npm run train`: 3 mazes × 3 independent training seeds (42, 2026, 8841), 12,000 episodes each. Every resulting policy solved 100% of its reachable non-goal starts.

- Garden: 45/45 starts, 98.4268% path efficiency. Random baseline success 46.6667%.
- Switchbacks: 41/41 starts, 98.8226% path efficiency. Random baseline success 34.1463%.
- Crossroads: 47/47 starts, 96.0638% path efficiency. Random baseline success 74.4681%.

Full per-start measurements and methodology are in `evaluation.json`. Greedy policies are deterministic: the evaluation seed affects only baseline exploration. These are all-start results on the trained layouts, not held-out-layout claims.

`npm test`: 12 meaningful Node tests passed: collision, terminal goal, rewards, preset baseline improvement, fresh learning improvement, determinism, map/reward invalidation, cancellation bounds, learned hazard detour, disconnected start, JSON roundtrip, malformed import validation.

`npm run test:browser`: actual Chromium flows passed: trained run/pause/step/reset, random comparison, value view, mouse and keyboard painting, worker retraining and successful resulting run, real downloaded export/import roundtrip, invalid imports, reward editing/error, cancellation, stale worker output after preset switch, mobile 390px touch editing/training and no horizontal overflow, embedded API and disposal during active training. No browser runtime errors.

`npm run build`: Vite build passes. Production JS approx 104 KB raw / 22 KB gzip; worker ~6.5 KB; CSS ~17 KB raw / 3.6 KB gzip. `npm install`: zero reported vulnerabilities at install time.

## Captures

`npm run capture` creates actual UI PNGs under `examples/`:

- `examples/garden-comparison.png`: trained garden, actual random beginner path, paused pet after 3 steps, measured 126 vs 14 steps.
- `examples/crossroads-values.png`: real fresh seed-2026 training completion, value map and selected Q-values, pet after 2 steps.

Full app surfaces are captured (approximately 1392 × 1200–1300), preserving the complete maze and controls without black letterboxing. Both inspected visually. `test-results/mobile-390.png` is the full mobile verification capture (ignored by git). Capture/browser scripts reuse the port 5181 server or start/stop their own if absent.

## Remaining root work

Root owns independent GitHub repository creation, commits/publishing, Portfolio package pinning, lazy route integration, and selection/copying of showcase images. No feature blockers remain. Final source is ready to freeze after the final browser/capture rerun documented in the handoff message.

Final verification completed 2026-09-09: all 12 Node tests, the expanded browser suite (including actual pause and invalid seed rejection), production build, and both deterministic capture runs passed. Files are frozen for root integration/publishing. The local Vite server remains available at port 5181 for root review.

Import-race review fix completed and refrozen 2026-09-09: async file reads now capture an import epoch, invalidated by world edits, reward changes, preset restore/switch, run reset, fresh training, newer imports, and disposal. The epoch/disposed guard runs immediately after `file.text()` resolves, before parsing, and guards both catch reporting and final input cleanup. Added `scripts/import-race-regression.mjs` to the real browser suite: delayed valid imports after preset/restore/reset/paint/reward actions preserve the newer state; malformed obsolete reads stay silent; newer imports win; a rejected read after disposal causes neither unhandled rejection nor detached-DOM mutation. Expanded browser suite, all 12 Node tests, and production build pass. No visual or feature changes; showcase captures remain current.
