"use strict";

const { deckForCount, roleMeta, listRoles } = require("../config/roles");

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 8;
const ROLE_REVEAL_MS = 25_000;
const DEFAULT_NIGHT_SEC = 30;
const DEFAULT_DISCUSSION_SEC = 60;
const DEFAULT_VOTE_SEC = 45;
const MORNING_MS = 6_000;
const EXECUTION_MS = 5_000;
const HUNTER_SHOT_MS = 20_000;

const PHASE = {
  ROLE_REVEAL: "ROLE_REVEAL",
  NIGHT: "NIGHT",
  MORNING: "MORNING",
  DISCUSSION: "DISCUSSION",
  VOTING: "VOTING",
  EXECUTION: "EXECUTION",
  HUNTER_SHOT: "HUNTER_SHOT",
  FINISHED: "FINISHED"
};

const TIE = {
  NONE: "none",
  RANDOM: "random"
};

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, Number(n) || 0));
}

function normalizeNightSec(n) {
  return clamp(n == null ? DEFAULT_NIGHT_SEC : n, 15, 90);
}

function normalizeDiscussionSec(n) {
  return clamp(n == null ? DEFAULT_DISCUSSION_SEC : n, 20, 180);
}

function normalizeVoteSec(n) {
  return clamp(n == null ? DEFAULT_VOTE_SEC : n, 15, 120);
}

function normalizeTie(v) {
  return v === TIE.RANDOM ? TIE.RANDOM : TIE.NONE;
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

function setPhase(state, phase, durationMs) {
  state.phase = phase;
  state.phaseEndsAt = durationMs > 0 ? Date.now() + durationMs : 0;
  return state;
}

function createGame(opts) {
  const players = Array.isArray(opts.players) ? opts.players : [];
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    const err = new Error("invalid_player_count");
    err.code = "invalid_player_count";
    throw err;
  }
  const deck = deckForCount(players.length);
  if (!deck) {
    const err = new Error("invalid_player_count");
    err.code = "invalid_player_count";
    throw err;
  }
  const order = players.map((p) => String(p.id));
  const names = {};
  for (const p of players) names[String(p.id)] = String(p.name || "Player");
  const rolesList = shuffle(deck, opts.rng);
  const roles = {};
  order.forEach((id, i) => {
    roles[id] = rolesList[i];
  });
  const nightSec = normalizeNightSec(opts.nightSec);
  const discussionSec = normalizeDiscussionSec(opts.discussionSec);
  const voteSec = normalizeVoteSec(opts.voteSec);
  const tieRule = normalizeTie(opts.tieRule);
  const allowSelfProtect = opts.allowSelfProtect !== false;

  return {
    status: "playing",
    phase: PHASE.ROLE_REVEAL,
    round: 1,
    order,
    names,
    roles,
    alive: order.slice(),
    confirmed: {},
    nightSec,
    discussionSec,
    voteSec,
    tieRule,
    allowSelfProtect,
    nightActions: {},
    lastProtected: null,
    witchHealLeft: 1,
    witchPoisonLeft: 1,
    morning: null,
    votes: {},
    voteTallies: null,
    lastVoteTarget: null,
    eliminated: [],
    log: [],
    hunterShooterId: null,
    winner: null,
    winReason: "",
    phaseEndsAt: Date.now() + ROLE_REVEAL_MS
  };
}

function teamOf(role) {
  const meta = roleMeta(role);
  return meta ? meta.team : "village";
}

function isAlive(state, id) {
  return !!(state && state.alive.includes(String(id)));
}

function countAliveTeams(state) {
  let werewolves = 0;
  let village = 0;
  for (const id of state.alive) {
    if (teamOf(state.roles[id]) === "werewolf") werewolves += 1;
    else village += 1;
  }
  return { werewolves, village };
}

function finish(state, winner, reason) {
  state.status = "finished";
  state.winner = winner;
  state.winReason = reason || "";
  state.hunterShooterId = null;
  return setPhase(state, PHASE.FINISHED, 0);
}

