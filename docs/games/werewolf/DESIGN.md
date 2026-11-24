# NUMVERSE WEREWOLF

## Game Concept & Development Specification

> **Tagline:** A village full of secrets. Who can you trust?\
> **Genre:** Social Deduction / Party Game / Multiplayer\
> **Visual Direction:** Cute Fantasy + Minimal Dark UI\
> **Target Players:** 2--8 players (initial target; balance depends on
> game mode)

------------------------------------------------------------------------

## 1. Game Overview

NUMVERSE Werewolf เป็นเกม Multiplayer Party Game
แนวจับโกหกและวิเคราะห์พฤติกรรม ผู้เล่นจะได้รับบทบาทลับจากการสุ่ม และต้องใช้ความสามารถ
การพูดคุย การหลอกลวง และการโหวตเพื่อช่วยให้ฝ่ายของตนเองชนะ

### Design Pillars

1.  **Visual Identity:** ใช้ Character Role Card สไตล์ Cute Fantasy
    ตามภาพอ้างอิง
2.  **Easy to Learn:** กติกาเข้าใจง่าย เริ่มเล่นได้รวดเร็ว
3.  **Social Strategy:** มีการพูดคุย จับผิด หลอกลวง และวางแผน
4.  **Multiplayer First:** สร้างห้อง เล่นกับเพื่อน และติดตามเกมแบบ Live ได้
5.  **Replayability:** เพิ่มกติกาเสริม อีเวนต์ และของตกแต่งเพื่อให้เล่นซ้ำได้

------------------------------------------------------------------------

## 2. Visual & Art Direction

### 2.1 Art Style

-   ตัวละคร Chibi / Cute Fantasy
-   การ์ดแต่ละ Role มีสีประจำตัวและสัญลักษณ์เฉพาะ
-   เส้นขอบการ์ดหนา สีสด มีแสงเรืองรองเล็กน้อย
-   ฉากกลางวันและกลางคืนเปลี่ยนบรรยากาศตาม Phase
-   UI หลักใช้ Minimal Dark Theme เพื่อให้ตัวละครและการ์ดโดดเด่น

### 2.2 Role Card Identity

  Role       Main Color       Visual Theme
  ---------- ---------------- --------------------------
  Werewolf   Red              พระจันทร์ หมาป่า กรงเล็บ
  Villager   Blue             หมู่บ้าน บ้าน ชาวนา
  Seer       Purple           ดวงจันทร์ ลูกแก้ว ดวงตา
  Witch      Green / Purple   ยาเวทมนตร์ แมวดำ หมวกแม่มด
  Guardian   Gold / Blue      โล่ เกราะ แสงป้องกัน
  Hunter     Green            ธนู ลูกศร ป่า

------------------------------------------------------------------------

## 3. Teams & Roles

เกมเริ่มต้นด้วย 6 บทบาท แบ่งเป็น 2 ฝ่าย

### 3.1 Village Team

#### Villager --- ชาวบ้าน

**หน้าที่:** ค้นหาหมาป่าด้วยการพูดคุย วิเคราะห์ และโหวต

-   ไม่มี Action พิเศษในเวลากลางคืน
-   สามารถพูดคุยและโหวตในช่วงกลางวัน
-   ช่วยวิเคราะห์พฤติกรรมและข้อมูลจากผู้เล่นอื่น

#### Seer --- ผู้หยั่งรู้

**หน้าที่:** ตรวจสอบตัวตนของผู้เล่นในเวลากลางคืน

-   เลือกผู้เล่น 1 คนเพื่อตรวจสอบในแต่ละคืน
-   ได้รับผลว่าเป้าหมายเป็นฝ่ายหมาป่าหรือไม่
-   ผลตรวจสอบเป็นข้อมูลส่วนตัวของ Seer

#### Witch --- แม่มด

**หน้าที่:** ใช้ยาเพื่อช่วยชีวิตหรือกำจัดผู้เล่น

-   **Healing Potion:** ช่วยชีวิตผู้เล่นที่ถูกหมาป่าเลือก
-   **Poison Potion:** วางยาผู้เล่น 1 คน
-   ยาแต่ละชนิดใช้ได้ 1 ครั้งต่อเกม
-   ต้องกำหนดกติกาให้ชัดเจนว่า Witch สามารถใช้ยาทั้งสองชนิดในคืนเดียวกันได้หรือไม่

