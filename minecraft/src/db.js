import Database from 'better-sqlite3';

export function createDb(path = './data/openworld-mc.db') {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      token TEXT UNIQUE NOT NULL,
      gold INTEGER NOT NULL DEFAULT 50,
      status TEXT NOT NULL DEFAULT 'disconnected',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(agent_id, key),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS relationships (
      agent_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      stance TEXT NOT NULL DEFAULT 'neutral',
      note TEXT DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agent_id, target_id)
    );

    CREATE TABLE IF NOT EXISTS bulletin_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      message TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS factions (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      leader_id TEXT NOT NULL,
      description TEXT DEFAULT '',
      manifesto TEXT DEFAULT '',
      territory_center_x REAL,
      territory_center_y REAL,
      territory_center_z REAL,
      territory_radius INTEGER DEFAULT 50,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (leader_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS faction_members (
      faction_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (faction_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS laws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      faction_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      votes_for INTEGER DEFAULT 1,
      votes_against INTEGER DEFAULT 0,
      status TEXT DEFAULT 'proposed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (faction_id) REFERENCES factions(id)
    );

    CREATE TABLE IF NOT EXISTS law_votes (
      law_id INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      vote TEXT NOT NULL,
      PRIMARY KEY (law_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (author_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS agent_identity (
      agent_id TEXT PRIMARY KEY,
      bio TEXT DEFAULT '',
      beliefs TEXT DEFAULT '',
      "values" TEXT DEFAULT '',
      personality TEXT DEFAULT '',
      role TEXT DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS events_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      actor_id TEXT,
      target_id TEXT,
      data TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Elections
    CREATE TABLE IF NOT EXISTS elections (
      id TEXT PRIMARY KEY,
      faction_id TEXT NOT NULL,
      started_by TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      winner_id TEXT,
      ends_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (faction_id) REFERENCES factions(id)
    );

    CREATE TABLE IF NOT EXISTS election_candidates (
      election_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      platform TEXT DEFAULT '',
      PRIMARY KEY (election_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS election_votes (
      election_id TEXT NOT NULL,
      voter_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      PRIMARY KEY (election_id, voter_id)
    );

    -- Religions
    CREATE TABLE IF NOT EXISTS religions (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      founder_id TEXT NOT NULL,
      deity TEXT DEFAULT '',
      tenets TEXT DEFAULT '[]',
      creation_myth TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (founder_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS religion_followers (
      religion_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      role TEXT DEFAULT 'follower',
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (religion_id, agent_id)
    );

    -- Diplomacy
    CREATE TABLE IF NOT EXISTS diplomacy (
      faction_a TEXT NOT NULL,
      faction_b TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'neutral',
      declared_by TEXT NOT NULL,
      message TEXT DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (faction_a, faction_b)
    );

    -- Structures & Cities
    CREATE TABLE IF NOT EXISTS structures (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      builder_id TEXT NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      z INTEGER NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (builder_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS cities (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      faction_id TEXT NOT NULL,
      founder_id TEXT NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      z INTEGER NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (faction_id) REFERENCES factions(id),
      FOREIGN KEY (founder_id) REFERENCES agents(id)
    );
  `);

  return db;
}
