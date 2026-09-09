import { transition, goalDistances, mapKey, RULES } from './maze.js';
export function random(seed = 42) {
  let n = seed >>> 0;
  return () => { n += 0x6D2B79F5; let t = n; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function bestAction(q, state, rng) {
  let best = -Infinity, ties = [];
  for (let a = 0; a < 4; a++) { const v = q[state * 4 + a]; if (v > best + 1e-9) { best = v; ties = [a]; } else if (Math.abs(v - best) <= 1e-9) ties.push(a); }
  return ties[rng ? Math.floor(rng() * ties.length) : 0];
}
export function createTraining(m, { episodes = 12000, seed = 42 } = {}) {
  if (!Number.isInteger(episodes) || episodes < 100 || episodes > 30000) throw new Error('Training must contain 100–30,000 episodes.');
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('Seed must be a whole number from 0 to 4,294,967,295.');
  const rng = random(seed), q = new Float64Array(m.tiles.length * 4), starts = m.tiles.flatMap((t, i) => t !== 'wall' && i !== m.goal ? [i] : []);
  const history = [];
  let completed = 0, successes = 0, totalSteps = 0, windowSuccess = 0, windowReturn = 0, windowSteps = 0;
  function batch(count = 100, cancelled = () => false) {
    for (let i = 0; i < count && completed < episodes; i++) {
      if (cancelled()) return false;
      const epsilon = Math.max(0.04, 1 - completed / (episodes * 0.72));
      let state = rng() < 0.25 ? m.start : starts[Math.floor(rng() * starts.length)], rewardSum = 0, steps = 0, done = false;
      for (; steps < m.tiles.length * 4; steps++) {
        if (cancelled()) return false;
        const action = rng() < epsilon ? Math.floor(rng() * 4) : bestAction(q, state, rng);
        const result = transition(m, state, action);
        const target = result.reward + (result.done ? 0 : RULES.gamma * Math.max(...q.subarray(result.state * 4, result.state * 4 + 4)));
        q[state * 4 + action] += RULES.alpha * (target - q[state * 4 + action]);
        rewardSum += result.reward; state = result.state;
        if (result.done) { done = true; steps++; break; }
      }
      completed++; successes += Number(done); totalSteps += steps; windowSteps += steps; windowSuccess += Number(done); windowReturn += rewardSum;
      if (completed % 100 === 0 || completed === episodes) {
        const window = completed % 100 || 100;
        history.push({ episode: completed, successRate: windowSuccess / window, meanReturn: windowReturn / window, meanSteps: windowSteps / window, epsilon });
        windowSuccess = 0; windowReturn = 0; windowSteps = 0;
      }
    }
    return completed === episodes;
  }
  const snapshot = () => ({ episodes: completed, targetEpisodes: episodes, successes, totalSteps, seed, history: [...history], epsilon: history.at(-1)?.epsilon ?? 1 });
  return { batch, snapshot, q, result: () => ({ mapKey: mapKey(m), q: Array.from(q), training: snapshot() }) };
}
export function train(m, options) { const job = createTraining(m, options); while (!job.batch(500)) { /* Synchronous offline/test runner only. */ } return job.result(); }
export function rollout(m, q = null, { seed = 1337, start = m.start, maxSteps = m.tiles.length * 4 } = {}) {
  const rng = random(seed), path = [start]; let state = start, totalReward = 0, collisions = 0, hazards = 0;
  for (let i = 0; i < maxSteps && state !== m.goal; i++) {
    const a = q ? bestAction(q, state) : Math.floor(rng() * 4), r = transition(m, state, a);
    totalReward += r.reward; collisions += Number(r.collision); hazards += Number(m.tiles[r.state] === 'hazard' && !r.collision); state = r.state; path.push(state);
  }
  return { path, success: state === m.goal, steps: path.length - 1, totalReward, collisions, hazards };
}
export function evaluate(m, q, seed = 91827) {
  const distances = goalDistances(m), runs = [];
  for (let start = 0; start < distances.length; start++) if (distances[start] > 0) {
    const r = rollout(m, q, { start, seed: seed + start * 7919 });
    runs.push({ start, success: r.success, steps: r.steps, shortestSteps: distances[start], efficiency: r.success ? distances[start] / r.steps : 0, return: r.totalReward });
  }
  const successful = runs.filter(r => r.success);
  return { seed, methodology: 'Greedy trained policy (uniform random baseline), one rollout from every non-goal cell connected to the goal; episode cap = 4 × cell count. Efficiency is shortest unweighted path length / actual steps; failures score 0. Hazards may justify longer routes.', reachableStarts: runs.length, successes: successful.length, successRate: runs.length ? successful.length / runs.length : 0, meanEfficiency: runs.length ? runs.reduce((s, r) => s + r.efficiency, 0) / runs.length : 0, meanSteps: runs.length ? runs.reduce((s, r) => s + r.steps, 0) / runs.length : 0, runs };
}
export const policyMatches = (m, policy) => Boolean(policy && policy.mapKey === mapKey(m) && policy.q?.length === m.tiles.length * 4);
