"use strict";

const assert = require("assert");
const eng = require("../src/engine/game-engine");

function players(n) {
  return Array.from({ length: n }, (_, i) => ({ id: "u" + (i + 1), name: "P" + (i + 1) }));
}

function run() {
  const state = eng.createGame({
    players: players(4),
    impostorInfo: "category",
    impostorCount: 1,
    discussionSec: 60,
    voteSec: 45,
    clueSec: 30,
    clueRounds: 1,
    rng: () => 0.1
  });
  assert.strictEqual(state.phase, eng.PHASE.CARD_PICK);
  assert.strictEqual(state.clueSec, 30);
  assert.strictEqual(state.maxRounds, 1);
  assert.strictEqual(state.order.length, 4);
  assert.strictEqual(state.cards.length, 4);
  assert.strictEqual(state.cards.filter((c) => c.role === "imposter").length, 1);
  assert.deepStrictEqual(state.roles, {});

  const pub0 = eng.publicState(state, state.order[0]);
  assert.ok(pub0.canPickCard);
  assert.ok(!pub0.cards.some((c) => c.role));

  for (let i = 0; i < state.order.length; i++) {
    const free = state.cards.find((c) => !c.takenBy);
    const r = eng.pickCard(state, state.order[i], free.id);
    assert.ok(r.ok, r.error);
  }
  assert.strictEqual(state.phase, eng.PHASE.ROLE_REVEAL);
  const imposters = state.order.filter((id) => state.roles[id] === "imposter");
  assert.strictEqual(imposters.length, 1);

  const privV = eng.privateView(state, state.order.find((id) => state.roles[id] === "villager"));
  assert.ok(privV.word);
  assert.strictEqual(privV.role, "villager");
  const privI = eng.privateView(state, imposters[0]);
  assert.strictEqual(privI.role, "imposter");
  assert.strictEqual(privI.word, null);
  assert.ok(privI.category);

  const pub = eng.publicState(state, state.order[0]);
  assert.ok(!pub.word);
  assert.ok(!pub.roles);

  for (const id of state.order) eng.confirmReveal(state, id);
  assert.strictEqual(state.phase, eng.PHASE.CLUE_TURN);

  const turnOrder = state.order.filter((id) => state.alive.includes(id));
  for (let i = 0; i < turnOrder.length; i++) {
    const r = eng.submitClue(state, turnOrder[i], "ใบ้" + (i + 1));
    assert.ok(r.ok, r.error);
  }
  assert.strictEqual(state.phase, eng.PHASE.DISCUSSION);

  eng.tick(state, state.phaseEndsAt + 1);
  assert.strictEqual(state.phase, eng.PHASE.VOTING);

  const target = imposters[0];
  for (const id of state.alive) {
    if (id === target) eng.submitVote(state, id, null);
    else eng.submitVote(state, id, target);
  }
  assert.strictEqual(state.phase, eng.PHASE.VOTE_RESULT);
  assert.strictEqual(state.lastVoteTarget, target);

  eng.tick(state, state.phaseEndsAt + 1);
  assert.strictEqual(state.phase, eng.PHASE.GUESS);

  const bad = eng.submitGuess(state, target, "คำผิดๆ");
  assert.ok(bad.ok);
  assert.strictEqual(state.phase, eng.PHASE.FINISHED);
  assert.strictEqual(state.winner, "villagers");
  assert.strictEqual(state.lastGuess, "คำผิดๆ");

  const finishedPub = eng.publicState(state, state.order[0]);
  assert.ok(finishedPub.word);
  assert.ok(finishedPub.roles);

  const s2 = eng.createGame({
    players: players(6),
    impostorCount: 2,
    rng: () => 0.2
  });
  assert.strictEqual(s2.cards.filter((c) => c.role === "imposter").length, 2);
  assert.strictEqual(s2.maxRounds, 5);

  const s3 = eng.createGame({
    players: players(5),
    impostorCount: 2,
    rng: () => 0.3
  });
  assert.strictEqual(s3.cards.filter((c) => c.role === "imposter").length, 1);

  const s4 = eng.createGame({
    players: players(4),
    clueRounds: 2,
    rng: () => 0.4
  });
  assert.strictEqual(s4.maxRounds, 2);
  for (const id of s4.order) {
    const free = s4.cards.find((c) => !c.takenBy);
    eng.pickCard(s4, id, free.id);
  }
  for (const id of s4.order) eng.confirmReveal(s4, id);
  assert.strictEqual(s4.phase, eng.PHASE.CLUE_TURN);
  assert.strictEqual(s4.cluePass, 1);
  const lap = s4.order.slice();
  for (const id of lap) {
    assert.ok(eng.submitClue(s4, id, "รอบ1").ok);
  }
  assert.strictEqual(s4.phase, eng.PHASE.CLUE_TURN);
  assert.strictEqual(s4.cluePass, 2);
  assert.strictEqual(s4.clueIndex, 0);
  assert.strictEqual(s4.clues.length, 4);
  for (const id of lap) {
    assert.ok(eng.submitClue(s4, id, "รอบ2").ok);
  }
  assert.strictEqual(s4.phase, eng.PHASE.DISCUSSION);
  assert.strictEqual(s4.clues.length, 8);
  assert.strictEqual(eng.publicState(s4, lap[0]).clues[4].pass, 2);

  assert.strictEqual(eng.normalizeClueRounds(20), 20);
  assert.strictEqual(eng.normalizeClueRounds(999), 99);
  assert.strictEqual(eng.normalizeClueRounds(0), 1);

  console.log("imposter engine ok");
}

run();