function checkWin(state) {
  const { werewolves, village } = countAliveTeams(state);
  if (werewolves <= 0) return finish(state, "village", "กำจัดหมาป่าได้ครบ");
  if (werewolves >= village) return finish(state, "werewolf", "หมาป่าครองหมู่บ้าน");
  return null;
}

function pushLog(state, text, kind) {
  state.log.push({
    round: state.round,
    kind: kind || "info",
    text: String(text || ""),
    at: Date.now()
  });
  if (state.log.length > 40) state.log = state.log.slice(-40);
}

function privateView(state, playerId) {
  if (!state || !playerId) return null;
  const id = String(playerId);
  if (!state.order.includes(id)) return null;
  const role = state.roles[id];
  const meta = roleMeta(role);
  const alive = isAlive(state, id);
  const out = {
    role,
    team: meta ? meta.team : null,
    nameTh: meta ? meta.nameTh : role,
    nameEn: meta ? meta.nameEn : role,
    color: meta ? meta.color : "#64748b",
    image: meta ? meta.image : "",
    blurb: meta ? meta.blurb : "",
    confirmed: !!state.confirmed[id],
    alive,
    witchHealLeft: role === "witch" ? state.witchHealLeft : null,
    witchPoisonLeft: role === "witch" ? state.witchPoisonLeft : null,
    peers: [],
    inspectResult: null,
    nightSubmitted: false
  };
  if (role === "werewolf") {
    out.peers = state.order.filter((pid) => state.roles[pid] === "werewolf" && pid !== id);
  }
  const night = state.nightActions[id];
  if (night) {
    out.nightSubmitted = true;
    if (night.inspectResult) out.inspectResult = night.inspectResult;
  }
  return out;
}

function publicState(state, viewerId) {
  if (!state) return null;
  const now = Date.now();
  const phaseLeft = state.phaseEndsAt ? Math.max(0, state.phaseEndsAt - now) : 0;
  const aliveSet = new Set(state.alive);
  const voted = Object.keys(state.votes || {});
  const out = {
    phase: state.phase,
    status: state.status,
    round: state.round,
    order: state.order.slice(),
    alive: state.alive.slice(),
    names: Object.assign({}, state.names),
    nightSec: state.nightSec,
    discussionSec: state.discussionSec,
    voteSec: state.voteSec,
    tieRule: state.tieRule,
    allowSelfProtect: !!state.allowSelfProtect,
    phaseEndsAt: state.phaseEndsAt || 0,
    phaseLeft,
    morning: state.morning,
    votedIds: voted,
    voteTallies: state.voteTallies,
    lastVoteTarget: state.lastVoteTarget,
    eliminated: (state.eliminated || []).map((e) => ({
      playerId: e.playerId,
      name: e.name,
      role: e.role,
      cause: e.cause
    })),
    log: (state.log || []).slice(-12),
    hunterShooterId: state.hunterShooterId,
    winner: state.winner,
    winReason: state.winReason || "",
    confirmedCount: Object.keys(state.confirmed || {}).length,
    playerCount: state.order.length,
    roleCatalog: listRoles(),
    canConfirm:
      state.phase === PHASE.ROLE_REVEAL &&
      !!viewerId &&
      state.order.includes(String(viewerId)) &&
      !state.confirmed[String(viewerId)],
    canNightAct:
      state.phase === PHASE.NIGHT &&
      !!viewerId &&
      aliveSet.has(String(viewerId)) &&
      !state.nightActions[String(viewerId)] &&
      ["werewolf", "seer", "witch", "guardian"].includes(state.roles[String(viewerId)]),
    canVote:
      state.phase === PHASE.VOTING &&
      !!viewerId &&
      aliveSet.has(String(viewerId)) &&
      !Object.prototype.hasOwnProperty.call(state.votes, String(viewerId)),
    canHunterShot:
      state.phase === PHASE.HUNTER_SHOT &&
      !!viewerId &&
      String(viewerId) === String(state.hunterShooterId)
  };
  if (state.phase === PHASE.FINISHED) {
    out.roles = Object.assign({}, state.roles);
  }
  return out;
}

