import { app, auth, db, ready, ref, set, get, onValue, update, runTransaction, push, serverTimestamp, onDisconnect, child, query, orderByChild, equalTo, getServerNow } from "./firebase.js";

// ---------- Утилиты ----------
const $ = (sel) => document.querySelector(sel);
const byId = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOVES = ["rock", "paper", "scissors", "lizard", "spock"];
const MOVE_EMOJI = { rock:"🗿", paper:"📄", scissors:"✂️", lizard:"🦎", spock:"🖖" };
const REASONS_RU = {
  rock_crushes_scissors:"Камень дробит ножницы",
  rock_crushes_lizard:"Камень придавливает ящерицу",
  paper_covers_rock:"Бумага накрывает камень",
  paper_disproves_spock:"Бумага опровергает Спока",
  scissors_cut_paper:"Ножницы режут бумагу",
  scissors_decapitate_lizard:"Ножницы обезглавливают ящерицу",
  lizard_eats_paper:"Ящерица ест бумагу",
  lizard_poisons_spock:"Ящерица травит Спока",
  spock_smashes_scissors:"Спок ломает ножницы",
  spock_vaporizes_rock:"Спок испаряет камень",
  draw:"Ничья",
  no_moves:"Никто ничего не выбрал"
};
function decide(a, b){
  if(!a && !b) return { winner:null, reasonKey:"no_moves" };
  if(!a || !b) {
    // если ход сделал только один — он выигрывает; reasonKey оставим "draw" как нейтральный текст
    if(a && !b) return { winner:"a", reasonKey:"draw" };
    if(b && !a) return { winner:"b", reasonKey:"draw" };
    return { winner:null, reasonKey:"draw" };
  }
  if(a===b) return { winner:null, reasonKey:"draw" };
  const beats = {
    rock: { scissors:"rock_crushes_scissors", lizard:"rock_crushes_lizard" },
    paper: { rock:"paper_covers_rock", spock:"paper_disproves_spock" },
    scissors: { paper:"scissors_cut_paper", lizard:"scissors_decapitate_lizard" },
    lizard: { paper:"lizard_eats_paper", spock:"lizard_poisons_spock" },
    spock: { scissors:"spock_smashes_scissors", rock:"spock_vaporizes_rock" }
  };
  if (beats[a] && beats[a][b]) return { winner:"a", reasonKey:beats[a][b] };
  if (beats[b] && beats[b][a]) return { winner:"b", reasonKey:beats[b][a] };
  return { winner:null, reasonKey:"draw" };
}
function shortName(name){
  const n = (name||"").trim();
  return n ? n : "Гость123";
}
function initial(name){
  const n = shortName(name);
  return (n[0]||"—").toUpperCase();
}
function genCode(){
  const letters="ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "";
  for(let i=0;i<4;i++) s += letters[Math.floor(Math.random()*letters.length)];
  return s;
}
function codeFromURL(){
  const p = new URLSearchParams(location.search);
  const room = (p.get("room")||"").toUpperCase().replace(/[^A-Z]/g,"").slice(0,4);
  return room || null;
}
function setURLRoom(code){
  const u = new URL(location.href);
  u.searchParams.set("room", code);
  history.replaceState({}, "", u.toString());
}
function copy(text){
  navigator.clipboard?.writeText(text);
}

// ---------- Состояние ----------
let myUid = null;
let myName = null;
let currentCode = null;
let unsubLobby = null;
let unsubPresence = null;
let unsubRoundId = null;
let unsubRound = null;
let roundTickTimer = null;
let myMoveOnce = false;
let score = { host: 0, guest: 0 };

// ---------- DOM ----------
const nicknamePill = byId("nickname");
const changeNickBtn = byId("changeNickBtn");
const createLobbyBtn = byId("createLobbyBtn");
const joinCodeInput = byId("joinCodeInput");
const joinLobbyBtn = byId("joinLobbyBtn");
const lobbiesUl = byId("lobbiesUl");

const roomSection = byId("room");
const roomCodeEl = byId("roomCode");
const leaveToNewBtn = byId("leaveToNewBtn");

