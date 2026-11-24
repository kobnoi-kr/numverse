"use strict";

const { authEnabled, getPrisma } = require("../db");
const { sendJson, readJsonBody, clientIp } = require("../auth/http");
const { requireAuth, requireAdmin, resolveAuth, isAdminUser } = require("../auth/middleware");
const {
  loadPublicSettings,
  getMaintenanceState,
  userBypassesMaintenance
} = require("../system/public-settings");

/** Opt-in only — user dashboard APIs are public to signed-in/guest sessions by default. */
const DASHBOARD_ADMIN_ONLY = process.env.DASHBOARD_ADMIN_ONLY === "1";
const { rateLimit } = require("../auth/rate-limit");
const { getGameApi } = require("./bridge");
const { listAcceptedFriendIds, friendshipRelation } = require("../auth/friends");
const { rankingWindow } = require("./ranking-period");
const { handleCosmeticsApi, publicCosmetic } = require("./cosmetics");
const { handleLevelsApi } = require("./levels");
const { handleInventoryApi } = require("./inventory");

const GAME_CATALOG = [
  {
    id: "secret",
    slug: "secret",
    name: "หาเลข",
    nameEn: "Don't Get The Secret",
    category: "numbers",
    categoryLabel: "ตัวเลข",
    maxPlayers: 12,
    description: "ห้ามโดนเลขลับ — ทายช่วงและหลบเลขที่ถูกสุ่มไว้",
    howTo: "ตั้งช่วงตัวเลข แล้วผลัดกันเลือกเลข ใครโดนเลขลับจะแพ้รอบนั้น สะสมแต้มจนถึงเป้าชนะ",
    popular: true
  },
  {
    id: "wheel",
    slug: "wheel",
    name: "วงล้อ",
    nameEn: "Number Wheel",
    category: "wheel",
    categoryLabel: "วงล้อ",
    maxPlayers: 12,
    description: "หมุนวงล้อสุ่มเลข ใครโดนเลขของตัวเองจะออกจากเกม",
    howTo: "ผู้เล่นได้รับเลขของตัวเอง หมุนวงล้อทีละครั้ง ถ้าวงล้อชี้เลขของคุณจะตกรอบ คนสุดท้ายที่เหลือชนะ",
    popular: true
  },
  {
    id: "snake",
    slug: "snake",
    name: "บันไดงู",
    nameEn: "Snake & Ladders",
    category: "board",
    categoryLabel: "กระดาน",
    maxPlayers: 6,
    description: "ทอยลูกเต๋า ปีนบันได เลี่ยงงู — ใครถึงช่อง 100 ก่อนชนะ",
    howTo:
      "โฮสต์เลือกแมพได้หลายแบบ (งู/บันไดคนละตำแหน่ง) แล้วผลัดกันทอยลูกเต๋า 1–6 เจอบันไดขึ้น เจองูลง ต้องทอยพอดีถึง 100 — เปิดเล่นอัตโนมัติได้ สูงสุด 6 คน",
    popular: true,
    beta: true
  },
  {
    id: "imposter",
    slug: "imposter",
    name: "Imposter",
    nameEn: "Find the Imposter",
    category: "social",
    categoryLabel: "สืบหา",
    maxPlayers: 8,
    description: "หาคนที่เป็น Imposter — คุย โหวต และจับคนร้ายก่อนสายเกินแก้",
    howTo:
      "ผู้เล่น 4–8 คน จั่วการ์ดปิดตาทีละคน ได้บทบาททีมปกติหรือ Imposter\nทีมปกติเห็นคำศัพท์ Imposter ไม่เห็นคำ หรือเห็นแค่หมวด ถ้าโฮสต์เปิดไว้\nจากนั้นให้คำใบ้ทีละคน วนจากคนแรกถึงคนท้ายตามจำนวนรอบที่ตั้ง ห้ามพิมพ์คำศัพท์ตรงๆ ข้ามตาได้\nครบรอบแล้วคุยในแชทช่วง Discussion แล้วโหวตครั้งเดียว โหวตตัวเองไม่ได้\nโหวตผิด โหวตเสมอ หรือ Imposter เหลือเท่ากับหรือมากกว่าทีมปกติ ฝ่าย Imposter ชนะ\nจับ Imposter คนสุดท้ายได้ ต้องทายคำใน 30 วินาที ทายถูก Imposter ชนะ ทายผิดหรือหมดเวลาทีมปกติชนะ\nถ้ายังเหลือ Imposter อีกคน จะเริ่มให้คำใบ้รอบใหม่\nการ์ดนางฟ้าใช้ในเกมนี้ไม่ได้",
    popular: false,
    beta: false,
    comingSoon: true
  },
  {
    id: "race2048",
    slug: "race2048",
    name: "2048 Race",
    nameEn: "2048 Race",
    category: "puzzle",
    categoryLabel: "พัซเซิล",
    maxPlayers: 8,
    description: "แข่งรวมเลขแบบ 2048 — ใครถึงเป้าก่อนหรือได้คะแนนสูงสุดชนะ",
    howTo:
      "เลื่อนแผ่นตัวเลขรวมคู่ที่เหมือนกัน แข่งกับผู้เล่นคนอื่นแบบเรียลไทม์ — รายละเอียดกติกาจะเปิดพร้อมตัวเกม",
    popular: false,
    beta: false,
    comingSoon: true
  },
  {
    id: "cardmemory",
    slug: "cardmemory",
    name: "Card Memory",
    nameEn: "Card Memory",
    category: "memory",
    categoryLabel: "ความจำ",
    maxPlayers: 8,
    description: "พลิกไพ่จับคู่ — จำตำแหน่งให้แม่น ใครจับคู่ได้มากสุดชนะ",
    howTo:
      "ผู้เล่น 2–8 คน เปิดการ์ดทีละ 2 ใบ จำตำแหน่งแล้วจับคู่ภาพที่เหมือนกัน\nจับคู่ถูกได้คะแนน จับคู่ผิดการ์ดจะคว่ำกลับแล้วเปลี่ยนเทิร์น\nโฮสต์เลือกขนาดกระดาน เวลาต่อเทิร์น คะแนนต่อคู่ และกติกาเปลี่ยนเทิร์นได้\nจับคู่ครบแล้วคนคะแนนสูงสุดชนะ",
    popular: false,
    beta: false,
    comingSoon: true
  },
  {
    id: "werewolf",
    slug: "werewolf",
    name: "Werewolf",
    nameEn: "Werewolf",
    category: "social",
    categoryLabel: "สืบหา",
    maxPlayers: 8,
    description: "หมู่บ้านแห่งความลับ — หาหมาป่าก่อนที่หมู่บ้านจะพัง",
    howTo:
      "ผู้เล่น 5–8 คน ได้บทบาทลับ: หมาป่า ชาวบ้าน ผู้หยั่งรู้ แม่มด ผู้พิทักษ์ นักล่า\nกลางคืนใช้ความสามารถตามบทบาท กลางวันคุยและโหวตกำจัดผู้ต้องสงสัย\nฝ่ายหมู่บ้านชนะเมื่อหมาป่าถูกกำจัดครบ ฝ่ายหมาป่าชนะเมื่อจำนวนหมาป่าไม่น้อยกว่าฝ่ายตรงข้าม\nการ์ดนางฟ้าใช้ในเกมนี้ไม่ได้",
    popular: false,
    beta: false,
    comingSoon: true
  }
];