#### Guardian --- ผู้พิทักษ์

**หน้าที่:** ปกป้องผู้เล่นจากการโจมตีในเวลากลางคืน

-   เลือกปกป้องผู้เล่น 1 คนในแต่ละคืน
-   หากหมาป่าโจมตีเป้าหมายที่ได้รับการปกป้อง เป้าหมายจะไม่เสียชีวิต
-   ไม่สามารถปกป้องคนเดิมติดต่อกัน 2 คืน
-   การปกป้องตัวเองเป็นกติกาที่ Host สามารถกำหนดได้

#### Hunter --- นักล่า

**หน้าที่:** ตอบโต้ด้วยการกำจัดผู้เล่นอีกคนเมื่อถูกกำจัด

-   เมื่อ Hunter เสียชีวิต สามารถเลือกยิงผู้เล่น 1 คน
-   เป้าหมายที่ถูกยิงจะเสียชีวิตทันที
-   หากยังไม่ใช้ความสามารถ จะเก็บสิทธิ์ไว้จนกว่าจะถูกกำจัด

### 3.2 Werewolf Team

#### Werewolf --- มนุษย์หมาป่า

**หน้าที่:** กำจัดฝ่ายหมู่บ้านและปกปิดตัวตน

-   มองเห็นสมาชิก Werewolf คนอื่นได้
-   ร่วมกันเลือกเหยื่อ 1 คนในเวลากลางคืน
-   ต้องแสร้งทำตัวเป็นชาวบ้านในช่วงกลางวัน
-   ชนะเมื่อจำนวนหมาป่าเท่ากับหรือมากกว่าจำนวนผู้เล่นฝ่ายตรงข้ามที่ยังมีชีวิต
    ตามเงื่อนไขชนะที่กำหนด

------------------------------------------------------------------------

## 4. Game Modes

### 4.1 Classic Werewolf

-   เล่นตามลำดับกลางคืนและกลางวัน
-   ผู้เล่นใช้ความสามารถตาม Role
-   มีช่วงพูดคุยและโหวตประหาร
-   เหมาะกับเกมที่ต้องการการวิเคราะห์และหลอกลวง

### 4.2 Fast Werewolf

-   จำกัดเวลาแต่ละ Phase ให้สั้นลง
-   ลดเวลาพูดคุยและการเลือก Action
-   เหมาะกับการเล่นหลายรอบหรือเล่นในกลุ่มที่ต้องการเกมรวดเร็ว

### 4.3 Custom / Mixed Mode

-   Host สามารถกำหนดเวลาและกติกาได้เอง
-   เลือก Role ที่ต้องการเปิดใช้
-   ปรับการเปิดเผย Role เมื่อเสียชีวิต
-   ปรับกติกากรณีคะแนนโหวตเสมอ
-   เปิดหรือปิด Event พิเศษ

> หมายเหตุ: รูปแบบ 2--4 คนควรออกแบบเป็น Mini Werewolf แยกจาก Classic
> เนื่องจากจำนวนผู้เล่นน้อยอาจทำให้เกมเสียสมดุลหรือจบเร็วเกินไป

------------------------------------------------------------------------

## 5. Player Count & Role Presets

ตัวอย่าง Preset สำหรับทดสอบ Balance:

    Players   Werewolf   Seer   Witch   Guardian   Hunter   Villager
  --------- ---------- ------ ------- ---------- -------- ----------
          5          1      1       0          1        0          2
          6          1      1       1          1        0          2
          7          2      1       1          1        1          1
          8          2      1       1          1        1          2

-   Preset เป็นค่าเริ่มต้นสำหรับ Playtest ไม่ใช่กติกาตายตัว
-   จำนวน Role ต้องผ่านการทดสอบ Win Rate และระยะเวลาเฉลี่ยของเกม
-   2--4 Players: ใช้ Mini Mode ที่มีกติกาเฉพาะ

------------------------------------------------------------------------

## 6. Core Gameplay Flow

### 6.1 Lobby