const hostAvatar = byId("hostAvatar");
const hostName = byId("hostName");
const guestAvatar = byId("guestAvatar");
const guestName = byId("guestName");
const statusText = byId("statusText");
const timerEl = byId("timer");
// динамический элемент счёта (добавим рядом с VS)
let scoreEl = null;
const choicesEl = byId("choices");
const revealBox = byId("reveal");
const revealLeft = byId("revealLeft");
const revealRight = byId("revealRight");
const reasonText = byId("reasonText");
const resultBanner = byId("resultBanner");
const resultText = byId("resultText");
const rematchBtn = byId("rematchBtn");

// ---------- Инициализация ----------
/** 20 нейтральных забавных ников для 24-летних */
const FUN_NICKS = [
  "PixelPanther","CoffeeNebula","VibeRocket","ChillNova","LoFiNinja",
  "NeonFox","MintComet","ByteKitten","CosmoRider","HypeOtter",
  "JellyEcho","SunnyGlitch","MoonBagel","TurboMango","FunkyOrbit",
  "AquaPulse","LazyMeteor","WittyPanda","SkateKoala","ZenFalcon"
];

function pickRandomNick(){
  return FUN_NICKS[Math.floor(Math.random()*FUN_NICKS.length)];
}

init();

async function init(){
  // авто-ник (сохраняется в localStorage)
  let saved = localStorage.getItem("rpsls_nick");
  if(!saved){
    saved = pickRandomNick();
    localStorage.setItem("rpsls_nick", saved);
  }
  myName = shortName(saved);

  // отрисовать в шапке
  if(nicknamePill) nicknamePill.textContent = `@${myName}`;

  // смена ника -> новый случайный
  if(changeNickBtn){
    changeNickBtn.addEventListener("click", () => {
      const v = pickRandomNick();
      localStorage.setItem("rpsls_nick", v);
      myName = v;
      if(nicknamePill) nicknamePill.textContent = `@${myName}`;
      renderNames();
    });
  }

  await ready;
  // корректный способ: используем экспортированный auth
  myUid = auth.currentUser?.uid || null;

  createLobbyBtn.addEventListener("click", onCreateLobby);
  joinLobbyBtn.addEventListener("click", onJoinLobby);
  leaveToNewBtn.addEventListener("click", leaveToNew);

  choicesEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".choice");
    if(!btn) return;
    submitMove(btn.dataset.move);
  });

  rematchBtn.addEventListener("click", startRematch);

  const pre = codeFromURL();
  if(pre){
    joinCodeInput.value = pre;
    onJoinLobby();
  }

  watchLobbies();
}

// ---------- Лобби лист ----------
function watchLobbies(){
  const lobbiesRef = ref(db, "/lobbies");
  onValue(lobbiesRef, (snap) => {
    const all = snap.val() || {};
    const arr = Object.values(all);
    const now = getServerNow();
    const fresh = arr.filter(x =>
      x && x.status==="waiting" &&
      (typeof x.updatedAt === "number" ? (now - x.updatedAt <= 30*60*1000) : true)
    );
    fresh.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    renderLobbyList(fresh);
  });
}
function renderLobbyList(list){
  lobbiesUl.innerHTML = "";
  list.forEach(l => {
    const li = document.createElement("li");
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `Код ${l.code} — хост @${l.host?.name || "—"}`;
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "Присоединиться";
    btn.addEventListener("click", () => {
      joinCodeInput.value = l.code;
      onJoinLobby();
    });
    li.append(meta, btn);
    lobbiesUl.appendChild(li);
  });
}

// ---------- Создание / Присоединение ----------
async function onCreateLobby(){
  const code = genCode();
  const lobbyRef = ref(db, `/lobbies/${code}`);
  const now = getServerNow();
  await set(lobbyRef, {
    code,
    status:"waiting",
    host:{ uid: myUid, name: myName },
    createdAt: serverTimestamp(),
    updatedAt: now
  });
  await enterRoom(code);
  setURLRoom(code);
}
async function onJoinLobby(){
  const raw = (joinCodeInput.value||"").toUpperCase().replace(/[^A-Z]/g,"").slice(0,4);
  if(!raw || raw.length!==4) return;
  await enterRoom(raw);
  setURLRoom(raw);
}

