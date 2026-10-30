const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Tournament = require('./game/tournament');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// O torneio precisa poder "empurrar" atualizações para todos
const tournament = new Tournament(broadcastState);

function broadcastState() {
  for (const socket of io.sockets.sockets.values()) {
    socket.emit('state', tournament.getStateFor(socket.data.playerName || null));
  }
}

io.on('connection', (socket) => {
  // Estado inicial (para quem ainda não fez login)
  socket.emit('state', tournament.getStateFor(null));

  socket.on('join', ({ name, color } = {}) => {
    const result = tournament.join(name, color, socket.id);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }
    socket.data.playerName = String(name).trim().slice(0, 20);
    broadcastState();
  });

  socket.on('move', ({ index } = {}) => {
    const name = socket.data.playerName;
    if (!name) return;
    const result = tournament.makeMove(name, index);
    if (result && result.error) socket.emit('error', result.error);
    broadcastState();
  });

  socket.on('disconnect', () => {
    const name = socket.data.playerName;
    if (name) {
      tournament.disconnect(name, socket.id);
      broadcastState();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Servidor rodando na porta ${PORT}`);
});