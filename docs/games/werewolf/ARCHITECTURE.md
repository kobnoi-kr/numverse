# Werewolf — Architecture (NUMVERSE)

## Stack

- Node + vanilla JS; realtime `ws` (`server.js`)
- In-memory room state
- Persist finished games via `persistFinishedGame` (`gameMode: "werewolf"`)
- Default catalog flag: **Coming Soon**

## Module layout

```text
src/games/werewolf/
├── config/roles.js
├── engine/game-engine.js
├── index.js
└── room-bridge.js

public/js/werewolf/live-ui.js
public/css/werewolf.css
public/images/werewolf/*.png
```

## Flow

`cat=werewolf` → lobby settings → `t:"start"` → `phase=werewolf` → `room.werewolf` engine

Phases: ROLE_REVEAL → NIGHT → MORNING → DISCUSSION → VOTING → EXECUTION → (HUNTER_SHOT) → FINISHED → `phase=over`

## Privacy

- Public snap: `snap.werewolf` (roles only at FINISHED)
- Private: `youWerewolf` per seat
- WS: `ww:confirm|night|vote|hunter`

## Caps

- Min 5 / Max 8 players
- Angel card blocked
- Dead players cannot room-chat while the match is live