async function enterRoom(code){
  cleanupRoomWatchers();
  currentCode = code;

  roomSection.classList.remove("hidden");
  byId("about").classList.add("hidden");
  byId("lobbyActions").classList.add("hidden");
  // обновить шапку ника (на случай если шли напрямую в комнату)
  if(nicknamePill) nicknamePill.textContent = `@${myName}`;
  roomCodeEl.textContent = code;

  // сбросить и отрисовать счёт
  score = { host: 0, guest: 0 };
  ensureScoreEl();
  updateScoreUI();

  // presence
  const presRef = ref(db, `/presence/${code}/${auth.currentUser?.uid}`);
  await set(presRef, true);
  onDisconnect(presRef).remove();

  // ensure lobby fields
  const lobbyRef = ref(db, `/lobbies/${code}`);
  const snap = await get(lobbyRef);
  if(!snap.exists()){
    await set(lobbyRef, {
      code, status:"waiting",
      host:{ uid: auth.currentUser?.uid, name: myName },
      createdAt: serverTimestamp(),
      updatedAt: getServerNow()
    });
  } else {
    const l = snap.val();
    if(!l.guest && l.host?.uid !== auth.currentUser?.uid){
      await update(lobbyRef, {
        guest:{ uid: auth.currentUser?.uid, name: myName },
        status:"playing",
        updatedAt: getServerNow()
      });
    } else {
      await update(lobbyRef, { updatedAt: getServerNow() });
    }
  }

  // watch lobby data
  unsubLobby = onValue(lobbyRef, (s) => {
    const lobby = s.val() || {};
    renderLobby(lobby);
    if(lobby.status==="closed"){
      statusText.textContent = "Комната закрыта";
    }
  });

  // presence watcher: обновление статуса и старт раунда
  const presenceRef = ref(db, `/presence/${code}`);
  unsubPresence = onValue(presenceRef, async (s) => {
    const pres = s.val() || {};
    const uids = Object.keys(pres||{});
    if(uids.length>=2){
      await ensureCurrentRound(code, 15000);
      await update(ref(db, `/lobbies/${code}`), { status:"playing", updatedAt:getServerNow() });
    } else if(uids.length===1){
      await update(ref(db, `/lobbies/${code}`), { status:"waiting", updatedAt:getServerNow() });
    } else {
      await update(ref(db, `/lobbies/${code}`), { status:"closed", updatedAt:getServerNow() });
    }
  });

  // watch currentRoundId
  const curRef = ref(db, `/lobbies/${code}/currentRoundId`);
  unsubRoundId = onValue(curRef, async (s) => {
    const roundId = s.val();
    myMoveOnce = false;
    clearInterval(roundTickTimer);
    if(!roundId){
      setRoundUIIdle();
      return;
    }
    if(unsubRound) { unsubRound(); unsubRound = null; }
    const rRef = ref(db, `/rounds/${code}/${roundId}`);
    unsubRound = onValue(rRef, (rs) => {
      const round = rs.val();
      if(!round) return;
      renderRound(round, code, roundId);
    });
  });
}

// ---------- Рендер лобби ----------
function renderLobby(lobby){
  hostName.textContent = lobby.host?.name ? `@${lobby.host.name}` : "@—";
  guestName.textContent = lobby.guest?.name ? `@${lobby.guest.name}` : "@—";
  hostAvatar.textContent = initial(lobby.host?.name || "");
  guestAvatar.textContent = initial(lobby.guest?.name || "");
  ensureScoreEl();
  updateScoreUI();

  const both = lobby.host?.uid && lobby.guest?.uid;
  if(!both){
    statusText.textContent = "Ожидание второго игрока…";
    timerEl.classList.add("hidden");
    choicesEl.querySelectorAll(".choice").forEach(b=>b.disabled=true);
  }
}

// ---------- Раунды ----------
async function ensureCurrentRound(code, ms){
  const newRoundId = push(child(ref(db), `rounds/${code}`)).key;
  const curRef = ref(db, `/lobbies/${code}/currentRoundId`);
  await runTransaction(curRef, (cur) => cur ?? newRoundId);
  const post = await get(curRef);
  const chosenId = post.val();
  if(chosenId === newRoundId){
    const deadline = getServerNow() + ms;
    await set(ref(db, `/rounds/${code}/${newRoundId}`), {
      deadline,
      moves:{},
    });
    await update(ref(db, `/lobbies/${code}`), { updatedAt:getServerNow() });
  }
}

