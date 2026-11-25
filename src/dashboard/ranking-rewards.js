"use strict";

const { getPrisma, authEnabled } = require("../db");
const { rankingWindow, previousRankingWindow } = require("./ranking-period");
const {
  ensureCosmeticsCatalog,
  grantCosmetic,
  RANK_TITLE_IDS,
  STARTER_COSMETICS,
  normalizeExtraTitleIds,
  MAX_EXTRA_TITLES,
  isRankingTitleId,
  clearCosmeticFromExtraTitles
} = require("./cosmetics");

function periodLabelTh(period) {
  return period === "monthly" ? "ประจำเดือน" : "ประจำสัปดาห์";
}

function cosmeticName(cosmeticId) {
  const hit = STARTER_COSMETICS.find((c) => c.id === cosmeticId);
  return (hit && hit.name) || cosmeticId || "ยศพิเศษ";
}

async function notifyRankingReward(prisma, { userId, period, rank, cosmeticId, windowLabel, expiresAt }) {
  const titleName = cosmeticName(cosmeticId);
  const periodTh = periodLabelTh(period);
  const title = `ได้รับรางวัล Top ${rank} ${periodTh}`;
  const expireNote = expiresAt
    ? `\nหมดอายุ: ${new Date(expiresAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} (เมื่อจบรอบ)`
    : "";
  const body = `คุณได้รับยศ「${titleName}」แล้ว — ใช้ได้ถึงจบรอบ · ดูที่เมนู ตกแต่ง`;
  const fullBody =
    `ยินดีด้วย! คุณติด Top ${rank} Ranking ${periodTh}` +
    (windowLabel ? ` (${windowLabel})` : "") +
    `\n\nรางวัล: ยศ「${titleName}」${expireNote}\nสามารถดูและสวมใส่ได้ที่เมนู ตกแต่ง ใน Dashboard`;

  const { createUserNotification } = require("./notify");
  await createUserNotification(prisma, {
    userId,
    type: "ranking_reward",
    title: String(title).slice(0, 160),
    body: String(body).slice(0, 500),
    payload: {
      kind: "reward",
      period,
      rank,
      cosmeticId,
      windowLabel: windowLabel || null,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      fullBody,
      href: "/app#decorate"
    },
    push: { href: "/app#decorate" }
  });
}

async function stripExtraTitle(prisma, userId, cosmeticId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { equippedExtraTitleIds: true }
  });
  if (!user) return;
  const extras = normalizeExtraTitleIds(user.equippedExtraTitleIds);
  const next = extras.filter((id) => id !== cosmeticId);
  if (next.length === extras.length) return;
  await prisma.user.update({
    where: { id: userId },
    data: { equippedExtraTitleIds: next }
  });
}

/** Remove a ranking title from every owner (inventory + equipped extras). */
async function revokeRankingTitleEverywhere(prisma, cosmeticId) {
  const id = String(cosmeticId || "").trim();
  if (!id || !isRankingTitleId(id)) return 0;
  const owned = await prisma.userCosmetic.findMany({
    where: { cosmeticId: id },
    select: { userId: true }
  });
  if (!owned.length) return 0;
  await prisma.userCosmetic.deleteMany({ where: { cosmeticId: id } });
  await clearCosmeticFromExtraTitles(prisma, id);
  return owned.length;
}

/**
 * Delete expired ranking cosmetics and unequip them.
 * Also drops legacy ranking titles with no expiresAt once their grant window has passed.
 */