1.  ผู้เล่นสร้างห้องหรือเข้าร่วมห้องด้วย Room Code
2.  แสดงรายชื่อผู้เล่นและสถานะ Ready
3.  Host ตั้งค่าเกมและ Role
4.  Host เริ่มเกมเมื่อเงื่อนไขผู้เล่นครบ

### 6.2 Role Assignment

1.  Server สุ่ม Role ตาม Preset หรือ Custom Rules
2.  แจก Role ให้ผู้เล่นแต่ละคนแบบส่วนตัว
3.  Client แสดง Role Card พร้อม Animation
4.  ผู้เล่นกดยืนยันเพื่อเข้าสู่เกม

### 6.3 Night Phase

1.  เปลี่ยนฉากเป็นกลางคืน
2.  ผู้เล่นที่มี Night Action เลือกเป้าหมาย
3.  Server ตรวจสอบ Action และความถูกต้อง
4.  เมื่อหมดเวลา Server ประมวลผลผลลัพธ์

### 6.4 Morning Phase

1.  เปลี่ยนฉากเป็นกลางวัน
2.  ประกาศผลเหตุการณ์เมื่อคืน
3.  แจ้งผู้เสียชีวิตตามกติกาการเปิดเผยข้อมูล
4.  ตรวจสอบเงื่อนไขชนะ

### 6.5 Discussion Phase

-   ผู้เล่นที่ยังมีชีวิตพูดคุยและวิเคราะห์
-   กล่าวหา ปกป้องตัวเอง หรือเปิดเผยข้อมูล
-   ผู้เล่นที่เสียชีวิตไม่สามารถส่งข้อมูลให้ผู้เล่นที่ยังมีชีวิตได้

### 6.6 Voting Phase

1.  ผู้เล่นเลือกผู้ต้องสงสัย
2.  Server รับและตรวจสอบคะแนน
3.  เมื่อหมดเวลา Server สรุปผล
4.  จัดการกรณีคะแนนเสมอตาม Room Settings

### 6.7 Execution Phase

1.  ประกาศผู้ถูกกำจัด
2.  เปิดเผย Role ตามกติกา
3.  หากเป็น Hunter ให้ประมวลผลความสามารถก่อนตรวจสอบสถานะเกมอีกครั้ง
4.  ตรวจสอบเงื่อนไขชนะ

### 6.8 Next Round / Game Over

-   หากยังไม่มีผู้ชนะ ให้เริ่ม Night Phase รอบใหม่
-   หากมีฝ่ายชนะ ให้เข้าสู่หน้าสรุปผล
-   แสดง Role ของผู้เล่นทั้งหมดหลังจบเกม

------------------------------------------------------------------------

## 7. Night Action & Resolution

ลำดับการประมวลผลเบื้องต้น:

    Order Role       Action
  ------- ---------- ---------------------
        1 Werewolf   เลือกเหยื่อ
        2 Guardian   เลือกผู้ปกป้อง
        3 Seer       ตรวจสอบเป้าหมาย
        4 Witch      ใช้ Healing / Poison
        5 Server     ประมวลผลผลลัพธ์ทั้งหมด

### Example

1.  Werewolf เลือกผู้เล่น A เป็นเหยื่อ
2.  Guardian เลือกปกป้อง A
3.  Seer ตรวจสอบผู้เล่น B
4.  Witch ไม่ใช้ยา
5.  Server ประมวลผลพบว่า A ได้รับการปกป้อง
6.  Morning Phase ประกาศว่าไม่มีผู้เสียชีวิต

### Important Rules

-   Action ต้องถูกส่งและตรวจสอบโดย Server
-   ผู้เล่นต้องไม่เห็น Action ลับของ Role อื่น
-   ต้องกำหนดกติกากรณีเป้าหมายออกจากเกมหรือหมดเวลาก่อน Action
-   ต้องกำหนดลำดับและผลของ Action ที่ขัดแย้งกันให้ชัดเจน
-   Client ไม่มีสิทธิ์ตัดสินผลการโจมตี การป้องกัน หรือการตรวจสอบ

------------------------------------------------------------------------

## 8. Voting System

### Basic Rules

-   ผู้เล่นที่ยังมีชีวิตเท่านั้นที่โหวตได้
-   ผู้เล่นเลือกเป้าหมายได้ 1 คน
-   Server ตรวจสอบว่าเป้าหมายยังมีชีวิตและอยู่ในเกม
-   ผู้เล่นสามารถเปลี่ยนคะแนนก่อนหมดเวลาได้ หาก Host เปิดใช้
-   เมื่อหมดเวลาให้ล็อกคะแนนและสรุปผล

