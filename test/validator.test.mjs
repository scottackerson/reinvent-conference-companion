import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkAgenda, validateSchema } from '../validate.mjs';

const root = new URL('../', import.meta.url);
const load = p => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const pack = load('events/reinvent-2026/event.json');
const schema = load('agenda.schema.json');

// A small valid agenda: Bellagio, Wynn session then Venetian session with plenty of time between.
const base = () => ({
  event: 'reinvent-2026',
  attendee: { name: 'Test Person' },
  hotel: { id: 'bellagio' },
  days: [{
    date: '2026-12-01',
    items: [
      { code: 'AAA101', title: 'First session', start: '09:00', end: '10:00', venueId: 'wynn', room: 'Room 1', status: 'walkup', seats: 50, backups: [] },
      { code: 'BBB202', title: 'Second session', start: '13:00', end: '14:00', venueId: 'ven', room: 'Room 2', status: 'walkup', seats: 50, backups: [] },
    ],
  }],
  privacy: 'host-login',
  meta: { lastUpdated: '2026-10-09', reservationsAsOf: '2026-10-09' },
});
const run = a => checkAgenda(pack, a, schema);

test('valid agenda has no errors', () => {
  const r = run(base());
  assert.deepEqual(r.errors, []);
});

test('overlap is an error naming day, item and field', () => {
  const a = base();
  a.days[0].items[1].venueId = 'wynn';
  a.days[0].items[1].start = '09:30';
  a.days[0].items[1].end = '10:30';
  const r = run(a);
  const msg = r.errors.find(e => /overlaps/.test(e));
  assert.ok(msg, r.errors.join('\n'));
  assert.match(msg, /Day tue \(2026-12-01\), item BBB202, field start/);
  assert.match(msg, /AAA101/);
});

test('tight venue change is a warning, not an error', () => {
  const a = base();
  a.days[0].items[1].start = '10:05'; // Wynn to Venetian takes 10 min, gap is 5
  a.days[0].items[1].end = '11:00';
  const r = run(a);
  assert.deepEqual(r.errors, []);
  const msg = r.warnings.find(e => /tight venue change/.test(e));
  assert.ok(msg, r.warnings.join('\n'));
  assert.match(msg, /item BBB202, field start/);
});

test('venue change with negative time is an error', () => {
  const a = base();
  a.days[0].items[1].start = '09:50'; // starts before the first ends, at another venue
  a.days[0].items[1].end = '10:50';
  const r = run(a);
  assert.ok(r.errors.some(e => /overlaps AAA101.*different venues/.test(e)), r.errors.join('\n'));
});

test('unknown venue is an error naming the field', () => {
  const a = base();
  a.days[0].items[0].venueId = 'nowhere';
  const r = run(a);
  const msg = r.errors.find(e => /unknown venue/.test(e));
  assert.ok(msg, r.errors.join('\n'));
  assert.match(msg, /Day tue \(2026-12-01\), item AAA101, field venueId/);
});

test('unknown hotel id is an error', () => {
  const a = base();
  a.hotel.id = 'not-a-hotel';
  assert.ok(run(a).errors.some(e => /^hotel\.id: unknown hotel/.test(e)));
});

test('code without title is an error naming the field', () => {
  const a = base();
  delete a.days[0].items[0].title;
  const r = run(a);
  const msg = r.errors.find(e => /code AAA101 has no title/.test(e));
  assert.ok(msg, r.errors.join('\n'));
  assert.match(msg, /item AAA101, field title/);
});

test('backup without a time is an error naming the field', () => {
  const a = base();
  a.days[0].items[0].backups = [{ code: 'CCC303', title: 'Backup', venueId: 'wynn' }];
  const r = run(a);
  assert.ok(r.errors.some(e => /item AAA101, field backups\[0\]\.time/.test(e)), r.errors.join('\n'));
});

test('date outside the event is an error', () => {
  const a = base();
  a.days[0].date = '2026-12-09';
  assert.ok(run(a).errors.some(e => /Day .*\(2026-12-09\), field date: outside the event dates/.test(e)));
});

test('missing privacy is an error naming the field', () => {
  const a = base();
  delete a.privacy;
  const r = run(a);
  assert.ok(r.errors.some(e => /^privacy: required field is missing/.test(e)), r.errors.join('\n'));
});

test('schema subset: bad time format and unknown field are reported with paths', () => {
  const a = base();
  a.days[0].items[0].start = '9am';
  a.days[0].items[0].bogus = 1;
  const errs = validateSchema(schema, a).map(e => e.path + ': ' + e.message);
  assert.ok(errs.some(e => e.startsWith('days[0].items[0].start:')), errs.join('\n'));
  assert.ok(errs.some(e => e.startsWith('days[0].items[0].bogus: unknown field')), errs.join('\n'));
});

test('CLI: --check exits 1 on errors and 0 on a good agenda', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agenda-'));
  const good = join(dir, 'good.json'), bad = join(dir, 'bad.json');
  writeFileSync(good, JSON.stringify(base()));
  const b = base(); delete b.privacy; writeFileSync(bad, JSON.stringify(b));
  const buildPath = new URL('../build.mjs', import.meta.url).pathname;
  const g = spawnSync('node', [buildPath, '--check', '--agenda', good], { encoding: 'utf8', cwd: dir });
  assert.equal(g.status, 0, g.stdout + g.stderr);
  const x = spawnSync('node', [buildPath, '--check', '--agenda', bad], { encoding: 'utf8', cwd: dir });
  assert.equal(x.status, 1);
  assert.match(x.stdout, /privacy: required field is missing/);
});

test('shipped agendas pass --check', () => {
  const buildPath = new URL('../build.mjs', import.meta.url).pathname;
  for (const f of ['agenda.example.json', 'agenda.json']) {
    const p = new URL('../' + f, import.meta.url).pathname;
    try { readFileSync(p); } catch { continue; }
    const r = spawnSync('node', [buildPath, '--check', '--agenda', p], { encoding: 'utf8' });
    assert.equal(r.status, 0, f + '\n' + r.stdout + r.stderr);
  }
});
