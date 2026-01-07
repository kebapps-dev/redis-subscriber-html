const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const REDIS_PORT = process.env.REDIS_PORT || 6379;

const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT
});

// Subscribe to all channels under c6c3_228.*
redis.psubscribe('c6c3_228.*', (err, count) => {
  if (err) console.error('Failed to subscribe: ', err);
  else console.log(`Subscribed to ${count} pattern(s)`);
});

redis.on('pmessage', (pattern, channel, message) => {
  // Send to all connected clients
  io.emit('redis-message', { channel, message });
});

// Serve HTML
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Web server running on port ${PORT}`));