function confirmReveal(state, playerId) {
  if (state.phase !== PHASE.ROLE_REVEAL) return { ok: false, error: "wrong_phase" };
  const id = String(playerId);
  if (!state.roles[id]) return { ok: false, error: "not_player" };
  state.confirmed[id] = true;
  if (state.order.every((pid) => state.confirmed[pid])) beginNight(state);
  return { ok: true, state };
}

function beginNight(state) {
  state.nightActions = {};
  state.morning = null;
  state.votes = {};
  state.voteTallies = null;
  state.lastVoteTarget = null;
  pushLog(state, "ค่ำคืนที่ " + state.round + " เริ่มแล้ว", "night");
  return setPhase(state, PHASE.NIGHT, state.nightSec * 1000);
}

function submitNightAction(state, playerId, action) {
  if (state.phase !== PHASE.NIGHT) return { ok: false, error: "wrong_phase" };
  const id = String(playerId);
  if (!isAlive(state, id)) return { ok: false, error: "not_alive" };
  if (state.nightActions[id]) return { ok: false, error: "already_acted" };
  const role = state.roles[id];
  const act = action && typeof action === "object" ? action : {};
  const type = String(act.type || "");
  const targetId = act.targetId == null || act.targetId === "" ? null : String(act.targetId);

  if (role === "werewolf") {
    if (type !== "attack") return { ok: false, error: "bad_action" };
    if (!targetId || !isAlive(state, targetId)) return { ok: false, error: "bad_target" };
    if (state.roles[targetId] === "werewolf") return { ok: false, error: "pack_mate" };
    state.nightActions[id] = { type: "attack", targetId };
    return { ok: true, state };
  }
  if (role === "seer") {
    if (type !== "inspect") return { ok: false, error: "bad_action" };
    if (!targetId || !isAlive(state, targetId) || targetId === id) return { ok: false, error: "bad_target" };
    const isWolf = teamOf(state.roles[targetId]) === "werewolf";
    state.nightActions[id] = {
      type: "inspect",
      targetId,
      inspectResult: {
        targetId,
        name: state.names[targetId] || "Player",
        isWerewolf: isWolf
      }
    };
    return { ok: true, state, inspectResult: state.nightActions[id].inspectResult };
  }
  if (role === "guardian") {
    if (type !== "protect") return { ok: false, error: "bad_action" };
    if (!targetId || !isAlive(state, targetId)) return { ok: false, error: "bad_target" };
    if (!state.allowSelfProtect && targetId === id) return { ok: false, error: "no_self" };
    if (state.lastProtected && targetId === state.lastProtected) {
      return { ok: false, error: "same_protect" };
    }
    state.nightActions[id] = { type: "protect", targetId };
    return { ok: true, state };
  }
  if (role === "witch") {
    if (type === "pass") {
      state.nightActions[id] = { type: "pass" };
      return { ok: true, state };
    }
    if (type === "heal") {
      if (state.witchHealLeft < 1) return { ok: false, error: "no_heal" };
      if (!targetId || !isAlive(state, targetId)) return { ok: false, error: "bad_target" };
      state.nightActions[id] = { type: "heal", targetId };
      return { ok: true, state };
    }
    if (type === "poison") {
      if (state.witchPoisonLeft < 1) return { ok: false, error: "no_poison" };
      if (!targetId || !isAlive(state, targetId) || targetId === id) {
        return { ok: false, error: "bad_target" };
      }
      state.nightActions[id] = { type: "poison", targetId };
      return { ok: true, state };
    }
    return { ok: false, error: "bad_action" };
  }
  return { ok: false, error: "no_night_action" };
}

function nightActorsDone(state) {
  for (const id of state.alive) {
    const role = state.roles[id];
    if (!["werewolf", "seer", "witch", "guardian"].includes(role)) continue;
    if (!state.nightActions[id]) return false;
  }
  return true;
}

