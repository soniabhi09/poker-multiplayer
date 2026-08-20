'use strict';

const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { PokerTable } = require('./poker');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());

// Serve client files — path is relative to THIS file (server/index.js)
app.use(express.static(path.join(__dirname, '../client')));

// ── Table registry ──────────────────────────────────────────────────────────

const tables = new Map();
const socketToPlayer = new Map();

function getOrCreateTable(tableId) {
  if (!tables.has(tableId)) {
    const table = new PokerTable(tableId, {
      smallBlind: 10,
      bigBlind: 20,
      startingChips: 1000,
      maxPlayers: 6,
    });

    table.setEmitter(
      (event, data) => { io.to(tableId).emit(event, data); },
      (playerId, event, data) => {
        for (const [socketId, meta] of socketToPlayer.entries()) {
          if (meta.playerId === playerId && meta.tableId === tableId) {
            io.to(socketId).emit(event, data);
            break;
          }
        }
      }
    );

    tables.set(tableId, table);
    console.log(`[table] created: ${tableId}`);
  }
  return tables.get(tableId);
}

// ── REST endpoints ──────────────────────────────────────────────────────────

app.get('/api/tables', (req, res) => {
  const list = [];
  for (const [id, t] of tables.entries()) {
    list.push({ id, phase: t.phase, playerCount: t.players.filter(p => p.connected).length, maxPlayers: t.maxPlayers });
  }
  if (!tables.has('table-1')) list.unshift({ id: 'table-1', phase: 'waiting', playerCount: 0, maxPlayers: 6 });
  res.json(list);
});

app.post('/api/tables', (req, res) => {
  const tableId = 'table-' + uuidv4().slice(0, 6);
  getOrCreateTable(tableId);
  res.json({ tableId });
});

// ── Socket.io events ──────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  socket.on('join_table', ({ tableId, name }) => {
    if (!name || !tableId) { socket.emit('error', { message: 'name and tableId are required' }); return; }
    const playerId = uuidv4();
    const table = getOrCreateTable(tableId);
    const result = table.addPlayer(playerId, name);
    if (result.error) { socket.emit('error', { message: result.error }); return; }
    socketToPlayer.set(socket.id, { playerId, tableId, name });
    socket.join(tableId);
    socket.emit('joined', { playerId, tableId, seat: result.seat, state: table.tableState(playerId) });
    console.log(`[table:${tableId}] ${name} joined (seat ${result.seat})`);
  });

  socket.on('player_action', ({ action, amount }) => {
    const meta = socketToPlayer.get(socket.id);
    if (!meta) { socket.emit('error', { message: 'Not at a table' }); return; }
    const table = tables.get(meta.tableId);
    if (!table) { socket.emit('error', { message: 'Table not found' }); return; }
    const result = table.handleAction(meta.playerId, action, amount);
    if (result.error) socket.emit('error', { message: result.error });
  });

  socket.on('get_state', () => {
    const meta = socketToPlayer.get(socket.id);
    if (!meta) return;
    const table = tables.get(meta.tableId);
    if (!table) return;
    socket.emit('state', table.tableState(meta.playerId));
  });

  socket.on('disconnect', () => {
    const meta = socketToPlayer.get(socket.id);
    if (meta) {
      const table = tables.get(meta.tableId);
      if (table) table.removePlayer(meta.playerId);
      socketToPlayer.delete(socket.id);
      console.log(`[socket] disconnected: ${meta.name}`);
    }
  });
});

// ── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n♠ Poker server running on http://localhost:${PORT}\n`);
});
