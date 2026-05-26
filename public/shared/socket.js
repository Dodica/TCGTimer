window.TCGTimerSocket = (() => {
  const KEEPALIVE_INTERVAL_MS = 30 * 1000;
  const socket = io();
  let keepaliveTimerId = null;

  function sendKeepalive() {
    if (!socket.connected) {
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
    stopKeepalive();
    sendKeepalive();
    keepaliveTimerId = window.setInterval(sendKeepalive, KEEPALIVE_INTERVAL_MS);
  }

  socket.on("connect", startKeepalive);
  socket.on("disconnect", stopKeepalive);

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
    }
  };
})();
