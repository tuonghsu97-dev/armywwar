// Registers every simulation system on a Game. Used by the browser match and by headless tests.
import { Game } from '../core/game.js';
import { registerCoreCommands } from './commands.js';
import { aiSystem } from './ai.js';
import { enemyAISystem } from './enemyAI.js';
import { movementSystem } from './movement.js';
import { combatSystem, interceptSystem } from './combat.js';
import { visionSystem } from './vision.js';
import * as capture from './capture.js';
import * as transport from './transport.js';
import * as economy from './economy.js';
import * as victory from './victory.js';
import * as commanders from './commanders.js';
import * as skills from './skills.js';
import * as boss from './boss.js';
import * as ghost from './ghost.js';
import * as tunnels from './tunnels.js';

export function createGame(opts) {
  const game = new Game(opts);
  registerCoreCommands(game);
  game.addSystem(aiSystem, 10);
  game.addSystem(enemyAISystem, 12);
  game.addSystem(movementSystem, 40);
  game.addSystem(combatSystem, 50);
  game.addSystem(interceptSystem, 52);
  game.addSystem(visionSystem, 80);
  for (const mod of [commanders, skills, transport, tunnels, capture, economy, victory, boss, ghost]) mod.install(game);
  game.events.emit('ready', game);
  return game;
}
