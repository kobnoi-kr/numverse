"use strict";

const assert = require("assert");
const eng = require("../src/engine/game-engine");

function players(n) {
  return Array.from({ length: n }, (_, i) => ({ id: "u" + (i + 1), name: "P" + (i + 1) }));
}

function run() {
  const state = eng.createGame({
    players: players(6),
    nightSec: 20,
    discussionSec: 30,
    voteSec: 20,
    rng: () => 0.2
  });
  assert.strictEqual(state.phase, eng.PHASE.ROLE_REVEAL);
  assert.strictEqual(state.order.length, 6);
  assert.strictEqual(Object.keys(state.roles).length, 6);

  const wolfId = state.order.find((id) => state.roles[id] === "werewolf");
  const seerId = state.order.find((id) => state.roles[id] === "seer");
  const guardId = state.order.find((id) => state.roles[id] === "guardian");
  const witchId = state.order.find((id) => state.roles[id] === "witch");
  assert.ok(wolfId && seerId && guardId && witchId);

  const privW = eng.privateView(state, wolfId);
  assert.strictEqual(privW.role, "werewolf");
  assert.ok(privW.image.includes("werewolf.png"));

  for (const id of state.order) eng.confirmReveal(state, id);
  assert.strictEqual(state.phase, eng.PHASE.NIGHT);

  const prey = state.alive.find((id) => id !== wolfId && state.roles[id] !== "werewolf");
  eng.submitNightAction(state, wolfId, { type: "attack", targetId: prey });
  eng.submitNightAction(state, guardId, { type: "protect", targetId: prey });
  eng.submitNightAction(state, seerId, { type: "inspect", targetId: wolfId });
  eng.submitNightAction(state, witchId, { type: "pass" });
  assert.ok(eng.nightActorsDone(state));
  eng.resolveNight(state);
  assert.strictEqual(state.phase, eng.PHASE.MORNING);
  assert.ok(state.morning.protected || state.morning.died.length === 0);
  assert.ok(state.alive.includes(prey));

  const inspect = eng.privateView(state, seerId).inspectResult;
  assert.ok(inspect);
  assert.strictEqual(inspect.isWerewolf, true);

  eng.tick(state, state.phaseEndsAt + 1);
  assert.strictEqual(state.phase, eng.PHASE.DISCUSSION);
  eng.tick(state, state.phaseEndsAt + 1);
  assert.strictEqual(state.phase, eng.PHASE.VOTING);

  for (const id of state.alive) {
    if (id === wolfId) eng.submitVote(state, id, prey);
    else eng.submitVote(state, id, wolfId);
  }
  assert.strictEqual(state.phase, eng.PHASE.EXECUTION);
  assert.strictEqual(state.lastVoteTarget, wolfId);
  eng.tick(state, state.phaseEndsAt + 1);
  assert.strictEqual(state.phase, eng.PHASE.FINISHED);
  assert.strictEqual(state.winner, "village");

  console.log("werewolf engine ok");
}

run();
