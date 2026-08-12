const SYNCED_LOCAL_COUNTDOWN_SECONDS = 3;
const SYNCED_LOCAL_MIN_AUTOSTART_SECONDS = 5;
const SYNCED_LOCAL_DEFAULT_START_DELAY_SECONDS = 10;

function getParams() {
    const url = new URL(window.location.href);
    const modeParam = (url.searchParams.get("mode") || "").trim().toLowerCase();
    const revealParam = url.searchParams.get("reveal");
    const syncParam = url.searchParams.get("sync");
    const autoStartParam = url.searchParams.get("autostart");
    const leaderboardParam = url.searchParams.get("leaderboard");
    const leaderboardModeParam = url.searchParams.get("leaderboardmode");
    const modsParam = url.searchParams.get("mods") || "";
    const debugParam = url.searchParams.get("debug");
    const isLocal = modeParam === "local";
    const totalTimeParam = url.searchParams.get("totaltime");
    const sessionSeed = (url.searchParams.get("sessionseed") || "").trim();
    const parsedSessionStartAt = parseInt(url.searchParams.get("sessionstart") || "", 10);
    const sessionStartAt = Number.isFinite(parsedSessionStartAt) ? parsedSessionStartAt : null;
    const parsedAutoStart = parseInt(autoStartParam ?? "0", 10);
    const isSyncedLocal = isLocal && Boolean(sessionSeed) && Number.isFinite(sessionStartAt);

    const normalizedLeaderboardValue = (leaderboardParam || "").trim().toLowerCase();
    const normalizedLeaderboardMode = (leaderboardModeParam || "").trim().toLowerCase();

    let leaderboardMode = "off";
    if (normalizedLeaderboardValue === "always" || normalizedLeaderboardMode === "always") {
        leaderboardMode = "always";
    } else if (
        normalizedLeaderboardValue === "true"
        || normalizedLeaderboardValue === "popup"
        || normalizedLeaderboardMode === "popup"
    ) {
        leaderboardMode = "popup";
    }

    return {
        mode: isLocal ? "local" : "chat",
        isLocal,
        channel: url.searchParams.get("channel"),
        clues: parseInt(url.searchParams.get("clues") || "6", 10),
        totalTime: parseInt(totalTimeParam || (isLocal ? "7" : "45"), 10),
        interval: parseInt(url.searchParams.get("interval") || "5", 10),
        sync: parseInt(syncParam ?? url.searchParams.get("synctime") ?? "0", 10),
        autoStart: isSyncedLocal
            ? Math.max(parsedAutoStart || 0, SYNCED_LOCAL_MIN_AUTOSTART_SECONDS)
            : parsedAutoStart,
        mods: modsParam
            .split(",")
            .map(name => normalizeText(name))
            .filter(Boolean),
        debug: debugParam === "true",
        leaderboard: leaderboardMode !== "off",
        leaderboardMode,
        reveal: revealParam === null ? null : parseInt(revealParam, 10),
        isSyncedLocal,
        sessionSeed,
        sessionStartAt
    };
}

const gameState = {
    roundId: 0,
    currentPokemon: null,
    params: null,
    guessedCorrectly: false,
    roundFinished: false,
    winnerName: "",
    sessionScores: {},
    roundStartedAt: 0,
    syncedLocalRoundIndex: -1,
    autoStartTimerId: null,
    timerIds: []
};

function clearRoundTimers() {
    gameState.timerIds.forEach(id => clearInterval(id));
    gameState.timerIds = [];
    if (gameState.autoStartTimerId) {
        clearTimeout(gameState.autoStartTimerId);
        gameState.autoStartTimerId = null;
    }
}

function isSyncedLocalMode(params = gameState.params) {
    return Boolean(params?.isSyncedLocal);
}

function xmur3(value) {
    let hash = 1779033703 ^ value.length;

    for (let index = 0; index < value.length; index += 1) {
        hash = Math.imul(hash ^ value.charCodeAt(index), 3432918353);
        hash = (hash << 13) | (hash >>> 19);
    }

    return () => {
        hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
        hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
        hash ^= hash >>> 16;
        return hash >>> 0;
    };
}

