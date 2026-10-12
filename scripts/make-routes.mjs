// Walking paths for the map: node scripts/make-routes.mjs [events/reinvent-2026] [--refresh-access]
//
// Paths stay on the Strip. Every venue and hotel in event.json has a stripAccess point: the spot on Las Vegas
// Boulevard in front of it (the nearest point on the boulevard to its geo). A path is
//   place -> its stripAccess   straight line through the property (casino interiors are not on the map); an
//                              off-Strip venue with "stripAccessFrom" (Caesars Forum: linq, Sphere: ven) goes
//                              through that neighbor: its access point, its building, then the venue
//   stripAccess -> stripAccess the OpenStreetMap foot route between the two points on the boulevard, so it
//                              follows the Strip sidewalks and pedestrian bridges
//   stripAccess -> place       as above.
// Missing stripAccess points are computed from the boulevard's geometry (Overpass API) and written back to
// event.json; --refresh-access recomputes all of them. Routing uses routing.openstreetmap.de, one request a
// second. Writes routes.json next to event.json. The minutes on screen still come from travelTimes in
// event.json; the script prints the walking-route minutes next to them to compare.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UA, r5, sleep, simplify } from './lib-geo.mjs';

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--')) || 'events/reinvent-2026';
const refresh = args.includes('--refresh-access');
const packPath = join(dir, 'event.json');
const pack = JSON.parse(readFileSync(packPath, 'utf8'));
const STRIP_NAME = 'Las Vegas Boulevard';
const BBOX = '36.085,-115.185,36.135,-115.15';

// ---- geometry helpers (local flat projection; fine at city scale) ----
const K = Math.cos(36.11 * Math.PI / 180);
const meters = (a, b) => Math.hypot((a[0] - b[0]) * K, a[1] - b[1]) * 111320;
function nearestOnLines(p, lines) {
  let best = null, bd = Infinity;
  for (const line of lines) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = (b[0] - a[0]) * K, dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, (((p[0] - a[0]) * K) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const d = meters(p, q);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

async function overpass(q) {
  const servers = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  for (let i = 0; i < 10; i++) {
    for (const s of servers) {
      try {
        const res = await fetch(s, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
        const t = await res.text();
        if (t.startsWith('{')) return JSON.parse(t);
      } catch (e) { /* next server */ }
    }
    console.log('Overpass busy, retrying in 30 s'); await sleep(30000);
  }
  throw new Error('Overpass did not answer. Try again later.');
}

// ---- 1. strip access points ----
const all = [...pack.venues, ...pack.hotels.filter(h => !h.venueId)];
const need = all.filter(p => p.geo && !p.stripAccessFrom && (refresh || !p.stripAccess));
if (need.length) {
  const j = await overpass(`[out:json][timeout:60];way["highway"="primary"]["name"~"${STRIP_NAME}",i](${BBOX});out geom;`);
  const lines = j.elements.map(w => w.geometry.map(g => [g.lon, g.lat]));
  for (const p of need) {
    p.stripAccess = nearestOnLines(p.geo, lines).map(r5);
    console.log(`stripAccess ${(p.id).padEnd(14)} ${p.stripAccess.join(', ')}  (${Math.round(meters(p.geo, p.stripAccess))} m from its point)`);
  }
  writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n');
}
// An off-Strip venue reached through a neighbor ("stripAccessFrom": "linq" for Caesars Forum, "ven" for Sphere)
// uses that neighbor's access point; the walk from there is routed.
const byId = id => pack.venues.find(v => v.id === id) || pack.hotels.find(h => h.id === id);
for (const p of all) if (p.stripAccessFrom) {
  const n = byId(p.stripAccessFrom);
  if (!n || !n.stripAccess) throw new Error(`${p.id}.stripAccessFrom: unknown place or no stripAccess on "${p.stripAccessFrom}"`);
  p.stripAccess = n.stripAccess;
}

// ---- 2. routes ----
async function foot(a, b) {
  const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${a.join(',')};${b.join(',')}?overview=full&geometries=geojson`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const j = await res.json();
  await sleep(1100);
  if (j.code !== 'Ok') throw new Error(j.code);
  return { line: j.routes[0].geometry.coordinates, meters: j.routes[0].distance };
}
const places = {};
for (const v of pack.venues) if (v.geo) places[v.id] = v;
for (const h of pack.hotels) if (h.geo && !h.venueId) places[`hotel:${h.id}`] = h;
const venueIds = pack.venues.filter(v => v.geo).map(v => v.id);
const pairs = new Set();
for (const a of Object.keys(places)) for (const b of venueIds) if (a !== b) pairs.add([a, b].sort().join('|'));

// Leg between a place and its access point: straight through the property.
const tails = {};
function tail(id) {
  if (tails[id]) return tails[id];
  const p = places[id];
  // Off-Strip venues: through the neighbor (Linq Promenade to Caesars Forum, Venetian and its bridge to Sphere).
  // The foot router does not know those indoor walkways and detours around the block, so these are straight too.
  const pts = p.stripAccessFrom ? [p.stripAccess, byId(p.stripAccessFrom).geo, p.geo] : [p.stripAccess, p.geo];
  let m = 0; for (let i = 1; i < pts.length; i++) m += meters(pts[i - 1], pts[i]);
  tails[id] = { line: pts, meters: m };
  return tails[id];
}

const routes = {};
const tt = pack.travelTimes || {};
for (const key of [...pairs].sort()) {
  const [a, b] = key.split('|');
  try {
    const pa = places[a], pb = places[b];
    // A venue and the neighbor it is reached through (Venetian and Sphere): straight across, not via the Strip.
    const via = (p, id) => p.stripAccessFrom && (id === p.stripAccessFrom || id === `hotel:${p.stripAccessFrom}`);
    if (via(pa, b) || via(pb, a)) {
      const m = Math.round(meters(pa.geo, pb.geo));
      routes[key] = { meters: m, walkMin: Math.round(m / 75), line: [pa.geo, pb.geo] };
      console.log(`${key.padEnd(28)} ${String(m).padStart(5)} m  direct between neighbors`);
      continue;
    }
    const ta = tail(a), tb = tail(b);
    let mid = { line: [pa.stripAccess, pb.stripAccess], meters: 0 };
    if (meters(pa.stripAccess, pb.stripAccess) > 30) mid = await foot(pa.stripAccess, pb.stripAccess);
    const line = [...[...ta.line].reverse(), ...mid.line, ...tb.line].map(([x, y]) => [r5(x), r5(y)]);
    const m = Math.round(ta.meters + mid.meters + tb.meters);
    routes[key] = { meters: m, walkMin: Math.round(m / 75), line: simplify(line) };
    const table = a.startsWith('hotel:') ? (places[a].minutesTo || {})[b] : (tt[a] || {})[b] ?? (tt[b] || {})[a];
    console.log(`${key.padEnd(28)} ${String(m).padStart(5)} m  about ${String(Math.round(m / 75)).padStart(3)} min walking  table ${table ?? '-'} min`);
  } catch (e) { console.log(`skip ${key}: ${e.message}`); }
}
const out = { source: 'OpenStreetMap contributors (ODbL), foot routing by routing.openstreetmap.de (FOSSGIS)', checked: new Date().toISOString().slice(0, 10), _note: 'Generated by scripts/make-routes.mjs. Paths stay on the Strip; the part inside a property is a straight line. Minutes on screen come from travelTimes in event.json.', routes };
writeFileSync(join(dir, 'routes.json'), JSON.stringify(out) + '\n');
console.log(`wrote ${Object.keys(routes).length} routes to ${join(dir, 'routes.json')}`);
