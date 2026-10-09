// Passphrase mode: the built output must hold no personal data, and agenda.enc must decrypt only with the
// right passphrase. Builds agenda.example.json (switched to privacy "passphrase") into a temp directory.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto, createHash } from 'node:crypto';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const load = p => JSON.parse(readFileSync(join(rootDir, p), 'utf8'));
const example = load('agenda.example.json');
const pack = load(`events/${example.event}/event.json`);
const PASS = 'example passphrase with five words';

const tmp = mkdtempSync(join(tmpdir(), 'agenda-pass-'));
const agendaFile = join(tmp, 'agenda.json');
const outDir = join(tmp, 'site');
const privDir = join(tmp, 'private');
writeFileSync(agendaFile, JSON.stringify({ ...example, privacy: 'passphrase' }));

const saltFile = join(tmp, 'salt');
// Every build names a salt file in the temp directory, so tests never create .passphrase-salt in the repo.
const build = (env, out = outDir, salt = saltFile) => spawnSync(process.execPath,
  ['build.mjs', '--agenda', agendaFile, '--out', out, '--private-out', privDir, '--salt-file', salt],
  { cwd: rootDir, encoding: 'utf8', env: { ...process.env, PASSPHRASE: '', PASSPHRASE_SALT: '', ...env } });
const readEnc = dir => JSON.parse(readFileSync(join(dir, 'agenda.enc'), 'utf8'));
const kidFor = (saltB64, iter) => createHash('sha256').update(Buffer.concat([Buffer.from(saltB64, 'base64'), Buffer.from(String(iter) + 'reinvent-cc-key-v1')])).digest('hex').slice(0, 16);

const files = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : [p]; });

// Personal strings: every title, code, room, plus attendee and hotel. Strings that are also in the public
// event pack (for example the room "Expo", which the basics mention) are public anyway, so they are skipped.
function personalStrings() {
  const s = new Set([example.attendee.name, example.attendee.name.split(' ')[0]]);
  const hotel = pack.hotels.find(h => h.id === example.hotel.id);
  s.add(hotel.name);
  const add = o => { for (const k of ['code', 'title', 'room']) if (o && o[k]) s.add(o[k]); };
  for (const d of example.days) for (const it of d.items) { add(it); (it.backups || []).forEach(add); }
  for (const d of example.decisions || []) { add(d.current); (d.alternatives || []).forEach(add); if (d.current.detail) s.add(d.current.detail); }
  for (const t of [...(example.tradeoffs || []), ...(example.rules || [])]) s.add(t);
  s.add('Nov 29'); s.add('2026-11-29'); s.add('2026-12-04'); // hotel check-in, check-out
  const packText = JSON.stringify(pack);
  return [...s].filter(x => x && !packText.includes(x));
}

let built;
before(() => { built = build({ PASSPHRASE: PASS }); });

test('passphrase build succeeds and writes the expected files', () => {
  assert.equal(built.status, 0, built.stderr + built.stdout);
  assert.ok(!built.stdout.includes(PASS) && !built.stderr.includes(PASS), 'passphrase printed');
  for (const f of ['index.html', 'agenda.enc', 'sw.js', 'manifest.webmanifest', 'render.js', 'unlock.js', 'app.js', 'styles.css']) assert.ok(existsSync(join(outDir, f)), f);
  for (const f of ['agenda.json', 'print.html']) assert.ok(!existsSync(join(outDir, f)), `${f} must not be in the output`);
  assert.ok(existsSync(join(privDir, 'print.html')), 'print variant written to the private directory');
  assert.match(readFileSync(join(privDir, 'print.html'), 'utf8'), /COP406-R/);
});

test('no file in the output contains personal data', () => {
  const needles = personalStrings();
  assert.ok(needles.length > 20, `expected many strings to check, got ${needles.length}`);
  for (const f of files(outDir)) {
    const text = readFileSync(f, 'utf8');
    for (const n of needles) assert.ok(!text.includes(n), `${f} contains "${n}"`);
  }
});

test('shell page has the form, the noscript message and no schedule', () => {
  const html = readFileSync(join(outDir, 'index.html'), 'utf8');
  assert.match(html, /<input id="passphrase"[^>]*type="password"[^>]*autocomplete="current-password"/);
  assert.match(html, /<noscript>.*This agenda is encrypted\. Turn on JavaScript to read it\..*<\/noscript>/);
  assert.match(html, />Unlock<\/button>/);
  assert.ok(!/class="day"/.test(html), 'no rendered day sections');
  const sw = readFileSync(join(outDir, 'sw.js'), 'utf8');
  assert.match(sw, /"agenda\.enc"/);
  assert.ok(!/"agenda\.json"/.test(sw));
});

async function deriveKey(passphrase, enc) {
  const s = webcrypto.subtle;
  const base = await s.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return s.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(enc.salt, 'base64'), iterations: enc.iter }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}
const decrypt = async (passphrase, enc) => JSON.parse(new TextDecoder().decode(await webcrypto.subtle.decrypt(
  { name: 'AES-GCM', iv: Buffer.from(enc.iv, 'base64') }, await deriveKey(passphrase, enc), Buffer.from(enc.ct, 'base64'))));

