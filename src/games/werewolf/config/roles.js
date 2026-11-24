"use strict";

const ROLES = {
  werewolf: {
    id: "werewolf",
    team: "werewolf",
    nameTh: "หมาป่า",
    nameEn: "Werewolf",
    color: "#dc2626",
    image: "/images/werewolf/werewolf.png",
    blurb: "กำจัดชาวบ้านในเวลากลางคืน และแสร้งเป็นชาวบ้านตอนกลางวัน"
  },
  villager: {
    id: "villager",
    team: "village",
    nameTh: "ชาวบ้าน",
    nameEn: "Villager",
    color: "#2563eb",
    image: "/images/werewolf/villager.png",
    blurb: "คุย วิเคราะห์ และโหวตหาหมาป่า — ไม่มีความสามารถพิเศษตอนกลางคืน"
  },
  seer: {
    id: "seer",
    team: "village",
    nameTh: "ผู้หยั่งรู้",
    nameEn: "Seer",
    color: "#7c3aed",
    image: "/images/werewolf/seer.png",
    blurb: "ตรวจผู้เล่น 1 คนต่อคืน ว่าเป็นฝ่ายหมาป่าหรือไม่"
  },
  witch: {
    id: "witch",
    team: "village",
    nameTh: "แม่มด",
    nameEn: "Witch",
    color: "#16a34a",
    image: "/images/werewolf/witch.png",
    blurb: "มียาชุบชีวิต 1 ขวด และยาพิษ 1 ขวด ใช้ได้ชนิดละครั้งต่อเกม"
  },
  guardian: {
    id: "guardian",
    team: "village",
    nameTh: "ผู้พิทักษ์",
    nameEn: "Guardian",
    color: "#ca8a04",
    image: "/images/werewolf/guardian.png",
    blurb: "ปกป้องผู้เล่น 1 คนต่อคืน ห้ามปกป้องคนเดิมติดกันสองคืน"
  },
  hunter: {
    id: "hunter",
    team: "village",
    nameTh: "นักล่า",
    nameEn: "Hunter",
    color: "#166534",
    image: "/images/werewolf/hunter.png",
    blurb: "เมื่อถูกกำจัด สามารถยิงผู้เล่นอีก 1 คนทันที"
  }
};

/** Classic presets from the design doc. */
const PRESETS = {
  5: ["werewolf", "seer", "guardian", "villager", "villager"],
  6: ["werewolf", "seer", "witch", "guardian", "villager", "villager"],
  7: ["werewolf", "werewolf", "seer", "witch", "guardian", "hunter", "villager"],
  8: ["werewolf", "werewolf", "seer", "witch", "guardian", "hunter", "villager", "villager"]
};

function roleMeta(id) {
  return ROLES[id] || null;
}

function listRoles() {
  return Object.keys(ROLES).map((id) => {
    const r = ROLES[id];
    return {
      id: r.id,
      team: r.team,
      nameTh: r.nameTh,
      nameEn: r.nameEn,
      color: r.color,
      image: r.image,
      blurb: r.blurb
    };
  });
}

function deckForCount(n) {
  const deck = PRESETS[n];
  if (!deck) return null;
  return deck.slice();
}

module.exports = {
  ROLES,
  PRESETS,
  roleMeta,
  listRoles,
  deckForCount
};