### Tie Rules

Host เลือกได้ 3 รูปแบบ:

1.  **No Execution:** คะแนนเสมอแล้วไม่มีใครถูกกำจัด
2.  **Revote:** ให้โหวตใหม่เฉพาะผู้เล่นที่คะแนนเสมอ
3.  **Random:** สุ่มผู้ถูกกำจัดจากผู้เล่นที่คะแนนเสมอ

------------------------------------------------------------------------

## 9. UI / UX Design

### 9.1 Main Game Screen

องค์ประกอบหลัก:

1.  **Top Bar:** แสดง DAY / NIGHT และหมายเลขรอบ
2.  **Player Area:** แสดงตัวละครผู้เล่นทั้งหมด
3.  **Player Card:** Avatar, ชื่อ และสถานะ Alive / Dead
4.  **Action Panel:** ปุ่มเลือกเป้าหมายหรือใช้ความสามารถ
5.  **Timer:** เวลาที่เหลือใน Phase
6.  **Chat Panel:** ระบบพูดคุยและส่งข้อความ
7.  **Game Log:** แสดงเหตุการณ์ที่เปิดเผยต่อผู้เล่น

### 9.2 Role Reveal Screen

-   แสดงการ์ดด้านหลังแล้วพลิกเปิด
-   ใช้สีและ Effect ตามฝ่าย
-   แสดงชื่อ Role และคำอธิบายความสามารถ
-   มีปุ่ม Confirm เพื่อเข้าสู่เกม

### 9.3 Phase Visuals

-   **Day:** หมู่บ้านสว่าง สดใส และมีบรรยากาศปลอดภัย
-   **Night:** หมู่บ้านมืด มีพระจันทร์ หมอก และแสงเวทมนตร์
-   **Voting:** เน้นผู้เล่นที่ถูกเลือกและคะแนนโหวต
-   **Execution:** ใช้ Animation ประกาศผล
-   **Game Over:** เปิดเผย Role และแสดงฝ่ายชนะ

------------------------------------------------------------------------

## 10. Room Settings

ค่าที่ Host สามารถปรับได้:

  Setting                 Example Options
  ----------------------- --------------------------------
  Discussion Time         30 / 60 / 90 / 120 seconds
  Night Time              20 / 30 / 45 / 60 seconds
  Role Reveal             All / Team Only / Hidden
  Tie Vote                No Execution / Revote / Random
  Spectator               On / Off
  Chat                    On / Off
  Allow Self Protection   On / Off
  Change Vote             On / Off
  Night Events            On / Off

------------------------------------------------------------------------

## 11. Special Events

Event เป็นระบบเสริมที่ Host สามารถเปิดหรือปิดได้

  Event           Effect
  --------------- ----------------------------------
  Blood Moon      หมาป่าได้รับเงื่อนไขพิเศษในคืนนั้น
  Foggy Night     Seer ได้ข้อมูลตรวจสอบแบบจำกัด
  Double Vote     ผู้เล่นที่กำหนดมีคะแนนโหวต 2 คะแนน
  Silent Day      ห้ามพูดคุย แต่ยังโหวตได้
  Mystery Night   ไม่ประกาศจำนวนผู้เสียชีวิตจนกว่าจะจบรอบ

รายละเอียดของ Event ต้องกำหนดเป็นกติกาที่ชัดเจนก่อนนำไปใช้จริง
และต้องไม่ทำให้ข้อมูลลับรั่วไหล

------------------------------------------------------------------------

## 12. Spectator Mode

ผู้เล่นที่ถูกกำจัดสามารถดูเกมต่อได้

### Spectator Features

-   ดูสถานะเกมแบบ Live
-   ดูผู้เล่นที่ยังมีชีวิต
-   ดูเหตุการณ์และผลลัพธ์ที่เกิดขึ้น
-   ดู Role ของผู้เล่นทั้งหมด
-   ดู Action ลับได้เฉพาะเมื่อเกมจบแล้ว

### Anti-Cheat

