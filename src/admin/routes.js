"use strict";

const { authEnabled, getPrisma } = require("../db");
const { sendJson, readJsonBody, clientIp } = require("../auth/http");
const {
  requireAdmin,
  requirePermission,
  userHasRole,
  permissionsOf
} = require("../auth/middleware");
const { publicUser } = require("../auth/users");
const { revokeAllUserSessions } = require("../auth/sessions");
const { getGameApi } = require("../dashboard/bridge");
const { writeAdminLog } = require("./audit");
const { publishAnnouncement, isDueNow } = require("./publish-announcement");
const { invalidatePublicSettingsCache } = require("../system/public-settings");
const { handleAdminLevelsApi } = require("../dashboard/levels");
const { handleAdminCosmeticsApi } = require("../dashboard/cosmetics");
const { handleAdminInventoryApi } = require("../dashboard/inventory");

function method(req) {
  return String(req.method || "GET").toUpperCase();
}

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysAgo(n) {
  const x = startOfDay();
  x.setDate(x.getDate() - n);
  return x;
}

async function getSetting(prisma, key, fallback) {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row ? row.value : fallback;
}

async function setSetting(prisma, key, value) {
  return prisma.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value }
  });
}

function serializeUser(u) {
  if (!u) return null;
  const base = publicUser(u);
  const email =
    (u.authAccounts || [])
      .map((a) => a.providerEmail)
      .filter(Boolean)[0] || null;
  return Object.assign({}, base, {
    email,
    providers: (u.authAccounts || []).map((a) => a.provider),
    sessionCount: u._count && u._count.sessions != null ? u._count.sessions : undefined
  });
}

