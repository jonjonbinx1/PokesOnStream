function getParams() {
    const url = new URL(window.location.href);
    const revealParam = url.searchParams.get("reveal");
    const syncParam = url.searchParams.get("sync");
    const autoStartParam = url.searchParams.get("autostart");
    const modsParam = url.searchParams.get("mods") || "";
    const debugParam = url.searchParams.get("debug");
    return {
        channel: url.searchParams.get("channel"),
        clues: parseInt(url.searchParams.get("clues") || "6", 10),
        totalTime: parseInt(url.searchParams.get("totaltime") || "45", 10),
        interval: parseInt(url.searchParams.get("interval") || "5", 10),
        sync: parseInt(syncParam ?? url.searchParams.get("synctime") ?? "0", 10),
        autoStart: parseInt(autoStartParam ?? "0", 10),
        mods: modsParam
            .split(",")
            .map(name => normalizeText(name))
            .filter(Boolean),
        debug: debugParam === "true",
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

function showRoundOutcome({ win, winnerName = "", pokemon = null }) {
    const outcome = document.getElementById("round-outcome");
    if (!outcome) return;

    outcome.innerHTML = "";
    outcome.classList.remove("hidden");

    const title = document.createElement("div");
    title.className = "outcome-title";

    if (win) {
        title.textContent = `Congratulations ${winnerName}!`;
        createConfetti();
    } else {
        title.textContent = "Better luck next time";
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

        const subtitle = document.createElement("div");
        subtitle.className = "outcome-subtitle";
        subtitle.textContent = pokemon.name;
        outcome.appendChild(subtitle);
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

    const debugPanel = document.getElementById("debug-log");
    if (debugPanel) {
        debugPanel.classList.toggle("hidden", !params.debug);
    }

    debugLog("Debug mode enabled");
    debugLog("Params", params);

    if (!params.channel) {
        document.getElementById("help").classList.remove("hidden");
        return;
    }

    document.getElementById("game").classList.remove("hidden");
    requestAnimationFrame(fitGameToViewport);
    window.addEventListener("resize", fitGameToViewport);

    startRound(params);
    startChatClient(params.channel);
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

    setStatus(`Sync time: ${Math.max(0, params.sync)}s`);
    hideRoundOutcome();

    const cluesEl = document.getElementById("clues");
    cluesEl.innerHTML = "";

    const randomId = Math.floor(Math.random() * 1025) + 1;
    debugLog("Fetching Pokémon", randomId);
    const mon = await loadPokemonFromAPI(randomId);

    if (roundId !== gameState.roundId) return;

    gameState.currentPokemon = mon;
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

    // First clue immediately
    clueFns[0]();
    clueIndex = 1;

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
    const totalStages = 14;
    let revealStarted = false;

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

    // CLUE INTERVAL
    const clueInterval = setInterval(() => {
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

    gameState.timerIds.push(timerTick, revealInterval, clueInterval);
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

    if (!pokemon || gameState.guessedCorrectly || gameState.roundFinished) return;
    if (!normalizedMessage || normalizedMessage.startsWith("!")) return;

    const correctAnswer = normalizeText(pokemon.name);

    debugLog("Guess received", { username, guess: trimmedMessage });

    if (normalizedMessage === correctAnswer) {
        gameState.guessedCorrectly = true;
        gameState.roundFinished = true;
        gameState.winnerName = username;
        setStatus(`${username} got it right: ${pokemon.name}`);
        showRoundOutcome({ win: true, winnerName: username, pokemon });
        debugLog("Correct guess", { username, pokemon: pokemon.name });
        return;
    }

}
