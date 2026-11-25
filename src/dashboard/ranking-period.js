"use strict";

/** Asia/Bangkok is fixed UTC+7 (no DST). */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

function bangkokParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(now);
  const get = (type) => {
    const p = parts.find((x) => x.type === type);
    return p ? p.value : "";
  };
  const weekday = get("weekday"); // Sun, Mon, ...
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour") === "24" ? "0" : get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    dow: dowMap[weekday] != null ? dowMap[weekday] : 0
  };
}

/** Convert Asia/Bangkok wall-clock to UTC Date. */
function bangkokWallToUtc(year, month, day, hour = 0, minute = 0, second = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - BANGKOK_OFFSET_MS);
}

function addDaysUtc(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Calendar ranking windows in Thailand time.
 * - weekly: Mon 00:00 → next Mon 00:00 (Asia/Bangkok)
 * - monthly: 1st 00:00 → next month 1st 00:00 (Asia/Bangkok)
 */
function rankingWindow(period, now = new Date()) {
  const p = bangkokParts(now);
  if (period === "monthly") {
    const since = bangkokWallToUtc(p.year, p.month, 1, 0, 0, 0);
    const nextMonth = p.month === 12 ? 1 : p.month + 1;
    const nextYear = p.month === 12 ? p.year + 1 : p.year;
    const resetsAt = bangkokWallToUtc(nextYear, nextMonth, 1, 0, 0, 0);
    return {
      period: "monthly",
      timezone: "Asia/Bangkok",
      since,
      resetsAt,
      label: `${p.year}-${String(p.month).padStart(2, "0")}`
    };
  }

  // Weekly — Monday start (ISO-style) in Bangkok
  const daysSinceMonday = (p.dow + 6) % 7; // Mon=0 ... Sun=6
  const monday = bangkokWallToUtc(p.year, p.month, p.day, 0, 0, 0);
  const since = addDaysUtc(monday, -daysSinceMonday);
  const resetsAt = addDaysUtc(since, 7);
  // Label = Bangkok Monday date so each week grants once (not a static "week").
  const mondayParts = bangkokParts(since);
  const label = `${mondayParts.year}-${String(mondayParts.month).padStart(2, "0")}-${String(mondayParts.day).padStart(2, "0")}`;
  return {
    period: "weekly",
    timezone: "Asia/Bangkok",
    since,
    resetsAt,
    label
  };
}

function previousRankingWindow(period, now = new Date()) {
  const cur = rankingWindow(period, now);
  return rankingWindow(period, new Date(cur.since.getTime() - 1));
}

module.exports = { rankingWindow, previousRankingWindow, bangkokParts, bangkokWallToUtc };
