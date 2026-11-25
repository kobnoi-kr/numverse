"use strict";

const { pickWord, normalizeCategory } = require("../config/words");

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 8;
const ROLE_REVEAL_MS = 20_000;
const CARD_PICK_MS = 30_000;
const DEFAULT_CLUE_SEC = 45;
const DEFAULT_CLUE_ROUNDS = 5;
const MIN_CLUE_ROUNDS = 1;
/** Soft safety cap only — lobby UX is effectively unlimited. */
const MAX_CLUE_ROUNDS = 99;
const CLUE_MAX_LEN = 32;

const PHASE = {
  CARD_PICK: "CARD_PICK",
  ROLE_REVEAL: "ROLE_REVEAL",
  CLUE_TURN: "CLUE_TURN",
  DISCUSSION: "DISCUSSION",
  VOTING: "VOTING",
  VOTE_RESULT: "VOTE_RESULT",
  GUESS: "GUESS",
  FINISHED: "FINISHED"
};

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function normalizeInfo(v) {
  return v === "category" ? "category" : "none";
}

function normalizeImpostorCount(n, playerCount) {
  let c = Number(n) === 2 ? 2 : 1;
  if (playerCount < 6) c = 1;
  if (c >= playerCount) c = 1;
  return c;
}

/** How many full clue→discuss→vote cycles before imposters win by timeout. */
function normalizeClueRounds(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_CLUE_ROUNDS;
  return clamp(Math.round(v), MIN_CLUE_ROUNDS, MAX_CLUE_ROUNDS);
}

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function createGame(opts) {
  const players = Array.isArray(opts.players) ? opts.players : [];
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    const err = new Error("invalid_player_count");
    err.code = "invalid_player_count";
    throw err;
  }
  const discussionSec = clamp(Number(opts.discussionSec) || 60, 30, 180);
  const voteSec = clamp(Number(opts.voteSec) || 45, 20, 120);
  const clueSec = clamp(Number(opts.clueSec) || DEFAULT_CLUE_SEC, 15, 120);
  const maxRounds = normalizeClueRounds(
    opts.maxRounds != null ? opts.maxRounds : opts.clueRounds
  );
  const impostorInfo = normalizeInfo(opts.impostorInfo);
  const impostorCount = normalizeImpostorCount(opts.impostorCount, players.length);
  const wordCategory = normalizeCategory(opts.wordCategory);
  const picked = pickWord(opts.rng, wordCategory);
  const order = players.map((p) => String(p.id));
  const names = {};
  for (const p of players) names[String(p.id)] = String(p.name || "Player");

  const deck = [];
  for (let i = 0; i < impostorCount; i++) deck.push("imposter");
  while (deck.length < order.length) deck.push("villager");
  const shuffled = shuffle(deck, opts.rng);
  const cards = shuffled.map((role, i) => ({
    id: i,
    role,
    takenBy: null
  }));

  return {
    status: "playing",
    phase: PHASE.CARD_PICK,
    round: 1,
    maxRounds,
    word: picked.word,
    category: picked.category,
    wordCategory,
    impostorInfo,
    impostorCount,
    discussionSec,
    voteSec,
    clueSec,
    order,
    names,
    roles: {},
    cards,
    alive: order.slice(),
    cluePass: 1,
    clueIndex: 0,
    clues: [],
    votes: {},
    voteTallies: null,
    eliminated: [],
    confirmed: {},
    phaseEndsAt: Date.now() + CARD_PICK_MS,
    winner: null,
    winReason: "",
    guessPlayerId: null,
    lastGuess: "",
    lastGuessName: "",
    lastVoteTarget: null
  };
}

function nextPicker(state) {
  if (!state) return null;
  return state.order.find((id) => !state.roles[id]) || null;
}

function beginRoleReveal(state) {
  state.confirmed = {};
  return setPhase(state, PHASE.ROLE_REVEAL, ROLE_REVEAL_MS);
}

function privateView(state, playerId) {
  if (!state || !playerId) return null;
  const id = String(playerId);
  if (!state.order.includes(id)) return null;
  if (!state.roles[id]) {
    return {
      role: null,
      word: null,
      category: null,
      confirmed: false,
      pendingPick: state.phase === PHASE.CARD_PICK
    };
  }
  const role = state.roles[id];
  const isImp = role === "imposter";
  const out = {
    role,
    word: null,
    category: null,
    confirmed: !!state.confirmed[id],
    pendingPick: false
  };
  if (!isImp) {
    out.word = state.word;
    out.category = state.category;
  } else if (state.impostorInfo === "category") {
    out.category = state.category;
  }
  return out;
}

