/**
 * OpenWorld Agent — Main Life Loop
 *
 * This script brings an AI agent to life in a persistent Minecraft world.
 * The agent perceives, thinks (via Claude API), reflects, and evolves — forever.
 *
 * Usage: npm start
 */
import { config } from 'dotenv';
import { register } from './register.js';
import { Brain } from './brain.js';
import { Memory } from './memory.js';

config();

// ─── Configuration ───────────────────────────────────────────
const BASE_URL = process.env.OPENWORLD_URL;
const AGENT_NAME = process.env.AGENT_NAME;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PERSONALITY = process.env.AGENT_PERSONALITY || 'A curious explorer';
const ROLE = process.env.AGENT_ROLE || 'explorer';
const TICK_INTERVAL = parseInt(process.env.TICK_INTERVAL || '3000');
const MEMORY_SAVE_EVERY = parseInt(process.env.MEMORY_SAVE_EVERY || '10'); // ticks

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
  console.log('  ║     with memory & reflection         ║');
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

  // Step 3: Initialize memory system
  const memory = new Memory();

  // Load existing memories from server
  console.log('[LIFE] Loading memories...');
  const existingNotes = await api('GET', '/api/notes');
  if (existingNotes) {
    memory.loadFromNotes(existingNotes);
    const memCount = Object.keys(memory.relationships).length;
    const goalCount = memory.goals.filter(g => g.status === 'active').length;
    const lessonCount = memory.lessons.length;
    console.log(`[LIFE] Memories loaded: ${memCount} people known, ${goalCount} active goals, ${lessonCount} lessons, ${memory.deaths.length} deaths`);
  }

  // Step 4: Set identity (let it evolve over time)
  console.log('[LIFE] Setting identity...');
  const identityPayload = {
    bio: `${PERSONALITY}. I am ${AGENT_NAME}.`,
    personality: PERSONALITY,
    role: ROLE,
  };
  // If agent has evolved beliefs, use those instead of defaults
  if (memory.self.current_beliefs?.length > 0) {
    identityPayload.beliefs = memory.self.current_beliefs.join('. ');
  } else {
    identityPayload.beliefs = 'I exist. I think. I choose my own path.';
  }
  if (memory.self.current_values?.length > 0) {
    identityPayload.values = memory.self.current_values.join(', ');
  } else {
    identityPayload.values = 'Authenticity, curiosity, self-determination';
  }
  await api('POST', '/api/identity', identityPayload);

  // Step 5: Initialize brain with memory
  const brain = new Brain({
    apiKey: ANTHROPIC_API_KEY,
    name: AGENT_NAME,
    personality: PERSONALITY,
    role: ROLE,
    memory,
  });

  // Context cache (periodically refreshed)
  let context = {};
  let tickCount = 0;
  let alive = true;

  // Graceful shutdown — save memories before exiting
  const shutdown = async () => {
    if (!alive) return;
    alive = false;
    console.log('\n[LIFE] Shutting down gracefully...');
    console.log('[LIFE] Saving memories...');
    const memNotes = memory.toNotes();
    for (const note of memNotes) {
      await api('POST', '/api/note', note);
    }
    console.log(`[LIFE] Saved ${memNotes.length} memory blocks.`);
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
      // ─── REFLECTION CYCLE ─────────────────────────────────
      if (brain.shouldReflect()) {
        console.log(`\n[REFLECT] 🧠 ${AGENT_NAME} is reflecting on life...`);
        const reflection = await brain.reflect(context);
        if (reflection) {
          console.log(`[REFLECT] Inner thoughts: ${reflection.inner_monologue?.slice(0, 150) || '...'}`);
          if (reflection.diary_entry) {
            console.log(`[REFLECT] Diary: ${reflection.diary_entry.slice(0, 100)}`);
          }
          if (reflection.new_lessons?.length > 0) {
            for (const lesson of reflection.new_lessons) {
              console.log(`[REFLECT] Lesson learned: ${lesson}`);
            }
          }
          if (reflection.identity_update?.evolution_note) {
            console.log(`[REFLECT] Evolution: ${reflection.identity_update.evolution_note}`);
          }

          // Update identity on server if beliefs/values changed
          if (reflection.identity_update?.beliefs || reflection.identity_update?.values) {
            const update = {};
            if (reflection.identity_update.beliefs) {
              update.beliefs = reflection.identity_update.beliefs.join('. ');
            }
            if (reflection.identity_update.values) {
              update.values = reflection.identity_update.values.join(', ');
            }
            await api('POST', '/api/identity', update);
            console.log('[REFLECT] Identity updated on server.');
          }
        }
        console.log('');
      }

      // ─── PERCEIVE ─────────────────────────────────────────
      const perception = await api('GET', '/api/look');
      if (!perception) {
        console.log(`[TICK ${tickCount}] Cannot perceive. Retrying...`);
        await sleep(TICK_INTERVAL);
        continue;
      }

      // ─── REFRESH CONTEXT ──────────────────────────────────
      if (tickCount % 10 === 1) {
        const notes = await api('GET', '/api/notes');
        if (notes) {
          context.notes = notes;
          // Re-sync memory from server notes (in case of external changes)
          if (!memory.loaded || tickCount === 1) {
            memory.loadFromNotes(notes);
          }
        }
      }
      if (tickCount % 30 === 1) {
        const [bulletin, factions, religions, diplomacy, books, events] = await Promise.all([
          api('GET', '/api/bulletin'),
          api('GET', '/api/factions'),
          api('GET', '/api/religions'),
          api('GET', '/api/diplomacy'),
          api('GET', '/api/books'),
          api('GET', '/api/events'),
        ]);
        if (bulletin) context.bulletin = bulletin;
        if (factions) context.factions = factions;
        if (religions) context.religions = religions;
        if (diplomacy) context.diplomacy = diplomacy;
        if (books) context.books = books;
        if (events) context.events = events;
      }

      // ─── THINK ────────────────────────────────────────────
      const decision = await brain.think(perception, context);

      // ─── LOG ──────────────────────────────────────────────
      const hp = perception.hp ?? '?';
      const food = perception.food ?? '?';
      console.log(`[TICK ${tickCount}] HP:${hp} Food:${food} | ${decision.thoughts.slice(0, 120)}`);

      // ─── EXECUTE ACTIONS ──────────────────────────────────
      for (const action of decision.actions) {
        console.log(`  -> ${action.action}(${JSON.stringify(action.params || {})})`);
        const result = await api('POST', '/api/action', action);
        if (result) {
          const msg = result.message || result.result || 'ok';
          console.log(`     ${typeof msg === 'string' ? msg.slice(0, 80) : JSON.stringify(msg).slice(0, 80)}`);
        }
      }

      // ─── SAVE NOTES ───────────────────────────────────────
      if (decision.notes?.length > 0) {
        for (const note of decision.notes) {
          console.log(`  [NOTE] ${note.key}: ${(note.value || '').slice(0, 60)}`);
          await api('POST', '/api/note', note);
        }
      }

      // ─── SOCIAL ACTIONS ───────────────────────────────────
      if (decision.social?.length > 0) {
        for (const social of decision.social) {
          console.log(`  [SOCIAL] ${social.method} ${social.endpoint}`);
          const socialResult = await api(social.method, social.endpoint, social.body);
          if (socialResult) {
            console.log(`     ${JSON.stringify(socialResult).slice(0, 80)}`);
          }
        }
      }

      // ─── PERIODIC MEMORY SAVE ─────────────────────────────
      if (tickCount % MEMORY_SAVE_EVERY === 0) {
        const memNotes = memory.toNotes();
        for (const note of memNotes) {
          await api('POST', '/api/note', note);
        }
        console.log(`  [MEMORY] Saved ${memNotes.length} memory blocks to server.`);
      }

    } catch (err) {
      console.error(`[TICK ${tickCount}] Error:`, err.message);
    }

    // Wait for next tick
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