async function revokeExpiredRankingTitles(prisma, now = new Date()) {
  const ids = [
    ...(RANK_TITLE_IDS.weekly || []),
    ...(RANK_TITLE_IDS.monthly || []),
    "title.weekly.2",
    "title.weekly.3",
    "title.monthly.2",
    "title.monthly.3"
  ];
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return { revoked: 0 };

  const weekly = rankingWindow("weekly", now);
  const monthly = rankingWindow("monthly", now);

  const expired = await prisma.userCosmetic.findMany({
    where: {
      cosmeticId: { in: uniqueIds },
      OR: [
        { expiresAt: { lte: now } },
        // Legacy permanent ranking titles: drop once current period started after acquire.
        {
          expiresAt: null,
          OR: [
            { cosmeticId: { in: RANK_TITLE_IDS.weekly || [] }, acquiredAt: { lt: weekly.since } },
            { cosmeticId: { in: RANK_TITLE_IDS.monthly || [] }, acquiredAt: { lt: monthly.since } },
            {
              cosmeticId: { in: ["title.weekly.2", "title.weekly.3"] },
              acquiredAt: { lt: weekly.since }
            },
            {
              cosmeticId: { in: ["title.monthly.2", "title.monthly.3"] },
              acquiredAt: { lt: monthly.since }
            }
          ]
        }
      ]
    },
    select: { userId: true, cosmeticId: true }
  });

  if (!expired.length) return { revoked: 0 };

  const byUser = new Map();
  for (const row of expired) {
    let set = byUser.get(row.userId);
    if (!set) {
      set = new Set();
      byUser.set(row.userId, set);
    }
    set.add(row.cosmeticId);
  }

  await prisma.userCosmetic.deleteMany({
    where: {
      OR: expired.map((row) => ({ userId: row.userId, cosmeticId: row.cosmeticId }))
    }
  });

  for (const [userId, cosmeticIds] of byUser) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { equippedExtraTitleIds: true }
    });
    if (!user) continue;
    const extras = normalizeExtraTitleIds(user.equippedExtraTitleIds);
    const next = extras.filter((id) => !cosmeticIds.has(id));
    if (next.length !== extras.length) {
      await prisma.user.update({
        where: { id: userId },
        data: { equippedExtraTitleIds: next }
      });
    }
  }

  console.log(`[ranking-rewards] revoked ${expired.length} expired ranking titles`);
  return { revoked: expired.length };
}

async function revokeExpiredRankingTitlesForUser(prisma, userId, now = new Date()) {
  if (!userId) return { revoked: 0 };
  const ids = [
    ...(RANK_TITLE_IDS.weekly || []),
    ...(RANK_TITLE_IDS.monthly || []),
    "title.weekly.2",
    "title.weekly.3",
    "title.monthly.2",
    "title.monthly.3"
  ];
  const weekly = rankingWindow("weekly", now);
  const monthly = rankingWindow("monthly", now);
  const expired = await prisma.userCosmetic.findMany({
    where: {
      userId,
      cosmeticId: { in: Array.from(new Set(ids.filter(Boolean))) },
      OR: [
        { expiresAt: { lte: now } },
        {
          expiresAt: null,
          OR: [
            { cosmeticId: { in: RANK_TITLE_IDS.weekly || [] }, acquiredAt: { lt: weekly.since } },
            { cosmeticId: { in: RANK_TITLE_IDS.monthly || [] }, acquiredAt: { lt: monthly.since } },
            {
              cosmeticId: { in: ["title.weekly.2", "title.weekly.3"] },
              acquiredAt: { lt: weekly.since }
            },
            {
              cosmeticId: { in: ["title.monthly.2", "title.monthly.3"] },
              acquiredAt: { lt: monthly.since }
            }
          ]
        }
      ]
    },
    select: { cosmeticId: true }
  });
  if (!expired.length) return { revoked: 0 };
  const cosmeticIds = expired.map((r) => r.cosmeticId);
  await prisma.userCosmetic.deleteMany({
    where: { userId, cosmeticId: { in: cosmeticIds } }
  });
  for (const cosmeticId of cosmeticIds) {
    await stripExtraTitle(prisma, userId, cosmeticId);
  }
  return { revoked: expired.length };
}

