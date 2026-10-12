// Free time, Around Vegas, food, map data and the event pack checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, render, routeBetween, walkMinutes } from '../render.mjs';
import { checkPack } from '../validate.mjs';

const json = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const base = json('../events/reinvent-2026/event.json');
const pack = { ...base, happenings: json('../events/reinvent-2026/happenings.json'), food: json('../events/reinvent-2026/food.json'), routes: json('../events/reinvent-2026/routes.json'), transit: json('../events/reinvent-2026/transit.json') };
const agenda = json('../agenda.example.json');

test('shipped event pack extras pass checkPack', () => {
  assert.deepEqual(checkPack(pack), []);
});

test('checkPack reports bad happenings, food and routes', () => {
  const bad = { ...pack, happenings: { items: [{ id: 'x', title: 'X', category: 'party', dates: ['Dec 1'], start: '8pm', source: 'http://example.com' }, { id: 'x', title: 'Y', category: 'show', dates: ['2026-12-01'], source: 'https://example.com' }] },
    food: { items: [{ name: 'F', venueId: 'nowhere', kind: 'snack' }] }, routes: { routes: { 'wynn|cp': { line: [[0, 0]] } } } };
  const out = checkPack(bad).join('\n');
  for (const s of ['category', 'dates', 'start', 'source', 'appears twice', 'venueId', 'kind', 'sorted order', 'two or more']) assert.match(out, new RegExp(s), s);
});

test('every venue and pack hotel has coordinates and every hotel has a path to every venue', () => {
  for (const v of pack.venues) assert.ok(v.geo, v.id);
  for (const h of pack.hotels) {
    if (h.venueId) continue;
    assert.ok(h.geo, h.id);
    for (const v of pack.venues) assert.ok(routeBetween(pack, `hotel:${h.id}`, v.id), `${h.id} to ${v.id}`);
  }
});

test('routeBetween reverses a stored path for the other direction', () => {
  const a = routeBetween(pack, 'cp', 'wynn'), b = routeBetween(pack, 'wynn', 'cp');
  assert.deepEqual(a.line[0], b.line[b.line.length - 1]);
});

test('free time: gaps, evening, ideas within reach, food and the map legs', () => {
  const m = resolve(pack, agenda);
  for (const d of m.days) {
    assert.ok(d.legs.length >= 1, d.id);
    for (const b of d.free) {
      assert.ok(b.end > b.start, `${b.id} has a positive length`);
      for (const x of b.ideas) {
        if (x.time) assert.ok(x.time >= b.start && x.time < b.end, `${x.title} starts inside ${b.id}`);
        assert.ok(x.walk == null || x.walk <= 60, `${x.title} is within walking range`);
      }
    }
  }
  assert.ok(m.days.some(d => d.free.some(b => b.kind === 'evening')), 'some evening is free');
  assert.ok(m.around.items.length > 10);
});

test('externalMap false leaves the map off and keeps the schematic', () => {
  const { model, placeholders } = render(pack, { ...agenda, externalMap: false });
  assert.equal(model.map, null);
  assert.equal(placeholders.MAP_ATTR, '');
  assert.match(placeholders.MAP_SVG, /<svg/);
  const on = render(pack, agenda);
  assert.equal(on.placeholders.MAP_ATTR, ' data-map="1"');
  assert.match(on.model.map.style, /^https:\/\//);
});

test('walking estimate is at least 5 minutes and grows with distance', () => {
  assert.equal(walkMinutes([-115.17, 36.11], [-115.17, 36.11]), 5);
  assert.ok(walkMinutes([-115.17, 36.10], [-115.17, 36.13]) > 30);
});

test('rendered copy has no em dashes or emojis', () => {
  const { placeholders } = render(pack, agenda);
  const all = Object.values(placeholders).join('');
  assert.ok(!all.includes('—'), 'em dash');
  assert.ok(!/\p{Extended_Pictographic}/u.test(all), 'emoji');
});