function setRoundUIIdle(){
  statusText.textContent = "Ожидание раунда…";
  timerEl.classList.add("hidden");
  setChoicesEnabled(false);
  revealBox.classList.add("hidden");
  resultBanner.classList.add("hidden");
  choicesEl.querySelectorAll(".choice").forEach(b=>b.classList.remove("selected"));
}

function setChoicesEnabled(enabled){
  choicesEl.querySelectorAll(".choice").forEach(b=>b.disabled = !enabled);
}

function renderRound(round, code, roundId){
  const haveResult = !!round.result;

  timerEl.classList.remove("hidden");
  startTimer(round.deadline);

  const now = getServerNow();
  const left = Math.max(0, round.deadline - now);
  if(!haveResult && left>0){
    statusText.textContent = "Выберите ход";
    setChoicesEnabled(!myMoveOnce);
  } else if(!haveResult && left<=0){
    // Сразу фиксируем результат по дедлайну
    statusText.textContent = "Время вышло";
    setChoicesEnabled(false);
    attemptSetResult(code, roundId, round);
  } else if(haveResult){
    setChoicesEnabled(false);
    revealOutcome(round, code, roundId);
  }

  const mv = round.moves || {};
  if(!haveResult && Object.keys(mv).length>=2){
    attemptSetResult(code, roundId, round);
  }
}

function startTimer(deadlineMs){
  clearInterval(roundTickTimer);
  const tick = () => {
    const left = Math.max(0, deadlineMs - getServerNow());
    const sec = Math.ceil(left/1000);
    timerEl.textContent = sec.toString();
  };
  tick();
  roundTickTimer = setInterval(tick, 300);
}

async function attemptSetResult(code, roundId, round){
  const rRef = ref(db, `/rounds/${code}/${roundId}`);
  const snap = await get(rRef);
  const cur = snap.val();
  if(!cur || cur.result) return;
  const mv = cur.moves || {};
  const uids = Object.keys(mv);
  if(uids.length<2 && getServerNow() < cur.deadline) return;

  let uidA=null, uidB=null, moveA=null, moveB=null;
  if(uids.length>=2){
    [uidA, uidB] = uids;
    moveA = mv[uidA]; moveB = mv[uidB];
  } else if(uids.length===1){
    uidA = uids[0]; moveA = mv[uidA];
  }

  const d = decide(moveA, moveB);
  let winnerUid = null;
  if(d.winner==="a") winnerUid = uidA;
  if(d.winner==="b") winnerUid = uidB;

  // Проставим reasonKey "single_move_win" для UX, если победа из-за одного хода
  const singleMoveWin = (winnerUid && (!moveA || !moveB));
  const reasonKeyToSave = singleMoveWin ? "draw" : d.reasonKey; // текст под эмодзи остаётся нейтральным

  const before = await get(rRef);
  if(before.val()?.result) return;

  await update(rRef, {
    result:{
      winner: winnerUid ?? null,
      reasonKey: reasonKeyToSave,
      decidedAt: serverTimestamp()
    }
  });
  await update(ref(db, `/lobbies/${code}`), { updatedAt:getServerNow() });

  // Новая логика конца таймера:
  // - 0 ходов: “забавная фраза” и ручной “Реванш”.
  // - 1 ход: победитель определён, авто-переход не нужен.
  // - 2 хода и ничья: автозапуск нового раунда.
  if(!winnerUid) {
    if (d.reasonKey==="draw" && uids.length>=2) {
      autoNextRound(code, roundId, 10000);
    }
    // если no_moves — ждём реванш (UI покажет баннер без анимации)
  }
}

async function autoNextRound(code, prevRoundId, ms){
  await ensureEndedAndNewRound(code, prevRoundId, ms);
}

