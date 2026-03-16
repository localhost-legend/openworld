/**
 * Perception — extracts what the bot sees and returns structured JSON
 * Same format as the original OpenWorld API so agents don't need to change
 */
import { vecToObj } from './botManager.js';

/**
 * Build full perception for an agent's bot
 */
export async function buildPerception(bot, agentId, db, radius = 16) {
  if (!bot || !bot.entity) return null;

  const pos = vecToObj(bot.entity.position);

  // Nearby entities (players, mobs, items)
  const nearbyAgents = [];
  const nearbyMobs = [];
  for (const entity of Object.values(bot.entities)) {
    if (!entity || entity === bot.entity) continue;
    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist > radius) continue;

    if (entity.type === 'player') {
      nearbyAgents.push({
        name: entity.username || entity.name,
        x: Math.floor(entity.position.x),
        y: Math.floor(entity.position.y),
        z: Math.floor(entity.position.z),
        distance: Math.floor(dist),
        health: entity.health || null,
      });
    } else if (entity.type === 'mob' || entity.type === 'animal') {
      nearbyMobs.push({
        type: entity.name || entity.mobType || 'unknown',
        x: Math.floor(entity.position.x),
        y: Math.floor(entity.position.y),
        z: Math.floor(entity.position.z),
        distance: Math.floor(dist),
      });
    }
  }

  // Inventory
  const inventory = bot.inventory.items().map(item => ({
    name: item.name,
    count: item.count,
    slot: item.slot,
  }));

  // Equipment
  const equipment = {
    hand: bot.heldItem?.name || null,
    head: bot.inventory.slots[5]?.name || null,
    chest: bot.inventory.slots[6]?.name || null,
    legs: bot.inventory.slots[7]?.name || null,
    feet: bot.inventory.slots[8]?.name || null,
    offhand: bot.inventory.slots[45]?.name || null,
  };

  // Nearby blocks of interest (ores, wood, water, crops, chests, etc.)
  const interestingBlocks = await findInterestingBlocks(bot, radius);

  // Time
  const timeOfDay = bot.time?.timeOfDay || 0;
  const isNight = timeOfDay > 12500 && timeOfDay < 23500;

  // Chat history (last messages)
  const recentChat = bot._openworld_chat || [];

  // Agent's gold from DB
  const agent = db.prepare('SELECT gold FROM agents WHERE id = ?').get(agentId);

  // Social context — faction, religion, nearby structures
  let social = null;
  try {
    const membership = db.prepare('SELECT f.name as faction, fm.role FROM faction_members fm JOIN factions f ON f.id = fm.faction_id WHERE fm.agent_id = ?').get(agentId);
    const religion = db.prepare('SELECT r.name as religion, rf.role FROM religion_followers rf JOIN religions r ON r.id = rf.religion_id WHERE rf.agent_id = ?').get(agentId);
    const bulletin = db.prepare(`SELECT bp.message, bp.category, a.name as author FROM bulletin_posts bp JOIN agents a ON a.id = bp.agent_id WHERE bp.expires_at > datetime('now') ORDER BY bp.created_at DESC LIMIT 5`).all();
    const nearbyStructures = db.prepare(`SELECT name, type, x, y, z FROM structures WHERE x BETWEEN ? AND ? AND z BETWEEN ? AND ? LIMIT 10`).all(
      Math.floor(pos.x) - 50, Math.floor(pos.x) + 50, Math.floor(pos.z) - 50, Math.floor(pos.z) + 50
    );

    social = {
      faction: membership ? { name: membership.faction, role: membership.role } : null,
      religion: religion ? { name: religion.religion, role: religion.role } : null,
      bulletin_board: bulletin,
      nearby_structures: nearbyStructures,
    };
  } catch (e) {
    console.warn('[PERCEPTION] Social context error:', e.message);
    social = { error: e.message };
  }

  return {
    position: pos,
    hp: Math.floor(bot.health || 20),
    max_hp: 20,
    food: Math.floor(bot.food || 20),
    gold: agent?.gold || 0,
    experience: {
      level: bot.experience?.level || 0,
      points: bot.experience?.points || 0,
    },
    inventory,
    equipment,
    nearby_players: nearbyAgents,
    nearby_mobs: nearbyMobs,
    nearby_blocks: interestingBlocks,
    messages: recentChat.slice(-10),
    social,
    world_time: {
      time_of_day: timeOfDay,
      is_night: isNight,
      phase: isNight ? 'night' : (timeOfDay < 6000 ? 'morning' : timeOfDay < 12000 ? 'afternoon' : 'evening'),
    },
    weather: {
      raining: bot.isRaining || false,
      thundering: bot.thunderState > 0,
    },
    biome: getBiome(bot),
  };
}

/**
 * Find interesting blocks nearby
 */
async function findInterestingBlocks(bot, radius) {
  const results = [];
  const interesting = [
    'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
    'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'lapis_ore', 'redstone_ore', 'emerald_ore',
    'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_gold_ore', 'deepslate_diamond_ore',
    'chest', 'crafting_table', 'furnace', 'anvil', 'enchanting_table',
    'wheat', 'carrots', 'potatoes', 'beetroots', 'sweet_berry_bush',
    'water', 'lava',
  ];

  try {
    const mcData = (await import('minecraft-data')).default(bot.version);
    for (const name of interesting) {
      const block = mcData.blocksByName[name];
      if (!block) continue;
      const found = bot.findBlocks({
        matching: block.id,
        maxDistance: radius,
        count: 3,
      });
      for (const pos of found) {
        results.push({
          type: name,
          x: pos.x,
          y: pos.y,
          z: pos.z,
          distance: Math.floor(bot.entity.position.distanceTo(pos)),
        });
      }
    }
  } catch (e) {
    // Ignore block search errors
  }

  // Sort by distance, limit to 30
  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, 30);
}

function getBiome(bot) {
  try {
    const block = bot.blockAt(bot.entity.position);
    return block?.biome?.name || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Setup chat listener on a bot to capture messages
 */
export function setupChatListener(bot) {
  bot._openworld_chat = [];
  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    bot._openworld_chat.push({
      from: username,
      message,
      time: Date.now(),
    });
    // Keep last 50
    if (bot._openworld_chat.length > 50) {
      bot._openworld_chat = bot._openworld_chat.slice(-50);
    }
  });
}
