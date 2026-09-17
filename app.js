/* Paros ritmas — dienos juosta, iprociai ir produktyvumo apzvalga.
   Veikia dviem budais:
   - savarankiskai (PWA): duomenys localStorage, atsargine kopija per JSON;
   - Claude artefakte: papildomai sinchronizuoja per `db` gebejima. */
(function () {
  "use strict";

  var LS = "paros-ritmas:";
  var WEEKDAYS = ["Sekmadienis", "Pirmadienis", "Antradienis", "Trečiadienis", "Ketvirtadienis", "Penktadienis", "Šeštadienis"];
  var WSHORT = ["P", "A", "T", "K", "P", "Š", "S"];

  var DEFAULT_BLOCKS = [
    { id: "b1", start: "06:30", end: "07:15", title: "Rytas, pusryčiai", kind: "life" },
    { id: "b2", start: "07:15", end: "08:00", title: "Kelias į darbą", kind: "life" },
    { id: "b3", start: "08:00", end: "17:00", title: "Darbas", kind: "work" },
    { id: "b4", start: "17:00", end: "18:30", title: "Namai, vakarienė", kind: "life" },
    { id: "b5", start: "18:30", end: "20:15", title: "Laisvas laikas, namų reikalai", kind: "life" },
    { id: "b6", start: "20:15", end: "21:45", title: "Sporto salė", kind: "habit", habit: "gym" },
    { id: "b7", start: "21:45", end: "22:20", title: "Dušas, atvėsimas", kind: "life" },
    { id: "b8", start: "22:20", end: "23:00", title: "Skaitymas", kind: "habit", habit: "read" }
  ];

  var DEFAULT_HABITS = [
    { id: "gym", name: "Sporto salė", type: "weekly", target: 4, color: "gym", hint: "Vakare, apie 20:15" },
    { id: "read", name: "Skaitymas", type: "daily", target: 7, color: "read", hint: "Knyga prieš miegą" },
    { id: "sleep", name: "Miegas laiku", type: "daily", target: 7, color: "sleep", hint: "Gulti iki 23:00" }
  ];

  var state = {
    date: iso(new Date()),
    blocks: DEFAULT_BLOCKS.map(clone),
    habits: DEFAULT_HABITS.map(clone),
    day: emptyDay(),
    tab: "diena",
    openNote: null
  };
  var days = {};
  var db = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseIso(s) { var p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function shiftDays(isoStr, n) { var d = parseIso(isoStr); d.setDate(d.getDate() + n); return iso(d); }
  function mins(t) { var p = String(t || "0:00").split(":"); return (+p[0] || 0) * 60 + (+p[1] || 0); }
  function nowMins() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function today() { return iso(new Date()); }
  function isToday() { return state.date === today(); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function weekStart(isoStr) {
    var d = parseIso(isoStr);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return iso(d);
  }
  function emptyDay() { return { habits: {}, blocks: {}, notes: {}, reflection: { rate: 0, q1: "", q2: "" } }; }

  function normalize(raw) {
    var d = emptyDay();
    if (!raw) return d;
    if (raw.habits && typeof raw.habits === "object") d.habits = raw.habits;
    if (raw.blocks && typeof raw.blocks === "object") d.blocks = raw.blocks;
    if (raw.notes && typeof raw.notes === "object") d.notes = raw.notes;
    if (raw.reflection) {
      d.reflection.rate = +raw.reflection.rate || 0;
      d.reflection.q1 = raw.reflection.q1 || "";
      d.reflection.q2 = raw.reflection.q2 || "";
    }
    return d;
  }

  /* ---------- saugojimas ---------- */

  function lsGet(k) {
    try { var r = localStorage.getItem(LS + k); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { /* privatus langas */ }
  }

  var timers = {}, writing = {};

  function save(kind) {
    var key = kind === "day" ? "day:" + state.date : kind;
    var date = state.date;
    if (kind === "day") { days[date] = state.day; lsSet("day:" + date, state.day); }
    else if (kind === "blocks") lsSet("blocks", state.blocks);
    else if (kind === "habits") lsSet("habits", state.habits);
    if (timers[key]) clearTimeout(timers[key]);
    timers[key] = setTimeout(function () { timers[key] = null; push(kind, key, date); }, 700);
  }

  function push(kind, key, date) {
    if (!db || writing[key]) return;
    writing[key] = true;
    var ref, body;
    if (kind === "day") {
      ref = db.doc("days/" + date);
      body = Object.assign({ date: date, updated: new Date().toISOString() }, state.day);
    } else if (kind === "blocks") {
      ref = db.doc("plan/blocks");
      body = { blocks: state.blocks, updated: new Date().toISOString() };
    } else {
      ref = db.doc("plan/habits");
      body = { habits: state.habits, updated: new Date().toISOString() };
    }
    ref.set(body)["catch"](function () { /* be rysio lieka vietine kopija */ })
      .then(function () { writing[key] = false; });
  }

  function loadLocal() {
    var b = lsGet("blocks"); if (b && b.length) state.blocks = b;
    var h = lsGet("habits"); if (h && h.length) state.habits = h;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(LS + "day:") === 0) {
          days[k.slice((LS + "day:").length)] = normalize(JSON.parse(localStorage.getItem(k)));
        }
      }
    } catch (e) { /* saugykla nepasiekiama */ }
    state.day = days[state.date] ? normalize(days[state.date]) : emptyDay();
    days[state.date] = state.day;
  }

  function connect() {
    if (!window.claude || typeof window.claude.use !== "function") return;
    window.claude.use("db").then(function (handle) {
      if (!handle) return;
      db = handle;
      var note = document.getElementById("storageNote");
      if (note) {
        note.textContent = "Blokai galioja visoms dienoms. Duomenys sinchronizuojami tarp įrenginių.";
      }
      db.doc("plan/blocks").get().then(function (s) {
        if (s.exists && Array.isArray(s.data().blocks) && s.data().blocks.length) {
          state.blocks = s.data().blocks; lsSet("blocks", state.blocks); renderAll();
        } else { save("blocks"); }
      })["catch"](function () {});
      db.doc("plan/habits").get().then(function (s) {
        if (s.exists && Array.isArray(s.data().habits) && s.data().habits.length) {
          state.habits = s.data().habits; lsSet("habits", state.habits); renderAll();
        } else { save("habits"); }
      })["catch"](function () {});
      db.collection("days").orderBy("date", "desc").limit(60).get().then(function (snap) {
        snap.docs.forEach(function (doc) {
          var remote = normalize(doc.data());
          var local = days[doc.id];
          if (!local || weight(remote) >= weight(local)) {
            days[doc.id] = remote;
            lsSet("day:" + doc.id, remote);
          }
        });
        state.day = days[state.date] || emptyDay();
        days[state.date] = state.day;
        renderAll();
      })["catch"](function () {});
    })["catch"](function () {});
  }

  function weight(d) {
    var n = Object.keys(d.habits).length * 2 + Object.keys(d.blocks).length;
    if (d.reflection.rate) n += 1;
    if ((d.reflection.q1 + d.reflection.q2).length) n += 2;
    return n;
  }

  function dayOf(isoStr) { return days[isoStr] || null; }

  function goDay(isoStr) {
    state.date = isoStr;
    state.openNote = null;
    state.day = days[isoStr] ? normalize(days[isoStr]) : emptyDay();
    days[isoStr] = state.day;
    renderAll();
    if (!db) return;
    db.doc("days/" + isoStr).get().then(function (s) {
      if (!s.exists || state.date !== isoStr) return;
      var remote = normalize(s.data());
      if (weight(remote) > weight(state.day)) {
        state.day = remote; days[isoStr] = remote; lsSet("day:" + isoStr, remote); renderAll();
      }
    })["catch"](function () {});
  }

  /* ---------- skaiciavimai ---------- */

  function habitById(id) {
    for (var i = 0; i < state.habits.length; i++) if (state.habits[i].id === id) return state.habits[i];
    return null;
  }
  function isHabitDone(habitId, isoStr) {
    var d = dayOf(isoStr);
    return !!(d && d.habits && d.habits[habitId]);
  }
  function sortedBlocks() {
    return state.blocks.slice().sort(function (a, b) { return mins(a.start) - mins(b.start); });
  }
  function blockPhase(b) {
    if (!isToday()) return state.date < today() ? "past" : "future";
    var n = nowMins();
    if (n >= mins(b.end)) return "past";
    if (n >= mins(b.start)) return "live";
    return "future";
  }

  function dayScore(isoStr) {
    var d = dayOf(isoStr);
    var max = state.habits.length * 2 + state.blocks.length;
    if (!max || !d) return 0;
    var got = 0, i;
    for (i = 0; i < state.habits.length; i++) if (d.habits[state.habits[i].id]) got += 2;
    for (i = 0; i < state.blocks.length; i++) if (d.blocks[state.blocks[i].id]) got += 1;
    return Math.round((got / max) * 100);
  }

  function weeklyCount(habitId, wsIso) {
    var n = 0;
    for (var i = 0; i < 7; i++) if (isHabitDone(habitId, shiftDays(wsIso, i))) n++;
    return n;
  }

  function streakOf(habit) {
    var i;
    if (habit.type === "weekly") {
      var ws = weekStart(today()), weeks = 0;
      if (weeklyCount(habit.id, ws) < habit.target) ws = shiftDays(ws, -7);
      for (i = 0; i < 80; i++) {
        if (weeklyCount(habit.id, ws) >= habit.target) { weeks++; ws = shiftDays(ws, -7); } else break;
      }
      return weeks;
    }
    var d = today(), n = 0;
    if (!isHabitDone(habit.id, d)) d = shiftDays(d, -1);
    for (i = 0; i < 400; i++) {
      if (isHabitDone(habit.id, d)) { n++; d = shiftDays(d, -1); } else break;
    }
    return n;
  }

  function streakLabel(habit) {
    var n = streakOf(habit);
    if (habit.type === "weekly") return n ? n + " sav. serija" : "serijos nėra";
    return n ? n + " d. serija" : "serijos nėra";
  }

  /* ---------- piesimas ---------- */

  function renderHeader() {
    var d = parseIso(state.date);
    document.getElementById("weekday").textContent = WEEKDAYS[d.getDay()];
    var badge = "";
    if (isToday()) badge = "šiandien";
    else if (state.date === shiftDays(today(), -1)) badge = "vakar";
    else if (state.date === shiftDays(today(), 1)) badge = "rytoj";
    document.getElementById("datestamp").innerHTML = esc(state.date) + (badge ? ' <span class="badge">' + badge + "</span>" : "");

    var pct = dayScore(state.date), circ = 2 * Math.PI * 23;
    var arc = document.getElementById("ringArc");
    arc.setAttribute("stroke-dasharray", circ.toFixed(1));
    arc.setAttribute("stroke-dashoffset", (circ * (1 - pct / 100)).toFixed(1));
    document.getElementById("ringVal").textContent = pct + "%";

    var ws = weekStart(state.date), html = "";
    for (var i = 0; i < 7; i++) {
      var isoI = shiftDays(ws, i);
      var sc = dayScore(isoI);
      var future = isoI > today();
      html += '<button class="wday" data-goto="' + isoI + '"' +
        ' aria-selected="' + (isoI === state.date ? "true" : "false") + '"' +
        ' aria-current="' + (isoI === today() ? "true" : "false") + '">' +
        '<span class="wl">' + WSHORT[i] + "</span>" +
        '<span class="wdot' + (sc >= 60 ? " filled" : "") + '">' + (future ? "·" : (sc ? sc : "")) + "</span></button>";
    }
    document.getElementById("weekstrip").innerHTML = html;

    var bd = 0, hd = 0, j;
    for (j = 0; j < state.blocks.length; j++) if (state.day.blocks[state.blocks[j].id]) bd++;
    for (j = 0; j < state.habits.length; j++) if (state.day.habits[state.habits[j].id]) hd++;
    document.getElementById("blocksDone").textContent = bd + " / " + state.blocks.length + " pažymėta";
    document.getElementById("habitsDone").textContent = hd + " / " + state.habits.length + " atlikta";
  }

  function tagFor(b) {
    if (b.kind === "work") return '<span class="blk-tag tag-work">darbas</span>';
    if (b.kind === "habit" && b.habit) {
      var h = habitById(b.habit);
      if (h) return '<span class="blk-tag tag-' + esc(h.color || "gym") + '">' + esc(h.name) + "</span>";
    }
    return "";
  }

  function renderNow() {
    var card = document.getElementById("nowCard");
    var label = document.getElementById("nowLabel"), title = document.getElementById("nowTitle");
    var sub = document.getElementById("nowSub"), note = document.getElementById("nowNote");
    var blocks = sortedBlocks();

    if (!blocks.length) {
      card.classList.add("idle");
      label.textContent = "Blokų nėra"; title.textContent = "Susidėk paros blokus";
      sub.textContent = "Mygtukas ⚙ viršuje"; note.textContent = "";
      return;
    }
    if (!isToday()) {
      card.classList.add("idle");
      label.textContent = state.date < today() ? "Praėjusi diena" : "Būsima diena";
      title.textContent = dayScore(state.date) + "% dienos užpildyta";
      sub.textContent = blocks[0].start + "–" + blocks[blocks.length - 1].end;
      note.textContent = "";
      return;
    }

    var live = null, next = null, n = nowMins();
    for (var i = 0; i < blocks.length; i++) {
      if (blockPhase(blocks[i]) === "live") { live = blocks[i]; break; }
      if (!next && mins(blocks[i].start) > n) next = blocks[i];
    }
    if (live) {
      card.classList.remove("idle");
      label.textContent = "Dabar";
      title.textContent = live.title;
      sub.textContent = live.start + "–" + live.end + " · liko " + (mins(live.end) - n) + " min";
      var txt = state.day.notes[live.id];
      note.innerHTML = txt ? esc(txt)
        : '<span style="color:var(--muted)">Paspausk bloką juostoje ir įrašyk, kas jame vyksta.</span>';
    } else {
      card.classList.add("idle");
      if (next) {
        label.textContent = "Toliau";
        title.textContent = next.title;
        sub.textContent = "Prasideda " + next.start + " · po " + (mins(next.start) - n) + " min";
      } else {
        label.textContent = "Para uždaryta";
        title.textContent = dayScore(state.date) + "% dienos užpildyta";
        sub.textContent = "Liko vakaro įrašas apžvalgoje";
      }
      note.textContent = "";
    }
  }

  function renderTimeline() {
    var wrap = document.getElementById("timeline");
    var blocks = sortedBlocks();
    if (!blocks.length) { wrap.innerHTML = '<p class="empty">Blokų nėra. Susidėk juos per ⚙ viršuje.</p>'; return; }
    var html = "";
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var phase = blockPhase(b);
      var on = !!state.day.blocks[b.id];
      var prog = "";
      if (phase === "live") {
        var span = Math.max(1, mins(b.end) - mins(b.start));
        var p = Math.min(100, Math.round(((nowMins() - mins(b.start)) / span) * 100));
        prog = '<div class="blk-prog"><i style="width:' + p + '%"></i></div>';
      }
      var txt = state.day.notes[b.id];
      var noteLine = txt ? '<div class="blk-note">' + esc(txt) + "</div>" : "";
      var editor = "";
      if (state.openNote === b.id) {
        editor = '<div class="note-edit">' +
          '<input type="text" id="note-' + esc(b.id) + '" placeholder="Kas vyksta šiame bloke?" value="' + esc(txt || "") + '">' +
          '<div class="row-actions"><button class="btn small" data-save-note="' + esc(b.id) + '">Įrašyti</button>' +
          '<button class="btn ghost small" data-cancel-note="1">Atšaukti</button></div></div>';
      }
      html += '<div class="blk ' + phase + (on ? " checked" : "") + '">' +
        '<div class="blk-time">' + esc(b.start) + '<span class="blk-end">' + esc(b.end) + "</span></div>" +
        '<div class="blk-body"><button class="blk-title" data-block="' + esc(b.id) + '">' +
        esc(b.title) + tagFor(b) + "</button>" + noteLine + prog + editor + "</div>" +
        '<button class="tick' + (on ? " on" : "") + '" data-toggle-block="' + esc(b.id) +
        '" aria-label="Pažymėti bloką atliktą" aria-pressed="' + (on ? "true" : "false") + '">✓</button></div>';
    }
    wrap.innerHTML = html;
  }

  function renderHabits() {
    var wrap = document.getElementById("habitList");
    if (!state.habits.length) { wrap.innerHTML = '<p class="empty">Įpročių nėra. Pridėk žemiau.</p>'; return; }
    var ws = weekStart(state.date), html = "";
    for (var i = 0; i < state.habits.length; i++) {
      var h = state.habits[i];
      var on = !!state.day.habits[h.id];
      var streak = streakOf(h);
      var week = "";
      for (var j = 0; j < 7; j++) {
        var isoJ = shiftDays(ws, j);
        var done = isHabitDone(h.id, isoJ);
        week += '<button class="hday ' + esc(h.color || "gym") + (done ? " done" : "") +
          (isoJ === today() ? " today" : "") + (isoJ > today() ? " future" : "") +
          '" data-habit-day="' + esc(h.id) + "|" + isoJ + '" aria-label="' + esc(h.name) + " " + isoJ +
          '" aria-pressed="' + (done ? "true" : "false") + '">' + WSHORT[j] + "</button>";
      }
      var cnt = weeklyCount(h.id, ws);
      var target = h.type === "weekly" ? h.target : 7;
      var pct = Math.min(100, Math.round((cnt / target) * 100));
      html += '<div class="habit">' +
        '<div class="habit-head"><div class="habit-main"><div class="habit-name">' + esc(h.name) + "</div>" +
        (h.hint ? '<div class="habit-hint">' + esc(h.hint) + "</div>" : "") + "</div>" +
        '<span class="streak ' + (streak ? "hot" : "cold") + '">' + esc(streakLabel(h)) + "</span></div>" +
        '<div class="habit-week">' + week + "</div>" +
        '<div class="habit-foot"><span>' + cnt + " / " + target + " šią savaitę</span>" +
        '<span class="goalbar"><i style="width:' + pct + '%"></i></span>' +
        '<button class="btn' + (on ? " ghost" : "") + ' small" data-toggle-habit="' + esc(h.id) + '">' +
        (on ? "Atžymėti" : "Atlikta") + "</button></div></div>";
    }
    wrap.innerHTML = html;
  }

  function renderOverview() {
    var i, sum = 0, cnt = 0;
    for (i = 0; i < 7; i++) {
      var d7 = shiftDays(today(), -i);
      if (dayOf(d7)) { sum += dayScore(d7); cnt++; }
    }
    document.getElementById("statAvg").textContent = cnt ? Math.round(sum / cnt) + "%" : "–";

    var best = null, bestN = -1;
    for (i = 0; i < state.habits.length; i++) {
      var n = streakOf(state.habits[i]);
      if (n > bestN) { bestN = n; best = state.habits[i]; }
    }
    document.getElementById("statStreak").textContent = bestN > 0 ? bestN : "0";
    document.getElementById("statStreakLabel").textContent = (best && bestN > 0)
      ? best.name + (best.type === "weekly" ? ", savaitės" : ", dienos") : "Ilgiausia serija";

    var ws = weekStart(today()), full = 0;
    for (i = 0; i < 7; i++) if (dayScore(shiftDays(ws, i)) >= 80) full++;
    document.getElementById("statWeek").textContent = full;
    document.getElementById("weekRange").textContent = ws.slice(5) + " – " + shiftDays(ws, 6).slice(5);

    var bars = "";
    for (i = 0; i < 7; i++) {
      var isoI = shiftDays(ws, i);
      var sc = dayScore(isoI);
      var future = isoI > today();
      var hgt = Math.max(3, Math.round((sc / 100) * 72));
      bars += '<div class="bar"><i class="' + (future || !sc ? "dim" : "") + '" style="height:' +
        (future ? 3 : hgt) + 'px"></i><b>' + WSHORT[i] + "</b></div>";
    }
    document.getElementById("weekBars").innerHTML = bars;

    var head = "";
    for (i = 0; i < 7; i++) head += '<div class="heat-h">' + WSHORT[i] + "</div>";
    document.getElementById("heatHead").innerHTML = head;

    var start = shiftDays(weekStart(today()), -28), cells = "";
    for (i = 0; i < 35; i++) {
      var isoC = shiftDays(start, i);
      var scC = dayScore(isoC);
      var lvl = scC >= 85 ? "l4" : scC >= 60 ? "l3" : scC >= 35 ? "l2" : scC > 0 ? "l1" : "";
      cells += '<button class="hcell ' + lvl + (isoC === today() ? " today" : "") +
        (isoC > today() ? " blank" : "") + '" data-goto="' + isoC + '" title="' + isoC + ": " + scC +
        '%">' + parseIso(isoC).getDate() + "</button>";
    }
    document.getElementById("heat").innerHTML = cells;

    var r = state.day.reflection;
    var btns = document.querySelectorAll("#rate button");
    for (i = 0; i < btns.length; i++) {
      btns[i].setAttribute("aria-pressed", (+btns[i].getAttribute("data-v") === r.rate) ? "true" : "false");
    }
    ["q1", "q2"].forEach(function (k) {
      var el = document.getElementById(k);
      if (document.activeElement !== el) el.value = r[k] || "";
    });
  }

  function renderAll() { renderHeader(); renderNow(); renderTimeline(); renderHabits(); renderOverview(); }

  /* ---------- saveika ---------- */

  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (btn) {
    btn.addEventListener("click", function () {
      state.tab = btn.getAttribute("data-tab");
      Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      ["diena", "iprociai", "apzvalga"].forEach(function (name) {
        document.getElementById("panel-" + name).hidden = (name !== state.tab);
      });
      window.scrollTo(0, 0);
    });
  });

  document.getElementById("weekstrip").addEventListener("click", function (e) {
    var b = e.target.closest("[data-goto]");
    if (b) goDay(b.getAttribute("data-goto"));
  });

  document.getElementById("timeline").addEventListener("click", function (e) {
    var tog = e.target.closest("[data-toggle-block]");
    if (tog) {
      var bid = tog.getAttribute("data-toggle-block"), blk = null;
      for (var i = 0; i < state.blocks.length; i++) if (state.blocks[i].id === bid) blk = state.blocks[i];
      if (state.day.blocks[bid]) {
        delete state.day.blocks[bid];
        if (blk && blk.habit) delete state.day.habits[blk.habit];
      } else {
        state.day.blocks[bid] = true;
        if (blk && blk.habit) state.day.habits[blk.habit] = true;
      }
      save("day"); renderHeader(); renderTimeline(); renderHabits(); renderOverview();
      return;
    }
    var t = e.target.closest("[data-block]");
    if (t) {
      var id = t.getAttribute("data-block");
      state.openNote = (state.openNote === id) ? null : id;
      renderTimeline();
      var inp = document.getElementById("note-" + state.openNote);
      if (inp) inp.focus();
      return;
    }
    var sv = e.target.closest("[data-save-note]");
    if (sv) {
      var nid = sv.getAttribute("data-save-note");
      var field = document.getElementById("note-" + nid);
      var val = field ? field.value.trim() : "";
      if (val) state.day.notes[nid] = val; else delete state.day.notes[nid];
      state.openNote = null;
      save("day"); renderNow(); renderTimeline();
      return;
    }
    if (e.target.closest("[data-cancel-note]")) { state.openNote = null; renderTimeline(); }
  });

  document.getElementById("habitList").addEventListener("click", function (e) {
    var t = e.target.closest("[data-toggle-habit]");
    if (t) {
      var id = t.getAttribute("data-toggle-habit");
      if (state.day.habits[id]) delete state.day.habits[id]; else state.day.habits[id] = true;
      syncBlocks(id, state.date);
      save("day"); renderHeader(); renderHabits(); renderTimeline(); renderOverview();
      return;
    }
    var cell = e.target.closest("[data-habit-day]");
    if (cell) {
      var parts = cell.getAttribute("data-habit-day").split("|");
      var hid = parts[0], dIso = parts[1];
      if (dIso > today()) return;
      var target = (dIso === state.date) ? state.day : (days[dIso] ? normalize(days[dIso]) : emptyDay());
      if (target.habits[hid]) delete target.habits[hid]; else target.habits[hid] = true;
      days[dIso] = target;
      if (dIso === state.date) {
        state.day = target; syncBlocks(hid, dIso); save("day");
      } else {
        lsSet("day:" + dIso, target);
        if (db) {
          db.doc("days/" + dIso).set(Object.assign({ date: dIso, updated: new Date().toISOString() }, target))["catch"](function () {});
        }
      }
      renderHeader(); renderHabits(); renderTimeline(); renderOverview();
    }
  });

  function syncBlocks(habitId, dIso) {
    if (dIso !== state.date) return;
    for (var i = 0; i < state.blocks.length; i++) {
      var b = state.blocks[i];
      if (b.habit !== habitId) continue;
      if (state.day.habits[habitId]) state.day.blocks[b.id] = true;
      else delete state.day.blocks[b.id];
    }
  }

  document.getElementById("rate").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]");
    if (!b) return;
    var v = +b.getAttribute("data-v");
    state.day.reflection.rate = (state.day.reflection.rate === v) ? 0 : v;
    save("day"); renderOverview();
  });
  ["q1", "q2"].forEach(function (k) {
    document.getElementById(k).addEventListener("input", function (e) {
      state.day.reflection[k] = e.target.value;
      save("day");
    });
  });
  document.getElementById("heat").addEventListener("click", function (e) {
    var c = e.target.closest("[data-goto]");
    if (!c) return;
    var d = c.getAttribute("data-goto");
    if (d > today()) return;
    goDay(d);
    document.querySelector('.tab[data-tab="diena"]').click();
  });

  /* ---------- blokai ---------- */

  var blocksDlg = document.getElementById("blocksDlg");
  var bDraft = [];

  function renderBlockRows() {
    var html = "";
    for (var i = 0; i < bDraft.length; i++) {
      var b = bDraft[i];
      html += '<div class="brow" data-i="' + i + '">' +
        '<input type="time" value="' + esc(b.start) + '" data-f="start" aria-label="Pradžia">' +
        '<input type="time" value="' + esc(b.end) + '" data-f="end" aria-label="Pabaiga">' +
        '<input type="text" class="tname" value="' + esc(b.title) + '" data-f="title" aria-label="Pavadinimas">' +
        '<button class="del" data-rm="' + i + '" aria-label="Trinti bloką">×</button></div>';
    }
    document.getElementById("blockRows").innerHTML = html;
  }

  document.getElementById("openMenu").addEventListener("click", function () {
    bDraft = sortedBlocks().map(clone);
    renderBlockRows();
    document.getElementById("backupBox").value = "";
    document.getElementById("backupMsg").textContent = "";
    blocksDlg.showModal();
  });
  document.getElementById("closeBlocks").addEventListener("click", function () { blocksDlg.close(); });
  document.getElementById("addBlock").addEventListener("click", function () {
    bDraft.push({ id: uid(), start: "21:00", end: "22:00", title: "Naujas blokas", kind: "life" });
    renderBlockRows();
  });
  document.getElementById("resetBlocks").addEventListener("click", function () {
    bDraft = DEFAULT_BLOCKS.map(clone); renderBlockRows();
  });
  document.getElementById("blockRows").addEventListener("click", function (e) {
    var rm = e.target.closest("[data-rm]");
    if (!rm) return;
    bDraft.splice(+rm.getAttribute("data-rm"), 1); renderBlockRows();
  });
  document.getElementById("blockRows").addEventListener("input", function (e) {
    var row = e.target.closest(".brow");
    if (!row) return;
    bDraft[+row.getAttribute("data-i")][e.target.getAttribute("data-f")] = e.target.value;
  });
  document.getElementById("saveBlocks").addEventListener("click", function () {
    state.blocks = bDraft.filter(function (b) { return String(b.title).trim(); });
    save("blocks"); blocksDlg.close(); renderAll();
  });

  /* ---------- iprociai ---------- */

  var habitsDlg = document.getElementById("habitsDlg");
  var hDraft = [];

  function renderHabitRows() {
    var html = "";
    for (var i = 0; i < hDraft.length; i++) {
      var h = hDraft[i];
      html += '<div class="hrow" data-i="' + i + '">' +
        '<input type="text" value="' + esc(h.name) + '" data-f="name" aria-label="Pavadinimas">' +
        '<select data-f="type" aria-label="Ritmas">' +
        '<option value="daily"' + (h.type === "daily" ? " selected" : "") + ">kasdien</option>" +
        '<option value="weekly"' + (h.type === "weekly" ? " selected" : "") + ">savaitinis</option></select>" +
        '<input type="number" min="1" max="7" value="' + (+h.target || 7) + '" data-f="target" aria-label="Kartai per savaitę">' +
        '<button class="del" data-rm="' + i + '" aria-label="Trinti įprotį">×</button></div>';
    }
    document.getElementById("habitRows").innerHTML = html;
  }

  document.getElementById("openHabits").addEventListener("click", function () {
    hDraft = state.habits.map(clone); renderHabitRows(); habitsDlg.showModal();
  });
  document.getElementById("closeHabits").addEventListener("click", function () { habitsDlg.close(); });
  document.getElementById("addHabit").addEventListener("click", function () {
    hDraft.push({ id: uid(), name: "Naujas įprotis", type: "daily", target: 7, color: "gym", hint: "" });
    renderHabitRows();
  });
  document.getElementById("habitRows").addEventListener("click", function (e) {
    var rm = e.target.closest("[data-rm]");
    if (!rm) return;
    hDraft.splice(+rm.getAttribute("data-rm"), 1); renderHabitRows();
  });
  document.getElementById("habitRows").addEventListener("input", function (e) {
    var row = e.target.closest(".hrow");
    if (!row) return;
    var f = e.target.getAttribute("data-f");
    hDraft[+row.getAttribute("data-i")][f] = (f === "target") ? (+e.target.value || 1) : e.target.value;
  });
  document.getElementById("habitRows").addEventListener("change", function (e) {
    var row = e.target.closest(".hrow");
    if (!row || e.target.getAttribute("data-f") !== "type") return;
    hDraft[+row.getAttribute("data-i")].type = e.target.value;
  });
  document.getElementById("saveHabits").addEventListener("click", function () {
    state.habits = hDraft.filter(function (h) { return String(h.name).trim(); }).map(function (h) {
      if (h.type === "daily") h.target = 7;
      if (!h.color) h.color = "gym";
      return h;
    });
    save("habits"); habitsDlg.close(); renderAll();
  });

  /* ---------- atsargine kopija ---------- */

  function snapshot() {
    return { app: "paros-ritmas", version: 1, exported: new Date().toISOString(),
      blocks: state.blocks, habits: state.habits, days: days };
  }

  var inArtifact = !!(window.claude && typeof window.claude.use === "function");

  function saveFile(json, msg) {
    var name = "paros-ritmas-" + today() + ".json";
    if (inArtifact) {
      /* artefakto lange faila paduoda tik `downloads` gebejimas */
      window.claude.use("downloads").then(function (dl) {
        if (!dl) { msg.textContent = "Kopija paruošta žemiau, nusikopijuok tekstą."; return; }
        dl.save({ filename: name, data: json }).then(function () {
          msg.textContent = "Failas išsaugotas. Tekstas žemiau, jei reikia nusikopijuoti.";
        })["catch"](function () {
          msg.textContent = "Kopija paruošta žemiau, nusikopijuok tekstą.";
        });
      })["catch"](function () {
        msg.textContent = "Kopija paruošta žemiau, nusikopijuok tekstą.";
      });
      return;
    }
    try {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      msg.textContent = "Failas " + name + " parsisiųstas. Tekstas žemiau, jei reikia nusikopijuoti.";
    } catch (e) {
      msg.textContent = "Kopija paruošta žemiau, nusikopijuok tekstą.";
    }
  }

  document.getElementById("exportData").addEventListener("click", function () {
    var json = JSON.stringify(snapshot());
    document.getElementById("backupBox").value = json;
    var msg = document.getElementById("backupMsg");
    msg.className = "msg";
    msg.textContent = "Kopija paruošta žemiau.";
    saveFile(json, msg);
  });

  document.getElementById("importData").addEventListener("click", function () {
    var msg = document.getElementById("backupMsg");
    var raw = document.getElementById("backupBox").value.trim();
    if (!raw) { msg.className = "msg bad"; msg.textContent = "Įklijuok kopijos tekstą į lauką."; return; }
    var data;
    try { data = JSON.parse(raw); } catch (e) {
      msg.className = "msg bad"; msg.textContent = "Nepavyko perskaityti: tekstas ne JSON."; return;
    }
    if (!data || data.app !== "paros-ritmas") {
      msg.className = "msg bad"; msg.textContent = "Tai ne šios programėlės kopija."; return;
    }
    if (Array.isArray(data.blocks) && data.blocks.length) { state.blocks = data.blocks; lsSet("blocks", state.blocks); }
    if (Array.isArray(data.habits) && data.habits.length) { state.habits = data.habits; lsSet("habits", state.habits); }
    var added = 0;
    if (data.days && typeof data.days === "object") {
      Object.keys(data.days).forEach(function (k) {
        var incoming = normalize(data.days[k]);
        var local = days[k];
        if (!local || weight(incoming) > weight(local)) { days[k] = incoming; lsSet("day:" + k, incoming); added++; }
      });
    }
    state.day = days[state.date] ? normalize(days[state.date]) : emptyDay();
    days[state.date] = state.day;
    msg.className = "msg";
    msg.textContent = "Įkelta. Atnaujintos " + added + " dienos.";
    renderAll();
  });

  /* ---------- startas ---------- */

  loadLocal();
  renderAll();
  connect();

  setInterval(function () {
    if (!isToday()) return;
    var inTimeline = document.activeElement && document.activeElement.closest &&
      document.activeElement.closest("#timeline");
    renderNow();
    if (!inTimeline && !state.openNote) renderTimeline();
  }, 30000);

  /* diena pasikeite, kol programele buvo atidaryta */
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    if (state.date !== today() && !state.openNote) goDay(today());
  });
})();
