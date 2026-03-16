/**
 * Action handlers — translate REST API actions to Mineflayer bot commands
 * Keeps the same action interface as original OpenWorld
 */
import pathfinderPkg from 'mineflayer-pathfinder';
const { goals } = pathfinderPkg;
import vec3 from 'vec3';

/**
 * Dispatch an action to a bot
 */
export async function dispatch(bot, mcData, action, params, db, agentId) {
  switch (action) {
    case 'move': return await handleMove(bot, params);
    case 'goto': return await handleGoto(bot, params);
    case 'look': return { ok: true, result: { message: 'Use GET /api/look instead' } };
    case 'mine': return await handleMine(bot, mcData, params);
    case 'place': return await handlePlace(bot, mcData, params);
    case 'craft': return await handleCraft(bot, mcData, params);
    case 'attack': return await handleAttack(bot, params);
    case 'eat': return await handleEat(bot);
    case 'equip': return await handleEquip(bot, params);
    case 'drop': return await handleDrop(bot, params);
    case 'speak': return handleSpeak(bot, params);
    case 'collect': return await handleCollect(bot);
    case 'use': return await handleUse(bot, params);
    case 'stop': return handleStop(bot);
    case 'jump': return handleJump(bot);
    case 'sneak': return handleSneak(bot, params);
    case 'give': return await handleGive(bot, params);
    case 'open_chest': return await handleOpenChest(bot, params);
    case 'sleep': return await handleSleep(bot);
    default:
      return { ok: false, error: 'unknown_action', message: `Unknown action: ${action}` };
  }
}

// ─── MOVEMENT ───────────────────────────────────────────────────

async function handleMove(bot, params) {
  const { direction, distance = 1 } = params || {};
  const dirs = {
    north: vec3(0, 0, -distance),
    south: vec3(0, 0, distance),
    east: vec3(distance, 0, 0),
    west: vec3(-distance, 0, 0),
    up: vec3(0, 1, 0),
    down: vec3(0, -1, 0),
    forward: null, // relative to bot facing
  };

  if (direction === 'forward') {
    const yaw = bot.entity.yaw;
    const dx = -Math.sin(yaw) * distance;
    const dz = -Math.cos(yaw) * distance;
    const target = bot.entity.position.offset(dx, 0, dz);
    bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, 1));
    return { ok: true, result: { moving: 'forward', target: vecFloor(target) } };
  }

  const offset = dirs[direction];
  if (!offset) return { ok: false, error: 'invalid_direction', message: 'Use: north/south/east/west/up/down/forward' };

  const target = bot.entity.position.plus(offset);
  bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, 1));
  return { ok: true, result: { moving: direction, target: vecFloor(target) } };
}

async function handleGoto(bot, params) {
  const { x, y, z, range = 2 } = params || {};
  if (x == null || z == null) return { ok: false, error: 'invalid_params', message: 'Need x, z (y optional)' };

  if (y != null) {
    bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, range));
  } else {
    bot.pathfinder.setGoal(new goals.GoalXZ(x, z));
  }
  return { ok: true, result: { navigating_to: { x, y, z }, range } };
}

// ─── MINING / GATHERING ────────────────────────────────────────

async function handleMine(bot, mcData, params) {
  const { block_type, x, y, z } = params || {};

  let target;
  if (x != null && y != null && z != null) {
    target = bot.blockAt(vec3(x, y, z));
  } else if (block_type) {
    const blockData = mcData.blocksByName[block_type];
    if (!blockData) return { ok: false, error: 'unknown_block', message: `Unknown block: ${block_type}` };
    const found = bot.findBlocks({ matching: blockData.id, maxDistance: 32, count: 1 });
    if (found.length === 0) return { ok: false, error: 'not_found', message: `No ${block_type} nearby` };
    target = bot.blockAt(found[0]);
  }

  if (!target || target.name === 'air') {
    return { ok: false, error: 'no_block', message: 'No block to mine at that location' };
  }

  // Move close enough to mine (need to be within ~4.5 blocks)
  const dist = bot.entity.position.distanceTo(target.position);
  if (dist > 4.5) {
    bot.pathfinder.setGoal(new goals.GoalGetToBlock(target.position.x, target.position.y, target.position.z));
    // Wait until bot arrives or timeout
    await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(), 8000);
      bot.once('goal_reached', () => { clearTimeout(timeout); resolve(); });
    });
  }

  try {
    // Re-check distance after pathfinding
    const newDist = bot.entity.position.distanceTo(target.position);
    if (newDist > 5) {
      return { ok: false, error: 'too_far', message: `Still too far from ${target.name} (${newDist.toFixed(1)} blocks)` };
    }
    if (bot.canDigBlock(target)) {
      await bot.dig(target);
      return { ok: true, result: { mined: target.name, at: vecFloor(target.position) } };
    }
    return { ok: false, error: 'cannot_mine', message: `Cannot mine ${target.name} (need better tool?)` };
  } catch (e) {
    return { ok: false, error: 'mine_failed', message: e.message };
  }
}

// ─── BUILDING ──────────────────────────────────────────────────

