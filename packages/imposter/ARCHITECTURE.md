# Imposter Classic — Architecture (NUMVERSE)

## Stack

- Node + vanilla JS; realtime `ws` (`server.js`)
- In-memory room state (no Room/Vote/Chat tables)
- Persist finished games via `persistFinishedGame` (`gameMode: "imposter"`)

## Module layout

```text
src/games/imposter/
├── config/words.js
├── engine/game-engine.js
├── index.js
└── room-bridge.js

public/js/imposter/live-ui.js
public/js/imposter/table-3d.js   # 3D table (load before live-ui.js)
public/css/imposter.css

packages/imposter/               # extracted copy for port / standalone work
```

## Flow

`cat=imposter` → lobby settings → `t:"start"` → `phase=imposter` → `room.imposter` engine

Phases: CARD_PICK → ROLE_REVEAL → CLUE_TURN → DISCUSSION → VOTING → VOTE_RESULT → (GUESS) → FINISHED → `phase=over`

## Privacy

- Public snap: `snap.imposter` (no roles/words until FINISHED)
- Private: `youImposter` per seat only
- WS: `imposter:confirm|pickCard|clue|skipClue|vote|guess`

## Caps

- Min 4 / Max 8 players
- Host: impostorInfo none|category, impostorCount 1|2 (≥6), timers

## โต๊ะ 3D

- โหลด `table-3d.js` **ก่อน** `live-ui.js` (three.js r128 จาก cdnjs)
- คำใบ้ขึ้นเป็นป้ายเหนือหัวผู้พูด, โหวตโดยคลิกตัวละครหรือป้ายชื่อ
- ถ้า WebGL หรือ CDN ใช้ไม่ได้ จะ fallback กลับเป็นรายชื่อผู้เล่น 2D อัตโนมัติ
