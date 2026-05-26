const socketClient = window.TCGTimerSocket;
const timerGrid = document.getElementById("timer-grid");
const cardRegistry = new Map();
const displayState = {
  snapshot: null,
  receivedAt: Date.now()
};

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function pad(value) {
  return String(value).padStart(2, "0");
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

function getProjectedTimers() {
  const snapshot = displayState.snapshot;

  if (!snapshot) {
    return [];
  }

  const projectedServerNow = snapshot.serverNow + Math.max(Date.now() - displayState.receivedAt, 0);

  return snapshot.timers.map((timer) => {
    const elapsedMs = timer.running
      ? timer.elapsedMs + Math.max(projectedServerNow - snapshot.serverNow, 0)
      : timer.elapsedMs;
    const phase = elapsedMs >= timer.durationMs ? "stopwatch" : "countdown";
    const displayMs =
      phase === "countdown" ? Math.max(timer.durationMs - elapsedMs, 0) : Math.max(elapsedMs - timer.durationMs, 0);

    return {
      ...timer,
      elapsedMs,
      phase,
      displayMs
    };
  });
}

function chooseGrid(count, viewportWidth, viewportHeight, gap, shellPadding) {
  const availableWidth = Math.max(viewportWidth - shellPadding * 2, 0);
  const availableHeight = Math.max(viewportHeight - shellPadding * 2, 0);
  const maxColumns = Math.min(count, 4);
  let bestGrid = {
    columns: 1,
    rows: Math.max(count, 1),
    cellWidth: availableWidth,
    cellHeight: availableHeight,
    score: Number.NEGATIVE_INFINITY
  };

  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const rows = Math.ceil(count / columns);
    const cellWidth = (availableWidth - gap * (columns - 1)) / columns;
    const cellHeight = (availableHeight - gap * (rows - 1)) / rows;

    if (cellWidth <= 0 || cellHeight <= 0) {
      continue;
    }

    const ratio = cellWidth / cellHeight;
    const targetRatio = count === 1 ? 1.38 : count <= 2 ? 1.06 : 0.95;
    const ratioPenalty = Math.abs(Math.log(ratio / targetRatio));
    const emptySlots = columns * rows - count;
    const balancePenalty = Math.abs(columns - rows) * 0.04;
    const score = cellWidth * cellHeight * (1 - ratioPenalty * 0.28 - emptySlots * 0.08 - balancePenalty);

    if (score > bestGrid.score) {
      bestGrid = {
        columns,
        rows,
        cellWidth,
        cellHeight,
        score
      };
    }
  }

  return bestGrid;
}

