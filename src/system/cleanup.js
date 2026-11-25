"use strict";

const { authEnabled, getPrisma } = require("../db");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DAY_SEC = 24 * 60 * 60;

const DEFAULTS = {
  guest_cleanup_enabled: true,
  guest_idle_days: 1,
  guest_session_days: 1,
  session_cleanup_enabled: true,
  cleanup_interval_minutes: 60,
  guest_create_per_ip_hour: 40,
  activity_log_enabled: true,
  activity_log_retention_days: 30,
  game_history_retention_days: 30
};

/** @type {Map<string, number[]>} */
const guestCreateHits = new Map();

let timer = null;
let running = false;
let lastRun = null;

function asBool(v, fallback = false) {
  if (v === true || v === false) return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no" || s === "") return false;
  }
  if (typeof v === "number") return v !== 0;
  if (v == null) return fallback;
  return !!v;
}

function asInt(v, fallback, min, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function loadCleanupSettings(prisma) {
  const keys = Object.keys(DEFAULTS);
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: keys } } });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    guestCleanupEnabled: asBool(map.guest_cleanup_enabled, DEFAULTS.guest_cleanup_enabled),
    guestIdleDays: asInt(map.guest_idle_days, DEFAULTS.guest_idle_days, 1, 365),
    guestSessionDays: asInt(map.guest_session_days, DEFAULTS.guest_session_days, 1, 90),
    sessionCleanupEnabled: asBool(map.session_cleanup_enabled, DEFAULTS.session_cleanup_enabled),
    cleanupIntervalMinutes: asInt(
      map.cleanup_interval_minutes,
      DEFAULTS.cleanup_interval_minutes,
      5,
      24 * 60
    ),
    guestCreatePerIpHour: asInt(
      map.guest_create_per_ip_hour,
      DEFAULTS.guest_create_per_ip_hour,
      0,
      1000
    ),
    activityLogEnabled: asBool(map.activity_log_enabled, DEFAULTS.activity_log_enabled),
    activityLogRetentionDays: asInt(
      map.activity_log_retention_days,
      DEFAULTS.activity_log_retention_days,
      1,
      365
    ),
    gameHistoryRetentionDays: asInt(
      map.game_history_retention_days,
      DEFAULTS.game_history_retention_days,
      1,
      365
    )
  };
}

/** Drop finished room/game history older than retention (cascades players + rounds). */
async function cleanupOldGames(prisma, retentionDays = 30) {
  const days = Math.min(365, Math.max(1, Number(retentionDays) || 30));
  const cutoff = new Date(Date.now() - days * DAY_MS);
  const result = await prisma.game.deleteMany({
    where: {
      OR: [
        { endedAt: { lt: cutoff } },
        { AND: [{ endedAt: null }, { createdAt: { lt: cutoff } }] }
      ]
    }
  });
  return result.count || 0;
}

async function getGuestSessionTtlSec(prisma) {
  try {
    const s = await loadCleanupSettings(prisma);
    return s.guestSessionDays * DAY_SEC;
  } catch {
    return DEFAULTS.guest_session_days * DAY_SEC;
  }
}

function allowGuestCreate(ip, limitPerHour) {
  if (!limitPerHour || limitPerHour <= 0) return true;
  const key = String(ip || "unknown").slice(0, 64);
  const now = Date.now();
  const windowStart = now - HOUR_MS;
  const prev = (guestCreateHits.get(key) || []).filter((t) => t >= windowStart);
  if (prev.length >= limitPerHour) {
    guestCreateHits.set(key, prev);
    return false;
  }
  prev.push(now);
  guestCreateHits.set(key, prev);
  return true;
}

/** Drop expired IP windows so scanners cannot grow heap forever. */
function pruneGuestCreateHits() {
  const windowStart = Date.now() - HOUR_MS;
  for (const [key, hits] of guestCreateHits) {
    const next = (hits || []).filter((t) => t >= windowStart);
    if (!next.length) guestCreateHits.delete(key);
    else if (next.length !== hits.length) guestCreateHits.set(key, next);
  }
}

async function cleanupExpiredSessions(prisma) {
  const result = await prisma.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { not: null } }]
    }
  });
  return result.count;
}

async function cleanupStaleGuests(prisma, idleDays) {
  const cutoff = new Date(Date.now() - idleDays * DAY_MS);
  const now = new Date();
  let deleted = 0;
  for (let i = 0; i < 8; i++) {
    const candidates = await prisma.user.findMany({
      where: {
        accountType: "guest",
        status: { in: ["active", "suspended"] },
        authAccounts: { none: {} },
        AND: [
          {
            OR: [
              { lastLoginAt: { lt: cutoff } },
              { AND: [{ lastLoginAt: null }, { createdAt: { lt: cutoff } }] }
            ]
          },
          {
            sessions: {
              none: {
                revokedAt: null,
                expiresAt: { gt: now }
              }
            }
          }
        ]
      },
      select: { id: true },
      take: 400
    });
    if (!candidates.length) break;
    const ids = candidates.map((u) => u.id);
    const result = await prisma.user.deleteMany({ where: { id: { in: ids } } });
    deleted += result.count;
    if (candidates.length < 400) break;
  }
  return deleted;
}