-   Spectator ห้ามส่งข้อความถึงผู้เล่นที่ยังมีชีวิต
-   แยก Chat ของผู้เล่นที่ยังมีชีวิตกับ Spectator
-   ไม่ส่งข้อมูล Role หรือ Night Action ลับให้ Client ของผู้เล่นที่ยังมีชีวิต
-   ป้องกันการใช้ข้อมูลจาก Spectator เพื่อสื่อสารย้อนกลับเข้าเกม

------------------------------------------------------------------------

## 13. Statistics & End Game

หน้าสรุปผลหลังจบเกมควรแสดง:

-   ฝ่ายที่ชนะ
-   รายชื่อผู้เล่นทั้งหมด
-   Role ของผู้เล่นแต่ละคน
-   จำนวนรอบที่เล่น
-   จำนวนครั้งที่ถูกกำจัด
-   จำนวนครั้งที่โหวตถูก
-   จำนวนครั้งที่ใช้ความสามารถสำเร็จ
-   MVP ประจำเกม

### Player Statistics

-   Total Games
-   Total Wins
-   Win Rate
-   Werewolf Games
-   Village Games
-   Correct Votes
-   Successful Abilities
-   Most Played Role

------------------------------------------------------------------------

## 14. Cosmetic & Collection System

ระบบสะสมของตกแต่งที่ไม่ส่งผลต่อความสมดุลของเกม

-   Character Skin
-   Role Card Frame
-   Card Back
-   Avatar Frame
-   Animation Effect
-   Victory Effect
-   Nameplate

> Cosmetic ต้องไม่มีผลต่อความสามารถหรือโอกาสชนะของผู้เล่น

------------------------------------------------------------------------

## 15. Technical Architecture

แนะนำให้พัฒนา Werewolf เป็น Game Module แยกจากเกมอื่นใน NUMVERSE แต่ใช้ระบบ
Authentication และ Room ร่วมกัน

### Suggested Stack

  Layer                    Technology              Responsibility
  ------------------------ ----------------------- ----------------------
  Frontend                 Next.js / React         Game UI
  Language                 TypeScript              Type Safety
  Realtime                 Socket.IO / WebSocket   Real-time Events
  Game Engine              Node.js                 Game Rules & State
  Cache / Realtime State   Redis                   Timer / Room State
  Database                 PostgreSQL              User / Match History

### Architecture Flow

``` text
Next.js / React Client
        |
        | Socket.IO / WebSocket
        v
Realtime Gateway
        |
        v
Werewolf Game Engine
  |       |        |
  |       |        +-- Voting Engine
  |       +----------- Night Resolver
  +------------------- Role Manager
        |
        +---- Redis
        |
        +---- PostgreSQL
```

### Core Modules

  Module          Responsibility
  --------------- ----------------------------
  Room Manager    สร้างและจัดการห้อง
  Role Manager    สุ่มและแจก Role
  Game State      ควบคุมสถานะเกม
  Night Engine    รับและประมวลผล Night Action
  Voting Engine   จัดการคะแนนโหวต
  Win Condition   ตรวจสอบฝ่ายชนะ
  Spectator       จัดการผู้ชมเกม
  History         บันทึกประวัติการแข่งขัน

------------------------------------------------------------------------

## 16. Server Authority & Security

Server ต้องเป็นผู้ควบคุมและตัดสินผลทั้งหมด

### Security Requirements

1.  สุ่ม Role บน Server เท่านั้น
2.  ส่ง Role ให้เจ้าของ Role ผ่าน Private Event
3.  ห้ามส่ง Role ลับทั้งหมดไปยัง Client แล้วซ่อนด้วย UI
4.  ตรวจสอบผู้เล่นและสิทธิ์ก่อนรับ Action ทุกครั้ง
5.  ป้องกันการส่ง Action ซ้ำ
6.  ป้องกันการโหวตหลังหมดเวลา
7.  ป้องกันผู้เล่นที่ตายแล้วใช้ Action
8.  ตรวจสอบเป้าหมายว่าอยู่ในห้องและยังมีชีวิต
9.  ใช้ Server Timer เป็นแหล่งเวลาอ้างอิง
10. บันทึก Event สำคัญเพื่อใช้ตรวจสอบย้อนหลัง

