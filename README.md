# ♠ Texas Hold'em — Multiplayer

A real-time multiplayer Texas Hold'em poker game built with Node.js, Socket.io, and vanilla JS.

## Project structure

```
poker-multiplayer/
├── server/
│   ├── index.js       ← Express + Socket.io server
│   ├── poker.js       ← Game logic (deck, hand eval, table state)
│   └── package.json
├── client/
│   └── index.html     ← Single-file frontend (no build step)
└── README.md
```

---

## Quick start (local)

```bash
cd server
npm install
npm run dev        # uses nodemon for auto-reload
```

Open `http://localhost:3001` in **two or more browser tabs** to test multiplayer.

---

## How it works

| Layer | Tech | Role |
|---|---|---|
| Server | Node.js + Express | HTTP API + static file serving |
| Real-time | Socket.io | Bidirectional event stream |
| Game logic | `poker.js` | Deck, hand evaluation, state machine |
| Frontend | Vanilla JS | Renders state, sends player actions |

### Socket events

**Client → Server**
| Event | Payload | Description |
|---|---|---|
| `join_table` | `{ name, tableId }` | Join or create a table |
| `player_action` | `{ action, amount }` | fold / check / call / raise |
| `get_state` | — | Request full table state |

**Server → Client**
| Event | Description |
|---|---|
| `joined` | Confirmed seat + initial state |
| `your_cards` | Private hole cards (only to you) |
| `hand_started` | New hand began |
| `your_turn` | It's your turn to act |
| `player_action` | Another player acted |
| `phase_change` | Flop / turn / river dealt |
| `hand_over` | Showdown + winner |
| `error` | Action rejected |

---

## Deployment

### Option A — Railway (easiest, ~$5/month)

1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Set **root directory** to `server`
4. Add environment variable: `PORT=3001`
5. Railway gives you a public URL — share it and anyone can play

### Option B — Render (free tier available)

1. Push to GitHub
2. New Web Service on [render.com](https://render.com)
3. Build command: `cd server && npm install`
4. Start command: `node server/index.js`
5. Free tier spins down after inactivity (upgrade for always-on)

### Option C — VPS (DigitalOcean / Linode, ~$6/month)

```bash
# On your server
git clone <your-repo>
cd poker-multiplayer/server
npm install
npm install -g pm2
pm2 start index.js --name poker
pm2 save

# Point your domain via nginx:
# proxy_pass http://localhost:3001;
```

---

## Scaling beyond one server

When you have many tables, add Redis for shared state:

```bash
npm install @socket.io/redis-adapter ioredis
```

```js
// In index.js
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('ioredis');
const pub = createClient({ url: process.env.REDIS_URL });
const sub = pub.duplicate();
io.adapter(createAdapter(pub, sub));
```

This lets multiple Node processes share table state.

---

## Adding user accounts (optional)

For persistent chips and leaderboards, add:

```bash
npm install better-sqlite3   # or pg for PostgreSQL
```

Store `{ playerId, name, chips }` in a DB and look up on join.

---

## Game rules implemented

- Texas Hold'em: preflop → flop → turn → river → showdown
- Small blind $10, big blind $20, starting chips $1,000
- Auto-rebuy on bust
- 30-second action timer (auto-fold / auto-check on timeout)
- Full hand evaluation: royal flush → high card
- Split pot on ties
- Up to 6 players per table
- Multiple simultaneous tables