async function ensureEndedAndNewRound(code, prevRoundId, ms){
  const newId = push(child(ref(db), `rounds/${code}`)).key;
  const curRef = ref(db, `/lobbies/${code}/currentRoundId`);
  await runTransaction(curRef, () => newId);
  const post = await get(curRef);
  if(post.val() === newId){
    const deadline = getServerNow() + ms;
    await set(ref(db, `/rounds/${code}/${newId}`), { deadline, moves:{} });
    await update(ref(db, `/lobbies/${code}`), { updatedAt:getServerNow() });
  }
}

function ensureScoreEl(){
  if(scoreEl) return;
  const vs = document.querySelector(".vs");
  if(vs && !vs.dataset.enhanced){
    vs.dataset.enhanced = "1";
    scoreEl = document.createElement("div");
    scoreEl.id = "scoreBoard";
    scoreEl.style.fontWeight = "800";
    scoreEl.style.marginTop = "6px";
    scoreEl.style.textAlign = "center";
    scoreEl.style.color = "var(--text)";
    vs.insertAdjacentElement("afterend", scoreEl);
  }
}
function updateScoreUI(){
  if(!scoreEl) return;
  scoreEl.textContent = `Счёт: ${score.host} — ${score.guest}`;
}

function revealOutcome(round, code, roundId){
  const mv = round.moves || {};
  const uids = Object.keys(mv);
  const aUid = uids[0] || "x";
  const bUid = uids[1] || "y";
  const aMove = mv[aUid] || null;
  const bMove = mv[bUid] || null;
  const result = round.result;
  const winnerUid = result?.winner || null;
  const reasonKey = result?.reasonKey || "draw";

  // Кейс: никто не сходил — показываем забавную фразу и реванш, без анимации столкновения
  if(!winnerUid && reasonKey === "no_moves"){
    revealBox.classList.add("hidden");
    resultBanner.classList.remove("hidden");
    const funny = [
      "Оба задумались так глубоко, что забыли сходить 😅",
      "Похоже, гроссмейстерская пауза затянулась… ⏱️",
      "Ноль ходов — ноль проблем. Попробуем ещё раз?",
      "Кто не рискует — тот не выбирает. Реванш?",
      "Игра назначила техническую паузу. На реванш!"
    ];
    resultText.textContent = funny[Math.floor(Math.random()*funny.length)];
    statusText.textContent = "Время вышло: никто не сходил. Нажмите «Реванш».";
    return;
  }

  revealBox.classList.remove("hidden");
  resultBanner.classList.add("hidden");
  // новая анимация столкновения: подход "vs-battle"
  revealLeft.className = "emoji left slide-in-left";
  revealRight.className = "emoji right slide-in-right";
  revealLeft.textContent = aMove ? MOVE_EMOJI[aMove] : "❌";
  revealRight.textContent = bMove ? MOVE_EMOJI[bMove] : "❌";
  // Если победа из-за одного хода, не показываем "Ничья" под эмодзи
  const showReason = (!winnerUid && reasonKey==="draw") ? REASONS_RU[reasonKey] : (winnerUid ? "" : (REASONS_RU[reasonKey] || ""));
  reasonText.textContent = showReason;
  // добавить эффекты удара после входа
  setTimeout(() => {
    revealLeft.classList.add("battle-shake");
    revealRight.classList.add("battle-shake");
    setTimeout(() => {
      revealLeft.classList.remove("battle-shake");
      revealRight.classList.remove("battle-shake");
    }, 350);
  }, 450);

  if(winnerUid){
    const leftWins = winnerUid === aUid;
    // победитель подпрыгивает и пульсирует, проигравший — затухает
    revealLeft.classList.add(leftWins ? "win" : "lose");
    revealRight.classList.add(leftWins ? "lose" : "win");
    setTimeout(() => {
      if(leftWins){
        revealLeft.classList.add("victory-pop");
        revealRight.classList.add("defeat-fade");
      } else {
        revealRight.classList.add("victory-pop");
        revealLeft.classList.add("defeat-fade");
      }
    }, 800);

    // обновить локальный счёт
    get(ref(db, `/lobbies/${currentCode}`)).then((s)=>{
      const lobby = s.val()||{};
      if(winnerUid===lobby.host?.uid) score.host++;
      if(winnerUid===lobby.guest?.uid) score.guest++;
      updateScoreUI();
    });
  }

  (async () => {
    await sleep(900);
    if(!winnerUid){
      // ничья при двух ходах — показываем авто-новый раунд
      revealBox.classList.add("hidden");
      statusText.textContent = "Ничья. Новый раунд…";
      return;
    }
    get(ref(db, `/lobbies/${currentCode}`)).then((s)=>{
      const lobby = s.val()||{};
      const wname = winnerUid===lobby.host?.uid ? lobby.host?.name : winnerUid===lobby.guest?.uid ? lobby.guest?.name : "Игрок";
      resultText.textContent = `@${wname} победил`;
      resultBanner.classList.remove("hidden");
      statusText.textContent = "Раунд завершён";
      // очистим подпись причины под эмодзи, чтобы не оставалось "Ничья"
      reasonText.textContent = "";
    });
  })();
}

