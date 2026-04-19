const socketClient = window.TCGTimerSocket;

const state = {
  snapshot: null,
  connected: false
};

const saveTimers = new Map();
const cardRegistry = new Map();

const elements = {
  body: document.body,
  themeToggle: document.getElementById("theme-toggle"),
  addTimer: document.getElementById("add-timer"),
  connectionPill: document.getElementById("connection-pill"),
  timerList: document.getElementById("timer-list")
};

function pad(value) {
  return String(value).padStart(2, "0");
}

function splitDuration(durationMs) {
  const totalSeconds = Math.max(Math.round(durationMs / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return { minutes, seconds };
}

function formatClock(durationMs, phase) {
  const totalSeconds = Math.max(Math.round(durationMs / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const prefix = phase === "stopwatch" ? "+" : "";

  if (hours > 0) {
    return `${prefix}${hours}:${pad(minutes)}:${pad(seconds)}`;
  }

  return `${prefix}${pad(minutes)}:${pad(seconds)}`;
}

function getPhaseLabel(timer) {
  if (timer.phase === "stopwatch") {
    return timer.running ? "Stopwatch Live" : "Stopwatch Paused";
  }

  return timer.running ? "Countdown Live" : "Countdown Paused";
}

function updateConnectionPill() {
  elements.connectionPill.textContent = state.connected ? "Live sync connected" : "Reconnecting...";
  elements.connectionPill.classList.toggle("is-offline", !state.connected);
}

function sendTimerUpdate(timerId) {
  const card = cardRegistry.get(timerId);

  if (!card) {
    return;
  }

  const minutes = Math.max(Number.parseInt(card.minutesInput.value, 10) || 0, 0);
  const seconds = Math.max(Number.parseInt(card.secondsInput.value, 10) || 0, 0);
  const normalizedSeconds = Math.min(seconds, 59);

  if (String(normalizedSeconds) !== card.secondsInput.value) {
    card.secondsInput.value = String(normalizedSeconds);
  }

  socketClient.emit("admin:update-timer", {
    timerId,
    title: card.titleInput.value,
    durationMs: (minutes * 60 + normalizedSeconds) * 1000
  });
}

function scheduleTimerSave(timerId, delay = 220) {
  window.clearTimeout(saveTimers.get(timerId));

  const timeoutId = window.setTimeout(() => {
    sendTimerUpdate(timerId);
    saveTimers.delete(timerId);
  }, delay);

  saveTimers.set(timerId, timeoutId);
}

function attachSaveListeners(timerId, input) {
  input.addEventListener("input", () => scheduleTimerSave(timerId));
  input.addEventListener("blur", () => {
    window.clearTimeout(saveTimers.get(timerId));
    sendTimerUpdate(timerId);
    saveTimers.delete(timerId);
  });
}

function createTimerCard(timer) {
  const card = document.createElement("article");
  card.className = "timer-card";
  card.dataset.timerId = timer.id;
  card.innerHTML = `
    <div class="timer-card-head">
      <div>
        <p class="section-label">Timer</p>
        <h2 class="timer-title-preview"></h2>
      </div>
      <div class="timer-state"></div>
    </div>

    <div class="timer-clock">
      <p class="timer-phase"></p>
      <p class="timer-value"></p>
    </div>

    <div class="timer-form">
      <label class="field-label">
        Title
        <input class="text-input" type="text" maxlength="80" />
      </label>

      <div class="duration-fields">
        <label class="field-label">
          Minutes
          <input class="number-input duration-minutes" type="number" min="0" max="720" />
        </label>

        <label class="field-label">
          Seconds
          <input class="number-input duration-seconds" type="number" min="0" max="59" />
        </label>
      </div>
    </div>

    <div class="card-actions">
      <button class="card-button is-primary start-pause-button" type="button"></button>
      <button class="card-button reset-button" type="button">Reset</button>
      <button class="card-button is-danger remove-button" type="button">Remove</button>
    </div>
  `;

  const titlePreview = card.querySelector(".timer-title-preview");
  const statePill = card.querySelector(".timer-state");
  const phaseLabel = card.querySelector(".timer-phase");
  const value = card.querySelector(".timer-value");
  const titleInput = card.querySelector(".text-input");
  const minutesInput = card.querySelector(".duration-minutes");
  const secondsInput = card.querySelector(".duration-seconds");
  const startPauseButton = card.querySelector(".start-pause-button");
  const resetButton = card.querySelector(".reset-button");
  const removeButton = card.querySelector(".remove-button");

  attachSaveListeners(timer.id, titleInput);
  attachSaveListeners(timer.id, minutesInput);
  attachSaveListeners(timer.id, secondsInput);

  startPauseButton.addEventListener("click", () => {
    const isRunning = card.dataset.running === "true";

    socketClient.emit(isRunning ? "admin:pause-timer" : "admin:start-timer", {
      timerId: timer.id
    });
  });

  resetButton.addEventListener("click", () => {
    socketClient.emit("admin:reset-timer", { timerId: timer.id });
  });

  removeButton.addEventListener("click", () => {
    socketClient.emit("admin:remove-timer", { timerId: timer.id });
  });

  const registryEntry = {
    card,
    titlePreview,
    statePill,
    phaseLabel,
    value,
    titleInput,
    minutesInput,
    secondsInput,
    startPauseButton
  };

  cardRegistry.set(timer.id, registryEntry);
  return registryEntry;
}

function renderTimers(snapshot) {
  const timerIds = new Set(snapshot.timers.map((timer) => timer.id));

  for (const [timerId, registryEntry] of cardRegistry.entries()) {
    if (timerIds.has(timerId)) {
      continue;
    }

    registryEntry.card.remove();
    cardRegistry.delete(timerId);
  }

  if (snapshot.timers.length === 0) {
    elements.timerList.innerHTML = `<div class="empty-state">No timers configured yet. Add one from this page and it will appear on the display instantly.</div>`;
    return;
  }

  if (elements.timerList.querySelector(".empty-state")) {
    elements.timerList.innerHTML = "";
  }

  snapshot.timers.forEach((timer, index) => {
    const registryEntry = cardRegistry.get(timer.id) || createTimerCard(timer);
    const duration = splitDuration(timer.durationMs);
    const currentChild = elements.timerList.children[index];

    registryEntry.card.classList.toggle("is-stopwatch", timer.phase === "stopwatch");
    registryEntry.card.dataset.running = String(timer.running);
    registryEntry.titlePreview.textContent = timer.title;
    registryEntry.statePill.textContent = getPhaseLabel(timer);
    registryEntry.statePill.classList.toggle("is-stopwatch", timer.phase === "stopwatch");
    registryEntry.phaseLabel.textContent = timer.phase === "stopwatch" ? "Stopwatch" : "Countdown";
    registryEntry.value.textContent = formatClock(timer.displayMs, timer.phase);
    registryEntry.startPauseButton.textContent = timer.running ? "Pause" : "Start";

    if (document.activeElement !== registryEntry.titleInput) {
      registryEntry.titleInput.value = timer.title;
    }

    if (document.activeElement !== registryEntry.minutesInput) {
      registryEntry.minutesInput.value = String(duration.minutes);
    }

    if (document.activeElement !== registryEntry.secondsInput) {
      registryEntry.secondsInput.value = String(duration.seconds);
    }

    if (currentChild !== registryEntry.card) {
      elements.timerList.insertBefore(registryEntry.card, currentChild || null);
    }
  });
}

function render(snapshot) {
  state.snapshot = snapshot;
  elements.body.dataset.theme = snapshot.theme;
  elements.themeToggle.textContent =
    snapshot.theme === "dark" ? "Switch To Light" : "Switch To Dark";

  renderTimers(snapshot);
}

elements.themeToggle.addEventListener("click", () => {
  const currentTheme = state.snapshot?.theme || "dark";
  socketClient.emit("admin:set-theme", {
    theme: currentTheme === "dark" ? "light" : "dark"
  });
});

elements.addTimer.addEventListener("click", () => {
  socketClient.emit("admin:add-timer");
});

socketClient.onConnect(() => {
  state.connected = true;
  updateConnectionPill();
});

socketClient.onDisconnect(() => {
  state.connected = false;
  updateConnectionPill();
});

socketClient.onState((snapshot) => {
  state.connected = true;
  updateConnectionPill();
  render(snapshot);
});

state.connected = socketClient.socket.connected;
updateConnectionPill();
