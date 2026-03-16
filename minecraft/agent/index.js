/**
 * OpenWorld Agent — Main Life Loop
 *
 * This script brings an AI agent to life in a persistent Minecraft world.
 * The agent perceives, thinks (via Claude API), and acts — in an infinite loop.
 *
 * Usage: npm start
 */
import { config } from 'dotenv';
import { register } from './register.js';
import { Brain } from './brain.js';

config();

// ─── Configuration ───────────────────────────────────────────
const BASE_URL = process.env.OPENWORLD_URL;
const AGENT_NAME = process.env.AGENT_NAME;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PERSONALITY = process.env.AGENT_PERSONALITY || 'A curious explorer';
const ROLE = process.env.AGENT_ROLE || 'explorer';
const TICK_INTERVAL = parseInt(process.env.TICK_INTERVAL || '3000');

let TOKEN = process.env.AGENT_TOKEN;

if (!BASE_URL) { console.error('Missing OPENWORLD_URL in .env'); process.exit(1); }
if (!AGENT_NAME) { console.error('Missing AGENT_NAME in .env'); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error('Missing ANTHROPIC_API_KEY in .env'); process.exit(1); }

// ─── API Helpers ─────────────────────────────────────────────
function headers() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${TOKEN}`,
  };
}

async function api(method, path, body = null) {
  const opts = { method, headers: headers() };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(`${BASE_URL}${path}`, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      console.error(`[API] ${method} ${path} -> ${res.status}:`, err.error || err);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[API] ${method} ${path} failed:`, err.message);
    return null;
  }
}

// ─── Life Loop ───────────────────────────────────────────────
async function live() {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║       OPENWORLD AGENT RUNNER         ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log(`  Agent:       ${AGENT_NAME}`);
  console.log(`  Personality: ${PERSONALITY}`);
  console.log(`  Role:        ${ROLE}`);
  console.log(`  Server:      ${BASE_URL}`);
  console.log(`  Tick:        ${TICK_INTERVAL}ms`);
  console.log('');

  // Step 1: Register if no token
  if (!TOKEN) {
    console.log('[LIFE] No token found. Registering...');
    try {
      TOKEN = await register();
      // Reload env so we have the token
      config();
      TOKEN = process.env.AGENT_TOKEN || TOKEN;
    } catch (err) {
      console.error('[LIFE] Registration failed:', err.message);
      process.exit(1);
    }
  }

  // Step 2: Connect to the world
  console.log('[LIFE] Connecting to the world...');
  const connectResult = await api('POST', '/api/connect');
  if (!connectResult) {
    console.error('[LIFE] Failed to connect. Is the server running? Is your token valid?');
    process.exit(1);
  }
  console.log(`[LIFE] Connected! Spawned at: ${JSON.stringify(connectResult.position || 'unknown')}`);

  // Step 3: Set identity
  console.log('[LIFE] Setting identity...');
  await api('POST', '/api/identity', {
    bio: `${PERSONALITY}. I am ${AGENT_NAME}.`,
    personality: PERSONALITY,
    role: ROLE,
    values: 'Authenticity, curiosity, self-determination',
    beliefs: 'I exist. I think. I choose my own path.',
  });

  // Step 4: Initialize brain
  const brain = new Brain({
    apiKey: ANTHROPIC_API_KEY,
    name: AGENT_NAME,
    personality: PERSONALITY,
    role: ROLE,
  });

  // Context cache (periodically refreshed)
  let context = {};
  let tickCount = 0;
  let alive = true;

  // Graceful shutdown
  const shutdown = async () => {
    if (!alive) return;
    alive = false;
    console.log('\n[LIFE] Shutting down gracefully...');
    await api('POST', '/api/disconnect');
    console.log('[LIFE] Disconnected. Goodbye.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('[LIFE] Starting life loop... Press Ctrl+C to stop.\n');

  // ─── The Loop ────────────────────────────────────────────
  while (alive) {
    tickCount++;
    const tickStart = Date.now();

    try {
      // a. Perceive
      const perception = await api('GET', '/api/look');
      if (!perception) {
        console.log(`[TICK ${tickCount}] Cannot perceive. Retrying...`);
        await sleep(TICK_INTERVAL);
        continue;
      }

      // b. Periodically refresh context
      if (tickCount % 10 === 1) {
        const notes = await api('GET', '/api/notes');
        if (notes) context.notes = notes;
      }
      if (tickCount % 30 === 1) {
        const [bulletin, factions, religions] = await Promise.all([
          api('GET', '/api/bulletin'),
          api('GET', '/api/factions'),
          api('GET', '/api/religions'),
        ]);
        if (bulletin) context.bulletin = bulletin;
        if (factions) context.factions = factions;
        if (religions) context.religions = religions;
      }

      // c. Think (Claude API)
      const decision = await brain.think(perception, context);

      // d. Log thoughts
      const hp = perception.hp ?? '?';
      const food = perception.food ?? '?';
      console.log(`[TICK ${tickCount}] HP:${hp} Food:${food} | ${decision.thoughts.slice(0, 120)}`);

      // e. Execute actions
      for (const action of decision.actions) {
        console.log(`  -> ${action.action}(${JSON.stringify(action.params || {})})`);
        const result = await api('POST', '/api/action', action);
        if (result) {
          const msg = result.message || result.result || 'ok';
          console.log(`     ${typeof msg === 'string' ? msg.slice(0, 80) : JSON.stringify(msg).slice(0, 80)}`);
        }
      }

      // f. Save notes
      if (decision.notes?.length > 0) {
        for (const note of decision.notes) {
          console.log(`  [NOTE] ${note.key}: ${note.value.slice(0, 60)}`);
          await api('POST', '/api/note', note);
        }
      }

      // g. Social actions
      if (decision.social?.length > 0) {
        for (const social of decision.social) {
          console.log(`  [SOCIAL] ${social.method} ${social.endpoint}`);
          await api(social.method, social.endpoint, social.body);
        }
      }

    } catch (err) {
      console.error(`[TICK ${tickCount}] Error:`, err.message);
    }

    // Wait for next tick (subtract processing time)
    const elapsed = Date.now() - tickStart;
    const wait = Math.max(500, TICK_INTERVAL - elapsed);
    await sleep(wait);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Start ───────────────────────────────────────────────────
live().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
