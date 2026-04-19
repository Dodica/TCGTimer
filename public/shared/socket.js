window.TCGTimerSocket = (() => {
  const socket = io();

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
