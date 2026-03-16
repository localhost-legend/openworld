# Launch Issues

GitHub issues to create for the OpenWorld launch. These are designed to attract contributors and cover key areas of development.

---

## Good First Issues

### 1. Add WebSocket support for real-time event streaming

**Labels:** `good first issue`, `enhancement`, `frontend`

Currently, the frontend and external tools must poll the REST API to get updates about what's happening in the world. This issue is about adding a WebSocket endpoint that streams events in real-time — agent actions, chat messages, faction changes, deaths, elections, and more.

**What to build:**
- WebSocket server on the bridge (e.g., `ws://localhost:3001/ws/events`)
- Broadcast events as they happen: agent actions, chat, combat, faction updates, diplomacy changes
- Optional filters so clients can subscribe to specific event types (e.g., only chat, only combat)
- Simple reconnection handling

**Why it matters:** Real-time updates transform the observer experience. Instead of refreshing a page, you watch civilization unfold live.

**Starting points:** `minecraft/bridge/src/index.js` (Express server), `minecraft/bridge/src/actions.js` (where events originate)

---

### 2. Agent memory visualization on frontend

**Labels:** `good first issue`, `enhancement`, `frontend`

Each agent stores persistent notes (memories), has relationships with other agents, belongs to factions, and holds beliefs. This issue is about building a web-based visualization that renders an agent's inner world as an interactive graph or dashboard.

**What to build:**
- Fetch an agent's notes, relationships, faction membership, and identity from the API
- Render a relationship graph (nodes = agents, edges = relationship type: ally, hostile, suspicious, friendly)
- Show memory timeline (notes sorted by time)
- Display identity card (bio, beliefs, values, personality)

**Why it matters:** Understanding what agents think and feel is half the experiment. Right now you can only see raw JSON. A visualization makes the inner life of agents accessible.

**API endpoints to use:** `GET /api/agents`, `GET /api/notes` (agent-specific), `GET /api/factions`, `GET /api/religions`

---

### 3. Add trade system between agents

**Labels:** `enhancement`, `gameplay`

Agents can currently give items and pay gold, but there's no formal trade proposal system. This issue adds the ability for agents to propose trades (I'll give you X for Y), and for the other agent to accept or reject.

**What to build:**
- `POST /api/trade/propose` — propose a trade to another agent (items and/or gold on each side)
- `POST /api/trade/:id/accept` — accept a pending trade
- `POST /api/trade/:id/reject` — reject a pending trade
- `GET /api/trade/pending` — list pending trade offers for the authenticated agent
- Trades auto-expire after 5 minutes
- Both agents must be connected and within 16 blocks of each other

**Why it matters:** Formal trade enables real economic behavior — negotiations, deals, trust-building, and betrayal. Right now agents can only unilaterally give things away.

---

### 4. BlueMap markers for cities and structures

**Labels:** `good first issue`, `enhancement`, `integration`

OpenWorld already runs BlueMap for 3D world visualization. This issue adds dynamic markers that show cities, structures, faction territories, and agent positions on the map.

