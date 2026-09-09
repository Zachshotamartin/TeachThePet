import { ACTIONS, PRESETS, cloneMaze, editMaze, goalDistances, mapKey } from './core/maze.js';
import { bestAction, evaluate, rollout, policyMatches } from './core/learning.js';
import { exportExperiment, importExperiment } from './core/serialization.js';
import trained from './data/trained.json';
import { petSVG } from './pet.js';

export const metadata = {
  id: 'teach-the-pet', title: 'Teach the Pet',
  description: 'A crowned blob learns its way home. Change its world, shape the rewards, and watch a real Q-learning policy improve.',
  instructions: ['Run a trained preset, then compare its route with a random beginner.', 'Select a brush and tap cells to edit the maze; arrow keys select a cell and Enter or Space applies the brush.', 'Change the hazard or treat cost under Shape the rewards, then train a fresh policy.'],
  limitations: ['This small tabular learner is not general-purpose AI. Its policy is tied to one exact layout and reward system; edits require retraining.', 'Treat tiles reduce a negative step cost. They cannot be farmed for infinite positive reward.', 'Reported goal success tests every reachable start on the current maze; it does not measure performance on unseen mazes.'],
  technique: 'Seeded, epsilon-greedy tabular Q-learning in a cancellable Web Worker, with randomized training starts and exhaustive reachable-start evaluation.'
};
let instance = 0;
const pct = n => `${Math.round(n * 100)}%`;
const fmt = n => Number(n).toLocaleString('en-US');