function applyLayout(timers) {
  const rootStyle = document.documentElement.style;
  const count = timers.length;

  if (count === 0) {
    rootStyle.setProperty("--columns", "1");
    rootStyle.setProperty("--rows", "1");
    return;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const shortestViewportSide = Math.min(viewportWidth, viewportHeight);
  const longestTitle = timers.reduce((longest, timer) => Math.max(longest, timer.title.length), 0);
  const maxClockCharacters = timers.reduce(
    (longest, timer) => Math.max(longest, formatClock(timer.displayMs, timer.phase).length),
    5
  );
  const shellPadding = clamp(shortestViewportSide * (count === 1 ? 0.008 : 0.01), 4, count === 1 ? 10 : 12);
  const gap = clamp(shortestViewportSide / (count === 1 ? 72 : 64), 4, count === 1 ? 12 : 14);
  const grid = chooseGrid(count, viewportWidth, viewportHeight, gap, shellPadding);
  const usableCellWidth = Math.max(grid.cellWidth, 120);
  const usableCellHeight = Math.max(grid.cellHeight, 120);
  const cardPadding = clamp(
    Math.min(usableCellWidth, usableCellHeight) * (count === 1 ? 0.018 : 0.034),
    6,
    count === 1 ? 16 : 16
  );
  const contentWidth = Math.max(usableCellWidth - cardPadding * 2, 80);
  const contentHeight = Math.max(usableCellHeight - cardPadding * 2, 80);
  const titleLines =
    longestTitle > (count === 1 ? 26 : 18) ? (longestTitle > (count === 1 ? 48 : 30) ? 3 : 2) : 1;
  const charactersPerLine = Math.max(longestTitle / titleLines, 4);
  const titleWidthFactor = count === 1 ? 0.54 : 0.5;
  const titleHeightShare = count === 1 ? 0.3 : count <= 2 ? 0.28 : count <= 4 ? 0.26 : 0.22;
  const clockHeightShare = count === 1 ? 0.66 : count <= 2 ? 0.56 : count <= 4 ? 0.5 : count <= 6 ? 0.44 : 0.39;
  const titleSize = Math.max(
    18,
    Math.min(
      contentWidth / (charactersPerLine * titleWidthFactor),
      (contentHeight * titleHeightShare) / titleLines
    )
  );
  const clockSize = Math.max(
    28,
    Math.min(contentWidth / (maxClockCharacters * 0.56), contentHeight * clockHeightShare)
  );
  const cardGap = clamp(contentHeight * (count === 1 ? 0.045 : 0.042), 6, count === 1 ? 28 : 18);

  rootStyle.setProperty("--columns", String(grid.columns));
  rootStyle.setProperty("--rows", String(grid.rows));
  rootStyle.setProperty("--shell-padding", `${shellPadding}px`);
  rootStyle.setProperty("--grid-height", `${Math.max(viewportHeight - shellPadding * 2, 0)}px`);
  rootStyle.setProperty("--gap", `${gap}px`);
  rootStyle.setProperty("--card-padding", `${cardPadding}px`);
  rootStyle.setProperty("--card-gap", `${cardGap}px`);
  rootStyle.setProperty("--title-size", `${titleSize}px`);
  rootStyle.setProperty("--clock-size", `${clockSize}px`);
  rootStyle.setProperty("--title-max-width", count === 1 ? "94%" : "100%");
}

function render(snapshot) {
  document.body.dataset.theme = snapshot.theme;
  timerGrid.classList.toggle("is-single", snapshot.timers.length === 1);
  const projectedTimers = getProjectedTimers();
  applyLayout(projectedTimers);

  if (snapshot.timers.length === 0) {
    cardRegistry.clear();
    timerGrid.innerHTML = `
      <section class="empty-state">
        <div>
          <h1>TCG Timer</h1>
          <p>Add a timer from the admin page to start the display.</p>
        </div>
      </section>
    `;
    return;
  }

  timerGrid.innerHTML = projectedTimers
    .map(
      (timer) => `
        <section class="timer-card ${timer.phase === "stopwatch" ? "is-stopwatch" : ""}">
          <h1 class="timer-title">${timer.title}</h1>
          <p class="timer-value" data-timer-id="${timer.id}">${formatClock(timer.displayMs, timer.phase)}</p>
        </section>
      `
    )
    .join("");

  cardRegistry.clear();

  for (const valueElement of timerGrid.querySelectorAll(".timer-value")) {
    cardRegistry.set(valueElement.dataset.timerId, valueElement);
  }
}

function renderClockValues() {
  const timers = getProjectedTimers();

  for (const timer of timers) {
    const valueElement = cardRegistry.get(timer.id);

    if (!valueElement) {
      continue;
    }

    valueElement.textContent = formatClock(timer.displayMs, timer.phase);
    valueElement.closest(".timer-card")?.classList.toggle("is-stopwatch", timer.phase === "stopwatch");
  }
}

window.addEventListener("resize", () => {
  if (displayState.snapshot) {
    applyLayout(getProjectedTimers());
  }
});

socketClient.onState((snapshot) => {
  displayState.snapshot = snapshot;
  displayState.receivedAt = Date.now();
  socketClient.setKeepaliveEnabled(snapshot.cloudSessionActive !== false);
  render(snapshot);
});

window.setInterval(renderClockValues, 250);
