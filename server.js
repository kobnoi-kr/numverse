require("dotenv").config();
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const { handleAuthApi } = require("./src/auth/routes");
const { authEnabled, getPrisma } = require("./src/db");
const { areFriends, listAcceptedFriendIds } = require("./src/auth/friends");
const {
  trackPresence: trackPresenceCore,
  untrackPresence: untrackPresenceCore,
  isUserOnline,
  sendToUser: sendToUserCore,
  forEachUserSocket,
  filterOnline,
  broadcastAll: broadcastAllCore,
  broadcastToUsers: broadcastToUsersCore
} = require("./src/presence");
const { handleDashboardApi } = require("./src/dashboard/routes");
const { handleAdminApi } = require("./src/admin/routes");
const { attachGameApi } = require("./src/dashboard/bridge");
const { persistFinishedGame } = require("./src/dashboard/persist");
const { publishDueAnnouncements } = require("./src/admin/publish-announcement");
const { startCleanupScheduler } = require("./src/system/cleanup");
const {
  getMaxRoomsDisplay,
  getMaintenanceState,
  userBypassesMaintenance
} = require("./src/system/public-settings");
const snakeBridge = require("./src/games/snake-ladders/room-bridge");
const imposterBridge = require("./src/games/imposter/room-bridge");
const memoryBridge = require("./src/games/memory/room-bridge");
const werewolfBridge = require("./src/games/werewolf/room-bridge");

const PORT = Number(process.env.PORT) || 8787;
/** Bind host: 0.0.0.0 = ทุก interface (LAN/สาธารณะ), 127.0.0.1 = เฉพาะเครื่องนี้ */
const HOST = process.env.HOST || "0.0.0.0";
/** Admin dashboard — default localhost-only; on Render default off (single public port). */
const ADMIN_PORT = Number(
  process.env.ADMIN_PORT !== undefined && process.env.ADMIN_PORT !== ""
    ? process.env.ADMIN_PORT
    : process.env.RENDER
      ? 0
      : 9100
);
const ADMIN_HOST = process.env.ADMIN_HOST || "127.0.0.1";
/** When admin port is off (e.g. Render), serve dashboard on the public port (APIs still role-gated). */
const PUBLIC_DASHBOARD =
  process.env.PUBLIC_DASHBOARD === "1" ||
  (process.env.PUBLIC_DASHBOARD !== "0" &&
    (!(ADMIN_PORT > 0) || !!process.env.RENDER));
const MAX_PLAYERS = 12;
const MAX_ROOMS = 200;
function roomMaxPlayers(room) {
  if (room && room.cat === "imposter") return imposterBridge.MAX_PLAYERS;
  if (room && room.cat === "cardmemory") return memoryBridge.MAX_PLAYERS;
  if (room && room.cat === "werewolf") return werewolfBridge.MAX_PLAYERS;
  return snakeBridge.roomCap(room, MAX_PLAYERS);
}
function normalizeGameCat(cat) {
  return (
    werewolfBridge.normalizeCat(cat) ||
    memoryBridge.normalizeCat(cat) ||
    imposterBridge.normalizeCat(cat) ||
    snakeBridge.normalizeCat(cat)
  );
}
const SEAT_MS = 45000;
const ROOM_MS = 60000;
/** Keep mid-game rooms longer so players can refresh and rejoin with scores. */
const ACTIVE_ROOM_MS = 5 * 60 * 1000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const PUBLIC_PAGE = fs.existsSync(path.join(PUBLIC, "landing.html"))
  ? "landing.html"
  : fs.existsSync(path.join(PUBLIC, "play.html"))
    ? "play.html"
    : "index.html";
const ADMIN_PAGE = fs.existsSync(path.join(PUBLIC, "admin.html"))
  ? "admin.html"
  : fs.existsSync(path.join(PUBLIC, "app.html"))
    ? "app.html"
    : PUBLIC_PAGE;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

function safePublicRel(name) {
  const file = path.normalize(path.join(PUBLIC, name));
  const rel = path.relative(PUBLIC, file);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel.includes("\0")) return null;
  return rel.split(path.sep).join("/");
}

function publicFileExists(rel) {
  try {
    return fs.existsSync(path.join(PUBLIC, rel)) && fs.statSync(path.join(PUBLIC, rel)).isFile();
  } catch {
    return false;
  }
}

/** Map /app → app.html, keep real assets as-is. */
function resolvePublicName(pathname) {
  if (pathname === "/" || pathname === "") return PUBLIC_PAGE;
  const raw = String(pathname || "").replace(/^\/+/, "");
  const rel = safePublicRel(raw);
  if (!rel) return null;
  if (publicFileExists(rel)) return rel;
  if (!path.extname(rel)) {
    const htmlRel = rel + ".html";
    if (publicFileExists(htmlRel)) return htmlRel;
  }
  return null;
}

function prettyPathFromHtml(pathname) {
  if (pathname === "/index.html") return PUBLIC_DASHBOARD ? "/admin" : "/app";
  if (!pathname.toLowerCase().endsWith(".html")) return pathname;
  const base = pathname.slice(0, -5);
  return base || "/";
}

/** โดเมนที่อนุญาตให้เข้า (จาก APP_BASE_URL + ALLOWED_HOSTS) — บล็อกการเข้าผ่าน IP */
function collectAllowedHosts() {
  const hosts = new Set();
  const add = (value) => {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return;
    try {
      const url = raw.includes("://") ? new URL(raw) : new URL("http://" + raw);
      if (url.hostname) hosts.add(url.hostname.toLowerCase());
    } catch {
      const host = raw.split("/")[0].replace(/:\d+$/, "");
      if (host) hosts.add(host);
    }
  };
  add(process.env.APP_BASE_URL);
  for (const part of String(process.env.ALLOWED_HOSTS || "").split(",")) add(part);
  add(process.env.RENDER_EXTERNAL_HOSTNAME);
  return hosts;
}
const ALLOWED_HOSTS = collectAllowedHosts();
const ENFORCE_HOST =
  process.env.ENFORCE_HOST === "1" ||
  (process.env.ENFORCE_HOST !== "0" &&
    ALLOWED_HOSTS.size > 0 &&
    ![...ALLOWED_HOSTS].every((h) => h === "localhost" || h === "127.0.0.1" || h === "::1"));

