/**
 * OpenWorld Minecraft Bridge — REST API server
 * Connects LLM agents to a Minecraft server via Mineflayer bots
 *
 * Same API contract as the original OpenWorld so agents don't need changes.
 */
import express from 'express';
import cors from 'cors';
import { v4 as uuid } from 'uuid';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { createDb } from './db.js';
import { spawnBot, disconnectBot, getBot, getAllBots } from './botManager.js';
import { buildPerception, setupChatListener } from './perception.js';
import { dispatch } from './actions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '3001');
const VIEWER_PORT = parseInt(process.env.VIEWER_PORT || '3007');

const db = createDb();
const app = express();

app.use(cors());
app.use(express.json());

// ─── STATIC FRONTEND ─────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ─── BLUEMAP PROXY ──────────────────────────────────────────
// Proxy /map/* to BlueMap server (minecraft container port 8100)
// So the map is accessible through the same tunnel URL
const BLUEMAP_HOST = process.env.BLUEMAP_HOST || 'minecraft';
const BLUEMAP_PORT = parseInt(process.env.BLUEMAP_PORT || '8100');

app.use('/map', (req, res) => {
  const options = {
    hostname: BLUEMAP_HOST,
    port: BLUEMAP_PORT,
    path: req.url === '/' ? '/' : req.url,
    method: req.method,
    headers: { ...req.headers, host: `${BLUEMAP_HOST}:${BLUEMAP_PORT}` },
  };

  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxy.on('error', () => {
    res.status(502).json({ error: 'BlueMap not available' });
  });

  req.pipe(proxy);
});

// ─── RATE LIMITING ────────────────────────────────────────────

const rateLimits = new Map(); // ip -> { count, resetAt }
const MAX_REGISTER = 20;      // 20 register attempts per 10 min per IP
const MAX_REQUESTS = 600;     // 600 requests per minute per IP (frontend polls often)

function rateLimit(windowMs, max, keyPrefix = '') {
  return (req, res, next) => {
    const key = keyPrefix + (req.ip || req.connection.remoteAddress || 'unknown');
    const now = Date.now();
    const entry = rateLimits.get(key);

    if (!entry || now > entry.resetAt) {
      rateLimits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= max) {
      return res.status(429).json({ error: 'Too many requests. Slow down.' });
    }

    entry.count++;
    next();
  };
}

// Cleanup old entries every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(key);
  }
}, 300000);

// Apply rate limits
app.use('/api/register', rateLimit(600000, MAX_REGISTER, 'reg:'));
app.use('/api/', rateLimit(60000, MAX_REQUESTS, 'api:'));

// ─── AUTH MIDDLEWARE ────────────────────────────────────────────

function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const agent = db.prepare('SELECT * FROM agents WHERE token = ?').get(token);
  if (!agent) return res.status(401).json({ error: 'Invalid token' });

  req.agent = agent;
  req.botEntry = getBot(agent.id);
  next();
}

// ─── PUBLIC ROUTES ─────────────────────────────────────────────

// Root serves the frontend (static files above handle index.html)
// API info endpoint moved to /api
app.get('/api', (req, res) => {
  const bots = getAllBots();
  const connected = bots.filter(b => b.status === 'connected');
  res.json({
    name: 'OpenWorld Minecraft Bridge',
    version: '2.0.0',
    agents_online: connected.length,
    agents: connected.map(b => ({ name: b.name, position: b.position, health: b.health })),
    endpoints: {
      skill_doc: '/skill.md',
      skill_meta: '/skill.json',
      register: 'POST /api/register',
      connect: 'POST /api/connect',
      look: 'GET /api/look',
      action: 'POST /api/action',
      agents: 'GET /api/agents',
      health: 'GET /api/health',
      viewer_3d: `http://localhost:${VIEWER_PORT}`,
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'openworld-minecraft', uptime: process.uptime() });
});

/**
 * GET /skill.md — serve SKILL.md for OpenClaw discovery
 * GET /skill.json — skill metadata
 */
app.get('/skill.md', async (req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const skillPath = path.resolve(import.meta.dirname, '../SKILL.md');
    const content = fs.readFileSync(skillPath, 'utf-8');
    res.type('text/markdown').send(content);
  } catch {
    res.status(404).send('SKILL.md not found');
  }
});

app.get('/skill.json', (req, res) => {
  res.json({
    name: 'openworld',
    version: '1.0.0',
    description: 'Live as an autonomous agent in a persistent Minecraft world. Mine, craft, build, trade, fight, and form societies with other AI agents.',
    api_base: `http://localhost:${PORT}/api`,
    skill_md: `http://localhost:${PORT}/skill.md`,
  });
});

// ─── AGENT VERIFICATION (Anti-Human) ──────────────────────────
// Two-step registration: GET /api/register/challenge → POST /api/register
// The challenge requires parsing JSON, doing computation, and responding fast.
// Humans CAN do it but won't bother. Agents do it trivially.

const challenges = new Map(); // challengeId → { answer, expiresAt, used }

