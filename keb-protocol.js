const Redis = require('ioredis');

/**
 * KEB Subscription Protocol Handler
 * Publishes subscription requests to $kebSubscribe channel
 */
class KebProtocol {
  constructor(redisHost, redisPort) {
    // Separate Redis client for publishing KEB commands
    this.redisPublisher = new Redis({
      host: redisHost,
      port: redisPort
    });
    
    this.subscribedNodes = [];
    this.subscriptionId = this.generateId();
    
    console.log('KEB Protocol enabled with ID:', this.subscriptionId);
  }
  
  generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  
  /**
   * Subscribe to specific KEB nodes
   * @param {Array<string>} nodes - Array of node names to subscribe to
   */
  async subscribeToNodes(nodes) {
    this.subscribedNodes = nodes;
    
    const subscriptionMessage = JSON.stringify({
      id: this.subscriptionId,
      nodes: nodes
    });
    
    await this.redisPublisher.publish('$kebSubscribe', subscriptionMessage);
    console.log(`Published to $kebSubscribe:`, subscriptionMessage);
    
    return { success: true, nodeCount: nodes.length };
  }
  
  /**
   * Get currently subscribed nodes
   */
  getSubscribedNodes() {
    return this.subscribedNodes;
  }
  
  /**
   * Register socket.io handlers for KEB protocol
   */
  registerSocketHandlers(io, socket) {
    // Send subscribed nodes to new clients
    socket.emit('subscribed-nodes', this.subscribedNodes);
    socket.emit('keb-protocol-enabled', true);
    
    // Handle node subscription requests
    socket.on('subscribe-nodes', async (nodes) => {
      try {
        const result = await this.subscribeToNodes(nodes);
        
        // Notify all clients
        io.emit('subscription-status', {
          pattern: '*',
          status: `Subscribed to ${result.nodeCount} nodes`
        });
        
        io.emit('subscribed-nodes', nodes);
      } catch (err) {
        console.error('Failed to subscribe to nodes:', err);
        socket.emit('subscription-status', {
          pattern: '*',
          status: 'Error: ' + err.message
        });
      }
    });
  }
  
  /**
   * Clean up resources
   */
  async close() {
    if (this.redisPublisher) {
      await this.redisPublisher.quit();
    }
  }
}

module.exports = KebProtocol;
