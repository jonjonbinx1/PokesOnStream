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
        autoStart: parseInt(autoStartParam ?? "0", 10),
        mods: modsParam
            .split(",")
            .map(name => normalizeText(name))
            .filter(Boolean),
        debug: debugParam === "true",
        leaderboard: leaderboardMode !== "off",
        leaderboardMode,
        reveal: revealParam === null ? null : parseInt(revealParam, 10)
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

function scheduleAutoStart(params) {
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
    const autoStart = document.getElementById("generator-autostart")?.value.trim() || "0";
    const mods = document.getElementById("generator-mods")?.value.trim() || "";
    const debug = document.getElementById("generator-debug")?.checked;
    const leaderboardMode = document.getElementById("generator-leaderboard")?.value || "off";
    const totalTime = rawTotalTime
        ? modeOverride && selectedMode !== modeOverride && rawTotalTime === getDefaultTotalTimeForMode(selectedMode)
            ? getDefaultTotalTimeForMode(mode)
            : rawTotalTime
        : getDefaultTotalTimeForMode(mode);

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

function updateGeneratedUrl() {
    const output = document.getElementById("generated-url");
    const openLink = document.getElementById("open-generated-url");
    const localLink = document.getElementById("play-local-url");
    const status = document.getElementById("generator-status");

    if (!output || !openLink || !localLink || !status) return;

    const { url, channel, mode } = buildOverlayUrlFromForm();
    const { url: localModeUrl } = buildOverlayUrlFromForm("local");
    const generatedUrl = url.toString();

    output.value = generatedUrl;
    openLink.href = generatedUrl;
    localLink.href = localModeUrl.toString();
    openLink.textContent = mode === "local" ? "Open Local URL" : "Open URL";

    if (mode === "local") {
        status.textContent = "Local URL ready to open side-by-side or copy into a browser source.";
        return;
    }

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

    modeField?.addEventListener("change", () => {
        if (!totalTimeField) return;

        const previousDefault = modeField.value === "local" ? "45" : "7";
        const nextDefault = modeField.value === "local" ? "7" : "45";

        if (!totalTimeField.value || totalTimeField.value === previousDefault) {
            totalTimeField.value = nextDefault;
        }

        updateGeneratedUrl();
    });

    document.getElementById("copy-generated-url")?.addEventListener("click", copyGeneratedUrl);

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

    document.getElementById("game").classList.remove("hidden");
    syncPersistentLeaderboard();
    requestAnimationFrame(fitGameToViewport);
    window.addEventListener("resize", fitGameToViewport);

    startRound(params);
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

async function startRound(params) {
    const roundId = ++gameState.roundId;
    debugLog("Starting round", { roundId, sync: params.sync, totalTime: params.totalTime });
    clearRoundTimers();
    gameState.currentPokemon = null;
    gameState.guessedCorrectly = false;
    gameState.roundFinished = false;
    gameState.winnerName = "";

    setStatus(params.isLocal ? "Local round starting" : `Sync time: ${Math.max(0, params.sync)}s`);
    hideRoundOutcome();

    const cluesEl = document.getElementById("clues");
    cluesEl.innerHTML = "";

    const randomId = Math.floor(Math.random() * 1025) + 1;
    debugLog("Fetching Pokémon", randomId);
    const mon = await loadPokemonFromAPI(randomId);

    if (roundId !== gameState.roundId) return;

    gameState.currentPokemon = mon;
    gameState.roundStartedAt = Date.now();
    debugLog("Loaded Pokémon", mon.name);

    const gifEl = document.getElementById("poke-gif");
    const gifCtx = gifEl.getContext("2d");
    gifCtx.imageSmoothingEnabled = false;
    gifEl.className = "s-hidden";
    gifEl.style.visibility = "hidden";
    gifCtx.clearRect(0, 0, gifEl.width, gifEl.height);
    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.textContent = "Guess the Pokémon";

    const clueFns = buildClueFunctions(mon, roundId);
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

    // TIMER INTERVAL (every second)
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

    // RESOLUTION-BASED REVEAL
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

        // Start reveal when remaining time <= reveal window
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

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

function buildClueFunctions(mon, roundId) {
    const fns = [];

    fns.push(() => {
        const content = createClueBlock("Type");
        mon.types.forEach((t, idx) => {
            const span = document.createElement("span");
            span.textContent = idx === 0 ? t : ` / ${t}`;
            content.appendChild(span);
        });
    });

    fns.push(() => {
        const content = createClueBlock("Abilities");
        mon.abilities.forEach((ab, idx) => {
            const span = document.createElement("span");
            span.textContent = idx === 0 ? ab : `, ${ab}`;
            content.appendChild(span);
        });
    });

    fns.push(() => {
        const content = createClueBlock("Base Stat Total");
        content.textContent = mon.bst;
    });

    fns.push(() => {
        const content = createClueBlock("Stats");
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

    return shuffleArray(fns);
}

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
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