test('agenda.enc decrypts with the right passphrase and fails with a wrong one', async () => {
  const enc = JSON.parse(readFileSync(join(outDir, 'agenda.enc'), 'utf8'));
  assert.equal(enc.v, 1); assert.equal(enc.kdf, 'PBKDF2-SHA256'); assert.equal(enc.iter, 600000);
  assert.equal(Buffer.from(enc.salt, 'base64').length, 16);
  assert.equal(Buffer.from(enc.iv, 'base64').length, 12);
  const payload = await decrypt(PASS, enc);
  assert.equal(payload.agenda.attendee.name, example.attendee.name);
  assert.equal(payload.agenda.days.length, 4);
  assert.equal(payload.pack.id, pack.id);
  await assert.rejects(decrypt('wrong passphrase entirely here', enc));
});

test('the payload renders with render.mjs, as the browser does', async () => {
  const { render, fillTemplate } = await import(pathToFileURL(join(outDir, 'render.js')).href);
  const enc = JSON.parse(readFileSync(join(outDir, 'agenda.enc'), 'utf8'));
  const p = await decrypt(PASS, enc);
  const html = readFileSync(join(outDir, 'index.html'), 'utf8');
  const tpl = /<script type="text\/x-agenda-template" id="agenda-template">\n([\s\S]*?)<\/script>/.exec(html)[1];
  const out = fillTemplate(tpl, render(p.pack, p.agenda, p.options).placeholders);
  assert.equal((out.match(/<section class="day"/g) || []).length, 4);
  assert.match(out, /COP406-R/);
});

test('the first build creates the salt file and says so, without the passphrase', () => {
  assert.ok(existsSync(saltFile), 'salt file created');
  const v = readFileSync(saltFile, 'utf8').trim();
  assert.equal(Buffer.from(v, 'base64').length, 16);
  assert.equal(readEnc(outDir).salt, v);
  assert.match(built.stdout, /created .*salt.*PASSPHRASE_SALT/);
  assert.ok(!built.stdout.includes(PASS));
});

test('agenda.enc has a kid from salt and iterations only', () => {
  const enc = readEnc(outDir);
  assert.match(enc.kid, /^[0-9a-f]{16}$/);
  assert.equal(enc.kid, kidFor(enc.salt, enc.iter));
  // Same salt, other passphrase: same kid.
  const out = join(tmp, 'site-otherpass');
  const r = build({ PASSPHRASE: 'a different passphrase of five words' }, out);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readEnc(out).kid, enc.kid);
});

test('two builds with the same salt source keep salt and kid, with a fresh IV and ciphertext', () => {
  const out2 = join(tmp, 'site2');
  const r = build({ PASSPHRASE: PASS }, out2);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!/created /.test(r.stdout), 'salt file not created again');
  const a = readEnc(outDir), b = readEnc(out2);
  assert.equal(a.salt, b.salt); assert.equal(a.kid, b.kid);
  assert.notEqual(a.iv, b.iv); assert.notEqual(a.ct, b.ct);
});

test('PASSPHRASE_SALT overrides the salt file', () => {
  const envSalt = Buffer.alloc(16, 7).toString('base64');
  const out = join(tmp, 'site-env');
  const r = build({ PASSPHRASE: PASS, PASSPHRASE_SALT: envSalt }, out);
  assert.equal(r.status, 0, r.stderr);
  const enc = readEnc(out);
  assert.equal(enc.salt, envSalt);
  assert.equal(enc.kid, kidFor(envSalt, enc.iter));
  assert.notEqual(enc.salt, readFileSync(saltFile, 'utf8').trim());
});

test('a malformed PASSPHRASE_SALT fails the build', () => {
  for (const bad of ['not base64!', Buffer.alloc(15).toString('base64'), Buffer.alloc(32).toString('base64')]) {
    const r = build({ PASSPHRASE: PASS, PASSPHRASE_SALT: bad }, join(tmp, 'site-bad'));
    assert.notEqual(r.status, 0, bad);
    assert.match(r.stderr, /PASSPHRASE_SALT must be base64 of exactly 16 bytes/);
  }
});

test('a malformed salt file fails the build', () => {
  const f = join(tmp, 'bad-salt');
  writeFileSync(f, 'abc\n');
  const r = build({ PASSPHRASE: PASS }, join(tmp, 'site-badfile'), f);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /must hold base64 of exactly 16 bytes/);
});

test('missing PASSPHRASE fails the build', () => {
  const r = build({ PASSPHRASE: '' }, join(tmp, 'site3'));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /PASSPHRASE environment variable is not set/);
});

test('short passphrase warns but builds, without printing it', () => {
  const r = build({ PASSPHRASE: 'shortpass99' }, join(tmp, 'site4'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /warning: the passphrase is under 20 characters/);
  assert.ok(!r.stdout.includes('shortpass99') && !r.stderr.includes('shortpass99'));
});
