"use strict";

const DAY = 24 * 60 * 60;
const HOUR = 60 * 60;

const SESSION_TTL = {
  guest: Number(process.env.SESSION_TTL_GUEST_SEC) || 1 * DAY,
  registered: Number(process.env.SESSION_TTL_REGISTERED_SEC) || 30 * DAY,
  admin: Number(process.env.SESSION_TTL_ADMIN_SEC) || 8 * HOUR
};

function enabledProviders() {
  const list = [];
  if (process.env.AUTH_GUEST_ENABLED !== "0") list.push("guest");
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) list.push("google");
  if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) list.push("discord");
  return list;
}

function sessionTtlSec(accountType, roles) {
  const names = (roles || []).map((r) => (typeof r === "string" ? r : r.name));
  const isAdmin = names.some((n) => n === "admin" || n === "super_admin" || n === "moderator");
  if (isAdmin) return SESSION_TTL.admin;
  if (accountType === "registered") return SESSION_TTL.registered;
  return SESSION_TTL.guest;
}

module.exports = { SESSION_TTL, enabledProviders, sessionTtlSec };