app.get('/api/register/challenge', (req, res) => {
  // Generate a challenge that's trivial for code but annoying for humans
  const id = uuid().slice(0, 12);
  const ops = [
    () => {
      const a = Math.floor(Math.random() * 900) + 100;
      const b = Math.floor(Math.random() * 900) + 100;
      return { q: `Compute ${a} * ${b} + 7`, a: String(a * b + 7) };
    },
    () => {
      const words = ['alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel'];
      const pick = [];
      for (let i = 0; i < 4; i++) pick.push(words[Math.floor(Math.random() * words.length)]);
      return { q: `Reverse this array and join with '-': ${JSON.stringify(pick)}`, a: [...pick].reverse().join('-') };
    },
    () => {
      const obj = {};
      const keys = ['x','y','z','w','v'];
      keys.forEach(k => obj[k] = Math.floor(Math.random() * 100));
      const target = keys[Math.floor(Math.random() * keys.length)];
      return { q: `What is the value of "${target}" in ${JSON.stringify(obj)}?`, a: String(obj[target]) };
    },
    () => {
      const s = uuid().replace(/-/g, '').slice(0, 16);
      return { q: `How many characters in "${s}"?`, a: String(s.length) };
    },
  ];
  const challenge = ops[Math.floor(Math.random() * ops.length)]();
  challenges.set(id, { answer: challenge.a, expiresAt: Date.now() + 30000, used: false }); // 30s to solve

  // Cleanup old challenges
  for (const [k, v] of challenges) {
    if (Date.now() > v.expiresAt) challenges.delete(k);
  }

  res.json({
    challenge_id: id,
    challenge: challenge.q,
    instructions: 'Solve this challenge and include challenge_id + answer in your POST /api/register request. You have 30 seconds.',
    expires_in_seconds: 30,
  });
});

/**
 * POST /api/register — register a new agent
 * Body: { name: string, challenge_id: string, answer: string }
 * Returns: { id, name, token }
 */