function resolveNight(state) {
  const attacks = [];
  let protectId = null;
  let healId = null;
  let poisonId = null;
  let witchId = null;

  for (const id of state.alive) {
    const act = state.nightActions[id];
    if (!act) continue;
    const role = state.roles[id];
    if (role === "werewolf" && act.type === "attack") attacks.push(act.targetId);
    if (role === "guardian" && act.type === "protect") protectId = act.targetId;
    if (role === "witch") {
      witchId = id;
      if (act.type === "heal") healId = act.targetId;
      if (act.type === "poison") poisonId = act.targetId;
    }
  }

  // Majority wolf vote; single wolf = that target
  let attackTarget = null;
  if (attacks.length) {
    const counts = {};
    for (const t of attacks) counts[t] = (counts[t] || 0) + 1;
    const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
    attackTarget = ranked[0];
  }

  state.lastProtected = protectId || null;
  if (healId && witchId) state.witchHealLeft = Math.max(0, state.witchHealLeft - 1);
  if (poisonId && witchId) state.witchPoisonLeft = Math.max(0, state.witchPoisonLeft - 1);

  const deaths = new Set();
  if (attackTarget) {
    const blocked = protectId && protectId === attackTarget;
    const healed = healId && healId === attackTarget;
    if (!blocked && !healed) deaths.add(attackTarget);
  }
  if (poisonId) deaths.add(poisonId);

  const died = [];
  for (const id of deaths) {
    if (!isAlive(state, id)) continue;
    state.alive = state.alive.filter((x) => x !== id);
    const entry = {
      playerId: id,
      name: state.names[id] || "Player",
      role: state.roles[id],
      cause: poisonId === id && attackTarget !== id ? "poison" : "night"
    };
    state.eliminated.push(entry);
    died.push(entry);
  }

  state.morning = {
    died: died.map((d) => ({ playerId: d.playerId, name: d.name, cause: d.cause })),
    protected: !!(attackTarget && protectId === attackTarget),
    healed: !!(attackTarget && healId === attackTarget)
  };

  if (!died.length) pushLog(state, "เช้านี้ไม่มีผู้เสียชีวิต", "morning");
  else {
    for (const d of died) {
      pushLog(state, d.name + " จากไปในค่ำคืนนี้", "death");
    }
  }

  const win = checkWin(state);
  if (win) return win;

  const hunterDead = died.find((d) => d.role === "hunter");
  if (hunterDead) {
    state.hunterShooterId = hunterDead.playerId;
    pushLog(state, "นักล่าจะยิงครั้งสุดท้าย", "hunter");
    return setPhase(state, PHASE.HUNTER_SHOT, HUNTER_SHOT_MS);
  }
  return setPhase(state, PHASE.MORNING, MORNING_MS);
}

function beginDiscussion(state) {
  state.votes = {};
  state.voteTallies = null;
  pushLog(state, "เริ่มพูดคุย", "day");
  return setPhase(state, PHASE.DISCUSSION, state.discussionSec * 1000);
}

function beginVoting(state) {
  state.votes = {};
  state.voteTallies = null;
  pushLog(state, "เริ่มโหวต", "vote");
  return setPhase(state, PHASE.VOTING, state.voteSec * 1000);
}

