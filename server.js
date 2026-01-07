const { createClient } = require("redis");
const express = require("express");
const app = express();

// message forwarding to browsers omitted for brevity

(async () => {
  const redisCmd = createClient({ url: process.env.REDIS_URL });
  const redisSub = createClient({ url: process.env.REDIS_URL });

  await redisCmd.connect();
  await redisSub.connect();

  const responseTopic = `keb_${Date.now()}`;
  const availableNodes = [];

  // discovery response
  await redisSub.subscribe(responseTopic, msg => {
    const data = JSON.parse(msg);
    if(data.nodes) {
      data.nodes.forEach(n => availableNodes.push(n.nodeTopic));
    }
  });

  // ask for discovery
  await redisCmd.publish("$kebDiscovery", JSON.stringify({
    requestId: responseTopic,
    action: "browse",
    responseTopic
  }));

  // wait a bit then subscribe
  setTimeout(async () => {
    await redisCmd.publish("$kebSubscribe", JSON.stringify({
      id: responseTopic,
      nodes: availableNodes
    }));

    availableNodes.forEach(async topic => {
      await redisSub.subscribe(topic, message => {
        // push to SSE or WebSocket
        console.log(topic, message);
      });
    });
  }, 1000);

})();