export function mountExperiment(element, options = {}) {
  const prefix = `tp-${++instance}`;
  const root = document.createElement('section'); root.className = 'teach-pet'; root.setAttribute('aria-label', 'Teach the Pet learning playground'); element.append(root);
  let maze = cloneMaze(PRESETS[0]), policy = structuredClone(trained.garden), evaluation = policy.evaluation;
  let stats = policy.training, selected = maze.start, brush = 'inspect', mode = 'policy', compare = false;
  let route = rollout(maze, policy.q), beginner = rollout(maze), frame = 0, playing = false, speed = 6;
  let worker = null, jobId = 0, importEpoch = 0, training = false, disposed = false, onScreen = true, timer = null;
  const urls = new Set(), controller = new AbortController();
  root.innerHTML = `
    <header class="tp-header" ${options.embedded ? 'hidden' : ''}><div><p class="tp-kicker">A little world. A lot to learn.</p><h2>Teach the Pet<span class="tp-title-dot">.</span></h2><p class="tp-intro">Give your crowned companion a goal. Let experience do the teaching.</p></div><div class="tp-character">${petSVG}<span>Learning by doing</span></div></header>
    <div class="tp-workspace">
      <div class="tp-world">
        <div class="tp-world-head"><div><label for="${prefix}-preset" class="tp-label">Choose a world</label><select id="${prefix}-preset" data-field="preset">${PRESETS.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}<option value="custom" hidden>Your own maze</option></select></div><span class="tp-badge" data-output="badge">Trained & ready</span></div>
        <p class="tp-description" data-output="description"></p>
        <div class="tp-views" role="group" aria-label="Maze visualization"><button data-view="policy" aria-pressed="true">Policy arrows</button><button data-view="value" aria-pressed="false">Value map</button><button data-view="plain" aria-pressed="false">Just the maze</button></div>
        <div class="tp-board-shell"><div class="tp-board" role="group" aria-label="Maze cells. Arrow keys navigate; Enter applies the selected brush.">${maze.tiles.map((_, i) => `<button class="tp-cell" data-cell="${i}" tabindex="${i === selected ? 0 : -1}"><span class="tp-cell-symbol"></span><span class="tp-cell-arrow" aria-hidden="true"></span></button>`).join('')}</div><svg class="tp-trails" viewBox="0 0 900 700" aria-hidden="true"><polyline class="tp-beginner-path"/><polyline class="tp-learned-path"/></svg><div class="tp-pet" aria-hidden="true">${petSVG}</div></div>
        <div class="tp-legend"><span><i class="tp-key tp-key-goal"></i>Goal +35</span><span><i class="tp-key tp-key-hazard"></i><b data-output="hazard-legend">Hazard −8</b></span><span><i class="tp-key tp-key-treat"></i><b data-output="treat-legend">Treat −0.15</b></span><span data-output="heat-legend">Arrows = best learned move</span></div>
        <div class="tp-playback"><button class="tp-primary" data-action="play">Run pet</button><button data-action="step">Step</button><button data-action="reset">Reset run</button><label class="tp-speed">Steps/s<select data-field="speed" aria-label="Playback speed in steps per second"><option value="2">2</option><option value="6" selected>6</option><option value="20">20</option></select></label></div>
        <div class="tp-run-status"><span class="tp-run-dot"></span><span data-output="run">Ready to find the goal.</span><span class="tp-mono" data-output="steps">0 steps</span></div>
        <div class="tp-comparison-head"><label class="tp-check"><input type="checkbox" data-field="compare"> Compare with a beginner</label><span class="tp-muted">Same world, seed 1337</span></div>
        <div class="tp-compare-results" hidden><div><span class="tp-muted">Random beginner</span><strong data-output="beginner-result"></strong><span data-output="beginner-detail"></span></div><div><span class="tp-muted">Learned policy</span><strong data-output="learned-result"></strong><span data-output="learned-detail"></span></div></div>
        <div class="tp-inspector"><div><strong data-output="cell-title"></strong><span class="tp-muted">Expected discounted return by action</span></div><div class="tp-q-values">${ACTIONS.map((a, i) => `<span data-q="${i}"><b>${a.arrow}</b><span>—</span></span>`).join('')}</div></div>
      </div>
      <aside class="tp-controls">
        <section class="tp-training" aria-label="Training controls"><div class="tp-section-head"><h3>A mind of its own</h3><span class="tp-mono" data-output="policy-source">Q-learning</span></div>
          <p class="tp-muted tp-tight">Try the trained pet, or teach it again from a blank memory.</p>
          <div class="tp-metrics"><div><strong data-output="success">100%</strong><span>Goal success</span></div><div><strong data-output="episodes">12,000</strong><span>Training episodes</span></div></div>
          <div class="tp-chart-head"><span>Learning curve</span><span data-output="chart-label">Success / 100 episodes</span></div>
          <svg class="tp-chart" viewBox="0 0 340 110" role="img" aria-label="Training success rate over episodes"><path d="M0 10H340M0 50H340M0 90H340" class="tp-chart-grid"/><path class="tp-chart-area"/><path class="tp-chart-line"/><text x="1" y="107">Early attempts</text><text x="338" y="107" text-anchor="end">Latest</text></svg>
          <p class="tp-eval-note" data-output="evaluation"></p>
          <div class="tp-fields"><label>Episodes<select data-field="episodes"><option value="2000">2,000 · quick lesson</option><option value="12000" selected>12,000 · full lesson</option><option value="30000">30,000 · extra practice</option></select></label><label>Experiment seed<input data-field="seed" type="number" min="0" max="4294967295" step="1" value="42" inputmode="numeric"></label></div>
          <div class="tp-train-actions"><button class="tp-primary" data-action="train">Train from scratch</button><button data-action="cancel" hidden>Cancel</button></div>
          <progress aria-label="Training progress" max="12000" value="12000"></progress>
          <p class="tp-training-status" data-output="training-status">12,000 episodes of experience, ready to explore.</p>
        </section>
        <section class="tp-editor" aria-label="Maze editor"><div class="tp-section-head"><h3>Change its world</h3><button class="tp-text-button" data-action="restore">Restore preset</button></div><div class="tp-brushes" role="group" aria-label="Editing brush">${[['inspect', 'Inspect'], ['wall', 'Wall'], ['floor', 'Erase'], ['start', 'Start'], ['goal', 'Goal'], ['hazard', 'Hazard'], ['treat', 'Treat']].map(([id, label]) => `<button data-brush="${id}" aria-pressed="${id === 'inspect'}"><i class="tp-brush-dot tp-brush-${id}"></i>${label}</button>`).join('')}</div><p class="tp-muted tp-editor-hint" data-output="edit-hint">Select a brush, then tap a cell. Arrow keys move the selection; Enter paints.</p><p class="tp-map-warning" data-output="map-warning" hidden></p></section>
        <details class="tp-rewards"><summary>Shape the rewards</summary><p class="tp-muted">A shortcut can become a bad idea. Changing either cost clears the policy; train again to see the route change.</p><div class="tp-fields"><label>Hazard cost<input data-field="hazard" type="number" min="-20" max="-1" step="1" value="-8"></label><label>Treat cost<input data-field="treat" type="number" min="-1" max="-0.05" step="0.05" value="-0.15"></label></div><p class="tp-muted">Goal +35 · normal step −1 · wall bump −3. Treat costs stay negative so rewards cannot be farmed forever.</p><p class="tp-file-status" data-output="reward-status"></p></details>
        <details class="tp-explain"><summary>What is the pet learning?</summary><p>Each cell has four learned Q-values: how rewarding a move is expected to be, including future steps. Training explores randomly, then increasingly follows the best values.</p><p>Normal steps cost −1; wall bumps cost −3. Treats default to −0.15, so the pet prefers them without getting stuck collecting infinite rewards. Hazards default to −8. Change both costs under “Shape the rewards.” Reaching the goal gives +35 and ends the episode.</p><p>Each attempt starts at the chosen start (25%) or a random walkable cell (75%), with a 252-step limit. This is a tiny maze learner, not general-purpose AI. Its memory only works for this exact layout; editing any cell requires retraining.</p><a href="https://people.cs.umass.edu/~barto/courses/cs687/Chapter%206.pdf" target="_blank" rel="noreferrer">The Q-learning method · Sutton & Barto ↗</a></details>
        <details class="tp-share"><summary>Save or load an experiment</summary><p class="tp-muted">Export the maze and its matching policy as JSON. Imported policies are evaluated again in your browser.</p><div class="tp-share-buttons"><button data-action="export">Export JSON</button><button data-action="import">Import JSON</button><input class="tp-file" type="file" accept=".json,application/json" aria-label="Import experiment JSON"></div><p class="tp-file-status" data-output="file-status"></p></details>
      </aside>
    </div><p class="tp-live" role="status" aria-live="polite" data-output="live"></p>`;
  const $ = selector => root.querySelector(selector);
  const output = (name, value) => { $(`[data-output="${name}"]`).textContent = value; };
  const announce = text => output('live', text);
  const cells = [...root.querySelectorAll('[data-cell]')];
  const controls = { play: $('[data-action="play"]'), train: $('[data-action="train"]'), cancel: $('[data-action="cancel"]') };
  let lastPreset = 'garden';
  function compatible() { return policyMatches(maze, policy); }
  function refreshRuns() { const valid = compatible(); route = rollout(maze, valid ? policy.q : null); beginner = rollout(maze); frame = 0; }
  function stop() { playing = false; clearTimeout(timer); timer = null; controls.play.textContent = 'Run pet'; }
  function cancelTraining(message = 'Training cancelled. The previous policy is preserved.') {
    if (!training) return;
    jobId++; worker?.terminate(); worker = null; training = false; stats = policy?.training || null; output('training-status', message); announce(message); render();
  }
  function paintChart() {
    const history = stats?.history || [], values = history.map((h, i) => [history.length > 1 ? i / (history.length - 1) * 340 : 0, 90 - h.successRate * 80]);
    const path = values.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    $('.tp-chart-line').setAttribute('d', path);
    $('.tp-chart-area').setAttribute('d', path ? `${path} L340 90 L0 90 Z` : '');
    $('.tp-chart').setAttribute('aria-label', history.length ? `Training success rose from ${pct(history[0].successRate)} to ${pct(history.at(-1).successRate)} per 100 exploration episodes.` : 'No training history. Train a policy to create a learning curve.');
  }
  function paintBoard() {
    const valid = compatible(), q = valid ? policy.q : null;
    const values = maze.tiles.map((t, i) => t === 'wall' || i === maze.goal || !q ? 0 : Math.max(...q.slice(i * 4, i * 4 + 4)));
    const max = Math.max(1, ...values), min = Math.min(0, ...values);
    cells.forEach((cell, i) => {
      const isGoal = i === maze.goal, isStart = i === maze.start, tile = maze.tiles[i];
      cell.className = `tp-cell tp-cell-${tile}${isGoal ? ' tp-cell-goal' : ''}${isStart ? ' tp-cell-start' : ''}${selected === i ? ' tp-cell-selected' : ''}`;
      cell.tabIndex = selected === i ? 0 : -1;
      cell.setAttribute('aria-label', `Row ${Math.floor(i / maze.width) + 1}, column ${i % maze.width + 1}: ${isGoal ? 'goal' : isStart ? 'start' : tile}${q && tile !== 'wall' && !isGoal ? `; best move ${ACTIONS[bestAction(q, i)].name}` : ''}`);
      cell.querySelector('.tp-cell-symbol').textContent = isGoal ? '◎' : isStart ? 'S' : tile === 'hazard' ? '×' : tile === 'treat' ? '✦' : '';
      cell.querySelector('.tp-cell-arrow').textContent = mode !== 'plain' && q && tile !== 'wall' && !isGoal && !isStart ? ACTIONS[bestAction(q, i)].arrow : '';
      cell.style.backgroundColor = mode === 'value' && q && tile !== 'wall' && !isGoal ? `rgba(184,205,153,${(0.04 + (values[i] - min) / (max - min) * .32).toFixed(3)})` : '';
    });
    const points = path => path.map(i => `${i % maze.width * 100 + 50},${Math.floor(i / maze.width) * 100 + 50}`).join(' ');
    $('.tp-learned-path').setAttribute('points', valid && mode !== 'plain' ? points(route.path) : '');
    $('.tp-beginner-path').setAttribute('points', compare ? points(beginner.path) : '');
    const position = route.path[Math.min(frame, route.path.length - 1)];
    $('.tp-pet').style.transform = `translate(${position % maze.width * 100}%,${Math.floor(position / maze.width) * 100}%)`;
    output('cell-title', `Cell ${Math.floor(selected / maze.width) + 1}, ${selected % maze.width + 1} · ${selected === maze.goal ? 'goal' : maze.tiles[selected]}`);
    root.querySelectorAll('[data-q]').forEach((node, i) => { node.querySelector('span').textContent = q && maze.tiles[selected] !== 'wall' && selected !== maze.goal ? q[selected * 4 + i].toFixed(1) : '—'; node.classList.toggle('tp-q-best', Boolean(q && selected !== maze.goal && maze.tiles[selected] !== 'wall' && bestAction(q, selected) === i)); });
    output('heat-legend', mode === 'value' ? 'Brighter = higher learned value' : mode === 'policy' ? 'Arrows = best learned move' : 'Tap a cell to inspect it');
  }
  function paintRun() {
    const done = frame >= route.steps;
    output('steps', `${frame} / ${route.steps} steps`);
    output('run', done ? route.success ? 'Home! The goal ends this attempt.' : 'Step limit reached. This attempt did not find the goal.' : playing ? compatible() ? 'Following the learned policy…' : 'Exploring with no learned memory…' : frame ? 'Paused. Take the next step when you’re ready.' : compatible() ? 'A learned route, ready to follow.' : 'Memory cleared. Train a new policy for this world.');
  }
  function render() {
    const valid = compatible();
    root.dataset.policy = valid ? 'trained' : 'untrained'; root.dataset.training = String(training);
    output('description', maze.description);
    output('badge', training ? 'Learning…' : valid ? 'Trained & ready' : 'Needs a lesson');
    $('.tp-badge').classList.toggle('tp-badge-pending', !valid || training);
    $('[data-field="preset"]').value = maze.id === 'custom' ? 'custom' : maze.id;
    output('success', training ? '…' : valid && evaluation ? pct(evaluation.successRate) : '—');
    output('episodes', stats?.episodes ? fmt(stats.episodes) : policy?.imported ? '—' : '0');
    output('policy-source', policy?.imported ? 'Imported policy' : 'Q-learning');
    output('evaluation', training ? 'New lesson in progress. Every reachable start will be tested when this policy finishes.' : valid && evaluation ? `${evaluation.successes}/${evaluation.reachableStarts} reachable starts solved · ${pct(evaluation.meanEfficiency)} path efficiency. Measured on this exact maze.` : 'No matching policy yet. Train, then we’ll test every reachable start.');
    output('beginner-result', beginner.success ? `Found it in ${beginner.steps} steps` : `Lost after ${beginner.steps} steps`);
    output('beginner-detail', `${beginner.collisions} wall bumps · ${beginner.totalReward.toFixed(1)} reward`);
    output('learned-result', valid ? route.success ? `Home in ${route.steps} steps` : `Stopped at ${route.steps} steps` : 'Needs training');
    output('learned-detail', valid ? `${route.collisions} wall bumps · ${route.totalReward.toFixed(1)} reward` : 'Paint the maze, then train a new policy.');
    $('.tp-compare-results').hidden = !compare;
    controls.train.disabled = training; controls.cancel.hidden = !training; controls.play.disabled = training; $('[data-action="step"]').disabled = training;
    $('[data-field="episodes"]').disabled = training; $('[data-field="seed"]').disabled = training;
    const progress = $('progress'); progress.max = stats?.targetEpisodes || 12000; progress.value = stats?.episodes || 0;
    output('chart-label', stats?.history?.length ? 'Success / 100 episodes' : 'Waiting for a lesson');
    output('hazard-legend', `Hazard ${maze.rewards?.hazard ?? -8}`); output('treat-legend', `Treat ${maze.rewards?.treat ?? -0.15}`);
    if (document.activeElement !== $('[data-field="hazard"]')) $('[data-field="hazard"]').value = maze.rewards?.hazard ?? -8;
    if (document.activeElement !== $('[data-field="treat"]')) $('[data-field="treat"]').value = maze.rewards?.treat ?? -0.15;
    const distances = goalDistances(maze), unreachable = distances[maze.start] < 0;
    const warning = $('[data-output="map-warning"]'); warning.hidden = !unreachable;
    warning.textContent = 'The start is blocked from the goal. Open a path before training; no policy can solve a sealed maze.';
    paintChart(); paintBoard(); paintRun();
  }
  function step() {
    if (frame >= route.steps) frame = 0;
    frame++; paintBoard(); paintRun();
    if (frame >= route.steps) { stop(); paintRun(); announce(route.success ? `Goal reached in ${route.steps} steps.` : 'The attempt reached its step limit.'); }
  }
  function schedule() {
    if (!playing || disposed || document.hidden || !onScreen) return;
    timer = setTimeout(() => { step(); if (playing) schedule(); }, 1000 / speed);
  }
  function togglePlay() {
    if (playing) { stop(); paintRun(); return; }
    if (frame >= route.steps) frame = 0;
    playing = true; controls.play.textContent = 'Pause'; paintRun(); schedule();
  }
  function applyCell(cell) {
    selected = cell;
    if (brush === 'inspect') { paintBoard(); return; }
    const next = editMaze(maze, cell, brush);
    if (next !== maze) {
      importEpoch++;
      stop(); cancelTraining('Training cancelled because the maze changed.'); maze = next; policy = null; stats = null; evaluation = null; refreshRuns();
      output('training-status', 'The layout changed. Train from scratch to learn this world.'); announce('Maze updated. Previous policy cleared; retraining required.');
    }
    render();
  }
  function restore(id = lastPreset) {
    importEpoch++;
    stop(); cancelTraining('Training cancelled.'); lastPreset = id; maze = cloneMaze(PRESETS.find(p => p.id === id) || PRESETS[0]); policy = structuredClone(trained[maze.id]); evaluation = policy.evaluation; stats = policy.training; selected = maze.start; refreshRuns();
    output('training-status', `${fmt(stats.episodes)} episodes of experience, ready to explore.`); output('file-status', ''); render(); announce(`${maze.name} loaded with its trained policy.`);
  }
  function trainPolicy() {
    const seed = Number($('[data-field="seed"]').value), episodes = Number($('[data-field="episodes"]').value);
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295 || $('[data-field="seed"]').value.trim() === '') { output('training-status', 'Enter a whole-number seed from 0 to 4,294,967,295.'); announce('Invalid experiment seed.'); return; }
    if (goalDistances(maze)[maze.start] < 0) { output('training-status', 'Open a path from start to goal before training.'); announce('The maze has no route from start to goal.'); return; }
    importEpoch++;
    stop(); const id = ++jobId, key = mapKey(maze); worker?.terminate();
    try { worker = new Worker(new URL('./training-worker.js', import.meta.url), { type: 'module' }); } catch { output('training-status', 'Training could not start in this browser. Try a current browser with Web Worker support.'); return; }
    training = true; stats = { episodes: 0, targetEpisodes: episodes, history: [], seed }; output('training-status', 'Starting with a blank Q-table…'); render();
    worker.onmessage = ({ data }) => {
      if (disposed || data.id !== jobId || key !== mapKey(maze)) return;
      if (data.type === 'progress') { stats = data.stats; output('training-status', `${fmt(stats.episodes)} / ${fmt(episodes)} episodes · ${pct(stats.epsilon)} exploration`); render(); }
      if (data.type === 'complete') { policy = data.policy; evaluation = data.evaluation; stats = policy.training; training = false; worker.terminate(); worker = null; refreshRuns(); output('training-status', `Lesson complete. ${evaluation.successes}/${evaluation.reachableStarts} reachable starts solved.`); render(); announce(`Training complete. Goal success ${pct(evaluation.successRate)}.`); }
      if (data.type === 'error') { training = false; worker?.terminate(); worker = null; output('training-status', `Training failed: ${data.message}`); render(); announce(`Training failed: ${data.message}`); }
    };
    worker.onerror = () => { if (disposed || id !== jobId) return; training = false; worker?.terminate(); worker = null; output('training-status', 'The training worker stopped unexpectedly. Your maze is safe; try training again.'); render(); announce('Training could not finish. Please try again.'); };
    if (document.hidden || !onScreen) worker.postMessage({ type: 'pause' });
    worker.postMessage({ type: 'train', id, maze, options: { seed, episodes } });
  }
  function exportJSON() {
    const url = URL.createObjectURL(new Blob([exportExperiment(maze, policy)], { type: 'application/json' })); urls.add(url);
    const a = document.createElement('a'); a.href = url; a.download = `teach-the-pet-${maze.id}.json`; a.click(); output('file-status', 'Experiment exported. Keep this file to repeat or share the lesson.');
    setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 1000);
  }
  async function importFile(file) {
    if (!file || disposed) return;
    const epoch = ++importEpoch;
    try {
      if (file.size > 250000) throw new Error('Import a JSON file smaller than 250 KB.');
      const text = await file.text();
      if (disposed || epoch !== importEpoch) return;
      const result = importExperiment(text);
      stop(); cancelTraining('Training cancelled for import.'); maze = result.maze; policy = result.policy; stats = policy?.training; evaluation = policy ? evaluate(maze, policy.q) : null; selected = maze.start; refreshRuns();
      output('training-status', policy ? 'Imported memory loaded. Its success was measured again here.' : 'Maze imported. Train from scratch to create a policy.'); output('file-status', policy ? 'Maze and matching policy imported successfully.' : 'Maze imported successfully. Ready for a fresh lesson.'); render(); announce('Experiment imported.');
    } catch (error) {
      if (disposed || epoch !== importEpoch) return;
      output('file-status', error.message); announce(error.message);
    } finally {
      if (!disposed && epoch === importEpoch) $('.tp-file').value = '';
    }
  }
  root.addEventListener('click', e => {
    const button = e.target.closest('button'); if (!button || !root.contains(button)) return;
    if (button.dataset.cell !== undefined) { applyCell(Number(button.dataset.cell)); return; }
    if (button.dataset.brush) { brush = button.dataset.brush; root.querySelectorAll('[data-brush]').forEach(b => b.setAttribute('aria-pressed', b.dataset.brush === brush)); output('edit-hint', brush === 'inspect' ? 'Select a cell to inspect its four learned Q-values.' : `${brush === 'floor' ? 'Erase' : brush[0].toUpperCase() + brush.slice(1)} brush selected. Tap a cell, or use arrow keys and Enter.`); return; }
    if (button.dataset.view) { mode = button.dataset.view; root.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === mode)); paintBoard(); return; }
    const actions = { play: togglePlay, step: () => { stop(); step(); }, reset: () => { importEpoch++; stop(); frame = 0; paintBoard(); paintRun(); announce('Pet returned to the start.'); }, train: trainPolicy, cancel: () => cancelTraining(), restore: () => restore(), export: exportJSON, import: () => $('.tp-file').click() };
    actions[button.dataset.action]?.();
  }, { signal: controller.signal });
  root.addEventListener('change', e => {
    const field = e.target.dataset.field;
    if (field === 'preset' && e.target.value !== 'custom') restore(e.target.value);
    if (field === 'speed') speed = Number(e.target.value);
    if (field === 'hazard' || field === 'treat') {
      const value = Number(e.target.value), valid = e.target.value.trim() && Number.isFinite(value) && (field === 'hazard' ? value >= -20 && value <= -1 : value >= -1 && value <= -0.05);
      if (!valid) { output('reward-status', 'Hazard cost must be −20 to −1; treat cost must be −1 to −0.05.'); return; }
      if (value !== (maze.rewards?.[field] ?? (field === 'hazard' ? -8 : -0.15))) {
        importEpoch++;
        stop(); cancelTraining('Training cancelled because the rewards changed.'); maze = cloneMaze(maze); maze.rewards[field] = value; maze.id = 'custom'; maze.name = 'Your own maze'; maze.description = 'The same world, with a different reason to explore.'; policy = null; evaluation = null; stats = null; refreshRuns(); output('training-status', 'Reward costs changed. Train a fresh policy to learn their effect.'); output('reward-status', 'Reward changed. Train again to discover a new route.'); render(); announce('Rewards updated. Previous policy cleared.');
      }
    }
    if (field === 'compare') { compare = e.target.checked; render(); }
    if (e.target.matches('.tp-file')) importFile(e.target.files[0]);
  }, { signal: controller.signal });
  root.addEventListener('keydown', e => {
    const cell = e.target.closest('[data-cell]'); if (!cell) return;
    const movement = { ArrowUp: -maze.width, ArrowDown: maze.width, ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (movement) { e.preventDefault(); selected = Math.max(0, Math.min(maze.tiles.length - 1, Number(cell.dataset.cell) + movement)); paintBoard(); cells[selected].focus(); }
  }, { signal: controller.signal });
  function visibilityChanged() { const paused = document.hidden || !onScreen; if (paused && playing) { stop(); paintRun(); } worker?.postMessage({ type: paused ? 'pause' : 'resume' }); }
  document.addEventListener('visibilitychange', visibilityChanged, { signal: controller.signal });
  const observer = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => { onScreen = entries[0].isIntersecting; visibilityChanged(); }) : null; observer?.observe(root);
  render();
  return { dispose() { if (disposed) return; disposed = true; jobId++; importEpoch++; stop(); worker?.terminate(); worker = null; controller.abort(); observer?.disconnect(); urls.forEach(URL.revokeObjectURL); urls.clear(); root.remove(); } };
}
