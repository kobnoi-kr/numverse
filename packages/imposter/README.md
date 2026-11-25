# @numverse/imposter

เกม Imposter Classic แยกออกจาก NUMVERSE เป็นแพ็กเกจเดี่ยว  
เว็บหลักที่ `numverse.click` ยังมี Imposter อยู่เหมือนเดิม (โค้ดใน `src/games/imposter` และ `public/`)

## โครงสร้าง

```text
packages/imposter/
├── src/
│   ├── config/words.js      # คลังคำไทย + หมวดหมู่
│   ├── engine/game-engine.js # เอนจินล้วน (ไม่มี DOM / Prisma / ws)
│   ├── room-bridge.js        # อะแดปเตอร์ห้อง NUMVERSE
│   └── index.js
├── client/
│   ├── live-ui.js            # UI ระหว่างเล่น
│   ├── table-3d.js           # โต๊ะล้อมวง 3D (three.js r128 โหลดจาก cdnjs)
│   └── imposter.css
├── test/
│   └── test-imposter.js
└── ARCHITECTURE.md
```

## ใช้เอนจิน

```js
const { createGame, submitClue, tick, PHASE } = require("@numverse/imposter");
// หรือ
const eng = require("./src/engine/game-engine");
```

## ทดสอบ

```bash
cd packages/imposter
npm test
```

## ความสัมพันธ์กับเว็บหลัก

| ที่ | บทบาท |
|---|---|
| `packages/imposter/` | สำเนาแยกสำหรับพอร์ต / พัฒนาแยก |
| `src/games/imposter/` | ที่เซิร์ฟเวอร์ NUMVERSE เรียกจริง |
| `public/js/imposter/`, `public/css/imposter.css` | ที่เบราว์เซอร์โหลดจริง |

ถ้าแก้เกมบนเว็บ ให้แก้ที่ `src/games/imposter` + `public/` แล้ว sync มาที่แพ็กเกจนี้ด้วยถ้าต้องการให้ชุดแยกตามทัน

## โต๊ะ 3D

- โหลด `table-3d.js` **ก่อน** `live-ui.js` ในหน้าเว็บ (ไม่ต้องโหลด three.js เอง โมดูลโหลดให้)
- ถ้า WebGL หรือ CDN ใช้ไม่ได้ จะ fallback กลับเป็นรายชื่อผู้เล่น 2D อัตโนมัติ
- คำใบ้ขึ้นเป็นป้ายเหนือหัวผู้พูด, โหวตโดยคลิกตัวละครหรือป้ายชื่อ