function isIpHostname(hostname) {
  const h = String(hostname || "").replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (h.includes(":")) return true;
  return false;
}
function isLoopbackHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}
function requestHostname(req) {
  const raw = String(req.headers.host || "").split(",")[0].trim();
  if (!raw) return "";
  try {
    return new URL("http://" + raw).hostname.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}
function hostAllowed(req) {
  if (!ENFORCE_HOST) return true;
  const hostname = requestHostname(req);
  if (!hostname) return false;
  if (isIpHostname(hostname)) return false;
  if (isLoopbackHost(hostname)) return true;
  return ALLOWED_HOSTS.has(hostname);
}
function rejectWrongHost(req, res) {
  const base = String(process.env.APP_BASE_URL || "").replace(/\/$/, "");
  if (base && (req.method === "GET" || req.method === "HEAD")) {
    let pathQuery = req.url || "/";
    try {
      const u = new URL(req.url || "/", "http://localhost");
      pathQuery = u.pathname + u.search;
    } catch {
      /* keep raw */
    }
    res.writeHead(301, { Location: base + pathQuery });
    res.end();
    return;
  }
  res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(base ? "กรุณาเข้าผ่าน " + base : "Forbidden host");
}

const rooms = new Map();
const byWs = new Map();
const watchers = new Set();
/** @type {Map<string, { id: string, code: string, fromUserId: string, toUserId: string, fromName: string, fromAvatar: string, roomTitle: string, expires: number }>} */
const roomInvites = new Map();
/** one pending invite per invitee */
const inviteByUser = new Map();
const INVITE_MS = 60000;

const WS_BUF_SOFT = 256 * 1024;
const WS_BUF_HARD = 1024 * 1024;

function send(ws, obj) {
  if (!ws || ws.readyState !== 1) return false;
  try {
    // Slow clients that can't drain should not grow unbounded send buffers.
    if (typeof ws.bufferedAmount === "number" && ws.bufferedAmount > WS_BUF_HARD) {
      try {
        ws.close(1013, "slow_client");
      } catch {
        /* ignore */
      }
      return false;
    }
    if (typeof ws.bufferedAmount === "number" && ws.bufferedAmount > WS_BUF_SOFT) {
      // Drop non-critical lobby-only spam; still try to deliver game state.
      if (obj && (obj.t === "lobby" || obj.t === "maintenance:countdown")) return false;
    }
    ws.send(JSON.stringify(obj));
    return true;
  } catch {
    return false;
  }
}
async function notifyFriendPresence(userId, online) {
  if (!authEnabled()) return;
  try {
    const prisma = await getPrisma();
    const friendIds = await listAcceptedFriendIds(prisma, userId);
    const msg = { t: "friendPresence", userId, online: !!online };
    for (const fid of friendIds) sendToUser(fid, msg);
  } catch (err) {
    /* ignore presence fanout errors */
  }
}
function trackPresence(ws, userId) {
  trackPresenceCore(ws, userId, (id, on) => {
    notifyFriendPresence(id, on).catch(() => {});
  });
}
function untrackPresence(ws) {
  untrackPresenceCore(ws, (id, on) => {
    notifyFriendPresence(id, on).catch(() => {});
  });
}
function sendToUser(userId, obj) {
  return sendToUserCore(userId, obj, send);
}
function purgeInvite(inviteId) {
  const inv = roomInvites.get(inviteId);
  if (!inv) return;
  roomInvites.delete(inviteId);
  if (inviteByUser.get(inv.toUserId) === inviteId) inviteByUser.delete(inv.toUserId);
}
function clearInviteForUser(userId) {
  const id = inviteByUser.get(userId);
  if (id) purgeInvite(id);
}
function cleanName(value) {
  return String(value || "").replace(/[\u0000-\u001f]/g, "").trim().replace(/\s+/g, " ").slice(0, 24);
}
function cleanRoomTitle(value) {
  return String(value || "").replace(/[\u0000-\u001f]/g, "").trim().replace(/\s+/g, " ").slice(0, 32);
}
function cleanAvatar(value) {
  if (value == null || value === "") return "";
  const raw = String(value).trim();
  if (!raw || raw.length > 24000) return "";
  if (/^https:\/\/[^\s]{1,2000}$/i.test(raw)) return raw.slice(0, 2000);
  if (
    /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(raw) &&
    raw.length <= 24000
  ) {
    return raw.replace(/\s+/g, "");
  }
  return "";
}
function validToken(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function allow(ws) {
  const now = Date.now();
  if (!ws.rl || now - ws.rl.t > 1000) ws.rl = { t: now, n: 0 };
  ws.rl.n += 1;
  return ws.rl.n <= 40;
}
function makeCode() {
  for (let i = 0; i < 30; i++) {
    const code = String(100000 + Math.floor(Math.random() * 900000));
    if (!rooms.has(code)) return code;
  }
  return "";
}
function findSeat(token) {
  if (!token) return null;
  for (const room of rooms.values()) {
    const player = room.players.find((item) => item.id === token);
    if (player) return { room, player };
  }
  return null;
}
function byName(room, name) {
  return room.players.find((item) => item.name === name) || null;
}
function scoreOf(room, player) {
  if (!player) return 0;
  return room.cat === "wheel" ? player.scoreWheel : player.scoreSecret;
}
function scoreByName(room, name) {
  return scoreOf(room, byName(room, name));
}
function addPoint(room, name) {
  const player = byName(room, name);
  if (!player) return;
  if (room.cat === "wheel") player.scoreWheel += 1;
  else player.scoreSecret += 1;
}
function clearPoints(room) {
  room.players.forEach((player) => {
    if (room.cat === "wheel") player.scoreWheel = 0;
    else player.scoreSecret = 0;
  });
}
function setChampions(room, names) {
  const ids = [];
  for (const name of names || []) {
    const player = byName(room, name);
    if (player && !ids.includes(player.id)) ids.push(player.id);
  }
  room.lastWinners = ids;
}
function clearChampions(room) {
  room.lastWinners = [];
}
function currentName(room) {
  if (!room.alive.length) return "";
  const index = ((room.turn % room.alive.length) + room.alive.length) % room.alive.length;
  return room.alive[index];
}
function orderReady(room) {
  const names = room.players.map((player) => player.name);
  if (names.length < 2) return false;
  if (room.order.length !== names.length) return false;
  const seen = Object.create(null);
  for (const name of room.order) {
    if (!names.includes(name) || seen[name]) return false;
    seen[name] = 1;
  }
  return true;
}
function isBot(player) {
  return !!(player && player.bot);
}
function canTakeTurn(player) {
  return !!(player && (player.bot || player.auto || player.connected));
}
function hasHumanOnline(room) {
  return room.players.some((player) => !isBot(player) && player.connected);
}
function liveCount(room) {
  return room.players.filter((player) => isBot(player) || player.connected).length;
}
function yourTurn(room, player) {
  if (!player || !canTakeTurn(player)) return false;
  if (room.phase === "snake") return snakeBridge.snakeYourTurn(room, player);
  if (room.phase === "play") return currentName(room) === player.name;
  if (room.phase === "pick") {
    const each = Math.max(room.pickEach, 1);
    const total = room.wheelOrder.length * each;
    if (room.pickCursor >= total) return false;
    return room.wheelOrder[Math.floor(room.pickCursor / each)] === player.name;
  }
  return false;
}
function turnPlayer(room) {
  if (room.phase === "snake") return snakeBridge.snakeCurrentSeat(room);
  if (room.phase === "play") return byName(room, currentName(room));
  if (room.phase === "pick") {
    const each = Math.max(room.pickEach, 1);
    const total = room.wheelOrder.length * each;
    if (room.pickCursor >= total) return null;
    return byName(room, room.wheelOrder[Math.floor(room.pickCursor / each)]);
  }
  return null;
}
function makeBot(room) {
  let n = 1;
  while (room.players.some((player) => player.name === "บอท " + n)) n += 1;
  return {
    id: "bot-" + crypto.randomUUID(),
    name: "บอท " + n,
    avatarUrl: "",
    bot: true,
    auto: true,
    ws: null,
    connected: true,
    scoreSecret: 0,
    scoreWheel: 0,
    lastSeen: Date.now()
  };
}
const SPAN_MAX = 10000;
const SECRET_COUNT_MAX = 100;

function checkRange(min, max) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) return "กรอกจำนวนเต็มเท่านั้น";
  if (min >= max) return "เลขต่ำสุดต้องน้อยกว่าเลขสูงสุด";
  if (max - min + 1 > SPAN_MAX) return "ช่วงตัวเลขต้องไม่เกิน " + SPAN_MAX.toLocaleString("en-US") + " จำนวน";
  return "";
}
function checkCount(min, max, count) {
  if (!Number.isSafeInteger(count) || count < 1) return "จำนวนเลขลับต้องเป็นจำนวนเต็มตั้งแต่ 1";
  if (count > SECRET_COUNT_MAX) return "จำนวนเลขลับต้องไม่เกิน " + SECRET_COUNT_MAX;
  if (count > max - min + 1) return "จำนวนเลขลับต้องไม่เกินจำนวนตัวเลขในช่วง";
  return "";
}
function checkWin(target) {
  if (!Number.isSafeInteger(target) || target < 1) return "แต้มที่ชนะต้องเป็นจำนวนเต็มตั้งแต่ 1";
  if (target > 999) return "แต้มที่ชนะต้องไม่เกิน 999";
  return "";
}
function drawSecrets(min, max, count) {
  const span = max - min + 1;
  if (count >= span) {
    const all = [];
    for (let n = min; n <= max; n++) all.push(n);
    return all;
  }
  const pick = count > span / 2 ? span - count : count;
  const bag = new Set();
  while (bag.size < pick) bag.add(Math.floor(Math.random() * span) + min);
  if (count <= span / 2) return [...bag].sort((a, b) => a - b);
  const secrets = [];
  for (let n = min; n <= max; n++) if (!bag.has(n)) secrets.push(n);
  return secrets;
}
function joinThai(names) {
  if (names.length <= 1) return names[0] || "";
  if (names.length === 2) return names.join(" กับ ");
  return names.slice(0, -1).join(", ") + " และ " + names[names.length - 1];
}
function cancelSpin(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  room.activeSpin = null;
}
function clearTurnTimer(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.turnUntil = 0;
}
function clearAngelGuards(room) {
  (room.players || []).forEach((player) => {
    if (!player) return;
    player.angelGuard = false;
    player.angelCardUsed = false;
    player.angelSnakeCharges = 0;
    player.skipTurnGuard = false;
    player.skipNextTurn = false;
    player.bombPauseTurns = 0;
    player.evenOddCharges = 0;
    player.evenOddArmed = false;
  });
  if (room) room.snakeBombs = [];
}
function blankRoom(code, visibility, host) {
  return {
    code,
    visibility,
    title: "",
    hostId: host.id,
    created: Date.now(),
    players: [host],
    phase: "lobby",
    cat: "secret",
    rangeMode: "99",
    min: 1,
    max: 99,
    winTarget: 3,
    secretCount: 1,
    pickEach: 1,
    turnSec: 0,
    pointAll: true,
    order: [],
    rot: 0,
    alive: [],
    roundOrder: [],
    turn: 0,
    gameMin: 1,
    gameMax: 99,
    lo: 1,
    hi: 99,
    secrets: [],
    secretAll: [],
    secretTotal: 1,
    picked: [],
    wheelMin: 1,
    wheelMax: 99,
    wheelOrder: [],
    picks: {},
    pickCursor: 0,
    wheelAlive: [],
    wheelLog: [],
    wheelGone: [],
    wheelRot: 0,
    over: null,
    lastWinners: [],
    activeSpin: null,
    timer: null,
    turnTimer: null,
    turnUntil: 0,
    emptyTimer: null,
    spectators: [],
    startedAt: null,
    _persisted: false,
    snake: null,
    snakeMapId: snakeBridge.DEFAULT_MAP_ID || "classic",
    imposter: null,
    impostorInfo: "none",
    impostorCount: 1,
    discussionSec: 60,
    voteSec: 45,
    clueSec: 45,
    clueRounds: 5,
    wordCategory: "all",
    imposterTimer: null,
    memory: null,
    memoryBoard: "4x4",
    memoryTurnSec: 20,
    memoryRevealMs: 1500,
    memoryPoints: 100,
    memoryCombo: true,
    memoryOnMatch: "continue",
    memoryOnWrong: "next",
    memoryTimer: null,
    werewolf: null,
    wwNightSec: 30,
    wwDiscussionSec: 60,
    wwVoteSec: 45,
    wwTieRule: "none",
    wwAllowSelfProtect: true,
    werewolfTimer: null
  };
}
function applyRoomSetup(room, setup) {
  if (!setup || typeof setup !== "object") return;
  const nextCat = normalizeGameCat(setup.cat);
  if (nextCat) {
    if (nextCat === "snake" && room.players.length > snakeBridge.MAX_PLAYERS) {
      /* keep previous cat — too many seated for snake */
    } else if (nextCat === "imposter" && room.players.length > imposterBridge.MAX_PLAYERS) {
      /* keep previous cat */
    } else if (nextCat === "cardmemory" && room.players.length > memoryBridge.MAX_PLAYERS) {
      /* keep previous cat */
    } else if (nextCat === "werewolf" && room.players.length > werewolfBridge.MAX_PLAYERS) {
      /* keep previous cat */
    } else {
      room.cat = nextCat;
    }
  }
  if (setup.snakeMapId != null) {
    room.snakeMapId = snakeBridge.normalizeMapId(setup.snakeMapId);
  }
  if (setup.impostorInfo != null) {
    room.impostorInfo = imposterBridge.normalizeInfo(setup.impostorInfo);
  }
  if (setup.impostorCount != null) {
    room.impostorCount = imposterBridge.normalizeImpostorCount(
      setup.impostorCount,
      (room.players && room.players.length) || 4
    );
  }
  if (Number.isInteger(setup.discussionSec)) {
    room.discussionSec = Math.min(180, Math.max(30, setup.discussionSec));
  }
  if (Number.isInteger(setup.voteSec)) {
    room.voteSec = Math.min(120, Math.max(20, setup.voteSec));
  }
  if (Number.isInteger(setup.clueSec)) {
    room.clueSec = Math.min(120, Math.max(15, setup.clueSec));
  }
  if (setup.clueRounds != null) {
    room.clueRounds = imposterBridge.normalizeClueRounds(setup.clueRounds);
  }
  if (setup.wordCategory != null) {
    room.wordCategory = imposterBridge.normalizeCategory(setup.wordCategory);
  }
  if (setup.memoryBoard != null) room.memoryBoard = memoryBridge.normalizeBoard(setup.memoryBoard);
  if (setup.memoryTurnSec != null) room.memoryTurnSec = memoryBridge.normalizeTurnSec(setup.memoryTurnSec);
  if (setup.memoryRevealMs != null) room.memoryRevealMs = memoryBridge.normalizeRevealMs(setup.memoryRevealMs);
  if (setup.memoryPoints != null) room.memoryPoints = memoryBridge.normalizePoints(setup.memoryPoints);
  if (setup.memoryCombo != null) room.memoryCombo = !!setup.memoryCombo;
  if (setup.memoryOnMatch != null) room.memoryOnMatch = memoryBridge.normalizeOnMatch(setup.memoryOnMatch);
  if (setup.memoryOnWrong != null) room.memoryOnWrong = memoryBridge.normalizeOnWrong(setup.memoryOnWrong);
  if (setup.wwNightSec != null) room.wwNightSec = werewolfBridge.normalizeNightSec(setup.wwNightSec);
  if (setup.wwDiscussionSec != null) {
    room.wwDiscussionSec = werewolfBridge.normalizeDiscussionSec(setup.wwDiscussionSec);
  }
  if (setup.wwVoteSec != null) room.wwVoteSec = werewolfBridge.normalizeVoteSec(setup.wwVoteSec);
  if (setup.wwTieRule != null) room.wwTieRule = werewolfBridge.normalizeTie(setup.wwTieRule);
  if (setup.wwAllowSelfProtect != null) room.wwAllowSelfProtect = !!setup.wwAllowSelfProtect;
  if (setup.rangeMode === "99" || setup.rangeMode === "999" || setup.rangeMode === "9999") {
    room.rangeMode = setup.rangeMode;
    room.min = 1;
    room.max = Number(setup.rangeMode);
  }
  if (Number.isInteger(setup.winTarget) && setup.winTarget > 0) room.winTarget = Math.min(99, setup.winTarget);
  if (Number.isInteger(setup.turnSec) && setup.turnSec >= 0) room.turnSec = Math.min(120, setup.turnSec);
  if (Number.isInteger(setup.secretCount) && setup.secretCount > 0) room.secretCount = Math.min(20, setup.secretCount);
  if (Number.isInteger(setup.pickEach) && setup.pickEach > 0) room.pickEach = Math.min(10, setup.pickEach);
  if (Number.isInteger(setup.min) && Number.isInteger(setup.max) && setup.max > setup.min) {
    room.rangeMode = "custom";
    room.min = setup.min;
    room.max = setup.max;
  }
  if (typeof setup.title === "string") {
    const title = cleanRoomTitle(setup.title);
    if (title) room.title = title;
  }
}
function publicSpin(spin) {
  if (!spin) return null;
  return {
    id: spin.id,
    kind: spin.kind,
    dur: spin.dur,
    left: Math.max(0, spin.until - Date.now()),
    rot: spin.rot || 0,
    from: spin.from || 0,
    target: spin.target || 0,
    n: Number.isInteger(spin.n) ? spin.n : null,
    hit: !!spin.hit,
    owner: spin.owner || "",
    next: Array.isArray(spin.next) ? spin.next.slice() : undefined
  };
}
function roomLabel(room) {
  const title = cleanRoomTitle(room.title);
  if (title) return title;
  const host = room.players.find((item) => item.id === room.hostId);
  return host ? ("ห้องของ " + host.name) : ("ห้อง " + room.code);
}
function snap(room, player, opts) {
  const spectator = !!(opts && opts.spectator);
  const base = {
    t: "state",
    code: room.code,
    visibility: room.visibility,
    title: room.title || "",
    roomLabel: roomLabel(room),
    hostId: room.hostId,
    youId: player ? player.id : "",
    spectator,
    phase: room.phase,
    cat: room.cat,
    rangeMode: room.rangeMode,
    min: room.min,
    max: room.max,
    winTarget: room.winTarget,
    secretCount: room.secretCount,
    pickEach: room.pickEach,
    pointAll: room.pointAll,
    maxPlayers: roomMaxPlayers(room),
    spectatorCount: Array.isArray(room.spectators) ? room.spectators.length : 0,
    snakeMapId: snakeBridge.normalizeMapId(room.snakeMapId || snakeBridge.DEFAULT_MAP_ID),
    snakeMaps: snakeBridge.listMaps(),
    snake: snakeBridge.snapSnake(room),
    impostorInfo: room.impostorInfo === "category" ? "category" : "none",
    impostorCount: Number(room.impostorCount) === 2 ? 2 : 1,
    discussionSec: Number(room.discussionSec) || 60,
    voteSec: Number(room.voteSec) || 45,
    clueSec: Number(room.clueSec) || 45,
    clueRounds: imposterBridge.normalizeClueRounds(room.clueRounds),
    wordCategory: imposterBridge.normalizeCategory(room.wordCategory),
    wordCategories: imposterBridge.listCategories(),
    imposter: imposterBridge.snapImposter(room, spectator ? null : player),
    youImposter: spectator ? null : imposterBridge.privateImposter(room, player),
    memoryBoard: memoryBridge.normalizeBoard(room.memoryBoard),
    memoryTurnSec: memoryBridge.normalizeTurnSec(room.memoryTurnSec),
    memoryRevealMs: memoryBridge.normalizeRevealMs(room.memoryRevealMs),
    memoryPoints: memoryBridge.normalizePoints(room.memoryPoints),
    memoryCombo: room.memoryCombo !== false,
    memoryOnMatch: memoryBridge.normalizeOnMatch(room.memoryOnMatch),
    memoryOnWrong: memoryBridge.normalizeOnWrong(room.memoryOnWrong),
    memory: memoryBridge.snapMemory(room, spectator ? null : player),
    wwNightSec: werewolfBridge.normalizeNightSec(room.wwNightSec),
    wwDiscussionSec: werewolfBridge.normalizeDiscussionSec(room.wwDiscussionSec),
    wwVoteSec: werewolfBridge.normalizeVoteSec(room.wwVoteSec),
    wwTieRule: werewolfBridge.normalizeTie(room.wwTieRule),
    wwAllowSelfProtect: room.wwAllowSelfProtect !== false,
    werewolf: werewolfBridge.snapWerewolf(room, spectator ? null : player),
    youWerewolf: spectator ? null : werewolfBridge.privateWerewolf(room, player),
    players: room.players.map((item) => ({
      id: item.id,
      name: item.name,
      avatarUrl: item.avatarUrl || "",
      gender: item.gender || null,
      age: item.age == null ? null : item.age,
      roles: Array.isArray(item.roles) ? item.roles : [],
      title: item.title || null,
      titleClass: item.titleClass || null,
      frameClass: item.frameClass || null,
      effectClass: item.effectClass || null,
      frameImage: item.frameImage || null,
      effectImage: item.effectImage || null,
      score: scoreOf(room, item),
      connected: item.connected,
      host: item.id === room.hostId,
      bot: !!item.bot,
      auto: !!(item.auto || item.bot),
      angelGuard: !!(item.angelGuard || (item.angelSnakeCharges | 0) > 0),
      angelSnakeCharges: Math.max(0, Number(item.angelSnakeCharges) || 0),
      skipTurnGuard: !!item.skipTurnGuard,
      skipNextTurn: !!item.skipNextTurn || Math.max(0, Number(item.bombPauseTurns) || 0) > 0,
      bombPauseTurns: Math.max(0, Number(item.bombPauseTurns) || 0),
      evenOddCharges: Math.max(0, Number(item.evenOddCharges) || 0),
      champion: Array.isArray(room.lastWinners) && room.lastWinners.includes(item.id)
    })),
    youAuto: !!(player && (player.auto || player.bot)),
    youAngelGuard: !!(player && (player.angelGuard || (player.angelSnakeCharges | 0) > 0)),
    youAngelSnakeCharges: player ? Math.max(0, Number(player.angelSnakeCharges) || 0) : 0,
    youSkipTurnGuard: !!(player && player.skipTurnGuard),
    youEvenOddCharges: player ? Math.max(0, Number(player.evenOddCharges) || 0) : 0,
    order: room.order,
    alive: room.alive,
    roundOrder: room.roundOrder,
    turn: room.turn,
    gameMin: room.gameMin,
    gameMax: room.gameMax,
    lo: room.lo,
    hi: room.hi,
    secretsLeft: room.secrets.length,
    secretTotal: room.secretTotal,
    picked: room.picked.map((item) => ({
      n: item.n,
      who: item.who,
      hit: !!item.hit,
      angelSaved: !!item.angelSaved
    })),
    revealed: room.phase === "over" && room.cat !== "wheel" && room.cat !== "snake" ? room.secretAll.slice() : [],
    wheelMin: room.wheelMin,
    wheelMax: room.wheelMax,
    wheelOrder: room.wheelOrder,
    picks: spectator && room.phase !== "over" ? {} : room.picks,
    pickCursor: room.pickCursor,
    wheelAlive: room.wheelAlive,
    wheelLog: room.wheelLog.map((item) => ({ n: item.n, who: item.who })),
    wheelGone: Array.isArray(room.wheelGone) ? room.wheelGone.slice() : [],
    wheelRot: room.wheelRot,
    orderRot: room.rot,
    over: room.over,
    activeSpin: publicSpin(room.activeSpin),
    turnSec: room.turnSec || 0,
    turnLeft: room.turnUntil ? Math.max(0, room.turnUntil - Date.now()) : 0,
    yourTurn: spectator ? false : yourTurn(room, player)
  };
  return base;
}
function lobbyMsg(opts = {}) {
  const revealPrivate = !!opts.revealPrivate;
  const list = [];
  for (const room of rooms.values()) {
    if (!room.players.some((item) => item.connected)) continue;
    const host = room.players.find((item) => item.id === room.hostId);
    const count = room.players.filter((item) => item.connected).length;
    const priv = room.visibility === "private";
    list.push({
      code: priv && !revealPrivate ? "" : room.code,
      visibility: priv ? "private" : "public",
      title: roomLabel(room),
      host: host ? host.name : "",
      count,
      max: roomMaxPlayers(room),
      cat: room.cat,
      phase: room.phase,
      joinable: room.phase === "lobby" && room.players.length < roomMaxPlayers(room),
      created: room.created || 0
    });
  }
  list.sort((a, b) => {
    const ap = a.visibility === "private" ? 1 : 0;
    const bp = b.visibility === "private" ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return (b.created || 0) - (a.created || 0);
  });
  const maxShow = Number(lobbyMsg._maxRooms) || 50;
  return { t: "lobby", rooms: list.slice(0, maxShow) };
}
lobbyMsg._maxRooms = 50;
setInterval(() => {
  getMaxRoomsDisplay()
    .then((n) => {
      lobbyMsg._maxRooms = n;
    })
    .catch(() => {});
}, 5000);
async function refreshAdminFlag(ws) {
  const token = validToken(ws.token) ? ws.token : "";
  if (!token) {
    ws.isAdmin = false;
    return false;
  }
  try {
    ws.isAdmin = !!(await userBypassesMaintenance(token));
  } catch {
    ws.isAdmin = false;
  }
  return !!ws.isAdmin;
}
function sendLobby(ws) {
  if (!ws || ws.readyState !== 1) return;
  send(ws, lobbyMsg({ revealPrivate: !!ws.isAdmin }));
}
let lobbyBroadcastTimer = null;
function broadcastLobby(immediate = false) {
  if (immediate) {
    if (lobbyBroadcastTimer) {
      clearTimeout(lobbyBroadcastTimer);
      lobbyBroadcastTimer = null;
    }
    for (const ws of watchers) sendLobby(ws);
    return;
  }
  // Coalesce rapid lobby refreshes (join/leave/setup spam).
  if (lobbyBroadcastTimer) return;
  lobbyBroadcastTimer = setTimeout(() => {
    lobbyBroadcastTimer = null;
    for (const ws of watchers) sendLobby(ws);
  }, 40);
}
function broadcast(room, opts = {}) {
  for (const player of room.players) send(player.ws, snap(room, player));
  if (Array.isArray(room.spectators)) {
    for (const sp of room.spectators) send(sp.ws, snap(room, null, { spectator: true }));
  }
  if (opts.lobby !== false) broadcastLobby(!!opts.lobbyImmediate);
  if (room.phase === "over") {
    persistFinishedGame(room, scoreOf).catch(() => {});
  }
}
function fail(ws, message) {
  send(ws, { t: "err", message });
}
function scheduleDelete(room) {
  if (room.emptyTimer) return;
  if (room.holdUntil && Date.now() < room.holdUntil) {
    room.emptyTimer = setTimeout(() => {
      room.emptyTimer = null;
      scheduleDelete(room);
    }, Math.max(1000, room.holdUntil - Date.now()));
    return;
  }
  const delay =
    room.phase && room.phase !== "lobby" && room.phase !== "over"
      ? ACTIVE_ROOM_MS
      : ROOM_MS;
  room.emptyTimer = setTimeout(() => {
    room.emptyTimer = null;
    if (room.players.some((player) => player.connected)) return;
    if (Array.isArray(room.spectators) && room.spectators.length) return;
    cancelSpin(room);
    clearTurnTimer(room);
    rooms.delete(room.code);
    broadcastLobby(true);
  }, delay);
}
function attach(ws, room, player) {
  watchers.delete(ws);
  if (player.ws && player.ws !== ws) {
    const old = player.ws;
    player.ws = null;
    byWs.delete(old);
    try { old.close(); } catch (err) {}
  }
  player.ws = ws;
  player.connected = true;
  player.lastSeen = Date.now();
  byWs.set(ws, { room, player });
  if (room.emptyTimer) {
    clearTimeout(room.emptyTimer);
    room.emptyTimer = null;
  }
  broadcast(room);
}
function skipToConnected(room) {
  if (room.phase !== "play" || room.alive.length < 2) return false;
  if (!room.alive.some((name) => canTakeTurn(byName(room, name)))) return false;
  const start = room.turn;
  let hops = 0;
  while (hops < room.alive.length) {
    if (canTakeTurn(byName(room, currentName(room)))) break;
    room.turn = (room.turn + 1) % room.alive.length;
    hops += 1;
  }
  return room.turn !== start;
}
/** Consume pending skip-next flags for the current secret-number seat. */
function processPendingSkipPlay(room) {
  if (room.phase !== "play" || !room.alive.length) return false;
  let changed = false;
  let hops = 0;
  while (hops < room.alive.length) {
    const name = currentName(room);
    const player = byName(room, name);
    if (player && player.skipNextTurn) {
      player.skipNextTurn = false;
      room.turn = room.alive.length ? (room.turn + 1) % room.alive.length : 0;
      changed = true;
      hops += 1;
      continue;
    }
    break;
  }
  if (changed) skipToConnected(room);
  return changed;
}
/** If current snake seat has skipNextTurn / bomb pause, advance without rolling. */
function processPendingSkipSnake(room) {
  if (room.phase !== "snake" || !room.snake || room.snake.status !== "playing") return false;
  let changed = false;
  let hops = 0;
  const n = (room.players || []).length || 1;
  while (hops < n * 3) {
    const seat = snakeBridge.snakeCurrentSeat(room);
    if (!seat) break;
    const pauseLeft = Math.max(0, Number(seat.bombPauseTurns) || 0);
    if (pauseLeft > 0) {
      seat.bombPauseTurns = pauseLeft - 1;
      if (!snakeBridge.skipSnakeTurn(room)) break;
      changed = true;
      hops += 1;
      continue;
    }
    if (!seat.skipNextTurn) break;
    seat.skipNextTurn = false;
    if (!snakeBridge.skipSnakeTurn(room)) break;
    changed = true;
    hops += 1;
  }
  return changed;
}
function finishRound(room) {
  const left = room.roundOrder.filter((name) => room.alive.includes(name));
  const gained = !left.length ? [] : room.pointAll ? left : [left[left.length - 1]];
  gained.forEach((name) => addPoint(room, name));
  const champs = gained.filter((name) => scoreByName(room, name) >= room.winTarget);
  const won = champs.length > 0;
  const champText = joinThai(champs);
  let title = "";
  let note = "";
  if (!room.roundOrder.length) {
    title = "คุณเลือกโดนเลขลับ!";
  } else if (won) {
    title = champText + " ชนะแล้ว!";
    note = "ถึง " + room.winTarget + " แต้ม";
  } else if (room.alive.length === 1) {
    title = room.alive[0] + " เป็นคนสุดท้าย";
    note = "ได้ 1 แต้ม";
  } else if (!room.alive.length && room.roundOrder.length > 1) {
    title = "ทุกคนโดนเลขลับ";
  } else if (!room.alive.length) {
    title = (room.roundOrder[0] || "คุณ") + " เลือกโดนเลขลับ!";
  } else if (room.pointAll) {
    title = "เลขลับหมดแล้ว";
    note = "ทุกคนได้คนละ 1 แต้ม ยกเว้นคนที่โดนเลขลับ";
  } else {
    title = gained[0] + " เป็นคนสุดท้าย";
    note = "ได้ 1 แต้ม";
  }
  const outOrder = [];
  room.picked.forEach((item) => {
    if (item && item.hit && item.who && !outOrder.includes(item.who)) outOrder.push(item.who);
  });
  clearTurnTimer(room);
  room.phase = "over";
  room.activeSpin = null;
  if (won) setChampions(room, champs);
  room.over = {
    title,
    note,
    outOrder,
    secretLabel: "เลขลับคือ",
    secretText: room.secretAll.join(", "),
    many: room.secretAll.length > 3,
    hist: null,
    again: won ? "เริ่มแมตช์ใหม่" : "เล่นอีกครั้ง",
    reset: won,
    winners: won ? champs.slice() : [],
    winTarget: room.winTarget,
    mode: ""
  };
}
function openPlayNums(room) {
  const used = new Set(room.picked.map((item) => item.n));
  const nums = [];
  for (let n = room.lo; n <= room.hi; n++) if (!used.has(n)) nums.push(n);
  return nums;
}
function openPickNums(room) {
  const used = taken(room);
  const nums = [];
  for (let n = room.wheelMin; n <= room.wheelMax; n++) if (!used.has(n)) nums.push(n);
  return nums;
}
function othersAliveExcluding(aliveList, who) {
  return (aliveList || []).filter((name) => name && name !== who).length;
}
/** Angel revive only if >2 other players still in (excluding the one who hit). */
function angelCanRevive(aliveList, who) {
  return othersAliveExcluding(aliveList, who) > 2;
}
function finishRoundDraw(room, savedWho) {
  clearTurnTimer(room);
  room.phase = "over";
  room.activeSpin = null;
  room.over = {
    title: "เสมอ — การ์ดนางฟ้าช่วยไว้!",
    note: (savedWho || "ผู้เล่น") + " โดนเลขลับแต่ไม่มีผู้ชนะ",
    outOrder: [],
    secretLabel: "เลขลับคือ",
    secretText: room.secretAll.join(", "),
    many: room.secretAll.length > 3,
    hist: null,
    again: "เล่นอีกครั้ง",
    reset: false,
    winners: [],
    winTarget: room.winTarget,
    mode: "",
    draw: true
  };
}
function finishWheelDraw(room, savedWho) {
  clearTurnTimer(room);
  room.phase = "over";
  room.activeSpin = null;
  const outOrder = [];
  (room.wheelLog || []).forEach((item) => {
    if (item && item.who && !outOrder.includes(item.who)) outOrder.push(item.who);
  });
  room.over = {
    title: "เสมอ — การ์ดนางฟ้าช่วยไว้!",
    note: (savedWho || "ผู้เล่น") + " โดนระเบิดแต่ไม่มีผู้ชนะ",
    outOrder,
    secretLabel: "",
    secretText: "",
    many: false,
    hist: (room.wheelLog || []).map((item) => ({ n: item.n, who: item.who, angelSaved: !!item.angelSaved })),
    again: "เล่นอีกครั้ง",
    reset: false,
    winners: [],
    winTarget: room.winTarget,
    mode: "wheel",
    draw: true
  };
}

