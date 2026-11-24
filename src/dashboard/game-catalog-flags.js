"use strict";

/** Defaults when game_catalog has no comingSoon override for that id. */
const DEFAULT_COMING_SOON = {
  imposter: true,
  race2048: true,
  cardmemory: true,
  werewolf: true
};

const TEST_INVITES_KEY = "game_test_invites";

async function loadGameCatalogFlags(prisma) {
  if (!prisma) return {};
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: "game_catalog" } });
    if (row && row.value && typeof row.value === "object") return row.value;
  } catch {
    /* ignore */
  }
  return {};
}

function isComingSoonCat(flags, cat) {
  const id = String(cat || "");
  if (!id) return false;
  const override = flags && flags[id];
  if (override && Object.prototype.hasOwnProperty.call(override, "comingSoon")) {
    return !!override.comingSoon;
  }
  return !!DEFAULT_COMING_SOON[id];
}

function rolesAreElevated(roles) {
  const set = new Set((roles || []).map((r) => String(r).toLowerCase()));
  return set.has("admin") || set.has("super_admin") || set.has("moderator");
}

async function loadTestInvites(prisma) {
  if (!prisma) return {};
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: TEST_INVITES_KEY } });
    if (row && row.value && typeof row.value === "object" && !Array.isArray(row.value)) {
      return row.value;
    }
  } catch {
    /* ignore */
  }
  return {};
}

async function saveTestInvites(prisma, next) {
  await prisma.systemSetting.upsert({
    where: { key: TEST_INVITES_KEY },
    create: { key: TEST_INVITES_KEY, value: next },
    update: { value: next }
  });
}

function inviteListForGame(invites, gameId) {
  const raw = invites && invites[String(gameId || "")];
  return Array.isArray(raw) ? raw : [];
}

function userHasTestInvite(invites, gameId, userId) {
  const id = String(userId || "");
  if (!id) return false;
  return inviteListForGame(invites, gameId).some((row) => {
    if (typeof row === "string") return row === id;
    return row && String(row.userId) === id;
  });
}

/**
 * @returns {Promise<{ ok: true } | { ok: false, reason: "coming_soon" }>}
 */
async function assertCatPlayable(prisma, cat, { roles, isAdmin, userId } = {}) {
  const flags = await loadGameCatalogFlags(prisma);
  if (!isComingSoonCat(flags, cat)) return { ok: true };
  if (isAdmin || rolesAreElevated(roles)) return { ok: true };
  if (userId) {
    const invites = await loadTestInvites(prisma);
    if (userHasTestInvite(invites, cat, userId)) return { ok: true };
  }
  return { ok: false, reason: "coming_soon" };
}

async function listPlayableComingSoonIds(prisma, { roles, isAdmin, userId } = {}) {
  const flags = await loadGameCatalogFlags(prisma);
  const invites = await loadTestInvites(prisma);
  const elevated = !!(isAdmin || rolesAreElevated(roles));
  const ids = new Set([
    ...Object.keys(DEFAULT_COMING_SOON),
    ...Object.keys(flags || {}),
    ...Object.keys(invites || {})
  ]);
  const out = [];
  for (const id of ids) {
    if (!isComingSoonCat(flags, id)) continue;
    if (elevated || userHasTestInvite(invites, id, userId)) out.push(id);
  }
  return out;
}

module.exports = {
  DEFAULT_COMING_SOON,
  TEST_INVITES_KEY,
  loadGameCatalogFlags,
  isComingSoonCat,
  rolesAreElevated,
  loadTestInvites,
  saveTestInvites,
  inviteListForGame,
  userHasTestInvite,
  assertCatPlayable,
  listPlayableComingSoonIds
};