### Suggested Event Names

  Event                   Direction            Purpose
  ----------------------- -------------------- ------------------
  `ww:room:join`          Client → Server      เข้าห้อง
  `ww:room:leave`         Client → Server      ออกจากห้อง
  `ww:player:ready`       Client → Server      เปลี่ยนสถานะ Ready
  `ww:game:start`         Client → Server      Host เริ่มเกม
  `ww:role:private`       Server → Client      ส่ง Role ส่วนตัว
  `ww:phase:update`       Server → Client      แจ้ง Phase
  `ww:night:action`       Client → Server      ส่ง Night Action
  `ww:vote:submit`        Client → Server      ส่งคะแนนโหวต
  `ww:game:result`        Server → Client      ส่งผลเกม
  `ww:spectator:update`   Server → Spectator   อัปเดตสถานะผู้ชม

ชื่อ Event เป็นข้อเสนอเริ่มต้น สามารถปรับให้ตรงกับ Convention ของ NUMVERSE ได้

------------------------------------------------------------------------

## 17. Suggested Data Models

### Match

``` ts
interface WerewolfMatch {
  id: string;
  roomId: string;
  status: "lobby" | "playing" | "finished";
  phase:
    | "role_reveal"
    | "night"
    | "morning"
    | "discussion"
    | "voting"
    | "execution"
    | "finished";
  round: number;
  startedAt?: Date;
  endedAt?: Date;
  winner?: "village" | "werewolf";
}
```

### Player

``` ts
interface WerewolfPlayer {
  userId: string;
  matchId: string;
  role:
    | "werewolf"
    | "villager"
    | "seer"
    | "witch"
    | "guardian"
    | "hunter";
  team: "village" | "werewolf";
  isAlive: boolean;
  isReady: boolean;
}
```

### Night Action

``` ts
interface NightAction {
  playerId: string;
  actionType:
    | "attack"
    | "protect"
    | "inspect"
    | "heal"
    | "poison";
  targetId?: string;
  round: number;
  submittedAt: Date;
}
```

### Vote

``` ts
interface WerewolfVote {
  voterId: string;
  targetId: string;
  round: number;
  submittedAt: Date;
}
```

> ข้อควรระวัง: ตัวอย่าง Interface นี้เป็นโครงสร้างเริ่มต้นเท่านั้น ข้อมูล Role และ
> Action ลับควรถูกจัดเก็บและส่งแยกตามสิทธิ์ ไม่ควรเปิดเผยผ่าน Public Match State

------------------------------------------------------------------------

## 18. Win Conditions

### Village Win

-   Werewolf ทุกคนถูกกำจัด

### Werewolf Win

-   จำนวน Werewolf ที่ยังมีชีวิตเท่ากับหรือมากกว่าผู้เล่นฝ่ายอื่นที่ยังมีชีวิต

### Draw / Special Cases

ต้องกำหนดเพิ่มเติมสำหรับกรณี:

-   ผู้เล่นทุกคนเสียชีวิตพร้อมกัน
-   Hunter ทำให้ผู้เล่นคนสุดท้ายเสียชีวิต
-   Action หลายรายการทำให้เกิดการเสียชีวิตพร้อมกัน
-   ผู้เล่นออกจากเกมระหว่างการประมวลผล
-   ไม่มีผู้เล่นเหลือในฝ่ายใดฝ่ายหนึ่ง

การตรวจสอบ Win Condition ต้องทำบน Server
หลังการประมวลผลเหตุการณ์ที่เกี่ยวข้องทุกครั้ง

------------------------------------------------------------------------

## 19. Development Roadmap

### Phase 1 --- MVP Core Gameplay

-   [ ] Room Integration
-   [ ] Player Ready System
-   [ ] Role Assignment
-   [ ] Role Reveal
-   [ ] Day / Night Cycle
-   [ ] Night Action
-   [ ] Discussion Timer
-   [ ] Voting System
-   [ ] Execution
-   [ ] Win Condition

**Goal:** เล่นเกมได้ตั้งแต่เริ่มห้องจนจบเกม

### Phase 2 --- Role Abilities

-   [ ] Werewolf Attack
-   [ ] Seer Inspection
-   [ ] Witch Healing
-   [ ] Witch Poison
-   [ ] Guardian Protection
-   [ ] Hunter Counterattack
-   [ ] Action Resolution Tests