function applyPlayChoice(room, who, n) {
  const hit = room.secrets.includes(n);
  const player = byName(room, who);
  const angelSave = !!(hit && player && player.angelGuard);
  room.picked.push({ n, who, hit, angelSaved: angelSave });
  if (hit) {
    const secretsBefore = room.secrets.length;
    room.secrets = room.secrets.filter((secret) => secret !== n);
    if (angelSave) {
      player.angelGuard = false;
      // ≤1 เลขลับเหลือตอนโดน → เสมอ
      // >1 เลขลับ: ชุบต่อได้เฉพาะเมื่อเหลือผู้เล่นอื่น > 2 คน (ไม่นับตัวเอง)
      const canRevive = secretsBefore > 1 && angelCanRevive(room.alive, who);
      if (!canRevive) {
        clearTurnTimer(room);
        finishRoundDraw(room, who);
        return;
      }
      // ชุบมาเล่นต่อ — ไม่ถูกคัดออก
    } else {
      const index = room.alive.indexOf(who);
      if (index >= 0) room.alive.splice(index, 1);
      room.turn = room.alive.length ? index % room.alive.length : 0;
      if (room.alive.length <= 1 || !room.secrets.length) {
        clearTurnTimer(room);
        finishRound(room);
        return;
      }
    }
  } else if (room.alive.length) {
    room.turn = (room.turn + 1) % room.alive.length;
  }
  const below = room.secrets.some((secret) => secret < n);
  const above = room.secrets.some((secret) => secret > n);
  if (!below) room.lo = n + 1;
  if (!above) room.hi = n - 1;
  skipToConnected(room);
  armTurnTimer(room);
}
function applyPickChoice(room, name, n) {
  if (!room.picks[name]) room.picks[name] = [];
  room.picks[name].push(n);
  room.pickCursor += 1;
  const each = Math.max(room.pickEach, 1);
  const total = room.wheelOrder.length * each;
  if (room.pickCursor >= total) clearTurnTimer(room);
  else armTurnTimer(room);
}
function armTurnTimer(room) {
  clearTurnTimer(room);
  if (room.phase === "play") {
    processPendingSkipPlay(room);
    if (!currentName(room) || room.alive.length < 1) return;
  } else if (room.phase === "pick") {
    const each = Math.max(room.pickEach, 1);
    const total = room.wheelOrder.length * each;
    if (room.pickCursor >= total) return;
  } else if (room.phase === "snake") {
    processPendingSkipSnake(room);
    if (!room.snake || room.snake.status !== "playing") return;
  } else return;
  const player = turnPlayer(room);
  if (!player || !canTakeTurn(player)) return;
  const autoNow = !!(player.auto || player.bot);
  // Snake: bots/auto always tick (delay lets board walk anim finish).
  // Humans: host turnSec if set, otherwise AFK → auto after 15s.
  const configuredSec = Number.isInteger(room.turnSec) && room.turnSec > 0 ? room.turnSec : 0;
  const sec = autoNow
    ? room.phase === "snake"
      ? 1.7
      : 0.4
    : room.phase === "snake"
      ? configuredSec || 15
      : configuredSec;
  if (sec < 0.1) return;
  const until = Date.now() + Math.round(sec * 1000);
  room.turnUntil = until;
  room.turnTimer = setTimeout(() => {
    if (room.turnUntil !== until) return;
    onTurnTimeout(room, !autoNow);
  }, Math.round(sec * 1000));
}
function onTurnTimeout(room, markAuto) {
  clearTurnTimer(room);
  const player = turnPlayer(room);
  if (markAuto && player && !isBot(player)) player.auto = true;
  if (room.phase === "snake") {
    if (!player || !room.snake) return;
    const { result, error } = snakeBridge.applySnakeRoll(room, player.id, {
      commandId: "auto-" + Date.now()
    });
    if (error) return;
    if (result.finished) finishSnakeMatch(room, result.state.winnerId);
    else armTurnTimer(room);
    broadcast(room);
    return;
  }
  if (room.phase === "play") {
    const who = currentName(room);
    if (!who) return;
    const nums = openPlayNums(room);
    if (!nums.length) return;
    applyPlayChoice(room, who, nums[Math.floor(Math.random() * nums.length)]);
    broadcast(room);
    return;
  }
  if (room.phase === "pick") {
    const each = Math.max(room.pickEach, 1);
    const total = room.wheelOrder.length * each;
    if (room.pickCursor >= total) return;
    const name = room.wheelOrder[Math.floor(room.pickCursor / each)];
    if (!name) return;
    const nums = openPickNums(room);
    if (!nums.length) return;
    applyPickChoice(room, name, nums[Math.floor(Math.random() * nums.length)]);
    broadcast(room);
  }
}
function begin(room) {
  const count = room.secretCount;
  clearChampions(room);
  room.gameMin = room.min;
  room.gameMax = room.max;
  room.secretTotal = count;
  room.secretAll = drawSecrets(room.min, room.max, count);
  room.secrets = room.secretAll.slice();
  room.alive = room.order.slice();
  room.roundOrder = room.order.slice();
  room.lo = room.min;
  room.hi = room.max;
  room.picked = [];
  room.turn = 0;
  room.phase = "play";
  room.over = null;
  room.startedAt = room.startedAt || Date.now();
  room._persisted = false;
  skipToConnected(room);
  armTurnTimer(room);
}
function startPick(room) {
  cancelSpin(room);
  clearTurnTimer(room);
  clearChampions(room);
  room.wheelMin = room.min;
  room.wheelMax = room.max;
  room.wheelOrder = room.order.slice();
  room.picks = {};
  room.pickCursor = 0;
  room.wheelAlive = [];
  room.wheelLog = [];
  room.wheelGone = [];
  room.wheelRot = 0;
  room.phase = "pick";
  room.over = null;
  room.startedAt = room.startedAt || Date.now();
  room._persisted = false;
  armTurnTimer(room);
}
function finishWheel(room) {
  clearTurnTimer(room);
  const winner = room.wheelAlive[0] || "";
  if (winner) addPoint(room, winner);
  const won = !!(winner && scoreByName(room, winner) >= room.winTarget);
  const nums = winner && Array.isArray(room.picks[winner]) ? room.picks[winner] : [];
  const text = nums.join(", ");
  const outOrder = [];
  room.wheelLog.forEach((item) => {
    if (item && item.who && !outOrder.includes(item.who)) outOrder.push(item.who);
  });
  room.phase = "over";
  room.activeSpin = null;
  if (won) setChampions(room, [winner]);
  room.over = {
    title: won ? winner + " ชนะแล้ว!" : winner ? winner + " เป็นคนสุดท้าย" : "ไม่มีผู้ชนะ",
    note: won ? "ถึง " + room.winTarget + " แต้ม" : winner ? "ได้ 1 แต้ม" : "",
    outOrder,
    secretLabel: winner ? "เลขที่เลือก" : "",
    secretText: text,
    many: nums.length > 1 || text.length > 4,
    hist: room.wheelLog.map((item) => ({ n: item.n, who: item.who })),
    again: won ? "เริ่มแมตช์ใหม่" : "รอบถัดไป",
    reset: won,
    winners: won && winner ? [winner] : [],
    winTarget: room.winTarget,
    mode: "wheel"
  };
}
function ownerOf(room, n) {
  for (const name of room.wheelOrder) {
    const list = room.picks[name];
    if (Array.isArray(list) && list.includes(n)) return name;
  }
  return "";
}
function wheelPool(room) {
  const gone = new Set(Array.isArray(room.wheelGone) ? room.wheelGone : []);
  const pool = [];
  for (let n = room.wheelMin; n <= room.wheelMax; n++) if (!gone.has(n)) pool.push(n);
  return pool;
}
function planNumSpin(room) {
  const pool = wheelPool(room);
  if (!pool.length) return null;
  const index = Math.floor(Math.random() * pool.length);
  const n = pool[index];
  const owner = ownerOf(room, n);
  const hit = !!(owner && room.wheelAlive.includes(owner));
  const span = pool.length;
  const slice = 360 / span;
  const margin = slice * 0.18;
  const roomj = Math.max(slice / 2 - margin, 0);
  const jitter = (Math.random() * 2 - 1) * roomj;
  const base = ((room.wheelRot % 360) + 360) % 360;
  const desiredMod = (((-index * slice + jitter) % 360) + 360) % 360;
  let delta = desiredMod - base;
  if (delta <= 0) delta += 360;
  const extra = hit ? 4 + Math.floor(Math.random() * 2) : 2;
  return { n, from: base, target: base + extra * 360 + delta, dur: hit ? 7200 : 3400, hit, owner };
}
function applyLand(room, plan) {
  room.wheelRot = plan.target;
  room.activeSpin = null;
  if (!Array.isArray(room.wheelGone)) room.wheelGone = [];
  if (!room.wheelGone.includes(plan.n)) room.wheelGone.push(plan.n);
  let angelDraw = false;
  if (plan.hit) {
    const player = byName(room, plan.owner);
    if (player && player.skipTurnGuard) {
      // Skip Turn: ละเว้นตัวเองเมื่อเลขตก — อยู่ต่อได้ทันที (ใช้คู่กับนางฟ้าได้)
      player.skipTurnGuard = false;
      room.wheelLog.push({ n: plan.n, who: plan.owner, skipSaved: true });
    } else if (player && player.angelGuard) {
      player.angelGuard = false;
      room.wheelLog.push({ n: plan.n, who: plan.owner, angelSaved: true });
      // pickEach ≤ 1 → เสมอ; pickEach > 1 และผู้เล่นในวงล้อ > 2 → ชุบต่อ
      const canRevive = Math.max(room.pickEach, 1) > 1 && (room.wheelAlive || []).length > 2;
      if (!canRevive) angelDraw = true;
    } else {
      const index = room.wheelAlive.indexOf(plan.owner);
      if (index >= 0) room.wheelAlive.splice(index, 1);
      room.wheelLog.push({ n: plan.n, who: plan.owner });
    }
  } else {
    room.wheelLog.push({ n: plan.n, who: "" });
  }
  return { angelDraw };
}
function beginNumSpin(room) {
  if (room.phase !== "wheel") return;
  if (room.wheelAlive.length < 2 || !wheelPool(room).length) {
    finishWheel(room);
    broadcast(room);
    return;
  }
  const plan = planNumSpin(room);
  if (!plan) {
    finishWheel(room);
    broadcast(room);
    return;
  }
  const id = crypto.randomUUID();
  room.activeSpin = {
    id,
    kind: "num",
    dur: plan.dur,
    until: Date.now() + plan.dur,
    from: plan.from,
    target: plan.target,
    n: plan.n,
    hit: plan.hit,
    owner: plan.owner
  };
  broadcast(room);
  room.timer = setTimeout(() => {
    if (!room.activeSpin || room.activeSpin.id !== id) return;
    const land = applyLand(room, plan) || {};
    const delay = !plan.hit ? 450 : land.angelDraw || room.wheelAlive.length <= 1 ? 1100 : 1400;
    broadcast(room);
    room.timer = setTimeout(() => {
      if (room.phase !== "wheel") return;
      if (land.angelDraw) {
        finishWheelDraw(room, plan.owner);
        broadcast(room);
      } else if (room.wheelAlive.length <= 1) {
        finishWheel(room);
        broadcast(room);
      } else beginNumSpin(room);
    }, delay);
  }, plan.dur);
}
function planOrderSpin(room) {
  const next = room.players.map((player) => player.name);
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = next[i];
    next[i] = next[j];
    next[j] = swap;
  }
  const names = room.players.map((player) => player.name);
  const index = Math.max(0, names.indexOf(next[0]));
  const slice = 360 / names.length;
  const margin = Math.min(slice * 0.12, 8);
  const jitter = margin + Math.random() * Math.max(slice - margin * 2, 0);
  const fromTop = index * slice + jitter;
  const current = ((room.rot % 360) + 360) % 360;
  let target = (360 - fromTop) % 360;
  let delta = target - current;
  if (delta < 0) delta += 360;
  const extra = 5 + Math.floor(Math.random() * 3);
  return { next, rot: room.rot + extra * 360 + delta, dur: 4300 };
}
function beginOrderSpin(room) {
  const plan = planOrderSpin(room);
  const id = crypto.randomUUID();
  room.activeSpin = {
    id,
    kind: "order",
    dur: plan.dur,
    until: Date.now() + plan.dur,
    from: room.rot,
    rot: plan.rot,
    next: plan.next
  };
  broadcast(room);
  room.timer = setTimeout(() => {
    if (!room.activeSpin || room.activeSpin.id !== id) return;
    room.order = plan.next.slice();
    room.rot = plan.rot;
    room.activeSpin = null;
    broadcast(room);
  }, plan.dur);
}
function dropFromRound(room, name) {
  room.order = room.order.filter((item) => item !== name);
  if (room.phase === "play") {
    room.alive = room.alive.filter((item) => item !== name);
    room.roundOrder = room.roundOrder.filter((item) => item !== name);
    if (room.turn >= room.alive.length) room.turn = 0;
    if (room.alive.length <= 1 || !room.secrets.length) finishRound(room);
    else skipToConnected(room);
  } else if (room.phase === "pick") {
    room.wheelOrder = room.wheelOrder.filter((item) => item !== name);
    delete room.picks[name];
    room.pickCursor = room.wheelOrder.reduce((sum, item) => sum + ((room.picks[item] || []).length), 0);
    if (room.wheelOrder.length < 2) {
      cancelSpin(room);
      room.phase = "lobby";
      clearAngelGuards(room);
    }
  } else if (room.phase === "cardmemory") {
    memoryBridge.dropPlayerByName(room, name);
    if (memoryBridge.finishIfDone(room, applyMemoryOver)) clearMemoryTimer(room);
    else armMemoryTimer(room);
  } else if (room.phase === "wheel") {
    cancelSpin(room);
    room.wheelAlive = room.wheelAlive.filter((item) => item !== name);
    room.wheelOrder = room.wheelOrder.filter((item) => item !== name);
    if (room.wheelAlive.length <= 1) finishWheel(room);
  }
}
function transferHost(room) {
  if (room.players.some((player) => player.id === room.hostId && !isBot(player))) return;
  const next = room.players.find((player) => !isBot(player) && player.connected) || room.players.find((player) => !isBot(player)) || null;
  room.hostId = next ? next.id : "";
}
function releaseSocket(ws, notify) {
  watchers.delete(ws);
  untrackPresence(ws);
  const ctx = byWs.get(ws);
  if (!ctx || ctx.player.ws !== ws) {
    byWs.delete(ws);
    return;
  }
  byWs.delete(ws);
  const { room, player } = ctx;
  player.connected = false;
  player.lastSeen = Date.now();
  player.ws = null;
  if (room.hostId === player.id) {
    const next = room.players.find((item) => !isBot(item) && item.connected);
    if (next) room.hostId = next.id;
  }
  if (notify) {
    watchers.add(ws);
    send(ws, { t: "left" });
    sendLobby(ws);
  }
  if (room.phase === "lobby") broadcast(room);
  else {
    if (room.phase === "play" && skipToConnected(room)) armTurnTimer(room);
    else if ((room.phase === "play" || room.phase === "pick" || room.phase === "snake") && player.auto) {
      armTurnTimer(room);
    }
    broadcast(room);
  }
  if (!hasHumanOnline(room)) scheduleDelete(room);
}
function tellLobby(sock) {
  if (!sock || sock.readyState !== 1) return;
  watchers.add(sock);
  send(sock, { t: "left" });
  sendLobby(sock);
}
function takeOut(room, player, ws, notify) {
  const name = player.name;
  if (player.ws) {
    const sock = player.ws;
    byWs.delete(sock);
    player.ws = null;
    if (notify && sock !== ws) tellLobby(sock);
  }
  byWs.delete(ws);
  if (notify) tellLobby(ws);
  room.players = room.players.filter((item) => item.id !== player.id);
  transferHost(room);
  if (room.phase === "lobby") {
    cancelSpin(room);
    room.order = [];
    room.rot = 0;
  } else dropFromRound(room, name);
  if (!room.players.length) scheduleDelete(room);
  else broadcast(room);
  broadcastLobby();
}
function seat(ws) {
  return byWs.get(ws) || null;
}
function hostOnly(ctx) {
  return !!(ctx && ctx.player.id === ctx.room.hostId);
}
function setInt(patch, key, min, max) {
  const value = patch[key];
  if (!Number.isInteger(value)) return null;
  return Math.min(max, Math.max(min, value));
}
async function onSetup(ws, msg) {
  const ctx = seat(ws);
  if (!ctx) return;
  if (!hostOnly(ctx)) return fail(ws, "เฉพาะโฮสต์ที่ตั้งค่าห้องได้");
  if (ctx.room.phase !== "lobby" || ctx.room.activeSpin) return;
  const patch = msg.patch && typeof msg.patch === "object" ? msg.patch : {};
  const room = ctx.room;
  const nextCat = normalizeGameCat(patch.cat);
  if (nextCat) {
    if (nextCat === "snake" && room.players.length > snakeBridge.MAX_PLAYERS) {
      return fail(ws, "บันไดงูรองรับได้สูงสุด " + snakeBridge.MAX_PLAYERS + " คน");
    }
    if (nextCat === "imposter" && room.players.length > imposterBridge.MAX_PLAYERS) {
      return fail(ws, "Imposter รองรับได้สูงสุด " + imposterBridge.MAX_PLAYERS + " คน");
    }
    if (nextCat === "cardmemory" && room.players.length > memoryBridge.MAX_PLAYERS) {
      return fail(ws, "Memory Card รองรับได้สูงสุด " + memoryBridge.MAX_PLAYERS + " คน");
    }
    if (nextCat === "werewolf" && room.players.length > werewolfBridge.MAX_PLAYERS) {
      return fail(ws, "Werewolf รองรับได้สูงสุด " + werewolfBridge.MAX_PLAYERS + " คน");
    }
    if (!(await assertComingSoonPlayable(ws, ctx.player, nextCat))) return;
    room.cat = nextCat;
  }
  if (patch.impostorInfo != null) {
    room.impostorInfo = imposterBridge.normalizeInfo(patch.impostorInfo);
  }
  if (patch.impostorCount != null) {
    room.impostorCount = imposterBridge.normalizeImpostorCount(
      patch.impostorCount,
      room.players.length
    );
  }
  if (Number.isInteger(patch.discussionSec)) {
    room.discussionSec = Math.min(180, Math.max(30, patch.discussionSec));
  }
  if (Number.isInteger(patch.voteSec)) {
    room.voteSec = Math.min(120, Math.max(20, patch.voteSec));
  }
  if (Number.isInteger(patch.clueSec)) {
    room.clueSec = Math.min(120, Math.max(15, patch.clueSec));
  }
  if (patch.clueRounds != null) {
    room.clueRounds = imposterBridge.normalizeClueRounds(patch.clueRounds);
  }
  if (patch.wordCategory != null) {
    room.wordCategory = imposterBridge.normalizeCategory(patch.wordCategory);
  }
  if (patch.memoryBoard != null) room.memoryBoard = memoryBridge.normalizeBoard(patch.memoryBoard);
  if (patch.memoryTurnSec != null) room.memoryTurnSec = memoryBridge.normalizeTurnSec(patch.memoryTurnSec);
  if (patch.memoryRevealMs != null) room.memoryRevealMs = memoryBridge.normalizeRevealMs(patch.memoryRevealMs);
  if (patch.memoryPoints != null) room.memoryPoints = memoryBridge.normalizePoints(patch.memoryPoints);
  if (patch.memoryCombo != null) room.memoryCombo = !!patch.memoryCombo;
  if (patch.memoryOnMatch != null) room.memoryOnMatch = memoryBridge.normalizeOnMatch(patch.memoryOnMatch);
  if (patch.memoryOnWrong != null) room.memoryOnWrong = memoryBridge.normalizeOnWrong(patch.memoryOnWrong);
  if (patch.wwNightSec != null) room.wwNightSec = werewolfBridge.normalizeNightSec(patch.wwNightSec);
  if (patch.wwDiscussionSec != null) {
    room.wwDiscussionSec = werewolfBridge.normalizeDiscussionSec(patch.wwDiscussionSec);
  }
  if (patch.wwVoteSec != null) room.wwVoteSec = werewolfBridge.normalizeVoteSec(patch.wwVoteSec);
  if (patch.wwTieRule != null) room.wwTieRule = werewolfBridge.normalizeTie(patch.wwTieRule);
  if (patch.wwAllowSelfProtect != null) room.wwAllowSelfProtect = !!patch.wwAllowSelfProtect;
  if (patch.rangeMode === "99" || patch.rangeMode === "999" || patch.rangeMode === "9999" || patch.rangeMode === "custom") {
    room.rangeMode = patch.rangeMode;
    if (patch.rangeMode === "99") { room.min = 1; room.max = 99; }
    if (patch.rangeMode === "999") { room.min = 1; room.max = 999; }
    if (patch.rangeMode === "9999") { room.min = 1; room.max = 9999; }
  }
  if (room.rangeMode === "custom") {
    const min = setInt(patch, "min", -1000000, 1000000);
    const max = setInt(patch, "max", -1000000, 1000000);
    if (min != null) room.min = min;
    if (max != null) room.max = max;
  }
  const winTarget = setInt(patch, "winTarget", 1, 999);
  const secretCount = setInt(patch, "secretCount", 1, SECRET_COUNT_MAX);
  const pickEach = setInt(patch, "pickEach", 1, 99);
  const turnSec = setInt(patch, "turnSec", 0, 120);
  if (winTarget != null) room.winTarget = winTarget;
  if (secretCount != null) room.secretCount = secretCount;
  if (pickEach != null) room.pickEach = pickEach;
  if (turnSec != null) room.turnSec = turnSec;
  if (typeof patch.pointAll === "boolean") room.pointAll = patch.pointAll;
  if (patch.snakeMapId != null) {
    room.snakeMapId = snakeBridge.normalizeMapId(patch.snakeMapId);
  }
  broadcast(room, { lobby: false });
}
function onSpinOrder(ws) {
  const ctx = seat(ws);
  if (!hostOnly(ctx)) return fail(ws, "เฉพาะโฮสต์ที่สุ่มลำดับได้");
  const room = ctx.room;
  if (room.phase !== "lobby" || room.activeSpin) return;
  if (liveCount(room) < 2) return fail(ws, "ต้องมีผู้เล่นอย่างน้อย 2 คน");
  beginOrderSpin(room);
}
function finishSnakeMatch(room, winnerId) {
  clearTurnTimer(room);
  const winner = room.players.find((p) => p.id === winnerId);
  const name = winner ? winner.name : "ผู้เล่น";
  if (winner) addPoint(room, name);
  setChampions(room, [name]);
  room.phase = "over";
  room.activeSpin = null;
  room.over = {
    title: name + " ชนะ!",
    note: "ขึ้นถึงช่อง 100",
    outOrder: [],
    secretLabel: "",
    secretText: "",
    many: false,
    hist: null,
    again: "เล่นอีกครั้ง",
    reset: true,
    winners: [name],
    winTarget: 1,
    mode: "snake",
    at: Date.now()
  };
}
function clearImposterTimer(room) {
  if (room && room.imposterTimer) {
    clearTimeout(room.imposterTimer);
    room.imposterTimer = null;
  }
}
function applyImposterOver(room, over) {
  clearTurnTimer(room);
  clearImposterTimer(room);
  room.phase = "over";
  room.activeSpin = null;
  const winners = Array.isArray(over.winners) ? over.winners : [];
  for (const name of winners) addPoint(room, name);
  if (winners.length) setChampions(room, winners);
  room.over = Object.assign(
    {
      outOrder: [],
      many: false,
      hist: null,
      again: "เล่นอีกครั้ง",
      reset: true,
      winTarget: 1,
      at: Date.now()
    },
    over
  );
}
function armImposterTimer(room) {
  clearImposterTimer(room);
  if (!room || room.phase !== "imposter" || !room.imposter) return;
  const ends = room.imposter.phaseEndsAt;
  if (!ends) return;
  const delay = Math.max(50, ends - Date.now() + 20);
  room.imposterTimer = setTimeout(() => onImposterTick(room), delay);
}
function onImposterTick(room) {
  if (!room || room.phase !== "imposter" || !room.imposter) return;
  imposterBridge.tickImposter(room);
  if (imposterBridge.finishIfDone(room, applyImposterOver)) {
    clearImposterTimer(room);
    broadcast(room);
    return;
  }
  armImposterTimer(room);
  broadcast(room);
}
function applyMemoryOver(room, over) {
  clearTurnTimer(room);
  clearMemoryTimer(room);
  room.phase = "over";
  room.activeSpin = null;
  const winners = Array.isArray(over.winners) ? over.winners : [];
  for (const name of winners) addPoint(room, name);
  if (winners.length) setChampions(room, winners);
  room.over = Object.assign(
    {
      outOrder: [],
      many: false,
      hist: null,
      again: "เล่นอีกครั้ง",
      reset: true,
      winTarget: 1,
      at: Date.now()
    },
    over
  );
}
function clearMemoryTimer(room) {
  if (room && room.memoryTimer) clearTimeout(room.memoryTimer);
  if (room) room.memoryTimer = null;
}
function armMemoryTimer(room) {
  clearMemoryTimer(room);
  if (!room || room.phase !== "cardmemory" || !room.memory) return;
  const ends = room.memory.phaseEndsAt;
  if (!ends) return;
  const delay = Math.max(50, ends - Date.now() + 20);
  room.memoryTimer = setTimeout(() => onMemoryTick(room), delay);
}
function onMemoryTick(room) {
  if (!room || room.phase !== "cardmemory" || !room.memory) return;
  memoryBridge.tickMemory(room);
  if (memoryBridge.finishIfDone(room, applyMemoryOver)) {
    clearMemoryTimer(room);
    broadcast(room);
    return;
  }
  armMemoryTimer(room);
  broadcast(room);
}
function onMemoryFlip(ws, msg) {
  const ctx = seat(ws);
  if (!ctx || ctx.room.phase !== "cardmemory" || !ctx.room.memory) return;
  const res = memoryBridge.flipMemory(ctx.room, ctx.player.id, msg && msg.cardId);
  if (!res.ok) {
    const map = {
      not_your_turn: "ยังไม่ถึงตาคุณ",
      taken: "การ์ดใบนี้เปิดอยู่แล้ว",
      bad_card: "เลือกการ์ดไม่ได้",
      wrong_phase: "รอการ์ดคว่ำก่อน",
      finished: "เกมจบแล้ว"
    };
    return fail(ws, map[res.error] || "เปิดการ์ดไม่สำเร็จ");
  }
  if (memoryBridge.finishIfDone(ctx.room, applyMemoryOver)) {
    clearMemoryTimer(ctx.room);
    broadcast(ctx.room);
    return;
  }
  armMemoryTimer(ctx.room);
  broadcast(ctx.room);
}
function afterImposterAction(room) {
  if (imposterBridge.finishIfDone(room, applyImposterOver)) {
    clearImposterTimer(room);
    broadcast(room);
    return;
  }
  armImposterTimer(room);
  broadcast(room);
}

