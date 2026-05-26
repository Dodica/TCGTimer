const os = require("os");
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;
const UPDATE_INTERVAL_MS = 250;
const KEEPALIVE_INTERVAL_MS = 30 * 1000;
const RENDER_SELF_PING_INTERVAL_MS = Number(process.env.RENDER_SELF_PING_INTERVAL_MS) || 10 * 60 * 1000;
const MAX_TIMERS = 12;
const MAX_DURATION_MS = 12 * 60 * 60 * 1000;

let nextTimerId = 1;

function sanitizeTheme(theme) {
  return theme === "light" ? "light" : "dark";
}

function sanitizeTitle(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 80) || fallback;
}

function clampDuration(durationMs) {
  if (!Number.isFinite(durationMs)) {
    return 0;
  }

  return Math.min(Math.max(Math.round(durationMs), 0), MAX_DURATION_MS);
}

function createTimer(input = {}, index = 0) {
  const fallbackTitle = `Timer ${index + 1}`;

  return {
    id: `timer-${nextTimerId++}`,
    title: sanitizeTitle(input.title, fallbackTitle),
    durationMs: clampDuration(input.durationMs ?? 0),
    elapsedMs: 0,
    running: false,
    startedAt: null
  };
}

function hydrateTimers(timerConfigs = []) {
  return timerConfigs.slice(0, MAX_TIMERS).map((timer, index) => createTimer(timer, index));
}

let state = {
  theme: "dark",
  timers: hydrateTimers([{ title: "Round Timer", durationMs: 50 * 60 * 1000 }])
};
let cloudSessionActive = true;
let connectedSockets = 0;

function getElapsedMs(timer, now) {
  if (!timer.running || timer.startedAt === null) {
    return timer.elapsedMs;
  }

  return timer.elapsedMs + Math.max(now - timer.startedAt, 0);
}

function getTimerView(timer, now) {
  const effectiveElapsedMs = getElapsedMs(timer, now);
  const countdownMs = Math.max(timer.durationMs - effectiveElapsedMs, 0);
  const stopwatchMs = Math.max(effectiveElapsedMs - timer.durationMs, 0);
  const phase = effectiveElapsedMs >= timer.durationMs ? "stopwatch" : "countdown";

  return {
    id: timer.id,
    title: timer.title,
    durationMs: timer.durationMs,
    elapsedMs: effectiveElapsedMs,
    displayMs: phase === "countdown" ? countdownMs : stopwatchMs,
    phase,
    running: timer.running
  };
}

function getSnapshot(now = Date.now()) {
  return {
    serverNow: now,
    theme: state.theme,
    cloudSessionActive,
    timers: state.timers.map((timer) => getTimerView(timer, now))
  };
}

function emitState(io) {
  io.emit("state", getSnapshot());
}

function findTimer(timerId) {
  return state.timers.find((timer) => timer.id === timerId);
}

function pauseTimer(timer, now = Date.now()) {
  if (!timer || !timer.running) {
    return;
  }

  timer.elapsedMs = getElapsedMs(timer, now);
  timer.running = false;
  timer.startedAt = null;
}

function startTimer(timer, now = Date.now()) {
  if (!timer || timer.running) {
    return;
  }

  timer.running = true;
  timer.startedAt = now;
}

function resetTimer(timer) {
  if (!timer) {
    return;
  }

  timer.elapsedMs = 0;
  timer.running = false;
  timer.startedAt = null;
}

function getLocalIpv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const networkInterface of Object.values(interfaces)) {
    for (const details of networkInterface || []) {
      if (details.family !== "IPv4" || details.internal) {
        continue;
      }

      addresses.push(details.address);
    }
  }

  return addresses;
}

function startRenderSelfPing() {
  const externalUrl = process.env.RENDER_EXTERNAL_URL;

  if (!externalUrl) {
    return;
  }

  const healthUrl = new URL("/health", externalUrl).toString();

  setInterval(async () => {
    if (!cloudSessionActive || connectedSockets === 0) {
      return;
    }

    try {
      const response = await fetch(healthUrl);

      if (!response.ok) {
        console.warn(`Render self-ping returned ${response.status}`);
      }
    } catch (error) {
      console.warn(`Render self-ping failed: ${error.message}`);
    }
  }, RENDER_SELF_PING_INTERVAL_MS);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_request, response) => {
  response.redirect("/display/");
});

app.get("/display", (_request, response) => {
  response.redirect("/display/");
});

app.get("/admin", (_request, response) => {
  response.redirect("/admin/");
});

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    cloudSessionActive,
    connectedClients: connectedSockets,
    uptimeSeconds: Math.round(process.uptime()),
    serverNow: Date.now()
  });
});

io.on("connection", (socket) => {
  connectedSockets += 1;
  socket.emit("state", getSnapshot());

  socket.on("disconnect", () => {
    connectedSockets = Math.max(connectedSockets - 1, 0);
  });

  socket.on("client:keepalive", (payload = {}) => {
    if (!cloudSessionActive) {
      return;
    }

    socket.emit("server:keepalive", {
      intervalMs: KEEPALIVE_INTERVAL_MS,
      clientSentAt: payload.sentAt || null,
      serverNow: Date.now()
    });
  });

  socket.on("admin:set-theme", (payload = {}) => {
    state.theme = sanitizeTheme(payload.theme);
    emitState(io);
  });

  socket.on("admin:end-session", () => {
    const now = Date.now();

    cloudSessionActive = false;

    for (const timer of state.timers) {
      pauseTimer(timer, now);
    }

    io.emit("server:cloud-session-ended");
    emitState(io);
  });

  socket.on("admin:start-session", () => {
    cloudSessionActive = true;
    emitState(io);
  });

  socket.on("admin:add-timer", () => {
    if (state.timers.length >= MAX_TIMERS) {
      return;
    }

    const nextIndex = state.timers.length;
    const durationMs = state.timers[nextIndex - 1]?.durationMs ?? 50 * 60 * 1000;
    const title = `Timer ${nextIndex + 1}`;

    state.timers.push(createTimer({ title, durationMs }, nextIndex));
    emitState(io);
  });

  socket.on("admin:remove-timer", (payload = {}) => {
    const beforeCount = state.timers.length;
    state.timers = state.timers.filter((timer) => timer.id !== payload.timerId);

    if (state.timers.length === beforeCount) {
      return;
    }

    emitState(io);
  });

  socket.on("admin:update-timer", (payload = {}) => {
    const timer = findTimer(payload.timerId);

    if (!timer) {
      return;
    }

    timer.title = sanitizeTitle(payload.title, timer.title);
    timer.durationMs = clampDuration(payload.durationMs);
    emitState(io);
  });

  socket.on("admin:start-timer", (payload = {}) => {
    startTimer(findTimer(payload.timerId));
    emitState(io);
  });

  socket.on("admin:pause-timer", (payload = {}) => {
    pauseTimer(findTimer(payload.timerId));
    emitState(io);
  });

  socket.on("admin:reset-timer", (payload = {}) => {
    resetTimer(findTimer(payload.timerId));
    emitState(io);
  });
});

setInterval(() => {
  emitState(io);
}, UPDATE_INTERVAL_MS);

server.listen(PORT, HOST, () => {
  console.log(`TCG Timer running on http://localhost:${PORT}`);
  startRenderSelfPing();

  for (const address of getLocalIpv4Addresses()) {
    console.log(`Admin:   http://${address}:${PORT}/admin/`);
    console.log(`Display: http://${address}:${PORT}/display/`);
  }
});
