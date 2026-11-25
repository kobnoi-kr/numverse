"use strict";

const {
  MIN_PLAYERS,
  MAX_PLAYERS,
  PHASE,
  createGame,
  publicState,
  privateView,
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
  listRoles,
  roleMeta
} = require("./index");

function isWerewolfCat(cat) {
  return cat === "werewolf";
}

function isWerewolfRoom(room) {
  return !!(room && isWerewolfCat(room.cat));
}

function roomCap(room, defaultCap) {
  if (isWerewolfRoom(room)) return MAX_PLAYERS;
  return Number(defaultCap) || 12;
}

function normalizeCat(cat) {
  return cat === "werewolf" ? "werewolf" : null;
}

function applyLobbyDefaults(room) {
  if (!room) return;
  room.wwNightSec = normalizeNightSec(room.wwNightSec);
  room.wwDiscussionSec = normalizeDiscussionSec(room.wwDiscussionSec);
  room.wwVoteSec = normalizeVoteSec(room.wwVoteSec);
  room.wwTieRule = normalizeTie(room.wwTieRule);
  room.wwAllowSelfProtect = room.wwAllowSelfProtect !== false;
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

function autoPlayBots(room) {
  const state = room && room.werewolf;
  if (!state) return false;
  let changed = false;
  let guard = 32;
  while (guard-- > 0) {
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
    if (state.phase === PHASE.NIGHT) {
      let did = false;
      for (const p of room.players || []) {
        if (!p || !p.bot) continue;
        const id = String(p.id);
        if (!state.alive.includes(id) || state.nightActions[id]) continue;
        const role = state.roles[id];
        const aliveOthers = state.alive.filter((x) => x !== id);
        if (role === "werewolf") {
          const prey = aliveOthers.filter((x) => state.roles[x] !== "werewolf");
          const target = prey[Math.floor(Math.random() * prey.length)] || aliveOthers[0];
          if (target) {
            submitNightAction(state, id, { type: "attack", targetId: target });
            did = true;
            changed = true;
          }
        } else if (role === "seer") {
          const target = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
          if (target) {
            submitNightAction(state, id, { type: "inspect", targetId: target });
            did = true;
            changed = true;
          }
        } else if (role === "guardian") {
          const pool = state.allowSelfProtect ? state.alive.slice() : aliveOthers.slice();
          const filtered = pool.filter((x) => x !== state.lastProtected);
          const target = (filtered.length ? filtered : pool)[Math.floor(Math.random() * (filtered.length || pool.length))];
          if (target) {
            submitNightAction(state, id, { type: "protect", targetId: target });
            did = true;
            changed = true;
          }
        } else if (role === "witch") {
          submitNightAction(state, id, { type: "pass" });
          did = true;
          changed = true;
        }
      }
      if (!did) break;
      if (nightActorsDone(state)) {
        resolveNight(state);
        changed = true;
      }
      continue;
    }
    if (state.phase === PHASE.VOTING) {
      let did = false;
      for (const p of room.players || []) {
        if (!p || !p.bot) continue;
        const id = String(p.id);
        if (!state.alive.includes(id)) continue;
        if (Object.prototype.hasOwnProperty.call(state.votes, id)) continue;
        const targets = state.alive.filter((x) => x !== id);
        const target = targets[Math.floor(Math.random() * targets.length)] || null;
        submitVote(state, id, target);
        did = true;
        changed = true;
      }
      if (!did) break;
      continue;
    }
    if (state.phase === PHASE.HUNTER_SHOT && state.hunterShooterId && isBotPlayer(room, state.hunterShooterId)) {
      const targets = state.alive.slice();
      const target = targets[Math.floor(Math.random() * targets.length)] || null;
      hunterShot(state, state.hunterShooterId, target);
      changed = true;
      continue;
    }
    break;
  }
  return changed;
}

function startWerewolf(room) {
  applyLobbyDefaults(room);
  const ordered = orderedPlayers(room);
  if (ordered.length < MIN_PLAYERS || ordered.length > MAX_PLAYERS) {
    const err = new Error("invalid_player_count");
    err.code = "invalid_player_count";
    throw err;
  }
  const state = createGame({
    players: ordered.map((p) => ({ id: String(p.id), name: String(p.name) })),
    nightSec: room.wwNightSec,
    discussionSec: room.wwDiscussionSec,
    voteSec: room.wwVoteSec,
    tieRule: room.wwTieRule,
    allowSelfProtect: room.wwAllowSelfProtect
  });
  room.werewolf = state;
  room.phase = "werewolf";
  room.over = null;
  room.startedAt = room.startedAt || Date.now();
  room._persisted = false;
  autoPlayBots(room);
  return state;
}

function clearWerewolf(room) {
  if (room) room.werewolf = null;
}

function snapWerewolf(room, player) {
  if (!room || !room.werewolf) return null;
  return publicState(room.werewolf, player && player.id);
}

function privateWerewolf(room, player) {
  if (!room || !room.werewolf || !player) return null;
  return privateView(room.werewolf, player.id);
}

function chatAllowed(room, player) {
  if (!room || !room.werewolf || !player) return true;
  const st = room.werewolf;
  if (st.phase === PHASE.FINISHED) return true;
  // Dead players cannot chat to the living during the match.
  if (!st.alive.includes(String(player.id))) return false;
  return true;
}

function tickWerewolf(room) {
  if (!room || !room.werewolf) return false;
  const before = room.werewolf.phase;
  const beforeEnds = room.werewolf.phaseEndsAt;
  tick(room.werewolf);
  autoPlayBots(room);
  return room.werewolf.phase !== before || room.werewolf.phaseEndsAt !== beforeEnds;
}

function finishIfDone(room, setOver) {
  if (!room || !room.werewolf || room.werewolf.phase !== PHASE.FINISHED) return false;
  const st = room.werewolf;
  const villageWin = st.winner === "village";
  const title = villageWin ? "ฝ่ายหมู่บ้านชนะ!" : "ฝ่ายหมาป่าชนะ!";
  const wolves = st.order
    .filter((id) => roleMeta(st.roles[id]) && roleMeta(st.roles[id]).team === "werewolf")
    .map((id) => st.names[id] || id);
  if (typeof setOver === "function") {
    setOver(room, {
      title,
      note: st.winReason || "",
      mode: "werewolf",
      secretLabel: "หมาป่าคือ",
      secretText: wolves.join(", "),
      many: false,
      hist: null,
      again: "เล่นอีกครั้ง",
      reset: true,
      winners: villageWin
        ? st.order
            .filter((id) => roleMeta(st.roles[id]) && roleMeta(st.roles[id]).team === "village")
            .map((id) => st.names[id])
        : wolves,
      werewolves: wolves,
      roles: Object.assign({}, st.roles)
    });
  }
  return true;
}

module.exports = {
  MIN_PLAYERS,
  MAX_PLAYERS,
  PHASE,
  isWerewolfCat,
  isWerewolfRoom,
  roomCap,
  normalizeCat,
  applyLobbyDefaults,
  startWerewolf,
  clearWerewolf,
  snapWerewolf,
  privateWerewolf,
  chatAllowed,
  tickWerewolf,
  finishIfDone,
  autoPlayBots,
  confirmReveal,
  submitNightAction,
  submitVote,
  hunterShot,
  nightActorsDone,
  resolveNight,
  normalizeNightSec,
  normalizeDiscussionSec,
  normalizeVoteSec,
  normalizeTie,
  listRoles,
  roleMeta
};
