import { createTraining, evaluate } from './core/learning.js';
import { validateMaze } from './core/maze.js';
let current = null, paused = false;
self.onmessage = ({ data }) => {
  if (data.type === 'cancel') { current = null; return; }
  if (data.type === 'pause') { paused = true; return; }
  if (data.type === 'resume') { paused = false; return; }
  if (data.type !== 'train') return;
  try {
    const maze = validateMaze(data.maze), job = createTraining(maze, data.options), token = { id: data.id, job }; current = token;
    function tick() {
      if (current !== token) return;
      if (paused) { setTimeout(tick, 100); return; }
      const done = job.batch(100, () => current !== token);
      self.postMessage({ type: 'progress', id: data.id, stats: job.snapshot() });
      if (done) { const policy = job.result(); self.postMessage({ type: 'complete', id: data.id, policy, evaluation: evaluate(maze, policy.q) }); current = null; }
      else setTimeout(tick, 0);
    }
    tick();
  } catch (error) { self.postMessage({ type: 'error', id: data.id, message: error.message }); }
};
