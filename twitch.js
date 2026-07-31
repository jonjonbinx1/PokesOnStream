function startChatClient(channel) {
  const socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443");

  const debugLog = (...args) => {
    if (window.pokeDebugEnabled && typeof window.pokeDebugLog === "function") {
      window.pokeDebugLog(...args);
    }
  };

  socket.onopen = () => {
    debugLog("Chat socket opened");
    socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership");
    socket.send("PASS SCHMOOPIIE");
    socket.send("NICK justinfan" + Math.floor(Math.random() * 100000));
    socket.send(`JOIN #${channel.toLowerCase()}`);
    if (typeof setStatus === "function") {
      setStatus("Connected to chat");
    }
  };

  socket.onerror = () => {
    debugLog("Chat socket error");
    if (typeof setStatus === "function") {
      setStatus("Chat connection error");
    }
  };

  socket.onclose = () => {
    debugLog("Chat socket closed");
    if (typeof setStatus === "function") {
      setStatus("Chat disconnected");
    }
  };

  socket.onmessage = (event) => {
    const messages = event.data.split("\r\n").filter(Boolean);

    debugLog("Chat raw message", event.data);

    for (const msg of messages) {
      if (msg.startsWith("PING")) {
        debugLog("Chat ping received");
        socket.send(msg.replace("PING", "PONG"));
        continue;
      }

      if (!msg.includes("PRIVMSG")) continue;

      const withoutTags = msg.startsWith("@") ? msg.slice(msg.indexOf(" ") + 1) : msg;
      const userMatch = withoutTags.match(/^:([^!]+)!/);
      const messageIndex = withoutTags.indexOf("PRIVMSG");
      const textIndex = withoutTags.indexOf(" :", messageIndex);

      if (!userMatch || textIndex === -1) {
        debugLog("Chat parse skipped", { msg });
        continue;
      }

      const username = userMatch[1];
      const message = withoutTags.slice(textIndex + 2);

      debugLog("Chat message", { username, message });

      handleChatMessage(username, message);
    }
  };
}