function clearWerewolfTimer(room) {
  if (room && room.werewolfTimer) {
    clearTimeout(room.werewolfTimer);
    room.werewolfTimer = null;
  }
}
function applyWerewolfOver(room, over) {
  clearTurnTimer(room);
  clearWerewolfTimer(room);
  room.phase = "over";
  room.activeSpin = null;
  const winners = Array.isArray(over.winners) ? over.winners : [];
  for (const name of winners) addPoint(room, name);
  if (winners.length) setChampions(room, winners);
  room.over = Object.assign(
    {
      outOrder: [],
      many: false,
      hist: null,
      again: "เล่นอีกครั้ง",
      reset: true,
      winTarget: 1,
      at: Date.now()
    },
    over
  );
}
function armWerewolfTimer(room) {
  clearWerewolfTimer(room);
  if (!room || room.phase !== "werewolf" || !room.werewolf) return;
  const ends = room.werewolf.phaseEndsAt;
  if (!ends) return;
  const delay = Math.max(50, ends - Date.now() + 20);
  room.werewolfTimer = setTimeout(() => onWerewolfTick(room), delay);
}
function onWerewolfTick(room) {
  if (!room || room.phase !== "werewolf" || !room.werewolf) return;
  werewolfBridge.tickWerewolf(room);
  if (werewolfBridge.finishIfDone(room, applyWerewolfOver)) {
    clearWerewolfTimer(room);
    broadcast(room);
    return;
  }
  armWerewolfTimer(room);
  broadcast(room);
}
function afterWerewolfAction(room) {
  if (werewolfBridge.finishIfDone(room, applyWerewolfOver)) {
    clearWerewolfTimer(room);
    broadcast(room);
    return;
  }
  armWerewolfTimer(room);
  broadcast(room);
}
function onWerewolfConfirm(ws) {
  const ctx = seat(ws);
  if (!ctx || ctx.room.phase !== "werewolf" || !ctx.room.werewolf) return;
  const res = werewolfBridge.confirmReveal(ctx.room.werewolf, ctx.player.id);
  if (!res.ok) return fail(ws, "ยืนยันบทบาทไม่ได้");
  werewolfBridge.autoPlayBots(ctx.room);
  afterWerewolfAction(ctx.room);
}
function onWerewolfNight(ws, msg) {
  const ctx = seat(ws);
  if (!ctx || ctx.room.phase !== "werewolf" || !ctx.room.werewolf) return;
  const res = werewolfBridge.submitNightAction(ctx.room.werewolf, ctx.player.id, {
    type: msg && msg.type,
    targetId: msg && msg.targetId
  });
  if (!res.ok) {
    const map = {
      wrong_phase: "ยังไม่ถึงช่วงกลางคืน",
      not_alive: "ผู้เล่นที่ตายแล้วใช้ความสามารถไม่ได้",
      already_acted: "ส่งแอ็กชันไปแล้ว",
      bad_action: "แอ็กชันไม่ถูกต้อง",
      bad_target: "เลือกเป้าหมายไม่ได้",
      pack_mate: "หมาป่าโจมตีพวกเดียวกันไม่ได้",
      no_self: "ปกป้องตัวเองไม่ได้",
      same_protect: "ห้ามปกป้องคนเดิมติดกันสองคืน",
      no_heal: "ยาชุบชีวิตหมดแล้ว",
      no_poison: "ยาพิษหมดแล้ว",
      no_night_action: "บทบาทนี้ไม่มีแอ็กชันกลางคืน"
    };
    return fail(ws, map[res.error] || "ส่งแอ็กชันไม่สำเร็จ");
  }
  if (werewolfBridge.nightActorsDone(ctx.room.werewolf)) {
    werewolfBridge.resolveNight(ctx.room.werewolf);
  }
  werewolfBridge.autoPlayBots(ctx.room);
  afterWerewolfAction(ctx.room);
}
function onWerewolfVote(ws, msg) {
  const ctx = seat(ws);
  if (!ctx || ctx.room.phase !== "werewolf" || !ctx.room.werewolf) return;
  const res = werewolfBridge.submitVote(ctx.room.werewolf, ctx.player.id, msg && msg.targetId);
  if (!res.ok) {
    const map = {
      wrong_phase: "ยังไม่ถึงช่วงโหวต",
      not_alive: "ผู้เล่นที่ตายแล้วโหวตไม่ได้",
      already_voted: "โหวตไปแล้ว",
      self_vote: "โหวตตัวเองไม่ได้",
      bad_target: "เลือกเป้าหมายไม่ได้"
    };
    return fail(ws, map[res.error] || "โหวตไม่สำเร็จ");
  }
  werewolfBridge.autoPlayBots(ctx.room);
  afterWerewolfAction(ctx.room);
}
function onWerewolfHunter(ws, msg) {
  const ctx = seat(ws);
  if (!ctx || ctx.room.phase !== "werewolf" || !ctx.room.werewolf) return;
  const res = werewolfBridge.hunterShot(ctx.room.werewolf, ctx.player.id, msg && msg.targetId);
  if (!res.ok) {
    const map = {
      wrong_phase: "ยังไม่ถึงช่วงนักล่ายิง",
      not_hunter: "คุณไม่ใช่นักล่าที่ต้องยิง",
      bad_target: "เลือกเป้าหมายไม่ได้"
    };
    return fail(ws, map[res.error] || "ยิงไม่สำเร็จ");
  }
  werewolfBridge.autoPlayBots(ctx.room);
  afterWerewolfAction(ctx.room);
}

