/* Paros ritmas — paros juosta, uzduotys, rutinos, iprociai ir savijauta.
   Veikia dviem budais:
   - savarankiskai (PWA): duomenys localStorage, atsargine kopija per JSON;
   - Claude artefakte: papildomai sinchronizuoja per `db` gebejima. */
(function () {
  "use strict";

  var BUILD = window.APP_BUILD || "dev";
  var LS = "paros-ritmas:";
  var WEEKDAYS = ["Sekmadienis", "Pirmadienis", "Antradienis", "Trečiadienis", "Ketvirtadienis", "Penktadienis", "Šeštadienis"];
  var WSHORT = ["P", "A", "T", "K", "P", "Š", "S"];
  var WATER_GOAL = 8;
  var MOODS = ["prasta", "vidutinė", "gera", "puiki"];

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

  var DEFAULT_ROUTINES = [
    { id: "rytas", name: "Rytinė rutina", when: "06:30", steps: [
      { id: "r1", name: "Stiklinė vandens", mins: 2 },
      { id: "r2", name: "Mankšta, tempimas", mins: 8 },
      { id: "r3", name: "Dušas", mins: 10 },
      { id: "r4", name: "Pusryčiai", mins: 15 },
      { id: "r5", name: "Dienos trys darbai", mins: 5 }
    ] },
    { id: "vakaras", name: "Vakarinė rutina", when: "22:00", steps: [
      { id: "v1", name: "Ekranai šalin", mins: 2 },
      { id: "v2", name: "Rytojaus krepšys, drabužiai", mins: 8 },
      { id: "v3", name: "Skaitymas", mins: 30, habit: "read" },
      { id: "v4", name: "Vakaro įrašas", mins: 5 }
    ] }
  ];

  var state = {
    date: iso(new Date()),
    blocks: DEFAULT_BLOCKS.map(clone),
    habits: DEFAULT_HABITS.map(clone),
    routines: DEFAULT_ROUTINES.map(clone),
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
  function hhmm(m) { m = Math.max(0, Math.min(24 * 60 - 1, Math.round(m))); return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }
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
  function emptyDay() {
    return {
      habits: {}, blocks: {}, notes: {}, tasks: [], routines: {},
      health: { water: 0, mood: 0, sleep: 0 },
      reflection: { rate: 0, q1: "", q2: "" }
    };
  }

  function normalize(raw) {
    var d = emptyDay();
    if (!raw) return d;
    if (raw.habits && typeof raw.habits === "object") d.habits = raw.habits;
    if (raw.blocks && typeof raw.blocks === "object") d.blocks = raw.blocks;
    if (raw.notes && typeof raw.notes === "object") d.notes = raw.notes;
    if (Array.isArray(raw.tasks)) d.tasks = raw.tasks;
    if (raw.routines && typeof raw.routines === "object") d.routines = raw.routines;
    if (raw.health) {
      d.health.water = +raw.health.water || 0;
      d.health.mood = +raw.health.mood || 0;
      d.health.sleep = +raw.health.sleep || 0;
    }
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
    else if (kind === "routines") lsSet("routines", state.routines);
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
    } else if (kind === "routines") {
      ref = db.doc("plan/routines");
      body = { routines: state.routines, updated: new Date().toISOString() };
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
    var r = lsGet("routines"); if (r && r.length) state.routines = r;
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
      if (note) note.textContent = "Blokai ir rutinos galioja visoms dienoms. Duomenys sinchronizuojami tarp įrenginių.";

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
      db.doc("plan/routines").get().then(function (s) {
        if (s.exists && Array.isArray(s.data().routines) && s.data().routines.length) {
          state.routines = s.data().routines; lsSet("routines", state.routines); renderAll();
        } else { save("routines"); }
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
    var n = Object.keys(d.habits).length * 2 + Object.keys(d.blocks).length + d.tasks.length;
    Object.keys(d.routines).forEach(function (k) { n += Object.keys(d.routines[k] || {}).length; });
    if (d.health.water || d.health.mood || d.health.sleep) n += 1;
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
  function routineById(id) {
    for (var i = 0; i < state.routines.length; i++) if (state.routines[i].id === id) return state.routines[i];
    return null;
  }
  /* zingsnis susietas su iprociu tiesiogiai arba per sutampanti pavadinima */
  function stepHabit(step) {
    if (step.habit) return habitById(step.habit);
    var n = String(step.name || "").trim().toLowerCase();
    for (var i = 0; i < state.habits.length; i++) {
      if (String(state.habits[i].name).trim().toLowerCase() === n) return state.habits[i];
    }
    return null;
  }
  function isHabitDone(habitId, isoStr) {
    var d = dayOf(isoStr);
    return !!(d && d.habits && d.habits[habitId]);
  }
  function sortedBlocks() {
    return state.blocks.slice().sort(function (a, b) { return mins(a.start) - mins(b.start); });
  }
  /* juostoje blokai ir tos dienos uzduotys viename chronologiniame saraše */
  function timelineRows() {
    var rows = sortedBlocks().map(function (b) {
      return { kind: "block", id: b.id, start: b.start, end: b.end, title: b.title, block: b };
    });
    state.day.tasks.forEach(function (t) {
      rows.push({
        kind: "task", id: t.id, start: t.start, end: hhmm(mins(t.start) + (+t.dur || 30)),
        title: t.text, task: t
      });
    });
    return rows.sort(function (a, b) { return mins(a.start) - mins(b.start); });
  }
  function phaseOf(row) {
    if (!isToday()) return state.date < today() ? "past" : "future";
    var n = nowMins();
    if (n >= mins(row.end)) return "past";
    if (n >= mins(row.start)) return "live";
    return "future";
  }
  function rowDone(row) {
    return row.kind === "task" ? !!row.task.done : !!state.day.blocks[row.id];
  }

  function routineDone(routineId, isoStr) {
    var r = routineById(routineId);
    var d = dayOf(isoStr);
    if (!r || !d) return false;
    var marks = d.routines[routineId] || {};
    for (var i = 0; i < r.steps.length; i++) if (!marks[r.steps[i].id]) return false;
    return r.steps.length > 0;
  }
  function routineCount(routineId) {
    var r = routineById(routineId);
    var marks = state.day.routines[routineId] || {};
    var n = 0;
    if (!r) return 0;
    for (var i = 0; i < r.steps.length; i++) if (marks[r.steps[i].id]) n++;
    return n;
  }

  /* dienos uzpildymas: iprociai sveria 2, rutinos 2, blokai ir uzduotys po 1 */
  function dayScore(isoStr) {
    var d = dayOf(isoStr);
    if (!d) return 0;
    var max = state.habits.length * 2 + state.blocks.length + state.routines.length * 2 + d.tasks.length;
    if (!max) return 0;
    var got = 0, i;
    for (i = 0; i < state.habits.length; i++) if (d.habits[state.habits[i].id]) got += 2;
    for (i = 0; i < state.blocks.length; i++) if (d.blocks[state.blocks[i].id]) got += 1;
    for (i = 0; i < state.routines.length; i++) if (routineDone(state.routines[i].id, isoStr)) got += 2;
    for (i = 0; i < d.tasks.length; i++) if (d.tasks[i].done) got += 1;
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
    bump("renderHeader");
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

    var rows = timelineRows(), bd = 0, j;
    for (j = 0; j < rows.length; j++) if (rowDone(rows[j])) bd++;
    document.getElementById("blocksDone").textContent = bd + " / " + rows.length + " pažymėta";

    var hd = 0;
    for (j = 0; j < state.habits.length; j++) if (state.day.habits[state.habits[j].id]) hd++;
    document.getElementById("habitsDone").textContent = hd + " / " + state.habits.length + " atlikta";

    var rd = 0;
    for (j = 0; j < state.routines.length; j++) if (routineDone(state.routines[j].id, state.date)) rd++;
    document.getElementById("routinesDone").textContent = rd + " / " + state.routines.length + " užbaigta";
  }

  function tagFor(row) {
    if (row.kind === "task") return '<span class="blk-tag tag-task">užduotis</span>';
    var b = row.block;
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
    var rows = timelineRows();

    if (!rows.length) {
      card.classList.add("idle");
      label.textContent = "Tuščia para"; title.textContent = "Susidėk paros blokus";
      sub.textContent = "Mygtukas ⚙ viršuje"; note.textContent = "";
      return;
    }
    if (!isToday()) {
      card.classList.add("idle");
      label.textContent = state.date < today() ? "Praėjusi diena" : "Būsima diena";
      title.textContent = dayScore(state.date) + "% dienos užpildyta";
      sub.textContent = rows[0].start + "–" + rows[rows.length - 1].end;
      note.textContent = "";
      return;
    }

    var live = null, next = null, n = nowMins();
    for (var i = 0; i < rows.length; i++) {
      if (phaseOf(rows[i]) === "live" && !live) live = rows[i];
      if (!next && mins(rows[i].start) > n) next = rows[i];
    }
    if (live) {
      card.classList.remove("idle");
      label.textContent = "Dabar";
      title.textContent = live.title;
      sub.textContent = live.start + "–" + live.end + " · liko " + (mins(live.end) - n) + " min";
      var txt = state.day.notes[live.id];
      note.innerHTML = txt ? esc(txt)
        : '<span style="color:var(--muted)">Paspausk eilutę juostoje ir įrašyk, kas joje vyksta.</span>';
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
    bump("renderTimeline");
    var wrap = document.getElementById("timeline");
    var rows = timelineRows();
    if (!rows.length) { wrap.innerHTML = '<p class="empty">Blokų nėra. Susidėk juos per ⚙ viršuje.</p>'; return; }
    var html = "";
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var phase = phaseOf(row);
      var on = rowDone(row);
      var prog = "";
      if (phase === "live") {
        var span = Math.max(1, mins(row.end) - mins(row.start));
        var p = Math.min(100, Math.round(((nowMins() - mins(row.start)) / span) * 100));
        prog = '<div class="blk-prog"><i style="width:' + p + '%"></i></div>';
      }
      var txt = state.day.notes[row.id];
      var noteLine = txt ? '<div class="blk-note">' + esc(txt) + "</div>" : "";
      var editor = "";
      if (state.openNote === row.id) {
        editor = '<div class="note-edit">' +
          '<input type="text" id="note-' + esc(row.id) + '" placeholder="Kas vyksta?" value="' + esc(txt || "") + '">' +
          '<div class="row-actions"><button class="btn small" data-save-note="' + esc(row.id) + '">Įrašyti</button>' +
          '<button class="btn ghost small" data-cancel-note="1">Atšaukti</button>' +
          (row.kind === "task" ? '<button class="btn ghost small" data-del-task="' + esc(row.id) + '">Trinti</button>' : "") +
          "</div></div>";
      }
      html += '<div class="blk ' + phase + (on ? " checked" : "") + (row.kind === "task" ? " task-row" : "") + '">' +
        '<div class="blk-time">' + esc(row.start) + '<span class="blk-end">' + esc(row.end) + "</span></div>" +
        '<div class="blk-body"><button class="blk-title" data-row="' + esc(row.id) + '">' +
        esc(row.title) + tagFor(row) + "</button>" + noteLine + prog + editor + "</div>" +
        '<button class="tick' + (on ? " on" : "") + '" data-toggle-row="' + esc(row.id) +
        '" aria-label="Pažymėti atlikta" aria-pressed="' + (on ? "true" : "false") + '">✓</button></div>';
    }
    wrap.innerHTML = html;
  }

  function renderHealth() {
    var h = state.day.health;
    var dots = "";
    for (var i = 1; i <= WATER_GOAL; i++) {
      dots += '<button type="button" class="' + (i <= h.water ? "on" : "") + '" data-water="' + i +
        '" aria-label="' + i + ' stiklinė" aria-pressed="' + (i <= h.water ? "true" : "false") + '"></button>';
    }
    document.getElementById("waterDots").innerHTML = dots;
    document.getElementById("waterV").textContent = h.water + " / " + WATER_GOAL;

    var btns = document.querySelectorAll("#moodScale button");
    for (var j = 0; j < btns.length; j++) {
      btns[j].setAttribute("aria-pressed", (+btns[j].getAttribute("data-mood") === h.mood) ? "true" : "false");
    }
    document.getElementById("sleepV").textContent = h.sleep ? h.sleep.toFixed(1).replace(".", ",") + " val" : "—";

    var filled = (h.water ? 1 : 0) + (h.mood ? 1 : 0) + (h.sleep ? 1 : 0);
    document.getElementById("healthNote").textContent = filled + " / 3 užpildyta";
  }

  function renderRoutines() {
    var wrap = document.getElementById("routineList");
    if (!state.routines.length) { wrap.innerHTML = '<p class="empty">Rutinų nėra. Pridėk žemiau.</p>'; return; }
    var html = "";
    for (var i = 0; i < state.routines.length; i++) {
      var r = state.routines[i];
      var marks = state.day.routines[r.id] || {};
      var done = routineCount(r.id);
      var steps = "";
      for (var j = 0; j < r.steps.length; j++) {
        var s = r.steps[j];
        var on = !!marks[s.id];
        steps += '<button class="rstep' + (on ? " done" : "") + '" data-step="' + esc(r.id) + "|" + esc(s.id) + '">' +
          '<span class="rstep-tick">✓</span><span class="rstep-name">' + esc(s.name) + "</span>" +
          '<span class="rstep-mins">' + (+s.mins || 0) + " min</span></button>";
      }
      html += '<div class="routine">' +
        '<div class="routine-head"><div class="routine-name">' + esc(r.name) +
        '<span class="routine-when">' + esc(r.when || "") + " · " + totalMins(r) + " min</span></div>" +
        '<span class="routine-prog">' + done + " / " + r.steps.length + "</span></div>" +
        '<div class="rsteps">' + steps + "</div>" +
        '<button class="btn wide" data-start="' + esc(r.id) + '">' +
        (done >= r.steps.length && r.steps.length ? "Pereiti dar kartą" : (done ? "Tęsti" : "Pradėti")) + "</button></div>";
    }
    wrap.innerHTML = html;
  }

  function totalMins(r) {
    var n = 0;
    for (var i = 0; i < r.steps.length; i++) n += (+r.steps[i].mins || 0);
    return n;
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

    /* savijauta per 7 dienas */
    var wSum = 0, wN = 0, mSum = 0, mN = 0, sSum = 0, sN = 0;
    for (i = 0; i < 7; i++) {
      var d = dayOf(shiftDays(today(), -i));
      if (!d) continue;
      if (d.health.water) { wSum += d.health.water; wN++; }
      if (d.health.mood) { mSum += d.health.mood; mN++; }
      if (d.health.sleep) { sSum += d.health.sleep; sN++; }
    }
    document.getElementById("statWater").textContent = wN ? (wSum / wN).toFixed(1).replace(".", ",") : "–";
    document.getElementById("statMood").textContent = mN ? (mSum / mN).toFixed(1).replace(".", ",") : "–";
    document.getElementById("statSleep").textContent = sN ? (sSum / sN).toFixed(1).replace(".", ",") : "–";

    var sleepBars = "";
    for (i = 0; i < 7; i++) {
      var isoS = shiftDays(ws, i);
      var dS = dayOf(isoS);
      var hrs = dS ? dS.health.sleep : 0;
      var hs = Math.max(3, Math.round((Math.min(hrs, 10) / 10) * 72));
      sleepBars += '<div class="bar"><i class="' + (hrs ? "" : "dim") + '" style="height:' + (hrs ? hs : 3) + 'px"></i>' +
        "<b>" + (hrs ? hrs.toFixed(1).replace(".", ",") : WSHORT[i]) + "</b></div>";
    }
    document.getElementById("sleepBars").innerHTML = sleepBars;

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

  function renderAll() {
    bump("renderAll");
    renderHeader(); renderNow(); renderTimeline(); renderHealth();
    renderRoutines(); renderHabits(); renderOverview();
  }

  /* Perpiesiam tik antraste ir matoma skirtuka: nematomu daliu perpiesimas
     telefone brangus ir sukelia mirgejima. */
  function refresh() {
    renderHeader();
    if (state.tab === "diena") { renderNow(); renderTimeline(); renderHealth(); }
    else if (state.tab === "rutinos") renderRoutines();
    else if (state.tab === "iprociai") renderHabits();
    else renderOverview();
  }

  /* ---------- saveika: skirtukai ir dienos ---------- */

  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (btn) {
    btn.addEventListener("click", function () {
      state.tab = btn.getAttribute("data-tab");
      Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      ["diena", "rutinos", "iprociai", "apzvalga"].forEach(function (name) {
        document.getElementById("panel-" + name).hidden = (name !== state.tab);
      });
      window.scrollTo(0, 0);
    });
  });

  document.getElementById("weekstrip").addEventListener("click", function (e) {
    var b = e.target.closest("[data-goto]");
    if (b) goDay(b.getAttribute("data-goto"));
  });

  /* ---------- saveika: juosta ---------- */

  function taskById(id) {
    for (var i = 0; i < state.day.tasks.length; i++) if (state.day.tasks[i].id === id) return state.day.tasks[i];
    return null;
  }

  document.getElementById("timeline").addEventListener("click", function (e) {
    var tog = e.target.closest("[data-toggle-row]");
    if (tog) {
      var rid = tog.getAttribute("data-toggle-row");
      var task = taskById(rid);
      if (task) {
        task.done = !task.done;
      } else {
        var blk = null;
        for (var i = 0; i < state.blocks.length; i++) if (state.blocks[i].id === rid) blk = state.blocks[i];
        if (state.day.blocks[rid]) {
          delete state.day.blocks[rid];
          if (blk && blk.habit) delete state.day.habits[blk.habit];
        } else {
          state.day.blocks[rid] = true;
          if (blk && blk.habit) state.day.habits[blk.habit] = true;
        }
      }
      save("day"); refresh();
      return;
    }
    var t = e.target.closest("[data-row]");
    if (t) {
      var id = t.getAttribute("data-row");
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
      save("day"); refresh();
      return;
    }
    var del = e.target.closest("[data-del-task]");
    if (del) {
      var did = del.getAttribute("data-del-task");
      state.day.tasks = state.day.tasks.filter(function (x) { return x.id !== did; });
      delete state.day.notes[did];
      state.openNote = null;
      save("day"); refresh();
      return;
    }
    if (e.target.closest("[data-cancel-note]")) { state.openNote = null; renderTimeline(); }
  });

  function addTask() {
    var text = document.getElementById("taskText");
    var startEl = document.getElementById("taskStart");
    var durEl = document.getElementById("taskDur");
    var val = text.value.trim();
    if (!val) { text.focus(); return; }
    var start = startEl.value || hhmm(Math.ceil(nowMins() / 15) * 15);
    state.day.tasks.push({ id: uid(), text: val, start: start, dur: +durEl.value || 30, done: false });
    text.value = "";
    save("day"); refresh();
  }
  document.getElementById("addTask").addEventListener("click", addTask);
  document.getElementById("taskText").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); addTask(); }
  });

  /* ---------- saveika: savijauta ---------- */

  document.getElementById("waterDots").addEventListener("click", function (e) {
    var b = e.target.closest("[data-water]");
    if (!b) return;
    var v = +b.getAttribute("data-water");
    state.day.health.water = (state.day.health.water === v) ? v - 1 : v;
    save("day"); refresh();
  });
  document.getElementById("moodScale").addEventListener("click", function (e) {
    var b = e.target.closest("[data-mood]");
    if (!b) return;
    var v = +b.getAttribute("data-mood");
    state.day.health.mood = (state.day.health.mood === v) ? 0 : v;
    save("day"); refresh();
  });
  document.getElementById("sleepPlus").addEventListener("click", function () {
    state.day.health.sleep = Math.min(14, (state.day.health.sleep || 6.5) + 0.5);
    save("day"); refresh();
  });
  document.getElementById("sleepMinus").addEventListener("click", function () {
    state.day.health.sleep = Math.max(0, (state.day.health.sleep || 7) - 0.5);
    save("day"); refresh();
  });

  /* ---------- saveika: iprociai ---------- */

  document.getElementById("habitList").addEventListener("click", function (e) {
    var t = e.target.closest("[data-toggle-habit]");
    if (t) {
      var id = t.getAttribute("data-toggle-habit");
      if (state.day.habits[id]) delete state.day.habits[id]; else state.day.habits[id] = true;
      syncBlocks(id);
      save("day"); refresh();
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
        state.day = target; syncBlocks(hid); save("day");
      } else {
        lsSet("day:" + dIso, target);
        if (db) db.doc("days/" + dIso).set(Object.assign({ date: dIso, updated: new Date().toISOString() }, target))["catch"](function () {});
      }
      refresh();
    }
  });

  function syncBlocks(habitId) {
    for (var i = 0; i < state.blocks.length; i++) {
      var b = state.blocks[i];
      if (b.habit !== habitId) continue;
      if (state.day.habits[habitId]) state.day.blocks[b.id] = true;
      else delete state.day.blocks[b.id];
    }
  }

  /* ---------- saveika: rutinos ---------- */

  function toggleStep(routineId, stepId, force) {
    var r = routineById(routineId);
    if (!r) return;
    if (!state.day.routines[routineId]) state.day.routines[routineId] = {};
    var marks = state.day.routines[routineId];
    var on = force === undefined ? !marks[stepId] : !!force;
    if (on) marks[stepId] = true; else delete marks[stepId];

    var step = null;
    for (var i = 0; i < r.steps.length; i++) if (r.steps[i].id === stepId) step = r.steps[i];
    if (step) {
      var h = stepHabit(step);
      if (h) {
        if (on) state.day.habits[h.id] = true; else delete state.day.habits[h.id];
        syncBlocks(h.id);
      }
    }
    save("day");
  }

  document.getElementById("routineList").addEventListener("click", function (e) {
    var s = e.target.closest("[data-step]");
    if (s) {
      var parts = s.getAttribute("data-step").split("|");
      toggleStep(parts[0], parts[1]);
      refresh();
      return;
    }
    var st = e.target.closest("[data-start]");
    if (st) startFocus(st.getAttribute("data-start"));
  });

  /* ---------- rutinos vykdymas su laikmaciu ---------- */

  var focusDlg = document.getElementById("focusDlg");
  var focus = { routineId: null, index: 0, left: 0, timer: null, paused: false };

  function startFocus(routineId) {
    var r = routineById(routineId);
    if (!r || !r.steps.length) return;
    focus.routineId = routineId;
    focus.index = firstUndone(r);
    focus.paused = false;
    document.getElementById("focusName").textContent = r.name;
    loadStep();
    focusDlg.showModal();
  }

  function firstUndone(r) {
    var marks = state.day.routines[r.id] || {};
    for (var i = 0; i < r.steps.length; i++) if (!marks[r.steps[i].id]) return i;
    return 0;
  }

  function loadStep() {
    var r = routineById(focus.routineId);
    if (!r) return;
    var step = r.steps[focus.index];
    if (!step) { closeFocus(); return; }
    focus.left = (+step.mins || 0) * 60;
    document.getElementById("focusStep").textContent = step.name;
    document.getElementById("focusMeta").textContent =
      "Žingsnis " + (focus.index + 1) + " iš " + r.steps.length + " · " + (+step.mins || 0) + " min";
    paintTimer();
    paintFocusList();
    runTimer();
  }

  function paintTimer() {
    var el = document.getElementById("focusTimer");
    var neg = focus.left < 0;
    var s = Math.abs(focus.left);
    el.textContent = (neg ? "+" : "") + pad(Math.floor(s / 60)) + ":" + pad(s % 60);
    el.className = "focus-timer" + (neg ? " over" : "");
  }

  function runTimer() {
    if (focus.timer) clearInterval(focus.timer);
    focus.timer = setInterval(function () {
      if (focus.paused) return;
      focus.left -= 1;
      paintTimer();
    }, 1000);
  }

  function paintFocusList() {
    var r = routineById(focus.routineId);
    if (!r) return;
    var marks = state.day.routines[r.id] || {};
    var html = "";
    for (var i = 0; i < r.steps.length; i++) {
      var s = r.steps[i];
      html += '<div class="rstep' + (marks[s.id] ? " done" : "") + (i === focus.index ? " current" : "") + '">' +
        '<span class="rstep-tick">✓</span><span class="rstep-name">' + esc(s.name) + "</span>" +
        '<span class="rstep-mins">' + (+s.mins || 0) + " min</span></div>";
    }
    document.getElementById("focusList").innerHTML = html;
  }

  function nextStep(markDone) {
    var r = routineById(focus.routineId);
    if (!r) return;
    var step = r.steps[focus.index];
    if (step && markDone) toggleStep(r.id, step.id, true);
    var marks = state.day.routines[r.id] || {};
    var next = -1;
    for (var i = focus.index + 1; i < r.steps.length; i++) { if (!marks[r.steps[i].id]) { next = i; break; } }
    if (next === -1) {
      for (var j = 0; j < r.steps.length; j++) { if (!marks[r.steps[j].id]) { next = j; break; } }
    }
    refresh();
    if (next === -1) { closeFocus(); return; }
    focus.index = next;
    loadStep();
  }

  function closeFocus() {
    if (focus.timer) { clearInterval(focus.timer); focus.timer = null; }
    if (focusDlg.open) focusDlg.close();
  }

  document.getElementById("focusDone").addEventListener("click", function () { nextStep(true); });
  document.getElementById("focusSkip").addEventListener("click", function () { nextStep(false); });
  document.getElementById("focusPause").addEventListener("click", function (e) {
    focus.paused = !focus.paused;
    e.target.textContent = focus.paused ? "Tęsti" : "Pauzė";
  });
  document.getElementById("closeFocus").addEventListener("click", closeFocus);
  focusDlg.addEventListener("close", function () {
    if (focus.timer) { clearInterval(focus.timer); focus.timer = null; }
    document.getElementById("focusPause").textContent = "Pauzė";
  });

  /* ---------- saveika: vakaro irasas ---------- */

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
    document.getElementById("buildNote").textContent = "Versija: " + BUILD;
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

  /* ---------- iprociai: tvarkymas ---------- */

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

  /* ---------- rutinos: tvarkymas ---------- */

  var routinesDlg = document.getElementById("routinesDlg");
  var rDraft = [];

  function renderRoutineRows() {
    var html = "";
    for (var i = 0; i < rDraft.length; i++) {
      var r = rDraft[i];
      var steps = "";
      for (var j = 0; j < r.steps.length; j++) {
        var s = r.steps[j];
        steps += '<div class="rrow" data-i="' + i + '" data-j="' + j + '">' +
          '<input type="text" value="' + esc(s.name) + '" data-f="name" aria-label="Žingsnis">' +
          '<input type="number" class="mins" min="0" max="180" value="' + (+s.mins || 0) + '" data-f="mins" aria-label="Minutės">' +
          '<button class="del" data-rms="' + i + "|" + j + '" aria-label="Trinti žingsnį">×</button></div>';
      }
      html += '<div class="rgroup">' +
        '<div class="rgroup-head">' +
        '<input type="text" value="' + esc(r.name) + '" data-f="rname" data-i="' + i + '" aria-label="Rutinos pavadinimas">' +
        '<input type="time" class="when" value="' + esc(r.when || "") + '" data-f="rwhen" data-i="' + i + '" aria-label="Laikas">' +
        '<button class="del" data-rmr="' + i + '" aria-label="Trinti rutiną">×</button></div>' +
        steps +
        '<button class="btn ghost small" data-adds="' + i + '">+ Žingsnis</button></div>';
    }
    document.getElementById("routineRows").innerHTML = html;
  }

  document.getElementById("openRoutines").addEventListener("click", function () {
    rDraft = state.routines.map(clone); renderRoutineRows(); routinesDlg.showModal();
  });
  document.getElementById("closeRoutines").addEventListener("click", function () { routinesDlg.close(); });
  document.getElementById("addRoutine").addEventListener("click", function () {
    rDraft.push({ id: uid(), name: "Nauja rutina", when: "07:00", steps: [{ id: uid(), name: "Pirmas žingsnis", mins: 5 }] });
    renderRoutineRows();
  });
  document.getElementById("routineRows").addEventListener("click", function (e) {
    var addS = e.target.closest("[data-adds]");
    if (addS) {
      rDraft[+addS.getAttribute("data-adds")].steps.push({ id: uid(), name: "Naujas žingsnis", mins: 5 });
      renderRoutineRows();
      return;
    }
    var rmS = e.target.closest("[data-rms]");
    if (rmS) {
      var p = rmS.getAttribute("data-rms").split("|");
      rDraft[+p[0]].steps.splice(+p[1], 1);
      renderRoutineRows();
      return;
    }
    var rmR = e.target.closest("[data-rmr]");
    if (rmR) { rDraft.splice(+rmR.getAttribute("data-rmr"), 1); renderRoutineRows(); }
  });
  document.getElementById("routineRows").addEventListener("input", function (e) {
    var f = e.target.getAttribute("data-f");
    if (f === "rname") { rDraft[+e.target.getAttribute("data-i")].name = e.target.value; return; }
    if (f === "rwhen") { rDraft[+e.target.getAttribute("data-i")].when = e.target.value; return; }
    var row = e.target.closest(".rrow");
    if (!row || !f) return;
    var step = rDraft[+row.getAttribute("data-i")].steps[+row.getAttribute("data-j")];
    step[f] = (f === "mins") ? (+e.target.value || 0) : e.target.value;
  });
  document.getElementById("saveRoutines").addEventListener("click", function () {
    state.routines = rDraft.filter(function (r) { return String(r.name).trim(); }).map(function (r) {
      r.steps = r.steps.filter(function (s) { return String(s.name).trim(); });
      return r;
    });
    save("routines"); routinesDlg.close(); renderAll();
  });

  /* ---------- atsargine kopija ---------- */

  function snapshot() {
    return { app: "paros-ritmas", version: 2, exported: new Date().toISOString(),
      blocks: state.blocks, habits: state.habits, routines: state.routines, days: days };
  }

  var inArtifact = !!(window.claude && typeof window.claude.use === "function");

  function saveFile(json, msg) {
    var name = "paros-ritmas-" + today() + ".json";
    if (inArtifact) {
      window.claude.use("downloads").then(function (dl) {
        if (!dl) { msg.textContent = "Kopija paruošta žemiau, nusikopijuok tekstą."; return; }
        dl.save({ filename: name, data: json }).then(function () {
          msg.textContent = "Failas išsaugotas. Tekstas žemiau, jei reikia nusikopijuoti.";
        })["catch"](function () { msg.textContent = "Kopija paruošta žemiau, nusikopijuok tekstą."; });
      })["catch"](function () { msg.textContent = "Kopija paruošta žemiau, nusikopijuok tekstą."; });
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

  document.getElementById("showDiag").addEventListener("click", function () {
    var box = document.getElementById("backupBox");
    var msg = document.getElementById("backupMsg");
    box.value = JSON.stringify({
      build: BUILD, standalone: diag.standalone, ua: diag.ua,
      loadsLastMinute: diag.loadsLastMinute,
      reloads: diag.reloads.slice(-15).map(function (t) { return new Date(t).toISOString().slice(11, 19); }),
      counts: diag.counts, heights: diag.heights.slice(-10), spikes: diag.spikes.slice(-5)
    }, null, 1);
    msg.className = "msg";
    msg.textContent = "Diagnostika lauke žemiau. Nusikopijuok ir atsiųsk.";
  });

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
    if (Array.isArray(data.routines) && data.routines.length) { state.routines = data.routines; lsSet("routines", state.routines); }
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

  /* ---------- diagnostika ----------
     Skaiciuoja, kas ir kaip daznai vyksta ekrane. Artefakto versijoje santrauka
     rasoma i duomenu baze, tad mirgejimo priezasti galima pamatyti is saliu,
     o ne speti. Su `?debug=1` skaitikliai rodomi ir juostele apacioje. */

  var diag = {
    session: new Date().toISOString().slice(0, 16) + "-" + Math.random().toString(36).slice(2, 6),
    started: new Date().toISOString(),
    ua: navigator.userAgent,
    standalone: !!(window.navigator.standalone ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)),
    build: BUILD,
    counts: {},
    heights: [],
    spikes: []
  };
  var debugOn = /[?&]debug=1/.test(window.location.search);

  /* Perkrovimu istorija islieka tarp perkrovimu: jei programele krautusi rate,
     cia matysis serija laiku su keliu sekundziu tarpais. */
  diag.reloads = lsGet("reloads") || [];
  diag.reloads.push(Date.now());
  if (diag.reloads.length > 25) diag.reloads = diag.reloads.slice(-25);
  lsSet("reloads", diag.reloads);
  diag.loadsLastMinute = diag.reloads.filter(function (t) { return Date.now() - t < 60000; }).length;

  function bump(k) {
    diag.counts[k] = (diag.counts[k] || 0) + 1;
    var t = Math.floor(Date.now() / 1000);
    if (!bump.sec || bump.sec !== t) { bump.sec = t; bump.n = 0; }
    bump.n++;
    /* daugiau nei 20 ivykiu per sekunde reiskia rata, o ne normalu naudojima */
    if (bump.n === 21) diag.spikes.push({ at: new Date().toISOString(), key: k });
    if (diag.spikes.length > 20) diag.spikes.shift();
  }

  function noteHeight(h) {
    diag.heights.push({ t: Date.now() - diag.started_ms, h: h });
    if (diag.heights.length > 40) diag.heights.shift();
  }
  diag.started_ms = Date.now();

  ["focusin", "focusout"].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var el = e.target;
      if (el && el.matches && el.matches("input, textarea, select")) bump(ev);
    });
  });
  window.addEventListener("scroll", function () { bump("winScroll"); }, { passive: true });

  function renderDebugBar() {
    if (!debugOn) return;
    var bar = document.getElementById("debugBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "debugBar";
      bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99;background:#111;color:#0f0;" +
        "font:10px/1.35 monospace;padding:6px 8px;white-space:pre-wrap;max-height:34vh;overflow:auto";
      document.body.appendChild(bar);
    }
    var lines = [];
    Object.keys(diag.counts).sort().forEach(function (k) { lines.push(k + "=" + diag.counts[k]); });
    bar.textContent = "v" + BUILD + (diag.standalone ? " standalone" : " safari") + "\n" +
      lines.join("  ") + "\nh: " + diag.heights.slice(-6).map(function (x) { return x.h; }).join(" ") +
      (diag.spikes.length ? "\nRATAS: " + diag.spikes.length : "");
  }

  function sendDiag() {
    if (!db) return;
    var body = {
      session: diag.session, started: diag.started, updated: new Date().toISOString(),
      build: diag.build, ua: diag.ua, standalone: diag.standalone,
      counts: diag.counts, heights: diag.heights.slice(-20), spikes: diag.spikes.slice(-10),
      reloads: diag.reloads.slice(-15), loadsLastMinute: diag.loadsLastMinute
    };
    db.doc("diag/last").set(body)["catch"](function () {});
  }

  setInterval(function () { renderDebugBar(); sendDiag(); }, 5000);
  setTimeout(renderDebugBar, 1000);

  /* ---------- ekrano remas ----------
     Cia nebeliko nieko. Anksciau remo aukstis buvo imamas is visualViewport, bet
     iOS klaviatura atsidaro slysdama ir per ta slydima praneša nauja auksti
     kiekvienam kadrui: is to gimdavo 40 ir daugiau issidestymo perskaiciavimu per
     viena klaviaturos atsidaryma, o tai ir buvo mirgejimas. Dabar issidestyma
     tvarko tik CSS, o narsykle pati pastumia turini prie lauko, kuriame rasoma. */

  /* ---------- savaiminis atsinaujinimas ----------
     Kai serveryje atsiranda nauja versija, programele pasiima ja pati.
     Persikraunama tik tada, kai niekas nerasoma ir neatidarytas joks langas. */

  (function autoUpdate() {
    if (inArtifact) return;
    var pending = false;
    var RELOAD_KEY = LS + "reloaded";

    function busy() {
      var a = document.activeElement;
      if (a && a.matches && a.matches("input, textarea, select")) return true;
      return !!document.querySelector("dialog[open]");
    }

    /* Apsauga nuo perkrovimo rato: jei serveryje esanti versija del kokios nors
       priezasties niekaip nesutampa su ikrauta, programele bandytu krautis be galo. */
    function reloadNow() {
      if (busy()) { pending = true; return; }
      try {
        var last = +sessionStorage.getItem(RELOAD_KEY) || 0;
        if (Date.now() - last < 120000) return;
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch (e) { /* be sessionStorage geriau nesikrauti is naujo */ return; }
      bump("reload");
      window.location.reload();
    }

    function check() {
      if (document.visibilityState !== "visible") return;
      fetch("version.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
        return r.ok ? r.json() : null;
      }).then(function (v) {
        if (v && v.build && v.build !== BUILD) reloadNow();
      })["catch"](function () { /* be rysio tyliai praleidziam */ });
    }

    setInterval(check, 60000);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") { if (pending) reloadNow(); else check(); }
    });
    document.addEventListener("focusout", function () { if (pending) setTimeout(reloadNow, 500); });
    setTimeout(check, 3000);
  })();

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

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    if (state.date !== today() && !state.openNote) goDay(today());
  });
})();