async function cleanupStats(prisma) {
  const settings = await loadCleanupSettings(prisma);
  const now = new Date();
  const cutoff = new Date(Date.now() - settings.guestIdleDays * DAY_MS);
  const activityCutoff = new Date(Date.now() - settings.activityLogRetentionDays * DAY_MS);
  const gameCutoff = new Date(Date.now() - settings.gameHistoryRetentionDays * DAY_MS);
  const [
    expiredSessions,
    staleGuests,
    guestTotal,
    activityTotal,
    activityExpired,
    gameTotal,
    gameExpired
  ] = await Promise.all([
    prisma.session.count({
      where: {
        OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }]
      }
    }),
    prisma.user.count({
      where: {
        accountType: "guest",
        status: { in: ["active", "suspended"] },
        authAccounts: { none: {} },
        AND: [
          {
            OR: [
              { lastLoginAt: { lt: cutoff } },
              { AND: [{ lastLoginAt: null }, { createdAt: { lt: cutoff } }] }
            ]
          },
          {
            sessions: {
              none: {
                revokedAt: null,
                expiresAt: { gt: now }
              }
            }
          }
        ]
      }
    }),
    prisma.user.count({ where: { accountType: "guest" } }),
    prisma.userActivityLog.count().catch(() => 0),
    prisma.userActivityLog.count({ where: { createdAt: { lt: activityCutoff } } }).catch(() => 0),
    prisma.game.count().catch(() => 0),
    prisma.game
      .count({
        where: {
          OR: [
            { endedAt: { lt: gameCutoff } },
            { AND: [{ endedAt: null }, { createdAt: { lt: gameCutoff } }] }
          ]
        }
      })
      .catch(() => 0)
  ]);
  return {
    settings,
    expiredSessions,
    staleGuests,
    guestTotal,
    activityTotal,
    activityExpired,
    gameTotal,
    gameExpired,
    lastRun
  };
}

async function runCleanup(prisma, opts = {}) {
  if (running) {
    return { ok: false, skipped: true, reason: "already_running", lastRun };
  }
  running = true;
  const startedAt = new Date();
  try {
    const settings = await loadCleanupSettings(prisma);
    const force = !!opts.force;
    let sessionsDeleted = 0;
    let guestsDeleted = 0;
    let activityDeleted = 0;
    let dmDeleted = 0;
    let gamesDeleted = 0;

    if (force || settings.sessionCleanupEnabled) {
      sessionsDeleted = await cleanupExpiredSessions(prisma);
    }
    if (force || settings.guestCleanupEnabled) {
      guestsDeleted = await cleanupStaleGuests(prisma, settings.guestIdleDays);
    }
    if (force || settings.activityLogEnabled) {
      const { cleanupActivityLogs } = require("./activity-log");
      activityDeleted = await cleanupActivityLogs(prisma, settings.activityLogRetentionDays);
    }
    try {
      const { cleanupDirectMessages } = require("../chat/routes");
      dmDeleted = await cleanupDirectMessages(prisma, 3);
    } catch {
      dmDeleted = 0;
    }
    try {
      gamesDeleted = await cleanupOldGames(prisma, settings.gameHistoryRetentionDays);
    } catch {
      gamesDeleted = 0;
    }

    lastRun = {
      at: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      sessionsDeleted,
      guestsDeleted,
      activityDeleted,
      dmDeleted,
      gamesDeleted,
      settings,
      forced: force
    };

    try {
      await prisma.systemSetting.upsert({
        where: { key: "cleanup_last_run" },
        update: { value: lastRun },
        create: { key: "cleanup_last_run", value: lastRun }
      });
    } catch {
      /* ignore persist errors */
    }

    return { ok: true, ...lastRun };
  } finally {
    running = false;
  }
}

function stopCleanupScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function ensureCleanupDefaults(prisma) {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    try {
      // Bump old 7-day game history default → 30 so Monthly ranking has a full month.
      if (key === "game_history_retention_days") {
        const existing = await prisma.systemSetting.findUnique({ where: { key } });
        const cur = existing ? Number(existing.value) : NaN;
        if (!existing || cur === 7) {
          await prisma.systemSetting.upsert({
            where: { key },
            update: { value: 30 },
            create: { key, value: 30 }
          });
          continue;
        }
      }
      // Bump legacy 7-day guest TTL → 24h (1 day).
      if (key === "guest_idle_days" || key === "guest_session_days") {
        const existing = await prisma.systemSetting.findUnique({ where: { key } });
        const cur = existing ? Number(existing.value) : NaN;
        if (!existing || cur === 7) {
          await prisma.systemSetting.upsert({
            where: { key },
            update: { value: 1 },
            create: { key, value: 1 }
          });
          continue;
        }
      }
      await prisma.systemSetting.upsert({
        where: { key },
        update: {},
        create: { key, value }
      });
    } catch {
      /* ignore */
    }
  }
}

function startCleanupScheduler() {
  stopCleanupScheduler();
  if (!authEnabled()) return;

  const tick = async () => {
    if (!authEnabled()) return;
    try {
      pruneGuestCreateHits();
      const prisma = await getPrisma();
      const settings = await loadCleanupSettings(prisma);
      // Always allow tick — game history / DM cleanup run even if guest/session toggles are off.
      if (lastRun && lastRun.at) {
        const elapsed = Date.now() - new Date(lastRun.at).getTime();
        if (elapsed < settings.cleanupIntervalMinutes * 60 * 1000) return;
      }
      await runCleanup(prisma, { force: false });
    } catch {
      /* ignore tick errors */
    }
  };

  // First pass shortly after boot, then poll often; actual run respects cleanup_interval_minutes.
  setTimeout(() => {
    getPrisma()
      .then((prisma) => ensureCleanupDefaults(prisma))
      .catch(() => {})
      .finally(() => {
        tick();
      });
  }, 20000);

  timer = setInterval(() => {
    tick();
  }, 60 * 1000);
}

module.exports = {
  DEFAULTS,
  loadCleanupSettings,
  getGuestSessionTtlSec,
  allowGuestCreate,
  pruneGuestCreateHits,
  cleanupOldGames,
  cleanupStats,
  runCleanup,
  startCleanupScheduler,
  stopCleanupScheduler
};
