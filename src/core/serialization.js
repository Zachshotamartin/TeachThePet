import { validateMaze, mapKey } from './maze.js';
export function exportExperiment(maze, policy) {
  return JSON.stringify({ format: 'teach-the-pet', version: 1, maze, ...(policy && policy.mapKey === mapKey(maze) ? { policy: { mapKey: policy.mapKey, q: Array.from(policy.q), training: policy.training } } : {}) }, null, 2);
}
export function importExperiment(text) {
  if (typeof text !== 'string' || text.length > 250000) throw new Error('Import a JSON file smaller than 250 KB.');
  let input; try { input = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (input?.format !== 'teach-the-pet' || input.version !== 1) throw new Error('Choose a Teach the Pet export (format version 1).');
  const maze = validateMaze(input.maze); let policy = null;
  if (input.policy) {
    const p = input.policy;
    if (p.mapKey !== mapKey(maze)) throw new Error('The saved policy belongs to a different layout. Import its matching maze or retrain.');
    if (!Array.isArray(p.q) || p.q.length !== 252 || !p.q.every(v => Number.isFinite(v) && Math.abs(v) <= 1000)) throw new Error('Policy must contain 252 finite Q-values between −1000 and 1000.');
    // Imported training provenance is not trusted; UI evaluates the imported table itself.
    policy = { mapKey: p.mapKey, q: [...p.q], training: null, imported: true };
  }
  return { maze, policy };
}
