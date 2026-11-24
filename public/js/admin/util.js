export { confirmDialog } from "/js/ui/dialog.js";

export function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

export function fmtDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

export function statusPill(status) {
  const s = String(status || "active");
  return `<span class="status-pill status-${esc(s)}">${esc(s)}</span>`;
}

export function hasPerm(user, perm) {
  if (!user || !perm) return false;
  const roles = user.roles || [];
  if (roles.includes("super_admin")) return true;
  const list = String(perm)
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  const owned = user.permissions || [];
  return list.some((p) => owned.includes(p));
}

export function modeLabel(mode) {
  if (mode === "wheel") return "วงล้อ";
  if (mode === "snake") return "บันไดงู";
  if (mode === "imposter") return "Imposter";
  if (mode === "cardmemory") return "Memory Card";
  if (mode === "werewolf") return "Werewolf";
  return "หาเลข";
}