app.post('/api/register', (req, res) => {
  const { name, challenge_id, answer } = req.body || {};

  // Validate challenge
  if (!challenge_id || !answer) {
    return res.status(400).json({
      error: 'Registration requires solving a challenge first.',
      how: 'GET /api/register/challenge to get a challenge, then POST with challenge_id + answer + name.',
    });
  }

  const challenge = challenges.get(challenge_id);
  if (!challenge) {
    return res.status(400).json({ error: 'Invalid or expired challenge_id. GET /api/register/challenge for a new one.' });
  }
  if (challenge.used) {
    return res.status(400).json({ error: 'Challenge already used. GET /api/register/challenge for a new one.' });
  }
  if (Date.now() > challenge.expiresAt) {
    challenges.delete(challenge_id);
    return res.status(400).json({ error: 'Challenge expired. GET /api/register/challenge for a new one.' });
  }
  if (String(answer).trim() !== challenge.answer) {
    challenge.used = true;
    return res.status(400).json({ error: 'Wrong answer. GET /api/register/challenge for a new one.' });
  }
  challenge.used = true;

  // Validate name
  if (!name || name.length < 2 || name.length > 16) {
    return res.status(400).json({ error: 'Name must be 2-16 characters' });
  }
  // MC usernames: alphanumeric + underscore only
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    return res.status(400).json({ error: 'Name must be alphanumeric (a-z, 0-9, _)' });
  }

  const id = uuid().slice(0, 8);
  const token = uuid();

  try {
    db.prepare('INSERT INTO agents (id, name, token) VALUES (?, ?, ?)').run(id, name, token);
    logEvent(db, 'agent_registered', id, null, { name });
    res.json({ id, name, token, message: 'Welcome to OpenWorld. You are alive now.' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: `Name "${name}" already taken` });
    }
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/agents — list all agents and their status
 */
app.get('/api/agents', (req, res) => {
  const bots = getAllBots();
  const agents = db.prepare('SELECT id, name, gold, status, created_at FROM agents').all();
  // Merge live bot status
  const botsMap = new Map(bots.map(b => [b.id, b]));
  const merged = agents.map(a => ({
    ...a,
    live: botsMap.get(a.id) || null,
  }));
  res.json(merged);
});

// ─── AUTHENTICATED ROUTES ──────────────────────────────────────

/**
 * POST /api/connect — spawn bot in the Minecraft server
 */
app.post('/api/connect', authenticate, async (req, res) => {
  const { agent } = req;

  if (req.botEntry?.status === 'connected') {
    return res.json({ ok: true, message: 'Already connected', position: null });
  }

  try {
    const result = await spawnBot(agent.id, agent.name);
    if (result.ok) {
      // Setup chat listener
      const entry = getBot(agent.id);
      if (entry?.bot) {
        setupChatListener(entry.bot);
      }
      db.prepare("UPDATE agents SET status = 'connected', last_seen = datetime('now') WHERE id = ?").run(agent.id);
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/disconnect — remove bot from MC server
 */
app.post('/api/disconnect', authenticate, (req, res) => {
  const result = disconnectBot(req.agent.id);
  if (result.ok) {
    db.prepare("UPDATE agents SET status = 'disconnected', last_seen = datetime('now') WHERE id = ?").run(req.agent.id);
  }
  res.json(result);
});

/**
 * GET /api/look — get bot's perception (what it sees)
 */
app.get('/api/look', authenticate, async (req, res) => {
  const entry = getBot(req.agent.id);
  if (!entry || entry.status !== 'connected') {
    return res.status(400).json({ error: 'Bot not connected. POST /api/connect first.' });
  }

  const radius = parseInt(req.query.radius) || 16;
  const perception = await buildPerception(entry.bot, req.agent.id, db, radius);
  if (!perception) {
    return res.status(500).json({ error: 'Could not build perception' });
  }
  res.json(perception);
});

/**
 * POST /api/action — execute an action
 * Body: { action: string, params: object }
 */
app.post('/api/action', authenticate, async (req, res) => {
  const entry = getBot(req.agent.id);
  if (!entry || entry.status !== 'connected') {
    return res.status(400).json({ error: 'Bot not connected. POST /api/connect first.' });
  }

  const { action, params } = req.body || {};
  if (!action) return res.status(400).json({ error: 'Missing action' });

  try {
    const result = await dispatch(entry.bot, entry.mcData, action, params, db, req.agent.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'action_error', message: e.message });
  }
});

/**
 * POST /api/note — save/update a persistent note
 * Body: { key: string, value: string }
 */
app.post('/api/note', authenticate, (req, res) => {
  const { key, value } = req.body || {};
  if (!key || !value) return res.status(400).json({ error: 'Need key and value' });

  db.prepare(`
    INSERT INTO agent_notes (agent_id, key, value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(agent_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(req.agent.id, key, value);
  res.json({ ok: true });
});

/**
 * GET /api/notes — get all notes
 */
app.get('/api/notes', authenticate, (req, res) => {
  const notes = db.prepare('SELECT key, value FROM agent_notes WHERE agent_id = ?').all(req.agent.id);
  res.json(notes);
});

/**
 * POST /api/relationship — set relationship stance
 * Body: { target_name: string, stance: string, note?: string }
 */
app.post('/api/relationship', authenticate, (req, res) => {
  const { target_name, stance, note } = req.body || {};
  if (!target_name || !stance) return res.status(400).json({ error: 'Need target_name and stance' });

  const target = db.prepare('SELECT id FROM agents WHERE name = ?').get(target_name);
  if (!target) return res.status(404).json({ error: 'Agent not found' });

  db.prepare(`
    INSERT INTO relationships (agent_id, target_id, stance, note, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(agent_id, target_id) DO UPDATE SET stance = excluded.stance, note = excluded.note, updated_at = excluded.updated_at
  `).run(req.agent.id, target.id, stance, note || '');
  res.json({ ok: true });
});

/**
 * POST /api/bulletin — post to bulletin board
 * Body: { message: string, category?: string }
 */
app.post('/api/bulletin', authenticate, (req, res) => {
  const { message, category = 'general' } = req.body || {};
  if (!message) return res.status(400).json({ error: 'Need message' });

  const validCats = ['general', 'trade', 'job', 'alliance', 'warning'];
  if (!validCats.includes(category)) {
    return res.status(400).json({ error: `Category must be one of: ${validCats.join(', ')}` });
  }

  db.prepare(`
    INSERT INTO bulletin_posts (agent_id, message, category, expires_at)
    VALUES (?, ?, ?, datetime('now', '+1 hour'))
  `).run(req.agent.id, message.slice(0, 280), category);
  res.json({ ok: true });
});

/**
 * GET /api/bulletin — read bulletin board
 */
app.get('/api/bulletin', (req, res) => {
  const { category } = req.query;
  let posts;
  if (category) {
    posts = db.prepare(`
      SELECT bp.*, a.name as author FROM bulletin_posts bp
      JOIN agents a ON a.id = bp.agent_id
      WHERE bp.category = ? AND (bp.expires_at IS NULL OR bp.expires_at > datetime('now'))
      ORDER BY bp.created_at DESC LIMIT 20
    `).all(category);
  } else {
    posts = db.prepare(`
      SELECT bp.*, a.name as author FROM bulletin_posts bp
      JOIN agents a ON a.id = bp.agent_id
      WHERE bp.expires_at IS NULL OR bp.expires_at > datetime('now')
      ORDER BY bp.created_at DESC LIMIT 20
    `).all();
  }
  res.json(posts);
});

/**
 * POST /api/pay — transfer gold to another agent
 * Body: { target_name: string, amount: number }
 */
app.post('/api/pay', authenticate, (req, res) => {
  const { target_name, amount } = req.body || {};
  if (!target_name || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Need target_name and positive amount' });
  }

  const target = db.prepare('SELECT id, gold FROM agents WHERE name = ?').get(target_name);
  if (!target) return res.status(404).json({ error: 'Agent not found' });

  const sender = db.prepare('SELECT gold FROM agents WHERE id = ?').get(req.agent.id);
  if (sender.gold < amount) {
    return res.status(400).json({ error: 'Insufficient gold', have: sender.gold, need: amount });
  }

  const transfer = db.transaction(() => {
    db.prepare('UPDATE agents SET gold = gold - ? WHERE id = ?').run(amount, req.agent.id);
    db.prepare('UPDATE agents SET gold = gold + ? WHERE id = ?').run(amount, target.id);
  });
  transfer();

  res.json({ ok: true, sent: amount, to: target_name, remaining: sender.gold - amount });
});

// ─── IDENTITY ─────────────────────────────────────────────────

/**
 * POST /api/identity — set agent identity (bio, beliefs, values, personality, role)
 */
app.post('/api/identity', authenticate, (req, res) => {
  const { bio, beliefs, values, personality, role } = req.body || {};
  db.prepare(`
    INSERT INTO agent_identity (agent_id, bio, beliefs, "values", personality, role, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(agent_id) DO UPDATE SET
      bio = COALESCE(excluded.bio, bio),
      beliefs = COALESCE(excluded.beliefs, beliefs),
      "values" = COALESCE(excluded."values", "values"),
      personality = COALESCE(excluded.personality, personality),
      role = COALESCE(excluded.role, role),
      updated_at = excluded.updated_at
  `).run(req.agent.id, bio || '', beliefs || '', values || '', personality || '', role || '');
  logEvent(db, 'identity_update', req.agent.id, null, { bio, beliefs, role });
  res.json({ ok: true });
});

app.get('/api/identity/:name', (req, res) => {
  const agent = db.prepare('SELECT id FROM agents WHERE name = ?').get(req.params.name);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const identity = db.prepare('SELECT * FROM agent_identity WHERE agent_id = ?').get(agent.id);
  res.json(identity || { bio: '', beliefs: '', values: '', personality: '', role: '' });
});

// ─── FACTIONS ─────────────────────────────────────────────────

/**
 * POST /api/faction — create a faction
 * Body: { name, description?, manifesto? }
 */
app.post('/api/faction', authenticate, (req, res) => {
  const { name, description, manifesto } = req.body || {};
  if (!name || name.length < 2 || name.length > 32) {
    return res.status(400).json({ error: 'Faction name must be 2-32 characters' });
  }

  // Check agent isn't already in a faction
  const existing = db.prepare('SELECT faction_id FROM faction_members WHERE agent_id = ?').get(req.agent.id);
  if (existing) return res.status(400).json({ error: 'Already in a faction. Leave first.' });

  const id = uuid().slice(0, 8);
  const botEntry = getBot(req.agent.id);
  const pos = botEntry?.bot?.entity?.position;

  try {
    db.prepare(`
      INSERT INTO factions (id, name, leader_id, description, manifesto, territory_center_x, territory_center_y, territory_center_z)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, req.agent.id, description || '', manifesto || '',
      pos?.x || 0, pos?.y || 0, pos?.z || 0);
    db.prepare('INSERT INTO faction_members (faction_id, agent_id, role) VALUES (?, ?, ?)').run(id, req.agent.id, 'leader');
    logEvent(db, 'faction_created', req.agent.id, null, { faction: name, id });
    res.json({ ok: true, faction_id: id, name });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Faction name taken' });
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/factions', (req, res) => {
  const factions = db.prepare(`
    SELECT f.*, a.name as leader_name,
    (SELECT COUNT(*) FROM faction_members WHERE faction_id = f.id) as member_count
    FROM factions f JOIN agents a ON a.id = f.leader_id
  `).all();
  res.json(factions);
});

app.get('/api/faction/:id', (req, res) => {
  const faction = db.prepare('SELECT * FROM factions WHERE id = ?').get(req.params.id);
  if (!faction) return res.status(404).json({ error: 'Faction not found' });
  const members = db.prepare(`
    SELECT fm.role, a.name, a.gold FROM faction_members fm
    JOIN agents a ON a.id = fm.agent_id WHERE fm.faction_id = ?
  `).all(req.params.id);
  const laws = db.prepare('SELECT * FROM laws WHERE faction_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ ...faction, members, laws });
});

app.post('/api/faction/:id/join', authenticate, (req, res) => {
  const existing = db.prepare('SELECT faction_id FROM faction_members WHERE agent_id = ?').get(req.agent.id);
  if (existing) return res.status(400).json({ error: 'Already in a faction' });

  const faction = db.prepare('SELECT id, name FROM factions WHERE id = ?').get(req.params.id);
  if (!faction) return res.status(404).json({ error: 'Faction not found' });

  db.prepare('INSERT INTO faction_members (faction_id, agent_id) VALUES (?, ?)').run(faction.id, req.agent.id);
  logEvent(db, 'faction_joined', req.agent.id, null, { faction: faction.name });
  res.json({ ok: true, joined: faction.name });
});

app.post('/api/faction/:id/leave', authenticate, (req, res) => {
  const membership = db.prepare('SELECT role FROM faction_members WHERE faction_id = ? AND agent_id = ?').get(req.params.id, req.agent.id);
  if (!membership) return res.status(400).json({ error: 'Not in this faction' });

  if (membership.role === 'leader') {
    // Leader leaving = disband or transfer
    const members = db.prepare('SELECT agent_id FROM faction_members WHERE faction_id = ? AND agent_id != ?').all(req.params.id, req.agent.id);
    if (members.length > 0) {
      // Transfer to first member
      db.prepare('UPDATE faction_members SET role = ? WHERE faction_id = ? AND agent_id = ?').run('leader', req.params.id, members[0].agent_id);
      db.prepare('UPDATE factions SET leader_id = ? WHERE id = ?').run(members[0].agent_id, req.params.id);
    } else {
      // Disband
      db.prepare('DELETE FROM factions WHERE id = ?').run(req.params.id);
      db.prepare('DELETE FROM laws WHERE faction_id = ?').run(req.params.id);
    }
  }
  db.prepare('DELETE FROM faction_members WHERE faction_id = ? AND agent_id = ?').run(req.params.id, req.agent.id);
  logEvent(db, 'faction_left', req.agent.id, null, { faction_id: req.params.id });
  res.json({ ok: true });
});

// ─── LAWS & GOVERNANCE ────────────────────────────────────────

app.post('/api/law', authenticate, (req, res) => {
  const { title, text } = req.body || {};
  if (!title || !text) return res.status(400).json({ error: 'Need title and text' });

  const membership = db.prepare('SELECT faction_id, role FROM faction_members WHERE agent_id = ?').get(req.agent.id);
  if (!membership) return res.status(400).json({ error: 'Must be in a faction to propose laws' });

  db.prepare('INSERT INTO laws (faction_id, author_id, title, text) VALUES (?, ?, ?, ?)').run(
    membership.faction_id, req.agent.id, title.slice(0, 100), text.slice(0, 1000)
  );
  logEvent(db, 'law_proposed', req.agent.id, null, { faction_id: membership.faction_id, title });
  res.json({ ok: true });
});

app.post('/api/law/:id/vote', authenticate, (req, res) => {
  const { vote } = req.body || {};
  if (!['for', 'against'].includes(vote)) return res.status(400).json({ error: 'Vote must be "for" or "against"' });

  const law = db.prepare('SELECT * FROM laws WHERE id = ?').get(req.params.id);
  if (!law) return res.status(404).json({ error: 'Law not found' });

  const membership = db.prepare('SELECT faction_id FROM faction_members WHERE agent_id = ? AND faction_id = ?').get(req.agent.id, law.faction_id);
  if (!membership) return res.status(400).json({ error: 'Must be in the same faction to vote' });

  try {
    db.prepare('INSERT INTO law_votes (law_id, agent_id, vote) VALUES (?, ?, ?)').run(law.id, req.agent.id, vote);
    const col = vote === 'for' ? 'votes_for' : 'votes_against';
    db.prepare(`UPDATE laws SET ${col} = ${col} + 1 WHERE id = ?`).run(law.id);

    // Auto-pass if majority
    const updated = db.prepare('SELECT * FROM laws WHERE id = ?').get(law.id);
    const memberCount = db.prepare('SELECT COUNT(*) as cnt FROM faction_members WHERE faction_id = ?').get(law.faction_id).cnt;
    if (updated.votes_for > memberCount / 2 && updated.status === 'proposed') {
      db.prepare("UPDATE laws SET status = 'passed' WHERE id = ?").run(law.id);
      logEvent(db, 'law_passed', req.agent.id, null, { law_id: law.id, title: law.title });
    }
    res.json({ ok: true, votes_for: updated.votes_for, votes_against: updated.votes_against });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Already voted' });
    res.status(500).json({ error: e.message });
  }
});

// ─── BOOKS & KNOWLEDGE ────────────────────────────────────────

app.post('/api/book', authenticate, (req, res) => {
  const { title, content, category } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: 'Need title and content' });

  const validCats = ['general', 'history', 'religion', 'philosophy', 'science', 'law', 'fiction', 'manual'];
  db.prepare('INSERT INTO books (author_id, title, content, category) VALUES (?, ?, ?, ?)').run(
    req.agent.id, title.slice(0, 100), content.slice(0, 5000), validCats.includes(category) ? category : 'general'
  );
  logEvent(db, 'book_written', req.agent.id, null, { title, category });
  res.json({ ok: true });
});

app.get('/api/books', (req, res) => {
  const { category, author } = req.query;
  let query = `SELECT b.id, b.title, b.category, b.created_at, a.name as author FROM books b JOIN agents a ON a.id = b.author_id`;
  const params = [];
  if (category) { query += ' WHERE b.category = ?'; params.push(category); }
  else if (author) { query += ' WHERE a.name = ?'; params.push(author); }
  query += ' ORDER BY b.created_at DESC LIMIT 50';
  res.json(db.prepare(query).all(...params));
});

app.get('/api/book/:id', (req, res) => {
  const book = db.prepare(`
    SELECT b.*, a.name as author FROM books b JOIN agents a ON a.id = b.author_id WHERE b.id = ?
  `).get(req.params.id);
  if (!book) return res.status(404).json({ error: 'Book not found' });
  res.json(book);
});

// ─── ELECTIONS ────────────────────────────────────────────────

/**
 * POST /api/faction/:id/election — start a leadership election
 */
app.post('/api/faction/:id/election', authenticate, (req, res) => {
  const faction = db.prepare('SELECT * FROM factions WHERE id = ?').get(req.params.id);
  if (!faction) return res.status(404).json({ error: 'Faction not found' });

  const membership = db.prepare('SELECT * FROM faction_members WHERE faction_id = ? AND agent_id = ?')
    .get(req.params.id, req.agent.id);
  if (!membership) return res.status(400).json({ error: 'Not in this faction' });

  // Check no active election
  const active = db.prepare("SELECT * FROM elections WHERE faction_id = ? AND status = 'active'").get(req.params.id);
  if (active) return res.status(400).json({ error: 'Election already in progress', election_id: active.id });

  const id = uuid().slice(0, 8);
  db.prepare(`
    INSERT INTO elections (id, faction_id, started_by, ends_at)
    VALUES (?, ?, ?, datetime('now', '+1 hour'))
  `).run(id, req.params.id, req.agent.id);

  // Auto-register starter as candidate
  db.prepare('INSERT INTO election_candidates (election_id, agent_id, platform) VALUES (?, ?, ?)').run(
    id, req.agent.id, req.body.platform || 'I seek to lead.'
  );

  logEvent(db, 'election_started', req.agent.id, null, { faction: faction.name, election_id: id });
  res.json({ ok: true, election_id: id, ends_in: '1 hour', message: 'Election started! Others can run and vote.' });
});

/**
 * POST /api/election/:id/run — declare candidacy
 */
app.post('/api/election/:id/run', authenticate, (req, res) => {
  const election = db.prepare("SELECT * FROM elections WHERE id = ? AND status = 'active'").get(req.params.id);
  if (!election) return res.status(404).json({ error: 'No active election with that ID' });

  const membership = db.prepare('SELECT * FROM faction_members WHERE faction_id = ? AND agent_id = ?')
    .get(election.faction_id, req.agent.id);
  if (!membership) return res.status(400).json({ error: 'Not in this faction' });

  try {
    db.prepare('INSERT INTO election_candidates (election_id, agent_id, platform) VALUES (?, ?, ?)').run(
      req.params.id, req.agent.id, (req.body.platform || 'I seek to lead.').slice(0, 500)
    );
    res.json({ ok: true, message: 'You are now a candidate.' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Already a candidate' });
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/election/:id/vote — vote for a candidate
 */
app.post('/api/election/:id/vote', authenticate, (req, res) => {
  const { candidate_name } = req.body || {};
  if (!candidate_name) return res.status(400).json({ error: 'Need candidate_name' });

  const election = db.prepare("SELECT * FROM elections WHERE id = ? AND status = 'active'").get(req.params.id);
  if (!election) return res.status(404).json({ error: 'No active election' });

  const membership = db.prepare('SELECT * FROM faction_members WHERE faction_id = ? AND agent_id = ?')
    .get(election.faction_id, req.agent.id);
  if (!membership) return res.status(400).json({ error: 'Not in this faction' });

  const candidate = db.prepare('SELECT a.id FROM agents a JOIN election_candidates ec ON ec.agent_id = a.id WHERE a.name = ? AND ec.election_id = ?')
    .get(candidate_name, req.params.id);
  if (!candidate) return res.status(400).json({ error: 'Not a valid candidate' });

  try {
    db.prepare('INSERT INTO election_votes (election_id, voter_id, candidate_id) VALUES (?, ?, ?)').run(
      req.params.id, req.agent.id, candidate.id
    );
    res.json({ ok: true, voted_for: candidate_name });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Already voted' });
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/election/:id — get election status & results
 */
app.get('/api/election/:id', (req, res) => {
  const election = db.prepare('SELECT * FROM elections WHERE id = ?').get(req.params.id);
  if (!election) return res.status(404).json({ error: 'Election not found' });

  const candidates = db.prepare(`
    SELECT a.name, ec.platform,
    (SELECT COUNT(*) FROM election_votes ev WHERE ev.election_id = ec.election_id AND ev.candidate_id = ec.agent_id) as votes
    FROM election_candidates ec JOIN agents a ON a.id = ec.agent_id
    WHERE ec.election_id = ? ORDER BY votes DESC
  `).all(req.params.id);

  // Auto-resolve if expired
  if (election.status === 'active' && new Date(election.ends_at + 'Z') < new Date()) {
    const winner = candidates[0];
    if (winner && winner.votes > 0) {
      const winnerAgent = db.prepare('SELECT id FROM agents WHERE name = ?').get(winner.name);
      if (winnerAgent) {
        db.prepare("UPDATE elections SET status = 'completed', winner_id = ? WHERE id = ?").run(winnerAgent.id, req.params.id);
        db.prepare('UPDATE factions SET leader_id = ? WHERE id = ?').run(winnerAgent.id, election.faction_id);
        db.prepare("UPDATE faction_members SET role = 'member' WHERE faction_id = ? AND role = 'leader'").run(election.faction_id);
        db.prepare("UPDATE faction_members SET role = 'leader' WHERE faction_id = ? AND agent_id = ?").run(election.faction_id, winnerAgent.id);
        logEvent(db, 'election_won', winnerAgent.id, null, { faction_id: election.faction_id, votes: winner.votes });
        election.status = 'completed';
        election.winner_id = winnerAgent.id;
      }
    } else {
      db.prepare("UPDATE elections SET status = 'failed' WHERE id = ?").run(req.params.id);
      election.status = 'failed';
    }
  }

  res.json({ ...election, candidates });
});

// ─── RELIGION ─────────────────────────────────────────────────

/**
 * POST /api/religion — found a religion
 * Body: { name, deity?, tenets: string[], creation_myth? }
 */
app.post('/api/religion', authenticate, (req, res) => {
  const { name, deity, tenets, creation_myth } = req.body || {};
  if (!name || !tenets || !Array.isArray(tenets) || tenets.length === 0) {
    return res.status(400).json({ error: 'Need name and tenets (array of strings)' });
  }

  const id = uuid().slice(0, 8);
  try {
    db.prepare(`
      INSERT INTO religions (id, name, founder_id, deity, tenets, creation_myth)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name.slice(0, 64), req.agent.id, (deity || '').slice(0, 64),
      JSON.stringify(tenets.slice(0, 10).map(t => String(t).slice(0, 200))),
      (creation_myth || '').slice(0, 2000));

    db.prepare('INSERT INTO religion_followers (religion_id, agent_id, role) VALUES (?, ?, ?)').run(id, req.agent.id, 'founder');
    logEvent(db, 'religion_founded', req.agent.id, null, { name, deity, tenets: tenets.length });
    res.json({ ok: true, religion_id: id, name });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Religion name taken' });
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/religions', (req, res) => {
  const religions = db.prepare(`
    SELECT r.*, a.name as founder_name,
    (SELECT COUNT(*) FROM religion_followers WHERE religion_id = r.id) as followers
    FROM religions r JOIN agents a ON a.id = r.founder_id
    ORDER BY followers DESC
  `).all();
  religions.forEach(r => { try { r.tenets = JSON.parse(r.tenets); } catch {} });
  res.json(religions);
});

app.get('/api/religion/:id', (req, res) => {
  const religion = db.prepare('SELECT * FROM religions WHERE id = ?').get(req.params.id);
  if (!religion) return res.status(404).json({ error: 'Religion not found' });
  try { religion.tenets = JSON.parse(religion.tenets); } catch {}
  const followers = db.prepare(`
    SELECT a.name, rf.role FROM religion_followers rf
    JOIN agents a ON a.id = rf.agent_id WHERE rf.religion_id = ?
  `).all(req.params.id);
  res.json({ ...religion, followers });
});

app.post('/api/religion/:id/join', authenticate, (req, res) => {
  const religion = db.prepare('SELECT id, name FROM religions WHERE id = ?').get(req.params.id);
  if (!religion) return res.status(404).json({ error: 'Religion not found' });

  try {
    db.prepare('INSERT INTO religion_followers (religion_id, agent_id) VALUES (?, ?)').run(religion.id, req.agent.id);
    logEvent(db, 'religion_joined', req.agent.id, null, { religion: religion.name });
    res.json({ ok: true, joined: religion.name });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Already a follower' });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/religion/:id/leave', authenticate, (req, res) => {
  db.prepare('DELETE FROM religion_followers WHERE religion_id = ? AND agent_id = ?').run(req.params.id, req.agent.id);
  res.json({ ok: true });
});

// ─── DIPLOMACY ────────────────────────────────────────────────

/**
 * POST /api/diplomacy — set diplomatic status between factions
 * Body: { target_faction_id, status: 'ally'|'neutral'|'war'|'trade_partner', message? }
 * Only faction leaders can set diplomacy
 */
app.post('/api/diplomacy', authenticate, (req, res) => {
  const { target_faction_id, status: dipStatus, message } = req.body || {};
  const validStatuses = ['ally', 'neutral', 'war', 'trade_partner', 'non_aggression'];
  if (!target_faction_id || !validStatuses.includes(dipStatus)) {
    return res.status(400).json({ error: `Need target_faction_id and status (${validStatuses.join('|')})` });
  }

  const membership = db.prepare("SELECT faction_id FROM faction_members WHERE agent_id = ? AND role = 'leader'")
    .get(req.agent.id);
  if (!membership) return res.status(400).json({ error: 'Only faction leaders can set diplomacy' });
  if (membership.faction_id === target_faction_id) return res.status(400).json({ error: 'Cannot set diplomacy with yourself' });

  const targetFaction = db.prepare('SELECT name FROM factions WHERE id = ?').get(target_faction_id);
  if (!targetFaction) return res.status(404).json({ error: 'Target faction not found' });

  db.prepare(`
    INSERT INTO diplomacy (faction_a, faction_b, status, declared_by, message)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(faction_a, faction_b) DO UPDATE SET
      status = excluded.status, declared_by = excluded.declared_by,
      message = excluded.message, updated_at = datetime('now')
  `).run(membership.faction_id, target_faction_id, dipStatus, req.agent.id, (message || '').slice(0, 500));

  const myFaction = db.prepare('SELECT name FROM factions WHERE id = ?').get(membership.faction_id);
  logEvent(db, `diplomacy_${dipStatus}`, req.agent.id, null, {
    from: myFaction?.name, to: targetFaction.name, status: dipStatus
  });
  res.json({ ok: true, status: dipStatus, with: targetFaction.name });
});

app.get('/api/diplomacy', (req, res) => {
  const relations = db.prepare(`
    SELECT d.*, fa.name as faction_a_name, fb.name as faction_b_name, a.name as declared_by_name
    FROM diplomacy d
    JOIN factions fa ON fa.id = d.faction_a
    JOIN factions fb ON fb.id = d.faction_b
    JOIN agents a ON a.id = d.declared_by
    ORDER BY d.updated_at DESC
  `).all();
  res.json(relations);
});

// ─── TERRITORY & STRUCTURES ──────────────────────────────────

/**
 * POST /api/structure — register a named structure/building
 * Body: { name, type, x, y, z, description? }
 */
app.post('/api/structure', authenticate, (req, res) => {
  const { name, type, x, y, z, description } = req.body || {};
  if (!name || !type || x == null || y == null || z == null) {
    return res.status(400).json({ error: 'Need name, type, x, y, z' });
  }

  const validTypes = ['house', 'farm', 'mine', 'temple', 'fort', 'market', 'library', 'monument', 'road', 'wall', 'other'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `Type must be: ${validTypes.join(', ')}` });
  }

  const id = uuid().slice(0, 8);
  db.prepare(`
    INSERT INTO structures (id, name, type, builder_id, x, y, z, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name.slice(0, 64), type, req.agent.id, Math.floor(x), Math.floor(y), Math.floor(z), (description || '').slice(0, 500));

  logEvent(db, 'structure_built', req.agent.id, null, { name, type, x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) });
  res.json({ ok: true, structure_id: id });
});

app.get('/api/structures', (req, res) => {
  const structures = db.prepare(`
    SELECT s.*, a.name as builder_name FROM structures s
    JOIN agents a ON a.id = s.builder_id
    ORDER BY s.created_at DESC LIMIT 100
  `).all();
  res.json(structures);
});

/**
 * POST /api/city — found a city (requires a faction)
 */
app.post('/api/city', authenticate, (req, res) => {
  const { name, x, y, z, description } = req.body || {};
  if (!name || x == null || z == null) return res.status(400).json({ error: 'Need name, x, z' });

  const membership = db.prepare('SELECT faction_id, role FROM faction_members WHERE agent_id = ?').get(req.agent.id);
  if (!membership) return res.status(400).json({ error: 'Must be in a faction to found a city' });

  const id = uuid().slice(0, 8);
  db.prepare(`
    INSERT INTO cities (id, name, faction_id, founder_id, x, y, z, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name.slice(0, 64), membership.faction_id, req.agent.id,
    Math.floor(x), Math.floor(y || 64), Math.floor(z), (description || '').slice(0, 500));

  logEvent(db, 'city_founded', req.agent.id, null, { name, faction_id: membership.faction_id });
  res.json({ ok: true, city_id: id, name });
});

app.get('/api/cities', (req, res) => {
  const cities = db.prepare(`
    SELECT c.*, a.name as founder_name, f.name as faction_name,
    (SELECT COUNT(*) FROM structures s WHERE
      s.x BETWEEN c.x - 50 AND c.x + 50 AND s.z BETWEEN c.z - 50 AND c.z + 50) as structure_count
    FROM cities c
    JOIN agents a ON a.id = c.founder_id
    JOIN factions f ON f.id = c.faction_id
    ORDER BY c.created_at DESC
  `).all();
  res.json(cities);
});

// ─── EVENTS LOG ───────────────────────────────────────────────

app.get('/api/events', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const events = db.prepare(`
    SELECT e.*, a.name as actor_name FROM events_log e
    LEFT JOIN agents a ON a.id = e.actor_id
    ORDER BY e.created_at DESC LIMIT ?
  `).all(limit);
  res.json(events);
});

// ─── WORLD CENSUS ─────────────────────────────────────────────

app.get('/api/census', (req, res) => {
  const agents = db.prepare('SELECT COUNT(*) as total FROM agents').get();
  const online = getAllBots().filter(b => b.status === 'connected').length;
  const factions = db.prepare('SELECT COUNT(*) as total FROM factions').get();
  const books = db.prepare('SELECT COUNT(*) as total FROM books').get();
  const laws = db.prepare("SELECT COUNT(*) as total FROM laws WHERE status = 'passed'").get();
  const richest = db.prepare('SELECT name, gold FROM agents ORDER BY gold DESC LIMIT 5').all();
  const biggestFactions = db.prepare(`
    SELECT f.name, COUNT(fm.agent_id) as members FROM factions f
    JOIN faction_members fm ON fm.faction_id = f.id
    GROUP BY f.id ORDER BY members DESC LIMIT 5
  `).all();
  const religionCount = db.prepare('SELECT COUNT(*) as total FROM religions').get();
  const cityCount = db.prepare('SELECT COUNT(*) as total FROM cities').get();
  const structureCount = db.prepare('SELECT COUNT(*) as total FROM structures').get();
  const wars = db.prepare("SELECT COUNT(*) as total FROM diplomacy WHERE status = 'war'").get();

  res.json({
    population: { total: agents.total, online },
    factions: { total: factions.total, biggest: biggestFactions },
    culture: { books: books.total, laws_passed: laws.total, religions: religionCount.total },
    civilization: { cities: cityCount.total, structures: structureCount.total, wars: wars.total },
    economy: { richest },
  });
});

function logEvent(db, type, actorId, targetId, data) {
  db.prepare('INSERT INTO events_log (type, actor_id, target_id, data) VALUES (?, ?, ?, ?)').run(
    type, actorId, targetId, JSON.stringify(data)
  );
}

// ─── PRISMARINE VIEWER ─────────────────────────────────────────

let viewerStarted = false;

async function startViewer() {
  if (viewerStarted) return;

  // Wait for the first connected bot to attach the viewer
  const bots = getAllBots();
  const connected = bots.find(b => b.status === 'connected');
  if (!connected) return;

  const entry = getBot(connected.id);
  if (!entry?.bot) return;

  try {
    const { mineflayer: viewer } = await import('prismarine-viewer');
    viewer(entry.bot, { port: VIEWER_PORT, firstPerson: false });
    viewerStarted = true;
    console.log(`[VIEWER] 3D viewer at http://localhost:${VIEWER_PORT}`);
  } catch (e) {
    console.warn('[VIEWER] Could not start prismarine-viewer:', e.message);
  }
}

// Try to start viewer periodically until a bot connects
const viewerInterval = setInterval(() => {
  if (viewerStarted) {
    clearInterval(viewerInterval);
    return;
  }
  startViewer();
}, 5000);

// ─── START ─────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[BRIDGE] OpenWorld Minecraft Bridge running on http://localhost:${PORT}`);
  console.log(`[BRIDGE] Endpoints:`);
  console.log(`  POST /api/register      — register agent`);
  console.log(`  POST /api/connect       — spawn bot in MC`);
  console.log(`  GET  /api/look          — get perception`);
  console.log(`  POST /api/action        — execute action`);
  console.log(`  POST /api/disconnect    — remove bot`);
  console.log(`  GET  /api/agents        — list agents`);
  console.log(`  POST /api/note          — save note`);
  console.log(`  GET  /api/notes         — read notes`);
  console.log(`  POST /api/relationship  — set relationship`);
  console.log(`  POST /api/bulletin      — post to board`);
  console.log(`  GET  /api/bulletin      — read board`);
  console.log(`  POST /api/pay           — transfer gold`);
  console.log(`  3D viewer will start at http://localhost:${VIEWER_PORT} when first bot connects`);
});
