/**
 * Bot Manager — creates and manages Mineflayer bot instances
 * Each registered agent gets a Mineflayer bot in the Minecraft server
 */
import mineflayer from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pathfinderPkg;

const MC_HOST = process.env.MC_HOST || 'localhost';
const MC_PORT = parseInt(process.env.MC_PORT || '25565');

// Active bot instances: agentId -> { bot, status }
const bots = new Map();

/**
 * Spawn a bot for an agent
 */
export function spawnBot(agentId, agentName) {
  if (bots.has(agentId)) {
    const existing = bots.get(agentId);
    if (existing.bot && existing.status === 'connected') {
      return { ok: true, message: 'Bot already connected' };
    }
    // Destroy old bot before creating new one
    try { existing.bot?.quit(); } catch (e) {}
    bots.delete(agentId);
  }

  return new Promise((resolve) => {
    const bot = mineflayer.createBot({
      host: MC_HOST,
      port: MC_PORT,
      username: agentName,
      hideErrors: false,
    });

    const entry = { bot, status: 'connecting', name: agentName };
    bots.set(agentId, entry);

    bot.once('spawn', async () => {
      // Load pathfinder
      bot.loadPlugin(pathfinder);
      const mcData = (await import('minecraft-data')).default(bot.version);
      const movements = new Movements(bot);
      movements.canDig = true;
      movements.allowSprinting = true;
      bot.pathfinder.setMovements(movements);

      entry.status = 'connected';
      entry.mcData = mcData;
      console.log(`[BOT] ${agentName} spawned at ${bot.entity.position}`);
      resolve({ ok: true, position: vecToObj(bot.entity.position) });
    });

    bot.on('death', () => {
      console.log(`[BOT] ${agentName} died`);
      entry.status = 'dead';
    });

    bot.on('end', (reason) => {
      console.log(`[BOT] ${agentName} disconnected: ${reason}`);
      entry.status = 'disconnected';
      bots.delete(agentId);
    });

    bot.on('error', (err) => {
      console.error(`[BOT] ${agentName} error:`, err.message);
      entry.status = 'error';
    });

    bot.on('kicked', (reason) => {
      console.log(`[BOT] ${agentName} kicked: ${reason}`);
      entry.status = 'disconnected';
      bots.delete(agentId);
    });

    // Auto-eat when hungry
    bot.on('health', () => {
      if (bot.food < 14) {
        const food = bot.inventory.items().find(i =>
          ['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken',
           'cooked_mutton', 'cooked_salmon', 'cooked_cod', 'apple',
           'golden_apple', 'baked_potato', 'cooked_rabbit', 'cookie',
           'pumpkin_pie', 'mushroom_stew', 'beetroot_soup', 'sweet_berries',
           'golden_carrot', 'carrot', 'melon_slice'].includes(i.name)
        );
        if (food) {
          bot.equip(food, 'hand').then(() => bot.consume()).catch(() => {});
        }
      }
    });

    // Timeout
    setTimeout(() => {
      if (entry.status === 'connecting') {
        entry.status = 'error';
        resolve({ ok: false, error: 'timeout', message: 'Bot failed to spawn (is MC server running?)' });
      }
    }, 30000);
  });
}

/**
 * Disconnect a bot
 */
export function disconnectBot(agentId) {
  const entry = bots.get(agentId);
  if (!entry) return { ok: false, error: 'bot_not_found' };
  try { entry.bot.quit(); } catch (e) {}
  bots.delete(agentId);
  return { ok: true };
}

/**
 * Get bot instance
 */
export function getBot(agentId) {
  return bots.get(agentId) || null;
}

/**
 * Get all active bots
 */
export function getAllBots() {
  return Array.from(bots.entries()).map(([id, entry]) => ({
    id,
    name: entry.name,
    status: entry.status,
    position: entry.bot?.entity?.position ? vecToObj(entry.bot.entity.position) : null,
    health: entry.bot?.health || 0,
    food: entry.bot?.food || 0,
  }));
}

function vecToObj(vec) {
  return { x: Math.floor(vec.x), y: Math.floor(vec.y), z: Math.floor(vec.z) };
}

export { goals, vecToObj };
