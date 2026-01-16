const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');

// ============================================================================
// OPTIONAL: Enable KEB Protocol Support
// Comment out or remove this line to disable KEB-specific functionality
// ============================================================================
const KebProtocol = require('./keb-protocol');
// ============================================================================

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const REDIS_PORT = process.env.REDIS_PORT || 6379;

// Main Redis client for subscribing
const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT
});

// Separate Redis client for publishing (since subscriber can't publish)
const redisPublisher = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT
});

let currentPattern = '*';
let kebProtocol = null;

// Initialize KEB Protocol if available
if (typeof KebProtocol !== 'undefined') {
  kebProtocol = new KebProtocol(REDIS_HOST, REDIS_PORT);
}

// Subscribe to all channels initially
redis.psubscribe(currentPattern, (err, count) => {
  if (err) console.error('Failed to subscribe: ', err);
  else console.log(`Subscribed to ${count} pattern(s): ${currentPattern}`);
});

redis.on('pmessage', (pattern, channel, message) => {
  // Send to all connected clients
  io.emit('redis-message', { channel, message });
});

// Handle client connections
io.on('connection', (socket) => {
  console.log('Client connected');
  
  // Send current pattern to new clients
  socket.on('get-current-pattern', () => {
    socket.emit('current-pattern', currentPattern);
    
    // Register KEB protocol handlers if enabled
    if (kebProtocol) {
      kebProtocol.registerSocketHandlers(io, socket);
    }
  });
  
  // Handle pattern changes
  socket.on('change-pattern', async (newPattern) => {
    try {
      // Unsubscribe from old pattern
      await redis.punsubscribe(currentPattern);
      
      // Subscribe to new pattern
      currentPattern = newPattern || '*';
      await redis.psubscribe(currentPattern);
      
      console.log(`Pattern changed to: ${currentPattern}`);
      
      // Notify all clients
      io.emit('subscription-status', {
        pattern: currentPattern,
        status: 'Subscribed'
      });
    } catch (err) {
      console.error('Failed to change pattern:', err);
      socket.emit('subscription-status', {
        pattern: currentPattern,
        status: 'Error: ' + err.message
      });
    }
  });
  
  // Handle KEB Set publishing
  socket.on('publish-keb-set', async (message) => {
    try {
      const messageStr = JSON.stringify(message);
      await redisPublisher.publish('$kebSet', messageStr);
      console.log(`Published to $kebSet: ${messageStr}`);
    } catch (err) {
      console.error('Failed to publish to $kebSet:', err);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Serve HTML
app.use(express.static('public'));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Web server running on port ${PORT}`));