function onStart(ws) {
  const ctx = seat(ws);
  if (!hostOnly(ctx)) return fail(ws, "เฉพาะโฮสต์ที่เริ่มเกมได้");
  const room = ctx.room;
  if (room.phase !== "lobby" || room.activeSpin) return;
  if (liveCount(room) < 2) return fail(ws, "ต้องมีผู้เล่นอย่างน้อย 2 คน");
  if (room.players.some((item) => !isBot(item) && !item.connected)) return fail(ws, "มีผู้เล่นที่หลุดอยู่ รอให้กลับหรือเอาออกก่อน");
  if (!orderReady(room)) return fail(ws, "กดสุ่มลำดับก่อนเริ่มเกม");
  if (room.cat === "snake") {
    if (room.players.length > snakeBridge.MAX_PLAYERS) {
      return fail(ws, "บันไดงูรองรับได้สูงสุด " + snakeBridge.MAX_PLAYERS + " คน");
    }
    if (room.players.length < snakeBridge.MIN_PLAYERS) {
      return fail(ws, "ต้องมีผู้เล่นอย่างน้อย " + snakeBridge.MIN_PLAYERS + " คน");
    }
    try {
      clearChampions(room);
      snakeBridge.startSnake(room);
    } catch (err) {
      return fail(ws, err && err.code === "invalid_player_count" ? "จำนวนผู้เล่นไม่ถูกต้อง" : "เริ่มเกมบันไดงูไม่สำเร็จ");
    }
    armTurnTimer(room);
    broadcast(room);
    return;
  }
  if (room.cat === "imposter") {
    if (room.players.length > imposterBridge.MAX_PLAYERS) {
      return fail(ws, "Imposter รองรับได้สูงสุด " + imposterBridge.MAX_PLAYERS + " คน");
    }
    if (room.players.length < imposterBridge.MIN_PLAYERS) {
      return fail(ws, "ต้องมีผู้เล่นอย่างน้อย " + imposterBridge.MIN_PLAYERS + " คน");
    }
    try {
      clearChampions(room);
      imposterBridge.startImposter(room);
    } catch (err) {
      return fail(
        ws,
        err && err.code === "invalid_player_count" ? "จำนวนผู้เล่นไม่ถูกต้อง" : "เริ่มเกม Imposter ไม่สำเร็จ"
      );
    }
    armImposterTimer(room);
    broadcast(room);
    return;
  }
  if (room.cat === "cardmemory") {
    if (room.players.length > memoryBridge.MAX_PLAYERS) {
      return fail(ws, "Memory Card รองรับได้สูงสุด " + memoryBridge.MAX_PLAYERS + " คน");
    }
    if (room.players.length < memoryBridge.MIN_PLAYERS) {
      return fail(ws, "ต้องมีผู้เล่นอย่างน้อย " + memoryBridge.MIN_PLAYERS + " คน");
    }
    try {
      clearChampions(room);
      memoryBridge.startMemory(room);
    } catch (err) {
      return fail(ws, err && err.code === "invalid_player_count" ? "จำนวนผู้เล่นไม่ถูกต้อง" : "เริ่ม Memory Card ไม่สำเร็จ");
    }
    armMemoryTimer(room);
    broadcast(room);
    return;
  }
  if (room.cat === "werewolf") {
    if (room.players.length > werewolfBridge.MAX_PLAYERS) {
      return fail(ws, "Werewolf รองรับได้สูงสุด " + werewolfBridge.MAX_PLAYERS + " คน");
    }
    if (room.players.length < werewolfBridge.MIN_PLAYERS) {
      return fail(ws, "ต้องมีผู้เล่นอย่างน้อย " + werewolfBridge.MIN_PLAYERS + " คน");
    }
    try {
      clearChampions(room);
      werewolfBridge.startWerewolf(room);
    } catch (err) {
      return fail(
        ws,
        err && err.code === "invalid_player_count" ? "จำนวนผู้เล่นไม่ถูกต้อง" : "เริ่ม Werewolf ไม่สำเร็จ"
      );
    }
    armWerewolfTimer(room);
    broadcast(room);
    return;
  }
  const rangeErr = checkRange(room.min, room.max);
  const winErr = checkWin(room.winTarget);
  if (room.cat === "wheel") {
    const each = room.pickEach;
    const eachErr = !Number.isInteger(each) || each < 1 ? "จำนวนเลขต่อคนต้องเป็นจำนวนเต็มตั้งแต่ 1" : each > 99 ? "จำนวนเลขต่อคนต้องไม่เกิน 99" : "";
    const err = rangeErr || winErr || eachErr;
    if (err) return fail(ws, err);
    if (room.players.length * each > room.max - room.min + 1) return fail(ws, "เลขในช่วงไม่พอให้ทุกคนเลือก");
    startPick(room);
    broadcast(room);
    return;
  }
  const err = rangeErr || checkCount(room.min, room.max, room.secretCount) || winErr;
  if (err) return fail(ws, err);
  begin(room);
  broadcast(room);
}