async function topUsersForWindow(prisma, since, until) {
  const players = await prisma.gamePlayer.findMany({
    where: {
      userId: { not: null },
      user: { accountType: "registered", status: "active" },
      game: { endedAt: { gte: since, lt: until } }
    },
    select: { userId: true, points: true, won: true }
  });
  const byUser = new Map();
  for (const p of players) {
    if (!p.userId) continue;
    let row = byUser.get(p.userId);
    if (!row) {
      row = { userId: p.userId, totalPoints: 0, gamesWon: 0, totalGames: 0 };
      byUser.set(p.userId, row);
    }
    row.totalPoints += Number(p.points) || 0;
    row.totalGames += 1;
    if (p.won) row.gamesWon += 1;
  }
  return Array.from(byUser.values())
    .filter((row) => (row.totalPoints || 0) > 0)
    .sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;
      return b.totalGames - a.totalGames;
    });
}

async function grantPeriodRewards(prisma, period) {
  const prev = previousRankingWindow(period);
  const current = rankingWindow(period);
  const titles = RANK_TITLE_IDS[period] || [];
  if (!titles.length) return { period, label: prev.label, granted: 0 };

  const already = await prisma.rankingRewardGrant.count({
    where: { period, label: prev.label }
  });
  if (already > 0) return { period, label: prev.label, granted: 0, skipped: true };

  // New period settlement: strip previous holders so only the new Top 1 keeps the title.
  for (const cosmeticId of titles) {
    await revokeRankingTitleEverywhere(prisma, cosmeticId);
  }

  const ranked = await topUsersForWindow(prisma, prev.since, prev.resetsAt);
  const top = ranked.slice(0, titles.length);
  let granted = 0;
  const expiresAt = current.resetsAt;

  for (let i = 0; i < top.length; i++) {
    const rank = i + 1;
    const cosmeticId = titles[i];
    const userId = top[i].userId;
    if (!cosmeticId || !userId) continue;
    if ((top[i].totalPoints || 0) <= 0) continue;
    try {
      await prisma.rankingRewardGrant.create({
        data: { period, label: prev.label, rank, userId, cosmeticId }
      });
      await grantCosmetic(prisma, userId, cosmeticId, `ranking_${period}`, { expiresAt });
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { equippedExtraTitleIds: true }
      });
      if (user) {
        const extras = normalizeExtraTitleIds(user.equippedExtraTitleIds);
        if (!extras.includes(cosmeticId) && extras.length < MAX_EXTRA_TITLES) {
          extras.push(cosmeticId);
          await prisma.user.update({
            where: { id: userId },
            data: { equippedExtraTitleIds: extras }
          });
        }
      }
      try {
        await notifyRankingReward(prisma, {
          userId,
          period,
          rank,
          cosmeticId,
          windowLabel: prev.label,
          expiresAt
        });
      } catch (notifyErr) {
        console.warn(
          "[ranking-rewards] notify failed",
          period,
          prev.label,
          rank,
          notifyErr && notifyErr.message
        );
      }
      granted += 1;
    } catch (err) {
      if (err && err.code === "P2002") continue;
      console.warn("[ranking-rewards] grant failed", period, prev.label, rank, err && err.message);
    }
  }
  if (granted) {
    console.log(
      `[ranking-rewards] ${period} ${prev.label}: granted ${granted} titles (expire ${expiresAt.toISOString()})`
    );
  } else {
    console.log(`[ranking-rewards] ${period} ${prev.label}: no eligible Top 1 (titles cleared)`);
  }
  return { period, label: prev.label, granted, expiresAt };
}

async function runRankingRewardsOnce() {
  if (!authEnabled()) return;
  const prisma = await getPrisma();
  await ensureCosmeticsCatalog(prisma);
  await revokeExpiredRankingTitles(prisma);
  await grantPeriodRewards(prisma, "weekly");
  await grantPeriodRewards(prisma, "monthly");
}

function startRankingRewardsScheduler() {
  const tick = () => {
    runRankingRewardsOnce().catch((err) => {
      console.warn("[ranking-rewards]", err && err.message ? err.message : err);
    });
  };
  tick();
  // Check hourly — grants are idempotent per period label.
  setInterval(tick, 60 * 60 * 1000);
}

module.exports = {
  runRankingRewardsOnce,
  startRankingRewardsScheduler,
  grantPeriodRewards,
  revokeExpiredRankingTitles,
  revokeExpiredRankingTitlesForUser,
  revokeRankingTitleEverywhere
};
