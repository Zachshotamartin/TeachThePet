import { writeFile, mkdir } from 'node:fs/promises';
import { PRESETS, RULES } from '../src/core/maze.js';
import { train, evaluate } from '../src/core/learning.js';
const trained = {}, report = { algorithm: 'Tabular Q-learning', rules: RULES, episodesPerPolicy: 12000, trainingSeeds: [42, 2026, 8841], evaluationSeed: 91827, presets: [] };
for (const maze of PRESETS) {
  const policies = report.trainingSeeds.map(seed => train(maze, { episodes: 12000, seed }));
  const evaluations = policies.map(policy => ({ trainingSeed: policy.training.seed, ...evaluate(maze, policy.q) }));
  if (evaluations.some(e => e.successRate < 0.95)) throw new Error(`${maze.id} did not meet 95% reachable-start success.`);
  trained[maze.id] = { ...policies[0], evaluation: evaluations[0], baseline: evaluate(maze, null) };
  report.presets.push({ id: maze.id, name: maze.name, baseline: evaluate(maze, null), evaluations });
  console.log(`${maze.id}: ${evaluations.map(e => `${Math.round(e.successRate * 100)}% success / ${(e.meanEfficiency * 100).toFixed(1)}% efficiency`).join('; ')}`);
}
await mkdir(new URL('../src/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../src/data/trained.json', import.meta.url), JSON.stringify(trained));
await writeFile(new URL('../evaluation.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