function onRoll(ws, msg) {
  const ctx = seat(ws);
  if (!ctx || ctx.room.phase !== "snake") return;
  const room = ctx.room;
  if (!room.snake || room.snake.status !== "playing") return;
  processPendingSkipSnake(room);
  if (!yourTurn(room, ctx.player)) return fail(ws, "ยังไม่ถึงตาคุณ");
  const commandId = msg && msg.commandId != null ? String(msg.commandId).slice(0, 64) : null;
  const wantParity = msg && (msg.parity === "even" || msg.parity === "odd") ? msg.parity : null;
  if (wantParity) {
    const left = Math.max(0, Number(ctx.player.evenOddCharges) || 0);
    if (left < 1) return fail(ws, "ใช้คู่/คี่ครบแล้วในเกมนี้");
  }
  const { result, error } = snakeBridge.applySnakeRoll(room, ctx.player.id, {
    commandId,
    parity: wantParity
  });
  if (error) {
    const code = error.code || "";
    if (code === "not_your_turn") return fail(ws, "ยังไม่ถึงตาคุณ");
    if (code === "duplicate_command") return;
    return fail(ws, "ทอยลูกเต๋าไม่สำเร็จ");
  }
  if (wantParity) {
    ctx.player.evenOddCharges = Math.max(0, (Number(ctx.player.evenOddCharges) || 0) - 1);
  }
  if (result.finished) finishSnakeMatch(room, result.state.winnerId);
  else armTurnTimer(room);
  broadcast(room);
}
function taken(room) {
  const set = new Set();
  room.wheelOrder.forEach((name) => (room.picks[name] || []).forEach((n) => set.add(n)));
  return set;
}
function onPick(ws, msg) {
  const ctx = seat(ws);
  if (!ctx || ctx.room.phase !== "play") return;
  const room = ctx.room;
  const who = currentName(room);
  if (ctx.player.name !== who) return fail(ws, "ยังไม่ถึงตาคุณ");
  const n = msg.n;
  if (!Number.isSafeInteger(n)) return fail(ws, "ใส่เป็นจำนวนเต็ม");
  if (n < room.lo || n > room.hi) return fail(ws, "เลือกเลขระหว่าง " + room.lo + " ถึง " + room.hi);
  if (room.picked.some((item) => item.n === n)) return fail(ws, "เลขนี้ถูกเลือกแล้ว");
  applyPlayChoice(room, who, n);
  broadcast(room);
}
function onPickNum(ws, msg) {
  const ctx = seat(ws);
  if (!ctx || ctx.room.phase !== "pick") return;
  const room = ctx.room;
  const each = Math.max(room.pickEach, 1);
  const total = room.wheelOrder.length * each;
  if (room.pickCursor >= total) return;
  const name = room.wheelOrder[Math.floor(room.pickCursor / each)];
  if (ctx.player.name !== name) return fail(ws, "ยังไม่ถึงตาคุณ");
  const n = msg.n;
  if (!Number.isSafeInteger(n)) return fail(ws, "ใส่เป็นจำนวนเต็ม");
  if (n < room.wheelMin || n > room.wheelMax) return fail(ws, "เลือกเลขระหว่าง " + room.wheelMin + " ถึง " + room.wheelMax);
  if (taken(room).has(n)) return fail(ws, "เลขนี้มีคนเลือกแล้ว");
  applyPickChoice(room, name, n);
  broadcast(room);
}
function onUndo(ws) {
  const ctx = seat(ws);
  if (!ctx || ctx.room.phase !== "pick" || ctx.room.activeSpin) return;
  const room = ctx.room;
  if (room.pickCursor <= 0) return;
  const each = Math.max(room.pickEach, 1);
  const name = room.wheelOrder[Math.floor((room.pickCursor - 1) / each)];
  if (ctx.player.name !== name && ctx.player.id !== room.hostId) return fail(ws, "ย้อนได้เฉพาะเลขของตัวเอง");
  room.pickCursor -= 1;
  const list = room.picks[name] || [];
  list.pop();
  if (!list.length) delete room.picks[name];
  armTurnTimer(room);
  broadcast(room);
}
function onOpenWheel(ws) {
  const ctx = seat(ws);
  if (!hostOnly(ctx)) return fail(ws, "เฉพาะโฮสต์ที่เริ่มหมุนได้");
  const room = ctx.room;
  if (room.phase !== "pick") return;
  const total = room.wheelOrder.length * Math.max(room.pickEach, 1);
  if (!room.wheelOrder.length || room.pickCursor < total) return fail(ws, "ยังเลือกเลขไม่ครบ");
  cancelSpin(room);
  clearTurnTimer(room);
  room.wheelAlive = room.wheelOrder.slice();
  room.wheelLog = [];
  room.wheelGone = [];
  room.wheelRot = 0;
  room.phase = "wheel";
  broadcast(room);
}
function onSpinNum(ws) {
  const ctx = seat(ws);
  if (!hostOnly(ctx)) return fail(ws, "เฉพาะโฮสต์ที่หมุนวงล้อได้");
  const room = ctx.room;
  if (room.phase !== "wheel" || room.activeSpin) return;
  if (room.wheelAlive.length < 2) return;
  beginNumSpin(room);
}
function onRepick(ws) {
  const ctx = seat(ws);
  if (!hostOnly(ctx)) return fail(ws, "เฉพาะโฮสต์");
  const room = ctx.room;
  if (room.phase !== "wheel" || room.activeSpin || room.wheelLog.length) return;
  room.picks = {};
  room.pickCursor = 0;
  room.wheelGone = [];
  room.phase = "pick";
  armTurnTimer(room);
  broadcast(room);
}
function onAgain(ws) {
  const ctx = seat(ws);
  if (!hostOnly(ctx)) return fail(ws, "เฉพาะโฮสต์ที่เริ่มรอบใหม่ได้");
  const room = ctx.room;
  if (room.phase !== "over" || !room.over) return;
  if (!orderReady(room)) {
    // Back to lobby: reset scores only if the match already had a winner.
    const resetScores = !!room.over.reset;
    room.phase = "lobby";
    room.order = [];
    room.over = null;
    clearAngelGuards(room);
    if (resetScores) clearPoints(room);
    broadcast(room);
    return fail(ws, "ผู้เล่นในห้องเปลี่ยน กลับไปสุ่มลำดับใหม่");
  }
  // Continue match: wipe scores only after someone hit winTarget.
  if (room.over.reset) clearPoints(room);
  if (room.over.mode === "wheel") startPick(room);
  else if (room.over.mode === "snake" || room.cat === "snake") {
    try {
      clearChampions(room);
      snakeBridge.startSnake(room);
      armTurnTimer(room);
    } catch (err) {
      room.phase = "lobby";
      room.over = null;
      snakeBridge.clearSnake(room);
      return fail(ws, "เริ่มบันไดงูรอบใหม่ไม่สำเร็จ");
    }
  } else if (room.over.mode === "imposter" || room.cat === "imposter") {
    try {
      clearChampions(room);
      imposterBridge.startImposter(room);
      armImposterTimer(room);
    } catch (err) {
      room.phase = "lobby";
      room.over = null;
      imposterBridge.clearImposter(room);
      return fail(ws, "เริ่ม Imposter รอบใหม่ไม่สำเร็จ");
    }
  } else if (room.over.mode === "cardmemory" || room.cat === "cardmemory") {
    try {
      clearChampions(room);
      memoryBridge.startMemory(room);
      armMemoryTimer(room);
    } catch (err) {
      room.phase = "lobby";
      room.over = null;
      memoryBridge.clearMemory(room);
      return fail(ws, "เริ่ม Memory Card รอบใหม่ไม่สำเร็จ");
    }
  } else if (room.over.mode === "werewolf" || room.cat === "werewolf") {
    try {
      clearChampions(room);
      werewolfBridge.startWerewolf(room);
      armWerewolfTimer(room);
    } catch (err) {
      room.phase = "lobby";
      room.over = null;
      werewolfBridge.clearWerewolf(room);
      return fail(ws, "เริ่ม Werewolf รอบใหม่ไม่สำเร็จ");
    }
  } else begin(room);
  broadcast(room);
}
function onAbort(ws) {
  const ctx = seat(ws);
  if (!hostOnly(ctx)) return fail(ws, "เฉพาะโฮสต์ที่พากลับห้องได้");
  const room = ctx.room;
  // If returning from a finished match that reached winTarget → reset lobby scores.
  // Otherwise keep scores so the series can continue.
  const resetScores = room.phase === "over" && !!(room.over && room.over.reset);
  cancelSpin(room);
  clearTurnTimer(room);
  room.phase = "lobby";
  room.over = null;
  room.picked = [];
  room.alive = [];
  room.roundOrder = [];
  room.secrets = [];
  room.secretAll = [];
  room.wheelLog = [];
  room.wheelGone = [];
  room.wheelAlive = [];
  room.wheelOrder = [];
  room.picks = {};
  room.pickCursor = 0;
  snakeBridge.clearSnake(room);
  clearImposterTimer(room);
  imposterBridge.clearImposter(room);
  clearMemoryTimer(room);
  memoryBridge.clearMemory(room);
  clearWerewolfTimer(room);
  werewolfBridge.clearWerewolf(room);
  clearAngelGuards(room);
  room.players.forEach((player) => {
    if (!isBot(player)) player.auto = false;
  });
  if (resetScores) clearPoints(room);
  broadcast(room);
}
function onClear(ws) {
  const ctx = seat(ws);
  if (!hostOnly(ctx)) return;
  const room = ctx.room;
  if (
    room.phase === "play" ||
    room.phase === "pick" ||
    room.phase === "wheel" ||
    room.phase === "snake" ||
    room.phase === "imposter" ||
    room.phase === "cardmemory" ||
    room.phase === "werewolf"
  ) {
    return;
  }
  clearPoints(room);
  broadcast(room);
}
function onKick(ws, msg) {
  const ctx = seat(ws);
  if (!hostOnly(ctx)) return;
  const id = typeof msg.id === "string" ? msg.id : "";
  if (!id || id === ctx.player.id) return;
  const target = ctx.room.players.find((player) => player.id === id);
  if (!target) return;
  takeOut(ctx.room, target, target.ws, true);
}
function onGiveHost(ws, msg) {
  const ctx = seat(ws);
  if (!hostOnly(ctx)) return fail(ws, "เฉพาะโฮสต์ที่โอนโฮสต์ได้");
  if (ctx.room.phase !== "lobby") return fail(ws, "โอนโฮสต์ได้เฉพาะตอนอยู่ในล็อบบี้");
  const id = typeof msg.id === "string" ? msg.id : "";
  if (!id || id === ctx.player.id) return fail(ws, "เลือกผู้เล่นอื่นเพื่อโอนโฮสต์");
  const target = ctx.room.players.find((player) => player.id === id);
  if (!target) return fail(ws, "ไม่พบผู้เล่น");
  if (isBot(target)) return fail(ws, "โอนโฮสต์ให้บอทไม่ได้");
  if (!target.connected) return fail(ws, "ผู้เล่นหลุดการเชื่อมต่อ");
  ctx.room.hostId = target.id;
  broadcast(ctx.room);
  broadcastLobby();
}
function onDeleteRoom(ws) {
  const ctx = seat(ws);
  if (!hostOnly(ctx)) return fail(ws, "เฉพาะโฮสต์ที่ลบห้องได้");
  const room = ctx.room;
  if (room.phase !== "lobby") return fail(ws, "ลบห้องได้เฉพาะตอนล็อบบี้");
  if (room.activeSpin) return fail(ws, "รอวงล้อสุ่มให้จบก่อน");
  cancelSpin(room);
  clearTurnTimer(room);
  if (room.emptyTimer) {
    clearTimeout(room.emptyTimer);
    room.emptyTimer = null;
  }
  const everyone = room.players.slice();
  const spectators = Array.isArray(room.spectators) ? room.spectators.slice() : [];
  rooms.delete(room.code);
  broadcastLobby();
  for (const player of everyone) {
    const sock = player.ws;
    if (sock) {
      byWs.delete(sock);
      player.ws = null;
      send(sock, { t: "roomClosed", message: "โฮสต์ลบห้องแล้ว" });
      tellLobby(sock);
    }
  }
  for (const sp of spectators) {
    const sock = sp.ws;
    if (!sock) continue;
    byWs.delete(sock);
    send(sock, { t: "roomClosed", message: "โฮสต์ลบห้องแล้ว" });
    tellLobby(sock);
  }
}
function onAddBot(ws) {
  const ctx = seat(ws);
  if (!hostOnly(ctx)) return fail(ws, "เฉพาะโฮสต์ที่เพิ่มบอทได้");
  const room = ctx.room;
  if (room.phase !== "lobby" || room.activeSpin) return fail(ws, "เพิ่มบอทได้เฉพาะตอนอยู่ในล็อบบี้");
  if (room.players.length >= roomMaxPlayers(room)) return fail(ws, "ห้องเต็ม");
  room.players.push(makeBot(room));
  cancelSpin(room);
  room.order = [];
  room.rot = 0;
  broadcast(room);
  broadcastLobby();
}
function onAuto(ws, msg) {
  const ctx = seat(ws);
  if (!ctx) return;
  if (isBot(ctx.player)) return;
  const room = ctx.room;
  if (room.phase !== "play" && room.phase !== "pick" && room.phase !== "snake") {
    return fail(ws, "เปิดออโต้ได้ตอนกำลังเล่นเท่านั้น");
  }
  ctx.player.auto = !!msg.on;
  if (ctx.player.auto && yourTurn(room, ctx.player)) armTurnTimer(room);
  broadcast(room);
}
function swapName(list, from, to) {
  if (!Array.isArray(list)) return list;
  return list.map((item) => (item === from ? to : item));
}
function renameInRoom(room, player, nextName) {
  const prev = player.name;
  if (prev === nextName) return true;
  if (room.players.some((item) => item.id !== player.id && item.name.toLowerCase() === nextName.toLowerCase())) return false;
  player.name = nextName;
  room.order = swapName(room.order, prev, nextName);
  room.alive = swapName(room.alive, prev, nextName);
  room.roundOrder = swapName(room.roundOrder, prev, nextName);
  room.wheelOrder = swapName(room.wheelOrder, prev, nextName);
  room.wheelAlive = swapName(room.wheelAlive, prev, nextName);
  if (Object.prototype.hasOwnProperty.call(room.picks, prev)) {
    room.picks[nextName] = room.picks[prev];
    delete room.picks[prev];
  }
  room.picked = room.picked.map((item) => (item && item.who === prev ? { ...item, who: nextName } : item));
  room.wheelLog = room.wheelLog.map((item) => (item && item.who === prev ? { ...item, who: nextName } : item));
  if (room.activeSpin && room.activeSpin.owner === prev) room.activeSpin.owner = nextName;
  return true;
}
function onRename(ws, msg) {
  const name = cleanName(msg.name);
  if (!name) return fail(ws, "ใส่ชื่อก่อน");
  ws.pendingName = name;
  const ctx = seat(ws);
  if (!ctx) return send(ws, { t: "renamed", name });
  if (ctx.room.phase !== "lobby") return fail(ws, "เปลี่ยนชื่อผู้เล่นได้เฉพาะตอนอยู่ในล็อบบี้");
  if (!renameInRoom(ctx.room, ctx.player, name)) return fail(ws, "มีชื่อนี้ในห้องแล้ว");
  broadcast(ctx.room);
  send(ws, { t: "renamed", name });
}
function onRenameRoom(ws, msg) {
  const ctx = seat(ws);
  if (!hostOnly(ctx)) return fail(ws, "เฉพาะโฮสต์ที่เปลี่ยนชื่อห้องได้");
  if (ctx.room.phase !== "lobby") return fail(ws, "เปลี่ยนชื่อห้องได้เฉพาะตอนอยู่ในล็อบบี้");
  const title = cleanRoomTitle(msg.title);
  if (!title) return fail(ws, "ใส่ชื่อห้องก่อน");
  ctx.room.title = title;
  broadcast(ctx.room);
}
function identity(ws, msg) {
  const name = cleanName(msg.name) || ws.pendingName;
  const token = validToken(msg.token) ? msg.token : validToken(ws.token) ? ws.token : crypto.randomUUID();
  const avatarUrl = cleanAvatar(msg.avatarUrl);
  ws.token = token;
  trackPresence(ws, token);
  return { name, token, avatarUrl };
}
async function hydratePlayerProfile(player) {
  if (!player || player.bot || !authEnabled()) return player;
  const id = validToken(player.id) ? player.id : "";
  if (!id) return player;
  try {
    const prisma = await getPrisma();
    const u = await prisma.user.findUnique({
      where: { id },
      select: {
        gender: true,
        age: true,
        userRoles: { select: { role: { select: { name: true } } } },
        equippedTitle: { select: { name: true, cssClass: true } },
        equippedFrame: { select: { cssClass: true, meta: true } },
        equippedEffect: { select: { cssClass: true, meta: true } }
      }
    });
    if (!u) return player;
    player.gender = u.gender || null;
    player.age = u.age == null ? null : u.age;
    player.roles = (u.userRoles || []).map((ur) => ur.role && ur.role.name).filter(Boolean);
    player.title = (u.equippedTitle && u.equippedTitle.name) || null;
    player.titleClass = (u.equippedTitle && u.equippedTitle.cssClass) || null;
    const frameMeta = (u.equippedFrame && u.equippedFrame.meta) || null;
    const effectMeta = (u.equippedEffect && u.equippedEffect.meta) || null;
    const frameUseFx = !(frameMeta && frameMeta.useSystemEffect === false);
    const effectUseFx = !(effectMeta && effectMeta.useSystemEffect === false);
    player.frameClass =
      frameUseFx && u.equippedFrame && u.equippedFrame.cssClass
        ? u.equippedFrame.cssClass
        : null;
    player.effectClass =
      effectUseFx && u.equippedEffect && u.equippedEffect.cssClass
        ? u.equippedEffect.cssClass
        : null;
    player.frameImage = (frameMeta && frameMeta.imageUrl) || null;
    player.effectImage = (effectMeta && effectMeta.imageUrl) || null;
  } catch (_) {
    /* ignore */
  }
  return player;
}
async function assertNotMaintenance(ws, msg) {
  try {
    const maint = await getMaintenanceState();
    if (!maint.enabled) return true;
    const token = validToken(msg && msg.token) ? msg.token : validToken(ws.token) ? ws.token : "";
    if (token && (await userBypassesMaintenance(token))) return true;
    fail(ws, maint.message || "ระบบปิดปรับปรุงชั่วคราว");
    return false;
  } catch {
    return true;
  }
}
async function assertComingSoonPlayable(ws, player, cat) {
  try {
    if (!authEnabled()) return true;
    const { assertCatPlayable } = require("./src/dashboard/game-catalog-flags");
    const prisma = await getPrisma();
    const check = await assertCatPlayable(prisma, cat, {
      roles: player && player.roles,
      isAdmin: !!(ws && ws.isAdmin),
      userId: player && player.id
    });
    if (check.ok) return true;
    fail(ws, "เกมนี้ Coming Soon — ต้องได้รับคำเชิญทดสอบจากแอดมิน");
    return false;
  } catch {
    return true;
  }
}
async function onCreate(ws, msg) {
  if (!(await assertNotMaintenance(ws, msg))) return;
  const { name, token, avatarUrl } = identity(ws, msg);
  if (!name) return fail(ws, "ใส่ชื่อก่อน");
  if (rooms.size >= MAX_ROOMS) return fail(ws, "เซิร์ฟเวอร์เต็ม ลองใหม่ภายหลัง");
  const code = makeCode();
  if (!code) return fail(ws, "สร้างห้องไม่สำเร็จ ลองใหม่");
  const old = findSeat(token);
  if (old) takeOut(old.room, old.player, ws);
  const player = { id: token, name, avatarUrl, ws: null, connected: true, bot: false, auto: false, scoreSecret: 0, scoreWheel: 0, lastSeen: Date.now() };
  await hydratePlayerProfile(player);
  const room = blankRoom(code, msg.visibility === "private" ? "private" : "public", player);
  if (msg.title) room.title = cleanRoomTitle(msg.title) || room.title;
  applyRoomSetup(room, msg.setup);
  if (!(await assertComingSoonPlayable(ws, player, room.cat))) return;
  rooms.set(code, room);
  attach(ws, room, player);
  try {
    const { logActivity } = require("./src/system/activity-log");
    logActivity({
      userId: player.id,
      action: "room_create",
      metadata: {
        code: room.code,
        visibility: room.visibility,
        cat: room.cat,
        title: room.title || ""
      }
    });
  } catch {
    /* ignore */
  }
}
function detachSpectator(ws) {
  for (const room of rooms.values()) {
    if (!Array.isArray(room.spectators)) continue;
    const before = room.spectators.length;
    room.spectators = room.spectators.filter((sp) => sp.ws !== ws);
    if (room.spectators.length !== before) broadcastLobby();
  }
}
async function onWatch(ws, msg) {
  const code = String(msg.code || "").trim();
  if (!/^\d{6}$/.test(code)) return fail(ws, "รหัสต้องเป็นตัวเลข 6 หลัก");
  const room = rooms.get(code);
  if (!room) return fail(ws, "ไม่พบห้องนี้");
  if (room.phase === "lobby") return fail(ws, "เกมยังไม่เริ่ม — เข้าเป็นผู้เล่นแทน");
  if (room.visibility === "private") {
    const token = validToken(msg.token) ? msg.token : validToken(ws.token) ? ws.token : "";
    if (token) ws.token = token;
    const admin = ws.isAdmin || (token && (await userBypassesMaintenance(token)));
    if (!admin) return fail(ws, "ห้องส่วนตัวไม่เปิดให้ชม");
    ws.isAdmin = true;
  }
  detachSpectator(ws);
  const seatCtx = seat(ws);
  if (seatCtx) takeOut(seatCtx.room, seatCtx.player, ws, false);
  watchers.delete(ws);
  if (!Array.isArray(room.spectators)) room.spectators = [];
  const token = validToken(msg.token) ? msg.token : crypto.randomUUID();
  ws.token = token;
  room.spectators = room.spectators.filter((sp) => sp.ws !== ws && sp.id !== token);
  room.spectators.push({ id: token, ws, name: cleanName(msg.name) || "Viewer" });
  send(ws, snap(room, null, { spectator: true }));
  broadcastLobby();
}
function onUnwatch(ws) {
  detachSpectator(ws);
  watchers.add(ws);
  send(ws, { t: "left" });
  sendLobby(ws);
}
async function onJoin(ws, msg) {
  const code = String(msg.code || "").trim();
  if (!/^\d{6}$/.test(code)) return fail(ws, "รหัสต้องเป็นตัวเลข 6 หลัก");
  const room = rooms.get(code);
  if (!room) return fail(ws, "ไม่พบห้องนี้");
  const { name, token, avatarUrl } = identity(ws, msg);
  const existing = room.players.find((player) => player.id === token);
  if (existing) {
    if (avatarUrl) existing.avatarUrl = avatarUrl;
    if (name) existing.name = name;
    await hydratePlayerProfile(existing);
    attach(ws, room, existing);
    return;
  }
  if (!(await assertNotMaintenance(ws, msg))) return;
  if (!name) return fail(ws, "ใส่ชื่อก่อน");
  if (room.phase !== "lobby") return fail(ws, "ห้องนี้เริ่มเกมแล้ว");
  if (room.players.length >= roomMaxPlayers(room)) return fail(ws, "ห้องเต็ม");
  if (room.players.some((player) => player.name.toLowerCase() === name.toLowerCase())) return fail(ws, "มีชื่อนี้ในห้องแล้ว");
  const old = findSeat(token);
  if (old) takeOut(old.room, old.player, ws);
  const player = { id: token, name, avatarUrl, ws: null, connected: true, bot: false, auto: false, scoreSecret: 0, scoreWheel: 0, lastSeen: Date.now() };
  await hydratePlayerProfile(player);
  if (!(await assertComingSoonPlayable(ws, player, room.cat))) return;
  room.players.push(player);
  if (room.phase === "lobby") {
    cancelSpin(room);
    room.order = [];
    room.rot = 0;
  }
  attach(ws, room, player);
  try {
    const { logActivity } = require("./src/system/activity-log");
    logActivity({
      userId: player.id,
      action: "room_join",
      metadata: {
        code: room.code,
        visibility: room.visibility,
        cat: room.cat,
        playerCount: room.players.length
      }
    });
  } catch {
    /* ignore */
  }
}
async function onHello(ws, msg) {
  const token = validToken(msg.token) ? msg.token : "";
  ws.token = token;
  ws.pendingName = cleanName(msg.name);
  ws.dashboard = !!msg.dashboard;
  ws.accountType = "";
  if (token) trackPresence(ws, token);
  if (token && authEnabled()) {
    try {
      const prisma = await getPrisma();
      const u = await prisma.user.findUnique({
        where: { id: token },
        select: { accountType: true, status: true }
      });
      if (u && u.status === "active") ws.accountType = String(u.accountType || "");
    } catch {
      ws.accountType = "";
    }
  }
  await refreshAdminFlag(ws);
  const avatarUrl = cleanAvatar(msg.avatarUrl);
  const pendingMaint = maintenanceCountdownPayload();
  // Dashboard sockets only need presence/lobby — never steal the play seat.
  if (token && !ws.dashboard) {
    const found = findSeat(token);
    if (found) {
      if (avatarUrl) found.player.avatarUrl = avatarUrl;
      attach(ws, found.room, found.player);
      if (pendingMaint) send(ws, pendingMaint);
      return;
    }
  }
  watchers.add(ws);
  sendLobby(ws);
  if (pendingMaint) send(ws, pendingMaint);
}
function onLeave(ws) {
  const ctx = seat(ws);
  if (!ctx) {
    watchers.add(ws);
    send(ws, { t: "left" });
    sendLobby(ws);
    return;
  }
  takeOut(ctx.room, ctx.player, ws, true);
}
async function onFriendsOnline(ws) {
  const userId = validToken(ws.token) ? ws.token : "";
  if (!userId || !authEnabled()) {
    send(ws, { t: "friendsOnline", online: [] });
    return;
  }
  try {
    const prisma = await getPrisma();
    const ids = await listAcceptedFriendIds(prisma, userId);
    send(ws, { t: "friendsOnline", online: filterOnline(ids) });
  } catch (err) {
    send(ws, { t: "friendsOnline", online: [] });
  }
}
async function onInviteFriend(ws, msg) {
  if (!authEnabled()) return fail(ws, "ระบบเพื่อนยังไม่พร้อม");
  const ctx = seat(ws);
  if (!ctx) return fail(ws, "ต้องอยู่ในห้องก่อน");
  if (ctx.room.phase !== "lobby") return fail(ws, "เชิญได้เฉพาะตอนล็อบบี้");
  const fromUserId = ctx.player.id;
  const friendUserId = validToken(msg.friendUserId) ? msg.friendUserId : "";
  if (!friendUserId) return fail(ws, "ไม่พบเพื่อน");
  if (friendUserId === fromUserId) return fail(ws, "เชิญตัวเองไม่ได้");
  if (ctx.room.players.some((p) => p.id === friendUserId)) return fail(ws, "เพื่อนอยู่ในห้องแล้ว");
  if (ctx.room.players.length >= roomMaxPlayers(ctx.room)) return fail(ws, "ห้องเต็ม");
  if (!isUserOnline(friendUserId)) return fail(ws, "เพื่อนออฟไลน์อยู่");
  if (findSeat(friendUserId)) return fail(ws, "เพื่อนอยู่ในห้องอื่นอยู่");

  try {
    const prisma = await getPrisma();
    const ok = await areFriends(prisma, fromUserId, friendUserId);
    if (!ok) return fail(ws, "ยังไม่ได้เป็นเพื่อนกัน");
  } catch (err) {
    return fail(ws, "เชิญไม่สำเร็จ");
  }

  clearInviteForUser(friendUserId);
  const inviteId = crypto.randomUUID();
  const inv = {
    id: inviteId,
    code: ctx.room.code,
    fromUserId,
    toUserId: friendUserId,
    fromName: ctx.player.name,
    fromAvatar: ctx.player.avatarUrl || "",
    roomTitle: roomLabel(ctx.room),
    expires: Date.now() + INVITE_MS
  };
  roomInvites.set(inviteId, inv);
  inviteByUser.set(friendUserId, inviteId);
  const n = sendToUser(friendUserId, {
    t: "roomInvite",
    inviteId,
    fromUserId,
    fromName: inv.fromName,
    fromAvatar: inv.fromAvatar,
    roomTitle: inv.roomTitle,
    expiresIn: INVITE_MS
  });
  if (!n) {
    purgeInvite(inviteId);
    return fail(ws, "เพื่อนออฟไลน์อยู่");
  }
  send(ws, { t: "inviteSent", friendUserId, inviteId });
  getPrisma()
    .then(async (prisma) => {
      const { createUserNotification } = require("./src/dashboard/notify");
      await createUserNotification(prisma, {
        userId: friendUserId,
        type: "room_invitation",
        title: "เชิญเข้าห้อง",
        body: (inv.fromName || "เพื่อน") + " เชิญคุณเข้า " + inv.roomTitle,
        payload: { inviteId, code: inv.code },
        push: { inviteId, code: inv.code }
      });
    })
    .catch(() => {});
}
function onDeclineInvite(ws, msg) {
  const inviteId = String(msg.inviteId || "");
  const inv = roomInvites.get(inviteId);
  if (!inv) return;
  if (ws.token !== inv.toUserId) return;
  purgeInvite(inviteId);
  sendToUser(inv.fromUserId, { t: "inviteDeclined", inviteId, friendUserId: inv.toUserId });
}
function onAcceptInvite(ws, msg) {
  const inviteId = String(msg.inviteId || "");
  const inv = roomInvites.get(inviteId);
  if (!inv || inv.expires < Date.now()) {
    purgeInvite(inviteId);
    return fail(ws, "คำเชิญหมดอายุแล้ว");
  }
  if (ws.token !== inv.toUserId) return fail(ws, "คำเชิญนี้ไม่ใช่ของคุณ");
  const room = rooms.get(inv.code);
  purgeInvite(inviteId);
  if (!room) return fail(ws, "ห้องนี้ไม่มีแล้ว");
  if (room.phase !== "lobby") return fail(ws, "ห้องนี้เริ่มเกมแล้ว");
  if (room.players.length >= roomMaxPlayers(room)) return fail(ws, "ห้องเต็ม");
  onJoin(ws, {
    t: "join",
    code: inv.code,
    name: cleanName(msg.name) || ws.pendingName || "",
    token: ws.token,
    avatarUrl: msg.avatarUrl || ""
  });
  sendToUser(inv.fromUserId, { t: "inviteAccepted", inviteId, friendUserId: inv.toUserId });
}
function onMessage(ws, raw) {
  if (!allow(ws)) return;
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch (err) { return; }
  if (!msg || typeof msg !== "object") return;
  if (msg.t === "hello") return void onHello(ws, msg);
  if (msg.t === "create") return onCreate(ws, msg);
  if (msg.t === "join") return onJoin(ws, msg);
  if (msg.t === "watch") return void onWatch(ws, msg);
  if (msg.t === "unwatch") return onUnwatch(ws);
  if (msg.t === "leave") return onLeave(ws);
  if (msg.t === "friendsOnline") return void onFriendsOnline(ws);
  if (msg.t === "inviteFriend") return void onInviteFriend(ws, msg);
  if (msg.t === "acceptInvite") return onAcceptInvite(ws, msg);
  if (msg.t === "declineInvite") return onDeclineInvite(ws, msg);
  if (msg.t === "setup") return onSetup(ws, msg);
  if (msg.t === "spinOrder") return onSpinOrder(ws);
  if (msg.t === "start") return onStart(ws);
  if (msg.t === "roll") return onRoll(ws, msg);
  if (msg.t === "imposter:pickCard") return onImposterPickCard(ws, msg);
  if (msg.t === "imposter:confirm") return onImposterConfirm(ws);
  if (msg.t === "imposter:clue") return onImposterClue(ws, msg);
  if (msg.t === "imposter:skipClue") return onImposterSkipClue(ws);
  if (msg.t === "imposter:vote") return onImposterVote(ws, msg);
  if (msg.t === "imposter:guess") return onImposterGuess(ws, msg);
  if (msg.t === "memory:flip") return onMemoryFlip(ws, msg);
  if (msg.t === "ww:confirm") return onWerewolfConfirm(ws);
  if (msg.t === "ww:night") return onWerewolfNight(ws, msg);
  if (msg.t === "ww:vote") return onWerewolfVote(ws, msg);
  if (msg.t === "ww:hunter") return onWerewolfHunter(ws, msg);
  if (msg.t === "pick") return onPick(ws, msg);
  if (msg.t === "pickNum") return onPickNum(ws, msg);
  if (msg.t === "undo") return onUndo(ws);
  if (msg.t === "openWheel") return onOpenWheel(ws);
  if (msg.t === "spinNum") return onSpinNum(ws);
  if (msg.t === "repick") return onRepick(ws);
  if (msg.t === "again") return onAgain(ws);
  if (msg.t === "abort") return onAbort(ws);
  if (msg.t === "clear") return onClear(ws);
  if (msg.t === "kick") return onKick(ws, msg);
  if (msg.t === "giveHost") return onGiveHost(ws, msg);
  if (msg.t === "deleteRoom") return onDeleteRoom(ws);
  if (msg.t === "addBot") return onAddBot(ws);
  if (msg.t === "auto") return onAuto(ws, msg);
  if (msg.t === "rename") return onRename(ws, msg);
  if (msg.t === "renameRoom") return onRenameRoom(ws, msg);
  if (msg.t === "useHelper") return void onUseHelper(ws, msg);
  if (msg.t === "roomChat") return onRoomChat(ws, msg);
}

