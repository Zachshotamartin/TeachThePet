import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, RULES, cloneMaze, editMaze, transition, goalDistances, mapKey, validateMaze } from '../src/core/maze.js';
import { train, evaluate, rollout, createTraining, policyMatches, random } from '../src/core/learning.js';
import { exportExperiment, importExperiment } from '../src/core/serialization.js';
import { readFile } from 'node:fs/promises';
const trained = JSON.parse(await readFile(new URL('../src/data/trained.json', import.meta.url)));

test('wall and boundary collisions preserve cell and apply collision cost', () => {
  const maze = cloneMaze(PRESETS[0]);
  assert.deepEqual(transition(maze, 0, 0), { state: 0, reward: RULES.collision, done: false, collision: true });
  assert.equal(transition(maze, 1, 2).state, 1);
  assert.equal(transition(maze, 1, 2).reward, -3);
  assert.equal(transition(maze, 8, 1).done, true);
});
test('goal terminates with no subsequent rewards or movement', () => {
  const maze = cloneMaze(PRESETS[0]);
  assert.deepEqual(transition(maze, 7, 1), { state: 8, reward: 35, done: true, collision: false });
  assert.deepEqual(transition(maze, 8, 2), { state: 8, reward: 0, done: true, collision: false });
});
test('hazards, treat tiles, and edited costs affect actual transition rewards', () => {
  const maze = cloneMaze(PRESETS[0]);
  maze.tiles[1] = 'hazard'; assert.equal(transition(maze, 0, 1).reward, -8);
  maze.rewards.hazard = -17; assert.equal(transition(maze, 0, 1).reward, -17);
  maze.tiles[1] = 'treat'; assert.equal(transition(maze, 0, 1).reward, -0.15);
  maze.rewards.treat = -0.5; assert.equal(transition(maze, 0, 1).reward, -0.5);
  assert.ok(transition(maze, 0, 1).reward < 0, 'Treat cannot produce an infinite positive-reward cycle');
});
test('trained presets solve every reachable start with meaningful random-baseline improvement', () => {
  for (const maze of PRESETS) {
    const p = trained[maze.id], learned = evaluate(maze, p.q), randomBaseline = evaluate(maze, null);
    assert.equal(learned.successRate, 1);
    assert.ok(learned.meanEfficiency > .95);
    assert.ok(learned.meanEfficiency > randomBaseline.meanEfficiency + .5);
    assert.ok(learned.meanSteps < randomBaseline.meanSteps / 2);
    assert.equal(rollout(maze, p.q).success, true);
  }
});
test('fresh training improves policy and its curve is actual episode data', () => {
  const maze = cloneMaze(PRESETS[0]), p = train(maze, { episodes: 12000, seed: 2026 });
  assert.equal(evaluate(maze, p.q).successRate, 1);
  assert.equal(p.training.episodes, 12000);
  assert.equal(p.training.history.length, 120);
  assert.ok(p.training.history.at(-1).meanSteps < p.training.history[0].meanSteps);
  assert.ok(p.training.history.at(-1).successRate > p.training.history[0].successRate);
});
test('seeded training and greedy policy execution are deterministic', () => {
  const a = train(PRESETS[2], { episodes: 2000, seed: 123 }), b = train(PRESETS[2], { episodes: 2000, seed: 123 });
  assert.deepEqual(a, b); assert.deepEqual(rollout(PRESETS[2], a.q), rollout(PRESETS[2], b.q));
  const r1 = random(42), r2 = random(42); assert.equal(r1(), r2());
});
test('changing a tile, start, goal, or reward invalidates the matching policy', () => {
  const maze = cloneMaze(PRESETS[0]), p = trained.garden;
  assert.equal(policyMatches(maze, p), true);
  for (const [cell, tool] of [[2, 'wall'], [2, 'start'], [2, 'goal'], [2, 'hazard'], [2, 'treat']]) assert.equal(policyMatches(editMaze(maze, cell, tool), p), false);
  const changed = cloneMaze(maze); changed.rewards.hazard = -20; assert.notEqual(mapKey(changed), mapKey(maze)); assert.equal(policyMatches(changed, p), false);
  assert.equal(editMaze(maze, maze.start, 'wall'), maze);
});
test('cancelled training performs no further updates, with bounded episodes and step counts', () => {
  const job = createTraining(PRESETS[0], { episodes: 2000, seed: 42 });
  job.batch(100); const before = job.snapshot(), q = Array.from(job.q);
  assert.equal(job.batch(100, () => true), false);
  assert.deepEqual(job.snapshot(), before); assert.deepEqual(Array.from(job.q), q);
  assert.ok(before.totalSteps <= before.episodes * 252);
  assert.throws(() => createTraining(PRESETS[0], { episodes: 30001 }), /30,000/);
});
test('hazard cost changes which route is learned', () => {
  const maze = { width: 9, height: 7, tiles: Array(63).fill('floor'), start: 27, goal: 35, rewards: { hazard: -1, treat: -.15 } };
  maze.tiles[31] = 'hazard';
  const low = train(maze, { episodes: 12000, seed: 42 }), lowRoute = rollout(maze, low.q);
  maze.rewards.hazard = -20;
  const high = train(maze, { episodes: 12000, seed: 42 }), highRoute = rollout(maze, high.q);
  assert.equal(lowRoute.steps, 8); assert.equal(lowRoute.hazards, 1);
  assert.equal(highRoute.hazards, 0); assert.equal(highRoute.steps, 10);
});
test('sealed start is detected, without confusing reachability with learned success', () => {
  let maze = cloneMaze(PRESETS[0]); maze = editMaze(maze, 45, 'wall'); maze = editMaze(maze, 55, 'wall');
  assert.equal(goalDistances(maze)[maze.start], -1);
  assert.equal(rollout(maze, null).success, false);
});
test('JSON roundtrip preserves map and values; edited maps do not export stale policy', () => {
  const maze = cloneMaze(PRESETS[0]), policy = trained.garden;
  const restored = importExperiment(exportExperiment(maze, policy));
  assert.equal(mapKey(restored.maze), mapKey(maze)); assert.deepEqual(restored.policy.q, policy.q); assert.equal(restored.policy.training, null);
  assert.equal(JSON.parse(exportExperiment(editMaze(maze, 2, 'wall'), policy)).policy, undefined);
});
test('malformed imports, mismatched maps and nonfinite policy values are rejected', () => {
  assert.throws(() => importExperiment('nope'), /valid JSON/);
  assert.throws(() => importExperiment(' '.repeat(250001)), /250 KB/);
  assert.throws(() => importExperiment('{}'), /version 1/);
  const sample = JSON.parse(exportExperiment(cloneMaze(PRESETS[0]), trained.garden));
  sample.policy.mapKey = 'wrong'; assert.throws(() => importExperiment(JSON.stringify(sample)), /different layout/);
  sample.policy.mapKey = mapKey(sample.maze); sample.policy.q[0] = null; assert.throws(() => importExperiment(JSON.stringify(sample)), /finite/);
  assert.throws(() => validateMaze({ ...PRESETS[0], width: 99 }), /9 columns/);
  assert.throws(() => validateMaze({ ...PRESETS[0], rewards: { hazard: 8, treat: -.15 } }), /Hazard cost/);
});
