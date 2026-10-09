// Pure rendering module. No Node APIs: it must run unchanged in Node (build.mjs) and in the browser.
//
//   resolve(eventPack, agenda)            -> model (everything derived: days, travel rows, leave-by, venues)
//   render(eventPack, agenda, options)    -> { model, placeholders }  (HTML fragments for templates/index.html)
//   fillTemplate(template, placeholders)  -> string
//
// The model is plain JSON. build.mjs writes it to public/agenda.json for the browser (app.js).

// ---------- time and date helpers ----------
export const mins = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
export const toHHMM = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const hhmm = n => { const h = Math.floor(n / 60) % 24; return `${h % 12 || 12}:${String(n % 60).padStart(2, '0')}`; };
const mer = n => (Math.floor(n / 60) % 24) < 12 ? 'AM' : 'PM';
export const t12 = s => `${hhmm(mins(s))} ${mer(mins(s))}`;
const range = (s, e, approx) => {
  const a = mins(s), b = mins(e);
  return mer(a) === mer(b) ? `${hhmm(a)} to ${approx ? 'about ' : ''}${hhmm(b)} ${mer(b)}`
    : `${hhmm(a)} ${mer(a)} to ${approx ? 'about ' : ''}${hhmm(b)} ${mer(b)}`;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEK_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ymd = d => d.split('-').map(Number);
export const fmtDate = d => { const [y, m, dd] = ymd(d); return `${MONTHS[m - 1]} ${dd}, ${y}`; };
export const fmtShort = d => { const [, m, dd] = ymd(d); return `${MONTHS[m - 1]} ${dd}`; };
const weekdayIdx = d => { const [y, m, dd] = ymd(d); return new Date(Date.UTC(y, m - 1, dd)).getUTCDay(); };
export const weekdayLong = d => WEEK_LONG[weekdayIdx(d)];
export const dayId = d => WEEK_LONG[weekdayIdx(d)].slice(0, 3).toLowerCase();
export const dayTitle = d => { const [, m, dd] = ymd(d); return `${weekdayLong(d)}, ${MONTHS_LONG[m - 1]} ${dd}`; };
export const dayTab = d => `${weekdayLong(d).slice(0, 3)} ${ymd(d)[2]}`;
const addDays = (d, n) => { const [y, m, dd] = ymd(d); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const label = it => it.code ? `${it.code} ${it.title}` : it.title;

// ---------- resolve: derive everything the page needs ----------
export function findHotel(pack, agenda) {
  const h = agenda.hotel || {};
  if (h.id) {
    const base = (pack.hotels || []).find(x => x.id === h.id);
    if (!base) return null;
    return { ...base, checkIn: h.checkIn, checkOut: h.checkOut };
  }
  return { id: 'custom', ...h };
}

export function travelBetween(pack, a, b) {
  const t = pack.travelTimes || {};
  return (t[a] && t[a][b]) ?? (t[b] && t[b][a]) ?? null;
}

export function resolve(pack, agenda) {
  const V = Object.fromEntries(pack.venues.map(v => [v.id, v]));
  const hotel = findHotel(pack, agenda);
  const defaults = {
    arriveEarlyMinutes: { ...(pack.defaults || {}).arriveEarlyMinutes, ...((agenda.defaults || {}).arriveEarlyMinutes) },
    leaveBufferMinutes: (agenda.defaults || {}).leaveBufferMinutes ?? (pack.defaults || {}).leaveBufferMinutes ?? 0,
  };
  const hotelMin = v => hotel.venueId === v ? 0 : (hotel.minutesTo || {})[v];
  const earlyFor = it => {
    const e = defaults.arriveEarlyMinutes;
    return (it.status === 'reserved' ? e.reserved : it.status === 'walkup' ? e.walkup : e.event) || 0;
  };

  const used = new Set(), usedMain = new Set(), venueDays = {};
  const days = [...agenda.days].sort((a, b) => a.date < b.date ? -1 : 1).map((d, di, all) => {
    const id = dayId(d.date);
    const main = [...d.items].sort((a, b) => mins(a.start) - mins(b.start));
    const seen = {};
    const items = [];
    let prev = null, n = 0;
    for (const raw of main) {
      const it = { ...raw };
      delete it.travelBefore;
      let base = `${id}-${raw.code ? slug(raw.code) : slug(raw.title)}`;
      seen[base] = (seen[base] || 0) + 1;
      it.id = raw.id || (seen[base] > 1 ? `${base}-${seen[base]}` : base);
      it.kind = raw.kind || 'session';
      if (prev && prev.venueId !== it.venueId) {
        const tb = raw.travelBefore || {};
        const m = tb.mins ?? travelBetween(pack, prev.venueId, it.venueId) ?? 30;
        const start = tb.start ? mins(tb.start) : mins(it.start) - m;
        const note = tb.note ?? (pack.travelNotes || {})[`${prev.venueId}>${it.venueId}`] ?? `Leave by ${t12(toHHMM(start))}`;
        items.push({ id: `${id}-move-${++n}`, kind: 'travel', start: toHHMM(start), end: tb.end || it.start, fromVenueId: prev.venueId, toVenueId: it.venueId, mins: m, note, estimated: true });
      }
      items.push(it);
      used.add(it.venueId); usedMain.add(it.venueId);
      (venueDays[it.venueId] = venueDays[it.venueId] || []);
      if (!venueDays[it.venueId].includes(id)) venueDays[it.venueId].push(id);
      for (const b of it.backups || []) used.add(b.venueId);
      prev = it;
    }
    items.sort((a, b) => mins(a.start) - mins(b.start)); // stable: keeps item order on ties
    const firstItem = items.find(i => i.kind !== 'travel');
    const lo = d.leaveHotelBy || {};
    const lm = hotelMin(firstItem.venueId) ?? 30;
    const leave = { time: lo.time || toHHMM(mins(firstItem.start) - lm - earlyFor(firstItem) - defaults.leaveBufferMinutes), itemId: firstItem.id, venueId: firstItem.venueId };
    if (lo.note) leave.note = lo.note;
    // venue sequence, consecutive duplicates collapsed
    const seq = [];
    for (const i of items) if (i.kind !== 'travel' && seq[seq.length - 1] !== i.venueId) seq.push(i.venueId);
    const day = {
      id, date: d.date, tab: dayTab(d.date), title: dayTitle(d.date),
      venueSequence: seq,
      sequenceText: d.sequenceText || seq.map(v => V[v].name).join(', then '),
      leaveHotelBy: leave, items, openSlots: d.openSlots || [],
    };
    let foot = d.footnote;
    if (foot === undefined && di === all.length - 1) {
      const missing = [];
      for (let x = addDays(d.date, 1); x <= pack.dates.end; x = addDays(x, 1)) missing.push(dayTitle(x));
      if (missing.length) foot = `${missing.join(' and ')}: nothing scheduled.`;
    }
    if (foot) day.footnote = foot;
    return day;
  });

  const notes = agenda.venueNotes || {};
  const venues = pack.venues.filter(v => used.has(v.id)).map(v => {
    const dys = venueDays[v.id] || [];
    const note = notes[v.id] ?? (dys.length ? v.notes : `${v.notes || ''} No sessions on the current plan; backups are here.`.trim());
    return { id: v.id, name: v.name, shortName: v.shortName || v.name, address: v.address, appleMapsQuery: v.appleMapsQuery, days: dys, notes: note, map: v.map };
  });
  const hotelNote = hotel.checkIn && hotel.checkOut ? `Hotel. Reservation ${fmtShort(hotel.checkIn)} to ${fmtShort(hotel.checkOut)}.` : 'Hotel.';
  const travelTimes = { ...(pack.travelTimes || {}), '@hotel': { ...(hotel.minutesTo || {}) } };
  return {
    event: { id: pack.id, name: pack.name, shortName: pack.shortName || pack.name, city: pack.city, dates: pack.dates, timezone: pack.timezone, timezoneLabel: pack.timezoneLabel || '' },
    attendee: agenda.attendee || {},
    hotel: { key: '@hotel', id: hotel.id, name: hotel.name, address: hotel.address, appleMapsQuery: hotel.appleMapsQuery, venueId: hotel.venueId, checkIn: hotel.checkIn, checkOut: hotel.checkOut, minutesTo: hotel.minutesTo || {}, map: hotel.map, note: hotelNote },
    venues, travelTimes, walk: pack.walk || [], days,
    meta: { ...(agenda.meta || {}), supportEmail: pack.supportEmail },
    _usedMain: [...usedMain],
  };
}

// ---------- render ----------
export function render(pack, agenda, options = {}) {
  const model = resolve(pack, agenda);
  delete model._usedMain;
  const V = Object.fromEntries(model.venues.map(v => [v.id, v]));
  const hotel = model.hotel;
  const dir = (q, mode = 'w') => `https://maps.apple.com/?daddr=${encodeURIComponent(q)}&dirflg=${mode}`;
  const dirV = v => dir(V[v].appleMapsQuery);
  const dayAbbr = id => id[0].toUpperCase() + id.slice(1);
  const attendeeFirst = String(model.attendee.name || '').split(' ')[0];

  const badge = it => {
    if (it.status === 'reserved') return '<span class="badge b-res">Reserved</span>';
    if (it.status === 'walkup') return '<span class="badge b-walk">Walk-up</span>';
    if (it.status === 'estimated' || it.estimated) return '<span class="badge b-est">Estimated</span>';
    return '<span class="badge b-ev">Event</span>';
  };
  const statusDetail = it => {
    if (it.status === 'reserved') return `Reserved seat, confirmed in the portal on ${fmtDate(model.meta.reservationsAsOf)}.`;
    if (it.status === 'walkup') return `Walk-up, first come first served. ${it.seats != null ? Number(it.seats).toLocaleString('en-US') + ' seats.' : ''}`.trim();
    return it.detail || 'Event.';
  };
  const nodeCls = it => it.status === 'reserved' ? 'res' : it.status === 'walkup' ? 'walk' : (it.status === 'estimated' || it.estimated) ? 'est' : 'ev';
  const backupLine = b => `${b.code} ${b.title}, ${b.time}, ${V[b.venueId].name}${b.room ? ', ' + b.room : ''}.${b.note ? ' ' + b.note : ''}`;

  function renderTravel(it) {
    const long = it.mins >= 45 ? ' long' : '';
    return `<li class="row move${long}">
      <div class="time">${hhmm(mins(it.start))}</div>
      <div class="rail"><span class="node node-move" aria-hidden="true"></span></div>
      <div class="movebody">
        <div class="moveline"><strong>Move to ${esc(V[it.toVenueId].name)}</strong> <span class="mins">about ${it.mins} min</span></div>
        <div class="movesub">From ${esc(V[it.fromVenueId].name)}. ${esc(it.note)}. Estimate.</div>
      </div></li>`;
  }
  function renderGap(g) {
    return `<li class="row gap"><div class="time">${hhmm(mins(g.start))}</div><div class="rail"><span class="node node-gap" aria-hidden="true"></span></div><div class="gapbody">${esc(g.note)}, ${range(g.start, g.end)}</div></li>`;
  }
  function renderItem(it, prevVenue) {
    const v = V[it.venueId];
    const venueTag = it.venueId !== prevVenue ? `<div class="venuetag">${esc(v.name)}</div>` : '';
    const est = it.kind === 'keynote' || it.status === 'estimated' || it.estimated;
    const kcls = est ? ' est' : it.kind === 'event' ? ' ev' : '';
    const title = it.code ? `<span class="code">${esc(it.code)}</span> ${esc(it.title)}` : esc(it.title);
    const backups = it.backups && it.backups.length
      ? `<div class="iffull"><div class="lbl">If full</div><ul>${it.backups.map(b => `<li>${esc(backupLine(b))}</li>`).join('')}</ul></div>` : '';
    const arrive = it.arriveNote ? `<div class="kv"><span class="k">Arrive by</span><span class="v">${esc(it.arriveNote)}</span></div>` : '';
    const search = [it.code, it.title, it.room, v.name, it.type].filter(Boolean).join(' ').toLowerCase();
    const room = it.room ? `${v.name}, ${it.room}` : v.name;
    return `<li class="row" data-id="${it.id}" data-search="${esc(search)}">
    <div class="time">${hhmm(mins(it.start))}</div>
    <div class="rail"><span class="node node-${nodeCls(it)}" aria-hidden="true"></span></div>
    <div class="cardwrap">${venueTag}
    <details class="card${kcls}" id="${it.id}">
      <summary>
        <span class="sumtop">${badge(it)}<span class="span">${range(it.start, it.end, it.endApprox)}</span></span>
        <span class="sumtitle">${title}</span>
        <span class="sumroom">${esc(room)}</span>
      </summary>
      <div class="body">
        <div class="kv"><span class="k">Type</span><span class="v">${esc(it.type || '')}${it.tier ? `, ${esc(it.tier)}` : ''}</span></div>
        <div class="kv"><span class="k">Where</span><span class="v">${esc(room)}</span></div>
        <div class="kv"><span class="k">Status</span><span class="v">${esc(statusDetail(it))}</span></div>
        ${arrive}${backups}
        <a class="btn btn-ghost" href="${dirV(it.venueId)}">Directions to ${esc(v.name)}</a>
      </div>
    </details></div></li>`;
  }

  function routeSvg(day) {
    const stops = [{ name: hotel.name, time: `Leave ${t12(day.leaveHotelBy.time)}`, hotel: true }];
    let cur = null;
    for (const it of day.items) {
      if (it.kind === 'travel') continue;
      if (cur && cur.id === it.venueId) { cur.end = it.end; cur.approx = it.endApprox; }
      else { cur = { id: it.venueId, start: it.start, end: it.end, approx: it.endApprox }; stops.push(cur); cur.name = V[it.venueId].name; }
    }
    stops.forEach(s => { if (!s.hotel) s.time = range(s.start, s.end, s.approx); });
    const n = stops.length, W = 360, pad = 24;
    const xs = stops.map((_, i) => n === 1 ? W / 2 : pad + i * ((W - 2 * pad) / (n - 1)));
    const y = 62;
    let g = '';
    for (let i = 0; i < n - 1; i++) {
      g += `<line class="r-line" x1="${(xs[i] + 10).toFixed(1)}" y1="${y}" x2="${(xs[i + 1] - 10).toFixed(1)}" y2="${y}"/>`;
      const ax = xs[i + 1] - 10;
      g += `<path class="r-arrow" d="M${(ax + 1).toFixed(1)} ${y} l-8 -5 v10 z"/>`;
    }
    stops.forEach((s, i) => {
      const above = i % 2 === 0;
      const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
      const tx = i === 0 ? 2 : i === n - 1 ? W - 2 : xs[i];
      const ny = above ? 22 : 92, ty = above ? 40 : 110;
      g += `<circle class="r-dot${s.hotel ? ' hotel' : ''}" cx="${xs[i].toFixed(1)}" cy="${y}" r="7"/>`;
      g += `<text class="r-name" x="${tx.toFixed(1)}" y="${ny}" text-anchor="${anchor}">${esc(s.name)}</text><text class="r-time" x="${tx.toFixed(1)}" y="${ty}" text-anchor="${anchor}">${esc(s.time)}</text>`;
    });
    const desc = stops.map(s => `${s.name} ${s.time}`).join(', then ');
    return `<div class="route"><svg viewBox="0 0 ${W} 122" role="img" aria-label="Route for ${esc(day.title)}: ${esc(desc)}"><title>${esc(desc)}</title>${g}</svg></div>`;
  }

  const itemById = {};
  model.days.forEach(d => d.items.forEach(i => { itemById[i.id] = i; }));

  function renderDay(day) {
    const rows = [
      ...day.items.map(i => ({ s: mins(i.start), html: null, i })),
      ...day.openSlots.map(g => ({ s: mins(g.start), html: renderGap(g) })),
    ].sort((a, b) => a.s - b.s);
    let prev = null;
    const out = rows.map(r => {
      if (r.html) return r.html;
      const it = r.i;
      if (it.kind === 'travel') { prev = it.toVenueId; return renderTravel(it); }
      const h = renderItem(it, prev); prev = it.venueId; return h;
    }).join('\n');
    const first = itemById[day.leaveHotelBy.itemId];
    const fv = V[first.venueId];
    const estNote = (first.status === 'estimated' || first.kind === 'keynote') ? ` (estimated ${t12(first.start)})` : '';
    const leaveFor = `${label(first)}${estNote}`;
    return `<section class="day" id="${day.id}" aria-labelledby="${day.id}-h">
    <header class="dayhead">
      <h2 id="${day.id}-h">${esc(day.title)}</h2>
      <p class="seq">${esc(day.sequenceText)}</p>
      <a class="leave" href="${dirV(first.venueId)}"><span class="leave-k">Leave the ${esc(hotel.name)} by</span><span class="leave-t">${t12(day.leaveHotelBy.time)}</span><span class="leave-s">for ${esc(leaveFor)} at ${esc(fv.name)}.${day.leaveHotelBy.note ? ' ' + esc(day.leaveHotelBy.note) : ''} Estimate.</span></a>
      ${routeSvg(day)}
    </header>
    <ol class="timeline">
      <li class="row start"><div class="time">${esc(hotel.name)}</div><div class="rail"><span class="node node-hotel" aria-hidden="true"></span></div><div class="startbody">Start at the hotel</div></li>
      ${out}
    </ol>
    ${day.footnote ? `<p class="footnote">${esc(day.footnote)}</p>` : ''}
  </section>`;
  }

  // ---- Strip map: only venues used plus the hotel ----
  const SIDE_X = { west: 150, east: 210 };
  const venuePin = v => {
    const m = v.map, x = m.x ?? SIDE_X[m.side], y = m.y, r = m.r || 9, dl = v.days.map(dayAbbr).join(' ');
    const west = m.side === 'west';
    const lb = m.label || { x: west ? x - 16 : x + 16, y: y - 2, subY: y + 16, anchor: west ? 'end' : 'start' };
    const anchor = lb.anchor === 'end' ? ' text-anchor="end"' : '';
    const hotelTag = hotel.venueId === v.id ? `<text x="${lb.x}" y="${lb.subY + 16}"${anchor} class="m-hotel">Hotel</text>` : '';
    const circle = v.days.length
      ? `<circle cx="${x}" cy="${y}" r="${r}" fill="var(--violet)"/>`
      : `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="var(--text-2)" stroke-width="2"/>`;
    const sub = v.days.length ? `<text x="${lb.x}" y="${lb.subY}"${anchor} class="m-days">${dl}</text>` : `<text x="${lb.x}" y="${lb.subY}"${anchor} class="m-dim">Backup only</text>`;
    return { y, svg: `<g class="pin">${circle}<text x="${lb.x}" y="${lb.y}"${anchor} class="m-name">${esc(v.name)}</text>${sub}${hotelTag}</g>` };
  };
  const hotelPin = () => {
    const m = hotel.map;
    if (!m || (hotel.venueId && V[hotel.venueId])) return null;
    const x = m.x ?? SIDE_X[m.side], y = m.y, west = m.side === 'west';
    const lx = west ? x - 22 : x + 22, an = west ? ' text-anchor="end"' : '';
    return { y, svg: `<g class="pin"><rect x="${x - 11}" y="${y - 11}" width="22" height="22" rx="4" fill="var(--magenta)"/><text x="${x}" y="${y + 5}" text-anchor="middle" class="m-h">H</text><text x="${lx}" y="${y - 2}"${an} class="m-name">${esc(hotel.name)}</text><text x="${lx}" y="${y + 16}"${an} class="m-hotel">Hotel</text></g>` };
  };
  const pins = [...model.venues.map(venuePin), hotelPin()].filter(Boolean).sort((a, b) => a.y - b.y).map(p => p.svg);
  const owner = attendeeFirst ? `${attendeeFirst}'s` : 'the';
  const mapSvg = `<svg viewBox="0 0 360 560" role="img" aria-labelledby="map-t" class="strip">
  <title id="map-t">Schematic of the Las Vegas Strip showing ${esc(owner)} venues and hotel</title>
  <text x="180" y="22" text-anchor="middle" class="m-dim">N</text>
  <path d="M180 28 l-6 10 h12 z" fill="var(--text-2)"/>
  <line x1="180" y1="44" x2="180" y2="540" stroke="var(--border)" stroke-width="10" stroke-linecap="round"/>
  <line x1="180" y1="44" x2="180" y2="540" stroke="var(--bg)" stroke-width="2" stroke-dasharray="8 8"/>
  <text x="180" y="556" text-anchor="middle" class="m-dim">Las Vegas Blvd</text>
  ${pins.join('\n  ')}
</svg>`;

  const row = (name, addr, note, isHotel, q) => `<li class="venue">
  <div><div class="vname">${esc(name)}${isHotel ? ' <span class="badge b-hotel">Hotel</span>' : ''}</div><div class="vaddr">${esc(addr)}</div>${note ? `<div class="vnote">${esc(note)}</div>` : ''}</div>
  <a class="btn btn-small" href="${dir(q)}">Directions<span class="sr"> to ${esc(name)}</span></a></li>`;
  const venueList = model.venues.map(v => row(v.name, v.address, v.notes, false, v.appleMapsQuery)).join('') +
    row(hotel.name, hotel.address, hotel.note, true, hotel.appleMapsQuery);

  // ---- travel table: rows = venues with sessions, columns add backup-only venues and the hotel ----
  const withDays = model.venues.filter(v => v.days.length).map(v => v.id);
  const backupOnly = model.venues.filter(v => !v.days.length).map(v => v.id);
  const custom = agenda.travelTable || {};
  const rowsIds = custom.rows || withDays;
  const colIds = custom.cols || [...withDays, ...backupOnly, 'hotel'];
  const walkSet = new Set(model.walk);
  const walkSeen = new Set();
  const minutes = (a, b) => (model.travelTimes[a] && model.travelTimes[a][b]) ?? (model.travelTimes[b] && model.travelTimes[b][a]);
  const cell = (r, c) => {
    if (c === r) return '<td><span class="self">here</span></td>';
    const m = c === 'hotel' ? model.hotel.minutesTo[r] : minutes(r, c);
    if (m == null) return '<td>-</td>';
    let tag = '';
    const key = [r, c].sort().join('|');
    if (c !== 'hotel' && (walkSet.has(`${r}>${c}`) || walkSet.has(`${c}>${r}`)) && !walkSeen.has(key)) { walkSeen.add(key); tag = ' walk'; }
    return `<td${m >= 45 ? ' class="far"' : ''}>${m}${tag}</td>`;
  };
  const colName = c => c === 'hotel' ? hotel.name : V[c].shortName;
  const ttHtml = `<table class="tt"><thead><tr><th scope="col">From</th>${colIds.map(c => `<th scope="col">${esc(colName(c))}</th>`).join('')}</tr></thead><tbody>${rowsIds.map(r => `<tr><th scope="row">${esc(V[r].name)}</th>${colIds.map(c => cell(r, c)).join('')}</tr>`).join('')}</tbody></table>`;

  // ---- basics, decisions ----
  const srcText = s => String(s).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const basicsHtml = (pack.basics || []).map(b => {
    const ok = b.status === 'confirmed';
    return `<li class="basic"><div class="bk">${esc(b.item)}</div><div class="bv">${esc(b.value)}</div><div class="bsrc"><span class="badge ${ok ? 'b-res' : 'b-unc'}">${ok ? 'Confirmed' : 'Unconfirmed'}</span> <span>${esc(srcText(b.source || 'No source yet'))}</span></div></li>`;
  }).join('');
  const opt = o => `<div class="optt">${o.code ? esc(o.code) + ' ' : ''}${esc(o.title)}</div><div class="opts">${esc(o.detail || '')}</div>`;
  const decHtml = (agenda.decisions || []).map(d => `<article class="dec"><h3>${esc(d.when)}</h3>
  <div class="opt cur"><div class="optlbl">Current plan</div>${opt(d.current)}</div>
  ${(d.alternatives || []).map((a, i) => `<div class="opt"><div class="optlbl">Alternative${d.alternatives.length > 1 ? ' ' + (i + 1) : ''}</div>${opt(a)}</div>`).join('')}
  ${d.note ? `<p class="decnote">${esc(d.note)}</p>` : ''}</article>`).join('');

  // ---- assemble ----
  const d0 = model.days[0], dN = model.days[model.days.length - 1];
  const firstItem = d0.items.find(i => i.kind !== 'travel');
  const hotelLine = hotel.checkIn && hotel.checkOut ? `Staying at ${esc(hotel.name)}. Check in ${fmtShort(hotel.checkIn)}, check out ${fmtShort(hotel.checkOut)}.` : `Staying at ${esc(hotel.name)}.`;
  const dow = d => d.tab.split(' ')[0];
  const placeholders = {
    TITLE: esc(model.event.name),
    SHORT_NAME: esc(model.event.shortName),
    H1: esc(model.event.name).replace(':', '<span>:</span>'),
    BANNER: options.banner ? `<p class="banner" role="note">${esc(options.banner)}</p>` : '',
    DATES: esc(`${fmtShort(model.event.dates.start)} to ${fmtShort(model.event.dates.end)}, ${model.event.city}`),
    ATTENDEE: esc(model.attendee.name || ''),
    HOTEL_LINE: hotelLine,
    RANGE_SHORT: `${dow(d0)} ${fmtShort(d0.date)} to ${dow(dN)} ${fmtShort(dN.date)}`,
    FIRST_DAY_LONG: esc(d0.title), FIRST_DAY_ID: d0.id, FIRST_DAY_NAME: esc(d0.title.split(',')[0]),
    FIRST_UP: `First up: ${t12(firstItem.start)}, ${esc(label(firstItem))}, ${esc(V[firstItem.venueId].name)}. Leave the ${esc(hotel.name)} by ${t12(d0.leaveHotelBy.time)} (estimate).`,
    DAY_TABS: model.days.map(d => { const [w, n] = d.tab.split(' '); return `<a href="#${d.id}" data-day="${d.id}">${esc(w)}<b>${esc(n)}</b></a>`; }).join(''),
    DAYS: model.days.map(renderDay).join('\n'),
    MAP_SVG: mapSvg, VENUES: venueList, DECISIONS: decHtml,
    TRADEOFFS: (agenda.tradeoffs || []).map(t => `<li>${esc(t)}</li>`).join(''),
    RULES: (agenda.rules || []).map(t => `<li>${esc(t)}</li>`).join(''),
    GETTING_AROUND: esc(pack.gettingAround || ''),
    TRAVEL_TABLE: ttHtml, BASICS: basicsHtml,
    LAST_UPDATED: fmtDate(model.meta.lastUpdated), RES_AS_OF: fmtDate(model.meta.reservationsAsOf),
    SUPPORT_EMAIL: esc(pack.supportEmail || ''), BUILD_STAMP: options.stamp || '',
  };
  return { model, placeholders };
}

export function fillTemplate(template, placeholders) {
  return template.replace(/\{\{([A-Z_0-9]+)\}\}/g, (m, k) => { if (!(k in placeholders)) throw new Error('Missing placeholder ' + k); return placeholders[k]; });
}