async function onUseHelper(ws, msg) {
  const ctx = seat(ws);
  if (!ctx || !ctx.player || !ctx.room) return fail(ws, "เข้าห้องก่อน");
  if (ctx.player.bot) return fail(ws, "บอทใช้ไอเทมไม่ได้");
  if (!ws.accountType || ws.accountType !== "registered") {
    return fail(ws, "เข้าสู่ระบบก่อนถึงจะใช้ไอเทมได้");
  }
  const itemId = String((msg && msg.itemId) || "").trim();
  const {
    consumeItem,
    ANGEL_ITEM_ID,
    SKIP_ITEM_ID,
    EVENODD_ITEM_ID,
    BOMB_ITEM_ID,
    EVENODD_CHARGES
  } = require("./src/dashboard/inventory");

  if (itemId === ANGEL_ITEM_ID) {
    if (ctx.room.phase !== "lobby") return fail(ws, "การ์ดนางฟ้าใช้ได้เฉพาะก่อนเริ่มเกม");
    if (ctx.room.cat === "imposter") return fail(ws, "การ์ดนางฟ้าใช้ไม่ได้ใน Imposter");
    if (ctx.room.cat === "cardmemory") return fail(ws, "การ์ดนางฟ้าใช้ไม่ได้ใน Memory Card");
    if (ctx.room.cat === "werewolf") return fail(ws, "การ์ดนางฟ้าใช้ไม่ได้ใน Werewolf");
    if (ctx.player.angelCardUsed || ctx.player.angelGuard || (ctx.player.angelSnakeCharges | 0) > 0) {
      return fail(ws, "ใช้การ์ดนางฟ้าไปแล้วในเกมนี้");
    }
    try {
      const { getPrisma, authEnabled } = require("./src/db");
      if (!authEnabled()) return fail(ws, "ระบบไอเทมยังไม่พร้อม");
      const prisma = await getPrisma();
      const used = await consumeItem(prisma, ctx.player.id, ANGEL_ITEM_ID);
      if (!used || !used.ok) return fail(ws, "ไม่มีการ์ดนางฟ้าในกระเป๋า");
      ctx.player.angelCardUsed = true;
      ctx.player.angelGuard = true;
      ctx.player.angelSnakeCharges = 3;
      broadcast(ctx.room);
      send(ws, { t: "helperUsed", itemId: ANGEL_ITEM_ID, quantity: used.quantity });
    } catch (err) {
      return fail(ws, "ใช้ไอเทมไม่สำเร็จ");
    }
    return;
  }

  if (itemId === EVENODD_ITEM_ID) {
    if (ctx.room.phase !== "lobby") return fail(ws, "เลขคู่/คี่ใช้ได้เฉพาะก่อนเริ่มเกม");
    if (ctx.room.cat !== "snake") return fail(ws, "เลขคู่/คี่ใช้ได้เฉพาะเกมบันไดงู");
    if (ctx.player.evenOddArmed || (ctx.player.evenOddCharges | 0) > 0) {
      return fail(ws, "ใช้เลขคู่/คี่ไปแล้วในเกมนี้");
    }
    try {
      const { getPrisma, authEnabled } = require("./src/db");
      if (!authEnabled()) return fail(ws, "ระบบไอเทมยังไม่พร้อม");
      const prisma = await getPrisma();
      const used = await consumeItem(prisma, ctx.player.id, EVENODD_ITEM_ID);
      if (!used || !used.ok) return fail(ws, "ไม่มีไอเทมเลขคู่/คี่ในกระเป๋า");
      ctx.player.evenOddArmed = true;
      ctx.player.evenOddCharges = EVENODD_CHARGES;
      broadcast(ctx.room);
      send(ws, { t: "helperUsed", itemId: EVENODD_ITEM_ID, quantity: used.quantity });
    } catch (err) {
      return fail(ws, "ใช้ไอเทมไม่สำเร็จ");
    }
    return;
  }

  if (itemId === SKIP_ITEM_ID) {
    const phase = ctx.room.phase;
    if (phase !== "play" && phase !== "snake" && phase !== "wheel") {
      return fail(ws, "Skip Turn ใช้ได้เฉพาะระหว่างเกม");
    }
    if (phase === "wheel") {
      if (ctx.player.skipTurnGuard) return fail(ws, "ติด Skip Turn อยู่แล้ว");
      try {
        const { getPrisma, authEnabled } = require("./src/db");
        if (!authEnabled()) return fail(ws, "ระบบไอเทมยังไม่พร้อม");
        const prisma = await getPrisma();
        const used = await consumeItem(prisma, ctx.player.id, SKIP_ITEM_ID);
        if (!used || !used.ok) return fail(ws, "ไม่มี Skip Turn ในกระเป๋า");
        ctx.player.skipTurnGuard = true;
        broadcast(ctx.room);
        send(ws, { t: "helperUsed", itemId: SKIP_ITEM_ID, quantity: used.quantity });
      } catch (err) {
        return fail(ws, "ใช้ไอเทมไม่สำเร็จ");
      }
      return;
    }

    const targetId = String((msg && msg.targetUserId) || "").trim();
    if (!targetId) return fail(ws, "เลือกผู้เล่นที่จะข้ามเทิร์น");
    const target = (ctx.room.players || []).find((p) => p && p.id === targetId);
    if (!target || target.bot) return fail(ws, "ไม่พบผู้เล่น");

    if (phase === "play") {
      if (!(ctx.room.alive || []).includes(target.name)) return fail(ws, "ผู้เล่นคนนี้ออกจากรอบแล้ว");
    }
    if (phase === "snake") {
      if (!ctx.room.snake || ctx.room.snake.status !== "playing") return fail(ws, "เกมงูยังไม่เริ่ม");
    }

    try {
      const { getPrisma, authEnabled } = require("./src/db");
      if (!authEnabled()) return fail(ws, "ระบบไอเทมยังไม่พร้อม");
      const prisma = await getPrisma();
      const used = await consumeItem(prisma, ctx.player.id, SKIP_ITEM_ID);
      if (!used || !used.ok) return fail(ws, "ไม่มี Skip Turn ในกระเป๋า");

      if (phase === "play") {
        if (currentName(ctx.room) === target.name) {
          ctx.room.turn = ctx.room.alive.length ? (ctx.room.turn + 1) % ctx.room.alive.length : 0;
          skipToConnected(ctx.room);
          processPendingSkipPlay(ctx.room);
          armTurnTimer(ctx.room);
        } else {
          target.skipNextTurn = true;
        }
      } else if (phase === "snake") {
        const cur = snakeBridge.snakeCurrentSeat(ctx.room);
        if (cur && cur.id === target.id) {
          snakeBridge.skipSnakeTurn(ctx.room);
          processPendingSkipSnake(ctx.room);
          armTurnTimer(ctx.room);
        } else {
          target.skipNextTurn = true;
        }
      }

      broadcast(ctx.room);
      send(ws, {
        t: "helperUsed",
        itemId: SKIP_ITEM_ID,
        quantity: used.quantity,
        targetUserId: target.id,
        targetName: target.name
      });
    } catch (err) {
      return fail(ws, "ใช้ไอเทมไม่สำเร็จ");
    }
    return;
  }

  if (itemId === BOMB_ITEM_ID) {
    if (ctx.room.phase !== "snake") return fail(ws, "วางบอมใช้ได้เฉพาะเกมบันไดงู");
    if (!ctx.room.snake || ctx.room.snake.status !== "playing") {
      return fail(ws, "เกมงูยังไม่เริ่ม");
    }
    const cell = Math.floor(Number(msg && msg.cell) || 0);
    try {
      snakeBridge.assertBombCell(ctx.room, cell);
    } catch (err) {
      const code = err && err.code;
      if (code === "invalid_bomb_cell") return fail(ws, "เลือกช่อง 1–99 เท่านั้น");
      if (code === "bomb_cell_taken") return fail(ws, "ช่องนี้มีบอมอยู่แล้ว");
      if (code === "snake_not_playing") return fail(ws, "เกมงูยังไม่เริ่ม");
      return fail(ws, "ใช้ไอเทมไม่สำเร็จ");
    }
    try {
      const { getPrisma, authEnabled } = require("./src/db");
      if (!authEnabled()) return fail(ws, "ระบบไอเทมยังไม่พร้อม");
      const prisma = await getPrisma();
      const used = await consumeItem(prisma, ctx.player.id, BOMB_ITEM_ID);
      if (!used || !used.ok) return fail(ws, "ไม่มีวางบอมในกระเป๋า");
      const placed = snakeBridge.placeSnakeBomb(ctx.room, cell, ctx.player.id);
      broadcast(ctx.room);
      send(ws, {
        t: "helperUsed",
        itemId: BOMB_ITEM_ID,
        quantity: used.quantity,
        cell: placed.cell
      });
    } catch (err) {
      const code = err && err.code;
      if (code === "invalid_bomb_cell") return fail(ws, "เลือกช่อง 1–99 เท่านั้น");
      if (code === "bomb_cell_taken") return fail(ws, "ช่องนี้มีบอมอยู่แล้ว");
      return fail(ws, "ใช้ไอเทมไม่สำเร็จ");
    }
    return;
  }

  return fail(ws, "ไอเทมนี้ใช้ในห้องไม่ได้");
}
function onImposterPickCard(ws, msg) {
  const ctx = seat(ws);
  if (!ctx || ctx.room.phase !== "imposter" || !ctx.room.imposter) return;
  const res = imposterBridge.pickCard(ctx.room.imposter, ctx.player.id, msg && msg.cardId);
  if (!res.ok) {
    const map = {
      not_your_turn: "ยังไม่ถึงตาคุณจั่วการ์ด",
      taken: "การ์ดใบนี้มีคนจั่วแล้ว",
      already_picked: "คุณจั่วไปแล้ว",
      bad_card: "ไม่พบการ์ดนี้",
      wrong_phase: "ตอนนี้ยังจั่วการ์ดไม่ได้"
    };
    return fail(ws, map[res.error] || "จั่วการ์ดไม่สำเร็จ");
  }
  imposterBridge.autoPlayBots(ctx.room);
  afterImposterAction(ctx.room);
}
function onImposterConfirm(ws) {
  const ctx = seat(ws);
  if (!ctx || ctx.room.phase !== "imposter" || !ctx.room.imposter) return;
  const res = imposterBridge.confirmReveal(ctx.room.imposter, ctx.player.id);
  if (!res.ok) return fail(ws, "ยืนยันบทบาทไม่ได้");
  imposterBridge.autoPlayBots(ctx.room);
  afterImposterAction(ctx.room);
}
function onImposterClue(ws, msg) {
  const ctx = seat(ws);
  if (!ctx || ctx.room.phase !== "imposter" || !ctx.room.imposter) return;
  const res = imposterBridge.submitClue(ctx.room.imposter, ctx.player.id, msg && (msg.text || msg.body));
  if (!res.ok) {
    const map = {
      not_your_turn: "ยังไม่ถึงตาคุณ",
      empty: "พิมพ์คำใบ้ก่อน",
      secret_word: "ห้ามพิมพ์คำศัพท์จริง",
      wrong_phase: "ตอนนี้ยังให้คำใบ้ไม่ได้"
    };
    return fail(ws, map[res.error] || "ส่งคำใบ้ไม่สำเร็จ");
  }
  afterImposterAction(ctx.room);
}
function onImposterSkipClue(ws) {
  const ctx = seat(ws);
  if (!ctx || ctx.room.phase !== "imposter" || !ctx.room.imposter) return;
  const res = imposterBridge.skipClue(ctx.room.imposter, ctx.player.id);
  if (!res.ok) return fail(ws, "ข้ามตาไม่ได้");
  afterImposterAction(ctx.room);
}
function onImposterVote(ws, msg) {
  const ctx = seat(ws);
  if (!ctx || ctx.room.phase !== "imposter" || !ctx.room.imposter) return;
  const res = imposterBridge.submitVote(ctx.room.imposter, ctx.player.id, msg && msg.targetId);
  if (!res.ok) {
    const map = {
      self_vote: "โหวตตัวเองไม่ได้",
      already_voted: "โหวตไปแล้ว",
      bad_target: "เลือกเป้าหมายไม่ได้",
      not_alive: "คุณถูกโหวตออกแล้ว",
      wrong_phase: "ยังไม่ถึงช่วงโหวต"
    };
    return fail(ws, map[res.error] || "โหวตไม่สำเร็จ");
  }
  afterImposterAction(ctx.room);
}
function onImposterGuess(ws, msg) {
  const ctx = seat(ws);
  if (!ctx || ctx.room.phase !== "imposter" || !ctx.room.imposter) return;
  const res = imposterBridge.submitGuess(ctx.room.imposter, ctx.player.id, msg && (msg.word || msg.text));
  if (!res.ok) return fail(ws, "ทายคำไม่สำเร็จ");
  afterImposterAction(ctx.room);
}
function onRoomChat(ws, msg) {
  const ctx = seat(ws);
  if (!ctx || !ctx.player || !ctx.room) return fail(ws, "เข้าห้องก่อน");
  if (ctx.player.bot) return;
  // Guests cannot send room chat — registered accounts only.
  if (!ws.accountType || ws.accountType !== "registered") {
    return fail(ws, "เข้าสู่ระบบก่อนถึงจะพิมพ์แชทในห้องได้");
  }
  // Clip by Unicode code points so emoji don't get cut mid-surrogate
  const text = Array.from(
    String(msg.body || msg.text || "")
      .trim()
      .replace(/\s+/g, " ")
  )
    .slice(0, 64)
    .join("");
  if (!text) return;
  if (ctx.room.phase === "werewolf" && !werewolfBridge.chatAllowed(ctx.room, ctx.player)) {
    return fail(ws, "ผู้เล่นที่ตายแล้วแชทกับคนที่มีชีวิตไม่ได้");
  }
  const limited = (() => {
    try {
      const { rateLimit } = require("./src/auth/rate-limit");
      return rateLimit("roomchat:" + ctx.player.id, 20, 30 * 1000);
    } catch {
      return { ok: true };
    }
  })();
  if (!limited.ok) return fail(ws, "พิมพ์ถี่เกินไป");

  const toId = String((msg && msg.toId) || "").trim();
  let target = null;
  if (toId) {
    if (toId === ctx.player.id) return fail(ws, "ส่งหาตัวเองไม่ได้");
    target = ctx.room.players.find((p) => p.id === toId);
    if (!target || target.bot) return fail(ws, "หาผู้รับไม่เจอ");
    if (!target.connected) return fail(ws, "ผู้รับออฟไลน์");
  }

  const payload = {
    t: "roomChat",
    fromId: ctx.player.id,
    fromName: ctx.player.name,
    body: text,
    private: !!target,
    toId: target ? target.id : null,
    toName: target ? target.name : null,
    at: Date.now()
  };

  if (target) {
    // Private 1:1 — only sender + recipient
    send(ctx.player.ws, payload);
    send(target.ws, payload);
    return;
  }

  for (const player of ctx.room.players) send(player.ws, payload);
  if (Array.isArray(ctx.room.spectators)) {
    for (const sp of ctx.room.spectators) send(sp.ws, payload);
  }
}
function isDashboardAsset(name) {
  const n = String(name || "").replace(/^\/+/, "").replace(/\\/g, "/");
  // Legacy admin-only shell; user app (app.html) is public.
  if (n === "index.html") return true;
  return false;
}

function staticCacheControl(rel) {
  const ext = path.extname(rel).toLowerCase();
  // HTML always revalidate so deploys show up immediately.
  if (ext === ".html" || !ext) return "no-cache";
  // Images / fonts / audio — long cache (biggest win for load time).
  if (
    ext === ".png" ||
    ext === ".jpg" ||
    ext === ".jpeg" ||
    ext === ".webp" ||
    ext === ".gif" ||
    ext === ".svg" ||
    ext === ".ico" ||
    ext === ".woff2" ||
    ext === ".mp3"
  ) {
    return "public, max-age=604800, stale-while-revalidate=86400";
  }
  // CSS/JS are not content-hashed — always revalidate so deploys show up.
  // ETag still allows cheap 304 when unchanged.
  if (ext === ".css" || ext === ".js") {
    return "no-cache";
  }
  return "no-cache";
}

function fileEtag(stat) {
  return '"' + Number(stat.size).toString(16) + "-" + Math.trunc(Number(stat.mtimeMs)).toString(16) + '"';
}

function sendStaticFile(res, name, req) {
  const rel = safePublicRel(name);
  if (!rel) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const file = path.join(PUBLIC, rel);
  fs.stat(file, (err, stat) => {
    if (err || !stat || !stat.isFile()) {
      if (!res.headersSent) {
        res.writeHead(404);
        res.end("not found");
      }
      return;
    }
    const etag = fileEtag(stat);
    const cacheControl = staticCacheControl(rel);
    const headers = {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": cacheControl,
      ETag: etag,
      "Last-Modified": stat.mtime.toUTCString(),
      "Content-Length": stat.size
    };
    const inm = req && req.headers && req.headers["if-none-match"];
    if (inm && String(inm) === etag) {
      res.writeHead(304, {
        ETag: etag,
        "Cache-Control": cacheControl,
        "Last-Modified": headers["Last-Modified"]
      });
      res.end();
      return;
    }
    if (req && String(req.method || "").toUpperCase() === "HEAD") {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    const stream = fs.createReadStream(file);
    stream.on("error", () => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    res.writeHead(200, headers);
    stream.pipe(res);
  });
}

function writeDashboardRuntimeConfig(res) {
  const publicWs =
    process.env.ADMIN_PUBLIC_WS_HOST ||
    process.env.RENDER_EXTERNAL_HOSTNAME ||
    ("127.0.0.1:" + PORT);
  res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
  res.end(
    "window.NV_PUBLIC_WS_HOST=" +
      JSON.stringify(publicWs) +
      ";window.NV_ADMIN_DASHBOARD=true;\n"
  );
}

async function servePublic(req, res) {
  if (!hostAllowed(req)) {
    rejectWrongHost(req, res);
    return;
  }
  const url = new URL(req.url || "/", "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === "/js/dashboard/runtime-config.js") {
    writeDashboardRuntimeConfig(res);
    return;
  }
  if (pathname.startsWith("/api/")) {
    const handled = await handleAuthApi(req, res, pathname);
    if (handled) return;
    const admin = await handleAdminApi(req, res, pathname);
    if (admin) return;
    const dash = await handleDashboardApi(req, res, pathname);
    if (dash) return;
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  // Pretty URLs: /app.html → /app (keep query string)
  if (pathname.toLowerCase().endsWith(".html")) {
    const pretty = prettyPathFromHtml(pathname);
    res.writeHead(302, { Location: pretty + url.search });
    res.end();
    return;
  }
  const name = resolvePublicName(pathname);
  if (!name) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  if (!PUBLIC_DASHBOARD && isDashboardAsset(name)) {
    res.writeHead(302, { Location: "/app" + url.search });
    res.end();
    return;
  }
  sendStaticFile(res, name, req);
}

async function serveAdmin(req, res) {
  // Admin port is localhost-bound — no public Host enforcement needed
  const url = new URL(req.url || "/", "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === "/js/dashboard/runtime-config.js") {
    writeDashboardRuntimeConfig(res);
    return;
  }
  if (pathname.startsWith("/api/")) {
    const handled = await handleAuthApi(req, res, pathname);
    if (handled) return;
    const admin = await handleAdminApi(req, res, pathname);
    if (admin) return;
    const dash = await handleDashboardApi(req, res, pathname);
    if (dash) return;
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  if (pathname.toLowerCase().endsWith(".html")) {
    const pretty = prettyPathFromHtml(pathname);
    res.writeHead(302, { Location: pretty + url.search });
    res.end();
    return;
  }
  const name = pathname === "/" ? ADMIN_PAGE : resolvePublicName(pathname);
  if (!name) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  sendStaticFile(res, name, req);
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.phase === "lobby") {
      const keep = room.players.filter((player) => isBot(player) || player.connected || now - player.lastSeen < SEAT_MS);
      if (keep.length !== room.players.length) {
        room.players = keep;
        transferHost(room);
        cancelSpin(room);
        clearTurnTimer(room);
        room.order = [];
        room.rot = 0;
        if (!keep.length) scheduleDelete(room);
        else broadcast(room, { lobbyImmediate: true });
      }
    } else if (skipToConnected(room)) {
      armTurnTimer(room);
      broadcast(room, { lobby: false });
    }
    if (room.players.length && !hasHumanOnline(room)) scheduleDelete(room);
  }
}, 1000);

function lobbyRoomRow(room, opts = {}) {
  const revealPrivate = !!opts.revealPrivate;
  const host = room.players.find((item) => item.id === room.hostId);
  const count = room.players.filter((item) => item.connected).length;
  const priv = room.visibility === "private";
  return {
    code: priv && !revealPrivate ? "" : room.code,
    visibility: priv ? "private" : "public",
    title: roomLabel(room),
    host: host ? host.name : "",
    count,
    max: roomMaxPlayers(room),
    cat: room.cat,
    phase: room.phase,
    joinable: room.phase === "lobby" && room.players.length < roomMaxPlayers(room),
    spectators: Array.isArray(room.spectators) ? room.spectators.length : 0,
    created: room.created || 0,
    startedAt: room.startedAt || null
  };
}

function adminRoomRow(room) {
  const host = room.players.find((item) => item.id === room.hostId);
  return {
    code: room.code,
    visibility: room.visibility === "private" ? "private" : "public",
    title: roomLabel(room),
    host: host ? host.name : "",
    hostId: room.hostId || "",
    count: room.players.filter((item) => item.connected).length,
    max: roomMaxPlayers(room),
    cat: room.cat,
    phase: room.phase,
    joinable: room.phase === "lobby" && room.players.length < roomMaxPlayers(room),
    spectators: Array.isArray(room.spectators) ? room.spectators.length : 0,
    created: room.created || 0,
    startedAt: room.startedAt || null,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: !!p.connected,
      bot: !!p.bot,
      host: p.id === room.hostId
    }))
  };
}