function submitVote(state, voterId, targetId) {
  if (state.phase !== PHASE.VOTING) return { ok: false, error: "wrong_phase" };
  const vid = String(voterId);
  const tid = targetId == null || targetId === "" ? null : String(targetId);
  if (!isAlive(state, vid)) return { ok: false, error: "not_alive" };
  if (Object.prototype.hasOwnProperty.call(state.votes, vid)) {
    return { ok: false, error: "already_voted" };
  }
  if (tid != null) {
    if (tid === vid) return { ok: false, error: "self_vote" };
    if (!isAlive(state, tid)) return { ok: false, error: "bad_target" };
  }
  state.votes[vid] = tid;
  if (state.alive.every((id) => Object.prototype.hasOwnProperty.call(state.votes, id))) {
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
  const tied =
    top && top.count > 0 && tallies.filter((t) => t.count === top.count).length > 1;
  if (!top || top.count <= 0) {
    state.lastVoteTarget = null;
  } else if (tied) {
    if (state.tieRule === TIE.RANDOM) {
      const pool = tallies.filter((t) => t.count === top.count).map((t) => t.playerId);
      state.lastVoteTarget = pool[Math.floor(Math.random() * pool.length)] || null;
    } else {
      state.lastVoteTarget = null;
    }
  } else {
    state.lastVoteTarget = top.playerId;
  }
  return setPhase(state, PHASE.EXECUTION, EXECUTION_MS);
}

function applyExecution(state) {
  const target = state.lastVoteTarget;
  if (!target) {
    pushLog(state, "โหวตเสมอ — ไม่มีใครถูกกำจัด", "vote");
    state.round += 1;
    return beginNight(state);
  }
  if (!isAlive(state, target)) {
    state.round += 1;
    return beginNight(state);
  }
  state.alive = state.alive.filter((id) => id !== target);
  const role = state.roles[target];
  state.eliminated.push({
    playerId: target,
    name: state.names[target] || "Player",
    role,
    cause: "vote"
  });
  const roleName = (roleMeta(role) && roleMeta(role).nameTh) || role;
  pushLog(state, (state.names[target] || "Player") + " ถูกโหวตออก (" + roleName + ")", "vote");

  const win = checkWin(state);
  if (win) return win;

  if (role === "hunter") {
    state.hunterShooterId = target;
    pushLog(state, "นักล่าจะยิงครั้งสุดท้าย", "hunter");
    return setPhase(state, PHASE.HUNTER_SHOT, HUNTER_SHOT_MS);
  }
  state.round += 1;
  return beginNight(state);
}

function hunterShot(state, playerId, targetId) {
  if (state.phase !== PHASE.HUNTER_SHOT) return { ok: false, error: "wrong_phase" };
  if (String(playerId) !== String(state.hunterShooterId)) {
    return { ok: false, error: "not_hunter" };
  }
  const tid = targetId == null || targetId === "" ? null : String(targetId);
  if (tid) {
    if (!isAlive(state, tid)) return { ok: false, error: "bad_target" };
    state.alive = state.alive.filter((id) => id !== tid);
    state.eliminated.push({
      playerId: tid,
      name: state.names[tid] || "Player",
      role: state.roles[tid],
      cause: "hunter"
    });
    pushLog(state, "นักล่ายิง " + (state.names[tid] || "Player"), "hunter");
  } else {
    pushLog(state, "นักล่าไม่ยิงใคร", "hunter");
  }
  state.hunterShooterId = null;
  const win = checkWin(state);
  if (win) return { ok: true, state: win };
  state.round += 1;
  beginNight(state);
  return { ok: true, state };
}

function tick(state, now = Date.now()) {
  if (!state || state.status !== "playing") return state;
  if (!state.phaseEndsAt || state.phaseEndsAt <= 0) return state;
  if (now < state.phaseEndsAt) return state;

  if (state.phase === PHASE.ROLE_REVEAL) return beginNight(state);
  if (state.phase === PHASE.NIGHT) return resolveNight(state);
  if (state.phase === PHASE.MORNING) return beginDiscussion(state);
  if (state.phase === PHASE.DISCUSSION) return beginVoting(state);
  if (state.phase === PHASE.VOTING) {
    for (const id of state.alive) {
      if (!Object.prototype.hasOwnProperty.call(state.votes, id)) state.votes[id] = null;
    }
    return resolveVotes(state);
  }
  if (state.phase === PHASE.EXECUTION) return applyExecution(state);
  if (state.phase === PHASE.HUNTER_SHOT) {
    hunterShot(state, state.hunterShooterId, null);
    return state;
  }
  return state;
}

module.exports = {
  MIN_PLAYERS,
  MAX_PLAYERS,
  PHASE,
  TIE,
  ROLE_REVEAL_MS,
  DEFAULT_NIGHT_SEC,
  DEFAULT_DISCUSSION_SEC,
  DEFAULT_VOTE_SEC,
  createGame,
  privateView,
  publicState,
  confirmReveal,
  submitNightAction,
  nightActorsDone,
  resolveNight,
  submitVote,
  hunterShot,
  tick,
  normalizeNightSec,
  normalizeDiscussionSec,
  normalizeVoteSec,
  normalizeTie,
  beginNight,
  beginDiscussion,
  beginVoting,
  checkWin,
  listRoles,
  roleMeta,
  deckForCount
};