async function handleAdminApi(req, res, pathname) {
  if (!pathname.startsWith("/api/v1/admin")) return false;
  if (!authEnabled()) {
    sendJson(res, 503, { error: "auth_disabled" });
    return true;
  }

  const prisma = await getPrisma();
  const game = getGameApi();
  const ip = clientIp(req);

  if (await handleAdminLevelsApi(req, res, pathname)) return true;
  if (await handleAdminCosmeticsApi(req, res, pathname)) return true;
  if (await handleAdminInventoryApi(req, res, pathname)) return true;

  // —— Overview ——
  if (pathname === "/api/v1/admin/overview") {
    const auth = await requirePermission(req, res, "dashboard.view");
    if (!auth) return true;
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const today = startOfDay();
    const { getDbStats } = require("../system/db-stats");
    const [usersTotal, usersActive, sessionsActive, gamesToday, recentLogs, db] = await Promise.all([
      prisma.user.count({ where: { status: { not: "deleted" } } }),
      prisma.user.count({ where: { status: "active" } }),
      prisma.session.count({
        where: { revokedAt: null, expiresAt: { gt: new Date() } }
      }),
      prisma.game.count({ where: { createdAt: { gte: today } } }),
      prisma.adminLog.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        include: { admin: { select: { id: true, displayName: true, username: true } } }
      }),
      getDbStats(prisma)
    ]);
    const stats = game && game.adminStats ? game.adminStats() : { rooms: 0, players: 0, spectators: 0 };
    const liveRooms = game && game.listAllRooms ? game.listAllRooms().slice(0, 8) : [];
    sendJson(res, 200, {
      kpis: {
        usersTotal,
        usersActive,
        sessionsActive,
        gamesToday,
        liveRooms: stats.rooms,
        livePlayers: stats.players
      },
      db,
      liveRooms,
      recentLogs
    });
    return true;
  }

  // —— Analytics ——
  if (pathname === "/api/v1/admin/analytics") {
    const auth = await requirePermission(req, res, "analytics.view");
    if (!auth) return true;
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const url = new URL(req.url || "/", "http://localhost");
    const range = Math.min(90, Math.max(7, Number(url.searchParams.get("range") || 14) || 14));
    const since = daysAgo(range - 1);
    const games = await prisma.game.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, gameMode: true, playerCount: true }
    });
    const users = await prisma.user.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true }
    });
    const byDay = {};
    for (let i = 0; i < range; i++) {
      const d = daysAgo(range - 1 - i);
      const key = d.toISOString().slice(0, 10);
      byDay[key] = { date: key, games: 0, users: 0 };
    }
    for (const g of games) {
      const key = new Date(g.createdAt).toISOString().slice(0, 10);
      if (byDay[key]) byDay[key].games += 1;
    }
    for (const u of users) {
      const key = new Date(u.createdAt).toISOString().slice(0, 10);
      if (byDay[key]) byDay[key].users += 1;
    }
    const modeMix = {};
    for (const g of games) {
      modeMix[g.gameMode] = (modeMix[g.gameMode] || 0) + 1;
    }
    sendJson(res, 200, {
      range,
      series: Object.values(byDay),
      modeMix,
      totals: { games: games.length, newUsers: users.length }
    });
    return true;
  }

  // —— Users list ——
  if (pathname === "/api/v1/admin/users") {
    const auth = await requirePermission(req, res, "users.view");
    if (!auth) return true;
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const url = new URL(req.url || "/", "http://localhost");
    const q = (url.searchParams.get("q") || "").trim();
    const status = url.searchParams.get("status") || "";
    const role = url.searchParams.get("role") || "";
    const accountType = url.searchParams.get("accountType") || "";
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20) || 20));
    const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
    const where = { status: { not: "deleted" } };
    if (status && ["active", "suspended", "banned"].includes(status)) where.status = status;
    if (accountType && ["guest", "registered"].includes(accountType)) {
      where.accountType = accountType;
    }
    if (q) {
      where.OR = [
        { username: { contains: q, mode: "insensitive" } },
        { displayName: { contains: q, mode: "insensitive" } },
        { friendCode: { contains: q, mode: "insensitive" } }
      ];
    }
    if (role) {
      where.userRoles = { some: { role: { name: role } } };
    }
    const total = await prisma.user.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, pageCount);
    const skip = (safePage - 1) * pageSize;
    const users = await prisma.user.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { createdAt: "desc" },
      include: {
        userRoles: {
          include: {
            role: { include: { rolePermissions: { include: { permission: true } } } }
          }
        },
        authAccounts: { select: { provider: true, providerEmail: true } },
        _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } } }
      }
    });
    sendJson(res, 200, {
      users: users.map(serializeUser),
      total,
      page: safePage,
      pageSize,
      pageCount
    });
    return true;
  }

  // —— User detail / patch / sessions / roles ——
  const userMatch = pathname.match(/^\/api\/v1\/admin\/users\/([^/]+)(?:\/(sessions|roles))?$/);
  if (userMatch) {
    const userId = decodeURIComponent(userMatch[1]);
    const sub = userMatch[2] || "";

    if (sub === "sessions" && method(req) === "DELETE") {
      const auth = await requirePermission(req, res, "users.ban");
      if (!auth) return true;
      await revokeAllUserSessions(prisma, userId);
      await writeAdminLog(prisma, {
        adminId: auth.user.id,
        action: "user.revoke_sessions",
        targetId: userId,
        ipAddress: ip
      });
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (sub === "roles" && method(req) === "PUT") {
      const auth = await requirePermission(req, res, "admins.manage");
      if (!auth) return true;
      const body = await readJsonBody(req).catch(() => null);
      if (!body || !Array.isArray(body.roles)) {
        sendJson(res, 400, { error: "invalid_body" });
        return true;
      }
      const wanted = [...new Set(body.roles.map(String))].filter((r) =>
        ["player", "moderator", "admin", "super_admin"].includes(r)
      );
      if (!wanted.includes("player")) wanted.push("player");
      if (wanted.includes("super_admin") && !userHasRole(auth.user, "super_admin")) {
        sendJson(res, 403, { error: "super_admin_required" });
        return true;
      }
      const target = await prisma.user.findUnique({
        where: { id: userId },
        include: { userRoles: { include: { role: true } } }
      });
      if (!target) {
        sendJson(res, 404, { error: "not_found" });
        return true;
      }
      const wasSuper = (target.userRoles || []).some((ur) => ur.role && ur.role.name === "super_admin");
      if (wasSuper && !wanted.includes("super_admin")) {
        const supers = await prisma.userRole.count({
          where: { role: { name: "super_admin" } }
        });
        if (supers <= 1) {
          sendJson(res, 400, { error: "last_super_admin" });
          return true;
        }
      }
      const roles = await prisma.role.findMany({ where: { name: { in: wanted } } });
      await prisma.$transaction(async (tx) => {
        await tx.userRole.deleteMany({ where: { userId } });
        for (const role of roles) {
          await tx.userRole.create({ data: { userId, roleId: role.id } });
        }
      });
      await writeAdminLog(prisma, {
        adminId: auth.user.id,
        action: "user.set_roles",
        targetId: userId,
        metadata: { roles: wanted },
        ipAddress: ip
      });
      const updated = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          userRoles: {
            include: {
              role: { include: { rolePermissions: { include: { permission: true } } } }
            }
          },
          authAccounts: { select: { provider: true, providerEmail: true } }
        }
      });
      sendJson(res, 200, { user: serializeUser(updated) });
      return true;
    }

    if (!sub && method(req) === "GET") {
      const auth = await requirePermission(req, res, "users.view");
      if (!auth) return true;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          userRoles: {
            include: {
              role: { include: { rolePermissions: { include: { permission: true } } } }
            }
          },
          authAccounts: { select: { provider: true, providerEmail: true } },
          playerStatistics: true,
          _count: { select: { sessions: { where: { revokedAt: null } } } }
        }
      });
      if (!user || user.status === "deleted") {
        sendJson(res, 404, { error: "not_found" });
        return true;
      }
      sendJson(res, 200, {
        user: serializeUser(user),
        stats: user.playerStatistics || null
      });
      return true;
    }

    if (!sub && method(req) === "PATCH") {
      const body = await readJsonBody(req).catch(() => null);
      if (!body) {
        sendJson(res, 400, { error: "invalid_body" });
        return true;
      }

      const wantsStatus = Object.prototype.hasOwnProperty.call(body, "status");
      const wantsUsername = Object.prototype.hasOwnProperty.call(body, "username");
      const wantsDisplayName = Object.prototype.hasOwnProperty.call(body, "displayName");
      const wantsResetExp = body.resetExp === true || body.resetExp === "true" || body.resetExp === 1;
      const wantsAddExp = Object.prototype.hasOwnProperty.call(body, "addExp");
      if (!wantsStatus && !wantsUsername && !wantsDisplayName && !wantsResetExp && !wantsAddExp) {
        sendJson(res, 400, { error: "invalid_body" });
        return true;
      }

      const userInclude = {
        userRoles: {
          include: {
            role: { include: { rolePermissions: { include: { permission: true } } } }
          }
        },
        authAccounts: { select: { provider: true, providerEmail: true } }
      };

      // —— Add / Reset EXP ——
      if ((wantsResetExp || wantsAddExp) && !wantsStatus && !wantsUsername && !wantsDisplayName) {
        const authAdmin = await requireAdmin(req, res);
        if (!authAdmin) return true;
        const { userHasPermission } = require("../auth/middleware");
        if (
          !userHasPermission(authAdmin.user, "users.reset_exp") &&
          !userHasPermission(authAdmin.user, "users.ban")
        ) {
          sendJson(res, 403, { error: "permission_denied", permission: "users.reset_exp" });
          return true;
        }
        const auth = authAdmin;
        const target = await prisma.user.findUnique({
          where: { id: userId },
          include: { userRoles: { include: { role: true } } }
        });
        if (!target || target.status === "deleted") {
          sendJson(res, 404, { error: "not_found" });
          return true;
        }
        if (
          userHasRole(target, "super_admin") &&
          !userHasRole(auth.user, "super_admin")
        ) {
          sendJson(res, 403, { error: "cannot_modify_super_admin" });
          return true;
        }

        if (wantsAddExp) {
          const { adminAddExp } = require("../dashboard/levels");
          let result;
          try {
            result = await adminAddExp(prisma, userId, body.addExp);
          } catch (err) {
            if (err && err.code === "invalid_amount") {
              sendJson(res, 400, { error: "invalid_amount" });
              return true;
            }
            throw err;
          }
          if (!result) {
            sendJson(res, 400, { error: "add_exp_failed" });
            return true;
          }
          const gain = result.gain;
          const leveled = result.after.level > result.before.level;
          const title = "ได้รับ EXP จากระบบ";
          const bodyText = leveled
            ? `ระบบมอบ +${gain} EXP ให้คุณ · ขึ้นเลเวล ${result.after.level}「${result.after.title}」แล้ว`
            : `ระบบมอบ +${gain} EXP ให้คุณ · ตอนนี้มี ${result.exp} EXP (Level ${result.after.level})`;
          await prisma.notification.create({
            data: {
              userId,
              type: "system_grant",
              title,
              body: bodyText,
              payload: {
                kind: "system",
                fullBody:
                  bodyText +
                  "\n\nดูความคืบหน้าได้ที่เมนู Level" +
                  (leveled ? " และสวมยศใหม่ได้ที่เมนู ตกแต่ง" : ""),
                gain,
                exp: result.exp,
                level: result.after.level,
                href: "/app#level"
              }
            }
          });
          const gameApi = getGameApi();
          if (gameApi && typeof gameApi.notifyUser === "function") {
            try {
              gameApi.notifyUser(userId, { type: "system_grant" });
            } catch {
              /* ignore */
            }
          }
          await writeAdminLog(prisma, {
            adminId: auth.user.id,
            action: "user.add_exp",
            targetId: userId,
            metadata: {
              gain,
              before: { exp: result.before.exp, level: result.before.level },
              after: { exp: result.exp, level: result.after.level }
            },
            ipAddress: ip
          });
          const updated = await prisma.user.findUnique({
            where: { id: userId },
            include: userInclude
          });
          sendJson(res, 200, { user: serializeUser(updated), gain, leveled });
          return true;
        }

        const updated = await prisma.user.update({
          where: { id: userId },
          // Keep maxLevel so level titles stay at peak achievement
          data: { exp: 0, level: 1 },
          include: userInclude
        });
        try {
          const { syncEquippedLevelTitle } = require("../dashboard/cosmetics");
          await syncEquippedLevelTitle(prisma, userId);
        } catch {
          /* ignore */
        }
        await writeAdminLog(prisma, {
          adminId: auth.user.id,
          action: "user.reset_exp",
          targetId: userId,
          metadata: {
            before: { exp: target.exp, level: target.level, maxLevel: target.maxLevel },
            after: { exp: 0, level: 1, maxLevel: updated.maxLevel }
          },
          ipAddress: ip
        });
        sendJson(res, 200, { user: serializeUser(updated) });
        return true;
      }

      // —— Rename username / display name ——
      if ((wantsUsername || wantsDisplayName) && !wantsStatus) {
        const auth = await requirePermission(req, res, "users.ban");
        if (!auth) return true;
        const target = await prisma.user.findUnique({
          where: { id: userId },
          include: { userRoles: { include: { role: true } } }
        });
        if (!target || target.status === "deleted") {
          sendJson(res, 404, { error: "not_found" });
          return true;
        }
        if (
          userHasRole(target, "super_admin") &&
          !userHasRole(auth.user, "super_admin")
        ) {
          sendJson(res, 403, { error: "cannot_modify_super_admin" });
          return true;
        }

        const data = {};
        if (wantsUsername) {
          const username = String(body.username || "")
            .trim()
            .replace(/\s+/g, "")
            .slice(0, 64);
          if (username.length < 2 || username.length > 64 || !/^[a-zA-Z0-9._-]+$/.test(username)) {
            sendJson(res, 400, { error: "invalid_username" });
            return true;
          }
          const clash = await prisma.user.findFirst({
            where: {
              id: { not: userId },
              status: { not: "deleted" },
              username: { equals: username, mode: "insensitive" }
            },
            select: { id: true }
          });
          if (clash) {
            sendJson(res, 409, { error: "username_taken" });
            return true;
          }
          data.username = username;
        }
        if (wantsDisplayName) {
          const displayName = String(body.displayName || "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 64);
          if (displayName.length < 1) {
            sendJson(res, 400, { error: "invalid_display_name" });
            return true;
          }
          data.displayName = displayName;
        }

        const updated = await prisma.user.update({
          where: { id: userId },
          data,
          include: userInclude
        });
        await writeAdminLog(prisma, {
          adminId: auth.user.id,
          action: "user.rename",
          targetId: userId,
          metadata: {
            before: { username: target.username, displayName: target.displayName },
            after: {
              username: updated.username,
              displayName: updated.displayName
            }
          },
          ipAddress: ip
        });
        sendJson(res, 200, { user: serializeUser(updated) });
        return true;
      }

      // —— Status change ——
      const nextStatus = body.status;
      if (!["active", "suspended", "banned", "deleted"].includes(nextStatus)) {
        sendJson(res, 400, { error: "invalid_status" });
        return true;
      }
      let perm = "users.ban";
      if (nextStatus === "active") perm = "users.unban";
      if (nextStatus === "deleted") perm = "users.delete";
      const auth = await requirePermission(req, res, perm);
      if (!auth) return true;
      if (userId === auth.user.id) {
        sendJson(res, 400, { error: "cannot_modify_self" });
        return true;
      }
      const target = await prisma.user.findUnique({
        where: { id: userId },
        include: { userRoles: { include: { role: true } } }
      });
      if (!target) {
        sendJson(res, 404, { error: "not_found" });
        return true;
      }
      if (
        userHasRole(target, "super_admin") &&
        !userHasRole(auth.user, "super_admin")
      ) {
        sendJson(res, 403, { error: "cannot_modify_super_admin" });
        return true;
      }
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { status: nextStatus },
        include: userInclude
      });
      const gameApi = getGameApi();
      if (nextStatus === "banned" || nextStatus === "suspended" || nextStatus === "deleted") {
        await revokeAllUserSessions(prisma, userId);
        if (gameApi && typeof gameApi.forceBanUser === "function") {
          try {
            gameApi.forceBanUser(userId, {
              status: nextStatus,
              message:
                nextStatus === "suspended"
                  ? "บัญชีของคุณถูกระงับชั่วคราว"
                  : nextStatus === "deleted"
                    ? "บัญชีของคุณถูกลบแล้ว"
                    : "บัญชีของคุณถูกแบน"
            });
          } catch {
            /* ignore */
          }
        }
        try {
          const { logActivity } = require("../system/activity-log");
          logActivity({
            userId,
            action: "ban",
            ipAddress: ip,
            metadata: { status: nextStatus, byAdminId: auth.user.id }
          });
        } catch {
          /* ignore */
        }
      } else if (nextStatus === "active") {
        if (gameApi && typeof gameApi.notifyUnbanned === "function") {
          try {
            gameApi.notifyUnbanned(userId);
          } catch {
            /* ignore */
          }
        }
      }
      await writeAdminLog(prisma, {
        adminId: auth.user.id,
        action: "user.set_status",
        targetId: userId,
        metadata: { status: nextStatus },
        ipAddress: ip
      });
      sendJson(res, 200, { user: serializeUser(updated) });
      return true;
    }

    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  // —— Games catalog ——
  if (pathname === "/api/v1/admin/games/catalog") {
    if (method(req) === "GET") {
      const auth = await requirePermission(req, res, "games.view");
      if (!auth) return true;
      const catalog = await getSetting(prisma, "game_catalog", {
        secret: { enabled: true, name: "หาเลข", beta: false, comingSoon: false },
        wheel: { enabled: true, name: "วงล้อ", beta: false, comingSoon: false },
        snake: { enabled: true, name: "บันไดงู", beta: true, comingSoon: false },
        imposter: { enabled: true, name: "Imposter", beta: false, comingSoon: true },
        race2048: { enabled: true, name: "2048 Race", beta: false, comingSoon: true },
        cardmemory: { enabled: true, name: "Card Memory", beta: false, comingSoon: true },
        werewolf: { enabled: true, name: "Werewolf", beta: false, comingSoon: true }
      });
      sendJson(res, 200, { catalog });
      return true;
    }
    if (method(req) === "PATCH") {
      const auth = await requirePermission(req, res, "games.manage");
      if (!auth) return true;
      const body = await readJsonBody(req).catch(() => null);
      if (!body || !body.catalog || typeof body.catalog !== "object") {
        sendJson(res, 400, { error: "invalid_body" });
        return true;
      }
      const next = {};
      const defaults = {
        secret: "หาเลข",
        wheel: "วงล้อ",
        snake: "บันไดงู",
        imposter: "Imposter",
        race2048: "2048 Race",
        cardmemory: "Card Memory",
        werewolf: "Werewolf"
      };
      for (const id of ["secret", "wheel", "snake", "imposter", "race2048", "cardmemory", "werewolf"]) {
        const row = body.catalog[id] || {};
        next[id] = {
          enabled: row.enabled !== false,
          beta: !!row.beta,
          comingSoon: !!row.comingSoon,
          name: String(row.name || defaults[id]).slice(0, 64)
        };
      }
      await setSetting(prisma, "game_catalog", next);
      await writeAdminLog(prisma, {
        adminId: auth.user.id,
        action: "games.catalog_update",
        metadata: next,
        ipAddress: ip
      });
      sendJson(res, 200, { catalog: next });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  // —— Coming Soon test invites ——
  if (pathname === "/api/v1/admin/games/testers") {
    const {
      loadTestInvites,
      saveTestInvites,
      inviteListForGame
    } = require("../dashboard/game-catalog-flags");

    if (method(req) === "GET") {
      const auth = await requirePermission(req, res, "games.view");
      if (!auth) return true;
      const url = new URL(req.url || "/", "http://localhost");
      const gameId = String(url.searchParams.get("gameId") || "").trim();
      const invites = await loadTestInvites(prisma);
      if (gameId) {
        const list = inviteListForGame(invites, gameId);
        const userIds = list
          .map((row) => (typeof row === "string" ? row : row && row.userId))
          .filter(Boolean);
        const users = userIds.length
          ? await prisma.user.findMany({
              where: { id: { in: userIds } },
              select: {
                id: true,
                username: true,
                displayName: true,
                friendCode: true,
                avatarUrl: true,
                accountType: true
              }
            })
          : [];
        const byId = new Map(users.map((u) => [u.id, u]));
        sendJson(res, 200, {
          gameId,
          testers: list.map((row) => {
            const id = typeof row === "string" ? row : row && row.userId;
            const u = byId.get(id);
            return {
              userId: id,
              invitedAt: typeof row === "object" && row ? row.invitedAt || null : null,
              invitedBy: typeof row === "object" && row ? row.invitedBy || null : null,
              user: u
                ? {
                    id: u.id,
                    username: u.username,
                    displayName: u.displayName,
                    friendCode: u.friendCode,
                    avatarUrl: u.avatarUrl,
                    accountType: u.accountType
                  }
                : null
            };
          })
        });
        return true;
      }
      sendJson(res, 200, { invites });
      return true;
    }

    if (method(req) === "POST") {
      const auth = await requirePermission(req, res, "games.manage");
      if (!auth) return true;
      const body = await readJsonBody(req).catch(() => null);
      const gameId = String((body && body.gameId) || "").trim();
      const q = String((body && (body.q || body.friendCode || body.username || body.userId)) || "").trim();
      if (!gameId || !q) {
        sendJson(res, 400, { error: "invalid_body" });
        return true;
      }
      let user = null;
      if (/^[0-9a-f-]{36}$/i.test(q)) {
        user = await prisma.user.findUnique({ where: { id: q } });
      }
      if (!user) {
        user = await prisma.user.findFirst({
          where: {
            status: { not: "deleted" },
            OR: [
              { friendCode: { equals: q, mode: "insensitive" } },
              { username: { equals: q, mode: "insensitive" } },
              { displayName: { equals: q, mode: "insensitive" } }
            ]
          }
        });
      }
      if (!user) {
        sendJson(res, 404, { error: "user_not_found" });
        return true;
      }
      if (user.accountType !== "registered") {
        sendJson(res, 400, { error: "registered_only", message: "เชิญได้เฉพาะบัญชีที่สมัครแล้ว" });
        return true;
      }
      const invites = await loadTestInvites(prisma);
      const list = inviteListForGame(invites, gameId).slice();
      if (list.some((row) => (typeof row === "string" ? row : row && row.userId) === user.id)) {
        sendJson(res, 200, { ok: true, already: true, userId: user.id });
        return true;
      }
      list.push({
        userId: user.id,
        invitedAt: new Date().toISOString(),
        invitedBy: auth.user.id
      });
      invites[gameId] = list;
      await saveTestInvites(prisma, invites);
      await writeAdminLog(prisma, {
        adminId: auth.user.id,
        action: "games.tester_invite",
        metadata: { gameId, userId: user.id },
        ipAddress: ip
      });
      try {
        const { createUserNotification } = require("../dashboard/notify");
        await createUserNotification(prisma, {
          userId: user.id,
          type: "game_test_invite",
          title: "เชิญทดสอบเกม",
          body: "คุณได้รับคำเชิญทดสอบเกม Coming Soon: " + gameId,
          payload: { gameId }
        });
      } catch {
        /* ignore */
      }
      sendJson(res, 201, {
        ok: true,
        userId: user.id,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          friendCode: user.friendCode
        }
      });
      return true;
    }

    if (method(req) === "DELETE") {
      const auth = await requirePermission(req, res, "games.manage");
      if (!auth) return true;
      const body = await readJsonBody(req).catch(() => null);
      const gameId = String((body && body.gameId) || "").trim();
      const userId = String((body && body.userId) || "").trim();
      if (!gameId || !userId) {
        sendJson(res, 400, { error: "invalid_body" });
        return true;
      }
      const invites = await loadTestInvites(prisma);
      const list = inviteListForGame(invites, gameId).filter((row) => {
        const id = typeof row === "string" ? row : row && row.userId;
        return id !== userId;
      });
      invites[gameId] = list;
      await saveTestInvites(prisma, invites);
      await writeAdminLog(prisma, {
        adminId: auth.user.id,
        action: "games.tester_revoke",
        metadata: { gameId, userId },
        ipAddress: ip
      });
      sendJson(res, 200, { ok: true });
      return true;
    }

    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  // —— Games history ——
  if (pathname === "/api/v1/admin/games/history") {
    const auth = await requirePermission(req, res, "games.view");
    if (!auth) return true;
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const url = new URL(req.url || "/", "http://localhost");
    const take = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 40) || 40));
    const mode = url.searchParams.get("mode") || "";
    const where = {};
    if (mode) where.gameMode = mode;
    const games = await prisma.game.findMany({
      where,
      take,
      orderBy: { endedAt: "desc" },
      include: {
        players: { orderBy: { rank: "asc" }, take: 8 }
      }
    });
    sendJson(res, 200, { games });
    return true;
  }

  // —— Rooms list ——
  if (pathname === "/api/v1/admin/rooms") {
    const auth = await requirePermission(req, res, "rooms.view");
    if (!auth) return true;
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const rooms = game && game.listAllRooms ? game.listAllRooms() : [];
    sendJson(res, 200, { rooms });
    return true;
  }

  const roomClose = pathname.match(/^\/api\/v1\/admin\/rooms\/([^/]+)\/close$/);
  if (roomClose) {
    const auth = await requirePermission(req, res, "rooms.close");
    if (!auth) return true;
    if (method(req) !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const code = decodeURIComponent(roomClose[1]);
    const ok = game && game.adminCloseRoom ? game.adminCloseRoom(code) : false;
    if (!ok) {
      sendJson(res, 404, { error: "room_not_found" });
      return true;
    }
    await writeAdminLog(prisma, {
      adminId: auth.user.id,
      action: "room.close",
      targetId: code,
      ipAddress: ip
    });
    sendJson(res, 200, { ok: true });
    return true;
  }

  const roomKick = pathname.match(/^\/api\/v1\/admin\/rooms\/([^/]+)\/kick$/);
  if (roomKick) {
    const auth = await requirePermission(req, res, "rooms.kick");
    if (!auth) return true;
    if (method(req) !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const code = decodeURIComponent(roomKick[1]);
    const body = await readJsonBody(req).catch(() => null);
    const playerId = body && body.playerId;
    if (!playerId) {
      sendJson(res, 400, { error: "player_id_required" });
      return true;
    }
    const ok = game && game.adminKick ? game.adminKick(code, playerId) : false;
    if (!ok) {
      sendJson(res, 404, { error: "not_found" });
      return true;
    }
    await writeAdminLog(prisma, {
      adminId: auth.user.id,
      action: "room.kick",
      targetId: code,
      metadata: { playerId },
      ipAddress: ip
    });
    sendJson(res, 200, { ok: true });
    return true;
  }

  // —— Announcements ——
  if (pathname === "/api/v1/admin/announcements") {
    if (method(req) === "GET") {
      const auth = await requirePermission(req, res, "announcements.manage");
      if (!auth) return true;
      const items = await prisma.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
      sendJson(res, 200, { announcements: items });
      return true;
    }
    if (method(req) === "POST") {
      const auth = await requirePermission(req, res, "announcements.manage");
      if (!auth) return true;
      const body = await readJsonBody(req).catch(() => null);
      if (!body || !body.title || !body.body) {
        sendJson(res, 400, { error: "invalid_body" });
        return true;
      }
      const kind = ["info", "warning", "danger", "alert"].includes(body.kind)
        ? body.kind
        : "info";
      const personal = kind === "danger" || kind === "alert";
      let targetIds = [];
      if (personal) {
        const raw = Array.isArray(body.targetIds)
          ? body.targetIds
          : String(body.targets || "")
              .split(/[\s,;]+/)
              .map((s) => s.trim())
              .filter(Boolean);
        targetIds = [...new Set(raw.map(String))].slice(0, 50);
        if (!targetIds.length) {
          sendJson(res, 400, { error: "targets_required" });
          return true;
        }
      }
      const mode = body.mode === "schedule" ? "schedule" : body.mode === "draft" ? "draft" : "now";
      let startsAt = body.startsAt ? new Date(body.startsAt) : null;
      let endsAt = body.endsAt ? new Date(body.endsAt) : null;
      if (startsAt && Number.isNaN(startsAt.getTime())) startsAt = null;
      if (endsAt && Number.isNaN(endsAt.getTime())) endsAt = null;

      let active = !!body.active;
      if (mode === "now") {
        active = true;
        startsAt = new Date();
      } else if (mode === "schedule") {
        if (!startsAt || startsAt <= new Date()) {
          sendJson(res, 400, { error: "starts_at_required" });
          return true;
        }
        active = true;
      } else {
        active = false;
      }

      let item = await prisma.announcement.create({
        data: {
          title: String(body.title).slice(0, 160),
          body: String(body.body).slice(0, 8000),
          kind,
          targetIds: personal ? targetIds : [],
          active,
          startsAt,
          endsAt,
          createdBy: auth.user.id
        }
      });
      if (active && isDueNow(item)) {
        const published = await publishAnnouncement(prisma, item.id);
        if (published) item = published;
      }
      await writeAdminLog(prisma, {
        adminId: auth.user.id,
        action: "announcement.create",
        targetId: item.id,
        metadata: { mode, kind, active },
        ipAddress: ip
      });
      sendJson(res, 201, { announcement: item });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const annMatch = pathname.match(/^\/api\/v1\/admin\/announcements\/([^/]+)$/);
  if (annMatch) {
    const id = decodeURIComponent(annMatch[1]);
    const auth = await requirePermission(req, res, "announcements.manage");
    if (!auth) return true;
    if (method(req) === "PATCH") {
      const body = await readJsonBody(req).catch(() => null);
      if (!body) {
        sendJson(res, 400, { error: "invalid_body" });
        return true;
      }
      const data = {};
      if (body.title != null) data.title = String(body.title).slice(0, 160);
      if (body.body != null) data.body = String(body.body).slice(0, 8000);
      if (body.active != null) data.active = !!body.active;
      if (body.startsAt !== undefined) {
        const d = body.startsAt ? new Date(body.startsAt) : null;
        data.startsAt = d && !Number.isNaN(d.getTime()) ? d : null;
      }
      if (body.endsAt !== undefined) {
        const d = body.endsAt ? new Date(body.endsAt) : null;
        data.endsAt = d && !Number.isNaN(d.getTime()) ? d : null;
      }
      if (body.kind != null && ["info", "warning", "danger", "alert"].includes(body.kind)) {
        data.kind = body.kind;
      }
      if (body.targetIds != null || body.targets != null) {
        const raw = Array.isArray(body.targetIds)
          ? body.targetIds
          : String(body.targets || "")
              .split(/[\s,;]+/)
              .map((s) => s.trim())
              .filter(Boolean);
        data.targetIds = [...new Set(raw.map(String))].slice(0, 50);
      }
      let item = await prisma.announcement.update({ where: { id }, data });
      if (item.active && !item.publishedAt && isDueNow(item)) {
        const published = await publishAnnouncement(prisma, item.id);
        if (published) item = published;
      }
      await writeAdminLog(prisma, {
        adminId: auth.user.id,
        action: "announcement.update",
        targetId: id,
        metadata: data,
        ipAddress: ip
      });
      sendJson(res, 200, { announcement: item });
      return true;
    }
    if (method(req) === "DELETE") {
      await prisma.announcement.delete({ where: { id } });
      await writeAdminLog(prisma, {
        adminId: auth.user.id,
        action: "announcement.delete",
        targetId: id,
        ipAddress: ip
      });
      sendJson(res, 200, { ok: true });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  // Public active announcements (for user overview) — still under admin path? Better add public path in dashboard.
  // Handled in dashboard routes instead.

  // —— Roles & permissions ——
  if (pathname === "/api/v1/admin/roles") {
    const auth = await requirePermission(req, res, "admins.view");
    if (!auth) return true;
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const { ensurePermissionsCatalog, enrichPermission, GROUP_LABELS } = require("./permissions-catalog");
    await ensurePermissionsCatalog(prisma, { force: true });
    const roles = await prisma.role.findMany({
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { userRoles: true } }
      },
      orderBy: { name: "asc" }
    });
    const permissions = await prisma.permission.findMany({ orderBy: { name: "asc" } });
    sendJson(res, 200, {
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        userCount: r._count.userRoles,
        permissions: r.rolePermissions.map((rp) => rp.permission.name)
      })),
      permissions: permissions.map(enrichPermission),
      groups: GROUP_LABELS
    });
    return true;
  }

  const rolePermMatch = pathname.match(/^\/api\/v1\/admin\/roles\/([^/]+)\/permissions$/);
  if (rolePermMatch) {
    const auth = await requirePermission(req, res, "admins.manage");
    if (!auth) return true;
    if (method(req) !== "PUT") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const roleName = decodeURIComponent(rolePermMatch[1]);
    if (roleName === "super_admin") {
      sendJson(res, 400, { error: "cannot_edit_super_admin_perms" });
      return true;
    }
    const body = await readJsonBody(req).catch(() => null);
    if (!body || !Array.isArray(body.permissions)) {
      sendJson(res, 400, { error: "invalid_body" });
      return true;
    }
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      sendJson(res, 404, { error: "not_found" });
      return true;
    }
    const perms = await prisma.permission.findMany({
      where: { name: { in: body.permissions.map(String) } }
    });
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      for (const p of perms) {
        await tx.rolePermission.create({
          data: { roleId: role.id, permissionId: p.id }
        });
      }
    });
    await writeAdminLog(prisma, {
      adminId: auth.user.id,
      action: "role.set_permissions",
      targetId: roleName,
      metadata: { permissions: perms.map((p) => p.name) },
      ipAddress: ip
    });
    sendJson(res, 200, { ok: true, permissions: perms.map((p) => p.name) });
    return true;
  }

  // —— System ——
  if (pathname === "/api/v1/admin/system") {
    const auth = await requirePermission(req, res, "settings.view");
    if (!auth) return true;
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const mem = process.memoryUsage();
    const stats = game && game.adminStats ? game.adminStats() : {};
    const { getDbStats } = require("../system/db-stats");
    const db = await getDbStats(prisma);
    sendJson(res, 200, {
      uptimeSec: Math.floor(process.uptime()),
      node: process.version,
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal
      },
      rooms: stats,
      db
    });
    return true;
  }

  if (pathname === "/api/v1/admin/system/clear-sessions" && method(req) === "POST") {
    const auth = await requireAdmin(req, res);
    if (!auth) return true;
    if (!userHasRole(auth.user, "super_admin")) {
      sendJson(res, 403, { error: "super_admin_required" });
      return true;
    }
    const result = await prisma.session.updateMany({
      where: {
        OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { not: null } }]
      },
      data: { revokedAt: new Date() }
    });
    // Actually delete expired
    const deleted = await prisma.session.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { not: null } }]
      }
    });
    await writeAdminLog(prisma, {
      adminId: auth.user.id,
      action: "system.clear_sessions",
      metadata: { deleted: deleted.count, touched: result.count },
      ipAddress: ip
    });
    sendJson(res, 200, { deleted: deleted.count });
    return true;
  }

  if (pathname === "/api/v1/admin/system/cleanup") {
    const { cleanupStats, runCleanup } = require("../system/cleanup");
    if (method(req) === "GET") {
      const auth = await requirePermission(req, res, "settings.view");
      if (!auth) return true;
      const stats = await cleanupStats(prisma);
      sendJson(res, 200, stats);
      return true;
    }
    if (method(req) === "POST") {
      const auth = await requirePermission(req, res, "settings.manage");
      if (!auth) return true;
      const result = await runCleanup(prisma, { force: true });
      await writeAdminLog(prisma, {
        adminId: auth.user.id,
        action: "system.cleanup",
        metadata: {
          sessionsDeleted: result.sessionsDeleted || 0,
          guestsDeleted: result.guestsDeleted || 0,
          skipped: !!result.skipped
        },
        ipAddress: ip
      });
      sendJson(res, 200, result);
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  // —— Shop pts grant (test / support) ——
  if (pathname === "/api/v1/admin/shop-pts/grant" && method(req) === "POST") {
    const gate = await requireAdmin(req, res);
    if (!gate) return true;
    if (
      !userHasPermission(gate.user, "cosmetics.gift") &&
      !userHasPermission(gate.user, "settings.manage") &&
      !userHasPermission(gate.user, "users.ban")
    ) {
      sendJson(res, 403, { error: "permission_denied" });
      return true;
    }
    const body = await readJsonBody(req).catch(() => null);
    const amount = Math.floor(Number(body && body.amount) || 0);
    if (amount < 1 || amount > 1_000_000) {
      sendJson(res, 400, { error: "invalid_amount" });
      return true;
    }
    let target = null;
    if (body && body.self) {
      target = await prisma.user.findUnique({ where: { id: gate.user.id } });
    } else {
      const q = String((body && (body.q || body.username || body.userId)) || "")
        .trim()
        .slice(0, 64);
      if (!q) {
        sendJson(res, 400, { error: "invalid_user" });
        return true;
      }
      target = await prisma.user.findFirst({
        where: {
          OR: [
            { id: q },
            { username: { equals: q, mode: "insensitive" } },
            { displayName: { equals: q, mode: "insensitive" } }
          ]
        }
      });
    }
    if (!target) {
      sendJson(res, 404, { error: "user_not_found" });
      return true;
    }
    const { awardShopPts } = require("../dashboard/shop-pts");
    const result = await awardShopPts(prisma, target.id, amount, {
      reason: "admin_grant",
      adminId: gate.user.id
    });
    await writeAdminLog(prisma, {
      adminId: gate.user.id,
      action: "shop_pts.grant",
      targetId: target.id,
      metadata: { amount, balance: result && result.balance },
      ipAddress: ip
    });
    sendJson(res, 200, {
      ok: true,
      gain: amount,
      balance: result && result.balance,
      user: {
        id: target.id,
        username: target.username,
        displayName: target.displayName,
        shopPts: result && result.balance
      }
    });
    return true;
  }

  // —— Settings ——
  if (pathname === "/api/v1/admin/settings") {
    if (method(req) === "GET") {
      const auth = await requirePermission(req, res, "settings.view");
      if (!auth) return true;
      const rows = await prisma.systemSetting.findMany();
      const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      if (!settings.shop_pts) {
        const { normalizeShopPtsConfig } = require("../dashboard/shop-pts");
        settings.shop_pts = normalizeShopPtsConfig(null);
      }
      sendJson(res, 200, { settings });
      return true;
    }
    if (method(req) === "PATCH") {
      const auth = await requirePermission(req, res, "settings.manage");
      if (!auth) return true;
      const body = await readJsonBody(req).catch(() => null);
      if (!body || !body.settings || typeof body.settings !== "object") {
        sendJson(res, 400, { error: "invalid_body" });
        return true;
      }
      const before = await getSetting(prisma, "maintenance_enabled", false);
      const beforeOn = before === true || before === "true" || before === 1;
      const allowed = [
        "maintenance_enabled",
        "maintenance_message",
        "max_rooms_display",
        "game_catalog",
        "guest_cleanup_enabled",
        "guest_idle_days",
        "guest_session_days",
        "session_cleanup_enabled",
        "cleanup_interval_minutes",
        "guest_create_per_ip_hour",
        "activity_log_enabled",
        "activity_log_retention_days",
        "game_history_retention_days",
        "db_size_limit_mb",
        "shop_pts"
      ];
      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(body.settings, key)) {
          let value = body.settings[key];
          if (key === "maintenance_enabled") value = !!value;
          if (key === "maintenance_message") value = String(value || "").slice(0, 2000);
          if (key === "shop_pts") {
            const { normalizeShopPtsConfig } = require("../dashboard/shop-pts");
            value = normalizeShopPtsConfig(value);
          }
          if (key === "max_rooms_display") {
            value = Math.min(200, Math.max(1, Number(value) || 50));
          }
          if (
            key === "guest_cleanup_enabled" ||
            key === "session_cleanup_enabled" ||
            key === "activity_log_enabled"
          ) {
            value = !!value;
          }
          if (key === "guest_idle_days") value = Math.min(365, Math.max(1, Number(value) || 7));
          if (key === "guest_session_days") value = Math.min(90, Math.max(1, Number(value) || 7));
          if (key === "cleanup_interval_minutes") {
            value = Math.min(24 * 60, Math.max(5, Number(value) || 60));
          }
          if (key === "guest_create_per_ip_hour") {
            value = Math.min(1000, Math.max(0, Number(value) || 0));
          }
          if (key === "activity_log_retention_days") {
            value = Math.min(365, Math.max(1, Number(value) || 30));
          }
          if (key === "game_history_retention_days") {
            value = Math.min(365, Math.max(1, Number(value) || 30));
          }
          if (key === "db_size_limit_mb") {
            value = Math.min(1024 * 1024, Math.max(64, Number(value) || 1024));
          }
          await setSetting(prisma, key, value);
        }
      }
      invalidatePublicSettingsCache();
      try {
        const { invalidateActivityLogCache } = require("../system/activity-log");
        invalidateActivityLogCache();
      } catch {
        /* ignore */
      }
      // Force refresh so open/close server takes effect immediately
      let afterOn = beforeOn;
      try {
        const { loadPublicSettings } = require("../system/public-settings");
        const fresh = await loadPublicSettings(true);
        afterOn = !!fresh.maintenanceEnabled;
      } catch {
        /* ignore */
      }
      const gameApi = getGameApi();
      // Turning maintenance ON → countdown warning, then kick
      if (!beforeOn && afterOn) {
        const msg =
          body.settings.maintenance_message != null
            ? String(body.settings.maintenance_message || "").trim()
            : "";
        const countdownSec = Math.max(
          5,
          Math.min(180, Number(body.settings.maintenance_countdown_sec) || 15)
        );
        if (gameApi && typeof gameApi.scheduleForceMaintenance === "function") {
          try {
            gameApi.scheduleForceMaintenance(msg, countdownSec);
          } catch {
            /* ignore */
          }
        } else if (gameApi && typeof gameApi.forceMaintenance === "function") {
          try {
            gameApi.forceMaintenance(msg);
          } catch {
            /* ignore */
          }
        }
      }
      // Turning maintenance OFF → cancel pending kick countdown
      if (beforeOn && !afterOn) {
        if (gameApi && typeof gameApi.cancelScheduledMaintenance === "function") {
          try {
            gameApi.cancelScheduledMaintenance();
          } catch {
            /* ignore */
          }
        }
      }
      await writeAdminLog(prisma, {
        adminId: auth.user.id,
        action: "settings.update",
        metadata: body.settings,
        ipAddress: ip
      });
      const rows = await prisma.systemSetting.findMany();
      sendJson(res, 200, {
        settings: Object.fromEntries(rows.map((r) => [r.key, r.value]))
      });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  // —— Logs ——
  if (pathname === "/api/v1/admin/inbox") {
    const auth = await requirePermission(req, res, "users.view");
    if (!auth) return true;
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const url = new URL(req.url || "/", "http://localhost");
    const status = (url.searchParams.get("status") || "").trim();
    const take = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 80) || 80));
    const where = {};
    if (status && ["open", "read", "closed"].includes(status)) where.status = status;
    const [messages, openCount] = await Promise.all([
      prisma.contactMessage.findMany({
        where,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, displayName: true, username: true, accountType: true } }
        }
      }),
      prisma.contactMessage.count({ where: { status: "open" } })
    ]);
    sendJson(res, 200, { messages, openCount });
    return true;
  }

  if (pathname === "/api/v1/admin/inbox/clear") {
    const auth = await requirePermission(req, res, "users.view");
    if (!auth) return true;
    if (method(req) !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const body = await readJsonBody(req).catch(() => null);
    const scope = String((body && body.scope) || "closed");
    const where =
      scope === "all"
        ? {}
        : scope === "read"
          ? { status: { in: ["read", "closed"] } }
          : { status: "closed" };
    const result = await prisma.contactMessage.deleteMany({ where });
    await writeAdminLog(prisma, {
      adminId: auth.user.id,
      action: "inbox.clear",
      targetId: null,
      metadata: { scope, deleted: result.count },
      ipAddress: ip
    });
    sendJson(res, 200, { ok: true, deleted: result.count });
    return true;
  }

  const inboxMatch = pathname.match(/^\/api\/v1\/admin\/inbox\/([^/]+)$/);
  if (inboxMatch) {
    const auth = await requirePermission(req, res, "users.view");
    if (!auth) return true;
    const id = inboxMatch[1];
    if (method(req) === "DELETE") {
      const existing = await prisma.contactMessage.findUnique({ where: { id } });
      if (!existing) {
        sendJson(res, 404, { error: "not_found" });
        return true;
      }
      await prisma.contactMessage.delete({ where: { id } });
      await writeAdminLog(prisma, {
        adminId: auth.user.id,
        action: "inbox.delete",
        targetId: id,
        metadata: { userId: existing.userId || null, subject: existing.subject || null },
        ipAddress: ip
      });
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method(req) === "PATCH") {
      const body = await readJsonBody(req).catch(() => null);
      if (!body) {
        sendJson(res, 400, { error: "invalid_body" });
        return true;
      }

      // Admin reply → notify user (popup-readable)
      if (Object.prototype.hasOwnProperty.call(body, "reply")) {
        const reply = String(body.reply || "").trim().slice(0, 2000);
        if (reply.length < 2) {
          sendJson(res, 400, { error: "invalid_reply" });
          return true;
        }
        const existing = await prisma.contactMessage.findUnique({ where: { id } });
        if (!existing) {
          sendJson(res, 404, { error: "not_found" });
          return true;
        }
        const row = await prisma.contactMessage.update({
          where: { id },
          data: {
            adminReply: reply,
            repliedAt: new Date(),
            repliedById: auth.user.id,
            status: "read",
            readAt: existing.readAt || new Date()
          },
          include: {
            user: { select: { id: true, displayName: true, username: true, accountType: true } }
          }
        });
        if (existing.userId) {
          const preview = reply.length > 140 ? reply.slice(0, 140) + "…" : reply;
          await prisma.notification.create({
            data: {
              userId: existing.userId,
              type: "admin_reply",
              title: "แอดมินตอบกลับ",
              body: preview,
              payload: {
                contactId: existing.id,
                subject: existing.subject || "ติดต่อแอดมิน",
                fullBody: reply,
                originalMessage: existing.message
              }
            }
          });
          const gameApi = getGameApi();
          if (gameApi && typeof gameApi.notifyUser === "function") {
            try {
              gameApi.notifyUser(existing.userId, { type: "admin_reply" });
            } catch {
              /* ignore */
            }
          }
        }
        await writeAdminLog(prisma, {
          adminId: auth.user.id,
          action: "inbox.reply",
          targetId: id,
          metadata: { userId: existing.userId || null },
          ipAddress: ip
        });
        sendJson(res, 200, { message: row });
        return true;
      }

      const next = body.status;
      if (!["open", "read", "closed"].includes(next)) {
        sendJson(res, 400, { error: "invalid_status" });
        return true;
      }
      const data = { status: next };
      if (next === "read" || next === "closed") data.readAt = new Date();
      if (next === "open") data.readAt = null;
      const row = await prisma.contactMessage.update({
        where: { id },
        data,
        include: {
          user: { select: { id: true, displayName: true, username: true, accountType: true } }
        }
      });
      await writeAdminLog(prisma, {
        adminId: auth.user.id,
        action: "inbox.set_status",
        targetId: id,
        metadata: { status: next },
        ipAddress: ip
      });
      sendJson(res, 200, { message: row });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  if (pathname === "/api/v1/admin/logs") {
    const auth = await requirePermission(req, res, "logs.view");
    if (!auth) return true;
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const url = new URL(req.url || "/", "http://localhost");
    const action = (url.searchParams.get("action") || "").trim();
    const take = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50) || 50));
    const where = {};
    if (action) where.action = { contains: action };
    const logs = await prisma.adminLog.findMany({
      where,
      take,
      orderBy: { createdAt: "desc" },
      include: {
        admin: { select: { id: true, displayName: true, username: true } }
      }
    });
    sendJson(res, 200, { logs });
    return true;
  }

  if (pathname === "/api/v1/admin/activity-logs") {
    const auth = await requirePermission(req, res, "logs.view");
    if (!auth) return true;
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const url = new URL(req.url || "/", "http://localhost");
    const action = (url.searchParams.get("action") || "").trim();
    const q = (url.searchParams.get("q") || "").trim().slice(0, 64);
    const take = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 80) || 80));
    const where = {};
    if (action) where.action = action;
    if (q) {
      where.user = {
        OR: [
          { username: { contains: q, mode: "insensitive" } },
          { displayName: { contains: q, mode: "insensitive" } }
        ]
      };
    }
    const [logs, total] = await Promise.all([
      prisma.userActivityLog.findMany({
        where,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, displayName: true, username: true, accountType: true } }
        }
      }),
      prisma.userActivityLog.count({ where })
    ]);
    sendJson(res, 200, { logs, total });
    return true;
  }

  // —— Me (admin context) ——
  if (pathname === "/api/v1/admin/me") {
    const auth = await requireAdmin(req, res);
    if (!auth) return true;
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    let refreshed = false;
    try {
      const { ensurePermissionsCatalog } = require("./permissions-catalog");
      const result = await ensurePermissionsCatalog(prisma);
      refreshed = !!(result && result.refreshed);
    } catch {
      /* ignore */
    }
    // Reload user only when catalog actually changed (ปกติแคช hit = เร็ว)
    let meUser = auth.user;
    if (refreshed) {
      const fresh = await prisma.user.findUnique({
        where: { id: auth.user.id },
        include: {
          userRoles: {
            include: {
              role: {
                include: { rolePermissions: { include: { permission: true } } }
              }
            }
          }
        }
      });
      if (fresh) meUser = fresh;
    }
    sendJson(res, 200, {
      user: publicUser(meUser),
      permissions: permissionsOf(meUser)
    });
    return true;
  }

  sendJson(res, 404, { error: "not_found" });
  return true;
}

module.exports = { handleAdminApi };
