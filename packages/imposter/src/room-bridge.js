"use strict";

/**
 * Adapter between NUMVERSE rooms and the pure Imposter engine.
 * No DOM / Prisma / ws — server.js owns those.
 */

const {
  MIN_PLAYERS,
  MAX_PLAYERS,
  PHASE,
  createGame,
  publicState,
  privateView,
  nextPicker,
  pickCard,
  autoPickCard,
  confirmReveal,
  submitClue,
  skipClue,
  submitVote,
  submitGuess,
  tick,
  normalizeInfo,
  normalizeImpostorCount,
  normalizeClueRounds,
  listCategories,
  normalizeCategory
} = require("./index");

function isImposterCat(cat) {
  return cat === "imposter";
}

function isImposterRoom(room) {
  return !!(room && isImposterCat(room.cat));
}

function roomCap(room, defaultCap) {
  if (isImposterRoom(room)) return MAX_PLAYERS;
  return Number(defaultCap) || 12;
}

function normalizeCat(cat) {
  if (cat === "wheel" || cat === "secret" || cat === "snake" || cat === "imposter") return cat;
  return null;
}

function applyLobbyDefaults(room) {
  if (!room) return;
  if (room.impostorInfo !== "category" && room.impostorInfo !== "none") {
    room.impostorInfo = "none";
  }
  room.impostorCount = normalizeImpostorCount(room.impostorCount || 1, (room.players || []).length || 4);
  const d = Number(room.discussionSec);
  room.discussionSec = Number.isFinite(d) ? Math.min(180, Math.max(30, d)) : 60;
  const v = Number(room.voteSec);
  room.voteSec = Number.isFinite(v) ? Math.min(120, Math.max(20, v)) : 45;
  const c = Number(room.clueSec);
  room.clueSec = Number.isFinite(c) ? Math.min(120, Math.max(15, c)) : 45;
  room.clueRounds = normalizeClueRounds(room.clueRounds);
  room.wordCategory = normalizeCategory(room.wordCategory);
}

function orderedPlayers(room) {
  const list = [];
  const names = Array.isArray(room.order) ? room.order : [];
  for (const name of names) {
    const p = (room.players || []).find((x) => x.name === name);
    if (p) list.push(p);
  }
  if (!list.length) return (room.players || []).slice();
  return list;
}

function isBotPlayer(room, playerId) {
  const p = (room.players || []).find((x) => String(x.id) === String(playerId));
  return !!(p && p.bot);
}

/** Advance bot card picks / reveal confirms so humans are not blocked. */
function autoPlayBots(room) {
  const state = room && room.imposter;
  if (!state) return false;
  let changed = false;
  let guard = 24;
  while (guard-- > 0) {
    if (state.phase === PHASE.CARD_PICK) {
      const picker = nextPicker(state);
      if (!picker || !isBotPlayer(room, picker)) break;
      const res = autoPickCard(state, picker);
      if (!res.ok) break;
      changed = true;
      continue;
    }
    if (state.phase === PHASE.ROLE_REVEAL) {
      let did = false;
      for (const p of room.players || []) {
        if (!p || !p.bot) continue;
        const id = String(p.id);
        if (state.roles[id] && !state.confirmed[id]) {
          confirmReveal(state, id);
          did = true;
          changed = true;
        }
      }
      if (!did) break;
      continue;
    }
    break;
  }
  return changed;
}

function startImposter(room) {
  applyLobbyDefaults(room);
  const ordered = orderedPlayers(room);
  if (ordered.length < MIN_PLAYERS || ordered.length > MAX_PLAYERS) {
    const err = new Error("invalid_player_count");
    err.code = "invalid_player_count";
    throw err;
  }
  const state = createGame({
    players: ordered.map((p) => ({ id: String(p.id), name: String(p.name) })),
    impostorInfo: room.impostorInfo,
    impostorCount: room.impostorCount,
    discussionSec: room.discussionSec,
    voteSec: room.voteSec,
    clueSec: room.clueSec,
    maxRounds: room.clueRounds,
    wordCategory: room.impostorInfo === "category" ? room.wordCategory : "all"
  });
  room.imposter = state;
  room.phase = "imposter";
  room.over = null;
  room.startedAt = room.startedAt || Date.now();
  room._persisted = false;
  autoPlayBots(room);
  return state;
}

function clearImposter(room) {
  if (room) room.imposter = null;
}

function snapImposter(room, player) {
  if (!room || !room.imposter) return null;
  return publicState(room.imposter, player && player.id);
}

function privateImposter(room, player) {
  if (!room || !room.imposter || !player) return null;
  return privateView(room.imposter, player.id);
}

function chatAllowed() {
  return true;
}

function tickImposter(room) {
  if (!room || !room.imposter) return false;
  const before = room.imposter.phase;
  const beforeEnds = room.imposter.phaseEndsAt;
  tick(room.imposter);
  autoPlayBots(room);
  return room.imposter.phase !== before || room.imposter.phaseEndsAt !== beforeEnds;
}

function finishIfDone(room, setOver) {
  if (!room || !room.imposter || room.imposter.phase !== PHASE.FINISHED) return false;
  const st = room.imposter;
  const villagersWin = st.winner === "villagers";
  const title = villagersWin ? "ทีมปกติชนะ!" : "Imposter ชนะ!";
  const note = st.winReason || "";
  const imposters = st.order
    .filter((id) => st.roles[id] === "imposter")
    .map((id) => st.names[id] || id);
  if (typeof setOver === "function") {
    setOver(room, {
      title,
      note,
      mode: "imposter",
      secretLabel: "คำศัพท์คือ",
      secretText: st.word,
      many: false,
      hist: null,
      again: "เล่นอีกครั้ง",
      reset: true,
      winners: villagersWin
        ? st.order.filter((id) => st.roles[id] === "villager").map((id) => st.names[id])
        : imposters,
      imposters,
      word: st.word,
      category: st.category,
      guessText: st.lastGuess || "",
      guessName: st.lastGuessName || ""
    });
  }
  return true;
}

module.exports = {
  MIN_PLAYERS,
  MAX_PLAYERS,
  PHASE,
  isImposterCat,
  isImposterRoom,
  roomCap,
  normalizeCat,
  applyLobbyDefaults,
  startImposter,
  clearImposter,
  snapImposter,
  privateImposter,
  chatAllowed,
  tickImposter,
  finishIfDone,
  autoPlayBots,
  nextPicker,
  pickCard,
  autoPickCard,
  confirmReveal,
  submitClue,
  skipClue,
  submitVote,
  submitGuess,
  normalizeInfo,
  normalizeImpostorCount,
  normalizeClueRounds,
  listCategories,
  normalizeCategory
};