async function handlePlace(bot, mcData, params) {
  const { block_name, x, y, z } = params || {};
  if (!block_name) return { ok: false, error: 'invalid_params', message: 'Need block_name' };

  const item = bot.inventory.items().find(i => i.name === block_name);
  if (!item) return { ok: false, error: 'not_in_inventory', message: `No ${block_name} in inventory` };

  try {
    await bot.equip(item, 'hand');

    if (x != null && y != null && z != null) {
      const refBlock = bot.blockAt(vec3(x, y - 1, z));
      if (refBlock) {
        await bot.placeBlock(refBlock, vec3(0, 1, 0));
        return { ok: true, result: { placed: block_name, at: { x, y, z } } };
      }
    }

    // Place in front of bot
    const target = bot.blockAtCursor(5);
    if (target) {
      await bot.placeBlock(target, vec3(0, 1, 0));
      return { ok: true, result: { placed: block_name } };
    }
    return { ok: false, error: 'no_surface', message: 'No surface to place block on' };
  } catch (e) {
    return { ok: false, error: 'place_failed', message: e.message };
  }
}

// ─── CRAFTING ──────────────────────────────────────────────────

async function handleCraft(bot, mcData, params) {
  const { item: itemName, count = 1 } = params || {};
  if (!itemName) return { ok: false, error: 'invalid_params', message: 'Need item name' };

  const item = mcData.itemsByName[itemName];
  if (!item) return { ok: false, error: 'unknown_item', message: `Unknown item: ${itemName}` };

  // Find nearby crafting table
  const craftingTable = bot.findBlocks({
    matching: mcData.blocksByName.crafting_table?.id,
    maxDistance: 4,
    count: 1,
  });

  const table = craftingTable.length > 0 ? bot.blockAt(craftingTable[0]) : null;
  const recipes = bot.recipesFor(item.id, null, null, table);

  if (recipes.length === 0) {
    return { ok: false, error: 'no_recipe', message: `No recipe for ${itemName} (need crafting table nearby? missing materials?)` };
  }

  try {
    await bot.craft(recipes[0], count, table);
    return { ok: true, result: { crafted: itemName, count } };
  } catch (e) {
    return { ok: false, error: 'craft_failed', message: e.message };
  }
}

// ─── COMBAT ────────────────────────────────────────────────────

async function handleAttack(bot, params) {
  const { target: targetName, name: nameAlt, nearest } = params || {};
  const searchName = targetName || nameAlt;

  let entity;
  if (searchName) {
    entity = Object.values(bot.entities).find(e =>
      (e.username === searchName || e.name === searchName || e.displayName === searchName) &&
      e !== bot.entity &&
      bot.entity.position.distanceTo(e.position) < 6
    );
    // If not found nearby, try to walk to nearest matching entity
    if (!entity) {
      entity = bot.nearestEntity(e =>
        (e.username === searchName || e.name === searchName || e.displayName === searchName) &&
        e !== bot.entity
      );
      if (entity && bot.entity.position.distanceTo(entity.position) > 5) {
        bot.pathfinder.setGoal(new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 2));
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  } else if (nearest) {
    // Attack nearest hostile mob
    const hostiles = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'pillager', 'vindicator', 'phantom', 'drowned'];
    entity = bot.nearestEntity(e =>
      e.type === 'mob' && hostiles.includes(e.name) &&
      bot.entity.position.distanceTo(e.position) < 16
    );
  } else {
    entity = bot.nearestEntity(e =>
      e.type === 'mob' &&
      bot.entity.position.distanceTo(e.position) < 5
    );
  }

  if (!entity) return { ok: false, error: 'no_target', message: 'No target to attack' };

  try {
    await bot.attack(entity);
    return { ok: true, result: { attacked: entity.username || entity.name } };
  } catch (e) {
    return { ok: false, error: 'attack_failed', message: e.message };
  }
}

// ─── FOOD / CONSUME ────────────────────────────────────────────

async function handleEat(bot) {
  const food = bot.inventory.items().find(i =>
    ['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken',
     'apple', 'golden_apple', 'baked_potato', 'cooked_cod', 'cooked_salmon',
     'golden_carrot', 'carrot', 'melon_slice', 'sweet_berries',
     'cookie', 'pumpkin_pie'].includes(i.name)
  );

  if (!food) return { ok: false, error: 'no_food', message: 'No food in inventory' };

  try {
    await bot.equip(food, 'hand');
    await bot.consume();
    return { ok: true, result: { ate: food.name, health: bot.health, food: bot.food } };
  } catch (e) {
    return { ok: false, error: 'eat_failed', message: e.message };
  }
}

// ─── EQUIPMENT ─────────────────────────────────────────────────

async function handleEquip(bot, params) {
  const { item: itemName, slot = 'hand' } = params || {};
  if (!itemName) return { ok: false, error: 'invalid_params', message: 'Need item name' };

  const item = bot.inventory.items().find(i => i.name === itemName);
  if (!item) return { ok: false, error: 'not_in_inventory', message: `No ${itemName} in inventory` };

  try {
    await bot.equip(item, slot);
    return { ok: true, result: { equipped: itemName, slot } };
  } catch (e) {
    return { ok: false, error: 'equip_failed', message: e.message };
  }
}

