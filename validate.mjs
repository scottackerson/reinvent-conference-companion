// Validator for agenda.json. Pure ES module (no Node APIs), zero dependencies.
//   validateSchema(schema, data)            -> [{ path, message }]   (small JSON Schema subset)
//   checkAgenda(pack, agenda, schema)       -> { errors: string[], warnings: string[] }
import { mins, findHotel, travelBetween, dayId } from './render.mjs';

// ---------- JSON Schema subset: type, enum, const, pattern, minLength, minimum, maximum, minItems,
// required, properties, additionalProperties (false or schema), items, local $ref ----------
export function validateSchema(root, data) {
  const out = [];
  const typeOf = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  const resolveRef = ref => { let n = root; for (const k of ref.replace(/^#\//, '').split('/')) n = n[k]; return n; };
  function walk(schema, v, path) {
    if (schema.$ref) schema = resolveRef(schema.$ref);
    const t = typeOf(v);
    if (schema.type) {
      const types = [].concat(schema.type);
      const ok = types.some(x => x === t || (x === 'integer' && t === 'number' && Number.isInteger(v)));
      if (!ok) { out.push({ path, message: `must be ${types.join(' or ')}, found ${t}` }); return; }
    }
    if (schema.enum && !schema.enum.includes(v)) out.push({ path, message: `must be one of ${schema.enum.map(x => JSON.stringify(x)).join(', ')}, found ${JSON.stringify(v)}` });
    if ('const' in schema && v !== schema.const) out.push({ path, message: `must be ${JSON.stringify(schema.const)}` });
    if (t === 'string') {
      if (schema.minLength != null && v.length < schema.minLength) out.push({ path, message: 'must not be empty' });
      if (schema.pattern && !new RegExp(schema.pattern).test(v)) out.push({ path, message: `"${v}" does not match the expected format ${schema.pattern}` });
    }
    if (t === 'number') {
      if (schema.minimum != null && v < schema.minimum) out.push({ path, message: `must be at least ${schema.minimum}` });
      if (schema.maximum != null && v > schema.maximum) out.push({ path, message: `must be at most ${schema.maximum}` });
    }
    if (t === 'array') {
      if (schema.minItems != null && v.length < schema.minItems) out.push({ path, message: `needs at least ${schema.minItems} item(s)` });
      if (schema.items) v.forEach((x, i) => walk(schema.items, x, `${path}[${i}]`));
    }
    if (t === 'object') {
      for (const r of schema.required || []) if (!(r in v)) out.push({ path: path ? `${path}.${r}` : r, message: 'required field is missing' });
      const props = schema.properties || {};
      for (const k of Object.keys(v)) {
        const p = path ? `${path}.${k}` : k;
        if (props[k]) walk(props[k], v[k], p);
        else if (schema.additionalProperties === false) out.push({ path: p, message: 'unknown field' });
        else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') walk(schema.additionalProperties, v[k], p);
      }
    }
  }
  walk(root, data, '');
  return out;
}

// ---------- semantic checks ----------
export function checkAgenda(pack, agenda, schema) {
  const errors = [], warnings = [];
  const days = Array.isArray(agenda.days) ? agenda.days : [];
  const itemName = it => (it && (it.code || it.title)) || 'unnamed item';
  const dayName = d => `Day ${d && d.date ? `${dayIdSafe(d.date)} (${d.date})` : '?'}`;
  const dayIdSafe = date => /^\d{4}-\d{2}-\d{2}$/.test(date) ? dayId(date) : '?';
  const where = (d, it, field) => `${dayName(d)}${it ? `, item ${itemName(it)}` : ''}${field ? `, field ${field}` : ''}`;
  const err = (d, it, field, msg) => errors.push(`${where(d, it, field)}: ${msg}`);
  const warn = (d, it, field, msg) => warnings.push(`${where(d, it, field)}: ${msg}`);

  // schema pass, with day and item names in the message
  if (schema) {
    for (const e of validateSchema(schema, agenda)) {
      const m = /^days\[(\d+)\](?:\.items\[(\d+)\])?(?:\.backups\[(\d+)\])?(?:\.(.*))?$/.exec(e.path);
      if (m) {
        const d = days[+m[1]], it = m[2] != null && d && d.items ? d.items[+m[2]] : null;
        let field = m[4] || '';
        if (m[3] != null) field = `backups[${m[3]}]${field ? '.' + field : ''}`;
        err(d, it, field, e.message);
      } else errors.push(`${e.path || 'agenda'}: ${e.message}`);
    }
  }

  if (agenda.privacy === undefined) errors.push('privacy: required field is missing. Set "host-login" (private repo plus a host login), "passphrase" (encrypted) or "public".');
  else if (!['host-login', 'passphrase', 'public'].includes(agenda.privacy) && !schema) errors.push(`privacy: must be "host-login", "passphrase" or "public", found ${JSON.stringify(agenda.privacy)}`);

  if (!pack) { errors.push(`event: unknown event pack "${agenda.event}"`); return { errors, warnings }; }
  if (agenda.event !== pack.id) errors.push(`event: "${agenda.event}" does not match the event pack "${pack.id}"`);
  const V = Object.fromEntries(pack.venues.map(v => [v.id, v]));

  // hotel
  const hotel = agenda.hotel ? findHotel(pack, agenda) : null;
  if (agenda.hotel && agenda.hotel.id && !hotel) errors.push(`hotel.id: unknown hotel "${agenda.hotel.id}". Known ids: ${pack.hotels.map(h => h.id).join(', ')}`);
  if (agenda.hotel && !agenda.hotel.id) {
    if (!agenda.hotel.name) errors.push('hotel.name: a custom hotel needs a name (or give an id from the event pack)');
    if (!agenda.hotel.minutesTo) errors.push('hotel.minutesTo: a custom hotel needs minutes to each conference venue you use');
  }
  if (agenda.hotel && agenda.hotel.checkIn && agenda.hotel.checkOut && agenda.hotel.checkOut < agenda.hotel.checkIn) errors.push('hotel.checkOut: is before checkIn');

  const priorities = Array.isArray(agenda.priorities) ? agenda.priorities : [];
  const used = new Set();
  const seenDates = new Set();
  let prevDate = '';
  for (const d of days) {
    if (!d || typeof d !== 'object') continue;
    if (typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
      if (d.date < pack.dates.start || d.date > pack.dates.end) err(d, null, 'date', `outside the event dates ${pack.dates.start} to ${pack.dates.end}`);
      if (seenDates.has(d.date)) err(d, null, 'date', 'appears twice');
      seenDates.add(d.date);
      if (prevDate && d.date < prevDate) warn(d, null, 'date', 'days are not in date order (the build sorts them)');
      prevDate = d.date;
      const ci = agenda.hotel && agenda.hotel.checkIn, co = agenda.hotel && agenda.hotel.checkOut;
      if ((ci && d.date < ci) || (co && d.date > co)) warn(d, null, 'date', `outside the hotel stay ${ci || '?'} to ${co || '?'}`);
    }
    const items = Array.isArray(d.items) ? d.items.filter(i => i && typeof i === 'object') : [];
    for (const it of items) {
      if (it.code && !it.title) err(d, it, 'title', `code ${it.code} has no title. Every session code must be shown with its title`);
      if (!it.code && !it.title) err(d, it, 'title', 'item has neither a code nor a title');
      if (it.venueId && !V[it.venueId]) err(d, it, 'venueId', `unknown venue "${it.venueId}". Known ids: ${pack.venues.map(v => v.id).join(', ')}`);
      else if (it.venueId) used.add(it.venueId);
      if (it.status === 'walkup' && it.seats == null) warn(d, it, 'seats', 'walk-up session without a seat count');
      if (it.tier && priorities.length && !priorities.includes(it.tier)) warn(d, it, 'tier', `"${it.tier}" is not in priorities`);
      const ok = /^\d\d:\d\d$/.test(it.start || '') && /^\d\d:\d\d$/.test(it.end || '');
      if (ok && mins(it.end) <= mins(it.start)) err(d, it, 'end', `ends (${it.end}) at or before it starts (${it.start})`);
      (it.backups || []).forEach((b, i) => {
        if (!b || typeof b !== 'object') return;
        const bf = f => `backups[${i}].${f}`;
        if (b.code && !b.title) err(d, it, bf('title'), `backup ${b.code} has no title. Every session code must be shown with its title`);
        if (!b.time || !String(b.time).trim()) err(d, it, bf('time'), `backup ${b.code || ''} needs a time (for example "Tue 3:00 PM")`.replace('  ', ' '));
        if (b.venueId && !V[b.venueId]) err(d, it, bf('venueId'), `unknown venue "${b.venueId}"`);
        else if (b.venueId) used.add(b.venueId);
      });
    }
    // overlaps and venue changes
    const timed = items.filter(i => /^\d\d:\d\d$/.test(i.start || '') && /^\d\d:\d\d$/.test(i.end || '') && mins(i.end) > mins(i.start))
      .sort((a, b) => mins(a.start) - mins(b.start));
    const overlapped = new Set();
    for (let i = 0; i < timed.length; i++) for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i], b = timed[j];
      if (mins(b.start) < mins(a.end)) {
        const f = `${a.end} is after ${b.start}`;
        const msg = `overlaps ${itemName(a)} (${a.start} to ${a.end}); ${f}${a.venueId !== b.venueId ? ', and they are at different venues' : ''}`;
        if (a.endApprox) warn(d, b, 'start', msg + ' (the end time of the first is approximate)'); else err(d, b, 'start', msg);
        overlapped.add(`${i}|${j}`);
      }
    }
    for (let i = 1; i < timed.length; i++) {
      const a = timed[i - 1], b = timed[i];
      if (a.venueId === b.venueId || !V[a.venueId] || !V[b.venueId] || overlapped.has(`${i - 1}|${i}`)) continue;
      const gap = mins(b.start) - mins(a.end);
      const need = (b.travelBefore && b.travelBefore.mins) ?? travelBetween(pack, a.venueId, b.venueId);
      if (need == null) { warn(d, b, 'venueId', `no travel time known between ${V[a.venueId].name} and ${V[b.venueId].name}`); continue; }
      if (gap < 0) err(d, b, 'start', `starts ${-gap} min before ${itemName(a)} ends, and ${V[a.venueId].name} to ${V[b.venueId].name} needs about ${need} min`);
      else if (gap < need) warn(d, b, 'start', `tight venue change: ${gap} min after ${itemName(a)} ends, but ${V[a.venueId].name} to ${V[b.venueId].name} takes about ${need} min (estimate)`);
    }
    (d.openSlots || []).forEach((g, i) => { if (g && g.venueId && !V[g.venueId]) err(d, null, `openSlots[${i}].venueId`, `unknown venue "${g.venueId}"`); });
  }

  // hotel minutes for the venues used
  if (hotel) for (const v of used) {
    if (hotel.venueId === v) continue;
    if (!hotel.minutesTo || hotel.minutesTo[v] == null) (agenda.hotel.id ? warnings : errors).push(`hotel.minutesTo.${v}: no minutes from ${hotel.name} to ${V[v].name}; leave-the-hotel times need it`);
  }
  if (agenda.venueNotes) for (const k of Object.keys(agenda.venueNotes)) if (!V[k]) warnings.push(`venueNotes.${k}: unknown venue`);
  const tt = agenda.travelTable || {};
  for (const k of ['rows', 'cols']) (tt[k] || []).forEach((id, i) => { if (!V[id] && !(k === 'cols' && id === 'hotel')) errors.push(`travelTable.${k}[${i}]: unknown venue "${id}"`); });
  (agenda.decisions || []).forEach((dec, i) => {
    const check = (o, f) => { if (o && o.code && !o.title) errors.push(`decisions[${i}].${f}: code ${o.code} has no title`); };
    check(dec.current, 'current'); (dec.alternatives || []).forEach((a, j) => check(a, `alternatives[${j}]`));
  });
  return { errors, warnings };
}
