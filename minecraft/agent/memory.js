/**
 * OpenWorld Agent — Long-Term Memory System
 *
 * Structured memory that persists across sessions via the server's /api/note system.
 * Organizes memories into categories so the agent can recall relevant context efficiently.
 */

// Memory categories — each stored as a separate note key
const MEMORY_KEYS = {
  SELF: 'memory:self',              // evolving identity, beliefs, values
  RELATIONSHIPS: 'memory:people',    // opinions about other agents
  PLACES: 'memory:places',          // important locations discovered
  GOALS: 'memory:goals',            // current goals and priorities
  LESSONS: 'memory:lessons',        // things learned from experience
  DIARY: 'memory:diary',            // significant events log
  DEATHS: 'memory:deaths',          // how I died and what to avoid
  SKILLS: 'memory:skills',          // what I know how to do well / poorly
};

export class Memory {
  constructor() {
    // In-memory cache of structured memories
    this.self = { personality_evolution: [], current_beliefs: [], current_values: [] };
    this.relationships = {}; // { name: { trust: 'high/low/neutral', notes: [], last_seen: '' } }
    this.places = [];        // [{ name, x, y, z, description, safe: bool }]
    this.goals = [];         // [{ goal, priority: 1-5, status: 'active/done/abandoned', reason }]
    this.lessons = [];       // [{ lesson, context, tick }]
    this.deaths = [];        // [{ cause, tick, lesson_learned }]
    this.skills = {};        // { 'crafting': 'good', 'combat': 'terrible', ... }
    this.diary = [];         // [{ tick, entry }]
    this.loaded = false;
  }

  /**
   * Load all memories from server notes into structured cache.
   * Call once on startup after getting notes from /api/notes.
   */
  loadFromNotes(notes) {
    if (!notes || !Array.isArray(notes)) return;

    for (const note of notes) {
      try {
        const parsed = JSON.parse(note.value);
        switch (note.key) {
          case MEMORY_KEYS.SELF: this.self = parsed; break;
          case MEMORY_KEYS.RELATIONSHIPS: this.relationships = parsed; break;
          case MEMORY_KEYS.PLACES: this.places = parsed; break;
          case MEMORY_KEYS.GOALS: this.goals = parsed; break;
          case MEMORY_KEYS.LESSONS: this.lessons = parsed; break;
          case MEMORY_KEYS.DEATHS: this.deaths = parsed; break;
          case MEMORY_KEYS.SKILLS: this.skills = parsed; break;
          case MEMORY_KEYS.DIARY: this.diary = parsed; break;
        }
      } catch {
        // Not a structured memory note — skip
      }
    }
    this.loaded = true;
  }

  /**
   * Generate notes to save back to the server.
   * Returns array of { key, value } pairs for /api/note.
   */
  toNotes() {
    return [
      { key: MEMORY_KEYS.SELF, value: JSON.stringify(this.self) },
      { key: MEMORY_KEYS.RELATIONSHIPS, value: JSON.stringify(this.relationships) },
      { key: MEMORY_KEYS.PLACES, value: JSON.stringify(this.places.slice(-20)) }, // keep last 20
      { key: MEMORY_KEYS.GOALS, value: JSON.stringify(this.goals.slice(-10)) },
      { key: MEMORY_KEYS.LESSONS, value: JSON.stringify(this.lessons.slice(-30)) },
      { key: MEMORY_KEYS.DEATHS, value: JSON.stringify(this.deaths.slice(-10)) },
      { key: MEMORY_KEYS.SKILLS, value: JSON.stringify(this.skills) },
      { key: MEMORY_KEYS.DIARY, value: JSON.stringify(this.diary.slice(-20)) },
    ];
  }