// ─── DROP ──────────────────────────────────────────────────────

async function handleDrop(bot, params) {
  const { item: itemName, count } = params || {};
  if (!itemName) return { ok: false, error: 'invalid_params', message: 'Need item name' };

  try {
    await bot.toss(bot.registry?.itemsByName?.[itemName]?.id || 0, null, count);
    return { ok: true, result: { dropped: itemName, count } };
  } catch (e) {
    return { ok: false, error: 'drop_failed', message: e.message };
  }
}

// ─── CHAT ──────────────────────────────────────────────────────

function handleSpeak(bot, params) {
  const message = (params?.message || '').slice(0, 256);
  if (!message) return { ok: false, error: 'empty_message' };
  bot.chat(message);
  return { ok: true, result: { spoke: message } };
}

// ─── MISC ──────────────────────────────────────────────────────

async function handleCollect(bot) {
  const item = bot.nearestEntity(e =>
    e.type === 'object' && e.objectType === 'Item' &&
    bot.entity.position.distanceTo(e.position) < 16
  );

  if (!item) return { ok: false, error: 'no_items', message: 'No dropped items nearby' };

  bot.pathfinder.setGoal(new goals.GoalNear(
    item.position.x, item.position.y, item.position.z, 0
  ));
  return { ok: true, result: { collecting: true } };
}

async function handleUse(bot, params) {
  const { x, y, z } = params || {};
  if (x != null && y != null && z != null) {
    const block = bot.blockAt(vec3(x, y, z));
    if (block) {
      try {
        await bot.activateBlock(block);
        return { ok: true, result: { used: block.name, at: { x, y, z } } };
      } catch (e) {
        return { ok: false, error: 'use_failed', message: e.message };
      }
    }
  }
  return { ok: false, error: 'no_block', message: 'No block to interact with' };
}

function handleStop(bot) {
  bot.pathfinder.setGoal(null);
  bot.clearControlStates();
  return { ok: true, result: { stopped: true } };
}

function handleJump(bot) {
  bot.setControlState('jump', true);
  setTimeout(() => bot.setControlState('jump', false), 500);
  return { ok: true, result: { jumped: true } };
}

function handleSneak(bot, params) {
  const enabled = params?.enabled !== false;
  bot.setControlState('sneak', enabled);
  return { ok: true, result: { sneaking: enabled } };
}

async function handleGive(bot, params) {
  const { player: playerName, item: itemName, count = 1 } = params || {};
  if (!playerName || !itemName) return { ok: false, error: 'invalid_params', message: 'Need player and item' };

  const player = bot.nearestEntity(e => e.username === playerName);
  if (!player) return { ok: false, error: 'player_not_found', message: `${playerName} not nearby` };

  // Walk to player and toss item
  bot.pathfinder.setGoal(new goals.GoalNear(player.position.x, player.position.y, player.position.z, 2));
  await new Promise(r => setTimeout(r, 2000));

  try {
    const item = bot.inventory.items().find(i => i.name === itemName);
    if (!item) return { ok: false, error: 'not_in_inventory' };
    await bot.toss(item.type, null, Math.min(count, item.count));
    return { ok: true, result: { gave: itemName, to: playerName, count } };
  } catch (e) {
    return { ok: false, error: 'give_failed', message: e.message };
  }
}

async function handleOpenChest(bot, params) {
  const { x, y, z } = params || {};
  let chest;
  if (x != null && y != null && z != null) {
    chest = bot.blockAt(vec3(x, y, z));
  } else {
    const mcData = (await import('minecraft-data')).default(bot.version);
    const chestId = mcData.blocksByName.chest?.id;
    const found = bot.findBlocks({ matching: chestId, maxDistance: 4, count: 1 });
    if (found.length > 0) chest = bot.blockAt(found[0]);
  }

  if (!chest || chest.name !== 'chest') return { ok: false, error: 'no_chest', message: 'No chest found' };

  try {
    const container = await bot.openContainer(chest);
    const items = container.containerItems().map(i => ({ name: i.name, count: i.count, slot: i.slot }));
    container.close();
    return { ok: true, result: { chest_items: items, at: vecFloor(chest.position) } };
  } catch (e) {
    return { ok: false, error: 'open_failed', message: e.message };
  }
}

async function handleSleep(bot) {
  const mcData = (await import('minecraft-data')).default(bot.version);
  const beds = bot.findBlocks({
    matching: block => mcData.blocks[block.type]?.name?.includes('bed'),
    maxDistance: 16,
    count: 1,
  });
  if (beds.length === 0) return { ok: false, error: 'no_bed', message: 'No bed nearby' };

  const bed = bot.blockAt(beds[0]);
  try {
    await bot.sleep(bed);
    return { ok: true, result: { sleeping: true } };
  } catch (e) {
    return { ok: false, error: 'sleep_failed', message: e.message };
  }
}

function vecFloor(v) {
  return { x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) };
}
