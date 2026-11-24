"use strict";

const { authEnabled, getPrisma } = require("../db");

function uuidLike(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ""));
}

/**
 * Persist finished room into Game / GamePlayer / PlayerStatistics.
 * Safe no-op when auth/DB unavailable.
 */
async function persistFinishedGame(room, scoreOf) {
  if (!authEnabled() || !room || room._persisted) return null;
  room._persisted = true;
  try {
    const prisma = await getPrisma();
    const players = (room.players || []).filter((p) => !p.bot);
    if (!players.length) return null;

    const ranked = players
      .map((p) => ({
        userId: uuidLike(p.id) ? p.id : null,
        displayName: p.name,
        points: typeof scoreOf === "function" ? scoreOf(room, p) : p.scoreSecret || 0,
        token: p.id
      }))
      .sort((a, b) => b.points - a.points);

    const winners = new Set();
    if (room.over && room.over.reset) {
      const top = ranked[0] && ranked[0].points;
      ranked.forEach((r) => {
        if (r.points === top && top > 0) winners.add(r.token);
      });
    } else if (room.over && /ชนะ/.test(String(room.over.title || ""))) {
      ranked.slice(0, 1).forEach((r) => winners.add(r.token));
    }

    const startedAt = room.startedAt ? new Date(room.startedAt) : new Date(room.created || Date.now());
    const endedAt = new Date();
    const durationSec = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
    const hostPlayer = (room.players || []).find((p) => p.id === room.hostId);
    const hostUserId = hostPlayer && uuidLike(hostPlayer.id) ? hostPlayer.id : null;

    const game = await prisma.game.create({
      data: {
        roomCode: room.code,
        roomName: room.title || ("Room " + room.code),
        gameMode:
          room.cat === "wheel"
            ? "wheel"
            : room.cat === "snake"
              ? "snake"
              : room.cat === "imposter"
                ? "imposter"
                : room.cat === "cardmemory"
                  ? "cardmemory"
                  : room.cat === "werewolf"
                    ? "werewolf"
                    : "secret",
        visibility: room.visibility === "private" ? "private" : "public",
        status: "finished",
        playerCount: players.length,
        startedAt,
        endedAt,
        durationSec,
        metadata: {
          winTarget: room.winTarget,
          overTitle: room.over && room.over.title,
          hostUserId,
          hostName: hostPlayer ? hostPlayer.name : null
        },
        players: {
          create: ranked.map((r, i) => ({
            userId: r.userId,
            displayName: r.displayName,
            rank: i + 1,
            points: r.points,
            won: winners.has(r.token)
          }))
        }
      },
      include: { players: true }
    });

    for (const gp of game.players) {
      if (!gp.userId) continue;
      const existing = await prisma.playerStatistics.findUnique({ where: { userId: gp.userId } });
      const totalGames = (existing ? existing.totalGames : 0) + 1;
      const gamesWon = (existing ? existing.gamesWon : 0) + (gp.won ? 1 : 0);
      const gamesLost = (existing ? existing.gamesLost : 0) + (gp.won ? 0 : 1);
      const totalPoints = (existing ? existing.totalPoints : 0) + gp.points;
      const playTimeSec = (existing ? existing.playTimeSec : 0) + durationSec;
      const bestStreak = existing ? existing.bestWinStreak : 0;
      const curStreak = gp.won ? (existing ? existing.currentWinStreak : 0) + 1 : 0;
      const sumRank = (existing ? existing.rankSum : 0) + gp.rank;
      await prisma.playerStatistics.upsert({
        where: { userId: gp.userId },
        create: {
          userId: gp.userId,
          totalGames,
          gamesWon,
          gamesLost,
          totalPoints,
          playTimeSec,
          bestWinStreak: curStreak,
          currentWinStreak: curStreak,
          rankSum: sumRank,
          favoriteMode:
            room.cat === "wheel"
              ? "wheel"
              : room.cat === "snake"
                ? "snake"
                : room.cat === "imposter"
                  ? "imposter"
                  : room.cat === "cardmemory"
                    ? "cardmemory"
                    : room.cat === "werewolf"
                      ? "werewolf"
                      : "secret"
        },
        update: {
          totalGames,
          gamesWon,
          gamesLost,
          totalPoints,
          playTimeSec,
          bestWinStreak: Math.max(bestStreak, curStreak),
          currentWinStreak: curStreak,
          rankSum: sumRank,
          favoriteMode:
            room.cat === "wheel"
              ? "wheel"
              : room.cat === "snake"
                ? "snake"
                : room.cat === "imposter"
                  ? "imposter"
                  : room.cat === "cardmemory"
                    ? "cardmemory"
                    : room.cat === "werewolf"
                      ? "werewolf"
                      : "secret"
        }
      });

      try {
        const { createUserNotification } = require("./notify");
        const won = !!gp.won;
        await createUserNotification(prisma, {
          userId: gp.userId,
          type: "game_finished",
          title: won ? "ชนะเกมแล้ว!" : "เกมจบแล้ว",
          body: (room.over && room.over.title) || ("ห้อง " + room.code + " จบแล้ว"),
          payload: { gameId: game.id, roomCode: room.code, rank: gp.rank, won },
          push: { won }
        });
      } catch {
        /* ignore */
      }

      try {
        const { awardExp } = require("./levels");
        await awardExp(prisma, gp.userId, { won: !!gp.won });
      } catch (expErr) {
        console.warn("[persistFinishedGame] awardExp", expErr && expErr.message ? expErr.message : expErr);
      }

      if (gp.won) {
        try {
          const {
            loadShopPtsConfig,
            computeWinShopPts,
            awardShopPts,
            countHumanPlayers
          } = require("./shop-pts");
          const shopCfg = await loadShopPtsConfig(prisma);
          const humans = countHumanPlayers(room);
          const ptsGain = computeWinShopPts(shopCfg, humans);
          if (ptsGain > 0) {
            await awardShopPts(prisma, gp.userId, ptsGain, {
              humans,
              modePts: shopCfg.mode,
              gameId: game.id,
              roomCode: room.code,
              mode: room.cat === "wheel" ? "wheel" : room.cat === "snake" ? "snake" : "secret"
            });
          }
        } catch (ptsErr) {
          console.warn(
            "[persistFinishedGame] awardShopPts",
            ptsErr && ptsErr.message ? ptsErr.message : ptsErr
          );
        }
      }
    }

    // Activity: only when a match reached winTarget (over.reset).
    if (room.over && room.over.reset) {
      try {
        const { logActivity } = require("../system/activity-log");
        for (const r of ranked) {
          if (!r.userId) continue;
          logActivity({
            userId: r.userId,
            action: "match_end",
            metadata: {
              gameId: game.id,
              code: room.code,
              mode: room.cat === "wheel" ? "wheel" : room.cat === "snake" ? "snake" : "secret",
              won: winners.has(r.token),
              points: r.points,
              winTarget: room.winTarget
            }
          });
        }
      } catch {
        /* ignore */
      }
    }

    return game;
  } catch (err) {
    console.error("[persistFinishedGame]", err.message || err);
    room._persisted = false;
    return null;
  }
}

module.exports = { persistFinishedGame, uuidLike };
