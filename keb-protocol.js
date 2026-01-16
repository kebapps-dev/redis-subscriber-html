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
    
    // Separate client for discovery responses
    this.redisDiscovery = new Redis({
      host: redisHost,
      port: redisPort
    });
    
    this.subscribedNodes = [];
    this.subscriptionId = this.generateId();
    this.discoveredNodes = [];
    
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
   * Discover available KEB nodes
   */
  async discoverNodes() {
    return new Promise((resolve, reject) => {
      const responseTopic = `keb_${Date.now()}`;
      this.discoveredNodes = [];
      
      // Subscribe to response topic
      this.redisDiscovery.subscribe(responseTopic, (err) => {
        if (err) {
          console.error('Failed to subscribe to discovery response:', err);
          reject(err);
          return;
        }
        
        console.log(`Subscribed to discovery response topic: ${responseTopic}`);
        
        // Set timeout for discovery
        const timeout = setTimeout(() => {
          this.redisDiscovery.unsubscribe(responseTopic);
          resolve(this.discoveredNodes);
        }, 2000); // Wait 2 seconds for responses
        
        // Handle discovery responses
        this.redisDiscovery.on('message', (channel, message) => {
          if (channel === responseTopic) {
            try {
              const data = JSON.parse(message);
              if (data.nodes && Array.isArray(data.nodes)) {
                data.nodes.forEach(node => {
                  if (node.nodeTopic) {
                    this.discoveredNodes.push(node.nodeTopic);
                  }
                });
                console.log(`Discovered ${data.nodes.length} nodes`);
              }
            } catch (err) {
              console.error('Failed to parse discovery response:', err);
            }
          }
        });
        
        // Publish discovery request
        const discoveryMessage = JSON.stringify({
          requestId: responseTopic,
          action: 'browse',
          responseTopic: responseTopic
        });
        
        this.redisPublisher.publish('$kebDiscovery', discoveryMessage)
          .then(() => {
            console.log(`Published to $kebDiscovery:`, discoveryMessage);
          })
          .catch((err) => {
            clearTimeout(timeout);
            this.redisDiscovery.unsubscribe(responseTopic);
            reject(err);
          });
      });
    });
  }
  
  /**
   * Get discovered nodes
   */
  getDiscoveredNodes() {
    return this.discoveredNodes;
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
    socket.emit('discovered-nodes', this.discoveredNodes);
    socket.emit('keb-protocol-enabled', true);
    
    // Handle discovery requests
    socket.on('discover-nodes', async () => {
      try {
        const nodes = await this.discoverNodes();
        
        console.log(`Discovery complete: ${nodes.length} nodes found`);
        
        // Notify all clients
        io.emit('discovered-nodes', nodes);
        io.emit('subscription-status', {
          pattern: '*',
          status: `Discovered ${nodes.length} nodes`
        });
      } catch (err) {
        console.error('Failed to discover nodes:', err);
        socket.emit('subscription-status', {
          pattern: '*',
          status: 'Discovery error: ' + err.message
        });
      }
    });
    
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
    
    // Handle individual node subscription
    socket.on('subscribe-node', async (node) => {
      try {
        // Add to subscribed list if not already present
        if (!this.subscribedNodes.includes(node)) {
          this.subscribedNodes.push(node);
        }
        
        // Publish individual subscription
        const subscriptionMessage = JSON.stringify({
          id: this.subscriptionId,
          nodes: [node]
        });
        
        await this.redisPublisher.publish('$kebSubscribe', subscriptionMessage);
        console.log(`Published to $kebSubscribe: ${subscriptionMessage}`);
      } catch (err) {
        console.error(`Failed to subscribe to node ${node}:`, err);
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
    if (this.redisDiscovery) {
      await this.redisDiscovery.quit();
    }
  }
}

module.exports = KebProtocol;
