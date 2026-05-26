window.TCGTimerSocket = (() => {
  const KEEPALIVE_INTERVAL_MS = 30 * 1000;
  const socket = io();
  let keepaliveEnabled = true;
  let keepaliveTimerId = null;

  function sendKeepalive() {
    if (!keepaliveEnabled || !socket.connected) {
      return;
    }

    socket.emit("client:keepalive", {
      sentAt: Date.now()
    });
  }

  function stopKeepalive() {
    window.clearInterval(keepaliveTimerId);
    keepaliveTimerId = null;
  }

  function startKeepalive() {
    if (!keepaliveEnabled) {
      return;
    }

    stopKeepalive();
    sendKeepalive();
    keepaliveTimerId = window.setInterval(sendKeepalive, KEEPALIVE_INTERVAL_MS);
  }

  function setKeepaliveEnabled(nextValue) {
    keepaliveEnabled = Boolean(nextValue);

    if (keepaliveEnabled && socket.connected) {
      startKeepalive();
      return;
    }

    stopKeepalive();
  }

  socket.on("connect", startKeepalive);
  socket.on("disconnect", stopKeepalive);
  socket.on("server:cloud-session-ended", () => {
    setKeepaliveEnabled(false);
    window.setTimeout(() => socket.disconnect(), 250);
  });

  return {
    socket,
    emit(eventName, payload) {
      socket.emit(eventName, payload);
    },
    onState(handler) {
      socket.on("state", handler);
      return () => socket.off("state", handler);
    },
    onConnect(handler) {
      socket.on("connect", handler);
      return () => socket.off("connect", handler);
    },
    onDisconnect(handler) {
      socket.on("disconnect", handler);
      return () => socket.off("disconnect", handler);
    },
    connect() {
      socket.connect();
    },
    setKeepaliveEnabled
  };
})();