function mulberry32(seed) {
    return () => {
        let value = seed += 0x6D2B79F5;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function createSeededRandom(seedText) {
    const hashSeed = xmur3(seedText);
    return mulberry32(hashSeed());
}

function getRandomIntInclusive(rng, min, max) {
    return Math.floor(rng() * ((max - min) + 1)) + min;
}

function getSyncedLocalRoundSeed(params, roundIndex) {
    return `${params.sessionSeed}:${roundIndex}`;
}

function getSyncedLocalRoundStartAt(params, roundIndex) {
    const cycleMs = (params.totalTime + params.autoStart) * 1000;
    return params.sessionStartAt + (roundIndex * cycleMs);
}

function scheduleSyncedLocalRound(params, roundIndex) {
    const startAt = getSyncedLocalRoundStartAt(params, roundIndex);
    startRound(params, { startAt, roundIndex });
}

function fitGameToViewport() {
    const game = document.getElementById("game");
    if (!game || game.classList.contains("hidden")) return;

    game.style.transform = "none";
    game.style.width = "";
    game.style.height = "";
    game.style.transformOrigin = "top center";

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rect = game.getBoundingClientRect();
    const contentWidth = Math.max(game.scrollWidth, rect.width);
    const contentHeight = Math.max(game.scrollHeight, rect.height);

    if (!contentWidth || !contentHeight) return;

    const scale = Math.min(
        1,
        viewportWidth / contentWidth,
        viewportHeight / contentHeight
    );

    game.style.transform = `scale(${scale})`;
}

function normalizeText(value) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getPokemonGuessAliases(pokemon) {
    const aliases = new Set();

    if (pokemon?.name) {
        aliases.add(normalizeText(pokemon.name));
    }

    if (pokemon?.speciesName) {
        aliases.add(normalizeText(pokemon.speciesName));
    }

    return Array.from(aliases).filter(Boolean);
}

function isAllowedNextPokeUser(username, params) {
    const normalizedUsername = normalizeText(username);
    const streamerName = normalizeText(params.channel || "");
    return normalizedUsername === streamerName || params.mods.includes(normalizedUsername);
}

function setStatus(message) {
    const statusEl = document.getElementById("status");
    if (statusEl) {
        statusEl.textContent = message;
    }
}

function hideRoundOutcome() {
    const outcome = document.getElementById("round-outcome");
    if (outcome) {
        outcome.classList.add("hidden");
        outcome.innerHTML = "";
    }
}

function showCountdownOverlay(value) {
    const overlay = document.getElementById("countdown-overlay");
    if (!overlay) return;

    overlay.textContent = String(value);
    overlay.classList.remove("hidden");
}

function hideCountdownOverlay() {
    const overlay = document.getElementById("countdown-overlay");
    if (!overlay) return;

    overlay.classList.add("hidden");
    overlay.textContent = "";
}

function clearPokemonDisplay() {
    const gifEl = document.getElementById("poke-gif");
    if (!gifEl) return;

    const gifCtx = gifEl.getContext("2d");
    gifEl.className = "s-hidden";
    gifEl.style.visibility = "hidden";
    gifCtx.clearRect(0, 0, gifEl.width, gifEl.height);
}

function getLocalCountdownAnnouncement(msUntilStart) {
    const safeMsUntilStart = Math.max(1, msUntilStart);
    const secondsRemaining = Math.max(1, Math.ceil(safeMsUntilStart / 1000));

    if (safeMsUntilStart >= 60000) {
        const minutesRemaining = Math.ceil(safeMsUntilStart / 60000);
        const minuteLabel = `${minutesRemaining} minute${minutesRemaining === 1 ? "" : "s"}`;
        return {
            overlayValue: minuteLabel,
            statusValue: minuteLabel
        };
    }

    if (safeMsUntilStart >= 15000) {
        return { overlayValue: "30", statusValue: "30 seconds" };
    }

    if (safeMsUntilStart >= 10000) {
        return { overlayValue: "15", statusValue: "15 seconds" };
    }

    if (safeMsUntilStart >= 5000) {
        return { overlayValue: "10", statusValue: "10 seconds" };
    }

    if (safeMsUntilStart >= 3000) {
        return { overlayValue: "5", statusValue: "5 seconds" };
    }

    return {
        overlayValue: String(secondsRemaining),
        statusValue: `${secondsRemaining} second${secondsRemaining === 1 ? "" : "s"}`
    };
}

function startLocalCountdown(params, roundId, options = {}) {
    const { startAt = null, roundIndex = null } = options;

    if (Number.isFinite(startAt)) {
        const roundLabel = Number.isInteger(roundIndex) ? roundIndex + 1 : null;
        let lastOverlayValue = null;

        const tick = () => {
            if (roundId !== gameState.roundId) return;

            const msUntilStart = startAt - Date.now();
            if (msUntilStart <= 0) {
                hideCountdownOverlay();
                hideRoundOutcome();
                runRound(params, roundId, { roundIndex, startAt });
                return;
            }

            const { overlayValue, statusValue } = getLocalCountdownAnnouncement(msUntilStart);

            if (overlayValue !== lastOverlayValue) {
                showCountdownOverlay(overlayValue);
                setStatus(
                    roundLabel == null
                        ? `Round starts in ${statusValue}`
                        : `Synced round ${roundLabel} starts in ${statusValue}`
                );
                lastOverlayValue = overlayValue;
            }

            const timerId = setTimeout(tick, 250);
            gameState.timerIds.push(timerId);
        };

        tick();
        return;
    }

    const countdownValues = ["3", "2", "1"];
    let index = 0;

    const showNextValue = () => {
        if (roundId !== gameState.roundId) return;

        const currentValue = countdownValues[index];
        if (!currentValue) {
            hideCountdownOverlay();
            hideRoundOutcome();
            runRound(params, roundId);
            return;
        }

        showCountdownOverlay(currentValue);
        setStatus(`Next round in ${currentValue}`);
        index += 1;

        const timerId = setTimeout(showNextValue, 700);
        gameState.timerIds.push(timerId);
    };

    showNextValue();
}

function scheduleAutoStart(params) {
    if (isSyncedLocalMode(params)) return;

    const delaySeconds = Math.max(0, params.autoStart || 0);
    if (!delaySeconds) return;

    if (gameState.autoStartTimerId) {
        clearTimeout(gameState.autoStartTimerId);
    }

    debugLog("Auto-start scheduled", { delaySeconds });
    gameState.autoStartTimerId = setTimeout(() => {
        gameState.autoStartTimerId = null;
        debugLog("Auto-start firing");
        startRound(params);
    }, delaySeconds * 1000);
}

function createConfetti() {
    const confetti = document.createElement("div");
    confetti.className = "confetti";
    const colors = ["#ffcb05", "#2a75bb", "#ff4d4d", "#4dff4d", "#ffffff"];

    for (let i = 0; i < 24; i++) {
        const piece = document.createElement("div");
        piece.className = "confetti-piece";
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.background = colors[i % colors.length];
        piece.style.animationDuration = `${1.8 + Math.random() * 1.5}s`;
        piece.style.animationDelay = `${Math.random() * 0.4}s`;
        piece.style.transform = `rotate(${Math.random() * 360}deg)`;
        confetti.appendChild(piece);
    }

    document.body.appendChild(confetti);
    setTimeout(() => confetti.remove(), 4000);
}

function formatSolveTime(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
        return "--";
    }

    const totalTenths = Math.round(milliseconds / 100);
    const minutes = Math.floor(totalTenths / 600);
    const seconds = Math.floor((totalTenths % 600) / 10);
    const tenths = totalTenths % 10;

    return `${minutes}:${seconds.toString().padStart(2, "0")}.${tenths}`;
}

function formatPokemonDisplayName(name) {
    return (name || "the Pokemon")
        .split(/[-\s]+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function getLeaderboardEntries() {
    return Object.entries(gameState.sessionScores)
        .sort((left, right) => {
            if (right[1].score !== left[1].score) {
                return right[1].score - left[1].score;
            }

            if (left[1].fastestMs == null && right[1].fastestMs != null) {
                return 1;
            }

            if (right[1].fastestMs == null && left[1].fastestMs != null) {
                return -1;
            }

            if (left[1].fastestMs != null && right[1].fastestMs != null && left[1].fastestMs !== right[1].fastestMs) {
                return left[1].fastestMs - right[1].fastestMs;
            }

            return left[0].localeCompare(right[0]);
        });
}

function createLeaderboardCard(extraClassName = "") {
    const wrap = document.createElement("section");
    wrap.className = ["leaderboard-card", extraClassName].filter(Boolean).join(" ");

    const heading = document.createElement("h2");
    heading.className = "leaderboard-title";
    heading.textContent = "Session Leaderboard";
    wrap.appendChild(heading);

    const entries = getLeaderboardEntries();

    if (entries.length === 0) {
        const empty = document.createElement("p");
        empty.className = "leaderboard-empty";
        empty.textContent = "No correct guesses yet this session.";
        wrap.appendChild(empty);
        return wrap;
    }

    const list = document.createElement("div");
    list.className = "leaderboard-list";

    entries.slice(0, 5).forEach(([name, stats], index) => {
        const item = document.createElement("div");
        item.className = "leaderboard-item";

        const rank = document.createElement("span");
        rank.className = "leaderboard-rank";
        rank.textContent = `#${index + 1}`;

        const player = document.createElement("span");
        player.className = "leaderboard-player";
        player.textContent = name;

        const meta = document.createElement("div");
        meta.className = "leaderboard-meta";

        const points = document.createElement("span");
        points.className = "leaderboard-score";
        points.textContent = `${stats.score} ${stats.score === 1 ? "point" : "points"}`;

        const fastest = document.createElement("span");
        fastest.className = "leaderboard-fastest";
        fastest.textContent = `Best ${formatSolveTime(stats.fastestMs)}`;

        meta.appendChild(points);
        meta.appendChild(fastest);

        item.appendChild(rank);
        item.appendChild(player);
        item.appendChild(meta);
        list.appendChild(item);
    });

    wrap.appendChild(list);
    return wrap;
}

function syncPersistentLeaderboard() {
    const panel = document.getElementById("leaderboard-panel");
    if (!panel) return;

    const shouldShow = gameState.params?.leaderboardMode === "always";
    panel.classList.toggle("hidden", !shouldShow);

    if (!shouldShow) {
        panel.innerHTML = "";
        return;
    }

    panel.innerHTML = "";
    panel.appendChild(createLeaderboardCard("persistent-leaderboard"));
}

function syncOutcomeLeaderboard() {
    const outcome = document.getElementById("round-outcome");
    if (!outcome || outcome.classList.contains("hidden")) return;

    const currentLeaderboard = outcome.querySelector(".outcome-leaderboard");
    if (!currentLeaderboard) return;

    currentLeaderboard.replaceWith(createLeaderboardCard("outcome-leaderboard"));
}

function resetLeaderboard() {
    gameState.sessionScores = {};
    syncPersistentLeaderboard();
    syncOutcomeLeaderboard();
}

function showRoundOutcome({ win, winnerName = "", pokemon = null }) {
    const outcome = document.getElementById("round-outcome");
    if (!outcome) return;

    const params = gameState.params || {};

    clearRoundTimers();

    outcome.innerHTML = "";
    outcome.classList.remove("hidden");

    const brand = document.createElement("div");
    brand.className = "outcome-brand";
    brand.textContent = "PokesOnStream";
    outcome.appendChild(brand);

    const title = document.createElement("div");
    title.className = "outcome-title";

    if (win) {
        title.textContent = `Congratulations ${winnerName}!`;
        createConfetti();
    } else {
        title.textContent = params.isLocal && pokemon
            ? `It's ${formatPokemonDisplayName(pokemon.name)}`
            : "Better luck next time";
    }

    outcome.appendChild(title);

    if (win) {
        const subtitle = document.createElement("div");
        subtitle.className = "outcome-subtitle";
        subtitle.textContent = `You guessed ${pokemon?.name || "the Pokémon"} correctly.`;
        outcome.appendChild(subtitle);

        const cheer = document.createElement("div");
        cheer.className = "outcome-celebration celebrate-bounce";
        cheer.textContent = "Great job!";
        outcome.appendChild(cheer);
    } else if (pokemon) {
        const img = document.createElement("img");
        img.className = "outcome-sprite";
        img.src = pokemon.gif;
        img.alt = pokemon.name;
        outcome.appendChild(img);

        if (!params.isLocal) {
            const subtitle = document.createElement("div");
            subtitle.className = "outcome-subtitle";
            subtitle.textContent = pokemon.name;
            outcome.appendChild(subtitle);
        }
    }

    if (gameState.params?.leaderboard && gameState.params?.leaderboardMode !== "always") {
        outcome.appendChild(createLeaderboardCard("outcome-leaderboard"));
    }

    if (params.isLocal && !isSyncedLocalMode(params)) {
        const nextHint = document.createElement("div");
        nextHint.className = "outcome-next-hint";
        nextHint.textContent = "Click anywhere to show the next Pokemon";
        outcome.appendChild(nextHint);
    }

    if (isSyncedLocalMode(params)) {
        scheduleSyncedLocalRound(params, gameState.syncedLocalRoundIndex + 1);
        return;
    }

    scheduleAutoStart(gameState.params || {});
}

function formatDebugValue(value) {
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function getDefaultTotalTimeForMode(mode) {
    return mode === "local" ? "7" : "45";
}

function getDefaultAutoStartForMode(mode) {
    return mode === "local" ? "0" : "0";
}

function padTwoDigits(value) {
    return value.toString().padStart(2, "0");
}

function toLocalDateTimeValue(timestamp) {
    const date = new Date(timestamp);

    return `${date.getFullYear()}-${padTwoDigits(date.getMonth() + 1)}-${padTwoDigits(date.getDate())}T${padTwoDigits(date.getHours())}:${padTwoDigits(date.getMinutes())}`;
}

function getLocalHelperState() {
    const sessionType = document.getElementById("local-helper-session-type")?.value || "standard";
    const startMode = document.getElementById("local-helper-start-mode")?.value || "seconds";
    const secondsValue = parseInt(document.getElementById("local-helper-start-seconds")?.value.trim() || "", 10);
    const minutesValue = parseInt(document.getElementById("local-helper-start-minutes")?.value.trim() || "", 10);
    const autoStartValue = parseInt(document.getElementById("local-helper-autostart")?.value.trim() || "", 10);
    const dateTimeValue = document.getElementById("local-helper-start-datetime")?.value || "";
    const now = Date.now();
    let startAt = now + (SYNCED_LOCAL_DEFAULT_START_DELAY_SECONDS * 1000);

    if (startMode === "minutes") {
        const minutes = Number.isFinite(minutesValue) ? minutesValue : 0;
        startAt = now + (Math.max(1, minutes) * 60 * 1000);
    } else if (startMode === "datetime") {
        const parsedDateTime = Date.parse(dateTimeValue);

        if (Number.isFinite(parsedDateTime)) {
            startAt = parsedDateTime;
        }
    } else {
        const seconds = Number.isFinite(secondsValue) ? secondsValue : 0;
        startAt = now + (Math.max(SYNCED_LOCAL_DEFAULT_START_DELAY_SECONDS, seconds) * 1000);
    }

    startAt = Math.max(startAt, now + (SYNCED_LOCAL_DEFAULT_START_DELAY_SECONDS * 1000));

    return {
        sessionType,
        startMode,
        startAt,
        autoStart: Math.max(SYNCED_LOCAL_MIN_AUTOSTART_SECONDS, Number.isFinite(autoStartValue) ? autoStartValue : 0)
    };
}

function syncLocalHelperInputs() {
    const startMode = document.getElementById("local-helper-start-mode")?.value || "seconds";
    const helperInputs = document.querySelectorAll("[data-local-helper-mode]");
    const dateTimeField = document.getElementById("local-helper-start-datetime");

    helperInputs.forEach(node => {
        node.classList.toggle("hidden", node.dataset.localHelperMode !== startMode);
    });

    if (dateTimeField && !dateTimeField.value) {
        dateTimeField.value = toLocalDateTimeValue(Date.now() + (5 * 60 * 1000));
    }
}

function updateLocalHelperVisibility(mode) {
    const helper = document.getElementById("local-game-helper");
    if (!helper) return;

    const helperFields = helper.querySelectorAll("input, select");
    const isLocal = mode === "local";

    helper.classList.toggle("inactive", !isLocal);

    helperFields.forEach(field => {
        if (field.id === "local-helper-session-type") return;
        field.disabled = !isLocal;
    });
}

function updateLocalHelperSummary(mode) {
    const summary = document.getElementById("local-helper-summary");
    if (!summary) return;

    if (mode !== "local") {
        summary.textContent = "Switch Mode to Local side-by-side to schedule a synced start time. Then choose Synced local session to set when the first round begins.";
        return;
    }

    const helperState = getLocalHelperState();
    const startsInSeconds = Math.max(0, Math.ceil((helperState.startAt - Date.now()) / 1000));
    const startLabel = new Date(helperState.startAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });

    if (helperState.sessionType !== "synced") {
        summary.textContent = "Standard local mode uses the normal local URL. Switch to Synced local session to schedule a shared start time.";
        return;
    }

    summary.textContent = `Synced local will start in about ${startsInSeconds}s at ${startLabel}. Between rounds it waits ${helperState.autoStart}s before scheduling the next shared round.`;
}

function appendDebugLog(...args) {
    if (!window.pokeDebugEnabled) return;

    const panel = document.getElementById("debug-log-list");
    if (!panel) return;

    const entry = document.createElement("div");
    entry.className = "debug-log-entry";
    entry.textContent = args.map(formatDebugValue).join(" ");
    panel.appendChild(entry);
    panel.scrollTop = panel.scrollHeight;
}

function debugLog(...args) {
    if (window.pokeDebugEnabled) {
        console.log("[PokesOnStream]", ...args);
        appendDebugLog(...args);
    }
}

function buildOverlayUrlFromForm(modeOverride = null) {
    const selectedMode = document.getElementById("generator-mode")?.value || "chat";
    const mode = modeOverride || selectedMode;
    const channel = document.getElementById("generator-channel")?.value.trim() || "";
    const clues = document.getElementById("generator-clues")?.value.trim() || "6";
    const totalTimeField = document.getElementById("generator-totaltime");
    const rawTotalTime = totalTimeField?.value.trim() || "";
    const interval = document.getElementById("generator-interval")?.value.trim() || "5";
    const reveal = document.getElementById("generator-reveal")?.value.trim() || "";
    const sync = document.getElementById("generator-sync")?.value.trim() || "0";
    const autoStartField = document.getElementById("generator-autostart");
    const rawAutoStart = autoStartField?.value.trim() || "";
    const mods = document.getElementById("generator-mods")?.value.trim() || "";
    const debug = document.getElementById("generator-debug")?.checked;
    const leaderboardMode = document.getElementById("generator-leaderboard")?.value || "off";
    const totalTime = rawTotalTime
        ? modeOverride && selectedMode !== modeOverride && rawTotalTime === getDefaultTotalTimeForMode(selectedMode)
            ? getDefaultTotalTimeForMode(mode)
            : rawTotalTime
        : getDefaultTotalTimeForMode(mode);
    const autoStart = rawAutoStart
        ? modeOverride && selectedMode !== modeOverride && rawAutoStart === getDefaultAutoStartForMode(selectedMode)
            ? getDefaultAutoStartForMode(mode)
            : rawAutoStart
        : getDefaultAutoStartForMode(mode);

    const url = new URL("https://jonjonbinx1.github.io/PokesOnStream/");

    if (mode === "local") {
        url.searchParams.set("mode", "local");
    }

    if (channel) {
        url.searchParams.set("channel", channel);
    }

    url.searchParams.set("clues", clues);
    url.searchParams.set("totaltime", totalTime);
    url.searchParams.set("interval", interval);
    url.searchParams.set("sync", sync);
    url.searchParams.set("autostart", autoStart);

    if (reveal !== "") {
        url.searchParams.set("reveal", reveal);
    }

    if (mods) {
        url.searchParams.set("mods", mods);
    }

    if (debug) {
        url.searchParams.set("debug", "true");
    }

    url.searchParams.set("leaderboard", leaderboardMode);

    return { url, channel, mode };
}

function buildSyncedLocalSessionUrlFromForm() {
    const { url } = buildOverlayUrlFromForm("local");
    const helperState = getLocalHelperState();
    const sessionSeed = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

    url.searchParams.set("autostart", String(helperState.autoStart));
    url.searchParams.set("sessionseed", sessionSeed);
    url.searchParams.set("sessionstart", String(helperState.startAt));

    return url;
}

function updateGeneratedUrl() {
    const output = document.getElementById("generated-url");
    const openLink = document.getElementById("open-generated-url");
    const localLink = document.getElementById("play-local-url");
    const status = document.getElementById("generator-status");

    if (!output || !openLink || !localLink || !status) return;

    const { url, channel, mode } = buildOverlayUrlFromForm();
    const { url: localModeUrl } = buildOverlayUrlFromForm("local");
    const generatedUrl = url.toString();
    const helperState = mode === "local" ? getLocalHelperState() : null;
    const generatedLocalUrl = helperState?.sessionType === "synced"
        ? buildSyncedLocalSessionUrlFromForm().toString()
        : localModeUrl.toString();

    output.value = mode === "local" ? generatedLocalUrl : generatedUrl;
    openLink.href = mode === "local" ? generatedLocalUrl : generatedUrl;
    localLink.href = generatedLocalUrl;
    openLink.textContent = "Open URL";
    localLink.textContent = helperState?.sessionType === "synced" ? "Open Synced Local" : "Play Local";
    updateLocalHelperVisibility(mode);
    syncLocalHelperInputs();
    updateLocalHelperSummary(mode);

    if (mode === "local") {
        status.textContent = helperState?.sessionType === "synced"
            ? "Synced local URL ready. Open it in both browsers before the scheduled start time."
            : "Local URL ready. Switch Local session type to Synced local session when two players need the same seeded session on a call.";
        return;
    }

    localLink.textContent = "Play Local";
    status.textContent = channel
        ? "URL ready to copy into OBS or a browser source."
        : "Add a channel name to create a usable overlay URL, or use Play Local.";
}

async function copyGeneratedUrl() {
    const output = document.getElementById("generated-url");
    const status = document.getElementById("generator-status");

    if (!output || !status) return;

    try {
        await navigator.clipboard.writeText(output.value);
        status.textContent = "Generated URL copied.";
    } catch {
        output.focus();
        output.select();
        status.textContent = "Copy failed. The URL is selected so you can copy it manually.";
    }
}

async function createSyncedLocalUrl() {
    const output = document.getElementById("generated-url");
    const status = document.getElementById("generator-status");

    if (!output || !status) return;

    const syncedUrl = buildSyncedLocalSessionUrlFromForm().toString();
    output.value = syncedUrl;

    try {
        await navigator.clipboard.writeText(syncedUrl);
        status.textContent = "Synced local URL copied. Open it in both browsers before the countdown ends.";
    } catch {
        output.focus();
        output.select();
        status.textContent = "Synced local URL selected. Copy it manually and open it in both browsers before the countdown ends.";
    }
}

function setupHelpPageGenerator() {
    const help = document.getElementById("help");
    if (!help) return;

    const baseLabel = document.getElementById("generator-base-url");
    if (baseLabel) {
        baseLabel.textContent = "https://jonjonbinx1.github.io/PokesOnStream/";
    }

    const fields = help.querySelectorAll("input, select");
    fields.forEach(field => {
        const eventName = field.tagName === "SELECT" || field.type === "checkbox"
            ? "change"
            : "input";
        field.addEventListener(eventName, updateGeneratedUrl);
    });

    const modeField = document.getElementById("generator-mode");
    const totalTimeField = document.getElementById("generator-totaltime");
    const autoStartField = document.getElementById("generator-autostart");
    const localHelperAutoStartField = document.getElementById("local-helper-autostart");

    modeField?.addEventListener("change", () => {
        if (!totalTimeField || !autoStartField) return;

        const nextMode = modeField.value || "chat";
        const previousMode = nextMode === "local" ? "chat" : "local";
        const previousDefault = getDefaultTotalTimeForMode(previousMode);
        const nextDefault = getDefaultTotalTimeForMode(nextMode);
        const previousAutoStartDefault = getDefaultAutoStartForMode(previousMode);
        const nextAutoStartDefault = getDefaultAutoStartForMode(nextMode);

        if (!totalTimeField.value || totalTimeField.value === previousDefault) {
            totalTimeField.value = nextDefault;
        }

        if (!autoStartField.value || autoStartField.value === previousAutoStartDefault) {
            autoStartField.value = nextAutoStartDefault;
        }

        updateGeneratedUrl();
    });

    localHelperAutoStartField?.addEventListener("input", () => {
        const helperAutoStart = parseInt(localHelperAutoStartField.value.trim() || "", 10);

        if (autoStartField && Number.isFinite(helperAutoStart)) {
            autoStartField.value = String(Math.max(SYNCED_LOCAL_MIN_AUTOSTART_SECONDS, helperAutoStart));
        }
    });

    document.getElementById("copy-generated-url")?.addEventListener("click", copyGeneratedUrl);
    document.getElementById("create-synced-local-url")?.addEventListener("click", createSyncedLocalUrl);

    syncLocalHelperInputs();
    updateLocalHelperVisibility(modeField?.value || "chat");

    updateGeneratedUrl();
}

window.pokeDebugEnabled = false;
window.pokeDebugLog = debugLog;

function renderWrongGuesses() {
    const listEl = document.getElementById("wrong-guesses-list");
    const wrapperEl = document.getElementById("wrong-guesses");

    if (!listEl || !wrapperEl) return;

    listEl.innerHTML = "";

    if (gameState.wrongGuesses.length === 0) {
        wrapperEl.classList.add("empty");
        const empty = document.createElement("div");
        empty.className = "wrong-guesses-empty";
        empty.textContent = "No wrong guesses yet.";
        listEl.appendChild(empty);
        return;
    }

    wrapperEl.classList.remove("empty");

    gameState.wrongGuesses.forEach(guess => {
        const item = document.createElement("div");
        item.className = "wrong-guess-item";
        item.textContent = guess;
        listEl.appendChild(item);
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    const params = getParams();
    gameState.params = params;
    window.pokeDebugEnabled = params.debug;

    setupHelpPageGenerator();

    const debugPanel = document.getElementById("debug-log");
    if (debugPanel) {
        debugPanel.classList.toggle("hidden", !params.debug);
    }

    debugLog("Debug mode enabled");
    debugLog("Params", params);

    if (!params.channel && !params.isLocal) {
        document.getElementById("help").classList.remove("hidden");
        return;
    }

    document.body.classList.toggle("local-mode", params.isLocal);
    document.getElementById("help")?.classList.add("hidden");

    const gameEl = document.getElementById("game");
    gameEl.classList.remove("hidden");
    gameEl.classList.toggle("local-mode", params.isLocal);

        document.getElementById("round-outcome")?.addEventListener("click", () => {
            const outcome = document.getElementById("round-outcome");
            if (!gameState.params?.isLocal || isSyncedLocalMode(gameState.params) || !outcome || outcome.classList.contains("hidden")) return;

            startRound(gameState.params);
        });

    syncPersistentLeaderboard();
    requestAnimationFrame(fitGameToViewport);
    window.addEventListener("resize", fitGameToViewport);

    if (isSyncedLocalMode(params)) {
        if (Date.now() >= params.sessionStartAt) {
            setStatus("This synced local session already started. Create a new synced local URL.");
        } else {
            scheduleSyncedLocalRound(params, 0);
        }
    } else {
        startRound(params);
    }

    if (!params.isLocal && params.channel) {
        startChatClient(params.channel);
    }
});

async function loadPokemonFromAPI(id) {
    const pkmRes = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
    const speciesRes = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}`);

    const pkm = await pkmRes.json();
    const species = await speciesRes.json();

    return transformPokemonData(pkm, species);
}

function transformPokemonData(pkm, species) {
    const stats = {};
    pkm.stats.forEach(s => stats[s.stat.name] = s.base_stat);

    const abilities = pkm.abilities.map(a => a.ability.name);
    const types = pkm.types.map(t => t.type.name);

    const generation = species.generation.name.replace("generation-", "").toUpperCase();
    const bst = Object.values(stats).reduce((a, b) => a + b, 0);

    return {
        id: pkm.id,
        name: pkm.name,
        speciesName: species.name,
        types,
        abilities,
        stats,
        bst,
        generation,
        gif: pkm.sprites.other["official-artwork"].front_default
    };
}

async function extractColors(imageUrl) {
    const palette = await Vibrant.from(imageUrl).getPalette();
    const swatches = Object.values(palette)
        .filter(s => s)
        .map(s => ({ hex: s.hex, population: s.population }));

    swatches.sort((a, b) => b.population - a.population);
    return swatches;
}

function createClueBlock(title) {
    const block = document.createElement("div");
    block.className = "clue-section";

    const h2 = document.createElement("h2");
    h2.textContent = title;

    const content = document.createElement("div");
    content.className = "clue-content";

    block.appendChild(h2);
    block.appendChild(content);

    document.getElementById("clues").appendChild(block);

    return content;
}

function statColor(value) {
    if (value < 50) return "#ff4d4d";
    if (value < 100) return "#ff944d";
    if (value < 150) return "#ffe44d";
    if (value < 200) return "#a6ff4d";
    return "#4dff4d";
}

async function runRound(params, roundId, options = {}) {
    const { roundIndex = null, startAt = null } = options;
    const syncedRng = isSyncedLocalMode(params) && Number.isInteger(roundIndex)
        ? createSeededRandom(getSyncedLocalRoundSeed(params, roundIndex))
        : null;
    const randomId = syncedRng
        ? getRandomIntInclusive(syncedRng, 1, 1025)
        : Math.floor(Math.random() * 1025) + 1;
    debugLog("Fetching Pokémon", randomId);
    const mon = await loadPokemonFromAPI(randomId);

    if (roundId !== gameState.roundId) return;

    gameState.currentPokemon = mon;
    gameState.roundStartedAt = Number.isFinite(startAt) ? startAt : Date.now();
    debugLog("Loaded Pokémon", mon.name);

    const gifEl = document.getElementById("poke-gif");
    const gifCtx = gifEl.getContext("2d");
    gifCtx.imageSmoothingEnabled = false;
    gifEl.className = "s-hidden";
    gifEl.style.visibility = "hidden";
    gifCtx.clearRect(0, 0, gifEl.width, gifEl.height);
    setStatus("Guess the Pokémon");

    const clueFns = buildClueFunctions(mon, roundId, syncedRng || Math.random);
    const maxClues = Math.min(params.clues, clueFns.length);
    const revealWindow = Number.isFinite(params.reveal)
        ? params.reveal
        : params.isLocal
            ? Math.max(1, params.totalTime)
            : Math.max(1, Math.floor(params.totalTime / 2));

    let clueIndex = 0;
    let elapsed = 0;

    const timerEl = document.getElementById("timer");
    timerEl.textContent = formatTime(params.totalTime);

    const revealImage = await loadImage(mon.gif);
    const drawBuffer = document.createElement("canvas");
    const drawBufferCtx = drawBuffer.getContext("2d");

    const drawReveal = (progress) => {
        const pixelSize = Math.max(1, Math.round(96 - (progress * 95)));
        const sourceWidth = Math.max(1, Math.floor(revealImage.width / pixelSize));
        const sourceHeight = Math.max(1, Math.floor(revealImage.height / pixelSize));

        drawBuffer.width = sourceWidth;
        drawBuffer.height = sourceHeight;

        drawBufferCtx.imageSmoothingEnabled = false;
        drawBufferCtx.clearRect(0, 0, drawBuffer.width, drawBuffer.height);
        drawBufferCtx.filter = `grayscale(${Math.round((1 - progress) * 100)}%)`;
        drawBufferCtx.drawImage(revealImage, 0, 0, drawBuffer.width, drawBuffer.height);

        gifCtx.clearRect(0, 0, gifEl.width, gifEl.height);
        gifCtx.imageSmoothingEnabled = false;
        gifCtx.filter = `grayscale(${Math.round((1 - progress) * 100)}%)`;

        const scale = Math.min(gifEl.width / revealImage.width, gifEl.height / revealImage.height);
        const drawWidth = Math.max(1, Math.floor(revealImage.width * scale));
        const drawHeight = Math.max(1, Math.floor(revealImage.height * scale));
        const offsetX = Math.floor((gifEl.width - drawWidth) / 2);
        const offsetY = Math.floor((gifEl.height - drawHeight) / 2);

        gifCtx.drawImage(drawBuffer, 0, 0, drawBuffer.width, drawBuffer.height, offsetX, offsetY, drawWidth, drawHeight);
    };

    if (params.isLocal) {
        clueFns.slice(0, maxClues).forEach(fn => fn());
        clueIndex = maxClues;
    } else {
        clueFns[0]();
        clueIndex = 1;
    }

    const timerTick = setInterval(() => {
        if (roundId !== gameState.roundId) {
            clearInterval(timerTick);
            return;
        }

        elapsed += 1;

        const remaining = params.totalTime - elapsed;
        timerEl.textContent = formatTime(Math.max(remaining, 0));

        if (remaining <= 0 && !gameState.roundFinished) {
            gameState.roundFinished = true;
            showRoundOutcome({ win: false, pokemon: gameState.currentPokemon });
        }

        if (remaining <= 0) {
            clearInterval(timerTick);
        }
    }, 1000);

    let revealStarted = Boolean(params.isLocal);

    if (revealStarted) {
        gifEl.style.visibility = "visible";
    }

    const updateReveal = () => {
        if (roundId !== gameState.roundId) {
            clearInterval(revealInterval);
            return;
        }

        const remaining = params.totalTime - elapsed;
        const revealProgress = revealWindow <= 0
            ? 1
            : Math.min(1, Math.max(0, 1 - (remaining / revealWindow)));

        if (remaining <= revealWindow && !revealStarted) {
            revealStarted = true;
            gifEl.style.visibility = "visible";
        }

        if (!revealStarted) return;

        drawReveal(revealProgress);

        if (remaining <= 0) {
            clearInterval(revealInterval);
        }
    };

    const revealInterval = setInterval(updateReveal, 100);
    updateReveal();

    let clueInterval = null;

    if (!params.isLocal) {
        clueInterval = setInterval(() => {
            if (roundId !== gameState.roundId) {
                clearInterval(clueInterval);
                return;
            }

            if (clueIndex < maxClues) {
                clueFns[clueIndex]();
                clueIndex++;
            }

            if (elapsed >= params.totalTime) {
                clearInterval(clueInterval);
            }
        }, params.interval * 1000);
    }

    gameState.timerIds.push(timerTick, revealInterval);
    if (clueInterval) {
        gameState.timerIds.push(clueInterval);
    }
    requestAnimationFrame(fitGameToViewport);
}

async function startRound(params, options = {}) {
    const { startAt = null, roundIndex = null } = options;
    const roundId = ++gameState.roundId;
    debugLog("Starting round", { roundId, sync: params.sync, totalTime: params.totalTime, startAt, roundIndex });
    clearRoundTimers();
    gameState.currentPokemon = null;
    gameState.guessedCorrectly = false;
    gameState.roundFinished = false;
    gameState.winnerName = "";

    if (Number.isInteger(roundIndex)) {
        gameState.syncedLocalRoundIndex = roundIndex;
    }

    hideCountdownOverlay();
    setStatus(params.isLocal ? "Get ready" : `Sync time: ${Math.max(0, params.sync)}s`);
    clearPokemonDisplay();

    if (!params.isLocal) {
        hideRoundOutcome();
    }

    const cluesEl = document.getElementById("clues");
    cluesEl.innerHTML = "";

    const timerEl = document.getElementById("timer");
    timerEl.textContent = formatTime(params.totalTime);

    if (params.isLocal) {
        startLocalCountdown(params, roundId, { startAt, roundIndex });
        return;
    }

    await runRound(params, roundId);
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

function buildClueFunctions(mon, roundId, rng = Math.random) {
    const fns = [];
    const isLocal = Boolean(gameState.params?.isLocal);
    const compactStatOrder = ["hp", "attack", "defense", "special-attack", "special-defense", "speed"];
    const compactStatLabels = {
        hp: "HP",
        attack: "Attack",
        defense: "Defense",
        "special-attack": "Sp. Attack",
        "special-defense": "Sp. Defense",
        speed: "Speed"
    };
    const localStatClues = shuffleArray(compactStatOrder.slice(), rng).slice(0, 2);

    fns.push(() => {
        const content = createClueBlock("Type");
        mon.types.forEach((t, idx) => {
            const span = document.createElement("span");
            span.textContent = idx === 0 ? t : ` / ${t}`;
            content.appendChild(span);
        });
    });

    if (!isLocal) {
        fns.push(() => {
            const content = createClueBlock("Abilities");
            mon.abilities.forEach((ab, idx) => {
                const span = document.createElement("span");
                span.textContent = idx === 0 ? ab : `, ${ab}`;
                content.appendChild(span);
            });
        });
    }

    fns.push(() => {
        const content = createClueBlock("Base Stat Total");
        content.textContent = mon.bst;
    });

    fns.push(() => {
        const content = createClueBlock("Stats");
        if (isLocal) {
            const firstStat = localStatClues[0];
            const value = mon.stats[firstStat];
            content.textContent = `${compactStatLabels[firstStat]}: ${value}`;
            return;
        }

        Object.entries(mon.stats).forEach(([statName, value]) => {
            const row = document.createElement("div");
            row.textContent = `${statName.toUpperCase()}: ${value}`;

            const bar = document.createElement("div");
            bar.className = "stat-bar";

            const fill = document.createElement("div");
            fill.className = "stat-bar-fill";
            fill.style.width = `${(value / 255) * 100}%`;
            fill.style.backgroundColor = statColor(value);

            bar.appendChild(fill);
            content.appendChild(row);
            content.appendChild(bar);
        });
    });

    if (isLocal) {
        fns.push(() => {
            const secondStat = localStatClues[1];
            const content = createClueBlock(compactStatLabels[secondStat]);
            content.textContent = mon.stats[secondStat];
        });
    }

    fns.push(() => {
        const content = createClueBlock("Generation");
        content.textContent = `Gen ${mon.generation}`;
    });

    fns.push(async () => {
        const content = createClueBlock("Color");
        const bar = document.createElement("div");
        bar.className = "color-swatches";
        content.appendChild(bar);

        const colors = await extractColors(mon.gif);
        if (roundId !== gameState.roundId) return;

        const total = colors.reduce((sum, c) => sum + c.population, 0);

        colors.forEach(c => {
            const div = document.createElement("div");
            div.className = "color-swatch";
            div.style.backgroundColor = c.hex;
            div.style.width = `${(c.population / total) * 100}%`;
            bar.appendChild(div);
        });
    });

    return shuffleArray(fns, rng);
}

function shuffleArray(arr, rng = Math.random) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, "0")}`;
}

function handleChatMessage(username, message) {
    const params = gameState.params;
    const pokemon = gameState.currentPokemon;

    if (!params) return;

    const trimmedMessage = message.trim();
    const normalizedMessage = normalizeText(trimmedMessage);
    const normalizedUsername = normalizeText(username);

    if (normalizedMessage === "nextpoke" && isAllowedNextPokeUser(username, params)) {
        debugLog("Next round requested", { username, message: trimmedMessage });
        startRound(params);
        return;
    }

    if (normalizedMessage === "resetleaderboard" && isAllowedNextPokeUser(username, params)) {
        debugLog("Leaderboard reset requested", { username, message: trimmedMessage });
        resetLeaderboard();
        setStatus(`${username} reset the leaderboard`);
        return;
    }

    if (!pokemon || gameState.guessedCorrectly || gameState.roundFinished) return;
    if (!normalizedMessage || normalizedMessage.startsWith("!")) return;
    const acceptedAnswers = getPokemonGuessAliases(pokemon);

    debugLog("Guess received", { username, guess: trimmedMessage });

    if (acceptedAnswers.includes(normalizedMessage)) {
        const solveTimeMs = Math.max(0, Date.now() - gameState.roundStartedAt);
        const currentStats = gameState.sessionScores[username] || { score: 0, fastestMs: null };

        gameState.guessedCorrectly = true;
        gameState.roundFinished = true;
        gameState.winnerName = username;
        gameState.sessionScores[username] = {
            score: currentStats.score + 1,
            fastestMs: currentStats.fastestMs == null
                ? solveTimeMs
                : Math.min(currentStats.fastestMs, solveTimeMs)
        };
        syncPersistentLeaderboard();
        setStatus(`${username} got it right: ${pokemon.name}`);
        showRoundOutcome({ win: true, winnerName: username, pokemon });
        debugLog("Correct guess", { username, pokemon: pokemon.name, solveTimeMs });
        return;
    }

}