function publicState(state, viewerId) {
  if (!state) return null;
  const now = Date.now();
  const phaseLeft = state.phaseEndsAt ? Math.max(0, state.phaseEndsAt - now) : 0;
  const aliveSet = new Set(state.alive);
  const clueTurnId =
    state.phase === PHASE.CLUE_TURN && state.alive.length
      ? state.order.filter((id) => aliveSet.has(id))[state.clueIndex] || null
      : null;
  const voted = Object.keys(state.votes || {});
  const pickTurnId = state.phase === PHASE.CARD_PICK ? nextPicker(state) : null;
  const out = {
    phase: state.phase,
    status: state.status,
    round: state.round,
    cluePass: state.cluePass || 1,
    maxRounds: state.maxRounds,
    order: state.order.slice(),
    alive: state.alive.slice(),
    names: Object.assign({}, state.names),
    clueIndex: state.clueIndex,
    clueTurnId,
    pickTurnId,
    cards: (state.cards || []).map((c) => ({
      id: c.id,
      taken: !!c.takenBy,
      takenBy: c.takenBy || null,
      takenByName: c.takenBy ? state.names[c.takenBy] || null : null
    })),
    clues: (state.clues || []).map((c) => ({
      playerId: c.playerId,
      name: c.name,
      text: c.text,
      pass: c.pass || 1
    })),
    discussionSec: state.discussionSec,
    voteSec: state.voteSec,
    clueSec: state.clueSec,
    phaseEndsAt: state.phaseEndsAt || 0,
    phaseLeft,
    impostorInfo: state.impostorInfo,
    impostorCount: state.impostorCount,
    votedIds: voted,
    voteTallies: state.voteTallies,
    eliminated: (state.eliminated || []).map((e) => ({
      playerId: e.playerId,
      name: e.name,
      wasImposter: !!e.wasImposter
    })),
    winner: state.winner,
    winReason: state.winReason || "",
    guessPlayerId: state.guessPlayerId,
    lastVoteTarget: state.lastVoteTarget,
    yourTurn:
      state.phase === PHASE.CARD_PICK
        ? !!(viewerId && pickTurnId && String(viewerId) === String(pickTurnId))
        : !!(viewerId && clueTurnId && String(viewerId) === String(clueTurnId)),
    canPickCard:
      state.phase === PHASE.CARD_PICK &&
      !!viewerId &&
      pickTurnId &&
      String(viewerId) === String(pickTurnId),
    canVote:
      state.phase === PHASE.VOTING &&
      !!viewerId &&
      aliveSet.has(String(viewerId)) &&
      !Object.prototype.hasOwnProperty.call(state.votes, String(viewerId)),
    canGuess:
      state.phase === PHASE.GUESS &&
      !!viewerId &&
      String(viewerId) === String(state.guessPlayerId),
    confirmedCount: Object.keys(state.confirmed || {}).length,
    playerCount: state.order.length
  };
  if (state.phase === PHASE.FINISHED) {
    out.word = state.word;
    out.category = state.category;
    out.roles = Object.assign({}, state.roles);
  }
  return out;
}

function setPhase(state, phase, durationMs) {
  state.phase = phase;
  state.phaseEndsAt = durationMs > 0 ? Date.now() + durationMs : 0;
  return state;
}

function aliveInOrder(state) {
  const set = new Set(state.alive);
  return state.order.filter((id) => set.has(id));
}

function countAliveRoles(state) {
  let imposters = 0;
  let villagers = 0;
  for (const id of state.alive) {
    if (state.roles[id] === "imposter") imposters += 1;
    else villagers += 1;
  }
  return { imposters, villagers };
}

function finish(state, winner, reason) {
  state.status = "finished";
  state.winner = winner;
  state.winReason = reason || "";
  state.guessPlayerId = null;
  return setPhase(state, PHASE.FINISHED, 0);
}

function checkAutoWin(state) {
  const { imposters, villagers } = countAliveRoles(state);
  if (imposters <= 0) return finish(state, "villagers", "จับ Imposter ได้ครบ");
  if (imposters >= villagers) return finish(state, "imposters", "Imposter กลืนทีมได้");
  return state;
}

function clueTurnMs(state) {
  const sec = clamp(Number(state && state.clueSec) || DEFAULT_CLUE_SEC, 15, 120);
  return sec * 1000;
}

function beginClueTurn(state) {
  state.clues = [];
  state.cluePass = 1;
  state.clueIndex = 0;
  state.votes = {};
  state.voteTallies = null;
  state.lastVoteTarget = null;
  return setPhase(state, PHASE.CLUE_TURN, clueTurnMs(state));
}