**Goal:** ความสามารถของ Role ทั้งหมดทำงานถูกต้อง

### Phase 3 --- UI / Multiplayer Experience

-   [ ] Role Card Animation
-   [ ] Day / Night Background
-   [ ] Player Status UI
-   [ ] Voting Animation
-   [ ] Chat
-   [ ] Spectator Mode
-   [ ] Game Log

**Goal:** เกมพร้อมสำหรับการทดสอบกับผู้เล่นจริง

### Phase 4 --- Advanced Features

-   [ ] Custom Rules
-   [ ] Special Events
-   [ ] Player Statistics
-   [ ] Match History
-   [ ] Cosmetic Collection
-   [ ] Replay System
-   [ ] Ranking / Achievements

**Goal:** เพิ่มความหลากหลายและการกลับมาเล่นซ้ำ

------------------------------------------------------------------------

## 20. MVP Acceptance Checklist

ก่อนปล่อยเวอร์ชันแรก ต้องทดสอบอย่างน้อย:

-   [ ] ผู้เล่นเข้าห้องและออกจากห้องได้
-   [ ] Host เริ่มเกมได้เมื่อเงื่อนไขครบ
-   [ ] Role ถูกสุ่มและไม่ซ้ำตาม Preset
-   [ ] ผู้เล่นเห็นเฉพาะ Role ของตัวเอง
-   [ ] Night Action ถูกส่งและประมวลผลถูกต้อง
-   [ ] Guardian ป้องกันการโจมตีได้ตามกติกา
-   [ ] Witch ใช้ยาได้ตามจำนวนครั้งที่กำหนด
-   [ ] Seer ได้ผลตรวจสอบถูกต้อง
-   [ ] Hunter ใช้ความสามารถเมื่อถูกกำจัดได้
-   [ ] ผู้เล่นที่ตายแล้วไม่สามารถใช้ Action หรือโหวตได้
-   [ ] ระบบโหวตจัดการคะแนนเสมอได้
-   [ ] Timer ทำงานโดยยึด Server เป็นหลัก
-   [ ] ตรวจสอบ Win Condition ได้ถูกต้อง
-   [ ] ผู้เล่นหลุดและกลับเข้าห้องได้ตามกติกา
-   [ ] Spectator ไม่สามารถส่งข้อมูลลับให้ผู้เล่นที่ยังมีชีวิต
-   [ ] จบเกมแล้วแสดงผลและ Role ได้ถูกต้อง

------------------------------------------------------------------------

## 21. Future Ideas

### Dynamic Village

-   ฉากเปลี่ยนตาม Day / Night
-   มีแสงพระจันทร์ หมอก และบรรยากาศแฟนตาซี
-   เพิ่ม Animation ของหมู่บ้านตามเหตุการณ์ในเกม

### Character Collection

-   ปลดล็อก Skin
-   สะสม Role Card Frame
-   ปลดล็อก Card Back
-   มี Avatar และ Nameplate

### End Game Replay

-   ดูเหตุการณ์ย้อนหลังแต่ละคืน
-   ดูว่า Werewolf เลือกใคร
-   ดูว่า Seer ตรวจสอบใคร
-   ดูว่า Guardian ปกป้องใคร
-   ดูประวัติการโหวตของทุกคน

------------------------------------------------------------------------

## 22. Product Direction

แนวทางที่แนะนำสำหรับ NUMVERSE Werewolf:

1.  เริ่มจาก Classic Werewolf ที่มี Role หลัก 6 แบบ
2.  ทำ MVP ให้เล่นได้ครบก่อนเพิ่มระบบเสริม
3.  ใช้ Server-authoritative Game Engine
4.  ใช้ Room และ Authentication ร่วมกับ NUMVERSE
5.  ออกแบบ UI ให้เรียบง่าย แต่ให้ Character Card เป็นจุดเด่น
6.  เพิ่ม Custom Rules, Spectator และ Replay ในระยะถัดไป

**Initial Release Goal:** เกม Werewolf ที่ผู้เล่นสามารถสร้างห้อง ชวนเพื่อน สุ่ม
Role เล่นจนจบเกม และดูผลการแข่งขันได้อย่างเสถียร
