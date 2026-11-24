const PAGE=100, SPAN_MAX=10000, PLAYER_MAX=30, STORE="dpn-players", STORE_SCORES="dpn-scores", STORE_WHEEL="dpn-wheel-scores";
const WHEEL_COLORS=["#2563eb","#dc2626","#16a34a","#d97706","#7c3aed","#db2777","#0891b2","#65a30d","#ea580c","#4f46e5","#be123c","#0d9488"];
const BAND_A="#9f1239", BAND_B="#111827", DEAD_SLICE="#475569";
let gameMin=1, gameMax=99, secrets=[], secretAll=[], secretTotal=1, winTarget=3, pointAll=true, lo, hi, picked, pageFrom=1, useCustom=false, pickMin=1, pickMax=99;
let players=[], scores={}, order=[], alive=[], roundOrder=[], turn=0, nextOrder=[], spinning=false, rot=0, spinTimer=0;
let lastWinners=[]; // offline: champion names; online uses playerMeta.champion
let gameCat="secret", wheelMin=1, wheelMax=99, wheelOrder=[], picks={}, pickEach=1, pickCursor=0, pickFrom=1;
let roomMaxPlayers=12;
let wheelAlive=[], wheelLog=[], wheelGone=[], wheelRot=0, wheelSpinning=false, wheelAnim=0, wheelEndTimer=0, wheelGen=0;
let snakeLive=null;
let snakeSnapSeq=0;
let imposterLive=null;
let memoryLive=null;
let werewolfLive=null;
function ensureMemoryUi(){
  if(memoryLive) return memoryLive;
  const root=$("memoryRoot");
  if(!root||!window.NVMemory||typeof window.NVMemory.createLiveUi!=="function") return null;
  memoryLive=window.NVMemory.createLiveUi({
    root,
    onFlip:(cardId)=>{ if(onlineMode&&!spectating) send({t:"memory:flip",cardId}); },
    onYourTurn:()=>{ if(!spectating) playClip(YOUR_TURN_SOUND); },
    onCountdown:()=>{ if(!spectating) playClip(COOLDOWN_SOUND); }
  });
  return memoryLive;
}
function updateMemoryUi(s){
  const ui=ensureMemoryUi();
  if(!ui) return;
  const note=$("memorySpectateNote");
  if(note) note.classList.toggle("hidden",!spectating);
  ui.paint(s&&s.memory);
}
function ensureImposterUi(){
  if(imposterLive) return imposterLive;
  const root=$("imposterRoot");
  if(!root||!window.NVImposter||typeof window.NVImposter.createLiveUi!=="function") return null;
  imposterLive=window.NVImposter.createLiveUi({
    root,
    send:(payload)=>{ if(onlineMode&&!spectating) send(payload); },
    youId:()=>myId||"",
    onCountdown:()=>playClip(COOLDOWN_SOUND)
  });
  return imposterLive;
}
function updateImposterUi(s){
  const ui=ensureImposterUi();
  if(!ui) return;
  const note=$("imposterSpectateNote");
  if(note){
    note.classList.toggle("hidden",!spectating);
    if(spectating) note.textContent="โหมด Spectator — ดูได้อย่างเดียว ไม่เห็นบทบาท/คำศัพท์ของใคร";
  }
  ui.paint(s&&s.imposter, s&&s.youImposter, {
    players: (s&&s.players)||[],
    youId: (s&&s.youId)||myId||""
  });
}
function ensureWerewolfUi(){
  if(werewolfLive) return werewolfLive;
  const root=$("werewolfRoot");
  if(!root||!window.NVWerewolf||typeof window.NVWerewolf.createLiveUi!=="function") return null;
  werewolfLive=window.NVWerewolf.createLiveUi({
    root,
    send:(payload)=>{ if(onlineMode&&!spectating) send(payload); },
    onCountdown:()=>playClip(COOLDOWN_SOUND)
  });
  return werewolfLive;
}
function updateWerewolfUi(s){
  const ui=ensureWerewolfUi();
  if(!ui) return;
  const note=$("werewolfSpectateNote");
  if(note){
    note.classList.toggle("hidden",!spectating);
    if(spectating) note.textContent="โหมด Spectator — ดูได้อย่างเดียว ไม่เห็นบทบาทลับของใคร";
  }
  ui.paint(s&&s.werewolf, s&&s.youWerewolf, {
    players: (s&&s.players)||[],
    youId: (s&&s.youId)||myId||""
  });
}
function ensureSnakeBoard(){
  if(snakeLive) return snakeLive;
  const root=$("snakeRoot");
  if(!root||!window.NVSnake||typeof window.NVSnake.createLiveBoard!=="function") return null;
  snakeLive=window.NVSnake.createLiveBoard({
    root,
    onRoll:(parity)=>{
      if(!onlineMode||spectating||myAuto||!myTurn) return;
      const payload={t:"roll",commandId:"roll-"+Date.now()+"-"+Math.random().toString(36).slice(2,8)};
      if(parity==="even"||parity==="odd") payload.parity=parity;
      send(payload);
    },
    onToggleAuto:()=>{
      if(!onlineMode||spectating||netPhase!=="snake") return;
      send({t:"auto",on:!myAuto});
    },
    onSnakeHit:()=>playClip(SNAKE_HIT_SOUND),
    onBombHit:()=>playClip(BOMB_SOUND),
    onYourTurn:()=>playClip(YOUR_TURN_SOUND),
    onOpenBag:()=>{
      if(!onlineMode||spectating||!canUseFriends()) return;
      openLobbyBagModal();
    }
  });
  return snakeLive;
}
function pauseFlashActive(pid){
  const id=String(pid||"");
  if(!id) return false;
  const entry=pauseFlashUntil.get(id);
  const until=entry&&typeof entry==="object"?Number(entry.until)||0:Number(entry)||0;
  if(until>Date.now()) return true;
  if(entry) pauseFlashUntil.delete(id);
  return false;
}
function playerHasPause(metaOrId){
  if(metaOrId&&typeof metaOrId==="object"){
    if(metaOrId.skipNextTurn) return true;
    if(Math.max(0, Number(metaOrId.bombPauseTurns)||0)>0) return true;
    return pauseFlashActive(metaOrId.id||metaOrId.userId);
  }
  return pauseFlashActive(metaOrId);
}
function flashPlayerPause(pid, ms){
  const id=String(pid||"");
  if(!id) return;
  const dur=Math.max(1200, Number(ms)||4500);
  const prev=pauseFlashUntil.get(id);
  if(prev&&prev.timer) clearTimeout(prev.timer);
  const until=Date.now()+dur;
  const timer=setTimeout(()=>{
    const cur=pauseFlashUntil.get(id);
    if(cur&&cur.until===until) pauseFlashUntil.delete(id);
    renderPlayers();
    if(netPhase==="snake"&&lastNetSnap) updateSnakeBoard(lastNetSnap);
  }, dur+40);
  pauseFlashUntil.set(id,{until,timer});
  renderPlayers();
  if(netPhase==="snake"&&lastNetSnap) updateSnakeBoard(lastNetSnap);
}
function updateSnakeBoard(s){
  const board=ensureSnakeBoard();
  if(!board) return Promise.resolve();
  const seq=++snakeSnapSeq;
  const note=$("snakeSpectateNote");
  if(note){
    note.classList.toggle("hidden",!spectating);
    if(spectating) note.textContent="โหมด Spectator — ดูกระดานได้อย่างเดียว ไม่สามารถทอยได้";
  }
  const me=(s&&s.players||playerMeta||[]).find(p=>p&&p.id===(s&&s.youId||myId));
  const evenOddCharges=s&&s.youEvenOddCharges!=null
    ?Number(s.youEvenOddCharges)||0
    :(me?Number(me.evenOddCharges)||0:0);
  const snake=s&&s.snake?s.snake:null;
  const snakeView=snake&&Array.isArray(snake.players)
    ?Object.assign({}, snake, {
      players:snake.players.map(p=>{
        const flash=playerHasPause(p.userId);
        if(!flash||p.skipNextTurn) return p;
        return Object.assign({}, p, {skipNextTurn:true});
      })
    })
    :snake;
  return Promise.resolve(
    board.update(snakeView,{
      youId:s&&s.youId||myId||"",
      spectator:!!spectating,
      auto:!!myAuto,
      evenOddCharges
    })
  ).then(()=>{
    if(seq!==snakeSnapSeq) return;
  });
}
const $=id=>document.getElementById(id);
const POP_SOUND="/audio/pop-sound-effect_AsEdnw2.mp3";
const SPIN_SOUND="/audio/spinner-sound.mp3";
const BOMB_SOUND="/audio/roblox-death-sound_1.mp3";
const COOLDOWN_SOUND="/audio/beep.mp3";
const WIN_SOUND="/audio/roblox-old-winning-sound-effect.mp3";
const ROOM_CHAT_SOUND="/audio/snapchat-message.mp3";
const SNAKE_HIT_SOUND="/audio/gunshot-meme.mp3";
const YOUR_TURN_SOUND="/audio/correct-gameshow.mp3";
const ROOM_CHAT_MS=6000;
const roomChatBubbles=new Map(); /* pid -> { body, until, timer } */
const pauseFlashUntil=new Map(); /* pid -> expiry ms — brief Pause after instant skip */
const VOL_STORE="dpn-volume";
const BG_BASE=0.08, SPIN_BASE=0.18, SFX_BASE=0.35;
const BG_SRC=encodeURI("/audio/Copyright Free Background Music Mix for Content Creators Royalty Free - (original Kbps).mp3");
const bgAudio=new Audio();
bgAudio.crossOrigin="anonymous";
bgAudio.preload="auto";
bgAudio.loop=true;
bgAudio.playsInline=true;
bgAudio.src=BG_SRC;
let spinSoundTimer=0;
let spinDoneTimer=0;
let audioKeepAliveTimer=0;
let masterVol=0.4;
try{
  const raw=localStorage.getItem(VOL_STORE);
  if(raw!=null&&raw!==""){
    const saved=Number(raw);
    if(Number.isFinite(saved)) masterVol=Math.min(1,Math.max(0,Math.round(saved*10)/10));
  }
}catch(e){}
let audioCtx=null, masterGain=null, bgGain=null, spinGain=null;
let bgWired=false, spinNode=null, audioWarm=null;
const clipCache={};
function ensureAudio(){
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!AC) return null;
  if(!audioCtx){
    audioCtx=new AC();
    masterGain=audioCtx.createGain();
    masterGain.gain.value=masterVol;
    masterGain.connect(audioCtx.destination);
    bgGain=audioCtx.createGain();
    bgGain.gain.value=BG_BASE;
    bgGain.connect(masterGain);
    spinGain=audioCtx.createGain();
    spinGain.gain.value=SPIN_BASE;
    spinGain.connect(masterGain);
  }
  if(audioCtx.state==="suspended") audioCtx.resume().catch(()=>{});
  return audioCtx;
}
function wireBackground(){
  const ctx=ensureAudio();
  if(!ctx||!bgGain||bgWired) return;
  try{
    ctx.createMediaElementSource(bgAudio).connect(bgGain);
    bgAudio.volume=1;
    bgWired=true;
  }catch(e){}
}
function unlockAudio(){
  const ctx=ensureAudio();
  if(!ctx) return null;
  if(ctx.state==="suspended") ctx.resume().catch(()=>{});
  try{
    const blank=ctx.createBuffer(1, 1, ctx.sampleRate||22050);
    const src=ctx.createBufferSource();
    src.buffer=blank;
    src.connect(ctx.destination);
    src.start(0);
  }catch(e){}
  wireBackground();
  warmClips();
  return ctx;
}
function loadClip(src){
  if(clipCache[src]) return Promise.resolve(clipCache[src]);
  const ctx=ensureAudio();
  if(!ctx) return Promise.reject(new Error("no audio"));
  return fetch(src).then(r=>{
    if(!r.ok) throw new Error("fetch "+src);
    return r.arrayBuffer();
  }).then(ab=>ctx.decodeAudioData(ab.slice(0))).then(buf=>{
    clipCache[src]=buf;
    return buf;
  });
}
function warmClips(){
  if(audioWarm) return audioWarm;
  audioWarm=Promise.allSettled([
    loadClip(SPIN_SOUND),
    loadClip(POP_SOUND),
    loadClip(BOMB_SOUND),
    loadClip(COOLDOWN_SOUND),
    loadClip(WIN_SOUND),
    loadClip(SNAKE_HIT_SOUND),
    loadClip(YOUR_TURN_SOUND),
    loadClip(ROOM_CHAT_SOUND)
  ]);
  return audioWarm;
}
function keepAudioAlive(){
  if(masterVol<=0) return;
  const ctx=ensureAudio();
  if(ctx&&ctx.state==="suspended") ctx.resume().catch(()=>{});
  wireBackground();
  if(bgAudio.paused){
    bgAudio.play().catch(()=>{});
  }
}
function clearSpinTimers(){
  if(spinSoundTimer){ clearTimeout(spinSoundTimer); spinSoundTimer=0; }
  if(spinDoneTimer){ clearTimeout(spinDoneTimer); spinDoneTimer=0; }
}
function armSpinSoundWatch(ms){
  if(spinSoundTimer) clearTimeout(spinSoundTimer);
  spinSoundTimer=setTimeout(()=>{
    spinSoundTimer=0;
    stopSpinSound();
  }, Math.max(0, Number(ms)||0));
}
function applyVolume(){
  if(masterGain&&audioCtx){
    const t=audioCtx.currentTime;
    try{ masterGain.gain.cancelScheduledValues(t); }catch(e){}
    masterGain.gain.setValueAtTime(Math.max(0, masterVol), t);
  }else if(masterGain){
    masterGain.gain.value=masterVol;
  }
  bgAudio.muted=masterVol<=0;
  if(masterVol<=0){
    stopBackground();
    stopSpinSound();
  }
  const label=$("volMenuLabel");
  if(label) label.textContent=masterVol<=0?"ปิดเสียง":(Math.round(masterVol*100)+"%");
  const ico=document.querySelector("#volMenuBtn .vol-select-ico");
  if(ico) ico.textContent=masterVol<=0?"🔇":"🔊";
  document.querySelectorAll("#volMenuList [data-vol]").forEach((btn)=>{
    const on=Number(btn.getAttribute("data-vol"))===masterVol;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-selected", on?"true":"false");
  });
}
function closeVolMenu(){
  const menu=$("volMenu");
  const list=$("volMenuList");
  const btn=$("volMenuBtn");
  if(menu) menu.classList.remove("is-open");
  if(list) list.classList.add("hidden");
  if(btn) btn.setAttribute("aria-expanded","false");
}
function toggleVolMenu(force){
  const menu=$("volMenu");
  const list=$("volMenuList");
  const btn=$("volMenuBtn");
  if(!menu||!list||!btn) return;
  const open=force==null?!menu.classList.contains("is-open"):!!force;
  menu.classList.toggle("is-open", open);
  list.classList.toggle("hidden", !open);
  btn.setAttribute("aria-expanded", open?"true":"false");
}
function setVolume(next, preview){
  masterVol=Math.min(1,Math.max(0,Math.round(next*10)/10));
  try{ localStorage.setItem(VOL_STORE,String(masterVol)); }catch(e){}
  unlockAudio();
  applyVolume();
  if(masterVol>0) startBackground();
  if(preview&&masterVol>0) playClip(POP_SOUND);
}
function placeHelpBtn(inGame){
  const btn=$("helpBtn");
  if(!btn) return;
  const end=$("roombarEnd");
  const slot=$("helpSlot");
  if(inGame&&end){
    const quit=$("quitGameBtn");
    if(quit&&quit.parentNode===end) end.insertBefore(btn, quit);
    else end.appendChild(btn);
  }else if(slot){
    slot.appendChild(btn);
  }
}
function stopBackground(){
  try{ bgAudio.pause(); }catch(e){}
}
function startBackground(){
  if(masterVol<=0) return;
  const ctx=unlockAudio();
  if(!ctx) return;
  wireBackground();
  const run=()=>{ bgAudio.play().catch(()=>{}); };
  if(ctx.state==="running") run();
  else ctx.resume().then(run).catch(run);
}
function playClip(src){
  if(masterVol<=0) return;
  const ctx=unlockAudio();
  if(!ctx||!masterGain) return;
  const start=buf=>{
    if(!buf||masterVol<=0) return;
    const node=ctx.createBufferSource();
    node.buffer=buf;
    const g=ctx.createGain();
    g.gain.value=SFX_BASE;
    node.connect(g).connect(masterGain);
    try{ node.start(0); }catch(e){}
  };
  if(clipCache[src]){
    if(ctx.state==="running") start(clipCache[src]);
    else ctx.resume().then(()=>start(clipCache[src])).catch(()=>{});
    return;
  }
  loadClip(src).then(buf=>{
    if(ctx.state==="running") start(buf);
    else ctx.resume().then(()=>start(buf)).catch(()=>{});
  }).catch(()=>{});
}
applyVolume();
let lastBombKey="";
function bombKey(list){
  const last=Array.isArray(list)&&list.length?list[list.length-1]:null;
  if(!last||!last.hit) return "";
  return String(list.length)+"|"+last.n+"|"+(last.who||"");
}
function maybePlayBomb(list){
  const key=bombKey(list);
  if(!key||key===lastBombKey) return;
  lastBombKey=key;
  playClip(BOMB_SOUND);
}
function playSpinSound(){
  if(masterVol<=0) return;
  const ctx=unlockAudio();
  if(!ctx||!spinGain) return;
  stopSpinSound();
  const start=buf=>{
    if(!buf||masterVol<=0) return;
    const node=ctx.createBufferSource();
    node.buffer=buf;
    node.loop=true;
    node.connect(spinGain);
    node.onended=()=>{ if(spinNode===node) spinNode=null; };
    try{
      node.start(0);
      spinNode=node;
    }catch(e){ spinNode=null; }
  };
  if(clipCache[SPIN_SOUND]){
    if(ctx.state==="running") start(clipCache[SPIN_SOUND]);
    else ctx.resume().then(()=>start(clipCache[SPIN_SOUND])).catch(()=>{});
  }else loadClip(SPIN_SOUND).then(buf=>{
    if(ctx.state==="running") start(buf);
    else ctx.resume().then(()=>start(buf)).catch(()=>{});
  }).catch(()=>{});
}
function stopSpinSound(){
  if(spinSoundTimer){ clearTimeout(spinSoundTimer); spinSoundTimer=0; }
  if(!spinNode) return;
  try{ spinNode.onended=null; spinNode.stop(); }catch(e){}
  spinNode=null;
}
let onlineMode=true, myId="", hostId="", myTurn=false, myAuto=false, playerMeta=[], roomCode="", applying=false, netPhase="gate";
let lastNetSnap=null;
let roomVisibility="";
let onlineFriendIds=new Set();
let pendingRoomInvite=null;
let friendsCache=[];
let turnSec=0, turnEndsAt=0, lastCooldownSec=-1;
let animId="", animGen=0, pendingSnap=null, sock=null, connTimer=0, wantRoom=false;
let liveSpin=null, liveSpinUntil=0, orderAnim=0;
let spectating=false, pendingAction=null, pendingSetup=null, enterIntent=false;
function rememberActiveRoom(code){
  try{
    if(/^\d{6}$/.test(String(code||""))) localStorage.setItem("nv-active-room", String(code));
    else localStorage.removeItem("nv-active-room");
  }catch(e){}
}
function clearActiveRoom(){
  try{ localStorage.removeItem("nv-active-room"); }catch(e){}
}
function readPlayParams(){
  const q=new URLSearchParams(location.search);
  const code=String(q.get("code")||"").replace(/\D/g,"").slice(0,6);
  const create=q.get("create");
  const watch=q.get("watch")==="1"||q.get("spectate");
  const resume=q.get("resume")==="1";
  const name=q.get("name");
  if(name) try{ localStorage.setItem("dpn-name", name); }catch(e){}
  let setup=null;
  try{ if(q.get("setup")) setup=JSON.parse(q.get("setup")); }catch(e){}
  pendingSetup=setup;
  const inviteId=String(q.get("invite")||"").trim();
  let saved="";
  try{ saved=String(localStorage.getItem("nv-active-room")||"").replace(/\D/g,"").slice(0,6); }catch(e){}
  if(watch&&(/^\d{6}$/.test(code)||q.get("spectate"))){
    spectating=true;
    pendingAction={type:"watch",code:code||String(q.get("spectate")||"").replace(/\D/g,"").slice(0,6)};
  }else if(inviteId) pendingAction={type:"acceptInvite",inviteId};
  else if(/^\d{6}$/.test(code)) pendingAction={type:"join",code};
  else if(create==="public"||create==="private") pendingAction={type:"create",visibility:create};
  else if(resume||/^\d{6}$/.test(saved)) pendingAction={type:"resume",code:code||saved||""};
}
function runPendingAction(){
  if(!pendingAction||!sock||sock.readyState!==1) return;
  const action=pendingAction;
  enterIntent=true;
  const name=typedName()||localStorage.getItem("dpn-name")||"Player";
  if(action.type==="join"){
    send({t:"join",code:action.code,name,token:myToken(),avatarUrl:myAvatar()});
  }else if(action.type==="create"){
    send({t:"create",visibility:action.visibility,name,token:myToken(),avatarUrl:myAvatar(),setup:pendingSetup||undefined});
  }else if(action.type==="watch"){
    send({t:"watch",code:action.code,token:myToken(),name,avatarUrl:myAvatar()});
  }else if(action.type==="acceptInvite"){
    send({t:"acceptInvite",inviteId:action.inviteId,name,token:myToken(),avatarUrl:myAvatar()});
  }else if(action.type==="resume"){
    // hello may already reattach; if not and we know the code, rejoin.
    if(/^\d{6}$/.test(String(action.code||""))&&!wantRoom){
      send({t:"join",code:action.code,name,token:myToken(),avatarUrl:myAvatar()});
    }
    setTimeout(()=>{
      if(!wantRoom&&!spectating&&!pendingAction){
        clearActiveRoom();
        location.replace("/app#rooms");
      }
    }, 1200);
  }
  pendingAction=null;
  try{
    const u=new URL(location.href);
    ["code","create","watch","spectate","setup","name","invite","resume"].forEach(k=>u.searchParams.delete(k));
    history.replaceState({}, "", u.pathname+(u.search||""));
  }catch(e){}
}
function applySpectatorUi(){
  if(!spectating) return;
  document.body.classList.add("spectating");
  const note=$("roomNote");
  if(note){ note.classList.remove("hidden"); note.textContent="โหมด Spectator — ดูได้อย่างเดียว"; }
  ["spin","clearScores","addBot","again","pickGo","doSpin","wheelRepick","autoPlay","autoPick","autoSnake","renameRoomBtn","snakeLeave","imposterLeave","memoryLeave","werewolfLeave"].forEach(id=>{
    const el=$(id); if(el){ el.disabled=true; el.classList.add("hidden"); }
  });
}
function show(n){
  ["gate","start","play","pick","wheelGame","snakeGame","imposterGame","memoryGame","werewolfGame","over"].forEach(s=>{ const el=$(s); if(el) el.classList.toggle("hidden",s!==n); });
  const inRoom=n!=="gate";
  const lobby=n==="start";
  const snakePlay=n==="snakeGame";
  const imposterPlay=n==="imposterGame";
  const memoryPlay=n==="memoryGame";
  const werewolfPlay=n==="werewolfGame";
  const inGame=inRoom&&!lobby;
  document.body.classList.toggle("snake-play", snakePlay);
  document.body.classList.toggle("imposter-play", imposterPlay);
  document.body.classList.toggle("memory-play", memoryPlay);
  document.body.classList.toggle("werewolf-play", werewolfPlay);
  document.body.classList.toggle("in-game", inGame);
  if(!snakePlay){
    try{ delete document.body.dataset.snakeMap; }catch(e){}
  }
  const side=document.querySelector(".side");
  // Snake board needs width — player list lives in the snake panel.
  if(side) side.classList.toggle("hidden",!inRoom||lobby||snakePlay);
  // In-game: slim status bar + power quit. Lobby has its own leave.
  const bar=$("roombar");
  if(bar){
    bar.classList.toggle("hidden",!inRoom||lobby);
    bar.classList.toggle("in-game", inGame);
  }
  if($("roomCode")) $("roomCode").classList.toggle("hidden", true);
  if($("copyCode")) $("copyCode").classList.toggle("hidden", true);
  if($("leaveRoom")) $("leaveRoom").classList.toggle("hidden", true);
  if($("quitGameBtn")) $("quitGameBtn").classList.toggle("hidden", !inGame);
  placeHelpBtn(inGame);
  if(!inGame) closeQuitGameModal();
  $("roomNote").classList.toggle("hidden",!inRoom||lobby);
  document.body.classList.toggle("lobby-mode", lobby);
  // Full-bleed art behind lobby + active match screens.
  document.body.classList.toggle("room-bg", inRoom);
  const stage=document.querySelector(".stage");
  if(stage) stage.classList.toggle("lobby-stage", lobby);
  const card=document.querySelector("main.card");
  if(card) card.classList.toggle("lobby-card", lobby);
  paintRoomChatBar();
}
function clearRoomChatLog(){
  const log=$("roomChatLog");
  if(log) log.innerHTML="";
}
function isMobileChatDrawer(){
  try{ return window.matchMedia("(max-width: 960px)").matches; }catch(_){ return false; }
}
function isRoomChatDrawerOpen(){
  return document.body.classList.contains("chat-drawer-open");
}
function setRoomChatUnread(on){
  const btn=$("roomChatToggle");
  if(btn) btn.classList.toggle("has-unread", !!on);
}
function setRoomChatDrawer(open){
  const want=!!open;
  document.body.classList.toggle("chat-drawer-open", want);
  const btn=$("roomChatToggle");
  const scrim=$("roomChatScrim");
  if(btn){
    btn.setAttribute("aria-expanded", want?"true":"false");
    btn.setAttribute("aria-label", want?"ปิดแชท":"เปิดแชท");
    btn.title=want?"ปิดแชท":"แชท";
  }
  if(scrim){
    scrim.classList.toggle("hidden", !want);
    scrim.setAttribute("aria-hidden", want?"false":"true");
  }
  if(want){
    setRoomChatUnread(false);
    const log=$("roomChatLog");
    if(log) log.scrollTop=log.scrollHeight;
    const input=$("roomChatInput");
    if(input&&isMobileChatDrawer()){
      try{ input.focus({preventScroll:true}); }catch(_){ try{ input.focus(); }catch(__){} }
    }
  }else{
    const panel=$("roomEmojiPanel");
    const emojiBtn=$("roomEmojiBtn");
    if(panel) panel.classList.add("hidden");
    if(emojiBtn) emojiBtn.setAttribute("aria-expanded","false");
  }
}
function paintRoomChatBar(){
  const dock=$("roomChatDock");
  const hint=$("roomChatHint");
  const panel=$("roomEmojiPanel");
  const emojiBtn=$("roomEmojiBtn");
  const toggle=$("roomChatToggle");
  const inRoom=onlineMode&&!spectating&&document.body.classList.contains("room-bg");
  const registered=canUseFriends();
  const show=inRoom&&registered;
  if(dock){
    const wasHidden=dock.classList.contains("hidden");
    dock.classList.toggle("hidden", !show);
    if(!show&&!wasHidden) clearRoomChatLog();
  }
  if(toggle) toggle.classList.toggle("hidden", !show);
  if(hint) hint.classList.toggle("hidden", !(inRoom&&!registered));
  if(!show){
    setRoomChatDrawer(false);
    setRoomChatUnread(false);
    if(panel) panel.classList.add("hidden");
    if(emojiBtn) emojiBtn.setAttribute("aria-expanded","false");
  }else{
    paintRoomChatTargets();
    if(!isMobileChatDrawer()) setRoomChatDrawer(false);
  }
}
function appendRoomChatLog(msg){
  const log=$("roomChatLog");
  if(!log) return;
  const fromName=String((msg&&msg.fromName)||"ผู้เล่น");
  const body=String((msg&&msg.body)||"").trim();
  if(!body) return;
  const priv=!!(msg&&msg.private);
  const fromMe=!!(msg&&msg.fromMe);
  const line=document.createElement("div");
  line.className="room-chat-line"+(fromMe?" is-me":"")+(priv?" is-private":"");
  const who=document.createElement("div");
  who.className="who";
  if(priv){
    who.textContent=fromMe
      ?("🔒 คุณ → "+(msg.toName||"ผู้เล่น"))
      :("🔒 "+fromName+" → คุณ");
  }else{
    who.textContent=fromMe?("คุณ"):fromName;
  }
  const text=document.createElement("div");
  text.className="body";
  text.textContent=body;
  line.append(who, text);
  log.appendChild(line);
  while(log.childElementCount>100) log.firstChild.remove();
  log.scrollTop=log.scrollHeight;
  if(!fromMe&&isMobileChatDrawer()&&!isRoomChatDrawerOpen()){
    setRoomChatUnread(true);
  }
}
function paintRoomChatTargets(){
  const sel=$("roomChatTo");
  const bar=$("roomChatBar");
  const input=$("roomChatInput");
  if(!sel) return;
  const prev=sel.value||"";
  const others=(playerMeta||[]).filter(p=>p&&p.id&&p.id!==myId&&!p.bot&&p.connected);
  const keep=others.some(p=>p.id===prev)?prev:"";
  sel.innerHTML=`<option value="">ทุกคน</option>`+others.map(p=>{
    const label=String(p.name||"ผู้เล่น").slice(0,16);
    return `<option value="${escHtml(p.id)}">${escHtml(label)}</option>`;
  }).join("");
  sel.value=keep;
  const priv=!!sel.value;
  if(bar) bar.classList.toggle("is-private", priv);
  if(input){
    input.placeholder=priv?"ข้อความส่วนตัว…":"พิมพ์แชทหรืออิโมจิ…";
  }
}
function setRoomChatTarget(userId){
  const sel=$("roomChatTo");
  if(!sel) return;
  paintRoomChatTargets();
  const id=String(userId||"");
  if(id&&Array.from(sel.options).some(o=>o.value===id)) sel.value=id;
  else sel.value="";
  paintRoomChatTargets();
  paintRoomChatBar();
  if(isMobileChatDrawer()) setRoomChatDrawer(true);
  else{
    const input=$("roomChatInput");
    if(input) input.focus();
  }
}
function showRoomChatBubble(fromId, body, meta){
  const pid=String(fromId||"");
  const text=String(body||"").trim();
  if(!pid||!text) return;
  const prev=roomChatBubbles.get(pid);
  if(prev&&prev.timer) clearTimeout(prev.timer);
  const until=Date.now()+ROOM_CHAT_MS;
  const timer=setTimeout(()=>{
    roomChatBubbles.delete(pid);
    document.querySelectorAll('[data-pid="'+CSS.escape(pid)+'"] .pchat-bubble').forEach(el=>el.remove());
  }, ROOM_CHAT_MS);
  roomChatBubbles.set(pid, {
    body:text,
    until,
    timer,
    private:!!(meta&&meta.private),
    toName:meta&&meta.toName?String(meta.toName):"",
    toId:meta&&meta.toId?String(meta.toId):"",
    fromMe:!!(meta&&meta.fromMe)
  });
  paintRoomChatBubbles();
}
function chatLooksLikeEmoji(s){
  const t=String(s||"").trim();
  if(!t) return false;
  if(/[0-9A-Za-z\u0E00-\u0E7F]/.test(t)) return false;
  return Array.from(t).length<=8;
}
function paintRoomChatBubbles(){
  const now=Date.now();
  roomChatBubbles.forEach((entry, pid)=>{
    if(entry.until<=now){
      roomChatBubbles.delete(pid);
      return;
    }
    document.querySelectorAll('[data-pid="'+CSS.escape(pid)+'"]').forEach(wrap=>{
      let bubble=wrap.querySelector(".pchat-bubble");
      if(!bubble){
        bubble=document.createElement("span");
        bubble.className="pchat-bubble";
        wrap.appendChild(bubble);
      }
      bubble.classList.toggle("is-emoji", chatLooksLikeEmoji(entry.body)&&!entry.private);
      bubble.classList.toggle("is-private", !!entry.private);
      if(entry.private){
        const tip=entry.fromMe
          ?("ถึง "+(entry.toName||"ผู้เล่น"))
          :"ส่วนตัว";
        bubble.innerHTML=`<span class="pchat-lock" title="${escHtml(tip)}">🔒</span>${escHtml(entry.body)}`;
      }else{
        bubble.textContent=entry.body;
      }
    });
  });
}
function isHost(){ return !!(myId&&myId===hostId); }
function myName(){
  const p=playerMeta.find(x=>x.id===myId);
  return p?p.name:"";
}
function playerByName(name){ return playerMeta.find(p=>p.name===name)||null; }
function isChampion(name){
  if(onlineMode){
    const meta=playerByName(name);
    return !!(meta&&meta.champion);
  }
  return lastWinners.includes(name);
}
function setLocalChampions(names){
  lastWinners=Array.isArray(names)?names.filter(Boolean):[];
}
function clearLocalChampions(){
  lastWinners=[];
  resetWinCelebration();
}
let lastWinCelebrateKey="";
function escHtml(s){
  return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function winnerAvatarHtml(name){
  const meta=playerByName(name);
  const av=meta&&meta.avatarUrl?String(meta.avatarUrl):"";
  const label=escHtml(name||"?");
  const face=av
    ? `<img class="winner-av" src="${escHtml(av)}" alt="" width="84" height="84" referrerpolicy="no-referrer">`
    : `<div class="winner-av" aria-hidden="true">${escHtml(String(name||"?").slice(0,1).toUpperCase())}</div>`;
  return `<div class="winner-av-wrap">
    <div class="winner-av-ring champion">${face}</div>
    <div class="winner-av-name">${label}</div>
  </div>`;
}
function closeWinnerModal(){
  const modal=$("winnerModal");
  if(modal) modal.classList.add("hidden");
}
function openWinnerModal(names, opts={}){
  const list=Array.isArray(names)?names.filter(Boolean):[];
  if(!list.length) return;
  const modal=$("winnerModal");
  if(!modal) return;
  const title=$("winnerModalTitle");
  const note=$("winnerModalNote");
  const box=$("winnerModalAvatars");
  const champText=list.length<=1?list[0]:list.length===2?list.join(" กับ "):list.slice(0,-1).join(", ")+" และ "+list[list.length-1];
  if(title) title.textContent=champText+" ชนะแล้ว!";
  if(note){
    const target=opts.winTarget!=null?opts.winTarget:winTarget;
    note.textContent=opts.note||("ถึง "+target+" แต้ม");
  }
  if(box) box.innerHTML=list.map(winnerAvatarHtml).join("");
  modal.classList.remove("hidden");
}
function celebrateMatchWin(names, opts={}){
  const list=Array.isArray(names)?names.filter(Boolean):[];
  if(!list.length) return;
  // Include match note/session so rematches with the same winner still pop
  const key=[
    roomCode||"local",
    opts.winTarget!=null?opts.winTarget:winTarget,
    opts.note||"",
    opts.matchKey||"",
    list.slice().sort().join("|")
  ].join("::");
  if(key===lastWinCelebrateKey) return;
  lastWinCelebrateKey=key;
  openWinnerModal(list, opts);
  playClip(WIN_SOUND);
}
function resetWinCelebration(){
  lastWinCelebrateKey="";
  closeWinnerModal();
}
function paintOverScreen(s){
  if(!s||!s.over) return;
  $("overTitle").textContent=s.over.title||"";
  let note=s.over.note||"";
  if(s.over.mode==="imposter"&&Array.isArray(s.over.imposters)&&s.over.imposters.length){
    note=(note?note+" · ":"")+"Imposter: "+s.over.imposters.join(", ");
  }
  if(s.over.mode==="werewolf"&&Array.isArray(s.over.werewolves)&&s.over.werewolves.length){
    note=(note?note+" · ":"")+"หมาป่า: "+s.over.werewolves.join(", ");
  }
  $("overNote").textContent=note;
  setOverOutOrder(s.over.outOrder||[]);
  const memoryRank=s.over.mode==="cardmemory"&&Array.isArray(s.over.ranking)?s.over.ranking:[];
  const secretLabel=$("secretLabel");
  if(secretLabel){
    secretLabel.textContent=memoryRank.length?"":(s.over.secretLabel||"");
    secretLabel.classList.toggle("hidden",!!memoryRank.length||!secretLabel.textContent);
  }
  const shown=$("secret");
  if(shown){
    shown.textContent=memoryRank.length?"":(s.over.secretText||"");
    shown.classList.toggle("many",!!s.over.many);
    shown.classList.toggle("hidden",!!memoryRank.length||!shown.textContent);
  }
  const rankEl=$("overRank");
  const rankLabel=$("overRankLabel");
  const pointsLabel=$("overPointsLabel");
  if(rankLabel) rankLabel.classList.toggle("hidden",!memoryRank.length);
  if(pointsLabel) pointsLabel.classList.toggle("hidden",!memoryRank.length);
  if(rankEl){
    rankEl.classList.toggle("hidden",!memoryRank.length);
    rankEl.innerHTML=memoryRank.map((row,i)=>{
      const name=escHtml(row&&row.name||"ผู้เล่น");
      const score=Number(row&&row.score)||0;
      const pairs=Number(row&&row.pairs)||0;
      const combo=Number(row&&row.maxCombo)||0;
      const detail=score+" คะแนน · คู่ "+pairs+(combo?" · คอมโบ "+combo:"");
      return `<li class="${i===0?"is-first":""}"><span>${i+1}. ${name}</span><b>${escHtml(detail)}</b></li>`;
    }).join("");
  }
  const guessEl=$("overGuess");
  if(guessEl){
    const typed=s.over.mode==="imposter"?String(s.over.guessText||"").trim():"";
    const who=s.over.guessName?s.over.guessName:"Imposter";
    guessEl.textContent=typed?who+" พิมพ์ตอบ: "+typed:"";
    guessEl.classList.toggle("hidden",!typed);
  }
  renderOverHist(s.over.hist);
  $("again").textContent=s.over.again||"เล่นอีกครั้ง";
  $("again").dataset.reset=s.over.reset?"1":"";
  $("again").disabled=!isHost();
  $("back").textContent=s.over.reset?"กลับล็อบบี้ · รีแต้ม":"กลับล็อบบี้";
  $("back").disabled=!isHost();
  renderScores($("finalScores"));
  show("over");
  renderPlayers();
}
function winnersFromOver(s){
  if(!s||!s.over) return [];
  if(Array.isArray(s.over.winners)&&s.over.winners.length) return s.over.winners.filter(Boolean);
  return playerMeta.filter(p=>p&&p.champion).map(p=>p.name).filter(Boolean);
}
function shouldCelebrateOver(s){
  if(!s||!s.over) return false;
  if(s.over.mode==="snake"||s.cat==="snake") return true;
  if(s.over.mode==="imposter"||s.cat==="imposter") return true;
  return !!s.over.reset;
}
function overCelebrateNote(s){
  const base=(s&&s.over&&s.over.note)||"";
  const typed=s&&s.over&&s.over.mode==="imposter"?String(s.over.guessText||"").trim():"";
  if(!typed) return base;
  const extra="พิมพ์ตอบ: "+typed;
  return base?base+" · "+extra:extra;
}
function celebrateOverSnap(s){
  if(!shouldCelebrateOver(s)){
    closeWinnerModal();
    return;
  }
  const winners=winnersFromOver(s);
  if(!winners.length){
    // Snake title fallback if winners array missing on older snaps
    const titled=String((s.over&&s.over.title)||"").replace(/\s*ชนะ!?\s*$/,"").trim();
    if(titled) celebrateMatchWin([titled],{
      winTarget:s.over.winTarget!=null?s.over.winTarget:winTarget,
      note:overCelebrateNote(s),
      matchKey:String((s.snake&&s.snake.sessionId)||s.over.at||"")
    });
    return;
  }
  celebrateMatchWin(winners,{
    winTarget:s.over.winTarget!=null?s.over.winTarget:winTarget,
    note:overCelebrateNote(s),
    matchKey:String((s.snake&&s.snake.sessionId)||s.over.at||"")
  });
}
function screenOpen(id){
  const el=$(id);
  return !!el&&!el.classList.contains("hidden");
}
function roundLive(){
  return screenOpen("play")||screenOpen("pick")||screenOpen("wheelGame");
}
function motionOff(){
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function scoreKey(){
  return gameCat==="wheel"?STORE_WHEEL:STORE_SCORES;
}
const FONT='system-ui,-apple-system,"Segoe UI","Noto Sans Thai",Tahoma,sans-serif';

function parseIntStrict(v){
  v=String(v??"").trim();
  if(!/^-?\d+$/.test(v)) return null;
  const n=Number(v);
  return Number.isSafeInteger(n)?n:null;
}
function choice(){
  if(useCustom) return {min:parseIntStrict($("cmin").value), max:parseIntStrict($("cmax").value)};
  return {min:pickMin, max:pickMax};
}
function check(min,max){
  if(min==null||max==null) return "กรอกจำนวนเต็มเท่านั้น";
  if(min>=max) return "เลขต่ำสุดต้องน้อยกว่าเลขสูงสุด";
  if(max-min+1>SPAN_MAX) return "ช่วงตัวเลขต้องไม่เกิน 10,000 จำนวน";
  return "";
}
function readSecretCount(){
  return parseIntStrict($("secretCount").value);
}
function checkCount(min,max,count){
  if(count==null||count<1) return "จำนวนเลขลับต้องเป็นจำนวนเต็มตั้งแต่ 1";
  if(count>max-min+1) return "จำนวนเลขลับต้องไม่เกินจำนวนตัวเลขในช่วง";
  return "";
}
function readWinTarget(){
  return parseIntStrict($("winScore").value);
}
function checkWin(target){
  if(target==null||target<1) return "แต้มที่ชนะต้องเป็นจำนวนเต็มตั้งแต่ 1";
  if(target>999) return "แต้มที่ชนะต้องไม่เกิน 999";
  return "";
}
function drawSecrets(min,max,count){
  const span=max-min+1;
  if(count>=span){
    const all=[];
    for(let n=min;n<=max;n++) all.push(n);
    return all;
  }
  const pick=count>span/2?span-count:count;
  const bag=new Set();
  while(bag.size<pick) bag.add(Math.floor(Math.random()*span)+min);
  if(count<=span/2) return [...bag].sort((a,b)=>a-b);
  const secrets=[];
  for(let n=min;n<=max;n++) if(!bag.has(n)) secrets.push(n);
  return secrets;
}
function refreshLabel(){
  const c=choice();
  $("rangeLabel").textContent=(c.min==null||c.max==null)?"—":c.min+"–"+c.max;
  $("err").textContent="";
}
function orderReady(){
  if(players.length<2) return true;
  if(order.length!==players.length) return false;
  const seen=Object.create(null);
  for(const name of order){
    if(!players.includes(name)||seen[name]) return false;
    seen[name]=1;
  }
  return true;
}
function currentPlayer(){
  return alive.length?alive[((turn%alive.length)+alive.length)%alive.length]:"";
}
function begin(min,max,count){
  if(!orderReady()){
    show("start");
    $("err").textContent="กดสุ่มลำดับก่อนเริ่มเกม";
    return;
  }
  if(players.length===1) order=players.slice();
  const target=readWinTarget();
  const winErr=checkWin(target);
  if(winErr){
    show("start");
    $("err").textContent=winErr;
    return;
  }
  clearLocalChampions();
  winTarget=target;
  pointAll=!!$("restModes").querySelector("[data-rest='all'].on");
  if(count==null) count=secretTotal;
  gameMin=min; gameMax=max; secretTotal=count;
  secretAll=drawSecrets(min,max,count);
  secrets=secretAll.slice();
  alive=order.slice();
  roundOrder=order.slice();
  lo=min; hi=max; picked=[]; pageFrom=min;
  turn=0;
  $("modeLabel").textContent="ช่วง "+min+"–"+max+" · เลขลับ "+count+" ตัว · ถึง "+winTarget+" แต้มชนะ · "+(pointAll?"เหลือหลายคนได้แต้ม ยกเว้นคนที่โดน":"เหลือหลายคนได้แต้มคนสุดท้าย");
  $("msg").textContent="";
  $("again").textContent="เล่นอีกครั้ง";
  $("again").dataset.reset="";
  $("back").textContent="เลือกโหมดใหม่";
  show("play");
  render();
}
function renderRange(){
  const box=$("rangeText");
  box.textContent="";
  const loEl=document.createElement("b");
  const hiEl=document.createElement("b");
  loEl.textContent=lo;
  hiEl.textContent=hi;
  if(secrets.length<=1){
    box.append("ตอนนี้เลขลับอยู่ระหว่าง ",loEl," – ",hiEl);
    return;
  }
  const countEl=document.createElement("b");
  countEl.textContent=secrets.length;
  box.append("เลขลับ ",countEl," ตัว อยู่ในช่วง ",loEl," – ",hiEl);
}
function render(){
  renderRange();
  const paged=gameMax-gameMin+1>PAGE;
  $("pager").classList.toggle("hidden",!paged);
  $("jump").classList.toggle("hidden",!paged);
  if(onlineMode&&$("guess")){
    $("guess").disabled=!myTurn;
    const go=$("jump").querySelector("button");
    if(go) go.disabled=!myTurn;
  }
  let from=gameMin, to=gameMax;
  if(paged){
    const end=Math.min(gameMax,pageFrom+PAGE-1);
    if(end<lo||pageFrom>hi) pageFrom=gameMin+Math.floor((lo-gameMin)/PAGE)*PAGE;
    from=pageFrom;
    to=Math.min(gameMax,pageFrom+PAGE-1);
    $("pageLabel").textContent="เลข "+from+"–"+to;
    const prevStart=pageFrom-PAGE, nextStart=pageFrom+PAGE;
    $("prev").disabled=prevStart<gameMin||prevStart+PAGE-1<lo;
    $("next").disabled=nextStart>gameMax||nextStart>hi;
  }
  const g=$("grid");
  const sample=Math.max(Math.abs(from),Math.abs(to));
  const digits=String(sample).length+(from<0||to<0?1:0);
  g.className="grid"+(digits>=4?" d4":digits===3?" d3":"");
  g.innerHTML="";
  for(let n=from;n<=to;n++){
    const b=document.createElement("button");
    b.type="button";
    b.textContent=n;
    const used=picked.some(p=>p.n===n);
    const bomb=used&&(picked.some(p=>p.n===n&&p.hit)||secretAll.includes(n));
    if(bomb) b.classList.add("bomb");
    else if(used) b.classList.add("used");
    const wait=onlineMode&&!myTurn;
    b.disabled=used||n<lo||n>hi||wait;
    if(wait&&!used&&n>=lo&&n<=hi) b.classList.add("wait");
    b.onclick=()=>chooseNumber(n);
    g.appendChild(b);
  }
  const h=$("hist");
  h.textContent="";
  if(!picked.length) h.textContent="ยังไม่มี";
  else picked.forEach(p=>{
    const s=document.createElement("span");
    s.textContent=p.who?p.who+" "+p.n:String(p.n);
    if(secretAll.includes(p.n)) s.classList.add("hit");
    h.appendChild(s);
  });
  renderTurn();
  renderPlayers();
}
function paintTurnClock(){
  const show=turnEndsAt>0&&(netPhase==="play"||netPhase==="pick");
  const left=show?Math.max(0, turnEndsAt-Date.now()):0;
  const on=show&&left>0;
  const secLeft=on?Math.ceil(left/1000):0;
  const text=on?"เหลือ "+secLeft+" วิ":"";
  const urgent=on&&left<=5000;
  if(on&&secLeft>0&&secLeft!==lastCooldownSec){
    lastCooldownSec=secLeft;
    playClip(COOLDOWN_SOUND);
  }else if(!on){
    lastCooldownSec=-1;
  }
  const turnEl=$("turnClock");
  if(turnEl){
    const showTurn=on&&netPhase==="play";
    turnEl.classList.toggle("hidden",!showTurn);
    turnEl.classList.toggle("urgent",showTurn&&urgent);
    turnEl.textContent=showTurn?text:"";
  }
  const pickEl=$("pickClock");
  if(pickEl){
    const showPick=on&&netPhase==="pick";
    pickEl.classList.toggle("hidden",!showPick);
    pickEl.classList.toggle("urgent",showPick&&urgent);
    pickEl.textContent=showPick?text:"";
  }
}
function syncTurnClock(s){
  turnSec=Number.isInteger(s.turnSec)?s.turnSec:Math.max(0, parseInt(s.turnSec,10)||0);
  const left=Math.max(0, Number(s.turnLeft)||0);
  const nextEnds=left>0?Date.now()+left:0;
  if(Math.abs(nextEnds-turnEndsAt)>400) lastCooldownSec=-1;
  turnEndsAt=nextEnds;
  paintTurnClock();
}
function renderTurn(){
  const name=currentPlayer();
  const playing=!$("play").classList.contains("hidden");
  $("turnbar").classList.toggle("hidden",!name||!playing);
  $("turnbar").classList.toggle("you",!!(name&&name===myName()));
  $("turnName").textContent=name&&name===myName()?name+" (คุณ)":name;
  const slot=alive.length?((turn%alive.length)+alive.length)%alive.length:-1;
  const rank=slot<0?0:roundOrder.indexOf(alive[slot])+1;
  $("turnRank").textContent=name?"อันดับ "+rank+" · เหลือ "+alive.length+" คน":"";
  paintTurnClock();
}
let overOutOrder=[];
function deathLabel(rank){
  if(rank===1) return "ตายคนแรก";
  return "ตายคนที่ "+rank;
}
function outOrderFrom(items, needHit){
  const order=[];
  (items||[]).forEach(item=>{
    if(!item||!item.who) return;
    if(needHit&&!item.hit) return;
    if(!order.includes(item.who)) order.push(item.who);
  });
  return order;
}
function setOverOutOrder(list){
  overOutOrder=Array.isArray(list)?list.filter(Boolean):[];
}
function renderScores(el){
  el.textContent="";
  if(!players.length){ el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  const ranked=players.slice().sort((a,b)=>(scores[b]||0)-(scores[a]||0));
  const best=scores[ranked[0]]||0;
  const outRank=new Map(overOutOrder.map((name,i)=>[name,i+1]));
  ranked.forEach((name,i)=>{
    const li=document.createElement("li");
    if((scores[name]||0)===best&&best>0) li.classList.add("top");
    if(isChampion(name)) li.classList.add("champion");
    const label=document.createElement("span");
    label.textContent=(i+1)+". "+name+(isChampion(name)?" ✦":"");
    const out=document.createElement("span");
    out.className="out";
    const rank=outRank.get(name);
    out.textContent=rank?deathLabel(rank):"";
    const pts=document.createElement("b");
    pts.textContent=(scores[name]||0)+" แต้ม";
    li.append(label,out,pts);
    el.appendChild(li);
  });
}
function pick(raw){
  const n=typeof raw==="number"?raw:parseIntStrict(raw);
  if(n==null){ $("msg").textContent="ใส่เป็นจำนวนเต็ม"; return; }
  if(n<lo||n>hi){ $("msg").textContent="เลือกเลขระหว่าง "+lo+" ถึง "+hi; return; }
  if(picked.some(p=>p.n===n)){ $("msg").textContent="เลขนี้ถูกเลือกแล้ว"; return; }
  const who=currentPlayer();
  const hit=secrets.includes(n);
  picked.push({n,who,hit});
  if(hit){
    playClip(BOMB_SOUND);
    secrets=secrets.filter(s=>s!==n);
    if(who){
      const idx=alive.indexOf(who);
      if(idx>=0) alive.splice(idx,1);
      turn=alive.length?idx%alive.length:0;
    }
    if(!who||alive.length<=1||!secrets.length){
      finishRound();
      return;
    }
    $("msg").textContent=who+" โดนเลขลับ หลุดจากเทิร์น";
  }else{
    $("msg").textContent="";
    if(alive.length) turn=(turn+1)%alive.length;
  }
  const below=secrets.some(s=>s<n);
  const above=secrets.some(s=>s>n);
  if(!below) lo=n+1;
  if(!above) hi=n-1;
  if($("guess")) $("guess").value="";
  render();
}
function finishRound(){
  const left=roundOrder.filter(name=>alive.includes(name));
  const gained=!left.length?[]:pointAll?left:[left[left.length-1]];
  gained.forEach(name=>{ scores[name]=(scores[name]||0)+1; });
  saveScores();
  const champs=gained.filter(name=>(scores[name]||0)>=winTarget);
  const won=champs.length>0;
  if(won) setLocalChampions(champs);
  const champText=champs.length<=1?champs[0]||"":champs.length===2?champs.join(" กับ "):champs.slice(0,-1).join(", ")+" และ "+champs[champs.length-1];
  if(!roundOrder.length){
    $("overTitle").textContent="คุณเลือกโดนเลขลับ!";
    $("overNote").textContent="";
  }else if(won){
    $("overTitle").textContent=champText+" ชนะแล้ว!";
    $("overNote").textContent="ถึง "+winTarget+" แต้ม";
    celebrateMatchWin(champs,{winTarget,note:"ถึง "+winTarget+" แต้ม"});
  }else if(alive.length===1){
    $("overTitle").textContent=alive[0]+" เป็นคนสุดท้าย";
    $("overNote").textContent="ได้ 1 แต้ม";
  }else if(!alive.length&&roundOrder.length>1){
    $("overTitle").textContent="ทุกคนโดนเลขลับ";
    $("overNote").textContent="";
  }else if(!alive.length){
    $("overTitle").textContent=(roundOrder[0]||"คุณ")+" เลือกโดนเลขลับ!";
    $("overNote").textContent="";
  }else if(pointAll){
    $("overTitle").textContent="เลขลับหมดแล้ว";
    $("overNote").textContent="ทุกคนได้คนละ 1 แต้ม ยกเว้นคนที่โดนเลขลับ";
  }else{
    $("overTitle").textContent=gained[0]+" เป็นคนสุดท้าย";
    $("overNote").textContent="ได้ 1 แต้ม";
  }
  $("again").textContent=won?"เริ่มแมตช์ใหม่":"เล่นอีกครั้ง";
  $("again").dataset.reset=won?"1":"";
  $("again").dataset.mode="";
  $("back").textContent=won?"กลับเมนู · รีแต้ม":"เลือกโหมดใหม่";
  $("secretLabel").textContent="เลขลับคือ";
  setOverOutOrder(outOrderFrom(picked,true));
  renderOverHist(null);
  const shown=$("secret");
  shown.textContent=secretAll.join(", ");
  shown.classList.toggle("many",secretAll.length>3);
  renderScores($("finalScores"));
  show("over");
  renderPlayers();
}
function loadPlayers(){
  if(onlineMode) return;
  try{
    const raw=JSON.parse(localStorage.getItem(STORE));
    if(Array.isArray(raw)) players=raw.filter(n=>typeof n==="string"&&n.trim()).map(n=>n.trim()).slice(0,PLAYER_MAX);
  }catch(e){ players=[]; }
}
function savePlayers(){
  if(onlineMode) return;
  try{ localStorage.setItem(STORE, JSON.stringify(players)); }catch(e){}
}
function loadScores(){
  if(onlineMode) return;
  scores={};
  try{
    const raw=JSON.parse(localStorage.getItem(scoreKey()));
    if(raw&&typeof raw==="object"){
      for(const name of players){
        const n=Number(raw[name]);
        scores[name]=Number.isFinite(n)&&n>0?Math.floor(n):0;
      }
    }
  }catch(e){}
  players.forEach(name=>{ if(scores[name]==null) scores[name]=0; });
}
function saveScores(){
  if(onlineMode) return;
  try{ localStorage.setItem(scoreKey(), JSON.stringify(scores)); }catch(e){}
}
function forgetScore(name){
  [STORE_SCORES,STORE_WHEEL].forEach(key=>{
    if(key===scoreKey()) return;
    try{
      const raw=JSON.parse(localStorage.getItem(key));
      if(!raw||typeof raw!=="object") return;
      delete raw[name];
      localStorage.setItem(key, JSON.stringify(raw));
    }catch(e){}
  });
}
function wheelMessage(){
  if(!players.length) return onlineMode?"รอผู้เล่นเข้าห้อง":"เพิ่มชื่อแล้วกดสุ่มลำดับ";
  if(players.length<2) return onlineMode?"รอผู้เล่นอีกอย่างน้อย 1 คน":"เพิ่มผู้เล่นอีกอย่างน้อย 1 คน";
  if(order.length===players.length&&order[0]) return "เริ่มที่ "+order[0];
  return onlineMode&&!isHost()?"รอโฮสต์สุ่มลำดับ":"กดสุ่มลำดับ";
}
function cssColor(name, fallback){
  const v=getComputedStyle(document.body).getPropertyValue(name).trim();
  return v||fallback;
}
function fitLabel(ctx, name, maxW){
  let label=name;
  if(ctx.measureText(label).width<=maxW) return label;
  while(label.length>1&&ctx.measureText(label+"…").width>maxW) label=label.slice(0,-1);
  return label+"…";
}
function drawWheel(){
  const canvas=$("wheel");
  const size=280;
  const dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=size*dpr;
  canvas.height=size*dpr;
  const ctx=canvas.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const cx=size/2, cy=size/2, r=size/2-8;
  ctx.clearRect(0,0,size,size);
  const list=players;
  const n=list.length;
  if(!n){
    ctx.beginPath();
    ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.fillStyle=cssColor("--chip","#f3f6fc");
    ctx.fill();
    ctx.lineWidth=8;
    ctx.strokeStyle=cssColor("--line","#d9e1f0");
    ctx.stroke();
    ctx.fillStyle=cssColor("--muted","#64708a");
    ctx.font="700 16px "+FONT;
    ctx.textAlign="center";
    ctx.textBaseline="middle";
    ctx.fillText("เพิ่มชื่อผู้เล่น",cx,cy);
    return;
  }
  const slice=(Math.PI*2)/n;
  const start=-Math.PI/2;
  const fontSize=n>16?12:n>10?13:n>6?15:17;
  for(let i=0;i<n;i++){
    const a0=start+i*slice;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,r,a0,a0+slice);
    ctx.closePath();
    ctx.fillStyle=WHEEL_COLORS[i%WHEEL_COLORS.length];
    ctx.fill();
  }
  ctx.font="700 "+fontSize+"px "+FONT;
  ctx.fillStyle="#fff";
  ctx.textAlign="center";
  ctx.textBaseline="middle";
  const maxW=Math.max(36, Math.min(r*0.9, 2*Math.sin(slice/2)*r*0.7));
  for(let i=0;i<n;i++){
    const mid=start+(i+0.5)*slice;
    ctx.save();
    ctx.translate(cx,cy);
    ctx.rotate(mid+Math.PI/2);
    ctx.fillText(fitLabel(ctx,list[i],maxW), 0, -r*0.66);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(cx,cy,r,0,Math.PI*2);
  ctx.lineWidth=8;
  ctx.strokeStyle="rgba(255,255,255,.9)";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx,cy,22,0,Math.PI*2);
  ctx.fillStyle="#fff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx,cy,8,0,Math.PI*2);
  ctx.fillStyle="#2563eb";
  ctx.fill();
}
const LOBBY_AV_COLORS=["#3b82f6","#8b5cf6","#f59e0b","#10b981","#ec4899","#06b6d4","#f97316","#6366f1"];
function renderLobbyGrid(){
  const grid=$("lobbyGrid");
  if(!grid) return;
  grid.textContent="";
  // Use room cap from server (snake=6, others=12) — do not hardcode 12
  const maxSlots=Math.max(2, Math.min(30, Number(roomMaxPlayers)||12));
  const ranked=order.length===players.length&&players.length>0;
  const list=ranked?order:players;
  for(let i=0;i<maxSlots;i++){
    const name=list[i];
    const slot=document.createElement("div");
    if(!name){
      const canInvite=onlineMode&&canUseFriends()&&netPhase==="lobby"&&!spectating;
      slot.className="lobby-slot empty"+(canInvite?" inviteable":"");
      slot.innerHTML=`<div class="lobby-empty-circle" aria-hidden="true"><span class="lobby-empty-plus">+</span></div><div class="lobby-slot-name">${canInvite?"เชิญเพื่อน":"รอผู้เล่น…"}</div>`;
      if(canInvite){
        slot.setAttribute("role","button");
        slot.tabIndex=0;
        slot.title="เชิญเพื่อนเข้าห้อง";
        slot.onclick=(e)=>{ e.preventDefault(); e.stopPropagation(); openInviteModal(); };
        slot.onkeydown=(e)=>{
          if(e.key==="Enter"||e.key===" "){ e.preventDefault(); openInviteModal(); }
        };
      }
      grid.appendChild(slot);
      continue;
    }
    const meta=onlineMode?playerByName(name):null;
    const hostFlag=!!(meta&&meta.host);
    const connected=!meta||meta.connected||meta.bot;
    const ready=ranked||(meta&&meta.connected);
    const champ=isChampion(name);
    const frameClass=meta&&meta.frameClass?String(meta.frameClass):"";
    const frameImage=meta&&meta.frameImage?String(meta.frameImage):"";
    // กรอบ = สไตล์การ์ดโปรไฟล์ · เอฟเฟกต์ = วงกลมรอบรูป
    slot.className="lobby-slot"
      +(hostFlag?" host":"")
      +(connected?"":" offline")
      +(champ?" champion":"")
      +(frameClass?" "+frameClass:"")
      +(frameImage?" has-media":"");
    if(frameImage){
      const frameMedia=document.createElement("img");
      frameMedia.className="cosmetic-frame-media";
      frameMedia.src=frameImage;
      frameMedia.alt="";
      frameMedia.decoding="async";
      slot.appendChild(frameMedia);
    }
    const av=document.createElement(meta&&meta.avatarUrl?"img":"div");
    av.className="lobby-av"+(meta&&meta.avatarUrl?"":" ph");
    if(meta&&meta.avatarUrl){
      av.src=meta.avatarUrl;
      av.alt="";
      av.referrerPolicy="no-referrer";
    }else{
      av.textContent=(name||"?").slice(0,1).toUpperCase();
      av.style.background=LOBBY_AV_COLORS[i%LOBBY_AV_COLORS.length];
    }
    const crown=hostFlag?`<span class="lobby-crown" title="โฮสต์">♛</span>`:"";
    const status=document.createElement("div");
    status.className="lobby-slot-status"+(ready?" on":"");
    const statusBits=[];
    if(hostFlag) statusBits.push("HOST");
    if(meta&&meta.angelGuard) statusBits.push("ANGEL");
    if(!statusBits.length) statusBits.push(meta&&meta.bot?"BOT":(connected?"ONLINE":"OFFLINE"));
    status.textContent=statusBits.join(" · ");
    if(meta&&meta.angelGuard) slot.classList.add("has-angel");
    const nm=document.createElement("div");
    nm.className="lobby-slot-name";
    nm.textContent=name;
    if(meta&&meta.id===myId) nm.title="คุณ";
    const acts=document.createElement("div");
    acts.className="lobby-slot-acts";
    const canHostAct=onlineMode&&isHost()&&meta&&meta.id!==myId&&netPhase==="lobby"&&!spinning;
    if(canHostAct&&meta.connected&&!meta.bot){
      const give=document.createElement("button");
      give.type="button";
      give.className="btn sm";
      give.textContent="โอนโฮสต์";
      give.title="โอนโฮสต์ให้ "+name+(champ?" (ผู้ชนะ)":"");
      give.onclick=(e)=>{
        e.preventDefault();
        e.stopPropagation();
        send({t:"giveHost",id:meta.id});
      };
      acts.appendChild(give);
    }
    if(canHostAct){
      const kick=document.createElement("button");
      kick.type="button";
      kick.className="btn ghost sm";
      kick.textContent="เตะ";
      kick.onclick=(e)=>{
        e.preventDefault();
        e.stopPropagation();
        send({t:"kick",id:meta.id});
      };
      acts.appendChild(kick);
    }
    const avWrap=document.createElement("div");
    // Winner มาก่อน — ไม่ใส่เอฟเฟกต์ cosmetic ทับกรอบ winner
    const effectClass=!champ&&meta&&meta.effectClass?String(meta.effectClass):"";
    const effectImage=!champ&&meta&&meta.effectImage?String(meta.effectImage):"";
    avWrap.className="lobby-av-wrap"+(champ?" champion":"");
    if(meta&&meta.id) avWrap.dataset.pid=meta.id;
    avWrap.innerHTML=crown;
    if(champ){
      const mark=document.createElement("span");
      mark.className="lobby-champ-mark";
      mark.title="ผู้ชนะ";
      mark.textContent="WINNER";
      avWrap.appendChild(mark);
    }
    const avCore=document.createElement("div");
    avCore.className="lobby-av-core"+(effectClass?" "+effectClass:"")+(effectImage?" has-media":"");
    if(effectImage){
      const effectMedia=document.createElement("img");
      effectMedia.className="cosmetic-effect-media";
      effectMedia.src=effectImage;
      effectMedia.alt="";
      effectMedia.decoding="async";
      avCore.appendChild(effectMedia);
    }
    avCore.appendChild(av);
    avWrap.appendChild(avCore);
    const pts=Math.max(0, Number(meta&&meta.score!=null?meta.score:scores[name])||0);
    if(pts>0){
      const badge=document.createElement("span");
      badge.className="lobby-score-badge";
      badge.textContent=String(pts);
      badge.title=pts+" แต้ม";
      avWrap.appendChild(badge);
    }
    if(connected){
      const dot=document.createElement("span");
      dot.className="lobby-online-dot";
      avWrap.appendChild(dot);
    }
    if(canOpenPlayerProfile(meta)){
      slot.classList.add("profile-openable");
      const openCard=(e)=>{
        if(e){ e.preventDefault(); e.stopPropagation(); }
        if(!canOpenPlayerProfile(meta)) return;
        openPlayerProfileModal(meta.id);
      };
      avWrap.addEventListener("click", openCard);
      nm.addEventListener("click", openCard);
      avWrap.title="ดูโปรไฟล์";
    }
    slot.append(avWrap,nm,status,acts);
    grid.appendChild(slot);
  }
}
function renderPlayers(){
  const box=$("board");
  if(box) box.textContent="";
  const playing=screenOpen("play");
  const picking=screenOpen("pick");
  const wheeling=screenOpen("wheelGame");
  const locked=playing||picking||wheeling;
  const ranked=order.length===players.length&&players.length>0;
  const source=(playing&&roundOrder.length)?roundOrder:((picking||wheeling)&&wheelOrder.length)?wheelOrder:(ranked?order:players);
  const pickTotal=wheelOrder.length*Math.max(pickEach,1);
  const cur=playing?currentPlayer():picking&&pickCursor<pickTotal?wheelOrder[Math.floor(pickCursor/Math.max(pickEach,1))]:"";
  if(netPhase==="lobby"||screenOpen("start")) renderLobbyGrid();
  if(box) source.forEach((name,i)=>{
    const out=(playing&&roundOrder.length>0&&!alive.includes(name))||(wheeling&&wheelAlive.length>0&&!wheelAlive.includes(name));
    const row=document.createElement("li");
    row.className="prow"+(name===cur&&!out?" on":"")+(out?" out":"");
    const rank=document.createElement("span");
    rank.className="prank";
    const showRank=(playing&&roundOrder.length>0)||((picking||wheeling)&&wheelOrder.length>0)||ranked;
    rank.textContent=showRank?String(i+1):"•";
    const meta=onlineMode?playerByName(name):null;
    const champ=isChampion(name);
    const isAutoUser=!!(meta&&meta.auto&&!meta.bot);
    if(champ) row.classList.add("champion");
    if(isAutoUser) row.classList.add("is-auto");
    const face=document.createElement(meta&&meta.avatarUrl?"img":"span");
    if(meta&&meta.avatarUrl){
      face.className="pavatar"+(champ?" champion":"");
      face.src=meta.avatarUrl;
      face.alt="";
      face.width=28;
      face.height=28;
      face.referrerPolicy="no-referrer";
    }else{
      face.className="pavatar ph"+(champ?" champion":"");
      face.textContent=(name||"?").slice(0,1).toUpperCase();
    }
    const avWrap=document.createElement("span");
    avWrap.className="pavatar-wrap"+(isAutoUser?" is-auto":"")+(champ?" champion":"");
    if(meta&&meta.id) avWrap.dataset.pid=meta.id;
    avWrap.appendChild(face);
    if(playerHasPause(meta)){
      row.classList.add("is-paused");
      const pauseTag=document.createElement("span");
      pauseTag.className="ppause-tag";
      pauseTag.textContent="Pause";
      pauseTag.title="ข้ามเทิร์น";
      avWrap.appendChild(pauseTag);
    }else if(isAutoUser){
      const autoTag=document.createElement("span");
      autoTag.className="pavatar-auto-tag";
      autoTag.textContent="AUTO";
      autoTag.title="เล่นอัตโนมัติ";
      avWrap.appendChild(autoTag);
    }
    const nm=document.createElement("span");
    nm.className="pname";
    nm.textContent=name;
    if(meta){
      const tags=[];
      if(meta.id===myId) tags.push("คุณ");
      if(meta.host) tags.push("โฮสต์");
      if(champ) tags.push("ผู้ชนะ");
      if(meta.bot) tags.push("บอท");
      else if(meta.auto) tags.push("ออโต้");
      if(!meta.connected&&!meta.bot) tags.push("หลุด");
      // Name only in the row — roles stay in tooltip / avatar cues
      if(tags.length) nm.title=tags.join(" · ");
      if(meta.host){
        const crown=document.createElement("span");
        crown.className="prow-crown";
        crown.title="โฮสต์";
        crown.textContent="♛";
        avWrap.appendChild(crown);
      }
      if(!meta.connected&&!meta.bot) row.classList.add("off");
    }else if(champ){
      nm.title="ผู้ชนะ";
    }
    const sc=document.createElement("span");
    sc.className="pscore";
    const list=(picking||wheeling)&&Array.isArray(picks[name])?picks[name]:[];
    if(out) sc.textContent=wheeling&&list.length?"ออก · "+list.join(", "):"ออก";
    else if(list.length) sc.textContent=list.join(", ")+" · "+(scores[name]||0)+" แต้ม";
    else sc.textContent=(scores[name]||0)+" แต้ม";
    const acts=document.createElement("span");
    acts.className="pacts";
    const canHostAct=onlineMode&&isHost()&&meta&&meta.id!==myId&&netPhase==="lobby"&&!spinning;
    if(onlineMode&&canHostAct&&meta.connected&&!meta.bot){
      const give=document.createElement("button");
      give.type="button";
      give.className="givehost";
      give.textContent="โอน";
      give.setAttribute("aria-label","โอนโฮสต์ให้ "+name);
      give.title="โอนโฮสต์ให้ "+name;
      give.onclick=()=>send({t:"giveHost",id:meta.id});
      acts.appendChild(give);
    }
    const rm=document.createElement("button");
    rm.type="button";
    rm.textContent="×";
    rm.disabled=onlineMode?(!canHostAct):(spinning||wheelSpinning||locked);
    if(onlineMode&&!canHostAct) rm.classList.add("hidden");
    rm.setAttribute("aria-label","เอา "+name+" ออก");
    rm.onclick=()=>{
      if(onlineMode){
        if(canHostAct) send({t:"kick",id:meta.id});
        return;
      }
      removePlayer(players.indexOf(name));
    };
    acts.appendChild(rm);
    row.append(rank,avWrap,nm,sc,acts);
    box.appendChild(row);
  });
  const spinBtn=$("spin");
  if(spinBtn){
    spinBtn.textContent="สุ่มลำดับ (วงล้อ)";
    spinBtn.disabled=spinning||wheelSpinning||players.length<2||locked||(onlineMode&&!isHost())||netPhase!=="lobby";
  }
  const clearBtn=$("clearScores");
  if(clearBtn) clearBtn.disabled=spinning||wheelSpinning||picking||wheeling||players.length===0||(onlineMode&&!isHost());
  const addBot=$("addBot");
  if(addBot){
    const canBot=onlineMode&&isHost()&&netPhase==="lobby"&&!spinning&&players.length<12;
    addBot.classList.toggle("hidden",!onlineMode);
    addBot.disabled=!canBot;
  }
  const startBtn=$("lobbyStartBtn");
  if(startBtn){
    const canStart=isHost()&&netPhase==="lobby"&&!spinning&&players.length>=2&&orderReady();
    startBtn.disabled=!canStart;
    startBtn.textContent=isHost()?(orderReady()?"เริ่มเกม":"สุ่มลำดับก่อนเริ่ม"):"รอโฮสต์เริ่มเกม";
  }
  const gear=$("settingsGearBtn");
  if(gear) gear.classList.toggle("hidden",!(isHost()&&netPhase==="lobby"));
  const hostLobby=isHost()&&netPhase==="lobby"&&!spinning;
  const deleteBtn=$("deleteRoomBtn");
  if(deleteBtn){
    deleteBtn.classList.toggle("hidden",!isHost()||netPhase!=="lobby");
    deleteBtn.disabled=!hostLobby;
  }
  // Host closes via ลบห้อง — only joiners get ออกจากห้อง
  const leaveBtn=$("lobbyLeaveBtn");
  if(leaveBtn){
    leaveBtn.classList.toggle("hidden", isHost() || spectating);
  }
  if($("leaveRoom")) $("leaveRoom").classList.toggle("hidden", true);
  if($("pname")) $("pname").disabled=spinning||wheelSpinning||locked;
  if($("addForm")){
    const addBtn=$("addForm").querySelector("button");
    if(addBtn) addBtn.disabled=spinning||wheelSpinning||locked;
  }
  paintLobbyAngel();
  paintAutoButtons();
  paintRoomChatBubbles();
  paintRoomChatBar();
  paintRoomChatTargets();
}
let lobbyBagItems=null;
let lobbyBagSelectedId="";
function escBag(s){
  return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function bagItemDescHtml(item){
  const short=String((item&&item.description)||"").trim();
  const details=String((item&&item.details)||"").trim();
  if(!short&&!details) return "";
  const more=details
    ?`<button type="button" class="item-desc-more-btn" data-bag-details="${escBag(item.id)}">รายละเอียดเพิ่มเติม</button>`
    :"";
  return `${short?`<p class="item-desc-short">${escBag(short)}</p>`:""}${more}`;
}
function bagThumbHtml(item){
  const url=item&&item.imageUrl?String(item.imageUrl):"";
  return url
    ?`<img class="bag-card-img" src="${escBag(url)}" alt="" decoding="async">`
    :`<div class="bag-card-img bag-card-fallback" aria-hidden="true">?</div>`;
}
function angelArmed(){
  const me=playerMeta.find(p=>p&&p.id===myId);
  return !!(me&&me.angelGuard);
}
async function refreshAngelQty(){
  if(!onlineMode||spectating) return;
  try{
    const res=await fetch("/api/v1/inventory/me",{method:"GET",credentials:"same-origin",headers:{Accept:"application/json"}});
    const data=await res.json().catch(()=>({}));
    lobbyBagItems=res.ok&&Array.isArray(data.items)?data.items:[];
  }catch(_){ lobbyBagItems=[]; }
  if(lobbyBagSelectedId&&!(lobbyBagItems||[]).some(it=>it&&it.id===lobbyBagSelectedId)){
    lobbyBagSelectedId="";
  }
  paintLobbyAngel();
  if($("lobbyBagModal")&&!$("lobbyBagModal").classList.contains("hidden")) paintLobbyBagModal();
}
function paintLobbyAngel(){
  const btn=$("lobbyItemBtn");
  const inLobby=netPhase==="lobby";
  const inGame=netPhase==="play"||netPhase==="snake"||netPhase==="wheel";
  const canBag=onlineMode&&!spectating&&canUseFriends();
  const showLobby=canBag&&inLobby;
  const showInGame=canBag&&inGame;
  if(btn) btn.classList.toggle("hidden",!showLobby);
  const fab=$("inGameBagBtn");
  if(fab){
    // Snake board has its own bag control — FAB for secret/wheel only.
    fab.classList.toggle("hidden",!(showInGame&&netPhase!=="snake"));
  }
  if(!showLobby&&!showInGame) closeLobbyBagModal();
  else if($("lobbyBagModal")&&!$("lobbyBagModal").classList.contains("hidden")) paintLobbyBagModal();
}
function helperCanUseInBag(item){
  if(!item||!(Number(item.quantity)>0)||spinning||spectating) return false;
  if(item.id==="item.angel"){
    return netPhase==="lobby"&&gameCat!=="imposter"&&gameCat!=="cardmemory"&&gameCat!=="werewolf"&&!angelArmed();
  }
  if(item.id==="item.evenodd"){
    const me=playerMeta.find(p=>p&&p.id===myId);
    const armed=!!(me&&((me.evenOddCharges|0)>0));
    return netPhase==="lobby"&&gameCat==="snake"&&!armed;
  }
  if(item.id==="item.skip"){
    if(netPhase==="wheel"){
      const me=playerMeta.find(p=>p&&p.id===myId);
      return !!(me&&!me.skipTurnGuard);
    }
    return netPhase==="play"||netPhase==="snake";
  }
  if(item.id==="item.bomb"){
    return netPhase==="snake"&&gameCat==="snake";
  }
  return false;
}
function helperUseLabel(item){
  if(!item) return "ใช้";
  if(item.id==="item.angel"||item.id==="item.evenodd") return "ใช้ก่อนเริ่ม";
  if(item.id==="item.skip") return netPhase==="wheel"?"ติด Skip (ตัวเอง)":"ใช้ข้ามเทิร์น";
  if(item.id==="item.bomb") return "วางบนกระดาน";
  return "ใช้";
}
function startBombCellPick(){
  const board=ensureSnakeBoard();
  if(!board||typeof board.setBombPickMode!=="function") return;
  closeLobbyBagModal();
  board.setBombPickMode(true,{
    onPick(cell){
      board.setBombPickMode(false);
      send({t:"useHelper",itemId:"item.bomb",cell});
      const msg=$("lobbyBagMsg");
      if(msg){ msg.textContent="กำลังวางบอม…"; msg.classList.add("ok"); }
    },
    onCancel(){}
  });
}
function openLobbyBagModal(){
  const modal=$("lobbyBagModal");
  if(!modal) return;
  const msg=$("lobbyBagMsg");
  if(msg){ msg.textContent=""; msg.classList.remove("ok"); }
  modal.classList.remove("hidden");
  if(lobbyBagItems==null) refreshAngelQty();
  else paintLobbyBagModal();
}
function closeLobbyBagModal(){
  const modal=$("lobbyBagModal");
  if(modal) modal.classList.add("hidden");
}
function paintLobbyBagModal(){
  const grid=$("lobbyBagGrid");
  const preview=$("lobbyBagPreview");
  if(!grid||!preview) return;
  const items=Array.isArray(lobbyBagItems)?lobbyBagItems:[];
  if(lobbyBagItems==null){
    grid.innerHTML=`<div class="loading">Loading…</div>`;
    preview.innerHTML=`<p class="empty">กำลังโหลดกระเป๋า…</p>`;
    return;
  }
  if(!items.length){
    grid.innerHTML=`<p class="empty">ยังไม่มีไอเทม — ซื้อได้ที่ Shop</p>`;
    preview.innerHTML=`<p class="empty">ยังไม่มีไอเทมในกระเป๋า</p>`;
    return;
  }
  if(!lobbyBagSelectedId||!items.some(it=>it.id===lobbyBagSelectedId)){
    lobbyBagSelectedId=items[0].id;
  }
  const sel=items.find(it=>it.id===lobbyBagSelectedId)||null;
  grid.innerHTML=items.map(it=>{
    const on=it.id===lobbyBagSelectedId;
    const qty=Number(it.quantity)||0;
    return `<button type="button" class="bag-card${on?" on":""}" data-bag-id="${escBag(it.id)}">
      <div class="bag-card-thumb">${bagThumbHtml(it)}</div>
      <span class="bag-pill">ไอเทม</span>
      <b>${escBag(it.name||"")}</b>
      <span class="bag-qty-tag">×${qty}</span>
    </button>`;
  }).join("");
  grid.querySelectorAll("[data-bag-id]").forEach(btn=>{
    btn.onclick=()=>{
      lobbyBagSelectedId=btn.getAttribute("data-bag-id")||"";
      paintLobbyBagModal();
    };
  });
  if(!sel){
    preview.innerHTML=`<p class="empty">เลือกไอเทมเพื่อดูรายละเอียด</p>`;
    return;
  }
  const armedAngel=sel.id==="item.angel"&&angelArmed();
  const me=playerMeta.find(p=>p&&p.id===myId);
  const armedEven=sel.id==="item.evenodd"&&!!(me&&((me.evenOddCharges|0)>0));
  const armedSkip=sel.id==="item.skip"&&netPhase==="wheel"&&!!(me&&me.skipTurnGuard);
  const armed=armedAngel||armedEven||armedSkip;
  const canUse=helperCanUseInBag(sel);
  const statusNote=armedAngel||armedEven||armedSkip
    ?" · ใช้แล้วในเกมนี้"
    :sel.id==="item.angel"&&(gameCat==="imposter"||gameCat==="cardmemory"||gameCat==="werewolf")
      ?" · ใช้ไม่ได้ในเกมนี้"
    :sel.id==="item.skip"&&(netPhase==="play"||netPhase==="snake"||netPhase==="wheel")
      ?" · ใช้ระหว่างเกม"
      :sel.id==="item.bomb"&&netPhase==="snake"
        ?" · ใช้ระหว่างเกม · บันไดงู"
        :"";
  preview.innerHTML=`
    <div class="bag-preview-stage">${bagThumbHtml(sel)}</div>
    <div class="bag-preview-meta">
      <span class="bag-pill">ไอเทม</span>
      <b>${escBag(sel.name||"")}</b>
      ${bagItemDescHtml(sel)}
      <p class="tiny muted" style="margin:8px 0 0">ในกระเป๋า: <b>×${Number(sel.quantity)||0}</b>${statusNote}</p>
    </div>
    <div class="bag-preview-actions">
      <button type="button" class="btn" id="lobbyBagUseBtn" ${canUse?"":"disabled"}>${armed?"ใช้แล้ว":helperUseLabel(sel)}</button>
    </div>`;
  const useBtn=$("lobbyBagUseBtn");
  if(useBtn){
    useBtn.onclick=()=>{
      if(!canUse) return;
      if(sel.id==="item.skip"&&(netPhase==="play"||netPhase==="snake")){
        closeLobbyBagModal();
        openSkipTargetModal();
        return;
      }
      if(sel.id==="item.bomb"){
        startBombCellPick();
        return;
      }
      send({t:"useHelper",itemId:sel.id});
      const msg=$("lobbyBagMsg");
      if(msg){ msg.textContent="กำลังใช้…"; msg.classList.add("ok"); }
    };
  }
  preview.querySelectorAll("[data-bag-details]").forEach(btn=>{
    btn.onclick=(e)=>{
      e.preventDefault();
      e.stopPropagation();
      const id=btn.getAttribute("data-bag-details");
      const item=(lobbyBagItems||[]).find(it=>it&&it.id===id);
      if(item&&window.NVDialog&&typeof window.NVDialog.openItemDetailsDialog==="function"){
        window.NVDialog.openItemDetailsDialog(item);
      }
    };
  });
}
function paintAutoButtons(){
  const show=onlineMode&&(netPhase==="play"||netPhase==="pick"||netPhase==="snake")&&!spectating;
  [
    ["autoPlay","play"],
    ["autoPick","pick"],
    ["autoSnake","snake"]
  ].forEach(([id, phase])=>{
    const el=$(id);
    if(!el) return;
    el.classList.toggle("hidden",!show||netPhase!==phase);
    el.classList.toggle("auto-on",!!myAuto);
    el.setAttribute("aria-pressed",myAuto?"true":"false");
    el.textContent=myAuto?"ปิดออโต้":"เล่นอัตโนมัติ";
  });
}
function rosterChanged(){
  clearTimeout(spinTimer);
  stopSpinSound();
  spinning=false;
  order=[];
  turn=0;
  rot=0;
  const canvas=$("wheel");
  canvas.style.transition="none";
  canvas.style.transform="rotate(0deg)";
  savePlayers();
  saveScores();
  drawWheel();
  renderPlayers();
  renderTurn();
  $("winner").textContent=wheelMessage();
}
function addPlayers(raw){
  if(roundLive()||spinning||wheelSpinning) return;
  const parts=String(raw||"").split(/[,，\n]/).map(s=>s.trim()).filter(Boolean);
  if(!parts.length){ $("perr").textContent="พิมพ์ชื่อก่อน"; return; }
  let added=0, skipped=0;
  for(const name of parts){
    const clipped=name.slice(0,24);
    if(players.some(p=>p.toLowerCase()===clipped.toLowerCase())){ skipped++; continue; }
    if(players.length>=PLAYER_MAX){ skipped++; continue; }
    players.push(clipped);
    scores[clipped]=0;
    added++;
  }
  if(!added){
    $("perr").textContent=players.length>=PLAYER_MAX?"ใส่ได้สูงสุด "+PLAYER_MAX+" คน":"มีชื่อนี้แล้ว";
    return;
  }
  $("perr").textContent=skipped?"ข้ามชื่อที่ซ้ำหรือเกินจำนวน":"";
  $("pname").value="";
  rosterChanged();
}
function removePlayer(i){
  if(spinning||wheelSpinning||roundLive()||i<0) return;
  const name=players[i];
  players.splice(i,1);
  delete scores[name];
  forgetScore(name);
  rosterChanged();
}
function finishSpin(){
  stopSpinSound();
  spinning=false;
  order=nextOrder.slice();
  turn=0;
  renderPlayers();
  renderTurn();
  $("winner").textContent=order.length?"เริ่มที่ "+order[0]:"กดสุ่มลำดับ";
}
function spinWheel(){
  if(spinning||wheelSpinning||players.length<2||roundLive()) return;
  spinning=true;
  playSpinSound();
  renderPlayers();
  $("winner").textContent="กำลังสุ่มลำดับ…";
  $("perr").textContent="";
  nextOrder=players.slice();
  for(let i=nextOrder.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    const swap=nextOrder[i];
    nextOrder[i]=nextOrder[j];
    nextOrder[j]=swap;
  }
  const index=players.indexOf(nextOrder[0]);
  const n=players.length;
  const slice=360/n;
  const margin=Math.min(slice*0.12,8);
  const jitter=margin+Math.random()*Math.max(slice-margin*2,0);
  const fromTop=index*slice+jitter;
  const current=((rot%360)+360)%360;
  let target=(360-fromTop)%360;
  let delta=target-current;
  if(delta<0) delta+=360;
  const extra=5+Math.floor(Math.random()*3);
  rot+=extra*360+delta;
  const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ms=reduce?0:4300;
  const canvas=$("wheel");
  canvas.style.transition=ms?`transform ${ms}ms cubic-bezier(.15,.85,.1,1)`:"none";
  canvas.style.transform=`rotate(${rot}deg)`;
  clearTimeout(spinTimer);
  spinTimer=setTimeout(finishSpin, ms+60);
}

function playerColor(name){
  const i=players.indexOf(name);
  return WHEEL_COLORS[(i<0?0:i)%WHEEL_COLORS.length];
}
function wheelSpan(){
  return wheelMax-wheelMin+1;
}
function liveWheelNums(){
  if(!wheelGone.length){
    const all=[];
    for(let n=wheelMin;n<=wheelMax;n++) all.push(n);
    return all;
  }
  const gone=new Set(wheelGone);
  const all=[];
  for(let n=wheelMin;n<=wheelMax;n++) if(!gone.has(n)) all.push(n);
  return all;
}
function numberAt(deg){
  const pool=liveWheelNums();
  const span=pool.length;
  if(span<1) return wheelMin;
  const slice=360/span;
  const norm=((-deg%360)+360)%360;
  let index=Math.round(norm/slice);
  if(index===span) index=0;
  index=((index%span)+span)%span;
  return pool[index];
}
function applyWheelRot(){
  const canvas=$("numWheel");
  canvas.style.transition="none";
  canvas.style.transform="rotate("+wheelRot+"deg)";
}
function invalidateWheel(){
  wheelGen++;
  clearTimeout(wheelEndTimer);
  cancelAnimationFrame(wheelAnim);
  if(wheelSpinning) stopSpinSound();
  wheelSpinning=false;
}
function leaveGame(){
  invalidateWheel();
  closeWinnerModal();
  // Offline: returning from a finished match that hit winTarget clears scores.
  if(!$("over").classList.contains("hidden") && $("again").dataset.reset==="1"){
    players.forEach(name=>{ scores[name]=0; });
    saveScores();
  }
  show("start");
  renderPlayers();
}
function renderOverHist(items){
  const wrap=$("overHistWrap");
  const h=$("overHist");
  if(!items||!items.length){
    wrap.classList.add("hidden");
    h.textContent="";
    return;
  }
  wrap.classList.remove("hidden");
  h.textContent="";
  items.forEach(item=>{
    const s=document.createElement("span");
    s.textContent=item.who?item.who+" "+item.n:String(item.n);
    if(item.who) s.classList.add("hit");
    h.appendChild(s);
  });
}
function renderNameHist(el, rows){
  el.textContent="";
  if(!rows.length){ el.textContent="ยังไม่มี"; return; }
  rows.forEach(item=>{
    const s=document.createElement("span");
    s.textContent=item.who?item.who+" "+item.n:String(item.n);
    if(item.who) s.classList.add("hit");
    el.appendChild(s);
  });
}
function pickList(name){
  const list=picks[name];
  return Array.isArray(list)?list:[];
}
function pickTotal(){
  return wheelOrder.length*Math.max(pickEach,1);
}
function takenNumbers(){
  const taken=new Set();
  wheelOrder.forEach(name=>pickList(name).forEach(n=>taken.add(n)));
  return taken;
}
function ownerOfNumber(n){
  for(const name of wheelOrder) if(pickList(name).includes(n)) return name;
  return "";
}
function renderPick(){
  const span=wheelSpan();
  const total=pickTotal();
  const done=pickCursor>=total;
  const name=done?"":wheelOrder[Math.floor(pickCursor/Math.max(pickEach,1))]||"";
  const slot=pickEach?pickCursor%pickEach:0;
  $("pickName").textContent=done?"เลือกครบแล้ว":"ตาของ "+name;
  $("pickProgress").textContent=done?"กดเริ่มหมุน":"เลขที่ "+(slot+1)+"/"+pickEach+" · รวม "+pickCursor+"/"+total;
  paintTurnClock();
  $("pickLo").textContent=wheelMin;
  $("pickHi").textContent=wheelMax;
  $("pickGrid").classList.toggle("hidden", done);
  $("pickJump").classList.toggle("hidden", done);
  if(onlineMode){
    $("pickGuess").disabled=done||!myTurn;
    const go=$("pickJump").querySelector("button");
    if(go) go.disabled=done||!myTurn;
  }
  $("pickGo").classList.toggle("hidden", !done);
  $("pickUndo").disabled=pickCursor<=0;
  const paged=!done&&span>PAGE;
  $("pickPager").classList.toggle("hidden", !paged);
  if(!done){
    let from=wheelMin, to=wheelMax;
    if(paged){
      const origin=wheelMin;
      const maxStart=origin+Math.floor((wheelMax-origin)/PAGE)*PAGE;
      if(pickFrom<origin||pickFrom>maxStart) pickFrom=origin;
      pickFrom=origin+Math.floor((pickFrom-origin)/PAGE)*PAGE;
      from=pickFrom;
      to=Math.min(wheelMax, pickFrom+PAGE-1);
      $("pickPageLabel").textContent="เลข "+from+"–"+to;
      $("pickPrev").disabled=pickFrom<=origin;
      $("pickNext").disabled=pickFrom+PAGE>wheelMax;
    }
    const g=$("pickGrid");
    const sample=Math.max(Math.abs(from), Math.abs(to));
    const digits=String(sample).length+(from<0||to<0?1:0);
    g.className="grid"+(digits>=4?" d4":digits===3?" d3":"");
    g.textContent="";
    const taken=takenNumbers();
    const mine=new Set(pickList(name));
    for(let n=from;n<=to;n++){
      const b=document.createElement("button");
      b.type="button";
      b.textContent=String(n);
      if(mine.has(n)) b.classList.add("mine");
      else if(taken.has(n)) b.classList.add("used");
      const wait=onlineMode&&name!==myName();
      b.disabled=taken.has(n)||wait;
      if(wait&&!taken.has(n)) b.classList.add("wait");
      b.onclick=()=>choosePick(n);
      g.appendChild(b);
    }
  }
  const rows=[];
  wheelOrder.forEach(nm=>pickList(nm).forEach(n=>rows.push({who:nm,n:n})));
  renderNameHist($("pickHist"), rows);
}
function pickNumber(raw){
  if(pickCursor>=pickTotal()) return;
  const n=typeof raw==="number"?raw:parseIntStrict(raw);
  const name=wheelOrder[Math.floor(pickCursor/Math.max(pickEach,1))];
  if(!name) return;
  if(n==null){ $("pickMsg").textContent="ใส่เป็นจำนวนเต็ม"; return; }
  if(n<wheelMin||n>wheelMax){ $("pickMsg").textContent="เลือกเลขระหว่าง "+wheelMin+" ถึง "+wheelMax; return; }
  if(takenNumbers().has(n)){ $("pickMsg").textContent="เลขนี้มีคนเลือกแล้ว"; return; }
  if(!picks[name]) picks[name]=[];
  picks[name].push(n);
  pickCursor++;
  $("pickMsg").textContent="";
  $("pickGuess").value="";
  renderPick();
  renderPlayers();
}
function undoPick(){
  if(wheelSpinning||pickCursor<=0) return;
  pickCursor--;
  const name=wheelOrder[Math.floor(pickCursor/Math.max(pickEach,1))];
  const list=pickList(name);
  list.pop();
  if(!list.length) delete picks[name];
  $("pickMsg").textContent="";
  renderPick();
  renderPlayers();
}
function startPick(min, max){
  invalidateWheel();
  clearLocalChampions();
  wheelMin=min;
  wheelMax=max;
  wheelOrder=order.slice();
  picks={};
  pickCursor=0;
  pickFrom=min;
  wheelAlive=[];
  wheelLog=[];
  wheelGone=[];
  $("again").dataset.reset="";
  $("back").textContent="เลือกโหมดใหม่";
  show("pick");
  $("pickMode").textContent="ช่วง "+min+"–"+max+" · คนละ "+pickEach+" เลข · ถึง "+winTarget+" แต้มชนะ · เลขที่ออกจะถูกตัดจากวงล้อ";
  $("pickMsg").textContent="";
  renderPick();
  renderPlayers();
}
function drawRimText(ctx, cx, cy, text, mid, radius, fill, size){
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(mid+Math.PI/2);
  ctx.font="700 "+size+"px "+FONT;
  ctx.textAlign="center";
  ctx.textBaseline="middle";
  ctx.lineWidth=3;
  ctx.strokeStyle="rgba(0,0,0,.45)";
  ctx.strokeText(text, 0, -radius);
  ctx.fillStyle=fill;
  ctx.fillText(text, 0, -radius);
  ctx.restore();
}
function drawNumWheel(){
  const canvas=$("numWheel");
  if(!canvas||!(wheelMax>=wheelMin)) return;
  const size=320;
  const dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=size*dpr;
  canvas.height=size*dpr;
  const ctx=canvas.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const cx=size/2, cy=size/2, r=size/2-8;
  const pool=liveWheelNums();
  const span=pool.length;
  const ownerOf=Object.create(null);
  wheelOrder.forEach(name=>pickList(name).forEach(n=>{ ownerOf[n]=name; }));
  ctx.clearRect(0,0,size,size);
  if(span<1){
    ctx.beginPath();
    ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.fillStyle=BAND_B;
    ctx.fill();
    applyWheelRot();
    return;
  }
  const slice=(Math.PI*2)/span;
  const start=-Math.PI/2-slice/2;
  const indexOf=Object.create(null);
  pool.forEach((num,i)=>{ indexOf[num]=i; });
  if(span<=200){
    for(let i=0;i<span;i++){
      const num=pool[i];
      const owner=ownerOf[num]||"";
      const living=owner&&wheelAlive.includes(owner);
      ctx.beginPath();
      ctx.moveTo(cx,cy);
      ctx.arc(cx,cy,r,start+i*slice,start+(i+1)*slice);
      ctx.closePath();
      if(living) ctx.fillStyle=playerColor(owner);
      else if(owner) ctx.fillStyle=DEAD_SLICE;
      else ctx.fillStyle=i%2?BAND_B:BAND_A;
      ctx.fill();
      if(living){
        ctx.lineWidth=2;
        ctx.strokeStyle="#fde68a";
        ctx.stroke();
      }
    }
  }else{
    const bands=90;
    const band=Math.PI*2/bands;
    for(let i=0;i<bands;i++){
      ctx.beginPath();
      ctx.moveTo(cx,cy);
      ctx.arc(cx,cy,r,-Math.PI/2-band/2+i*band,-Math.PI/2-band/2+(i+1)*band);
      ctx.closePath();
      ctx.fillStyle=i%2?BAND_B:BAND_A;
      ctx.fill();
    }
    wheelOrder.forEach(name=>{
      const living=wheelAlive.includes(name);
      pickList(name).forEach(num=>{
        if(!(num in indexOf)) return;
        const i=indexOf[num];
        const mid=-Math.PI/2+i*slice;
        ctx.beginPath();
        ctx.arc(cx+Math.cos(mid)*r*0.78, cy+Math.sin(mid)*r*0.78, span>800?4:7, 0, Math.PI*2);
        ctx.fillStyle=living?playerColor(name):DEAD_SLICE;
        ctx.fill();
        if(living){
          ctx.lineWidth=2;
          ctx.strokeStyle="#fde68a";
          ctx.stroke();
        }
      });
    });
  }
  if(span<=100){
    const step=span<=30?1:span<=60?5:10;
    if(step===1){
      for(let i=0;i<span;i++){
        const num=pool[i];
        if(ownerOf[num]) continue;
        drawRimText(ctx,cx,cy,String(num),start+(i+0.5)*slice,r*0.78,"rgba(255,255,255,.82)",span>20?10:13);
      }
    }else{
      for(let i=0;i<span;i++){
        const num=pool[i];
        if(ownerOf[num]||num%step!==0) continue;
        drawRimText(ctx,cx,cy,String(num),start+(i+0.5)*slice,r*0.84,"rgba(255,255,255,.8)",11);
      }
    }
  }
  const labeled=[];
  const minGap=span>40?Math.ceil(span/16):1;
  wheelOrder.forEach(name=>{
    const living=wheelAlive.includes(name);
    pickList(name).forEach(num=>{
      if(!(num in indexOf)) return;
      const close=labeled.some(n=>{
        const a=indexOf[n], b=indexOf[num];
        const d=Math.abs(a-b);
        return Math.min(d, span-d)<minGap;
      });
      if(close) return;
      labeled.push(num);
      const i=indexOf[num];
      drawRimText(ctx,cx,cy,String(num),start+(i+0.5)*slice,r*(span<=30?0.58:0.66),living?"#fff":"rgba(255,255,255,.7)",span<=40?16:13);
    });
  });
  ctx.beginPath();
  ctx.arc(cx,cy,r,0,Math.PI*2);
  ctx.lineWidth=8;
  ctx.strokeStyle="rgba(255,255,255,.92)";
  ctx.stroke();
  applyWheelRot();
}
function renderWheelInfo(){
  const leftNums=liveWheelNums().length;
  $("wheelMode").textContent="ช่วง "+wheelMin+"–"+wheelMax+" · เหลือ "+leftNums+" เลข · "+wheelAlive.length+" คน · ถึง "+winTarget+" แต้มชนะ";
  const box=$("wheelChips");
  box.textContent="";
  wheelOrder.forEach(name=>{
    const el=document.createElement("span");
    el.className="chip"+(!wheelAlive.includes(name)?" out":"");
    el.style.borderColor=playerColor(name);
    el.textContent=name+" · "+(pickList(name).join(", ")||"—");
    box.appendChild(el);
  });
  renderNameHist($("wheelHist"), wheelLog);
}
function openWheel(){
  if(!wheelOrder.length||pickCursor<pickTotal()) return;
  invalidateWheel();
  wheelAlive=wheelOrder.slice();
  wheelLog=[];
  wheelGone=[];
  show("wheelGame");
  $("numRead").classList.remove("hit");
  $("numRead").textContent="—";
  $("wheelResult").classList.remove("bad");
  $("wheelResult").textContent="กดหมุนวงล้อ";
  $("doSpin").disabled=false;
  $("doSpin").textContent="หมุนวงล้อ";
  $("wheelRepick").disabled=false;
  drawNumWheel();
  renderWheelInfo();
  renderPlayers();
}
function repickNumbers(){
  if(wheelSpinning||wheelLog.length) return;
  picks={};
  pickCursor=0;
  pickFrom=wheelMin;
  show("pick");
  renderPick();
  renderPlayers();
}
function finishWheel(){
  const winner=wheelAlive[0]||"";
  if(winner) scores[winner]=(scores[winner]||0)+1;
  saveScores();
  const won=!!(winner&&(scores[winner]||0)>=winTarget);
  if(won) setLocalChampions([winner]);
  if(won){
    $("overTitle").textContent=winner+" ชนะแล้ว!";
    $("overNote").textContent="ถึง "+winTarget+" แต้ม";
    celebrateMatchWin([winner],{winTarget,note:"ถึง "+winTarget+" แต้ม"});
  }else if(winner){
    $("overTitle").textContent=winner+" เป็นคนสุดท้าย";
    $("overNote").textContent="ได้ 1 แต้ม";
  }else{
    $("overTitle").textContent="ไม่มีผู้ชนะ";
    $("overNote").textContent="";
  }
  $("secretLabel").textContent=winner?"เลขที่เลือก":"";
  const shown=$("secret");
  const num=winner?pickList(winner).join(", "):"";
  shown.textContent=num;
  shown.classList.toggle("many", pickList(winner).length>1||num.length>4);
  setOverOutOrder(outOrderFrom(wheelLog,false));
  renderOverHist(wheelLog);
  $("again").textContent=won?"เริ่มแมตช์ใหม่":"รอบถัดไป";
  $("again").dataset.reset=won?"1":"";
  $("again").dataset.mode="wheel";
  $("back").textContent=won?"กลับเมนู · รีแต้ม":"เลือกโหมดใหม่";
  renderScores($("finalScores"));
  show("over");
  renderPlayers();
}
function finishLand(n, gen){
  if(gen!==wheelGen) return;
  wheelSpinning=false;
  stopSpinSound();
  $("numRead").textContent=String(n);
  const owner=ownerOfNumber(n);
  const hit=!!(owner&&wheelAlive.includes(owner));
  if(!wheelGone.includes(n)) wheelGone.push(n);
  if(hit){
    playClip(BOMB_SOUND);
    const idx=wheelAlive.indexOf(owner);
    if(idx>=0) wheelAlive.splice(idx,1);
    $("wheelResult").textContent=owner+" โดนเลข "+n+" ออกจากเกม";
    $("wheelResult").classList.add("bad");
    $("numRead").classList.add("hit");
    wheelLog.push({n:n, who:owner});
  }else{
    $("numRead").classList.remove("hit");
    $("wheelResult").classList.remove("bad");
    $("wheelResult").textContent=owner?"เลข "+n+" ของ "+owner+" ถูกตัดออก":"เลข "+n+" ถูกตัดออก";
    wheelLog.push({n:n, who:""});
  }
  drawNumWheel();
  renderWheelInfo();
  renderPlayers();
  const left=liveWheelNums().length;
  const delay=motionOff()?40:!hit?450:wheelAlive.length<=1?1100:1400;
  $("doSpin").disabled=true;
  $("doSpin").textContent=wheelAlive.length<=1||left<1?"จบรอบ":"กำลังจะหมุนต่อ…";
  wheelEndTimer=setTimeout(()=>{
    if(gen!==wheelGen) return;
    if(wheelAlive.length<=1||liveWheelNums().length<1) finishWheel();
    else spinNumber();
  }, delay);
}
function spinNumber(){
  if(wheelSpinning||wheelAlive.length<2) return;
  const pool=liveWheelNums();
  const span=pool.length;
  if(span<1) return;
  const gen=wheelGen;
  const index=Math.floor(Math.random()*span);
  const n=pool[index];
  const owner=ownerOfNumber(n);
  const hit=!!(owner&&wheelAlive.includes(owner));
  const slice=360/span;
  const margin=slice*0.18;
  const room=Math.max(slice/2-margin, 0);
  const jitter=(Math.random()*2-1)*room;
  const base=((wheelRot%360)+360)%360;
  wheelRot=base;
  applyWheelRot();
  const desiredMod=((((-index*slice+jitter)%360)+360)%360);
  let delta=desiredMod-base;
  if(delta<=0) delta+=360;
  const extra=hit?4+Math.floor(Math.random()*2):2;
  const from=wheelRot;
  const target=from+extra*360+delta;
  const dur=motionOff()?0:hit?7200:3400;
  wheelSpinning=true;
  clearTimeout(wheelEndTimer);
  $("doSpin").disabled=true;
  $("doSpin").textContent="กำลังหมุน…";
  $("wheelRepick").disabled=true;
  $("numRead").classList.remove("hit");
  $("wheelResult").classList.remove("bad");
  $("wheelResult").textContent="กำลังหมุน…";
  renderPlayers();
  if(dur) playSpinSound();
  const t0=performance.now();
  function frame(now){
    if(gen!==wheelGen) return;
    const t=dur?Math.min(1,(now-t0)/dur):1;
    const e=1-Math.pow(1-t,2);
    wheelRot=from+(target-from)*e;
    applyWheelRot();
    const showN=numberAt(wheelRot);
    if($("numRead").textContent!==String(showN)) $("numRead").textContent=String(showN);
    if(t<1) wheelAnim=requestAnimationFrame(frame);
    else finishLand(n, gen);
  }
  wheelAnim=requestAnimationFrame(frame);
}
function paintGameModeBadge(cat){
  const ico=$("gameModeIco");
  const name=$("gameModeName");
  const hint=$("gameModeHint");
  if(ico) ico.textContent=cat==="wheel"?"🎡":cat==="snake"?"🐍":cat==="imposter"?"🕵️":cat==="cardmemory"?"🃏":cat==="werewolf"?"🐺":"🔢";
  if(name) name.textContent=cat==="wheel"?"วงล้อ":cat==="snake"?"บันไดงู":cat==="imposter"?"Imposter":cat==="cardmemory"?"Memory Card":cat==="werewolf"?"Werewolf":"หาเลข";
  if(hint) hint.textContent=cat==="wheel"?"วงล้อสุ่มเลข":cat==="snake"?"ทอยลูกเต๋าถึง 100":cat==="imposter"?"หา Imposter ด้วยคำใบ้":cat==="cardmemory"?"จับคู่การ์ด":cat==="werewolf"?"หาหมาป่าในหมู่บ้าน":"ห้ามโดนเลขลับ";
}
function normalizeCat(next){
  if(next==="wheel"||next==="snake"||next==="secret"||next==="imposter"||next==="cardmemory"||next==="werewolf") return next;
  return "secret";
}
function applyCat(next){
  const cat=normalizeCat(next);
  const changed=cat!==gameCat;
  if(changed){
    saveScores();
    gameCat=cat;
  }
  try{ localStorage.setItem("nv-last-game", cat); }catch(e){}
  const wheel=cat==="wheel";
  const snake=cat==="snake";
  const imposter=cat==="imposter";
  const memory=cat==="cardmemory";
  const werewolf=cat==="werewolf";
  if($("secretOnly")) $("secretOnly").classList.toggle("hidden", wheel||snake||imposter||memory||werewolf);
  if($("wheelOnly")) $("wheelOnly").classList.toggle("hidden", !wheel);
  if($("snakeOnly")) $("snakeOnly").classList.toggle("hidden", !snake);
  if($("imposterOnly")) $("imposterOnly").classList.toggle("hidden", !imposter);
  if($("memoryOnly")) $("memoryOnly").classList.toggle("hidden", !memory);
  if($("werewolfOnly")) $("werewolfOnly").classList.toggle("hidden", !werewolf);
  if($("numberSetup")) $("numberSetup").classList.toggle("hidden", snake||imposter||memory||werewolf);
  const cats=$("cats");
  if(cats){
    for(const x of cats.querySelectorAll("[data-cat]")){
      const on=x.dataset.cat===cat;
      x.classList.toggle("on",on);
      x.setAttribute("aria-pressed",on?"true":"false");
    }
  }
  paintGameModeBadge(cat);
  if($("startSub")){
    $("startSub").textContent=wheel
      ?"เลือกได้หลายเลข แล้วอย่าให้วงล้อลงเลขนั้น"
      :snake
        ?"ทอยลูกเต๋า ปีนบันได เลี่ยงงู — ถึงช่อง 100 ชนะ"
        :imposter
          ?"ให้คำใบ้ คุยในแชท โหวตหา Imposter"
          :memory
            ?"เปิดการ์ดทีละ 2 ใบ จำตำแหน่ง แล้วจับคู่"
            :werewolf
              ?"กลางคืนใช้ความสามารถ · กลางวันคุยและโหวตหาหมาป่า"
              :"ทายเลข… แต่ห้ามโดนเลขนั้น!";
  }
  if(changed){
    loadScores();
    renderPlayers();
  }
}

function onUserGesture(){
  unlockAudio();
  startBackground();
}
document.addEventListener("pointerdown",onUserGesture);
document.addEventListener("touchstart",onUserGesture,{passive:true});
document.addEventListener("keydown",onUserGesture);
document.addEventListener("click",e=>{
  onUserGesture();
  const btn=e.target.closest("button");
  if(btn&&!btn.closest("#topChrome")&&!btn.closest("#helpBtn")&&!btn.closest("#volMenu")) playClip(POP_SOUND);
});
$("restModes").onclick=e=>{
  if(onlineMode&&!isHost()) return;
  const b=e.target.closest("button");
  if(!b) return;
  for(const x of $("restModes").children){
    const on=x===b;
    x.classList.toggle("on",on);
    x.setAttribute("aria-pressed",on?"true":"false");
  }
  if(onlineMode&&!applying&&isHost()) send({t:"setup",patch:{pointAll:!!$("restModes").querySelector("[data-rest='all'].on")}});
};
if($("impostorInfoModes")) $("impostorInfoModes").onclick=e=>{
  if(onlineMode&&!isHost()) return;
  const b=e.target.closest("button");
  if(!b) return;
  for(const x of $("impostorInfoModes").children){
    const on=x===b;
    x.classList.toggle("on",on);
    x.setAttribute("aria-pressed",on?"true":"false");
  }
  if(onlineMode&&!applying&&isHost()){
    const info=b.getAttribute("data-impostor-info")==="category"?"category":"none";
    syncWordCategoryLock();
    send({t:"setup",patch:{impostorInfo:info}});
  }
};
$("modes").onclick=e=>{
  if(onlineMode&&!isHost()) return;
  const b=e.target.closest("button");
  if(!b) return;
  for(const x of $("modes").children){
    const on=x===b;
    x.classList.toggle("on",on);
    x.setAttribute("aria-pressed",on?"true":"false");
  }
  useCustom=b.dataset.custom==="1";
  $("custom").classList.toggle("hidden",!useCustom);
  if(!useCustom){ pickMin=Number(b.dataset.min); pickMax=Number(b.dataset.max); }
  refreshLabel();
  if(onlineMode&&!applying&&isHost()){
    const patch=useCustom?{rangeMode:"custom"}:{rangeMode:pickMax>=9999?"9999":pickMax>=999?"999":"99"};
    send({t:"setup",patch});
  }
};
$("cmin").oninput=()=>{ if(onlineMode&&!isHost()) return; refreshLabel(); };
$("cmax").oninput=()=>{ if(onlineMode&&!isHost()) return; refreshLabel(); };
$("cats").onclick=e=>{
  if(onlineMode&&!isHost()) return;
  const b=e.target.closest("button");
  if(!b) return;
  for(const x of $("cats").children){
    const on=x===b;
    x.classList.toggle("on",on);
    x.setAttribute("aria-pressed",on?"true":"false");
  }
  applyCat(b.dataset.cat||"secret");
  if(onlineMode&&!applying&&isHost()) send({t:"setup",patch:{cat:normalizeCat(b.dataset.cat)}});
};
function requestStartGame(){
  if(onlineMode){
    if(!isHost()){ if($("err")) $("err").textContent="เฉพาะโฮสต์ที่เริ่มเกมได้"; return; }
    if(!orderReady()){ if($("err")) $("err").textContent="กดสุ่มลำดับก่อนเริ่มเกม"; return; }
    closeSettingsModal();
    send({t:"start"});
    return;
  }
  if($("setup")) $("setup").requestSubmit();
}
function openSettingsModal(){
  if(!isHost()||netPhase!=="lobby") return;
  const modal=$("settingsModal");
  if(modal) modal.classList.remove("hidden");
}
function closeSettingsModal(){
  const modal=$("settingsModal");
  if(modal) modal.classList.add("hidden");
  closeRenameRoom();
}
function openSpinModal(msg){
  const modal=$("spinModal");
  if(!modal) return;
  modal.classList.remove("hidden");
  if($("spinModalSub")) $("spinModalSub").textContent=msg||"กำลังหมุนวงล้อ…";
  if($("spinModalResult")) $("spinModalResult").textContent="";
  if($("spinModalClose")) $("spinModalClose").classList.add("hidden");
  drawWheel();
}
function closeSpinModal(){
  const modal=$("spinModal");
  if(modal) modal.classList.add("hidden");
}
$("setup").onsubmit=e=>{
  e.preventDefault();
  if(onlineMode){
    if(!isHost()){ if($("err")) $("err").textContent="เฉพาะโฮสต์ที่ตั้งค่าได้"; return; }
    pushNums();
    closeSettingsModal();
    if($("err")){ $("err").textContent="บันทึกการตั้งค่าแล้ว"; $("err").classList.add("ok"); }
    return;
  }
  const c=choice();
  const rangeErr=check(c.min,c.max);
  const winErr=checkWin(readWinTarget());
  if(gameCat==="wheel"){
    const each=parseIntStrict($("pickEach").value);
    const eachErr=each==null||each<1?"จำนวนเลขต่อคนต้องเป็นจำนวนเต็มตั้งแต่ 1":each>99?"จำนวนเลขต่อคนต้องไม่เกิน 99":"";
    $("err").textContent=rangeErr||winErr||eachErr;
    if(rangeErr||winErr||eachErr) return;
    if(players.length<2){ $("err").textContent="ต้องมีผู้เล่นอย่างน้อย 2 คน"; return; }
    if(!orderReady()){ $("err").textContent="กดสุ่มลำดับก่อนเริ่มเกม"; return; }
    if(players.length*each>c.max-c.min+1){ $("err").textContent="เลขในช่วงไม่พอให้ทุกคนเลือก"; return; }
    winTarget=readWinTarget();
    pickEach=each;
    startPick(c.min,c.max);
    return;
  }
  const count=readSecretCount();
  const err=rangeErr||checkCount(c.min,c.max,count)||winErr;
  $("err").textContent=err;
  if(err) return;
  if(!orderReady()){ $("err").textContent="กดสุ่มลำดับก่อนเริ่มเกม"; return; }
  begin(c.min,c.max,count);
};
$("jump").onsubmit=e=>{ e.preventDefault(); pick($("guess").value); };
$("prev").onclick=()=>{ pageFrom-=PAGE; render(); };
$("next").onclick=()=>{ pageFrom+=PAGE; render(); };
$("pickJump").onsubmit=e=>{ e.preventDefault(); pickNumber($("pickGuess").value); };
$("pickPrev").onclick=()=>{ pickFrom-=PAGE; renderPick(); };
$("pickNext").onclick=()=>{ pickFrom+=PAGE; renderPick(); };
$("pickGo").onclick=openWheel;
$("pickUndo").onclick=undoPick;
$("pickLeave").onclick=leaveGame;
if($("snakeLeave")) $("snakeLeave").onclick=leaveGame;
if($("imposterLeave")){
  $("imposterLeave").onclick=()=>{
    if(onlineMode){
      if(isHost()) send({t:"abort"});
      return;
    }
    leaveGame();
  };
}
$("doSpin").onclick=spinNumber;
$("wheelRepick").onclick=repickNumbers;
$("wheelLeave").onclick=leaveGame;
$("again").onclick=()=>{
  closeWinnerModal();
  if($("again").dataset.reset==="1"){
    players.forEach(name=>{ scores[name]=0; });
    saveScores();
    resetWinCelebration();
  }
  if($("again").dataset.mode==="wheel") startPick(wheelMin, wheelMax);
  else begin(gameMin, gameMax, secretTotal);
};
$("back").onclick=leaveGame;
if($("winnerModalClose")) $("winnerModalClose").onclick=()=>closeWinnerModal();
if($("winnerModal")) $("winnerModal").addEventListener("click",e=>{
  if(e.target===$("winnerModal")) closeWinnerModal();
});
$("leave").onclick=leaveGame;
$("addForm").onsubmit=e=>{ e.preventDefault(); addPlayers($("pname").value); };
$("spin").onclick=spinWheel;
$("clearScores").onclick=()=>{
  players.forEach(name=>{ scores[name]=0; });
  saveScores();
  renderPlayers();
  if(!$("over").classList.contains("hidden")) renderScores($("finalScores"));
};
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", ()=>{ if(netPhase!=="gate") drawWheel(); });

let authUser=null;
let authBoot=null;
function myAvatar(){
  return (authUser&&authUser.avatarUrl)||localStorage.getItem("dpn-avatar")||"";
}
function openAuthChoiceModal(){
  const modal=$("authChoiceModal");
  if(modal) modal.classList.remove("hidden");
}
function closeAuthChoiceModal(){
  const modal=$("authChoiceModal");
  if(modal) modal.classList.add("hidden");
}
function paintAuthBar(user){
  const label=$("authLabel");
  const authName=$("authName");
  const loginLink=$("loginLink");
  const accountLink=$("accountLink");
  const avatar=$("authAvatar");
  const nameWrap=$("nameFieldWrap");
  const bar=$("authBar");
  if(!label) return;
  const registered=!!(user&&user.accountType==="registered");
  if(!user){
    label.textContent="Auth ปิดอยู่ — เล่นได้ตามปกติ";
    if(authName) authName.classList.add("hidden");
    if(loginLink) loginLink.classList.add("hidden");
    if(accountLink) accountLink.classList.add("hidden");
    if(nameWrap) nameWrap.classList.remove("hidden");
    if(bar) bar.classList.remove("profile");
    if(avatar){
      avatar.classList.remove("on","ph");
      avatar.textContent="";
    }
    return;
  }
  if(registered){
    label.textContent="สมาชิก";
    if(authName){
      authName.textContent=user.displayName||user.username||"";
      authName.classList.remove("hidden");
    }
    if(nameWrap) nameWrap.classList.add("hidden");
    if(bar) bar.classList.add("profile");
    if(accountLink) accountLink.classList.remove("hidden");
    setLocalName(user.displayName||user.username||"");
  }else{
    label.textContent="Guest · "+(user.displayName||user.username||"");
    if(authName) authName.classList.add("hidden");
    if(nameWrap) nameWrap.classList.remove("hidden");
    if(bar) bar.classList.remove("profile");
    if(accountLink) accountLink.classList.add("hidden");
  }
  if(avatar){
    if(user.avatarUrl){
      avatar.classList.add("on");
      avatar.classList.remove("ph");
      avatar.innerHTML="";
      const img=document.createElement("img");
      img.src=user.avatarUrl;
      img.alt=user.displayName||"avatar";
      img.width=40;
      img.height=40;
      img.referrerPolicy="no-referrer";
      avatar.appendChild(img);
      localStorage.setItem("dpn-avatar", user.avatarUrl);
    }else if(registered){
      avatar.innerHTML="";
      avatar.classList.add("on","ph");
      avatar.textContent=(user.displayName||"?").slice(0,1).toUpperCase();
      localStorage.removeItem("dpn-avatar");
    }else{
      avatar.classList.remove("on","ph");
      avatar.innerHTML="";
      localStorage.removeItem("dpn-avatar");
    }
  }
  if(loginLink) loginLink.classList.toggle("hidden", registered);
  paintRoomChatBar();
  paintInviteBtn();
}
function canUseFriends(){
  return !!(authUser&&authUser.accountType==="registered");
}
function formatAccountTenure(iso){
  if(!iso) return "—";
  const start=new Date(iso).getTime();
  if(!Number.isFinite(start)) return "—";
  const days=Math.max(0, Math.floor((Date.now()-start)/86400000));
  if(days<1) return "วันนี้";
  if(days<30) return days+" วัน";
  const months=Math.floor(days/30);
  if(months<12) return months+" เดือน";
  const years=Math.floor(months/12);
  const rem=months%12;
  return rem?years+" ปี "+rem+" เดือน":years+" ปี";
}
function adminRoleLabel(roles){
  const list=Array.isArray(roles)?roles:[];
  if(list.includes("super_admin")) return "Super Admin";
  if(list.includes("admin")) return "Admin";
  if(list.includes("moderator")) return "Moderator";
  return "";
}
function genderLabelOf(g){
  if(g==="male") return "ชาย";
  if(g==="female") return "หญิง";
  if(g==="lgbtq") return "LGBTQ+";
  return "—";
}
function makeNvPill(text, extraClass){
  const el=document.createElement("span");
  el.className="nv-pill"+(extraClass?" "+extraClass:"");
  el.textContent=text||"—";
  return el;
}
function canOpenPlayerProfile(meta){
  return !!(onlineMode&&netPhase==="lobby"&&!spinning&&meta&&meta.id&&!meta.bot);
}
function closePlayerProfileModal(){
  const modal=$("playerProfileModal");
  if(modal) modal.classList.add("hidden");
}
async function openPlayerProfileModal(userId){
  if(netPhase!=="lobby"||spinning) return;
  const modal=$("playerProfileModal");
  if(!modal||!userId) return;
  const title=$("playerProfileTitle");
  const userEl=$("playerProfileUser");
  const pillsEl=$("playerProfilePills");
  const tenure=$("playerProfileTenure");
  const winRate=$("playerProfileWinRate");
  const wins=$("playerProfileWins");
  const games=$("playerProfileGames");
  const hint=$("playerProfileHint");
  const acts=$("playerProfileActs");
  const avShell=$("playerProfileAvShell");
  const avCore=$("playerProfileAvCore");
  const profileCard=modal.querySelector(".player-profile-card");
  function setProfileCosmetics(u){
    const eq=(u&&u.equipped)||{};
    const frameUseFx=!(eq.frame&&(eq.frame.useSystemEffect===false||(eq.frame.meta&&eq.frame.meta.useSystemEffect===false)));
    const effectUseFx=!(eq.effect&&(eq.effect.useSystemEffect===false||(eq.effect.meta&&eq.effect.meta.useSystemEffect===false)));
    const frameCls=(frameUseFx&&eq.frame&&eq.frame.cssClass)?String(eq.frame.cssClass):"";
    const effectCls=(effectUseFx&&eq.effect&&eq.effect.cssClass)?String(eq.effect.cssClass):"";
    const frameImg=(eq.frame&&(eq.frame.imageUrl||(eq.frame.meta&&eq.frame.meta.imageUrl)))?String(eq.frame.imageUrl||eq.frame.meta.imageUrl):"";
    const effectImg=(eq.effect&&(eq.effect.imageUrl||(eq.effect.meta&&eq.effect.meta.imageUrl)))?String(eq.effect.imageUrl||eq.effect.meta.imageUrl):"";
    if(profileCard){
      profileCard.className="modal-card player-profile-card"+(frameCls?" "+frameCls:"")+(frameImg?" has-media":"");
      profileCard.querySelectorAll(".cosmetic-frame-media").forEach(el=>el.remove());
      if(frameImg){
        const img=document.createElement("img");
        img.className="cosmetic-frame-media";
        img.src=frameImg;
        img.alt="";
        img.decoding="async";
        profileCard.prepend(img);
      }
    }
    if(avShell){
      avShell.className="player-profile-av-shell";
    }
    if(avCore){
      avCore.className="player-profile-av-core"+(effectCls?" "+effectCls:"")+(effectImg?" has-media":"");
      avCore.querySelectorAll(".cosmetic-effect-media").forEach(el=>el.remove());
      if(effectImg){
        const img=document.createElement("img");
        img.className="cosmetic-effect-media";
        img.src=effectImg;
        img.alt="";
        img.decoding="async";
        avCore.prepend(img);
      }
    }
  }
  function setProfileAv(src, letter){
    if(!avCore) return;
    let node=$("playerProfileAv");
    if(src){
      if(!node||node.tagName!=="IMG"){
        const img=document.createElement("img");
        img.id="playerProfileAv";
        img.className="player-profile-av";
        img.alt="";
        img.referrerPolicy="no-referrer";
        if(node) node.replaceWith(img); else avCore.appendChild(img);
        node=img;
      }
      node.className="player-profile-av";
      node.src=src;
    }else{
      if(!node||node.tagName==="IMG"){
        const div=document.createElement("div");
        div.id="playerProfileAv";
        div.className="player-profile-av ph";
        div.setAttribute("aria-hidden","true");
        if(node) node.replaceWith(div); else avCore.appendChild(div);
        node=div;
      }
      node.className="player-profile-av ph";
      node.textContent=letter||"?";
    }
  }
  function paintPills(u){
    if(!pillsEl) return;
    pillsEl.innerHTML="";
    const eq=(u&&u.equipped)||{};
    const gender=u&&u.gender?String(u.gender):"";
    pillsEl.appendChild(makeNvPill(genderLabelOf(gender), "gender"+(gender?" gender-"+gender:"")));
    pillsEl.appendChild(makeNvPill(u&&u.age!=null&&u.age!==""?String(u.age):"—", "age"));
    const titleList=(eq.titles&&eq.titles.length)
      ? eq.titles
      : [].concat(eq.title||[], Array.isArray(eq.extraTitles)?eq.extraTitles:[]).filter(Boolean);
    if(!titleList.length){
      pillsEl.appendChild(makeNvPill("—", "title"));
    }else{
      titleList.forEach(function(t){
        const titleName=(t&&t.name)||"—";
        const titleClass=(t&&t.cssClass)||"";
        const titlePill=makeNvPill(titleName, "title"+(titleClass?" "+titleClass:""));
        const titleColor=(t&&t.meta&&t.meta.color)?String(t.meta.color):"";
        if(titleColor){
          titlePill.style.borderColor=titleColor;
          titlePill.style.color=titleColor;
          titlePill.style.boxShadow="0 0 10px "+titleColor+"44";
        }
        pillsEl.appendChild(titlePill);
      });
    }
    const adminLabel=adminRoleLabel(u&&u.roles);
    if(adminLabel) pillsEl.appendChild(makeNvPill(adminLabel, "admin"));
  }
  if(title) title.textContent="กำลังโหลด…";
  if(userEl) userEl.textContent="@—";
  if(pillsEl) pillsEl.innerHTML="";
  if(tenure) tenure.textContent="—";
  if(winRate) winRate.textContent="—";
  if(wins) wins.textContent="—";
  if(games) games.textContent="—";
  if(hint) hint.textContent="";
  if(acts) acts.innerHTML="";
  setProfileCosmetics(null);
  setProfileAv(null,"?");
  modal.classList.remove("hidden");
  let data=null;
  try{
    const res=await fetch("/api/v1/users/"+encodeURIComponent(userId)+"/public",{
      method:"GET",credentials:"same-origin",headers:{Accept:"application/json"}
    });
    data=await res.json().catch(()=>({}));
    if(!res.ok){
      if(title) title.textContent="โหลดโปรไฟล์ไม่ได้";
      if(hint) hint.textContent=(data&&data.error)||"ลองใหม่อีกครั้ง";
      return;
    }
  }catch(e){
    if(title) title.textContent="โหลดโปรไฟล์ไม่ได้";
    if(hint) hint.textContent="เครือข่ายมีปัญหา";
    return;
  }
  if(netPhase!=="lobby"){ closePlayerProfileModal(); return; }
  const u=data.user||{};
  const st=data.stats;
  const rel=data.relation||{status:"none"};
  if(title) title.textContent=String(u.displayName||u.username||"ผู้เล่น").trim()||"ผู้เล่น";
  if(userEl){
    const uname=String(u.username||"").trim();
    userEl.textContent=uname?("@"+uname):"@—";
  }
  paintPills(u);
  setProfileCosmetics(u);
  setProfileAv(u.avatarUrl||null, String(u.displayName||"?").slice(0,1).toUpperCase());
  if(tenure) tenure.textContent=formatAccountTenure(u.createdAt);
  if(st){
    if(winRate) winRate.textContent=(st.winRate!=null?st.winRate:0)+"%";
    if(wins) wins.textContent=String(st.gamesWon||0);
    if(games) games.textContent=String(st.totalGames||0);
  }else{
    if(winRate) winRate.textContent="ซ่อน";
    if(wins) wins.textContent="—";
    if(games) games.textContent="—";
    if(hint) hint.textContent="ผู้เล่นซ่อนสถิติสาธารณะ";
  }
  if(!acts) return;
  acts.innerHTML="";
  const mk=(label,cls)=>{
    const b=document.createElement("button");
    b.type="button";
    b.className="btn"+(cls?" "+cls:"")+" sm";
    b.textContent=label;
    return b;
  };
  if(rel.status==="self"){
    if(hint) hint.textContent="นี่คือคุณ";
    return;
  }
  const inRoomPeer=playerMeta.some(p=>p&&p.id===userId&&!p.bot&&p.connected);
  if(inRoomPeer&&canUseFriends()){
    const whisper=mk("แชทส่วนตัว","ghost");
    whisper.onclick=()=>{
      closePlayerProfileModal();
      setRoomChatTarget(userId);
    };
    acts.appendChild(whisper);
  }
  if(!canUseFriends()){
    if(hint) hint.textContent="เข้าสู่ระบบด้วยบัญชีจริงเพื่อเพิ่มเพื่อน";
    return;
  }
  if(rel.status==="blocked"){
    if(hint) hint.textContent=rel.blockedByMe?"คุณบล็อกผู้เล่นคนนี้ไว้":"ไม่สามารถเพิ่มเพื่อนได้";
    if(rel.blockedByMe){
      const un=mk("อันบล็อก","ghost");
      un.onclick=async()=>{
        un.disabled=true;
        try{
          const res=await fetch("/api/v1/friends/"+encodeURIComponent(userId)+"/block",{
            method:"DELETE",credentials:"same-origin",headers:{Accept:"application/json"}
          });
          if(res.ok) openPlayerProfileModal(userId);
          else if(hint) hint.textContent="ปลดบล็อกไม่สำเร็จ";
        }catch(e){ if(hint) hint.textContent="ปลดบล็อกไม่สำเร็จ"; }
      };
      acts.appendChild(un);
    }
    return;
  }
  if(rel.status==="friends"){
    if(hint) hint.textContent="เป็นเพื่อนกันแล้ว";
    return;
  }
  if(rel.status==="outgoing"){
    if(hint) hint.textContent="ส่งคำขอแล้ว รอตอบรับ";
    return;
  }
  if(rel.status==="incoming"&&rel.friendshipId){
    if(hint) hint.textContent="มีคำขอเป็นเพื่อนถึงคุณ";
    const acc=mk("รับเพื่อน");
    acc.onclick=async()=>{
      acc.disabled=true;
      try{
        const res=await fetch("/api/v1/friends/"+encodeURIComponent(rel.friendshipId)+"/accept",{
          method:"POST",credentials:"same-origin",
          headers:{Accept:"application/json","Content-Type":"application/json"},
          body:"{}"
        });
        if(res.ok) openPlayerProfileModal(userId);
        else if(hint) hint.textContent="รับเพื่อนไม่สำเร็จ";
      }catch(e){ if(hint) hint.textContent="รับเพื่อนไม่สำเร็จ"; }
    };
    const dec=mk("ปฏิเสธ","ghost");
    dec.onclick=async()=>{
      dec.disabled=true;
      try{
        await fetch("/api/v1/friends/"+encodeURIComponent(rel.friendshipId)+"/decline",{
          method:"POST",credentials:"same-origin",
          headers:{Accept:"application/json","Content-Type":"application/json"},
          body:"{}"
        });
        openPlayerProfileModal(userId);
      }catch(e){ openPlayerProfileModal(userId); }
    };
    acts.append(acc,dec);
    return;
  }
  const add=mk("เพิ่มเพื่อน");
  add.onclick=async()=>{
    add.disabled=true;
    try{
      const res=await fetch("/api/v1/friends/request",{
        method:"POST",credentials:"same-origin",
        headers:{Accept:"application/json","Content-Type":"application/json"},
        body:JSON.stringify({userId})
      });
      const body=await res.json().catch(()=>({}));
      if(res.ok){
        openPlayerProfileModal(userId);
      }else{
        const map={
          already_friends:"เป็นเพื่อนกันอยู่แล้ว",
          request_pending:"มีคำขอค้างอยู่แล้ว",
          user_blocked:"บล็อกอยู่",
          registered_required:"ต้องเข้าสู่ระบบก่อน",
          user_not_found:"ไม่พบผู้เล่น"
        };
        if(hint) hint.textContent=map[body.error]||body.error||"ส่งคำขอไม่สำเร็จ";
        add.disabled=false;
      }
    }catch(e){
      if(hint) hint.textContent="ส่งคำขอไม่สำเร็จ";
      add.disabled=false;
    }
  };
  acts.appendChild(add);
}
function paintInviteBtn(){
  // Invite opens from empty lobby "+" slots only.
  if(netPhase==="lobby") renderLobbyGrid();
}
async function loadFriendsCache(){
  if(!canUseFriends()){ friendsCache=[]; return []; }
  try{
    const res=await fetch("/api/v1/friends",{method:"GET",credentials:"same-origin",headers:{Accept:"application/json"}});
    if(!res.ok){ friendsCache=[]; return []; }
    const data=await res.json();
    friendsCache=(data.friends||[]).map(f=>f.user).filter(Boolean);
    return friendsCache;
  }catch(e){
    friendsCache=[];
    return [];
  }
}
function openInviteModal(){
  if(!canUseFriends()||netPhase!=="lobby"||spectating) return;
  const modal=$("inviteModal");
  const msg=$("inviteModalMsg");
  if(!modal) return;
  if(msg) msg.textContent="";
  modal.classList.remove("hidden");
  renderInviteFriendList();
  send({t:"friendsOnline"});
  loadFriendsCache().then(()=>renderInviteFriendList());
}
function closeInviteModal(){
  const modal=$("inviteModal");
  if(modal) modal.classList.add("hidden");
}
function openSkipTargetModal(){
  if(spectating||(netPhase!=="play"&&netPhase!=="snake")) return;
  const modal=$("skipTargetModal");
  if(!modal) return;
  const tip=$("skipTargetMsg");
  if(tip) tip.textContent="";
  modal.classList.remove("hidden");
  renderSkipTargetList();
}
function closeSkipTargetModal(){
  const modal=$("skipTargetModal");
  if(modal) modal.classList.add("hidden");
}
function renderSkipTargetList(){
  const box=$("skipTargetList");
  const empty=$("skipTargetEmpty");
  if(!box) return;
  box.textContent="";
  let list=[];
  if(netPhase==="play"){
    list=(playerMeta||[]).filter(p=>p&&p.id&&!p.bot&&(alive||[]).includes(p.name));
  }else if(netPhase==="snake"){
    list=(playerMeta||[]).filter(p=>p&&p.id&&!p.bot);
  }
  if(empty) empty.classList.toggle("hidden", list.length>0);
  list.forEach(u=>{
    const li=document.createElement("li");
    const meta=document.createElement("div");
    meta.className="meta";
    if(u.avatarUrl){
      const img=document.createElement("img");
      img.src=u.avatarUrl;
      img.alt="";
      img.referrerPolicy="no-referrer";
      meta.appendChild(img);
    }else{
      const ph=document.createElement("span");
      ph.className="ph";
      ph.textContent=(u.name||"?").slice(0,1).toUpperCase();
      meta.appendChild(ph);
    }
    const nm=document.createElement("span");
    nm.className="name";
    nm.textContent=(u.name||"")+(u.id===myId?" (คุณ)":"")+(u.skipNextTurn?" · จะข้าม":"");
    meta.appendChild(nm);
    const btn=document.createElement("button");
    btn.type="button";
    btn.className="btn";
    btn.textContent="ข้าม";
    btn.disabled=!!u.skipNextTurn;
    btn.onclick=()=>{
      send({t:"useHelper",itemId:"item.skip",targetUserId:u.id});
      const tipEl=$("skipTargetMsg");
      if(tipEl) tipEl.textContent="กำลังใช้…";
      btn.disabled=true;
    };
    li.append(meta,btn);
    box.appendChild(li);
  });
}
function renderInviteFriendList(){
  const box=$("inviteFriendList");
  const empty=$("inviteEmpty");
  if(!box) return;
  box.textContent="";
  const inRoom=new Set(playerMeta.map(p=>p&&p.id).filter(Boolean));
  const candidates=friendsCache.filter(u=>u&&u.id&&!inRoom.has(u.id));
  const online=candidates.filter(u=>onlineFriendIds.has(u.id));
  const offline=candidates.filter(u=>!onlineFriendIds.has(u.id));
  if(empty){
    empty.textContent=candidates.length?"เพื่อนออนไลน์จะเชิญได้ทันที":"ยังไม่มีเพื่อนที่ยอมรับแล้ว";
    empty.classList.toggle("hidden", online.length>0);
  }
  const paintRow=(u, isOnline)=>{
    const li=document.createElement("li");
    if(!isOnline) li.classList.add("is-offline");
    const meta=document.createElement("div");
    meta.className="meta";
    if(u.avatarUrl){
      const img=document.createElement("img");
      img.src=u.avatarUrl;
      img.alt="";
      img.referrerPolicy="no-referrer";
      meta.appendChild(img);
    }else{
      const ph=document.createElement("span");
      ph.className="ph";
      ph.textContent=(u.displayName||"?").slice(0,1).toUpperCase();
      meta.appendChild(ph);
    }
    const nm=document.createElement("span");
    nm.className="name";
    nm.textContent=u.displayName||"";
    meta.appendChild(nm);
    const btn=document.createElement("button");
    btn.type="button";
    btn.className="btn";
    if(isOnline){
      btn.textContent="เชิญ";
      btn.onclick=()=>{
        send({t:"inviteFriend",friendUserId:u.id});
        const tip=$("inviteModalMsg");
        if(tip) tip.textContent="ส่งคำเชิญแล้ว";
      };
    }else{
      btn.textContent="ออฟไลน์";
      btn.disabled=true;
    }
    li.append(meta,btn);
    box.appendChild(li);
  };
  online.forEach(u=>paintRow(u, true));
  offline.forEach(u=>paintRow(u, false));
}
function showRoomInvite(msg){
  pendingRoomInvite=msg;
  const banner=$("roomInviteBanner");
  if(!banner) return;
  const av=$("roomInviteAvatar");
  if(av){
    if(msg.fromAvatar){
      av.src=msg.fromAvatar;
      av.classList.add("on");
    }else{
      av.removeAttribute("src");
      av.classList.remove("on");
    }
  }
  const from=$("roomInviteFrom");
  const room=$("roomInviteRoom");
  if(from) from.textContent=(msg.fromName||"เพื่อน")+" ชวนคุณเข้าห้อง";
  if(room) room.textContent=msg.roomTitle||"ห้องส่วนตัว";
  banner.classList.remove("hidden");
}
function hideRoomInvite(){
  pendingRoomInvite=null;
  const banner=$("roomInviteBanner");
  if(banner) banner.classList.add("hidden");
}
async function ensureAuth(){
  if(authBoot) return authBoot;
  authBoot=(async()=>{
    try{
      const res=await fetch("/api/v1/auth/guest",{method:"POST",credentials:"same-origin",headers:{"Accept":"application/json"}});
      if(!res.ok){
        paintAuthBar(null);
        return null;
      }
      const data=await res.json();
      authUser=data&&data.user?data.user:null;
      paintAuthBar(authUser);
      if(authUser&&authUser.id){
        try{
          localStorage.setItem("dpn-token", authUser.id);
          sessionStorage.setItem("dpn-token", authUser.id);
        }catch(e){}
        if(window.NVBan&&window.NVBan.clearBanNotice) window.NVBan.clearBanNotice();
        if(authUser.displayName&&!localStorage.getItem("dpn-name")){
          localStorage.setItem("dpn-name", authUser.displayName);
          if($("myName")&&!$("myName").value) $("myName").value=authUser.displayName;
        }
      }
      return authUser;
    }catch(e){
      paintAuthBar(null);
      return null;
    }
  })();
  return authBoot;
}
function myToken(){
  // Keep one identity across dashboard + play so reconnect finds the same seat/scores.
  let token=localStorage.getItem("dpn-token")||sessionStorage.getItem("dpn-token")||"";
  if(!token||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)){
    token=crypto.randomUUID();
  }
  try{
    localStorage.setItem("dpn-token", token);
    sessionStorage.setItem("dpn-token", token);
  }catch(e){}
  return token;
}
function typedName(){
  if(authUser&&authUser.accountType==="registered"){
    const profile=String(authUser.displayName||authUser.username||"").trim().replace(/\s+/g," ").slice(0,24);
    if(profile){
      setLocalName(profile);
      return profile;
    }
  }
  const input=$("myName");
  const name=(input?input.value:localStorage.getItem("dpn-name")||"").trim().replace(/\s+/g," ").slice(0,24);
  if(name) localStorage.setItem("dpn-name", name);
  return name;
}
function setLocalName(name){
  const clean=String(name||"").trim().replace(/\s+/g," ").slice(0,24);
  if(!clean) return "";
  const input=$("myName");
  if(input) input.value=clean;
  localStorage.setItem("dpn-name", clean);
  return clean;
}
function openRenameRoom(){
  if(!isHost()||netPhase!=="lobby") return;
  const cur=($("roomTitleText").textContent||"").trim();
  $("renameRoomInput").value=cur==="ห้องใหม่"?"":cur;
  $("renameRoomForm").classList.remove("hidden");
  $("renameRoomInput").focus();
  $("renameRoomInput").select();
}
function closeRenameRoom(){
  $("renameRoomForm").classList.add("hidden");
}
function submitRenameRoom(raw){
  const title=String(raw||"").trim().replace(/\s+/g," ").slice(0,32);
  if(!title){ showErr("ใส่ชื่อห้องก่อน"); return; }
  if(!isHost()||netPhase!=="lobby"){ showErr("เปลี่ยนชื่อห้องได้เฉพาะโฮสต์ตอนอยู่ในล็อบบี้"); return; }
  send({t:"renameRoom",title});
  closeRenameRoom();
}
function openCodeModal(hint){
  $("codeModalHint").textContent=hint||"ใส่รหัสห้อง 6 หลักเพื่อเข้า";
  $("codeModalMsg").textContent="";
  $("codeModalInput").value="";
  $("codeModal").classList.remove("hidden");
  $("codeModalInput").focus();
}
function closeCodeModal(){
  $("codeModal").classList.add("hidden");
  $("codeModalMsg").textContent="";
}
const GUIDE={
  room:`<section><h4>เริ่มต้นใช้งาน</h4><ul>
<li>NUMVERSE เป็นจุดรวมบอร์ดเกม — สร้างหรือเข้าห้องจาก <b>Dashboard → My Rooms / Game Library</b></li>
<li>สร้างห้อง Public/Private หรือใส่รหัส 6 หลักเพื่อเข้า</li>
<li>หน้านี้ใช้ตอนอยู่ในห้องแล้วเท่านั้น</li>
</ul></section>
<section><h4>ตั้งค่าห้อง (โฮสต์)</h4><ul>
<li>เฉพาะโฮสต์ตั้งค่าและเริ่มเกมได้</li>
<li>เลือกเกมกระดานจากที่มีในคลัง (เช่น หาเลข · วงล้อ · บันไดงู · Imposter)</li>
<li>ตั้งกติกาตามเกมที่เลือก เช่น ช่วงตัวเลข / แต้มชนะ / แมพกระดาน / นับถอยหลังต่อตา</li>
<li>กด <b>เพิ่มบอท</b> ได้ถ้าคนไม่ครบ (ล็อบบี้เท่านั้น)</li>
<li>กดเฟืองตั้งค่าเพื่อเปลี่ยนชื่อห้อง / กติกา (ล็อบบี้เท่านั้น)</li>
<li>กด <b>โอน</b> บนการ์ดผู้เล่นเพื่อโอนโฮสต์ (ล็อบบี้เท่านั้น)</li>
<li>กด <b>สุ่มลำดับ</b> แล้วค่อยเริ่มเกม</li>
</ul></section>
<section><h4>เชิญเพื่อน &amp; แชท</h4><ul>
<li>ในล็อบบี้ กดช่องว่าง <b>+</b> เพื่อเชิญเพื่อนที่ออนไลน์เข้าห้องได้ทันที</li>
<li>แชทในห้องใช้ได้เมื่อเข้าสู่ระบบด้วยบัญชีจริง — ส่งถึงทุกคนหรือเฉพาะบางคนได้</li>
<li>ที่ Dashboard → เพื่อน สามารถปิดเสียงแชทรายคนได้</li>
</ul></section>
<section><h4>ไอเทมในกระเป๋า</h4><ul>
<li>ซื้อไอเทมได้ที่ <b>Shop</b> ด้วย pts · ดูประวัติได้ที่ <b>ประวัติ pts</b></li>
<li>ในล็อบบี้กด <b>ไอเทม</b> เพื่อเปิดกระเป๋า</li>
<li><b>การ์ดนางฟ้า</b> · <b>เลขคู่/คี่</b> ใช้ก่อนเริ่มเกม · นางฟ้าใช้ไม่ได้ใน Imposter</li>
<li><b>Skip Turn</b> · <b>วางบอม</b> ใช้ระหว่างเกม (มีปุ่มกระเป๋าในเกม)</li>
</ul></section>
<section><h4>ห้องส่วนตัว</h4><ul>
<li>โชว์ในล็อบบี้ออนไลน์แบบล็อก 🔒 แต่ไม่โชว์รหัส</li>
<li>เพื่อนต้องกด “ใส่รหัส” แล้วกรอกรหัส 6 หลัก หรือรับคำเชิญจากเพื่อน</li>
<li>โฮสต์แชร์รหัสจากแถบบนของห้องได้</li>
</ul></section>`
};
const GUIDE_GAMES={
  secret:`<section><h4>ห้ามโดนเลขลับ</h4><ul>
<li>ระบบสุ่มเลขลับตามจำนวนที่ตั้งไว้</li>
<li>ผู้เล่นผลัดกันเลือกเลขในช่วงที่เหลือ</li>
<li>ใครโดนเลขลับจะหลุดจากเทิร์น</li>
<li>คนที่อยู่รอดจนจบรอบได้แต้ม ตามกติกาที่โฮสต์ตั้ง</li>
<li>ใครถึงแต้มที่ชนะก่อนเป็นผู้ชนะ</li>
<li><b>Skip Turn</b> ใช้ข้ามเทิร์นตัวเองหรือคนอื่นได้ระหว่างเกม</li>
<li><b>การ์ดนางฟ้า</b> กันแพ้ 1 ครั้ง (ใช้คู่กับ Skip ได้)</li>
<li>กด <b>เล่นอัตโนมัติ</b> ได้ · หมดเวลานับถอยหลังระบบจะเปิดออโต้ให้</li>
</ul></section>`,
  wheel:`<section><h4>วงล้อสุ่มเลข</h4><ul>
<li>แต่ละคนเลือกเลขของตัวเองตามจำนวนที่กำหนด</li>
<li>โฮสต์เริ่มหมุนวงล้อ สุ่มเลขจากที่ยังเหลือบนวงล้อ</li>
<li>เลขที่ออกจะถูกตัดออกจากวงล้อทันที แล้วหมุนต่อ</li>
<li>ถ้าวงล้อลงเลขของใคร คนนั้นออก</li>
<li>คนสุดท้ายที่เหลือได้แต้ม</li>
<li><b>Skip Turn</b> ติดเกราะละเว้นตัวเองเมื่อเลขตก · ใช้คู่กับนางฟ้าได้</li>
<li>กด <b>เล่นอัตโนมัติ</b> ได้ · หมดเวลานับถอยหลังระบบจะเปิดออโต้ให้</li>
</ul></section>`,
  snake:`<section><h4>บันไดงู</h4><ul>
<li>ทอยลูกเต๋าปีนบันได เลี่ยงงู · ถึงช่อง 100 ชนะ · ผู้เล่น 2–6 คน</li>
<li>เลือกแมพได้ตอนตั้งค่าห้อง (งู/บันไดอยู่คนละตำแหน่ง)</li>
<li><b>การ์ดนางฟ้า</b> กันไหลลงงูได้ 3 ครั้งต่อเกม · กันระเบิดได้ (ใช้ชาร์จ 1)</li>
<li><b>เลขคู่/คี่</b> ใช้ก่อนเริ่ม → ได้ปุ่มบังคับทอยคู่หรือคี่ 5 ครั้งต่อเกม</li>
<li><b>Skip Turn</b> ข้ามเทิร์นตัวเองหรือคนอื่นได้ระหว่างเกม</li>
<li><b>วางบอม</b> เลือกช่อง 1–99 · เหยียบแล้วสุ่มถอยสูงสุด 6 หรือ Pause สูงสุด 3 เทิร์น</li>
<li>ระหว่างเกมกดปุ่ม <b>🎒 ไอเทม</b> เพื่อใช้ Skip Turn / วางบอม</li>
<li>กด <b>เล่นอัตโนมัติ</b> ได้ · AFK เกิน 15 วินาทีระบบจะเปิดออโต้ให้ (หรือตามเวลาที่โฮสต์ตั้ง)</li>
</ul></section>`,
  imposter:`<section><h4>Imposter</h4><ul>
<li>ผู้เล่น 4–8 คน จั่วการ์ดปิดตาทีละคน ได้บทบาททีมปกติหรือ Imposter</li>
<li>โฮสต์เลือกหมวดคำได้เมื่อเปิดให้ Imposter เห็นหมวด หรือสุ่มทุกหมวด</li>
<li>ทีมปกติเห็นคำศัพท์ · Imposter ไม่เห็นคำ หรือเห็นแค่หมวด ถ้าโฮสต์เปิดไว้</li>
<li>ให้คำใบ้ทีละคน วนจากคนแรกถึงคนท้ายตามจำนวนรอบที่ตั้ง แล้วค่อยคุยและโหวตครั้งเดียว</li>
<li>คำใบ้ห้ามพิมพ์คำศัพท์ตรงๆ · หมดเวลาหรือกดข้ามได้</li>
<li>ช่วงคุยใช้แชทในห้อง · แชทใช้ได้ตลอดเกมเหมือนเกมอื่น ต้องเข้าสู่ระบบด้วยบัญชีจริง</li>
<li>โหวตคนที่สงสัย โหวตตัวเองไม่ได้ · ไม่โหวตถือว่างดออกเสียง</li>
<li>โหวตผิด โหวตเสมอ หรือ Imposter เหลือเท่ากับหรือมากกว่าทีมปกติ ฝ่าย Imposter ชนะ และไม่กลับไปใบ้ใหม่</li>
<li>จับ Imposter ได้แต่ยังเหลืออีกคน จะเริ่มให้คำใบ้รอบใหม่</li>
<li>จับ Imposter คนสุดท้ายได้ ต้องทายคำใน 30 วินาที ทายถูก Imposter ชนะ ทายผิดหรือหมดเวลาทีมปกติชนะ</li>
<li>การ์ดนางฟ้าใช้ในเกมนี้ไม่ได้</li>
</ul></section>`,
  cardmemory:`<section><h4>Memory Card</h4><ul>
<li>ผู้เล่น 2–8 คน เปิดการ์ดทีละ 2 ใบ จำตำแหน่งแล้วจับคู่ภาพที่เหมือนกัน</li>
<li>โฮสต์เลือกขนาดกระดานได้ตั้งแต่ 4×4 ถึง 12×10</li>
<li>จับคู่ถูกได้คะแนน และเล่นต่อ หรือเปลี่ยนคน ตามที่โฮสต์ตั้ง</li>
<li>จับคู่ผิดการ์ดจะคว่ำกลับ แล้วเปลี่ยนเทิร์น หรือให้ลองอีกครั้งเดียว</li>
<li>คอมโบเพิ่มเมื่อจับคู่ติดกัน เปิดผิดแล้วคอมโบกลับเป็น 0</li>
<li>จับคู่ครบคนคะแนนสูงสุดชนะ ถ้าคะแนนเท่ากันดูจำนวนคู่ แล้วดูว่าใครทำคะแนนได้ก่อน</li>
<li>เซิร์ฟเวอร์เป็นคนสุ่มการ์ดและตัดสินผล การ์ดที่ยังคว่ำอยู่จะไม่ส่งภาพให้เครื่องผู้เล่น</li>
</ul></section>`,
  werewolf:`<section><h4>Werewolf</h4><ul>
<li>ผู้เล่น 5–8 คน ได้บทบาทลับ: หมาป่า ชาวบ้าน ผู้หยั่งรู้ แม่มด ผู้พิทักษ์ นักล่า</li>
<li>กลางคืนใช้ความสามารถตามบทบาท · กลางวันคุยและโหวตกำจัดผู้ต้องสงสัย</li>
<li>หมาป่าเลือกเหยื่อ · ผู้พิทักษ์ปกป้อง · ผู้หยั่งรู้ตรวจตัวตน · แม่มดใช้ยาชุบ/พิษได้ชนิดละครั้ง</li>
<li>ฝ่ายหมู่บ้านชนะเมื่อหมาป่าถูกกำจัดครบ · ฝ่ายหมาป่าชนะเมื่อจำนวนหมาป่าไม่น้อยกว่าฝ่ายตรงข้าม</li>
<li>นักล่าเมื่อถูกกำจัดสามารถยิงผู้เล่นอีกคนได้ทันที</li>
<li>ผู้เล่นที่ตายแล้วแชทกับคนที่มีชีวิตไม่ได้ · การ์ดนางฟ้าใช้ไม่ได้</li>
</ul></section>`
};
const GUIDE_TITLES={
  secret:"คู่มือหาเลข",
  wheel:"คู่มือวงล้อ",
  snake:"คู่มือบันไดงู",
  imposter:"คู่มือ Imposter",
  cardmemory:"คู่มือ Memory Card",
  werewolf:"คู่มือ Werewolf"
};
function guideGameId(){
  if(gameCat==="wheel"||gameCat==="snake"||gameCat==="imposter"||gameCat==="cardmemory"||gameCat==="werewolf"||gameCat==="secret") return gameCat;
  return "secret";
}
function renderGuide(cat){
  const game=guideGameId();
  const play=cat==="play";
  const title=$("guideTitle");
  if(title) title.textContent=play?(GUIDE_TITLES[game]||"คู่มือการเล่น"):"การใช้งานตั้งค่าห้อง";
  $("guideBody").innerHTML=play?(GUIDE_GAMES[game]||GUIDE_GAMES.secret):GUIDE.room;
  const tabs=$("guideTabs");
  if(!tabs) return;
  for(const btn of tabs.children){
    const on=btn.dataset.guide===(play?"play":"room");
    btn.classList.toggle("on",on);
    btn.setAttribute("aria-pressed",on?"true":"false");
    if(btn.dataset.guide==="play") btn.textContent=GUIDE_TITLES[game]||"คู่มือการเล่น";
  }
}
function openGuide(cat){
  const inGame=netPhase==="play"||netPhase==="pick"||netPhase==="wheel"||netPhase==="snake"||netPhase==="imposter"||netPhase==="cardmemory"||netPhase==="werewolf"||netPhase==="over";
  renderGuide(cat||(inGame?"play":"room"));
  $("guideModal").classList.remove("hidden");
}
function closeGuide(){
  $("guideModal").classList.add("hidden");
}
function send(obj){
  if(sock&&sock.readyState===1) sock.send(JSON.stringify(obj));
}
function showGate(){
  if(pendingAction||enterIntent){
    show("gate");
    return;
  }
  wantRoom=false;
  enterIntent=false;
  roomCode="";
  netPhase="gate";
  myId="";
  hostId="";
  myTurn=false;
  myAuto=false;
  turnEndsAt=0;
  lastCooldownSec=-1;
  paintTurnClock();
  paintAutoButtons();
  closeRenameRoom();
  closeCodeModal();
  closeGuide();
  document.title="NUMVERSE";
  location.replace("/app#rooms");
}
function leaveCurrentRoom(){
  if(spectating){
    clearActiveRoom();
    send({t:"unwatch"});
    location.replace("/app#rooms");
    return;
  }
  if(isHost()){
    showErr("โฮสต์ออกห้องไม่ได้ — ใช้ปุ่มลบห้อง หรือโอนโฮสต์ก่อน");
    return;
  }
  clearActiveRoom();
  enterIntent=false;
  wantRoom=false;
  send({t:"leave"});
}
function openQuitGameModal(){
  const inGame=netPhase==="play"||netPhase==="pick"||netPhase==="wheel"||netPhase==="snake"||netPhase==="imposter"||netPhase==="cardmemory"||netPhase==="werewolf"||netPhase==="over";
  if(!onlineMode||!inGame) return;
  const modal=$("quitGameModal");
  if(modal) modal.classList.remove("hidden");
}
function closeQuitGameModal(){
  const modal=$("quitGameModal");
  if(modal) modal.classList.add("hidden");
}
/** Quick exit during an active match (host included — server transfers host). */
function quitGameNow(){
  closeQuitGameModal();
  closePlayerProfileModal();
  closeWinnerModal();
  invalidateWheel();
  clearActiveRoom();
  enterIntent=false;
  wantRoom=false;
  pendingAction=null;
  if(spectating){
    send({t:"unwatch"});
  }else{
    send({t:"leave"});
  }
  // Fallback navigate if "left" is delayed/lost.
  setTimeout(()=>{
    if(netPhase!=="gate"&&!wantRoom) location.replace("/app#rooms");
  }, 600);
}
function showErr(message){
  if(netPhase==="gate"){
    const el=$("gateMsg");
    if(el) el.textContent=message;
    return;
  }
  if(screenOpen("start")) $("err").textContent=message;
  else if(screenOpen("play")) $("msg").textContent=message;
  else if(screenOpen("pick")) $("pickMsg").textContent=message;
  else $("perr").textContent=message;
}
function chooseNumber(n){
  if(!onlineMode){ pick(n); return; }
  if(!myTurn){ $("msg").textContent="ยังไม่ถึงตาคุณ"; return; }
  send({t:"pick",n:n});
}
function choosePick(n){
  if(!onlineMode){ pickNumber(n); return; }
  if(!myTurn){ $("pickMsg").textContent="ยังไม่ถึงตาคุณ"; return; }
  send({t:"pickNum",n:n});
}
let _snakeMapsCache=[];
function paintWordCategory(s){
  const sel=$("wordCategory");
  if(!sel) return;
  const cats=Array.isArray(s&&s.wordCategories)?s.wordCategories:[];
  const cur=String((s&&s.wordCategory)||sel.value||"all");
  if(document.activeElement===sel) return;
  const options=["all"].concat(cats.filter(name=>name&&name!=="all"));
  sel.innerHTML=options.map(name=>{
    const label=name==="all"?"สุ่มทุกหมวด":name;
    return `<option value="${escHtml(name)}">${escHtml(label)}</option>`;
  }).join("");
  sel.value=options.indexOf(cur)>=0?cur:"all";
  syncWordCategoryLock();
}
function syncWordCategoryLock(){
  const sel=$("wordCategory");
  if(!sel) return;
  const infoBtn=$("impostorInfoModes")&&$("impostorInfoModes").querySelector(".on[data-impostor-info]");
  const seesCategory=!!(infoBtn&&infoBtn.getAttribute("data-impostor-info")==="category");
  const hostCan=!onlineMode||(isHost()&&netPhase==="lobby");
  sel.disabled=!seesCategory||!hostCan;
}
function paintSnakeMapSelect(s){
  const sel=$("snakeMap");
  const hint=$("snakeMapHint");
  if(!sel) return;
  const maps=Array.isArray(s&&s.snakeMaps)&&s.snakeMaps.length
    ? s.snakeMaps
    : (_snakeMapsCache.length?_snakeMapsCache:[
        {id:"classic",name:"คลาสสิก",blurb:"แมพมาตรฐาน — งู/บันไดสมดุล"}
      ]);
  if(Array.isArray(s&&s.snakeMaps)&&s.snakeMaps.length) _snakeMapsCache=s.snakeMaps;
  const cur=String((s&&s.snakeMapId)||sel.value||"classic");
  const focus=document.activeElement===sel;
  if(!focus){
    sel.innerHTML=maps.map(m=>{
      const sn=m.snakeCount!=null?` · งู ${m.snakeCount}`:"";
      const ld=m.ladderCount!=null?` · บันได ${m.ladderCount}`:"";
      return `<option value="${escHtml(m.id)}">${escHtml(m.name)}${escHtml(sn+ld)}</option>`;
    }).join("");
    sel.value=maps.some(m=>m.id===cur)?cur:(maps[0]&&maps[0].id)||"classic";
  }
  const picked=maps.find(m=>m.id===sel.value)||maps[0];
  if(hint) hint.textContent=(picked&&picked.blurb)||"";
  paintSnakeMapPreviewBox(picked);
}
function paintSnakeMapPreviewBox(map){
  const host=$("snakeMapPreview");
  if(!host) return;
  if(window.NVSnake&&typeof window.NVSnake.paintSnakeMapPreview==="function"){
    window.NVSnake.paintSnakeMapPreview(host, map||null);
    return;
  }
  host.innerHTML=`<p class="tiny muted" style="margin:0">กำลังโหลดตัวอย่าง…</p>`;
}
function syncSetup(s){
  applyCat(s.cat||"secret");
  const custom=s.rangeMode==="custom";
  for(const x of $("modes").children){
    const on=custom?x.dataset.custom==="1":x.dataset.max===String(s.max)&&!x.dataset.custom;
    x.classList.toggle("on",!!on);
    x.setAttribute("aria-pressed",on?"true":"false");
  }
  useCustom=custom;
  $("custom").classList.toggle("hidden",!custom);
  pickMin=s.min;
  pickMax=s.max;
  if(document.activeElement!==$("cmin")) $("cmin").value=s.min;
  if(document.activeElement!==$("cmax")) $("cmax").value=s.max;
  if(document.activeElement!==$("winScore")) $("winScore").value=s.winTarget;
  if(document.activeElement!==$("turnSec")&&$("turnSec")) $("turnSec").value=Number.isInteger(s.turnSec)?s.turnSec:0;
  if(document.activeElement!==$("secretCount")) $("secretCount").value=s.secretCount;
  if(document.activeElement!==$("pickEach")) $("pickEach").value=s.pickEach;
  for(const x of $("restModes").children){
    const on=s.pointAll?x.dataset.rest==="all":x.dataset.rest==="last";
    x.classList.toggle("on",on);
    x.setAttribute("aria-pressed",on?"true":"false");
  }
  $("rangeLabel").textContent=s.min+"–"+s.max;
  paintSnakeMapSelect(s);
  const info=s.impostorInfo==="category"?"category":"none";
  const infoModes=$("impostorInfoModes");
  if(infoModes){
    for(const x of infoModes.children){
      const on=x.dataset.impostorInfo===info;
      x.classList.toggle("on",on);
      x.setAttribute("aria-pressed",on?"true":"false");
    }
  }
  if($("impostorCount")&&document.activeElement!==$("impostorCount")){
    $("impostorCount").value=Number(s.impostorCount)===2?"2":"1";
  }
  if($("clueRounds")&&document.activeElement!==$("clueRounds")){
    $("clueRounds").value=Math.min(99, Math.max(1, Number(s.clueRounds)||5));
  }
  if($("clueSec")&&document.activeElement!==$("clueSec")){
    $("clueSec").value=Number(s.clueSec)||45;
  }
  if($("discussionSec")&&document.activeElement!==$("discussionSec")){
    $("discussionSec").value=Number(s.discussionSec)||60;
  }
  if($("voteSec")&&document.activeElement!==$("voteSec")){
    $("voteSec").value=Number(s.voteSec)||45;
  }
  paintWordCategory(s);
  if($("memoryBoard")&&document.activeElement!==$("memoryBoard")) $("memoryBoard").value=s.memoryBoard||"4x4";
  if($("memoryTurnSec")&&document.activeElement!==$("memoryTurnSec")) $("memoryTurnSec").value=String(s.memoryTurnSec==null?20:s.memoryTurnSec);
  if($("memoryRevealMs")&&document.activeElement!==$("memoryRevealMs")) $("memoryRevealMs").value=String(s.memoryRevealMs||1500);
  if($("memoryPoints")&&document.activeElement!==$("memoryPoints")) $("memoryPoints").value=String(s.memoryPoints||100);
  if($("memoryOnMatch")&&document.activeElement!==$("memoryOnMatch")) $("memoryOnMatch").value=s.memoryOnMatch==="next"?"next":"continue";
  if($("memoryOnWrong")&&document.activeElement!==$("memoryOnWrong")) $("memoryOnWrong").value=s.memoryOnWrong==="retry"?"retry":"next";
  if($("memoryCombo")&&document.activeElement!==$("memoryCombo")) $("memoryCombo").value=s.memoryCombo===false?"0":"1";
  if($("wwNightSec")&&document.activeElement!==$("wwNightSec")) $("wwNightSec").value=String(s.wwNightSec||30);
  if($("wwDiscussionSec")&&document.activeElement!==$("wwDiscussionSec")) $("wwDiscussionSec").value=String(s.wwDiscussionSec||60);
  if($("wwVoteSec")&&document.activeElement!==$("wwVoteSec")) $("wwVoteSec").value=String(s.wwVoteSec||45);
  if($("wwTieRule")&&document.activeElement!==$("wwTieRule")) $("wwTieRule").value=s.wwTieRule==="random"?"random":"none";
  if($("wwAllowSelfProtect")&&document.activeElement!==$("wwAllowSelfProtect")) $("wwAllowSelfProtect").checked=s.wwAllowSelfProtect!==false;
}
function hostLocks(){
  if(!onlineMode){
    $("setup").classList.remove("locked");
    ["winScore","turnSec","secretCount","pickEach","cmin","cmax","snakeMap","impostorCount","clueRounds","clueSec","discussionSec","voteSec","memoryBoard","memoryTurnSec","memoryRevealMs","memoryPoints","memoryOnMatch","memoryOnWrong","memoryCombo","wwNightSec","wwDiscussionSec","wwVoteSec","wwTieRule","wwAllowSelfProtect"].forEach(id=>{ const el=$(id); if(el) el.disabled=false; });
    ["cats","modes","restModes","impostorInfoModes"].forEach(id=>{
      const wrap=$(id);
      if(!wrap) return;
      for(const btn of wrap.querySelectorAll("button")) btn.disabled=false;
    });
    syncWordCategoryLock();
    return;
  }
  const host=isHost();
  const lobby=netPhase==="lobby";
  const canSetup=host&&lobby;
  $("setup").classList.toggle("locked",!canSetup);
  $("setup").setAttribute("aria-disabled",canSetup?"false":"true");
  ["winScore","turnSec","secretCount","pickEach","cmin","cmax","snakeMap","impostorCount","clueRounds","clueSec","discussionSec","voteSec","memoryBoard","memoryTurnSec","memoryRevealMs","memoryPoints","memoryOnMatch","memoryOnWrong","memoryCombo","wwNightSec","wwDiscussionSec","wwVoteSec","wwTieRule","wwAllowSelfProtect"].forEach(id=>{
    const el=$(id);
    if(el) el.disabled=!canSetup;
  });
  ["cats","modes","restModes","impostorInfoModes"].forEach(id=>{
    const wrap=$(id);
    if(!wrap) return;
    for(const btn of wrap.querySelectorAll("button")) btn.disabled=!canSetup;
  });
  const setupSubmit=$("setup")&&($("setup").querySelector("button.btn[type='submit']")||$("setup").querySelector("button.btn"));
  if(setupSubmit){
    setupSubmit.disabled=!canSetup;
    setupSubmit.textContent="บันทึกการตั้งค่า";
  }
  ["leave","back","wheelLeave","pickLeave","snakeLeave","imposterLeave","memoryLeave","werewolfLeave"].forEach(id=>{
    const el=$(id);
    if(!el) return;
    // Spectators use quit (unwatch); hide host abort buttons.
    const showLeave=spectating?false:host;
    el.classList.toggle("hidden",!showLeave);
    el.textContent=(id==="imposterLeave"&&netPhase==="imposter")||(id==="werewolfLeave"&&netPhase==="werewolf")?"ตัดจบเกม · กลับห้อง":"กลับห้อง";
  });
  if($("quitGameBtn")){
    const inGame=netPhase==="play"||netPhase==="pick"||netPhase==="wheel"||netPhase==="snake"||netPhase==="imposter"||netPhase==="cardmemory"||netPhase==="werewolf"||netPhase==="over";
    $("quitGameBtn").classList.toggle("hidden",!(onlineMode&&inGame));
  }
  const canRenameRoom=host&&lobby&&!spectating;
  if($("renameRoomBtn")) $("renameRoomBtn").classList.toggle("hidden",!canRenameRoom);
  if($("settingsGearBtn")) $("settingsGearBtn").classList.toggle("hidden",!(host&&lobby&&!spectating));
  if(!canRenameRoom) closeRenameRoom();
  if(!(host&&lobby)||spectating) closeSettingsModal();
  syncWordCategoryLock();
}
function paintRoom(s){
  const code=s.code||"";
  const priv=s.visibility==="private";
  roomVisibility=priv?"private":"public";
  const count=(s.players||[]).filter(p=>p.connected).length;
  const max=s.maxPlayers||12;
  roomMaxPlayers=max;
  const title=s.roomLabel||s.title||(priv?"ห้องส่วนตัว":"ห้องสาธารณะ");
  if($("roomCode")) $("roomCode").textContent=code;
  if($("lobbyCode")) $("lobbyCode").textContent=code;
  if($("visBadge")){
    $("visBadge").textContent=priv?"🔒 ส่วนตัว":"สาธารณะ";
    $("visBadge").classList.toggle("private",priv);
  }
  if($("lobbyVis")){
    $("lobbyVis").textContent=priv?"Private":"Public";
    $("lobbyVis").classList.toggle("private",priv);
  }
  if($("roomCount")) $("roomCount").textContent=count+"/"+max;
  if($("lobbyPlayerCount")) $("lobbyPlayerCount").textContent=count+"/"+max+" Players";
  if($("roomNote")){
    $("roomNote").textContent=spectating
      ?"โหมด Spectator — ดูได้อย่างเดียว"
      :(priv?"":"ห้องนี้อยู่ในล็อบบี้ออนไลน์");
  }
  if($("roomTitleText")) $("roomTitleText").textContent=title;
  if($("settingsRoomTitle")) $("settingsRoomTitle").textContent=title;
  document.title=(code?code+" · ":"")+"NUMVERSE";
  const mine=(s.players||[]).find(p=>p.id===s.youId);
  if(mine&&mine.name) setLocalName(mine.name);
  paintInviteBtn();
}
function spinProgress(spin){
  const dur=Math.max(0, Number(spin&&spin.dur)||0);
  const left=Math.max(0, Number(spin&&spin.left)||0);
  const elapsed=dur?Math.min(dur, Math.max(0, dur-left)):0;
  const t=dur?Math.min(1, elapsed/dur):1;
  return {dur, left, elapsed, t, eased:1-Math.pow(1-t,3)};
}
function syncOrderWheel(s){
  const canvas=$("wheel");
  if(!canvas) return;
  canvas.style.transition="none";
  if(s.activeSpin&&s.activeSpin.kind==="order"){
    const from=Number.isFinite(s.activeSpin.from)?s.activeSpin.from:(s.orderRot||0);
    const target=s.activeSpin.rot||0;
    const {eased}=spinProgress(s.activeSpin);
    rot=from+(target-from)*eased;
  }else{
    rot=s.orderRot||0;
  }
  canvas.style.transform="rotate("+rot+"deg)";
}
function applySnap(s){
  wantRoom=true;
  enterIntent=false;
  applying=true;
  lastNetSnap=s||null;
  myId=s.youId||"";
  hostId=s.hostId||"";
  roomCode=s.code||"";
  netPhase=s.phase||"lobby";
  if(netPhase!=="imposter"&&imposterLive&&typeof imposterLive.halt==="function") imposterLive.halt();
  if(netPhase!=="cardmemory"&&memoryLive&&typeof memoryLive.halt==="function") memoryLive.halt();
  if(netPhase!=="werewolf"&&werewolfLive&&typeof werewolfLive.halt==="function") werewolfLive.halt();
  // Profile card is lobby-only — never stay open during play/pick/wheel/over.
  if(netPhase!=="lobby") closePlayerProfileModal();
  if(netPhase==="lobby"||netPhase==="gate") closeQuitGameModal();
  if(s.phase==="over") clearActiveRoom();
  else rememberActiveRoom(s.code);
  // Already seated (hello reattach) — drop matching pending join/watch/resume.
  if(pendingAction&&s.code&&(
    pendingAction.type==="resume"||
    (pendingAction.type==="join"&&pendingAction.code===s.code)||
    (pendingAction.type==="watch"&&pendingAction.code===s.code)
  )) pendingAction=null;
  myTurn=!!s.yourTurn;
  myAuto=!!s.youAuto;
  playerMeta=Array.isArray(s.players)?s.players:[];
  players=playerMeta.map(p=>p.name);
  scores={};
  playerMeta.forEach(p=>{ scores[p.name]=p.score||0; });
  order=Array.isArray(s.order)?s.order:[];
  alive=Array.isArray(s.alive)?s.alive:[];
  roundOrder=Array.isArray(s.roundOrder)?s.roundOrder:[];
  turn=s.turn||0;
  if(s.gameMin!==gameMin||s.gameMax!==gameMax) pageFrom=s.gameMin;
  gameMin=s.gameMin;
  gameMax=s.gameMax;
  lo=s.lo;
  hi=s.hi;
  const nextPicked=Array.isArray(s.picked)?s.picked:[];
  if(s.phase==="lobby"||!nextPicked.length) lastBombKey="";
  else if(s.phase==="play"||s.phase==="over") maybePlayBomb(nextPicked);
  picked=nextPicked;
  secrets=Array.from({length:s.secretsLeft||0});
  secretAll=Array.isArray(s.revealed)?s.revealed:[];
  secretTotal=s.secretTotal||1;
  winTarget=s.winTarget;
  pointAll=!!s.pointAll;
  if(s.wheelMin!==wheelMin||s.wheelMax!==wheelMax) pickFrom=s.wheelMin;
  wheelMin=s.wheelMin;
  wheelMax=s.wheelMax;
  wheelOrder=Array.isArray(s.wheelOrder)?s.wheelOrder:[];
  picks=s.picks&&typeof s.picks==="object"?s.picks:{};
  pickEach=s.pickEach||1;
  pickCursor=s.pickCursor||0;
  wheelAlive=Array.isArray(s.wheelAlive)?s.wheelAlive:[];
  wheelLog=Array.isArray(s.wheelLog)?s.wheelLog:[];
  wheelGone=Array.isArray(s.wheelGone)?s.wheelGone:[];
  syncTurnClock(s);
  if(s.activeSpin&&s.activeSpin.kind==="num"){
    const from=Number.isFinite(s.activeSpin.from)?s.activeSpin.from:(s.wheelRot||0);
    const target=Number.isFinite(s.activeSpin.target)?s.activeSpin.target:from;
    const {eased}=spinProgress(s.activeSpin);
    wheelRot=from+(target-from)*eased;
  }else{
    wheelRot=s.wheelRot||0;
  }
  syncSetup(s);
  paintRoom(s);
  if(s.phase==="lobby"){
    resetWinCelebration();
    show("start");
    drawWheel();
    syncOrderWheel(s);
    renderPlayers();
    renderTurn();
    $("winner").textContent=s.activeSpin&&s.activeSpin.kind==="order"?"กำลังสุ่มลำดับ…":wheelMessage();
  }else if(s.phase==="play"){
    show("play");
    $("modeLabel").textContent="ช่วง "+gameMin+"–"+gameMax+" · เลขลับ "+secretTotal+" ตัว · ถึง "+winTarget+" แต้มชนะ · "+(pointAll?"เหลือหลายคนได้แต้ม ยกเว้นคนที่โดน":"เหลือหลายคนได้แต้มคนสุดท้าย");
    const last=picked[picked.length-1];
    $("msg").textContent=last&&last.hit?last.who+" โดนเลขลับ หลุดจากเทิร์น":"";
    render();
  }else if(s.phase==="pick"){
    show("pick");
    $("pickMode").textContent="ช่วง "+wheelMin+"–"+wheelMax+" · คนละ "+pickEach+" เลข · ถึง "+winTarget+" แต้มชนะ · เลขที่ออกจะถูกตัดจากวงล้อ";
    $("pickMsg").textContent="";
    renderPick();
    const each=Math.max(pickEach,1);
    const lastName=pickCursor>0?wheelOrder[Math.floor((pickCursor-1)/each)]:"";
    $("pickUndo").disabled=pickCursor<=0||(lastName!==myName()&&!isHost());
    $("pickGo").disabled=!isHost();
    renderPlayers();
  }else if(s.phase==="snake"){
    show("snakeGame");
    if($("snakeMode")){
      const mapName=(s.snake&&s.snake.mapName)||"";
      $("snakeMode").textContent=spectating
        ?"กำลังชม · บันไดงู"+(mapName?" · "+mapName:"")+" · ถึง 100 ชนะ"
        :"ทอยลูกเต๋า · ปีนบันได · เลี่ยงงู · ถึง 100 ชนะ · ผู้เล่นสูงสุด "+(s.maxPlayers||6)+(mapName?" · แมพ "+mapName:"");
    }
    updateSnakeBoard(s);
    if(spectating) applySpectatorUi();
    renderPlayers();
  }else if(s.phase==="imposter"){
    show("imposterGame");
    if($("imposterMode")){
      $("imposterMode").textContent=spectating
        ?"กำลังชม · Imposter"
        :"ให้คำใบ้ · คุย · โหวต · ผู้เล่น 4–"+(s.maxPlayers||8);
    }
    updateImposterUi(s);
    if(spectating) applySpectatorUi();
    renderPlayers();
  }else if(s.phase==="cardmemory"){
    show("memoryGame");
    if($("memoryMode")){
      const board=s.memoryBoard||"4x4";
      $("memoryMode").textContent=spectating
        ?"กำลังชม · Memory Card · "+board
        :"จับคู่การ์ด · "+board+" · ผู้เล่น 2–"+(s.maxPlayers||8);
    }
    updateMemoryUi(s);
    if(spectating) applySpectatorUi();
    renderPlayers();
  }else if(s.phase==="werewolf"){
    show("werewolfGame");
    if($("werewolfMode")){
      $("werewolfMode").textContent=spectating
        ?"กำลังชม · Werewolf"
        :"กลางคืนใช้ความสามารถ · กลางวันคุยและโหวต · ผู้เล่น 5–"+(s.maxPlayers||8);
    }
    updateWerewolfUi(s);
    if(spectating) applySpectatorUi();
    renderPlayers();
  }else if(s.phase==="wheel"){
    show("wheelGame");
    drawNumWheel();
    applyWheelRot();
    if(s.activeSpin&&s.activeSpin.kind==="num"){
      $("doSpin").disabled=true;
      $("doSpin").textContent="กำลังหมุน…";
      $("wheelRepick").disabled=true;
      $("wheelResult").classList.remove("bad");
      $("wheelResult").textContent="กำลังหมุน…";
      $("numRead").classList.remove("hit");
      $("numRead").textContent=String(numberAt(wheelRot));
    }else{
      renderWheelInfo();
      const last=wheelLog[wheelLog.length-1];
      if(last){
        let landMsg=last.who
          ?(last.skipSaved
            ?last.who+" โดนเลข "+last.n+" แต่ Skip Turn ละเว้นไว้"
            :last.angelSaved
              ?last.who+" โดนเลข "+last.n+" แต่การ์ดนางฟ้าช่วยไว้"
              :last.who+" โดนเลข "+last.n+" ออกจากเกม")
          :"ออกเลข "+last.n;
        $("wheelResult").textContent=landMsg;
        $("wheelResult").classList.toggle("bad", !!(last.who&&!last.skipSaved&&!last.angelSaved));
        $("numRead").textContent=String(last.n);
        $("numRead").classList.add("hit");
      }else{
        $("wheelResult").classList.remove("bad");
        $("wheelResult").textContent=isHost()?"กดหมุนวงล้อ":"รอโฮสต์หมุนวงล้อ";
        $("numRead").textContent="—";
        $("numRead").classList.remove("hit");
      }
      $("doSpin").textContent="หมุนวงล้อ";
      $("doSpin").disabled=!isHost()||wheelAlive.length<2;
      $("wheelRepick").disabled=!isHost()||wheelLog.length>0;
    }
    renderPlayers();
  }else if(s.phase==="over"&&s.over){
    const isSnakeOver=s.over.mode==="snake"||s.cat==="snake"||(s.snake&&s.snake.status==="finished");
    if(isSnakeOver&&s.snake){
      // Keep the board up so the winning walk can play, then pop the winner modal
      show("snakeGame");
      updateSnakeBoard(s).then(()=>{
        if(netPhase!=="over") return;
        paintOverScreen(s);
        celebrateOverSnap(s);
        hostLocks();
        paintInviteBtn();
      });
    }else{
      paintOverScreen(s);
      celebrateOverSnap(s);
    }
  }
  hostLocks();
  paintInviteBtn();
  applying=false;
}
function rememberSpin(spin){
  liveSpin=spin?{...spin}:null;
  liveSpinUntil=spin?Date.now()+Math.max(0, Number(spin.left)||0):0;
}
function spinLeftNow(){
  return liveSpinUntil?Math.max(0, liveSpinUntil-Date.now()):0;
}
function finishLiveSpin(){
  animId="";
  liveSpin=null;
  liveSpinUntil=0;
  const next=pendingSnap;
  pendingSnap=null;
  if(next) onSnap(next);
}
function clearLiveSpinAnim(){
  if(!animId) return;
  animId="";
  animGen++;
  liveSpin=null;
  liveSpinUntil=0;
  pendingSnap=null;
  clearSpinTimers();
  cancelAnimationFrame(orderAnim);
  cancelAnimationFrame(wheelAnim);
  stopSpinSound();
  spinning=false;
  wheelSpinning=false;
  try{ closeSpinModal(); }catch(_){}
}
function onSnap(s){
  // Never block end-of-match / lobby behind a stuck wheel animation
  if(s&&(s.phase==="over"||s.phase==="lobby"||s.phase==="gate")){
    clearLiveSpinAnim();
  }
  if(animId){
    if(s.activeSpin&&s.activeSpin.id===animId){
      rememberSpin(s.activeSpin);
      return;
    }
    pendingSnap=s;
    return;
  }
  applySnap(s);
  if(!s.activeSpin) return;
  animId=s.activeSpin.id;
  rememberSpin(s.activeSpin);
  if(s.activeSpin.kind==="order") startOrderAnim(s.activeSpin, ()=>finishLiveSpin());
  else startNumAnim(s.activeSpin, ()=>finishLiveSpin());
}
function startOrderAnim(spin, done){
  cancelAnimationFrame(orderAnim);
  clearSpinTimers();
  const spinKey=spin.id;
  spinning=true;
  renderPlayers();
  if($("winner")) $("winner").textContent="กำลังสุ่มลำดับ…";
  openSpinModal("กำลังหมุนวงล้อสุ่มลำดับ…");
  const from=Number.isFinite(spin.from)?spin.from:rot;
  const target=spin.rot||0;
  const {dur, elapsed}=spinProgress({dur:spin.dur, left:spin.left!=null?spin.left:spinLeftNow()});
  const remain=Math.max(0, (dur||0)-elapsed);
  const canvas=$("wheel");
  if(canvas) canvas.style.transition="none";
  if(dur&&elapsed<400){
    playSpinSound();
    armSpinSoundWatch(remain+80);
  }
  const wallStart=Date.now()-elapsed;
  const t0=performance.now()-elapsed;
  let finished=false;
  function finish(){
    if(finished||animId!==spinKey) return;
    finished=true;
    clearSpinTimers();
    cancelAnimationFrame(orderAnim);
    stopSpinSound();
    spinning=false;
    rot=target;
    if(canvas) canvas.style.transform="rotate("+rot+"deg)";
    const first=(spin.next&&spin.next[0])||order[0]||"";
    if($("spinModalSub")) $("spinModalSub").textContent="สุ่มเสร็จแล้ว";
    if($("spinModalResult")) $("spinModalResult").textContent=first?"เริ่มที่ "+first:"สุ่มลำดับแล้ว";
    if($("winner")) $("winner").textContent=first?"เริ่มที่ "+first:wheelMessage();
    if($("spinModalClose")) $("spinModalClose").classList.remove("hidden");
    done();
    setTimeout(()=>{ if(!spinning) closeSpinModal(); }, 2400);
  }
  function frame(now){
    if(animId!==spinKey||finished) return;
    const wallT=dur?Math.min(1,(Date.now()-wallStart)/dur):1;
    const t=dur?Math.min(1, Math.max((now-t0)/dur, wallT)):1;
    const eased=1-Math.pow(1-t,3);
    rot=from+(target-from)*eased;
    if(canvas) canvas.style.transform="rotate("+rot+"deg)";
    if(t<1){
      orderAnim=requestAnimationFrame(frame);
      return;
    }
    finish();
  }
  // Wall-clock backup so spin/sound still ends when the tab is backgrounded
  spinDoneTimer=setTimeout(finish, remain+60);
  orderAnim=requestAnimationFrame(frame);
}
function startNumAnim(spin, done){
  const gen=++animGen;
  const spinKey=spin.id;
  clearSpinTimers();
  const from=Number.isFinite(spin.from)?spin.from:wheelRot;
  const target=Number.isFinite(spin.target)?spin.target:from;
  const {dur, elapsed}=spinProgress({dur:spin.dur, left:spin.left!=null?spin.left:spinLeftNow()});
  const remain=Math.max(0, (dur||0)-elapsed);
  wheelSpinning=true;
  $("doSpin").disabled=true;
  $("doSpin").textContent="กำลังหมุน…";
  $("wheelRepick").disabled=true;
  $("numRead").classList.remove("hit");
  $("wheelResult").classList.remove("bad");
  $("wheelResult").textContent="กำลังหมุน…";
  renderPlayers();
  if(dur&&elapsed<400){
    playSpinSound();
    armSpinSoundWatch(remain+80);
  }
  const wallStart=Date.now()-elapsed;
  const t0=performance.now()-elapsed;
  let finished=false;
  function finish(){
    if(finished||gen!==animGen||animId!==spinKey) return;
    finished=true;
    clearSpinTimers();
    cancelAnimationFrame(wheelAnim);
    stopSpinSound();
    wheelSpinning=false;
    wheelRot=target;
    applyWheelRot();
    $("numRead").textContent=spin.n==null?"—":String(spin.n);
    if(spin.hit){
      lastBombKey="wheel|"+spin.id+"|"+spin.n;
      playClip(BOMB_SOUND);
      $("numRead").classList.add("hit");
      $("wheelResult").textContent=(spin.owner||"")+" โดนเลข "+spin.n+" ออกจากเกม";
      $("wheelResult").classList.add("bad");
    }else{
      $("numRead").classList.remove("hit");
      $("wheelResult").classList.remove("bad");
      $("wheelResult").textContent=spin.owner?"เลข "+spin.n+" ของ "+spin.owner+" ถูกตัดออก":"เลข "+spin.n+" ถูกตัดออก";
    }
    done();
  }
  function frame(now){
    if(gen!==animGen||animId!==spinKey||finished) return;
    const wallT=dur?Math.min(1,(Date.now()-wallStart)/dur):1;
    const t=dur?Math.min(1, Math.max((now-t0)/dur, wallT)):1;
    const eased=1-Math.pow(1-t,2);
    wheelRot=from+(target-from)*eased;
    applyWheelRot();
    const showN=numberAt(wheelRot);
    if($("numRead").textContent!==String(showN)) $("numRead").textContent=String(showN);
    if(t<1){
      wheelAnim=requestAnimationFrame(frame);
      return;
    }
    finish();
  }
  spinDoneTimer=setTimeout(finish, remain+60);
  wheelAnim=requestAnimationFrame(frame);
}
function resumeLiveSpin(){
  keepAudioAlive();
  if(document.hidden||!animId||!liveSpin) return;
  const spin={...liveSpin, left:spinLeftNow()};
  rememberSpin(spin);
  if(spin.kind==="order") startOrderAnim(spin, ()=>finishLiveSpin());
  else startNumAnim(spin, ()=>finishLiveSpin());
}
document.addEventListener("visibilitychange", ()=>{
  keepAudioAlive();
  if(!document.hidden) resumeLiveSpin();
});
// Keep AudioContext + BGM alive while the tab is backgrounded
if(!audioKeepAliveTimer){
  audioKeepAliveTimer=setInterval(()=>{
    if(masterVol<=0) return;
    if(netPhase==="gate") return;
    keepAudioAlive();
  }, 2000);
}
function renderLobby(msg){
  const list=$("roomList");
  if(!list) return;
  list.textContent="";
  const found=Array.isArray(msg.rooms)?msg.rooms:[];
  const empty=$("lobbyEmpty");
  if(empty) empty.classList.toggle("hidden",found.length>0);
  found.forEach(room=>{
    const priv=room.visibility==="private";
    const hasCode=/^\d{6}$/.test(String(room.code||""));
    const adminBypass=priv&&hasCode;
    const li=document.createElement("li");
    li.className="room"+(priv?" locked":"");
    const meta=document.createElement("div");
    meta.className="meta";
    const title=document.createElement("b");
    const label=room.title||(room.host?("ห้องของ "+room.host):"ห้องออนไลน์");
    if(priv){
      const lock=document.createElement("span");
      lock.className="lock";
      lock.setAttribute("aria-hidden","true");
      lock.textContent="🔒";
      title.append(lock, document.createTextNode(label));
    }else title.textContent=label;
    const sub=document.createElement("small");
    const cat=room.cat==="wheel"?"วงล้อสุ่มเลข":room.cat==="snake"?"บันไดงู":room.cat==="imposter"?"Imposter":room.cat==="cardmemory"?"Memory Card":room.cat==="werewolf"?"Werewolf":"ห้ามโดนเลขลับ";
    const state=room.phase==="lobby"?"รอผู้เล่น":"กำลังเล่น";
    const vis=priv?"ส่วนตัว":"สาธารณะ";
    sub.textContent=priv
      ?(adminBypass
        ?("แอดมิน · "+room.code+" · "+vis+" · "+cat+" · "+state+" · "+room.count+"/"+room.max)
        :("ล็อก · "+vis+" · "+cat+" · "+state+" · "+room.count+"/"+room.max))
      :(room.code+" · "+vis+" · "+cat+" · "+state+" · "+room.count+"/"+room.max);
    meta.append(title,sub);
    const btn=document.createElement("button");
    btn.type="button";
    btn.className="btn";
    const midGame=room.phase!=="lobby"&&room.phase!=="over";
    if(room.joinable){
      btn.textContent=priv&&!adminBypass?"ใส่รหัส":"เข้าร่วม";
      btn.disabled=false;
      btn.onclick=()=>{
        if(priv&&!adminBypass) openCodeModal("ห้องของ "+(room.host||"เพื่อน")+" ล็อกอยู่ · ใส่รหัส 6 หลัก");
        else joinCode(room.code);
      };
    }else if(midGame&&hasCode&&(adminBypass||!priv)){
      btn.textContent="เข้าชม";
      btn.disabled=false;
      btn.onclick=()=>{
        spectating=true;
        enterIntent=true;
        send({t:"watch",code:room.code,token:myToken(),name:typedName()||localStorage.getItem("dpn-name")||"",avatarUrl:myAvatar()});
      };
    }else{
      btn.textContent=room.phase==="lobby"?"เต็ม":(priv?"ส่วนตัว":"กำลังเล่น");
      btn.disabled=true;
    }
    li.append(meta,btn);
    list.appendChild(li);
  });
}
function joinCode(code){
  const name=typedName()||localStorage.getItem("dpn-name")||"";
  if(!name){ if($("gateMsg")) $("gateMsg").textContent="ใส่ชื่อก่อน"; return false; }
  const clean=String(code||"").replace(/\D/g,"").slice(0,6);
  if(!/^\d{6}$/.test(clean)){
    if($("codeModal")&&!$("codeModal").classList.contains("hidden")) $("codeModalMsg").textContent="รหัสต้องเป็นตัวเลข 6 หลัก";
    else if($("gateMsg")) $("gateMsg").textContent="รหัสต้องเป็นตัวเลข 6 หลัก";
    return false;
  }
  if($("gateMsg")) $("gateMsg").textContent="";
  send({t:"join",code:clean,name,token:myToken(),avatarUrl:myAvatar()});
  closeCodeModal();
  return true;
}
function makeRoom(visibility){
  const name=typedName()||localStorage.getItem("dpn-name")||"";
  if(!name){ if($("gateMsg")) $("gateMsg").textContent="ใส่ชื่อก่อน"; return; }
  if($("gateMsg")) $("gateMsg").textContent="";
  send({t:"create",visibility,name,token:myToken(),avatarUrl:myAvatar()});
}
function pushNums(){
  if(applying||!isHost()) return;
  const patch={};
  const win=parseIntStrict($("winScore").value);
  const turnEl=$("turnSec");
  const sec=turnEl?parseIntStrict(turnEl.value):null;
  const count=parseIntStrict($("secretCount").value);
  const each=parseIntStrict($("pickEach").value);
  if(win!=null) patch.winTarget=win;
  if(sec!=null) patch.turnSec=Math.min(120, Math.max(0, sec));
  if(count!=null) patch.secretCount=count;
  if(each!=null) patch.pickEach=each;
  if(useCustom){
    patch.rangeMode="custom";
    const min=parseIntStrict($("cmin").value);
    const max=parseIntStrict($("cmax").value);
    if(min!=null) patch.min=min;
    if(max!=null) patch.max=max;
  }
  const mapEl=$("snakeMap");
  if(mapEl&&mapEl.value) patch.snakeMapId=String(mapEl.value);
  const infoBtn=$("impostorInfoModes")&&$("impostorInfoModes").querySelector(".on[data-impostor-info]");
  if(infoBtn) patch.impostorInfo=infoBtn.getAttribute("data-impostor-info")==="category"?"category":"none";
  const impCount=parseIntStrict(($("impostorCount")&&$("impostorCount").value)||"1");
  if(impCount!=null) patch.impostorCount=impCount===2?2:1;
  const clueRounds=parseIntStrict(($("clueRounds")&&$("clueRounds").value)||"");
  if(clueRounds!=null) patch.clueRounds=Math.min(99, Math.max(1, clueRounds));
  const clue=parseIntStrict(($("clueSec")&&$("clueSec").value)||"");
  if(clue!=null) patch.clueSec=clue;
  const disc=parseIntStrict(($("discussionSec")&&$("discussionSec").value)||"");
  if(disc!=null) patch.discussionSec=disc;
  const vote=parseIntStrict(($("voteSec")&&$("voteSec").value)||"");
  if(vote!=null) patch.voteSec=vote;
  const wwNight=parseIntStrict(($("wwNightSec")&&$("wwNightSec").value)||"");
  if(wwNight!=null) patch.wwNightSec=wwNight;
  const wwDisc=parseIntStrict(($("wwDiscussionSec")&&$("wwDiscussionSec").value)||"");
  if(wwDisc!=null) patch.wwDiscussionSec=wwDisc;
  const wwVote=parseIntStrict(($("wwVoteSec")&&$("wwVoteSec").value)||"");
  if(wwVote!=null) patch.wwVoteSec=wwVote;
  if($("wwTieRule")) patch.wwTieRule=$("wwTieRule").value==="random"?"random":"none";
  if($("wwAllowSelfProtect")) patch.wwAllowSelfProtect=!!$("wwAllowSelfProtect").checked;
  send({t:"setup",patch});
}
function pushWerewolf(){
  if(applying||!isHost()||netPhase!=="lobby") return;
  const patch={};
  const wwNight=parseIntStrict(($("wwNightSec")&&$("wwNightSec").value)||"");
  if(wwNight!=null) patch.wwNightSec=wwNight;
  const wwDisc=parseIntStrict(($("wwDiscussionSec")&&$("wwDiscussionSec").value)||"");
  if(wwDisc!=null) patch.wwDiscussionSec=wwDisc;
  const wwVote=parseIntStrict(($("wwVoteSec")&&$("wwVoteSec").value)||"");
  if(wwVote!=null) patch.wwVoteSec=wwVote;
  if($("wwTieRule")) patch.wwTieRule=$("wwTieRule").value==="random"?"random":"none";
  if($("wwAllowSelfProtect")) patch.wwAllowSelfProtect=!!$("wwAllowSelfProtect").checked;
  send({t:"setup",patch});
}
function pushSnakeMap(){
  if(applying||!isHost()||netPhase!=="lobby") return;
  const mapEl=$("snakeMap");
  if(!mapEl||!mapEl.value) return;
  const id=String(mapEl.value);
  const picked=(_snakeMapsCache||[]).find(m=>m.id===id)||{id};
  paintSnakeMapPreviewBox(picked);
  const hint=$("snakeMapHint");
  if(hint&&picked&&picked.blurb) hint.textContent=picked.blurb;
  send({t:"setup",patch:{snakeMapId:id}});
}
function pushMemory(){
  if(applying||!isHost()||netPhase!=="lobby") return;
  const patch={};
  const board=$("memoryBoard");
  const turn=$("memoryTurnSec");
  const reveal=$("memoryRevealMs");
  const points=$("memoryPoints");
  const onMatch=$("memoryOnMatch");
  const onWrong=$("memoryOnWrong");
  const combo=$("memoryCombo");
  if(board) patch.memoryBoard=board.value;
  if(turn) patch.memoryTurnSec=Number(turn.value);
  if(reveal) patch.memoryRevealMs=Number(reveal.value);
  if(points) patch.memoryPoints=Number(points.value);
  if(onMatch) patch.memoryOnMatch=onMatch.value;
  if(onWrong) patch.memoryOnWrong=onWrong.value;
  if(combo) patch.memoryCombo=combo.value!=="0";
  send({t:"setup",patch});
}
function connect(){
  if(sock&&(sock.readyState===0||sock.readyState===1)) return;
  const proto=location.protocol==="https:"?"wss":"ws";
  let ws;
  try{ ws=new WebSocket(proto+"://"+location.host+"/ws"); }
  catch(e){
    if($("connMsg")) $("connMsg").textContent="เปิดจากเซิร์ฟเวอร์เกม แล้วรัน npm start";
    return;
  }
  sock=ws;
  ws.onopen=()=>{
    if($("connMsg")) $("connMsg").textContent="";
    if(pendingAction) enterIntent=true;
    send({t:"hello",token:myToken(),name:localStorage.getItem("dpn-name")||typedName(),avatarUrl:myAvatar()});
    // Prefer running after lobby; fallback if hello reattached without lobby.
    setTimeout(()=>{
      if(pendingAction&&!wantRoom) runPendingAction();
    }, 250);
  };
  ws.onmessage=e=>{
    let msg;
    try{ msg=JSON.parse(e.data); }catch(err){ return; }
    if(!msg||typeof msg!=="object") return;
    if(msg.t==="state"){
      if(msg.phase==="lobby") refreshAngelQty();
      if(msg.spectator){ spectating=true; applySpectatorUi(); }
      onSnap(msg);
    }
    else if(msg.t==="lobby"){
      if(pendingAction) runPendingAction();
      else if(!wantRoom&&!spectating&&!enterIntent) showGate();
      else renderLobby(msg);
    }else if(msg.t==="banned"){
      enterIntent=false;
      wantRoom=false;
      pendingAction=null;
      clearTimeout(connTimer);
      if(sock){
        try{ sock.onclose=null; sock.close(); }catch(_){}
        sock=null;
      }
      if(window.NVBan&&window.NVBan.applyBanNotice){
        window.NVBan.applyBanNotice(msg);
      }else{
        alert(msg.message||"บัญชีของคุณถูกแบน");
      }
      return;
    }else if(msg.t==="unbanned"){
      if(window.NVBan&&window.NVBan.clearBanNotice) window.NVBan.clearBanNotice();
    }else if(msg.t==="announcement:new"){
      if(window.NVToasts&&window.NVToasts.onLiveAnnouncement){
        window.NVToasts.onLiveAnnouncement(msg.announcement);
      }
    }else if(msg.t==="maintenance:countdown"){
      if(window.NVMaint&&window.NVMaint.applyMaintenanceCountdown){
        window.NVMaint.applyMaintenanceCountdown(msg);
      }else{
        // Fallback if module bridge not ready yet
        try{
          const sec=Math.max(1, Number(msg.seconds)||15);
          alert("Maintenance in "+sec+" — "+(msg.message||"เซิร์ฟกำลังปิด"));
        }catch(_){}
      }
    }else if(msg.t==="maintenance"){
      try{ sessionStorage.setItem("nv-maint-msg", msg.message||""); }catch(_){}
      if(window.NVMaint&&window.NVMaint.applyLiveMaintenance){
        window.NVMaint.applyLiveMaintenance(msg.message||"");
      }
      location.replace("/app");
      return;
    }else if(msg.t==="left"||msg.t==="roomClosed"){
      // Ignore stale left while we are actively entering a room.
      if(enterIntent||pendingAction) return;
      clearActiveRoom();
      // Maintenance kick also sends roomClosed — prefer maintenance redirect.
      if(msg.message&&/ปิดปรับปรุง|maintenance/i.test(String(msg.message))){
        try{ sessionStorage.setItem("nv-maint-msg", msg.message||""); }catch(_){}
        location.replace("/app");
        return;
      }
      roomVisibility="";
      paintInviteBtn();
      if(msg.t==="roomClosed"&&msg.message&&$("err")) $("err").textContent=msg.message;
      location.replace("/app#rooms");
      return;
    }else if(msg.t==="renamed"){
      if(msg.name) setLocalName(msg.name);
    }else if(msg.t==="friendsOnline"){
      onlineFriendIds=new Set(Array.isArray(msg.online)?msg.online:[]);
      if(!$("inviteModal").classList.contains("hidden")) renderInviteFriendList();
    }else if(msg.t==="friendPresence"){
      if(msg.online) onlineFriendIds.add(msg.userId);
      else onlineFriendIds.delete(msg.userId);
      if(!$("inviteModal").classList.contains("hidden")) renderInviteFriendList();
    }else if(msg.t==="roomInvite"){
      showRoomInvite(msg);
    }else if(msg.t==="inviteSent"){
      if(!$("inviteModal").classList.contains("hidden")) $("inviteModalMsg").textContent="ส่งคำเชิญแล้ว";
    }else if(msg.t==="inviteAccepted"){
      if(!$("inviteModal").classList.contains("hidden")) $("inviteModalMsg").textContent="เพื่อนรับคำเชิญแล้ว";
    }else if(msg.t==="inviteDeclined"){
      if(!$("inviteModal").classList.contains("hidden")) $("inviteModalMsg").textContent="เพื่อนปฏิเสธคำเชิญ";
    }else if(msg.t==="helperUsed"){
      if(msg.itemId&&msg.quantity!=null&&Array.isArray(lobbyBagItems)){
        const hit=lobbyBagItems.find(it=>it&&it.id===msg.itemId);
        if(hit) hit.quantity=Number(msg.quantity)||0;
      }
      paintLobbyAngel();
      if($("lobbyBagModal")&&!$("lobbyBagModal").classList.contains("hidden")){
        paintLobbyBagModal();
        const bagMsg=$("lobbyBagMsg");
        if(bagMsg){ bagMsg.textContent="ใช้ไอเทมแล้ว"; bagMsg.classList.add("ok"); }
      }
      if(msg.itemId==="item.skip"){
        closeSkipTargetModal();
        const tip=$("skipTargetMsg");
        if(tip) tip.textContent="";
        if(msg.targetUserId) flashPlayerPause(msg.targetUserId);
      }
      if(msg.itemId==="item.bomb"){
        const board=ensureSnakeBoard();
        if(board&&typeof board.setBombPickMode==="function") board.setBombPickMode(false);
        closeLobbyBagModal();
      }
      refreshAngelQty();
    }else if(msg.t==="roomChat"){
      if(msg.fromId){
        const meta={
          private:!!msg.private,
          toId:msg.toId||"",
          toName:msg.toName||"",
          fromMe:msg.fromId===myId,
          fromName:msg.fromName||"",
          body:msg.body||""
        };
        appendRoomChatLog(meta);
        // Lobby keeps avatar bubbles; in-game messages live in the tall chat panel
        if(!document.body.classList.contains("in-game")){
          showRoomChatBubble(msg.fromId, msg.body||"", meta);
        }
        if(msg.fromId!==myId) playClip(ROOM_CHAT_SOUND);
      }
    }else if(msg.t==="err"){
      if(!$("codeModal").classList.contains("hidden")) $("codeModalMsg").textContent=msg.message||"";
      else if(!$("inviteModal").classList.contains("hidden")) $("inviteModalMsg").textContent=msg.message||"";
      else showErr(msg.message||"");
    }
  };
  ws.onclose=()=>{
    if(sock!==ws) return;
    sock=null;
    const note="ขาดการเชื่อมต่อ กำลังเชื่อมใหม่…";
    if(wantRoom) $("roomNote").textContent=note;
    else if($("connMsg")) $("connMsg").textContent=note;
    clearTimeout(connTimer);
    connTimer=setTimeout(connect,800);
  };
}
async function bootOnline(){
  readPlayParams();
  await ensureAuth();
  if(!pendingAction){
    // No URL action — still try resume via hello seat reattach.
    pendingAction={type:"resume",code:""};
    enterIntent=true;
  }
  const saved=localStorage.getItem("dpn-name");
  if(saved&&$("myName")) $("myName").value=saved;
  if($("myName")) $("myName").addEventListener("change",typedName);
  ["winScore","turnSec","secretCount","pickEach","cmin","cmax"].forEach(id=>{ const el=$(id); if(el) el.addEventListener("input",pushNums); });
  if($("snakeMap")) $("snakeMap").addEventListener("change",pushSnakeMap);
  if($("wordCategory")) $("wordCategory").addEventListener("change",()=>{
    if(applying||!isHost()||netPhase!=="lobby") return;
    const infoBtn=$("impostorInfoModes")&&$("impostorInfoModes").querySelector(".on[data-impostor-info]");
    if(!infoBtn||infoBtn.getAttribute("data-impostor-info")!=="category") return;
    send({t:"setup",patch:{wordCategory:$("wordCategory").value||"all"}});
  });
  ["memoryBoard","memoryTurnSec","memoryRevealMs","memoryPoints","memoryOnMatch","memoryOnWrong","memoryCombo"].forEach(id=>{
    const el=$(id);
    if(el) el.addEventListener("change",pushMemory);
  });
  ["wwNightSec","wwDiscussionSec","wwVoteSec","wwTieRule","wwAllowSelfProtect"].forEach(id=>{
    const el=$(id);
    if(!el) return;
    el.addEventListener(id==="wwAllowSelfProtect"||id==="wwTieRule"?"change":"input",pushWerewolf);
  });
  setInterval(paintTurnClock, 250);
  function toggleAuto(){
    if(!onlineMode||spectating) return;
    if(netPhase!=="play"&&netPhase!=="pick"&&netPhase!=="snake") return;
    send({t:"auto",on:!myAuto});
  }
  const autoPlay=$("autoPlay");
  const autoPick=$("autoPick");
  const autoSnake=$("autoSnake");
  if(autoPlay) autoPlay.onclick=toggleAuto;
  if(autoPick) autoPick.onclick=toggleAuto;
  if(autoSnake) autoSnake.onclick=toggleAuto;
  const addBot=$("addBot");
  if(addBot) addBot.onclick=()=>{ if(isHost()&&netPhase==="lobby") send({t:"addBot"}); };
  // keep profile name synced for registered players
  if(authUser&&authUser.accountType==="registered") paintAuthBar(authUser);
  $("jump").onsubmit=e=>{
    e.preventDefault();
    const n=parseIntStrict($("guess").value);
    $("guess").value="";
    if(n==null){ $("msg").textContent="ใส่เป็นจำนวนเต็ม"; return; }
    chooseNumber(n);
  };
  $("pickJump").onsubmit=e=>{
    e.preventDefault();
    const n=parseIntStrict($("pickGuess").value);
    $("pickGuess").value="";
    if(n==null){ $("pickMsg").textContent="ใส่เป็นจำนวนเต็ม"; return; }
    choosePick(n);
  };
  if($("spin")) $("spin").onclick=()=>{ if(isHost()) send({t:"spinOrder"}); };
  if($("clearScores")) $("clearScores").onclick=()=>{ if(isHost()) send({t:"clear"}); };
  if($("lobbyStartBtn")) $("lobbyStartBtn").onclick=()=>requestStartGame();
  if($("lobbyItemBtn")) $("lobbyItemBtn").onclick=()=>{
    if(!onlineMode||spectating||!canUseFriends()) return;
    if(netPhase!=="lobby"&&netPhase!=="play"&&netPhase!=="snake"&&netPhase!=="wheel") return;
    openLobbyBagModal();
  };
  if($("inGameBagBtn")) $("inGameBagBtn").onclick=()=>{
    if(!onlineMode||spectating||!canUseFriends()) return;
    if(netPhase!=="play"&&netPhase!=="snake"&&netPhase!=="wheel") return;
    openLobbyBagModal();
  };
  if($("lobbyBagClose")) $("lobbyBagClose").onclick=()=>closeLobbyBagModal();
  if($("lobbyBagModal")) $("lobbyBagModal").addEventListener("click",e=>{
    if(e.target===$("lobbyBagModal")) closeLobbyBagModal();
  });
  if($("settingsGearBtn")) $("settingsGearBtn").onclick=()=>openSettingsModal();
  if($("settingsClose")) $("settingsClose").onclick=()=>closeSettingsModal();
  if($("settingsModal")) $("settingsModal").addEventListener("click",e=>{ if(e.target===$("settingsModal")) closeSettingsModal(); });
  if($("spinModalClose")) $("spinModalClose").onclick=()=>closeSpinModal();
  if($("spinModal")) $("spinModal").addEventListener("click",e=>{ if(e.target===$("spinModal")&&!spinning) closeSpinModal(); });
  if($("lobbyCopy")) $("lobbyCopy").onclick=async()=>{
    try{
      await navigator.clipboard.writeText(roomCode);
      $("lobbyCopy").textContent="✓";
      setTimeout(()=>{ if($("lobbyCopy")) $("lobbyCopy").textContent="📋"; }, 1200);
    }catch(e){}
  };
  function openTransferHostModal(){
    const modal=$("transferHostModal");
    const list=$("transferHostList");
    const empty=$("transferHostEmpty");
    if(!modal||!list) return;
    list.textContent="";
    const candidates=playerMeta.filter(p=>p.id!==myId&&p.connected&&!p.bot);
    if(empty) empty.classList.toggle("hidden",candidates.length>0);
    candidates.forEach(p=>{
      const li=document.createElement("li");
      const label=p.champion?`${p.name} · ผู้ชนะ`:`${p.name}`;
      li.innerHTML=`<span class="name">${label.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}</span>`;
      const btn=document.createElement("button");
      btn.type="button";
      btn.className="btn sm";
      btn.textContent="โอนให้คนนี้";
      btn.onclick=()=>{
        send({t:"giveHost",id:p.id});
        modal.classList.add("hidden");
      };
      li.appendChild(btn);
      list.appendChild(li);
    });
    modal.classList.remove("hidden");
  }
  if($("transferHostClose")) $("transferHostClose").onclick=()=>$("transferHostModal").classList.add("hidden");
  if($("transferHostModal")) $("transferHostModal").addEventListener("click",e=>{
    if(e.target===$("transferHostModal")) $("transferHostModal").classList.add("hidden");
  });
  if($("playerProfileClose")) $("playerProfileClose").onclick=()=>closePlayerProfileModal();
  if($("playerProfileModal")) $("playerProfileModal").addEventListener("click",e=>{
    if(e.target===$("playerProfileModal")) closePlayerProfileModal();
  });
  function openDeleteRoomModal(){
    const modal=$("deleteRoomModal");
    if(modal) modal.classList.remove("hidden");
  }
  function closeDeleteRoomModal(){
    const modal=$("deleteRoomModal");
    if(modal) modal.classList.add("hidden");
  }
  if($("deleteRoomBtn")) $("deleteRoomBtn").onclick=()=>{
    if(!isHost()||netPhase!=="lobby") return;
    openDeleteRoomModal();
  };
  if($("deleteRoomCancel")) $("deleteRoomCancel").onclick=()=>closeDeleteRoomModal();
  if($("deleteRoomConfirm")) $("deleteRoomConfirm").onclick=()=>{
    if(!isHost()||netPhase!=="lobby"){ closeDeleteRoomModal(); return; }
    closeDeleteRoomModal();
    send({t:"deleteRoom"});
  };
  if($("deleteRoomModal")) $("deleteRoomModal").addEventListener("click",e=>{
    if(e.target===$("deleteRoomModal")) closeDeleteRoomModal();
  });
  $("again").onclick=()=>{ resetWinCelebration(); if(isHost()) send({t:"again"}); };
  if($("winnerModalClose")) $("winnerModalClose").onclick=()=>closeWinnerModal();
  if($("winnerModal")) $("winnerModal").addEventListener("click",e=>{
    if(e.target===$("winnerModal")) closeWinnerModal();
  });
  ["leave","back","wheelLeave","pickLeave","snakeLeave"].forEach(id=>{ const el=$(id); if(el) el.onclick=()=>{ if(isHost()) send({t:"abort"}); }; });
  if($("imposterLeave")) $("imposterLeave").onclick=()=>{ if(isHost()) send({t:"abort"}); };
  if($("memoryLeave")) $("memoryLeave").onclick=()=>{ if(isHost()) send({t:"abort"}); };
  if($("werewolfLeave")) $("werewolfLeave").onclick=()=>{ if(isHost()) send({t:"abort"}); };
  $("pickGo").onclick=()=>{ if(isHost()) send({t:"openWheel"}); };
  $("pickUndo").onclick=()=>send({t:"undo"});
  $("doSpin").onclick=()=>{ if(isHost()) send({t:"spinNum"}); };
  $("wheelRepick").onclick=()=>{ if(isHost()) send({t:"repick"}); };
  if($("leaveRoom")) $("leaveRoom").onclick=()=>leaveCurrentRoom();
  if($("lobbyLeaveBtn")) $("lobbyLeaveBtn").onclick=()=>leaveCurrentRoom();
  if($("quitGameBtn")) $("quitGameBtn").onclick=()=>openQuitGameModal();
  if($("quitGameCancel")) $("quitGameCancel").onclick=()=>closeQuitGameModal();
  if($("quitGameConfirm")) $("quitGameConfirm").onclick=()=>quitGameNow();
  if($("quitGameModal")) $("quitGameModal").addEventListener("click",e=>{
    if(e.target===$("quitGameModal")) closeQuitGameModal();
  });
  $("renameRoomBtn").onclick=()=>openRenameRoom();
  $("renameRoomCancel").onclick=()=>closeRenameRoom();
  $("renameRoomForm").onsubmit=e=>{
    e.preventDefault();
    submitRenameRoom($("renameRoomInput").value);
  };
  $("codeModalCancel").onclick=()=>closeCodeModal();
  $("codeModal").addEventListener("click",e=>{ if(e.target===$("codeModal")) closeCodeModal(); });
  $("codeModalForm").onsubmit=e=>{
    e.preventDefault();
    if(!(typedName()||localStorage.getItem("dpn-name"))){ $("codeModalMsg").textContent="ใส่ชื่อใน Dashboard ก่อน"; return; }
    joinCode($("codeModalInput").value);
  };
  $("codeModalInput").addEventListener("input",()=>{ $("codeModalInput").value=$("codeModalInput").value.replace(/\D/g,"").slice(0,6); });
  $("helpBtn").onclick=()=>openGuide();
  $("guideClose").onclick=()=>closeGuide();
  $("guideModal").addEventListener("click",e=>{ if(e.target===$("guideModal")) closeGuide(); });
  $("guideTabs").onclick=e=>{
    const btn=e.target.closest("button[data-guide]");
    if(!btn) return;
    renderGuide(btn.dataset.guide);
  };
  renderGuide("room");
  $("copyCode").onclick=async()=>{
    try{
      await navigator.clipboard.writeText(roomCode);
      $("copyCode").textContent="คัดลอกแล้ว";
    }catch(e){
      $("copyCode").textContent="คัดลอกไม่สำเร็จ";
    }
  };
  const makePublic=$("makePublic");
  const makePrivate=$("makePrivate");
  const joinForm=$("joinForm");
  const joinCodeInput=$("joinCode");
  if(makePublic) makePublic.onclick=()=>makeRoom("public");
  if(makePrivate) makePrivate.onclick=()=>makeRoom("private");
  if(joinForm) joinForm.onsubmit=e=>{ e.preventDefault(); joinCode(joinCodeInput&&joinCodeInput.value); };
  if(joinCodeInput) joinCodeInput.addEventListener("input",()=>{ joinCodeInput.value=joinCodeInput.value.replace(/\D/g,"").slice(0,6); });
  const loginLink=$("loginLink");
  if(loginLink){
    loginLink.onclick=()=>{
      if(authUser&&authUser.accountType==="guest") openAuthChoiceModal();
      else location.href="/login";
    };
  }
  const ROOM_EMOJIS=[
    "😀","😁","😂","🤣","😊","😍","😘","😎",
    "🤩","😇","🙂","😉","😭","😤","😡","🤔",
    "😴","🤒","🤢","😈","👻","💀","🔥","✨",
    "💥","❤️","🧡","💛","💚","💙","💜","🖤",
    "👍","👎","👏","🙌","🤝","✌️","🤞","💪",
    "🎮","🎲","🐍","🪜","🏆","🥇","🎯","⚡",
    "🍀","🎉","🎊","💯","✅","❌","⭐","🌟"
  ];
  function clipRoomChat(s){
    return Array.from(String(s||"").trim().replace(/\s+/g," ")).slice(0,64).join("");
  }
  const roomChatForm=$("roomChatBar");
  const roomEmojiBtn=$("roomEmojiBtn");
  const roomEmojiPanel=$("roomEmojiPanel");
  function setEmojiPanel(open){
    if(!roomEmojiPanel||!roomEmojiBtn) return;
    roomEmojiPanel.classList.toggle("hidden",!open);
    roomEmojiBtn.setAttribute("aria-expanded", open?"true":"false");
  }
  if(roomEmojiPanel){
    roomEmojiPanel.innerHTML=ROOM_EMOJIS.map(e=>`<button type="button" data-emoji="${e}" aria-label="${e}">${e}</button>`).join("");
    roomEmojiPanel.onclick=e=>{
      const btn=e.target.closest("[data-emoji]");
      if(!btn) return;
      const input=$("roomChatInput");
      if(!input) return;
      const emoji=btn.getAttribute("data-emoji")||"";
      const next=clipRoomChat(input.value+emoji);
      input.value=next;
      input.focus();
      try{
        const end=input.value.length;
        input.setSelectionRange(end,end);
      }catch(_){}
    };
  }
  if(roomEmojiBtn){
    roomEmojiBtn.onclick=e=>{
      e.preventDefault();
      e.stopPropagation();
      if(!canUseFriends()){ paintRoomChatBar(); return; }
      setEmojiPanel(roomEmojiPanel&&roomEmojiPanel.classList.contains("hidden"));
    };
  }
  document.addEventListener("click",e=>{
    if(!roomEmojiPanel||roomEmojiPanel.classList.contains("hidden")) return;
    if(e.target.closest("#roomChatDock")||e.target.closest("#roomChatBar")) return;
    setEmojiPanel(false);
  });
  const roomChatToggle=$("roomChatToggle");
  const roomChatClose=$("roomChatClose");
  const roomChatScrim=$("roomChatScrim");
  if(roomChatToggle){
    roomChatToggle.onclick=e=>{
      e.preventDefault();
      e.stopPropagation();
      if(!canUseFriends()){ paintRoomChatBar(); return; }
      setRoomChatDrawer(!isRoomChatDrawerOpen());
    };
  }
  if(roomChatClose){
    roomChatClose.onclick=e=>{
      e.preventDefault();
      setRoomChatDrawer(false);
    };
  }
  if(roomChatScrim){
    roomChatScrim.onclick=()=>setRoomChatDrawer(false);
  }
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"&&isRoomChatDrawerOpen()) setRoomChatDrawer(false);
  });
  try{
    window.matchMedia("(max-width: 960px)").addEventListener("change",()=>{
      if(!isMobileChatDrawer()) setRoomChatDrawer(false);
      paintRoomChatBar();
    });
  }catch(_){}
  const roomChatTo=$("roomChatTo");
  if(roomChatTo){
    roomChatTo.onchange=()=>paintRoomChatTargets();
  }
  if(roomChatForm){
    roomChatForm.onsubmit=e=>{
      e.preventDefault();
      if(!canUseFriends()){
        paintRoomChatBar();
        return;
      }
      const input=$("roomChatInput");
      const body=clipRoomChat(input&&input.value?input.value:"");
      if(!body) return;
      const toId=roomChatTo&&roomChatTo.value?String(roomChatTo.value):"";
      const payload={t:"roomChat",body};
      if(toId) payload.toId=toId;
      send(payload);
      if(input) input.value="";
      setEmojiPanel(false);
    };
  }
  const authChoiceLink=$("authChoiceLink");
  const authChoiceLogin=$("authChoiceLogin");
  const authChoiceCancel=$("authChoiceCancel");
  const authChoiceModal=$("authChoiceModal");
  if(authChoiceLink) authChoiceLink.onclick=()=>{ location.href="/app#profile"; };
  if(authChoiceLogin) authChoiceLogin.onclick=async()=>{
    try{ await fetch("/api/v1/auth/logout",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:"{}"}); }
    catch(e){}
    location.href="/login";
  };
  if(authChoiceCancel) authChoiceCancel.onclick=()=>closeAuthChoiceModal();
  if(authChoiceModal) authChoiceModal.addEventListener("click",e=>{ if(e.target===authChoiceModal) closeAuthChoiceModal(); });
  const inviteClose=$("inviteModalClose");
  const inviteModal=$("inviteModal");
  if(inviteClose) inviteClose.onclick=()=>closeInviteModal();
  if(inviteModal) inviteModal.addEventListener("click",e=>{ if(e.target===inviteModal) closeInviteModal(); });
  const skipCancel=$("skipTargetCancel");
  const skipModal=$("skipTargetModal");
  if(skipCancel) skipCancel.onclick=()=>closeSkipTargetModal();
  if(skipModal) skipModal.addEventListener("click",e=>{ if(e.target===skipModal) closeSkipTargetModal(); });
  paintInviteBtn();
  const acceptBtn=$("roomInviteAccept");
  const declineBtn=$("roomInviteDecline");
  if(acceptBtn) acceptBtn.onclick=()=>{
    if(!pendingRoomInvite) return;
    const inviteId=pendingRoomInvite.inviteId;
    hideRoomInvite();
    send({
      t:"acceptInvite",
      inviteId,
      name:typedName()||localStorage.getItem("dpn-name")||"",
      avatarUrl:myAvatar()
    });
  };
  if(declineBtn) declineBtn.onclick=()=>{
    if(pendingRoomInvite) send({t:"declineInvite",inviteId:pendingRoomInvite.inviteId});
    hideRoomInvite();
  };
  const volBtn=$("volMenuBtn");
  const volList=$("volMenuList");
  if(volBtn){
    volBtn.onclick=(e)=>{
      e.stopPropagation();
      unlockAudio();
      toggleVolMenu();
    };
  }
  if(volList){
    volList.onclick=(e)=>{
      const opt=e.target.closest("[data-vol]");
      if(!opt) return;
      e.stopPropagation();
      unlockAudio();
      const n=Number(opt.getAttribute("data-vol"));
      setVolume(Number.isFinite(n)?n:masterVol, true);
      closeVolMenu();
    };
  }
  document.addEventListener("click",(e)=>{
    if(e.target.closest&&e.target.closest("#volMenu")) return;
    closeVolMenu();
  });
  placeHelpBtn(false);
  applyVolume();
  show("gate");
  connect();
}
bootOnline();