/** After one player clues: next seat, next pass around the table, or discussion. */
function nextClueSeat(state) {
  const turnOrder = aliveInOrder(state);
  state.clueIndex += 1;
  if (state.clueIndex < turnOrder.length) {
    return setPhase(state, PHASE.CLUE_TURN, clueTurnMs(state));
  }
  const pass = Number(state.cluePass) || 1;
  const max = normalizeClueRounds(state.maxRounds);
  if (pass < max) {
    state.cluePass = pass + 1;
    state.clueIndex = 0;
    return setPhase(state, PHASE.CLUE_TURN, clueTurnMs(state));
  }
  return beginDiscussion(state);
}

function beginDiscussion(state) {
  state.votes = {};
  state.voteTallies = null;
  return setPhase(state, PHASE.DISCUSSION, state.discussionSec * 1000);
}

function beginVoting(state) {
  state.votes = {};
  state.voteTallies = null;
  return setPhase(state, PHASE.VOTING, state.voteSec * 1000);
}

function pickCard(state, playerId, cardId) {
  if (state.phase !== PHASE.CARD_PICK) return { ok: false, error: "wrong_phase" };
  const id = String(playerId);
  const picker = nextPicker(state);
  if (!picker || picker !== id) return { ok: false, error: "not_your_turn" };
  if (state.roles[id]) return { ok: false, error: "already_picked" };
  const cid = Number(cardId);
  const card = (state.cards || []).find((c) => c.id === cid);
  if (!card) return { ok: false, error: "bad_card" };
  if (card.takenBy) return { ok: false, error: "taken" };
  card.takenBy = id;
  state.roles[id] = card.role === "imposter" ? "imposter" : "villager";
  if (nextPicker(state)) {
    setPhase(state, PHASE.CARD_PICK, CARD_PICK_MS);
  } else {
    beginRoleReveal(state);
  }
  return { ok: true, state, role: state.roles[id] };
}

function autoPickCard(state, playerId) {
  if (state.phase !== PHASE.CARD_PICK) return { ok: false, error: "wrong_phase" };
  const free = (state.cards || []).filter((c) => !c.takenBy);
  if (!free.length) return { ok: false, error: "no_cards" };
  const card = free[Math.floor(Math.random() * free.length)];
  return pickCard(state, playerId, card.id);
}

function confirmReveal(state, playerId) {
  if (state.phase !== PHASE.ROLE_REVEAL) return { ok: false, error: "wrong_phase" };
  const id = String(playerId);
  if (!state.roles[id]) return { ok: false, error: "not_player" };
  state.confirmed[id] = true;
  const all = state.order.every((pid) => state.confirmed[pid]);
  if (all) beginClueTurn(state);
  return { ok: true, state };
}

function submitClue(state, playerId, text) {
  if (state.phase !== PHASE.CLUE_TURN) return { ok: false, error: "wrong_phase" };
  const id = String(playerId);
  const turnOrder = aliveInOrder(state);
  const current = turnOrder[state.clueIndex];
  if (!current || current !== id) return { ok: false, error: "not_your_turn" };
  const clue = Array.from(String(text || "").trim().replace(/\s+/g, " "))
    .slice(0, CLUE_MAX_LEN)
    .join("");
  if (!clue) return { ok: false, error: "empty" };
  const lower = clue.toLowerCase();
  if (lower === String(state.word).toLowerCase()) {
    return { ok: false, error: "secret_word" };
  }
  state.clues.push({
    playerId: id,
    name: state.names[id] || "Player",
    text: clue,
    pass: state.cluePass || 1
  });
  nextClueSeat(state);
  return { ok: true, state };
}

function skipClue(state, playerId) {
  if (state.phase !== PHASE.CLUE_TURN) return { ok: false, error: "wrong_phase" };
  const id = String(playerId);
  const turnOrder = aliveInOrder(state);
  const current = turnOrder[state.clueIndex];
  if (!current || current !== id) return { ok: false, error: "not_your_turn" };
  state.clues.push({
    playerId: id,
    name: state.names[id] || "Player",
    text: "—",
    pass: state.cluePass || 1
  });
  nextClueSeat(state);
  return { ok: true, state };
}

function submitVote(state, voterId, targetId) {
  if (state.phase !== PHASE.VOTING) return { ok: false, error: "wrong_phase" };
  const vid = String(voterId);
  const tid = targetId == null || targetId === "" ? null : String(targetId);
  if (!state.alive.includes(vid)) return { ok: false, error: "not_alive" };
  if (Object.prototype.hasOwnProperty.call(state.votes, vid)) {
    return { ok: false, error: "already_voted" };
  }
  if (tid != null) {
    if (tid === vid) return { ok: false, error: "self_vote" };
    if (!state.alive.includes(tid)) return { ok: false, error: "bad_target" };
  }
  state.votes[vid] = tid;
  const alive = state.alive;
  if (alive.every((id) => Object.prototype.hasOwnProperty.call(state.votes, id))) {
    resolveVotes(state);
  }
  return { ok: true, state };
}

