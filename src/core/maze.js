export const RULES = Object.freeze({ step: -1, collision: -3, hazard: -8, treat: -0.15, goal: 35, gamma: 0.94, alpha: 0.2 });
export const ACTIONS = Object.freeze([{ dx: 0, dy: -1, name: 'up', arrow: '↑' }, { dx: 1, dy: 0, name: 'right', arrow: '→' }, { dx: 0, dy: 1, name: 'down', arrow: '↓' }, { dx: -1, dy: 0, name: 'left', arrow: '←' }]);
const presets = [
  { id: 'garden', name: 'The little garden', description: 'A gentle first lesson. Find a way around the hedges.', rows: ['.........', '.###.###.', '...#.....', '.#.#.##..', '.#...#...', '.###...#.', '.........'], start: 54, goal: 8, hazards: [24, 42], treats: [29, 48] },
  { id: 'switchbacks', name: 'The long way home', description: 'Long corridors, tempting turns, and a winding way home.', rows: ['.........', '####.###.', '.........', '.####.###', '.........', '###.####.', '.........'], start: 54, goal: 0, hazards: [25, 39], treats: [20, 49] },
  { id: 'crossroads', name: 'The risky shortcut', description: 'Learn when a shorter path is worth the sting.', rows: ['.........', '.#.#.#.#.', '.#.....#.', '...###...', '.#.....#.', '.#.#.#.#.', '.........'], start: 27, goal: 35, hazards: [20, 21, 22, 23, 24], treats: [38, 40, 42] }
];
export const PRESETS = presets.map(p => ({ id: p.id, name: p.name, description: p.description, width: 9, height: 7, start: p.start, goal: p.goal, tiles: p.rows.join('').split('').map((c, i) => c === '#' ? 'wall' : p.hazards.includes(i) ? 'hazard' : p.treats.includes(i) ? 'treat' : 'floor') }));
export const cloneMaze = m => ({ ...m, tiles: [...m.tiles], rewards: { hazard: m.rewards?.hazard ?? RULES.hazard, treat: m.rewards?.treat ?? RULES.treat } });
export function validateMaze(input) {
  if (!input || typeof input !== 'object' || input.width !== 9 || input.height !== 7) throw new Error('Maze must be 9 columns by 7 rows.');
  if (!Array.isArray(input.tiles) || input.tiles.length !== 63 || !input.tiles.every(t => ['floor', 'wall', 'hazard', 'treat'].includes(t))) throw new Error('Maze needs exactly 63 valid floor, wall, hazard, or treat tiles.');
  if (![input.start, input.goal].every(i => Number.isInteger(i) && i >= 0 && i < 63) || input.start === input.goal) throw new Error('Start and goal must be different cells inside the maze.');
  if ([input.start, input.goal].some(i => input.tiles[i] !== 'floor')) throw new Error('Start and goal must be on floor tiles.');
  const rewards = { hazard: input.rewards?.hazard ?? RULES.hazard, treat: input.rewards?.treat ?? RULES.treat };
  if (!Number.isFinite(rewards.hazard) || rewards.hazard < -20 || rewards.hazard > -1 || !Number.isFinite(rewards.treat) || rewards.treat < -1 || rewards.treat > -0.05) throw new Error('Hazard cost must be −20 to −1; treat cost must be −1 to −0.05.');
  return { rewards, width: 9, height: 7, tiles: [...input.tiles], start: input.start, goal: input.goal, id: 'custom', name: typeof input.name === 'string' ? input.name.slice(0, 60) : 'Your maze', description: 'An imported learning environment.' };
}
export function mapKey(m) { return `${m.width}x${m.height}:${m.start}:${m.goal}:${m.rewards?.hazard ?? RULES.hazard}:${m.rewards?.treat ?? RULES.treat}:${m.tiles.map(t => ({ floor: '.', wall: '#', hazard: '!', treat: '+' })[t]).join('')}`; }
export function transition(m, state, action) {
  if (state === m.goal) return { state, reward: 0, done: true, collision: false };
  if (!Number.isInteger(action) || action < 0 || action > 3) throw new Error('Invalid action');
  const a = ACTIONS[action], x = state % m.width + a.dx, y = Math.floor(state / m.width) + a.dy, next = y * m.width + x;
  if (x < 0 || y < 0 || x >= m.width || y >= m.height || m.tiles[next] === 'wall') return { state, reward: RULES.collision, done: false, collision: true };
  const done = next === m.goal;
  const reward = done ? RULES.goal : m.tiles[next] === 'hazard' ? (m.rewards?.hazard ?? RULES.hazard) : m.tiles[next] === 'treat' ? (m.rewards?.treat ?? RULES.treat) : RULES.step;
  return { state: next, reward, done, collision: false };
}
// Breadth-first distances are evaluation-only; the learner never reads them.
export function goalDistances(m) {
  const distances = new Int16Array(m.tiles.length).fill(-1), queue = [m.goal]; distances[m.goal] = 0;
  for (let n = 0; n < queue.length; n++) for (let action = 0; action < 4; action++) {
    const current = queue[n], a = ACTIONS[action], x = current % m.width + a.dx, y = Math.floor(current / m.width) + a.dy, next = y * m.width + x;
    if (x >= 0 && x < m.width && y >= 0 && y < m.height && m.tiles[next] !== 'wall' && distances[next] < 0) { distances[next] = distances[current] + 1; queue.push(next); }
  }
  return distances;
}
export function editMaze(m, cell, tool) {
  if (!Number.isInteger(cell) || cell < 0 || cell >= m.tiles.length) return m;
  const next = cloneMaze(m);
  if (tool === 'start' || tool === 'goal') {
    if (cell === m[tool === 'start' ? 'goal' : 'start']) return m;
    next[tool] = cell; next.tiles[cell] = 'floor';
  } else {
    if (cell === m.start || cell === m.goal || !['floor', 'wall', 'hazard', 'treat'].includes(tool)) return m;
    next.tiles[cell] = tool;
  }
  if (mapKey(next) === mapKey(m)) return m;
  next.id = 'custom'; next.name = 'Your own maze'; next.description = 'A new layout deserves a fresh lesson.';
  return next;
}