function method(req) {
  return String(req.method || "GET").toUpperCase();
}

function tooMany(res, sec) {
  sendJson(res, 429, { error: "rate_limited", retryAfterSec: sec });
}

async function optionalUser(req) {
  if (!authEnabled()) return null;
  const auth = await resolveAuth(req);
  return auth && auth.user ? auth.user : null;
}

function emptyStats() {
  return {
    totalGames: 0,
    gamesWon: 0,
    gamesLost: 0,
    winRate: 0,
    totalPoints: 0,
    averageRank: null,
    playTimeSec: 0,
    bestWinStreak: 0,
    currentWinStreak: 0,
    favoriteMode: null
  };
}

async function statsForUser(userId) {
  if (!authEnabled() || !userId) return emptyStats();
  const prisma = await getPrisma();
  const row = await prisma.playerStatistics.findUnique({ where: { userId } });
  if (!row) return emptyStats();
  const winRate = row.totalGames ? Math.round((row.gamesWon / row.totalGames) * 100) : 0;
  const averageRank = row.totalGames ? Math.round((row.rankSum / row.totalGames) * 10) / 10 : null;
  return {
    totalGames: row.totalGames,
    gamesWon: row.gamesWon,
    gamesLost: row.gamesLost,
    winRate,
    totalPoints: row.totalPoints,
    averageRank,
    playTimeSec: row.playTimeSec,
    bestWinStreak: row.bestWinStreak,
    currentWinStreak: row.currentWinStreak,
    favoriteMode: row.favoriteMode
  };
}