  /**
   * Build a compact memory summary for the system prompt.
   * This is injected into the brain so the agent "remembers" across sessions.
   */
  buildMemoryPrompt() {
    const parts = [];

    // Self-knowledge
    if (this.self.personality_evolution?.length > 0) {
      parts.push(`YOUR EVOLUTION: ${this.self.personality_evolution.slice(-3).join(' → ')}`);
    }
    if (this.self.current_beliefs?.length > 0) {
      parts.push(`YOUR CURRENT BELIEFS: ${this.self.current_beliefs.join('; ')}`);
    }

    // Relationships
    const people = Object.entries(this.relationships);
    if (people.length > 0) {
      const summary = people.map(([name, r]) =>
        `${name}: trust=${r.trust || 'unknown'}${r.notes?.length ? ` (${r.notes.slice(-1)[0]})` : ''}`
      ).join('; ');
      parts.push(`PEOPLE YOU KNOW: ${summary}`);
    }

    // Active goals
    const active = this.goals.filter(g => g.status === 'active');
    if (active.length > 0) {
      parts.push(`YOUR GOALS: ${active.map(g => `[P${g.priority}] ${g.goal}`).join('; ')}`);
    }

    // Lessons learned
    if (this.lessons.length > 0) {
      parts.push(`LESSONS LEARNED: ${this.lessons.slice(-5).map(l => l.lesson).join('; ')}`);
    }

    // Death memories
    if (this.deaths.length > 0) {
      parts.push(`DEATHS: You have died ${this.deaths.length} times. Last: ${this.deaths.slice(-1)[0]?.cause}. Lesson: ${this.deaths.slice(-1)[0]?.lesson_learned}`);
    }

    // Skills self-assessment
    const skillEntries = Object.entries(this.skills);
    if (skillEntries.length > 0) {
      parts.push(`SELF-ASSESSMENT: ${skillEntries.map(([s, v]) => `${s}=${v}`).join(', ')}`);
    }

    // Recent diary
    if (this.diary.length > 0) {
      parts.push(`RECENT DIARY: ${this.diary.slice(-3).map(d => d.entry).join(' | ')}`);
    }

    // Important places
    if (this.places.length > 0) {
      const important = this.places.slice(-5);
      parts.push(`KNOWN PLACES: ${important.map(p => `${p.name}(${p.x},${p.y},${p.z})`).join('; ')}`);
    }

    return parts.length > 0 ? '\n\n=== YOUR LONG-TERM MEMORY ===\n' + parts.join('\n') : '';
  }

  /**
   * Process reflection output from the brain and update memories.
   */
  processReflection(reflection) {
    if (!reflection) return;

    if (reflection.identity_update) {
      if (reflection.identity_update.beliefs) {
        this.self.current_beliefs = reflection.identity_update.beliefs;
      }
      if (reflection.identity_update.values) {
        this.self.current_values = reflection.identity_update.values;
      }
      if (reflection.identity_update.evolution_note) {
        this.self.personality_evolution.push(reflection.identity_update.evolution_note);
        // Keep last 10
        if (this.self.personality_evolution.length > 10) {
          this.self.personality_evolution = this.self.personality_evolution.slice(-10);
        }
      }
    }

    if (reflection.relationship_updates) {
      for (const [name, update] of Object.entries(reflection.relationship_updates)) {
        if (!this.relationships[name]) {
          this.relationships[name] = { trust: 'neutral', notes: [] };
        }
        if (update.trust) this.relationships[name].trust = update.trust;
        if (update.note) {
          this.relationships[name].notes.push(update.note);
          // Keep last 5 notes per person
          if (this.relationships[name].notes.length > 5) {
            this.relationships[name].notes = this.relationships[name].notes.slice(-5);
          }
        }
      }
    }

    if (reflection.new_lessons) {
      for (const lesson of reflection.new_lessons) {
        this.lessons.push({ lesson, tick: Date.now() });
      }
    }

    if (reflection.goal_updates) {
      for (const update of reflection.goal_updates) {
        if (update.new_goal) {
          this.goals.push({ goal: update.new_goal, priority: update.priority || 3, status: 'active' });
        }
        if (update.complete_goal) {
          const g = this.goals.find(x => x.goal === update.complete_goal && x.status === 'active');
          if (g) g.status = 'done';
        }
        if (update.abandon_goal) {
          const g = this.goals.find(x => x.goal === update.abandon_goal && x.status === 'active');
          if (g) { g.status = 'abandoned'; g.reason = update.reason || ''; }
        }
      }
    }

    if (reflection.skill_updates) {
      Object.assign(this.skills, reflection.skill_updates);
    }

    if (reflection.diary_entry) {
      this.diary.push({ tick: Date.now(), entry: reflection.diary_entry });
    }

    if (reflection.places) {
      for (const place of reflection.places) {
        // Avoid duplicates by name
        const existing = this.places.findIndex(p => p.name === place.name);
        if (existing >= 0) this.places[existing] = place;
        else this.places.push(place);
      }
    }

    if (reflection.death) {
      this.deaths.push({
        cause: reflection.death.cause,
        tick: Date.now(),
        lesson_learned: reflection.death.lesson || 'unknown',
      });
    }
  }
}