attachGameApi({
  findActiveSeat(userId) {
    const id = validToken(userId) ? userId : "";
    if (!id) return null;
    const found = findSeat(id);
    if (!found) return null;
    const { room, player } = found;
    return {
      code: room.code,
      phase: room.phase,
      title: roomLabel(room),
      visibility: room.visibility === "private" ? "private" : "public",
      cat: room.cat,
      connected: !!player.connected,
      score: scoreOf(room, player)
    };
  },
  listLobbyRooms(opts = {}) {
    const revealPrivate = !!opts.revealPrivate;
    const list = [];
    for (const room of rooms.values()) {
      if (!room.players.some((item) => item.connected) && !(room.spectators && room.spectators.length)) continue;
      list.push(lobbyRoomRow(room, { revealPrivate }));
    }
    list.sort((a, b) => (b.created || 0) - (a.created || 0));
    const maxShow = Number(lobbyMsg._maxRooms) || 50;
    return list.slice(0, maxShow);
  },
  listLiveGames(opts = {}) {
    const revealPrivate = !!opts.revealPrivate;
    const list = [];
    for (const room of rooms.values()) {
      if (room.phase === "lobby" || room.phase === "over") continue;
      if (room.visibility === "private" && !revealPrivate) continue;
      if (!room.players.some((item) => item.connected)) continue;
      list.push(lobbyRoomRow(room, { revealPrivate }));
    }
    const maxShow = Number(lobbyMsg._maxRooms) || 50;
    return list.slice(0, maxShow);
  },
  listAllRooms() {
    const list = [];
    for (const room of rooms.values()) {
      list.push(adminRoomRow(room));
    }
    list.sort((a, b) => (b.created || 0) - (a.created || 0));
    return list;
  },
  adminStats() {
    let players = 0;
    let spectators = 0;
    for (const room of rooms.values()) {
      players += room.players.filter((p) => p.connected).length;
      spectators += Array.isArray(room.spectators) ? room.spectators.length : 0;
    }
    return { rooms: rooms.size, players, spectators };
  },
  adminCloseRoom(code) {
    const room = rooms.get(String(code || ""));
    if (!room) return false;
    cancelSpin(room);
    clearTurnTimer(room);
    if (room.emptyTimer) {
      clearTimeout(room.emptyTimer);
      room.emptyTimer = null;
    }
    const everyone = room.players.slice();
    const spectators = Array.isArray(room.spectators) ? room.spectators.slice() : [];
    rooms.delete(room.code);
    broadcastLobby();
    for (const player of everyone) {
      const sock = player.ws;
      if (sock) {
        byWs.delete(sock);
        player.ws = null;
        send(sock, { t: "roomClosed", message: "แอดมินปิดห้องแล้ว" });
        tellLobby(sock);
      }
    }
    for (const sp of spectators) {
      const sock = sp.ws;
      if (sock) {
        byWs.delete(sock);
        send(sock, { t: "roomClosed", message: "แอดมินปิดห้องแล้ว" });
        tellLobby(sock);
      }
    }
    return true;
  },
  adminKick(code, playerId) {
    const room = rooms.get(String(code || ""));
    if (!room) return false;
    const id = String(playerId || "");
    const target = room.players.find((p) => p.id === id);
    if (!target) return false;
    const sock = target.ws;
    takeOut(room, target, sock, true);
    if (sock) send(sock, { t: "err", message: "ถูกแอดมินเตะออกจากห้อง" });
    return true;
  },
  /** Tell a user their ban/suspend was lifted (clears sticky client overlay). */
  notifyUnbanned(userId) {
    const id = validToken(userId) ? userId : "";
    if (!id) return { ok: false };
    const payload = { t: "unbanned", status: "active" };
    sendToUser(id, payload);
    return { ok: true };
  },
  /** Ban/suspend: notify all sockets, pull out of rooms, then close WS. */
  forceBanUser(userId, opts = {}) {
    const id = validToken(userId) ? userId : "";
    if (!id) return { ok: false, notified: 0 };
    const status = String(opts.status || "banned");
    const message =
      String(opts.message || "").trim() ||
      (status === "suspended"
        ? "บัญชีของคุณถูกระงับชั่วคราว"
        : status === "deleted"
          ? "บัญชีของคุณถูกลบแล้ว"
          : "บัญชีของคุณถูกแบน");
    const payload = { t: "banned", status, message };

    const seat = findSeat(id);
    if (seat) {
      const sock = seat.player.ws;
      takeOut(seat.room, seat.player, sock, false);
    }
    for (const room of rooms.values()) {
      if (!Array.isArray(room.spectators)) continue;
      const before = room.spectators.length;
      room.spectators = room.spectators.filter((sp) => {
        if (sp.id !== id && sp.ws && sp.ws.token !== id) return true;
        if (sp.ws) {
          try {
            send(sp.ws, payload);
          } catch {
            /* ignore */
          }
        }
        return false;
      });
      if (room.spectators.length !== before) broadcastLobby();
    }

    const notified = sendToUser(id, payload);
    // Close every socket so they cannot keep playing on a dead session.
    forEachUserSocket(id, (sock) => {
      try {
        send(sock, payload);
      } catch {
        /* ignore */
      }
      try {
        sock.close();
      } catch {
        /* ignore */
      }
    });
    clearInviteForUser(id);
    return { ok: true, notified, status, message };
  },
  findQuickPlayRoom() {
    for (const room of rooms.values()) {
      if (room.visibility !== "public") continue;
      if (room.phase !== "lobby") continue;
      if (room.players.length >= roomMaxPlayers(room)) continue;
      if (!room.players.some((p) => p.connected)) continue;
      return { code: room.code, title: roomLabel(room) };
    }
    return null;
  },
  inspectRoom(code) {
    const room = rooms.get(String(code || ""));
    if (!room) return null;
    return {
      code: room.code,
      title: roomLabel(room),
      phase: room.phase,
      joinable: room.phase === "lobby" && room.players.length < roomMaxPlayers(room)
    };
  },
  async createRoomHttp({ visibility, title, token, name, avatarUrl, setup }) {
    if (rooms.size >= MAX_ROOMS) return null;
    const code = makeCode();
    if (!code) return null;
    const id = validToken(token) ? token : crypto.randomUUID();
    const player = {
      id,
      name: cleanName(name) || "Player",
      avatarUrl: cleanAvatar(avatarUrl),
      ws: null,
      connected: false,
      bot: false,
      auto: false,
      scoreSecret: 0,
      scoreWheel: 0,
      lastSeen: Date.now()
    };
    await hydratePlayerProfile(player);
    const room = blankRoom(code, visibility === "private" ? "private" : "public", player);
    if (title) room.title = cleanRoomTitle(title) || "";
    applyRoomSetup(room, setup);
    try {
      if (authEnabled()) {
        const { assertCatPlayable } = require("./src/dashboard/game-catalog-flags");
        const prisma = await getPrisma();
        const check = await assertCatPlayable(prisma, room.cat, {
          roles: player.roles,
          userId: player.id
        });
        if (!check.ok) return { error: "coming_soon" };
      }
    } catch {
      /* ignore catalog check failures */
    }
    room.holdUntil = Date.now() + 120000;
    rooms.set(code, room);
    scheduleDelete(room);
    return { code, token: id, title: roomLabel(room) };
  },
  /** Live toast + inbox ping. recipientIds=null → everyone online. */
  pushAnnouncement(announcement, recipientIds) {
    const toastMsg = { t: "announcement:new", announcement };
    const notifMsg = { t: "notification:new", type: "announcement" };
    if (Array.isArray(recipientIds)) {
      broadcastToUsersCore(recipientIds, toastMsg, send);
      broadcastToUsersCore(recipientIds, notifMsg, send);
    } else {
      fanOutAllClients(toastMsg);
      fanOutAllClients(notifMsg);
    }
  },
  /** Push a notification:new (and optional payload) to one user. */
  notifyUser(userId, payload) {
    if (!userId) return 0;
    const msg =
      payload && typeof payload === "object"
        ? Object.assign({ t: "notification:new" }, payload)
        : { t: "notification:new" };
    return broadcastToUsersCore([userId], msg, send);
  },
  /** Warn everyone, then kick after countdown (default 15s). */
  scheduleForceMaintenance(message, seconds = 15) {
    return scheduleMaintenanceKick(message, seconds);
  },
  cancelScheduledMaintenance() {
    return cancelMaintenanceKick();
  },
  /** Close every room and boot all connected clients into maintenance. */
  forceMaintenance(message) {
    return forceMaintenanceNow(message);
  }
});

let maintenanceKickTimer = null;
let maintenanceKickPulse = null;
let maintenanceKickAt = 0;
let maintenanceKickMessage = "";

function fanOutAllClients(payload) {
  // Prefer every live WS socket so in-room + dashboard + lobby all get it.
  let usedWss = false;
  try {
    if (wss && wss.clients) {
      for (const sock of wss.clients) send(sock, payload);
      usedWss = true;
    }
  } catch {
    usedWss = false;
  }
  if (usedWss) return;
  broadcastAllCore(payload, send);
  for (const sock of watchers) send(sock, payload);
  for (const room of rooms.values()) {
    for (const player of room.players) {
      if (player.ws) send(player.ws, payload);
    }
    if (Array.isArray(room.spectators)) {
      for (const sp of room.spectators) {
        if (sp.ws) send(sp.ws, payload);
      }
    }
  }
}

function maintenanceCountdownPayload() {
  if (!maintenanceKickAt || maintenanceKickAt <= Date.now()) return null;
  const left = Math.max(1, Math.ceil((maintenanceKickAt - Date.now()) / 1000));
  return {
    t: "maintenance:countdown",
    message: maintenanceKickMessage,
    seconds: left,
    endsAt: maintenanceKickAt
  };
}

function clearMaintenancePulse() {
  if (maintenanceKickPulse) {
    clearInterval(maintenanceKickPulse);
    maintenanceKickPulse = null;
  }
}

function cancelMaintenanceKick() {
  if (maintenanceKickTimer) {
    clearTimeout(maintenanceKickTimer);
    maintenanceKickTimer = null;
  }
  clearMaintenancePulse();
  const wasPending = maintenanceKickAt > 0;
  maintenanceKickAt = 0;
  maintenanceKickMessage = "";
  if (wasPending) {
    fanOutAllClients({ t: "maintenance:countdown", cancelled: true });
  }
  return { cancelled: wasPending };
}

function scheduleMaintenanceKick(message, seconds = 15) {
  const text =
    String(message || "").trim() || "ระบบปิดปรับปรุงชั่วคราว กรุณากลับมาใหม่ภายหลัง";
  const sec = Math.max(1, Math.min(120, Number(seconds) || 15));
  const endsAt = Date.now() + sec * 1000;
  if (maintenanceKickTimer) clearTimeout(maintenanceKickTimer);
  clearMaintenancePulse();
  maintenanceKickAt = endsAt;
  maintenanceKickMessage = text;
  const payload = {
    t: "maintenance:countdown",
    message: text,
    seconds: sec,
    endsAt
  };
  fanOutAllClients(payload);
  // Keep pulsing so late joiners / missed sockets still see the countdown.
  // Pulse a bit slower than 1Hz to cut fan-out load; UI still paints locally.
  maintenanceKickPulse = setInterval(() => {
    const next = maintenanceCountdownPayload();
    if (!next) {
      clearMaintenancePulse();
      return;
    }
    fanOutAllClients(next);
  }, 1500);
  maintenanceKickTimer = setTimeout(() => {
    maintenanceKickTimer = null;
    clearMaintenancePulse();
    maintenanceKickAt = 0;
    forceMaintenanceNow(text);
  }, sec * 1000);
  return { endsAt, seconds: sec };
}

function forceMaintenanceNow(message) {
  if (maintenanceKickTimer) {
    clearTimeout(maintenanceKickTimer);
    maintenanceKickTimer = null;
  }
  clearMaintenancePulse();
  maintenanceKickAt = 0;
  maintenanceKickMessage = "";
  const text =
    String(message || "").trim() || "ระบบปิดปรับปรุงชั่วคราว กรุณากลับมาใหม่ภายหลัง";
  const codes = [...rooms.keys()];
  for (const code of codes) {
    const room = rooms.get(code);
    if (!room) continue;
    cancelSpin(room);
    clearTurnTimer(room);
    if (room.emptyTimer) {
      clearTimeout(room.emptyTimer);
      room.emptyTimer = null;
    }
    const everyone = room.players.slice();
    const spectators = Array.isArray(room.spectators) ? room.spectators.slice() : [];
    rooms.delete(room.code);
    for (const player of everyone) {
      const sock = player.ws;
      if (sock) {
        byWs.delete(sock);
        player.ws = null;
        send(sock, { t: "maintenance", message: text });
        send(sock, { t: "roomClosed", message: text });
      }
    }
    for (const sp of spectators) {
      const sock = sp.ws;
      if (sock) {
        byWs.delete(sock);
        send(sock, { t: "maintenance", message: text });
        send(sock, { t: "roomClosed", message: text });
      }
    }
  }
  broadcastLobby();
  const payload = { t: "maintenance", message: text, enabled: true };
  fanOutAllClients(payload);
  return { roomsClosed: codes.length };
}

const server = http.createServer(servePublic);
const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 8000,
  verifyClient(info) {
    return hostAllowed(info.req);
  }
});
wss.on("connection", (ws) => {
  ws.on("message", (buf) => onMessage(ws, buf));
  ws.on("close", () => {
    untrackPresence(ws);
    detachSpectator(ws);
    releaseSocket(ws, false);
  });
  ws.on("error", () => {});
});
setInterval(() => {
  const now = Date.now();
  for (const [id, inv] of roomInvites) {
    if (inv.expires < now) purgeInvite(id);
  }
}, 5000);

/** Fire scheduled announcements → toast + notification inbox. */
setInterval(() => {
  if (!authEnabled()) return;
  getPrisma()
    .then((prisma) => publishDueAnnouncements(prisma))
    .catch(() => {});
}, 15000);

/** Guest + expired session cleanup (interval from admin settings). */
startCleanupScheduler();

try {
  const { startBackupScheduler } = require("./src/system/backup");
  startBackupScheduler();
} catch (err) {
  console.warn("[backup] scheduler not started:", err && err.message ? err.message : err);
}

try {
  const { startRankingRewardsScheduler } = require("./src/dashboard/ranking-rewards");
  startRankingRewardsScheduler();
} catch (err) {
  console.warn("[ranking-rewards] scheduler not started:", err && err.message ? err.message : err);
}

server.listen(PORT, HOST, () => {
  console.log("Public game: http://localhost:" + PORT + " (/play)");
  console.log("Bind public: " + HOST + ":" + PORT + (HOST === "0.0.0.0" ? " (เครือข่าย)" : " (local)"));
  if (ENFORCE_HOST) {
    console.log("Public host allowlist: " + [...ALLOWED_HOSTS].join(", ") + " (+ localhost)");
    console.log("เข้าผ่าน IP สาธารณะจะถูกปฏิเสธ — ใช้โดเมนเท่านั้น");
  }
  console.log("Auth V1: " + (authEnabled() ? "on" : "off"));
  const base = String(process.env.APP_BASE_URL || "").replace(/\/$/, "");
  if (base) console.log("โดเมนสาธารณะ: " + base);
  if (authEnabled()) {
    getPrisma()
      .then((prisma) => {
        const { ensureInventoryCatalog } = require("./src/dashboard/inventory");
        return ensureInventoryCatalog(prisma, { force: true });
      })
      .then(() => console.log("Inventory catalog: ready"))
      .catch((err) => console.warn("[inventory] catalog ensure failed:", err && err.message ? err.message : err));
  }
});

if (ADMIN_PORT > 0) {
  const adminServer = http.createServer(serveAdmin);
  adminServer.listen(ADMIN_PORT, ADMIN_HOST, () => {
    console.log(
      "Admin dashboard: http://" +
        (ADMIN_HOST === "0.0.0.0" ? "127.0.0.1" : ADMIN_HOST) +
        ":" +
        ADMIN_PORT +
        " (user ปกติเข้าไม่ได้ — bind " +
        ADMIN_HOST +
        ")"
    );
    if (ADMIN_HOST === "127.0.0.1" || ADMIN_HOST === "localhost") {
      console.log("Remote admin: ssh -L " + ADMIN_PORT + ":127.0.0.1:" + ADMIN_PORT + " user@server");
    }
  });
}