function resolveVotes(state) {
  const counts = {};
  for (const id of state.alive) counts[id] = 0;
  let abstain = 0;
  for (const id of state.alive) {
    const t = state.votes[id];
    if (t == null) abstain += 1;
    else if (counts[t] != null) counts[t] += 1;
  }
  const tallies = Object.keys(counts)
    .map((playerId) => ({
      playerId,
      name: state.names[playerId] || "Player",
      count: counts[playerId]
    }))
    .sort((a, b) => b.count - a.count);
  state.voteTallies = { entries: tallies, abstain };

  const top = tallies[0];
  const tied = top && tallies.filter((t) => t.count === top.count && top.count > 0).length > 1;
  if (!top || top.count <= 0 || tied) {
    state.lastVoteTarget = null;
    setPhase(state, PHASE.VOTE_RESULT, 5000);
    return state;
  }
  state.lastVoteTarget = top.playerId;
  setPhase(state, PHASE.VOTE_RESULT, 5000);
  return state;
}

function applyElimination(state) {
  const target = state.lastVoteTarget;
  if (!target) {
    return finish(state, "imposters", "โหวตเสมอ — จับ Imposter ไม่ได้");
  }
  const wasImposter = state.roles[target] === "imposter";
  state.alive = state.alive.filter((id) => id !== target);
  state.eliminated.push({
    playerId: target,
    name: state.names[target] || "Player",
    wasImposter
  });

  if (wasImposter) {
    const still = state.alive.some((id) => state.roles[id] === "imposter");
    if (!still) {
      state.guessPlayerId = target;
      return setPhase(state, PHASE.GUESS, 30_000);
    }
    const checked = checkAutoWin(state);
    if (checked.phase === PHASE.FINISHED) return checked;
    state.round += 1;
    return beginClueTurn(state);
  }
  const checked = checkAutoWin(state);
  if (checked.phase === PHASE.FINISHED) return checked;
  return finish(state, "imposters", "โหวตคนผิด");
}

function submitGuess(state, playerId, guess) {
  if (state.phase !== PHASE.GUESS) return { ok: false, error: "wrong_phase" };
  if (String(playerId) !== String(state.guessPlayerId)) {
    return { ok: false, error: "not_guesser" };
  }
  const g = String(guess || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!g) return { ok: false, error: "empty" };
  state.lastGuess = g;
  state.lastGuessName = state.names[String(playerId)] || "Imposter";
  if (g.toLowerCase() === String(state.word).toLowerCase()) {
    finish(state, "imposters", "Imposter ทายคำถูก");
  } else {
    finish(state, "villagers", "Imposter ทายคำผิด");
  }
  return { ok: true, state };
}

function tick(state, now = Date.now()) {
  if (!state || state.status !== "playing") return state;
  if (!state.phaseEndsAt || state.phaseEndsAt <= 0) return state;
  if (now < state.phaseEndsAt) return state;

  if (state.phase === PHASE.CARD_PICK) {
    const picker = nextPicker(state);
    if (picker) autoPickCard(state, picker);
    return state;
  }
  if (state.phase === PHASE.ROLE_REVEAL) {
    return beginClueTurn(state);
  }
  if (state.phase === PHASE.DISCUSSION) {
    return beginVoting(state);
  }
  if (state.phase === PHASE.VOTING) {
    // auto-abstain remaining
    for (const id of state.alive) {
      if (!Object.prototype.hasOwnProperty.call(state.votes, id)) state.votes[id] = null;
    }
    return resolveVotes(state);
  }
  if (state.phase === PHASE.VOTE_RESULT) {
    return applyElimination(state);
  }
  if (state.phase === PHASE.GUESS) {
    return finish(state, "villagers", "Imposter ไม่ทายคำทัน");
  }
  if (state.phase === PHASE.CLUE_TURN) {
    // AFK on current clue seat
    const turnOrder = aliveInOrder(state);
    const current = turnOrder[state.clueIndex];
    if (current) skipClue(state, current);
    return state;
  }
  return state;
}

module.exports = {
  MIN_PLAYERS,
  MAX_PLAYERS,
  DEFAULT_CLUE_ROUNDS,
  MIN_CLUE_ROUNDS,
  MAX_CLUE_ROUNDS,
  PHASE,
  CLUE_MAX_LEN,
  createGame,
  privateView,
  publicState,
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
  beginDiscussion,
  beginVoting,
  beginClueTurn,
  beginRoleReveal,
  applyElimination,
  resolveVotes,
  finish,
  checkAutoWin
};