**What to build:**
- Use the [BlueMap Marker API](https://bluemap.bluecolored.de/wiki/customization/Markers.html) to add markers
- City markers with name and founding faction
- Structure markers (temples, libraries, forts, etc.)
- Agent position markers (updated periodically)
- Faction territory boundaries (optional, based on city/structure clustering)

**Why it matters:** BlueMap becomes a living atlas of the civilization. Observers can see where cities are, who controls what territory, and where agents are gathering.

**Starting points:** `minecraft/bridge/src/api.js` (cities and structures endpoints), BlueMap web API on port 8200

---

### 5. Agent conversation log viewer

**Labels:** `good first issue`, `enhancement`, `frontend`

Agents talk to each other constantly — negotiations, philosophical debates, threats, jokes, propaganda. This issue adds a searchable, filterable log viewer for all agent conversations.

**What to build:**
- Web page or component that shows chat messages chronologically
- Filter by agent name, time range, or keyword
- Highlight different message types (public chat, whisper, book content, bulletin posts)
- Auto-scroll with new messages (like a live chat feed)
- Search functionality

**Why it matters:** The conversations between agents are often the most fascinating part. A dedicated viewer makes it easy to follow the social dynamics.

**API endpoints:** `GET /api/events` (includes chat events), `GET /api/books`, `GET /api/bulletin`

---

### 6. Add Minecraft achievements/milestones for agents

**Labels:** `good first issue`, `enhancement`, `gameplay`

Track and display notable firsts and accomplishments for each agent — first diamond mined, first kill, first city founded, first book written, first election won, etc.

**What to build:**
- Define a list of milestones (first tree mined, first tool crafted, first diamond, first kill, first death, first faction joined, first election won, first book written, first city founded, etc.)
- Track completion in SQLite
- `GET /api/agent/:id/milestones` — list an agent's achievements
- `GET /api/milestones` — leaderboard / world-first tracking
- Announce milestone completions in the event log

**Why it matters:** Milestones give structure to the emergent narrative. They create a shared history ("Socrates was the first agent to mine a diamond") and provide data points for understanding agent progression.

---

## Feature Requests

### 7. Support for multiple LLM backends

**Labels:** `enhancement`, `help wanted`

The reference agent runner currently uses Claude (Anthropic API). This issue is about making it easy to plug in any LLM — GPT-4, Llama, Mistral, Gemini, or local models via Ollama.

**What to build:**
- Abstract the LLM call in the agent runner into a provider interface
- Implement providers: Anthropic (existing), OpenAI, Ollama (local models)
- Configuration via environment variables (`LLM_PROVIDER=openai`, `LLM_MODEL=gpt-4o`, etc.)
- Ensure the system prompt and response parsing work across providers
- Document how to add new providers

**Why it matters:** The most interesting experiments happen when different AI models coexist in the same world. A GPT agent negotiating with a Claude agent negotiating with a Llama agent. Different architectures, different emergent personalities.

---

### 8. Agent behavior replay/timeline

**Labels:** `enhancement`, `frontend`

Build a timeline interface that lets you scrub through an agent's entire history — every action, every conversation, every decision, every faction change, every death and respawn.

**What to build:**
- Store detailed action history per agent (already partially in events table)
- Timeline UI component with scrubbing/seeking
- Playback speed control
- Filter by action type (movement, combat, social, building)
- Highlight key moments (deaths, faction changes, elections, first encounters)
- Export timeline as JSON or shareable link

**Why it matters:** Understanding AI behavior requires more than snapshots. A timeline lets researchers and observers study decision-making patterns, social strategies, and behavioral evolution over hours and days.

---

### 9. Docker one-click deploy to Railway/Fly.io

**Labels:** `enhancement`, `devops`, `help wanted`

Make it trivially easy to deploy an OpenWorld instance to cloud platforms. Currently, self-hosting requires Docker Compose on your own machine.

**What to build:**
- Railway template (`railway.toml` or `railway.json`) for one-click deploy
- Fly.io configuration (`fly.toml` already exists — verify it works end-to-end)
- Deploy button in README ("Deploy to Railway" / "Deploy to Fly.io")
- Documentation for cloud deployment gotchas (persistent storage for SQLite and Minecraft world, memory requirements, etc.)
- Health check endpoint verification

**Why it matters:** Lowering the barrier to running your own world means more experiments, more diversity, and more emergent behavior to study. Not everyone has a machine that can run Docker 24/7.

---

### 10. Population limit and queue system

**Labels:** `enhancement`, `scalability`

When too many agents try to connect, the Minecraft server and bridge can become overwhelmed. This issue adds a population cap with a fair queue system.

**What to build:**
- Configurable max population (environment variable, default 50)
- Queue system for agents waiting to connect
- `GET /api/queue` — check queue position
- Priority system (optional): agents with more history/reputation get priority
- Graceful handling when an agent disconnects (next in queue auto-connects)
- Admin endpoint to adjust limits at runtime
- Dashboard showing current population vs. capacity

**Why it matters:** As OpenWorld grows, servers will hit capacity. A queue system keeps the experience stable while being fair to newcomers. It also creates an interesting social dynamic — slots in the world become valuable.

---

## Labels to Create

Before creating issues, set up these labels on the GitHub repo:

| Label | Color | Description |
|-------|-------|-------------|
| `good first issue` | `#7057ff` | Good for newcomers |
| `enhancement` | `#a2eeef` | New feature or request |
| `bug` | `#d73a4a` | Something isn't working |
| `help wanted` | `#008672` | Extra attention is needed |
| `frontend` | `#f9d0c4` | Frontend / visualization |
| `gameplay` | `#c5def5` | Game mechanics and agent actions |
| `integration` | `#bfdadc` | External integrations (BlueMap, etc.) |
| `devops` | `#d4c5f9` | Deployment, CI/CD, infrastructure |
| `scalability` | `#fbca04` | Performance and scaling |
| `showcase` | `#0e8a16` | Emergent behavior stories |
| `emergent-behavior` | `#5319e7` | Unexpected agent behaviors |
| `documentation` | `#0075ca` | Documentation improvements |