async function submitMove(move){
  if(myMoveOnce) return;
  if(!MOVES.includes(move)) return;
  const code = currentCode;
  const curIdSnap = await get(ref(db, `/lobbies/${code}/currentRoundId`));
  const roundId = curIdSnap.val();
  if(!roundId) return;

  const roundSnap = await get(ref(db, `/rounds/${code}/${roundId}`));
  const round = roundSnap.val();
  if(!round) return;
  if(getServerNow() >= round.deadline) return;

  const myPath = ref(db, `/rounds/${code}/${roundId}/moves/${auth.currentUser?.uid}`);
  const existing = (await get(myPath)).val();
  if(existing) return;

  await set(myPath, move);
  myMoveOnce = true;
  markSelected(move);
  setChoicesEnabled(false);
}

function markSelected(move){
  choicesEl.querySelectorAll(".choice").forEach(b=>{
    b.classList.toggle("selected", b.dataset.move===move);
  });
}

async function startRematch(){
  if(!currentCode) return;
  const curRef = ref(db, `/lobbies/${currentCode}/currentRoundId`);
  const curId = (await get(curRef)).val();
  if(!curId){ await ensureCurrentRound(currentCode, 15000); return; }
  const rSnap = await get(ref(db, `/rounds/${currentCode}/${curId}`));
  const round = rSnap.val();
  if(!round?.result) return;
  await ensureEndedAndNewRound(currentCode, curId, 15000);
  revealBox.classList.add("hidden");
  resultBanner.classList.add("hidden");
  statusText.textContent = "Новый раунд…";
}

async function leaveToNew(){
  cleanupRoomWatchers();
  currentCode = null;
  roomSection.classList.add("hidden");
  byId("about").classList.remove("hidden");
  byId("lobbyActions").classList.remove("hidden");

  const u = new URL(location.href);
  u.searchParams.delete("room");
  history.replaceState({}, "", u.toString());
}

function cleanupRoomWatchers(){
  unsubLobby && unsubLobby(); unsubLobby=null;
  unsubPresence && unsubPresence(); unsubPresence=null;
  unsubRoundId && unsubRoundId(); unsubRoundId=null;
  unsubRound && unsubRound(); unsubRound=null;
  clearInterval(roundTickTimer); roundTickTimer = null;
}

// обновление отображаемых имён/аватаров при смене ника
function renderNames(){
  if(!currentCode) return;
  get(ref(db, `/lobbies/${currentCode}`)).then(async s=>{
    const l = s.val()||{};
    if(l.host?.uid===auth.currentUser?.uid){
      await update(ref(db, `/lobbies/${currentCode}`), { host:{ uid: auth.currentUser.uid, name: myName }, updatedAt:getServerNow() });
    } else if(l.guest?.uid===auth.currentUser?.uid){
      await update(ref(db, `/lobbies/${currentCode}`), { guest:{ uid: auth.currentUser.uid, name: myName }, updatedAt:getServerNow() });
    }
    hostName.textContent = l.host?.name ? `@${l.host.name}` : "@—";
    guestName.textContent = l.guest?.name ? `@${l.guest.name}` : "@—";
    hostAvatar.textContent = initial(l.host?.name || "");
    guestAvatar.textContent = initial(l.guest?.name || "");
  });
}
