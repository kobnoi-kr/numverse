# @numverse/werewolf

เกม Werewolf แยกออกจาก NUMVERSE เป็นแพ็กเกจเดี่ยว  
เว็บหลักที่ `numverse.click` ยังใช้โค้ดใน `src/games/werewolf` และ `public/` เหมือนเดิม (Coming Soon ในคลังเกม)

## โครงสร้าง

```text
packages/werewolf/
├── src/
│   ├── config/roles.js       # บทบาท + เมตาการ์ด
│   ├── engine/game-engine.js # เอนจินล้วน (ไม่มี DOM / Prisma / ws)
│   ├── room-bridge.js        # อะแดปเตอร์ห้อง NUMVERSE
│   └── index.js
├── client/
│   ├── village-3d.js         # หมู่บ้าน 3D (Three.js r128)
│   ├── live-ui.js            # UI ระหว่างเล่น + แตะบ้านเลือกเป้า
│   ├── werewolf.css
│   └── images/               # การ์ดบทบาท (png)
├── test/
│   └── test-werewolf.js
└── ARCHITECTURE.md
```

## ใช้เอนจิน

```js
const { createGame, tick, PHASE } = require("@numverse/werewolf");
// หรือ
const eng = require("./src/engine/game-engine");
```

## ทดสอบ

```bash
cd packages/werewolf
npm test
```

## ความสัมพันธ์กับเว็บหลัก

| ที่ | บทบาท |
|---|---|
| `packages/werewolf/` | สำเนาแยกสำหรับพอร์ต / พัฒนาแยก |
| `src/games/werewolf/` | ที่เซิร์ฟเวอร์ NUMVERSE เรียกจริง |
| `public/js/werewolf/`, `public/css/werewolf.css`, `public/images/werewolf/` | ที่เบราว์เซอร์โหลดจริง |

ถ้าแก้เกมบนเว็บ ให้แก้ที่ `src/games/werewolf` + `public/` แล้ว sync มาที่แพ็กเกจนี้ด้วยถ้าต้องการให้ชุดแยกตามทัน

## Flow สั้นๆ

Phases: ROLE_REVEAL → NIGHT → MORNING → DISCUSSION → VOTING → EXECUTION → (HUNTER_SHOT) → FINISHED  
ผู้เล่น 5–8 คน · WS: `ww:confirm|night|vote|hunter`
