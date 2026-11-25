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
```

## Flow

`cat=imposter` → lobby settings → `t:"start"` → `phase=imposter` → `room.imposter` engine

Phases: ROLE_REVEAL → CLUE_TURN → DISCUSSION → VOTING → VOTE_RESULT → (GUESS) → FINISHED → `phase=over`

## Privacy

- Public snap: `snap.imposter` (no roles/words until FINISHED)
- Private: `youImposter` per seat only
- WS: `imposter:confirm|clue|skipClue|vote|guess`

## Caps

- Min 4 / Max 8 players
- Host: impostorInfo none|category, impostorCount 1|2 (≥6), timers