async function handleDashboardApi(req, res, pathname) {
  const game = getGameApi();
  if (pathname.startsWith("/api/v1/cosmetics") || pathname.startsWith("/api/v1/shop/")) {
    return handleCosmeticsApi(req, res, pathname);
  }
  if (pathname.startsWith("/api/v1/inventory")) {
    return handleInventoryApi(req, res, pathname);
  }
  if (pathname.startsWith("/api/v1/levels")) {
    return handleLevelsApi(req, res, pathname);
  }
  const isDashPath =
    pathname.startsWith("/api/v1/dashboard") ||
    pathname.startsWith("/api/v1/rooms") ||
    pathname.startsWith("/api/v1/live-games") ||
    pathname.startsWith("/api/v1/history") ||
    pathname.startsWith("/api/v1/stats") ||
    pathname.startsWith("/api/v1/leaderboard") ||
    pathname.startsWith("/api/v1/settings") ||
    pathname.startsWith("/api/v1/notifications") ||
    pathname.startsWith("/api/v1/announcements") ||
    pathname.match(/^\/api\/v1\/users\/[^/]+\/public$/);

  if (pathname === "/api/v1/system/status") {
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const settings = await loadPublicSettings();
    const maint = await getMaintenanceState();
    let bypass = false;
    if (maint.enabled) {
      const user = await optionalUser(req);
      if (user && isAdminUser(user)) bypass = true;
      else if (user && (await userBypassesMaintenance(user.id))) bypass = true;
    }
    sendJson(res, 200, {
      maintenance: {
        enabled: maint.enabled,
        message: maint.message,
        bypass
      },
      maxRoomsDisplay: settings.maxRoomsDisplay
    });
    return true;
  }

  if (DASHBOARD_ADMIN_ONLY && isDashPath) {
    const admin = await requireAdmin(req, res);
    if (!admin) return true;
  }

  if (pathname === "/api/v1/games/catalog") {
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    let flags = null;
    let playableSoon = new Set();
    const user = await optionalUser(req);
    if (authEnabled()) {
      try {
        const prisma = await getPrisma();
        const row = await prisma.systemSetting.findUnique({ where: { key: "game_catalog" } });
        if (row && row.value) flags = row.value;
        const { listPlayableComingSoonIds } = require("./game-catalog-flags");
        const roleNames = user
          ? Array.isArray(user.roles) && user.roles.length
            ? user.roles
            : (user.userRoles || []).map((ur) => ur.role && ur.role.name).filter(Boolean)
          : [];
        const ids = await listPlayableComingSoonIds(prisma, {
          roles: roleNames,
          isAdmin: !!(user && isAdminUser(user)),
          userId: user && user.id
        });
        playableSoon = new Set(ids);
      } catch {
        flags = null;
      }
    }
    const games = GAME_CATALOG.filter((g) => {
      if (!flags || !flags[g.id]) return true;
      return flags[g.id].enabled !== false;
    }).map((g) => {
      const override = flags && flags[g.id];
      const out = Object.assign({}, g);
      if (override && override.name) out.name = override.name;
      if (override && Object.prototype.hasOwnProperty.call(override, "beta")) {
        out.beta = !!override.beta;
      } else if (typeof g.beta === "boolean") {
        out.beta = g.beta;
      } else {
        out.beta = false;
      }
      if (override && Object.prototype.hasOwnProperty.call(override, "comingSoon")) {
        out.comingSoon = !!override.comingSoon;
      } else if (typeof g.comingSoon === "boolean") {
        out.comingSoon = g.comingSoon;
      } else {
        out.comingSoon = false;
      }
      out.canPlay = !out.comingSoon || playableSoon.has(g.id);
      out.testInvite = !!(out.comingSoon && playableSoon.has(g.id));
      return out;
    });
    sendJson(res, 200, { games });
    return true;
  }

  if (pathname === "/api/v1/announcements/active") {
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (!authEnabled()) {
      sendJson(res, 200, { announcements: [] });
      return true;
    }
    const prisma = await getPrisma();
    const auth = await resolveAuth(req);
    const user = auth && auth.user ? auth.user : null;
    const now = new Date();
    const items = await prisma.announcement.findMany({
      where: {
        active: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }
        ]
      },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        title: true,
        body: true,
        kind: true,
        targetIds: true,
        createdAt: true
      }
    });
    const keys = new Set();
    if (user) {
      keys.add(String(user.id).toLowerCase());
      if (user.username) keys.add(String(user.username).toLowerCase());
      if (user.friendCode) keys.add(String(user.friendCode).toLowerCase());
      if (user.displayName) keys.add(String(user.displayName).toLowerCase());
    }
    const filtered = items.filter((a) => {
      const kind = a.kind || "info";
      const personal = kind === "danger" || kind === "alert";
      if (!personal) return true;
      if (!user) return false;
      const targets = Array.isArray(a.targetIds) ? a.targetIds : [];
      if (!targets.length) return false;
      return targets.some((t) => keys.has(String(t || "").trim().toLowerCase()));
    });
    sendJson(res, 200, {
      announcements: filtered.slice(0, 8).map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        kind: a.kind || "info",
        createdAt: a.createdAt
      }))
    });
    return true;
  }

  if (pathname === "/api/v1/dashboard" || pathname === "/api/v1/dashboard/summary") {
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const user = await optionalUser(req);
    let roomsCreated = 0;
    let lastGame = null;
    let stats = emptyStats();
    if (user && authEnabled()) {
      const prisma = await getPrisma();
      const [statsRow, hostedCount, latest] = await Promise.all([
        statsForUser(user.id),
        prisma.game
          .count({
            where: { metadata: { path: ["hostUserId"], equals: user.id } }
          })
          .catch(() => 0),
        // Per-user last finished match (not shared / not "create preference")
        prisma.game
          .findFirst({
            where: {
              endedAt: { not: null },
              players: { some: { userId: user.id } }
            },
            orderBy: { endedAt: "desc" },
            include: {
              players: { where: { userId: user.id }, take: 1 }
            }
          })
          .catch(() => null)
      ]);
      stats = statsRow;
      roomsCreated = Number(hostedCount) || 0;
      if (latest) {
        const me = Array.isArray(latest.players) ? latest.players[0] : null;
        lastGame = {
          roomName: latest.roomName,
          gameMode: latest.gameMode,
          endedAt: latest.endedAt,
          won: !!(me && me.won),
          points: me ? me.points : 0
        };
      }
    }
    const playHours = Math.round(((stats.playTimeSec || 0) / 3600) * 10) / 10;
    sendJson(res, 200, {
      user: user
        ? {
            id: user.id,
            displayName: user.displayName,
            accountType: user.accountType,
            roles: (user.userRoles || []).map((ur) => ur.role && ur.role.name).filter(Boolean)
          }
        : null,
      stats: Object.assign({}, stats, { roomsCreated, playHours }),
      lastGame
    });
    return true;
  }

  if (pathname === "/api/v1/dashboard/activity") {
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const user = await optionalUser(req);
    if (!user || !authEnabled()) {
      sendJson(res, 200, { items: [] });
      return true;
    }
    const prisma = await getPrisma();
    const rows = await prisma.gamePlayer.findMany({
      where: { userId: user.id },
      orderBy: { game: { endedAt: "desc" } },
      take: 8,
      include: { game: true }
    });
    sendJson(res, 200, {
      items: rows.map((r) => ({
        title: r.game.roomName,
        subtitle:
          (r.game.gameMode === "wheel"
            ? "วงล้อ"
            : r.game.gameMode === "snake"
              ? "บันไดงู"
              : r.game.gameMode === "imposter"
                ? "Imposter"
                : r.game.gameMode === "cardmemory"
                  ? "Memory Card"
                  : r.game.gameMode === "werewolf"
                    ? "Werewolf"
                    : "หาเลข") +
          " · " +
          (r.won ? "ชนะ" : "เล่น") +
          " · #" +
          r.rank +
          " · " +
          r.points +
          " pts",
        gameMode: r.game.gameMode,
        when: r.game.endedAt ? new Date(r.game.endedAt).toLocaleString() : ""
      }))
    });
    return true;
  }

  if (pathname === "/api/v1/rooms/active") {
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const user = await optionalUser(req);
    const seat = user && game && typeof game.findActiveSeat === "function"
      ? game.findActiveSeat(user.id)
      : null;
    sendJson(res, 200, { active: seat || null });
    return true;
  }

  if (pathname === "/api/v1/rooms/mine") {
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const user = await optionalUser(req);
    const revealPrivate = !!(user && isAdminUser(user));
    const live = (game ? game.listLobbyRooms({ revealPrivate }) : []).filter((r) => r.joinable || r.phase !== "over");
    let created = [];
    if (user && authEnabled()) {
      const prisma = await getPrisma();
      const rows = await prisma.game.findMany({
        where: { metadata: { path: ["hostUserId"], equals: user.id } },
        orderBy: { endedAt: "desc" },
        take: 20
      }).catch(() => []);
      created = rows.map((g) => ({
        id: g.id,
        code: g.roomCode,
        title: g.roomName,
        gameMode: g.gameMode,
        visibility: g.visibility,
        playerCount: g.playerCount,
        endedAt: g.endedAt
      }));
    }
    sendJson(res, 200, { live, created });
    return true;
  }

  if (pathname === "/api/v1/rooms/public") {
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const rooms = game ? game.listLobbyRooms() : [];
    sendJson(res, 200, { rooms });
    return true;
  }

  if (pathname === "/api/v1/rooms/quick-play") {
    if (method(req) !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    {
      const maint = await getMaintenanceState();
      if (maint.enabled) {
        const user = await optionalUser(req);
        const bypass = user && (isAdminUser(user) || (await userBypassesMaintenance(user.id)));
        if (!bypass) {
          sendJson(res, 503, { error: "maintenance", message: maint.message });
          return true;
        }
      }
    }
    const rl = rateLimit("qp:" + clientIp(req), 30, 60_000);
    if (!rl.ok) {
      tooMany(res, rl.retryAfterSec);
      return true;
    }
    const room = game ? game.findQuickPlayRoom() : null;
    if (!room) {
      sendJson(res, 404, { error: "no_room" });
      return true;
    }
    sendJson(res, 200, { code: room.code, title: room.title });
    return true;
  }

  if (pathname === "/api/v1/rooms") {
    if (method(req) !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const rl = rateLimit("room:" + clientIp(req), 20, 60_000);
    if (!rl.ok) {
      tooMany(res, rl.retryAfterSec);
      return true;
    }
    if (!game) {
      sendJson(res, 503, { error: "game_unavailable" });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "invalid_json" });
      return true;
    }
    const user = await optionalUser(req);
    {
      const maint = await getMaintenanceState();
      if (maint.enabled) {
        const bypass = user && (isAdminUser(user) || (await userBypassesMaintenance(user.id)));
        if (!bypass) {
          sendJson(res, 503, { error: "maintenance", message: maint.message });
          return true;
        }
      }
    }
    const token = (user && user.id) || String(body.token || "");
    const name = String(body.displayName || body.name || (user && user.displayName) || "").trim().slice(0, 24);
    const created = await game.createRoomHttp({
      visibility: body.visibility === "private" ? "private" : "public",
      title: body.title || "",
      token: token || undefined,
      name: name || "Player",
      avatarUrl: (user && user.avatarUrl) || body.avatarUrl || "",
      setup: body.setup || {}
    });
    if (!created) {
      sendJson(res, 500, { error: "create_failed" });
      return true;
    }
    if (created.error === "coming_soon") {
      sendJson(res, 403, {
        error: "coming_soon",
        message: "เกมนี้ Coming Soon — ต้องได้รับคำเชิญทดสอบจากแอดมิน"
      });
      return true;
    }
    sendJson(res, 201, created);
    return true;
  }

  if (pathname === "/api/v1/rooms/join") {
    if (method(req) !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "invalid_json" });
      return true;
    }
    {
      const maint = await getMaintenanceState();
      if (maint.enabled) {
        const user = await optionalUser(req);
        const bypass = user && (isAdminUser(user) || (await userBypassesMaintenance(user.id)));
        if (!bypass) {
          sendJson(res, 503, { error: "maintenance", message: maint.message });
          return true;
        }
      }
    }
    const code = String(body.code || "").replace(/\D/g, "").slice(0, 6);
    if (!game) {
      sendJson(res, 503, { error: "game_unavailable" });
      return true;
    }
    const info = game.inspectRoom(code);
    if (!info) {
      sendJson(res, 404, { error: "not_found" });
      return true;
    }
    if (!info.joinable) {
      sendJson(res, 409, { error: info.phase === "lobby" ? "full" : "already_started" });
      return true;
    }
    sendJson(res, 200, { code: info.code, title: info.title });
    return true;
  }

  if (pathname === "/api/v1/live-games") {
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const user = await optionalUser(req);
    const revealPrivate = !!(user && isAdminUser(user));
    sendJson(res, 200, { games: game ? game.listLiveGames({ revealPrivate }) : [] });
    return true;
  }

  const liveWatch = pathname.match(/^\/api\/v1\/live-games\/([^/]+)\/watch$/);
  if (liveWatch) {
    sendJson(res, 200, { ok: true, hint: "open /play?watch=1&code=" + liveWatch[1] });
    return true;
  }

  if (pathname === "/api/v1/history") {
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (!authEnabled()) {
      sendJson(res, 200, { items: [] });
      return true;
    }
    const auth = await requireAuth(req, res);
    if (!auth) return true;
    const prisma = await getPrisma();
    const rows = await prisma.gamePlayer.findMany({
      where: { userId: auth.user.id },
      orderBy: { game: { endedAt: "desc" } },
      take: 50,
      include: { game: true }
    });
    sendJson(res, 200, {
      items: rows.map((r) => ({
        id: r.gameId,
        roomName: r.game.roomName,
        gameMode: r.game.gameMode,
        result: r.won ? "Win" : "Played",
        rank: r.rank,
        pointsEarned: r.points,
        startedAt: r.game.startedAt,
        endedAt: r.game.endedAt,
        duration: r.game.durationSec,
        playerCount: r.game.playerCount
      }))
    });
    return true;
  }

  const histOne = pathname.match(/^\/api\/v1\/history\/([0-9a-f-]{36})$/i);
  if (histOne) {
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (!authEnabled()) {
      sendJson(res, 404, { error: "not_found" });
      return true;
    }
    const auth = await requireAuth(req, res);
    if (!auth) return true;
    const prisma = await getPrisma();
    const gameRow = await prisma.game.findUnique({
      where: { id: histOne[1] },
      include: { players: { orderBy: { rank: "asc" } } }
    });
    if (!gameRow || !gameRow.players.some((p) => p.userId === auth.user.id)) {
      sendJson(res, 404, { error: "not_found" });
      return true;
    }
    sendJson(res, 200, { game: gameRow });
    return true;
  }

  if (pathname === "/api/v1/stats/me" || pathname === "/api/v1/stats/me/performance") {
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const user = await optionalUser(req);
    sendJson(res, 200, { stats: user ? await statsForUser(user.id) : emptyStats() });
    return true;
  }

  const lb = pathname.match(/^\/api\/v1\/leaderboard\/(global|weekly|monthly|friends)$/);
  if (lb) {
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (!authEnabled()) {
      sendJson(res, 200, { period: lb[1], sort: "points", rows: [], me: null });
      return true;
    }
    const prisma = await getPrisma();
    const user = await optionalUser(req);
    const period = lb[1];
    const url = new URL(req.url || "/", "http://localhost");
    const sortRaw = String(url.searchParams.get("sort") || "points").toLowerCase();
    const sort = ["points", "wins", "winrate", "games"].includes(sortRaw)
      ? sortRaw === "winrate"
        ? "winRate"
        : sortRaw
      : "points";
    const take = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50) || 50));

    // Period boards: calendar week/month in Asia/Bangkok (registered only).
    if (period === "weekly" || period === "monthly") {
      const window = rankingWindow(period);
      const since = window.since;
      const players = await prisma.gamePlayer.findMany({
        where: {
          userId: { not: null },
          user: { accountType: "registered", status: "active" },
          game: { endedAt: { gte: since, lt: window.resetsAt } }
        },
        select: {
          userId: true,
          points: true,
          won: true,
          user: { select: { id: true, displayName: true, avatarUrl: true } }
        }
      });
      const byUser = new Map();
      for (const p of players) {
        if (!p.userId || !p.user) continue;
        let row = byUser.get(p.userId);
        if (!row) {
          row = {
            userId: p.userId,
            displayName: p.user.displayName,
            avatarUrl: p.user.avatarUrl,
            totalPoints: 0,
            gamesWon: 0,
            totalGames: 0
          };
          byUser.set(p.userId, row);
        }
        row.totalPoints += Number(p.points) || 0;
        row.totalGames += 1;
        if (p.won) row.gamesWon += 1;
      }
      const ranked = Array.from(byUser.values()).map((r) => ({
        ...r,
        winRate: r.totalGames ? Math.round((r.gamesWon / r.totalGames) * 100) : 0
      }));
      ranked.sort((a, b) => {
        if (sort === "wins") {
          if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;
          if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
          return b.totalGames - a.totalGames;
        }
        if (sort === "winRate") {
          if (b.winRate !== a.winRate) return b.winRate - a.winRate;
          if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;
          return b.totalGames - a.totalGames;
        }
        if (sort === "games") {
          if (b.totalGames !== a.totalGames) return b.totalGames - a.totalGames;
          if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
          return b.gamesWon - a.gamesWon;
        }
        // points (default)
        if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
        if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;
        return b.totalGames - a.totalGames;
      });
      const rows = ranked.slice(0, take).map((r, i) => ({
        rank: i + 1,
        userId: r.userId,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
        totalPoints: r.totalPoints,
        gamesWon: r.gamesWon,
        totalGames: r.totalGames,
        winRate: r.winRate
      }));
      let me = null;
      if (user && user.accountType === "registered") {
        const idx = ranked.findIndex((r) => r.userId === user.id);
        if (idx >= 0) {
          const r = ranked[idx];
          me = {
            rank: idx + 1,
            userId: r.userId,
            displayName: r.displayName,
            avatarUrl: r.avatarUrl,
            totalPoints: r.totalPoints,
            gamesWon: r.gamesWon,
            totalGames: r.totalGames,
            winRate: r.winRate
          };
        } else {
          me = {
            rank: null,
            userId: user.id,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl || null,
            totalPoints: 0,
            gamesWon: 0,
            totalGames: 0,
            winRate: 0
          };
        }
      }
      sendJson(res, 200, {
        period,
        sort,
        rows,
        me,
        since: since.toISOString(),
        resetsAt: window.resetsAt.toISOString(),
        timezone: window.timezone,
        label: window.label
      });
      return true;
    }

    // Legacy lifetime boards (global / friends) — registered stats only.
    let where = { user: { accountType: "registered", status: "active" } };
    if (period === "friends" && user) {
      const friendIds = await listAcceptedFriendIds(prisma, user.id);
      friendIds.push(user.id);
      where = { userId: { in: friendIds }, user: { accountType: "registered", status: "active" } };
    }
    const rowsRaw = await prisma.playerStatistics.findMany({
      where,
      orderBy: [{ totalPoints: "desc" }, { gamesWon: "desc" }],
      take,
      include: { user: { select: { id: true, displayName: true, avatarUrl: true, accountType: true } } }
    });
    const rows = rowsRaw
      .filter((r) => r.user && r.user.accountType === "registered")
      .map((r, i) => ({
        rank: i + 1,
        userId: r.userId,
        displayName: r.user.displayName,
        avatarUrl: r.user.avatarUrl,
        totalPoints: r.totalPoints,
        gamesWon: r.gamesWon,
        totalGames: r.totalGames,
        winRate: r.totalGames ? Math.round((r.gamesWon / r.totalGames) * 100) : 0
      }));
    let me = null;
    if (user && user.accountType === "registered") {
      const mine = rows.find((r) => r.userId === user.id);
      if (mine) me = mine;
      else {
        const st = await statsForUser(user.id);
        me = {
          rank: null,
          userId: user.id,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl || null,
          totalPoints: st.totalPoints,
          gamesWon: st.gamesWon,
          totalGames: st.totalGames,
          winRate: st.winRate
        };
      }
    }
    sendJson(res, 200, { period, sort: "points", rows, me });
    return true;
  }

  if (pathname === "/api/v1/settings") {
    if (!authEnabled()) {
      if (method(req) === "GET") {
        sendJson(res, 200, { settings: { language: "th", theme: "dark", preferences: {} } });
        return true;
      }
      sendJson(res, 503, { error: "auth_disabled" });
      return true;
    }
    const auth = await requireAuth(req, res);
    if (!auth) return true;
    const prisma = await getPrisma();
    if (method(req) === "GET") {
      let settings = await prisma.userSettings.findUnique({ where: { userId: auth.user.id } });
      if (!settings) {
        settings = await prisma.userSettings.create({
          data: { userId: auth.user.id, language: "th", theme: "dark", preferences: {} }
        });
      }
      const { normalizeNotifPrefs } = require("./notify");
      const preferences = Object.assign({}, settings.preferences || {});
      preferences.notifications = normalizeNotifPrefs(preferences.notifications);
      sendJson(res, 200, {
        settings: Object.assign({}, settings, { preferences })
      });
      return true;
    }
    if (method(req) === "PATCH") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: "invalid_json" });
        return true;
      }
      const current = await prisma.userSettings.findUnique({ where: { userId: auth.user.id } });
      const prevPref = (current && current.preferences) || {};
      const incoming = (body && body.preferences) || {};
      const { normalizeNotifPrefs } = require("./notify");
      const nextPref = Object.assign({}, prevPref, incoming);
      if (incoming.notifications && typeof incoming.notifications === "object") {
        nextPref.notifications = normalizeNotifPrefs(
          Object.assign({}, prevPref.notifications || {}, incoming.notifications)
        );
      }
      const settings = await prisma.userSettings.upsert({
        where: { userId: auth.user.id },
        create: {
          userId: auth.user.id,
          language: body.language || "th",
          theme: body.theme || "dark",
          preferences: nextPref
        },
        update: {
          language: body.language || undefined,
          theme: body.theme || undefined,
          preferences: nextPref
        }
      });
      sendJson(res, 200, { settings });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  if (pathname === "/api/v1/notifications") {
    if (method(req) !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (!authEnabled()) {
      sendJson(res, 200, { items: [] });
      return true;
    }
    const auth = await requireAuth(req, res);
    if (!auth) return true;
    const prisma = await getPrisma();
    const items = await prisma.notification.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: "desc" },
      take: 40
    });
    sendJson(res, 200, { items });
    return true;
  }

  if (pathname === "/api/v1/notifications/read-all") {
    if (method(req) !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (!authEnabled()) {
      sendJson(res, 200, { ok: true });
      return true;
    }
    const auth = await requireAuth(req, res);
    if (!auth) return true;
    const prisma = await getPrisma();
    await prisma.notification.updateMany({
      where: { userId: auth.user.id, readAt: null },
      data: { readAt: new Date() }
    });
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/v1/notifications/delete-all") {
    if (method(req) !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (!authEnabled()) {
      sendJson(res, 200, { ok: true, deleted: 0 });
      return true;
    }
    const auth = await requireAuth(req, res);
    if (!auth) return true;
    const prisma = await getPrisma();
    const result = await prisma.notification.deleteMany({ where: { userId: auth.user.id } });
    sendJson(res, 200, { ok: true, deleted: result.count || 0 });
    return true;
  }

  if (pathname === "/api/v1/notifications/delete-many") {
    if (method(req) !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (!authEnabled()) {
      sendJson(res, 200, { ok: true, deleted: 0 });
      return true;
    }
    const auth = await requireAuth(req, res);
    if (!auth) return true;
    const body = await readJsonBody(req).catch(() => null);
    const ids = Array.isArray(body && body.ids)
      ? body.ids.map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 100)
      : [];
    if (!ids.length) {
      sendJson(res, 400, { error: "ids_required" });
      return true;
    }
    const prisma = await getPrisma();
    const result = await prisma.notification.deleteMany({
      where: { userId: auth.user.id, id: { in: ids } }
    });
    sendJson(res, 200, { ok: true, deleted: result.count || 0 });
    return true;
  }

  const notifOne = pathname.match(/^\/api\/v1\/notifications\/([0-9a-f-]{36})$/i);
  if (notifOne) {
    if (!authEnabled()) {
      sendJson(res, 200, { ok: true });
      return true;
    }
    const auth = await requireAuth(req, res);
    if (!auth) return true;
    const prisma = await getPrisma();
    if (method(req) === "PATCH") {
      await prisma.notification.updateMany({
        where: { id: notifOne[1], userId: auth.user.id },
        data: { readAt: new Date() }
      });
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method(req) === "DELETE") {
      await prisma.notification.deleteMany({ where: { id: notifOne[1], userId: auth.user.id } });
      sendJson(res, 200, { ok: true });
      return true;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const pubUser = pathname.match(/^\/api\/v1\/users\/([0-9a-f-]{36})\/public$/i);
  if (pubUser && method(req) === "GET") {
    if (!authEnabled()) {
      sendJson(res, 404, { error: "not_found" });
      return true;
    }
    const prisma = await getPrisma();
    const u = await prisma.user.findUnique({
      where: { id: pubUser[1] },
      include: {
        settings: true,
        userRoles: { include: { role: true } },
        equippedTitle: true,
        equippedFrame: true,
        equippedEffect: true
      }
    });
    if (!u || u.status === "deleted") {
      sendJson(res, 404, { error: "not_found" });
      return true;
    }
    const pref = (u.settings && u.settings.preferences) || {};
    const stats = pref.publicStats === false ? null : await statsForUser(u.id);
    const viewer = await optionalUser(req);
    let relation = { status: "none" };
    if (viewer && viewer.accountType === "registered") {
      relation = await friendshipRelation(prisma, viewer.id, u.id);
    } else if (viewer && viewer.id === u.id) {
      relation = { status: "self" };
    }
    const roles = (u.userRoles || []).map((ur) => ur.role && ur.role.name).filter(Boolean);
    const {
      loadExtraTitleCosmetics,
      equippedBundle
    } = require("./cosmetics");
    const extraCosmetics = await loadExtraTitleCosmetics(prisma, u.equippedExtraTitleIds);
    sendJson(res, 200, {
      user: {
        id: u.id,
        displayName: u.displayName,
        username: u.username,
        avatarUrl: u.avatarUrl,
        accountType: u.accountType,
        createdAt: u.createdAt,
        gender: u.gender || null,
        age: u.age == null ? null : u.age,
        roles,
        equipped: equippedBundle(u, extraCosmetics)
      },
      stats,
      relation
    });
    return true;
  }

  if (pathname === "/api/v1/contact") {
    if (method(req) !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const auth = await requireAuth(req, res);
    if (!auth) return true;
    const ip = clientIp(req);
    const limited = rateLimit("contact:" + (auth.user.id || ip), 5, 60 * 60 * 1000);
    if (!limited.ok) {
      tooMany(res, limited.retryAfterSec || 3600);
      return true;
    }
    // Allow image data URL (~350KB) in body
    const body = await readJsonBody(req, 512 * 1024).catch((err) => {
      if (err && err.code === "body_too_large") return { __tooLarge: true };
      return null;
    });
    if (body && body.__tooLarge) {
      sendJson(res, 413, { error: "body_too_large" });
      return true;
    }
    if (!body) {
      sendJson(res, 400, { error: "invalid_body" });
      return true;
    }
    let message = String(body.message || "").trim().slice(0, 2000);
    const subject = String(body.subject || "").trim().slice(0, 128);
    let imageData = null;
    if (Object.prototype.hasOwnProperty.call(body, "imageData") && body.imageData != null && body.imageData !== "") {
      const raw = String(body.imageData).trim().replace(/\s+/g, "");
      if (
        !/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(raw) ||
        raw.length > 350000
      ) {
        sendJson(res, 400, { error: "invalid_image" });
        return true;
      }
      imageData = raw;
    }
    if (message.length < 5 && !imageData) {
      sendJson(res, 400, { error: "invalid_message" });
      return true;
    }
    if (!message && imageData) message = "(ส่งรูปภาพ)";
    const prisma = await getPrisma();
    const row = await prisma.contactMessage.create({
      data: {
        userId: auth.user.id,
        subject: subject || "ติดต่อแอดมิน",
        message,
        imageData,
        status: "open",
        ipAddress: ip ? String(ip).slice(0, 64) : null
      }
    });
    sendJson(res, 201, { id: row.id, ok: true });
    return true;
  }

  return false;
}

module.exports = { handleDashboardApi };
