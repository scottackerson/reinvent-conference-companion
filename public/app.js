/* Live features. The page is complete without this file; nothing here blocks rendering. */
(function () {
  'use strict';
  var TZ = 'UTC', TZLABEL = '';
  var DAYIDS = [];
  var data = null, entries = [], dayInfo = {};
  var savedCopy = false, firstRun = true;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* ---------- time ---------- */
  var fmtParts = null; // built once the data (and its time zone) is loaded
  // Test hook: add ?now=2026-11-30T11:20 to the URL to pretend it is that wall-clock time in the event time zone.
  function pacificNow() {
    var q = /[?&]now=(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(location.search);
    var y, mo, d, h, mi, s = 0;
    if (q) { y = +q[1]; mo = +q[2]; d = +q[3]; h = +q[4]; mi = +q[5]; }
    else {
      var p = {};
      if (!fmtParts) fmtParts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      fmtParts.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
      y = +p.year; mo = +p.month; d = +p.day; h = (+p.hour) % 24; mi = +p.minute; s = +p.second;
    }
    var date = y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
    return { date: date, abs: absMin(date, h * 60 + mi + s / 60), h: h, mi: mi };
  }
  function absMin(date, m) { var a = date.split('-'); return Date.UTC(+a[0], +a[1] - 1, +a[2]) / 60000 + m; }
  function toMin(s) { var a = s.split(':'); return +a[0] * 60 + +a[1]; }
  function clock(m) { m = ((Math.round(m) % 1440) + 1440) % 1440; var h = Math.floor(m / 60); return { t: (h % 12 || 12) + ':' + ('0' + (m % 60)).slice(-2), ap: h < 12 ? 'AM' : 'PM' }; }
  function t12(m) { var c = clock(m); return c.t + ' ' + c.ap; }
  function range(s, e, approx) {
    var a = clock(s), b = clock(e);
    return a.ap === b.ap ? a.t + ' to ' + (approx ? 'about ' : '') + b.t + ' ' + b.ap : a.t + ' ' + a.ap + ' to ' + (approx ? 'about ' : '') + b.t + ' ' + b.ap;
  }
  function dur(min) {
    min = Math.max(0, Math.ceil(min));
    if (min < 120) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;
    return h + ' h' + (m ? ' ' + m + ' min' : '');
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function stampLabel(now) {
    var a = now.date.split('-'), dt = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2]));
    return WEEK[dt.getUTCDay()] + ' ' + MONTHS[+a[1] - 1] + ' ' + (+a[2]) + ', ' + t12(now.h * 60 + now.mi) + (TZLABEL ? ' ' + TZLABEL : '');
  }
  function fmtDate(d) { var a = d.split('-'); return MONTHS[+a[1] - 1] + ' ' + (+a[2]) + ', ' + a[0]; }

  /* ---------- data ---------- */
  function venue(id) { return data.venues.filter(function (v) { return v.id === id; })[0]; }
  function travelMin(a, b) {
    var t = data.travelTimes;
    if (t[a] && t[a][b] != null) return t[a][b];
    if (t[b] && t[b][a] != null) return t[b][a];
    return null;
  }
  function dirUrl(id) { return 'https://maps.apple.com/?daddr=' + encodeURIComponent(venue(id).appleMapsQuery) + '&dirflg=w'; }
  function label(it) { return (it.code ? '<span class="code">' + esc(it.code) + '</span> ' : '') + esc(it.title); }

  function index() {
    entries = [];
    data.days.forEach(function (day, di) {
      var list = day.items.slice().sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
      var prevSession = null;
      list.forEach(function (it) {
        var e = { day: day, di: di, it: it, s: absMin(day.date, toMin(it.start)), e: absMin(day.date, toMin(it.end)), travel: it.kind === 'travel', prev: prevSession };
        entries.push(e);
        if (!e.travel) prevSession = it;
      });
      dayInfo[day.id] = { first: absMin(day.date, toMin(list[0].start)), last: absMin(day.date, toMin(list[list.length - 1].end)) };
    });
  }

  /* ---------- console ---------- */
  function sessions() { return entries.filter(function (e) { return !e.travel; }); }

  function leaveInfo(next, now) {
    // Where you are coming from: the previous session of the day, or the hotel for the first one.
    var to = next.it.venueId, from, leaveAt, mins, hotel = false;
    if (!next.prev) {
      from = data.hotel.key; hotel = true;
      mins = travelMin(from, to);
      leaveAt = absMin(next.day.date, toMin(next.day.leaveHotelBy.time));
    } else {
      from = next.prev.venueId;
      if (from === to) return null;
      mins = travelMin(from, to);
      var row = entries.filter(function (e) { return e.travel && e.day === next.day && e.it.toVenueId === to && e.e <= next.s && e.it.fromVenueId === from; })[0];
      if (row) mins = row.it.mins;
      if (mins == null) return null;
      leaveAt = next.s - mins;
    }
    if (mins == null) return null;
    return { from: from, to: to, mins: mins, leaveAt: leaveAt, hotel: hotel, remaining: leaveAt - now.abs };
  }

  function nowBlock(now, cur) {
    var h;
    if (cur) {
      var it = cur.it, pct = Math.max(0, Math.min(100, (now.abs - cur.s) / (cur.e - cur.s) * 100));
      if (cur.travel) {
        h = '<div class="what">Moving to ' + esc(venue(it.toVenueId).name) + '</div><div class="sub">From ' + esc(venue(it.fromVenueId).name) + '. About ' + it.mins + ' min, estimate.</div>';
      } else {
        var end = toMin(it.end);
        h = '<div class="what">' + label(it) + '</div><div class="sub">' + esc(venue(it.venueId).name) + ', ' + esc(it.room) + '. Ends ' + t12(end) + (it.endApprox ? ' (about)' : '') + '.</div>';
      }
      return h + '<div class="progress" aria-hidden="true"><i style="width:' + pct.toFixed(0) + '%"></i></div>';
    }
    var today = data.days.filter(function (d) { return d.date === now.date; })[0];
    if (today) {
      var slot = (today.openSlots || []).filter(function (g) { return absMin(today.date, toMin(g.start)) <= now.abs && now.abs < absMin(today.date, toMin(g.end)); })[0];
      if (slot) return '<div class="what">Open time</div><div class="sub">' + esc(slot.note) + ', ' + range(toMin(slot.start), toMin(slot.end)) + '.</div>';
      if (now.abs < dayInfo[today.id].first) return '<div class="what">Before the first item</div><div class="sub">Leave the ' + esc(data.hotel.name) + ' by ' + t12(toMin(today.leaveHotelBy.time)) + ' (estimate).</div>';
      if (now.abs >= dayInfo[today.id].last) return '<div class="what">Done for the day</div><div class="sub">Nothing else is scheduled today.</div>';
      return '<div class="what">Free time</div><div class="sub">Nothing scheduled right now.</div>';
    }
    return '<div class="what">Between days</div><div class="sub">Nothing scheduled right now.</div>';
  }

  function dayWord(next, now) {
    if (next.day.date === now.date) return '';
    var tomorrow = absMin(next.day.date, 0) - absMin(now.date, 0) === 1440;
    return (tomorrow ? 'Tomorrow, ' : next.day.title.split(',')[0] + ', ');
  }

  function renderConsole(now, state) {
    var box = $('#console'); if (!box) return;
    var days = data.days, firstDay = days[0], lastDay = days[days.length - 1];
    var status = '<div class="c-status"><span class="live' + (savedCopy ? ' saved' : '') + '">' + (savedCopy ? 'Saved copy' : 'Live') + '</span><span>' + esc(stampLabel(now)) + '</span></div>';
    if (state === 'after') { box.hidden = true; return; }
    box.hidden = false;
    var ses = sessions();
    if (state === 'before') {
      var f = ses[0];
      box.innerHTML = '<div class="c-status"><span>Before the conference</span><span>' + esc(stampLabel(now)) + '</span></div>' +
        '<div class="c-idle"><div class="what">Starts ' + esc(firstDay.title) + '</div><div class="sub">First up: ' + t12(toMin(f.it.start)) + ', ' + label(f.it) + ', ' + esc(venue(f.it.venueId).name) + '. Leave the ' + esc(data.hotel.name) + ' by ' + t12(toMin(firstDay.leaveHotelBy.time)) + ' (estimate).</div><a class="btn btn-ghost" href="#' + firstDay.id + '">Jump to ' + esc(firstDay.title.split(',')[0]) + '</a></div>';
      return;
    }
    var cur = entries.filter(function (e) { return e.s <= now.abs && now.abs < e.e; }).sort(function (a, b) { return a.travel - b.travel; })[0];
    var next = ses.filter(function (e) { return e.s > now.abs; })[0];
    if (!next && !cur) { box.hidden = true; return; }
    var html = status + '<div class="c-now"><span class="lbl">Now</span><div style="flex:1;min-width:0">' + nowBlock(now, cur) + '</div></div>';
    if (next) {
      var it = next.it, v = venue(it.venueId), li = leaveInfo(next, now), until = next.s - now.abs;
      var after = ses.filter(function (e) { return e.s > next.s; })[0];
      var warn = li && li.remaining < 10;
      var badge = it.status === 'reserved' ? '<span class="badge b-res">Reserved</span>' : it.status === 'walkup' ? '<span class="badge b-walk">Walk-up</span>' : (it.status === 'estimated' || it.estimated) ? '<span class="badge b-est">Estimated</span>' : '<span class="badge b-ev">Event</span>';
      html += '<div class="c-next"><div class="head"><span class="lbl">Next</span><div style="min-width:0"><div class="sumtop">' + badge + '<span class="span">' + esc(dayWord(next, now)) + range(toMin(it.start), toMin(it.end), it.endApprox) + '</span></div>' +
        '<div class="title">' + label(it) + '</div><div class="where">' + esc(v.name) + ', ' + esc(it.room) + '</div></div></div>';
      var leaveCell;
      if (li) { var c = clock(li.leaveAt % 1440); leaveCell = '<div class="' + (warn ? 'warn' : '') + '"><div class="n">' + c.t + ' <small>' + c.ap + '</small></div><div class="u">' + (li.hotel ? 'Leave the ' + esc(data.hotel.name) + ' by' : 'Leave by') + '</div></div>'; }
      else leaveCell = '<div><div class="n">Same</div><div class="u">Venue, no travel</div></div>';
      html += '<div class="big"><div><div class="n">' + esc(dur(until)) + '</div><div class="u">Until start</div></div>' + leaveCell + '</div>';
      if (li) {
        var lt = t12(li.leaveAt % 1440), where = li.hotel ? 'Leave the ' + data.hotel.name + ' by ' + lt + ' for ' + v.name : 'Leave by ' + lt + ' for ' + v.name;
        var msg = where + ' (about ' + li.mins + ' min).';
        var rem = Math.ceil(li.remaining);
        if (li.remaining < 0) {
          var late = Math.ceil(-li.remaining);
          html += '<div class="alert" role="status"><div><b>Tight.</b> ' + esc(msg) + ' You are about ' + late + ' min past that, so expect to arrive about ' + late + ' min late.' + (it.status === 'reserved' ? ' Reserved seats may be released to walk-ups.' : '') + '</div></div>';
        } else if (li.remaining < 10) {
          html += '<div class="alert" role="status"><div><b>Leave in ' + rem + ' min.</b> ' + esc(msg) + '</div></div>';
        } else {
          html += '<div class="alert ok" role="status"><div><b>Leave in ' + esc(dur(rem)) + '.</b> ' + esc(msg) + ' Estimate.</div></div>';
        }
      }
      if (it.arriveNote) html += '<div class="c-after"><b>Arrive by:</b> ' + esc(it.arriveNote) + '</div>';
      html += '<a class="btn" href="' + dirUrl(it.venueId) + '">Directions to ' + esc(v.name) + '</a>';
      if (after) {
        var same = after.it.venueId === it.venueId;
        html += '<div class="c-after">Then <b>' + t12(toMin(after.it.start)) + '</b> ' + label(after.it) + '. ' + (same ? 'Same building, ' + esc(after.it.room) + '.' : esc(venue(after.it.venueId).name) + ', ' + esc(after.it.room) + '.') + '</div>';
      }
      html += '</div>';
      markNext(next, cur);
    } else {
      html += '<div class="c-next"><div class="c-after">No more items on the agenda after this.</div></div>';
      markNext(null, cur);
    }
    box.innerHTML = html;
  }

  function markNext(next, cur) {
    $$('.isnext, .isnow').forEach(function (r) { r.classList.remove('isnext', 'isnow'); });
    $$('.b-next, .b-now').forEach(function (b) { b.remove(); });
    function mark(e, cls, text, bcls) {
      if (!e || e.travel) return null;
      var d = document.getElementById(e.it.id); if (!d) return null;
      var row = d.closest('.row'); row.classList.add(cls);
      var top = $('.sumtop', d); if (top) top.insertAdjacentHTML('beforeend', '<span class="badge ' + bcls + '">' + text + '</span>');
      return d;
    }
    var a = mark(cur, 'isnow', 'Now', 'b-now'), b = mark(next, 'isnext', 'Next', 'b-next');
    return { cur: a, next: b };
  }

  /* ---------- tick ---------- */
  function tick() {
    if (!data) return;
    var now = pacificNow();
    var first = data.days[0].date, last = data.days[data.days.length - 1];
    var state;
    if (now.date < first) state = 'before';
    else if (now.date > last.date || (now.date === last.date && now.abs >= dayInfo[last.id].last)) state = 'after';
    else state = 'during';
    renderConsole(now, state);
    var today = data.days.filter(function (d) { return d.date === now.date; })[0];
    $$('.seg a .today').forEach(function (x) { x.remove(); });
    if (today && state !== 'after') {
      var tab = $('.seg a[data-day="' + today.id + '"]'); if (tab) tab.insertAdjacentHTML('beforeend', '<span class="today" aria-label="today"></span>');
    }
    if (firstRun) {
      firstRun = false;
      var hashDay = dayFromHash();
      if (state === 'during' && today && !hashDay) {
        showDay(today.id, false);
        $$('.isnext details, .isnow details').forEach(function (d) { d.open = true; });
        var sw = document.getElementById('agenda'); if (sw) sw.scrollIntoView({ block: 'start' });
      }
    }
  }

  /* ---------- day switcher ---------- */
  var days = [], segs = [];
  function showDay(id, scroll) {
    days.forEach(function (d) { d.hidden = d.id !== id; });
    segs.forEach(function (a) { a.setAttribute('aria-current', a.dataset.day === id ? 'true' : 'false'); });
    if (scroll) document.getElementById('agenda').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function dayFromHash() {
    var h = (location.hash || '').slice(1); if (!h) return null;
    var el = document.getElementById(h); if (!el) return null;
    var d = el.closest ? el.closest('.day') : null;
    return d ? d.id : null;
  }
  function initDays() {
    days = $$('.day'); segs = $$('.seg a');
    segs.forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); showDay(a.dataset.day, true); }); });
    var hd = dayFromHash();
    showDay(hd || (days[0] && days[0].id), false);
    if (hd) { var el = document.getElementById(location.hash.slice(1)); if (el) { if (el.tagName === 'DETAILS') el.open = true; el.scrollIntoView(); } }
    window.addEventListener('hashchange', function () {
      var d = dayFromHash(); if (d) showDay(d, false);
      var el = document.getElementById((location.hash || '').slice(1)); if (el && el.tagName === 'DETAILS') el.open = true;
    });
    // Links from the console ("Jump to Monday") and elsewhere that point at a day id.
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]'); if (!a || a.closest('.seg')) return;
      var id = a.getAttribute('href').slice(1);
      if (DAYIDS.indexOf(id) >= 0) { e.preventDefault(); showDay(id, true); }
    });
  }

  /* ---------- search ---------- */
  function initSearch() {
    var wrap = $('[data-js-only]'); if (wrap) wrap.hidden = false;
    var q = $('#q'); if (!q) return;
    var none = $('#noresults');
    q.addEventListener('input', function () {
      var v = q.value.trim().toLowerCase(), any = false;
      if (!v) {
        $$('.row').forEach(function (r) { r.hidden = false; });
        days.forEach(function (d) { d.hidden = true; });
        var cur = segs.filter(function (a) { return a.getAttribute('aria-current') === 'true'; })[0] || segs[0];
        showDay(cur.dataset.day, false); none.hidden = true; return;
      }
      days.forEach(function (d) {
        var hits = 0;
        $$('.row', d).forEach(function (r) {
          var t = r.getAttribute('data-search');
          var ok = !!t && t.indexOf(v) >= 0;
          r.hidden = !ok; if (ok) hits++;
        });
        d.hidden = hits === 0; if (hits) any = true;
      });
      none.hidden = any;
    });
  }

  /* ---------- tab bar highlight ---------- */
  function initTabs() {
    var tabs = $$('.tabbar a'), targets = tabs.map(function (a) { return document.querySelector(a.getAttribute('href')); });
    function onScroll() {
      var y = window.scrollY + 120, idx = 0;
      targets.forEach(function (t, i) { if (t && t.getBoundingClientRect().top + window.scrollY <= y) idx = i; });
      tabs.forEach(function (a, i) { a.classList.toggle('on', i === idx); });
    }
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }

  /* ---------- saved copy ---------- */
  function setSaved(on) {
    if (on === savedCopy) return;
    savedCopy = on;
    var b = $('#saved'); if (b) {
      b.hidden = !on;
      if (on && data) $('#saved-date', b).textContent = 'Last updated ' + fmtDate(data.meta.lastUpdated) + '.';
    }
    var st = $('#state'); if (st) { st.hidden = false; st.textContent = on ? 'Saved copy' : 'Live'; st.classList.toggle('saved-state', on); }
    if (data) tick();
  }
  function initSaved() {
    var meta = document.querySelector('meta[name="saved-copy"]');
    if (meta) savedCopy = false, setSaved(true);
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'saved-copy') setSaved(true); });
    }
    window.addEventListener('offline', function () { setSaved(true); });
  }

  /* ---------- boot ---------- */
  function registerSW() {
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  function useData(j, fromCache) {
    data = j; TZ = data.event.timezone; TZLABEL = data.event.timezoneLabel || ''; DAYIDS = data.days.map(function (d) { return d.id; }); index();
    if (fromCache || !navigator.onLine) setSaved(true);
    var b = $('#saved'); if (b && savedCopy) $('#saved-date', b).textContent = 'Last updated ' + fmtDate(data.meta.lastUpdated) + '.';
    var s2 = $('#state'); if (s2) { s2.hidden = false; s2.textContent = savedCopy ? 'Saved copy' : 'Live'; s2.classList.toggle('saved-state', savedCopy); }
    tick();
    setInterval(tick, 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  }

  function startLive() {
    initDays(); initSearch(); initTabs(); initSaved();
    var st = $('#state'); if (st) st.hidden = false;
  }

  // Passphrase mode: the page is a locked shell. unlock.js decrypts agenda.enc, renders the agenda with
  // render.js, then calls AgendaLive.start(model, fromCache). Defined now, before any module script runs.
  var encrypted = document.documentElement.hasAttribute('data-encrypted');
  if (encrypted) {
    var started = false;
    window.AgendaLive = { start: function (model, fromCache) { if (started) return; started = true; startLive(); useData(model, fromCache); } };
  }

  function boot() {
    if (encrypted) { registerSW(); return; }
    startLive();
    fetch('agenda.json').then(function (r) {
      var fromCache = r.headers.get('x-saved-copy') === '1';
      return r.json().then(function (j) { return { j: j, fromCache: fromCache }; });
    }).then(function (res) {
      useData(res.j, res.fromCache);
    }).catch(function () {
      // Data failed to load: keep the neutral static console and the full HTML agenda.
    });
    registerSW();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
