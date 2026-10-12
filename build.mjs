// Zero-dependency build.
//   node build.mjs                  build the site into public/
//   node build.mjs --check          validate the agenda only (schema plus meaning), exit 1 on errors
//   node build.mjs --agenda FILE    use FILE instead of agenda.json (works with --check too)
//   node build.mjs --out DIR        write the site to DIR instead of public/ (static assets are copied)
//   node build.mjs --private-out DIR  passphrase mode only: where print.html goes (default build-private/)
//   node build.mjs --salt-file FILE   passphrase mode only: where the PBKDF2 salt is kept (default .passphrase-salt)
//
// Data: events/<event>/event.json (event pack, shared; optional routes.json, transit.json, happenings.json and
// food.json beside it) plus agenda.json (one person's schedule).
// With no agenda.json the build uses agenda.example.json and shows an "Example agenda" banner.
// Rendering lives in render.mjs (pure, also usable in the browser); validation in validate.mjs.
//
// Privacy "passphrase": PASSPHRASE=... node build.mjs. index.html becomes a shell with no schedule in it,
// and the render input goes into agenda.enc (AES-256-GCM, key from PBKDF2-SHA-256). The browser
// (public/unlock.js) decrypts it and renders with a copy of render.mjs. No plaintext agenda.json or
// print.html is written to the output; the print variant goes to build-private/ (gitignored by itself).
// The salt is stable across builds (PASSPHRASE_SALT, else .passphrase-salt, created on first use), so a key a
// device stored keeps working after an update. The IV is fresh on every build. The salt is not secret.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, cpSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { render, fillTemplate } from './render.mjs';
import { checkAgenda } from './validate.mjs';

const root = new URL('./', import.meta.url);
const rootDir = fileURLToPath(root);
const read = p => readFileSync(new URL(p, root), 'utf8');
const fail = msg => { console.error(`build: ${msg}`); process.exit(1); };
const readJson = (p, what) => {
  try { return JSON.parse(read(p)); } catch (e) { return fail(`cannot read ${what} (${p}): ${e.message}`); }
};

const args = process.argv.slice(2);
const argVal = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const checkOnly = args.includes('--check');
let agendaPath = argVal('--agenda');
let example = false;
if (!agendaPath) {
  if (existsSync(new URL('agenda.json', root))) agendaPath = 'agenda.json';
  else { agendaPath = 'agenda.example.json'; example = true; }
}
if (/agenda\.example\.json$/.test(agendaPath)) example = true;

let agenda;
try { agenda = JSON.parse(readFileSync(new URL(agendaPath, root), 'utf8')); } catch (e) { fail(`cannot read ${agendaPath}: ${e.message}`); }
const packPath = `events/${agenda.event}/event.json`;
const pack = agenda.event && existsSync(new URL(packPath, root)) ? readJson(packPath, 'event pack') : null;
// Optional files next to event.json, merged into the pack: walking routes, transit lines, things happening
// around the city, and food near each venue. Each one is shared, public data.
if (pack) {
  for (const k of ['routes', 'transit', 'happenings', 'food']) {
    const p = `events/${agenda.event}/${k}.json`;
    if (existsSync(new URL(p, root))) pack[k] = readJson(p, `event pack ${k}`);
  }
}
const schema = readJson('agenda.schema.json', 'schema');

const { errors, warnings } = checkAgenda(pack, agenda, schema);
if (checkOnly || errors.length) {
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors) console.log(`error:   ${e}`);
  console.log(`${agendaPath}: ${errors.length} error(s), ${warnings.length} warning(s)`);
  if (errors.length) process.exit(1);
  if (checkOnly) process.exit(0);
}
for (const w of warnings) console.log(`warning: ${w}`);

// "host-login" and "public" produce the same static output; the host (or nobody) provides the login.
const encrypted = agenda.privacy === 'passphrase';
const passphrase = encrypted ? process.env.PASSPHRASE : undefined;
if (encrypted) {
  if (!passphrase) fail('privacy is "passphrase" but the PASSPHRASE environment variable is not set. Run: PASSPHRASE=\'your words here\' node build.mjs');
  // Never print the passphrase itself.
  if (passphrase.length < 20) console.log('warning: the passphrase is under 20 characters. Anyone can download agenda.enc and guess offline; use 5 or more random words.');
}

// PBKDF2 salt, stable across builds. Order: PASSPHRASE_SALT (base64 of 16 bytes), else the salt file
// (default .passphrase-salt in the repo root, gitignored), created with 16 random bytes when missing.
const SALT_RE = /^[A-Za-z0-9+/]{22}==$/;
function loadSalt() {
  const env = process.env.PASSPHRASE_SALT;
  if (env !== undefined && env !== '') {
    const v = env.trim();
    if (!SALT_RE.test(v)) fail('PASSPHRASE_SALT must be base64 of exactly 16 bytes (24 characters ending in "=="), for example the contents of .passphrase-salt.');
    return new Uint8Array(Buffer.from(v, 'base64'));
  }
  const file = resolvePath(argVal('--salt-file') || join(rootDir, '.passphrase-salt'));
  if (existsSync(file)) {
    const v = readFileSync(file, 'utf8').trim();
    if (!SALT_RE.test(v)) fail(`${file} must hold base64 of exactly 16 bytes. Delete it to make a new salt (every device will ask for the passphrase again).`);
    return new Uint8Array(Buffer.from(v, 'base64'));
  }
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  writeFileSync(file, Buffer.from(salt).toString('base64') + '\n');
  console.log(`created ${file} (the PBKDF2 salt, not secret). Hosts that build from a clean checkout (Cloudflare Pages, Netlify) need PASSPHRASE_SALT set to its contents, otherwise every deploy gets a new salt and phones ask for the passphrase again.`);
  return salt;
}

const defaultOut = join(rootDir, 'public');
const outDir = resolvePath(argVal('--out') || defaultOut);
const privDir = resolvePath(argVal('--private-out') || join(rootDir, 'build-private'));
const out = p => join(outDir, p);
const write = (p, s) => writeFileSync(out(p), s);
const remove = p => rmSync(out(p), { force: true });
mkdirSync(outDir, { recursive: true });
// Another output directory needs the committed static assets too.
if (outDir !== defaultOut) {
  for (const f of ['app.js', 'map.js', 'unlock.js', 'styles.css', 'icons', 'vendor']) cpSync(join(defaultOut, f), out(f), { recursive: true });
}

const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const banner = example ? 'Example agenda. Ask Claude to build yours.' : '';
const { model, placeholders } = render(pack, agenda, { stamp, banner });
const template = read('templates/index.html');
const html = fillTemplate(template, placeholders);

// Print variant: every <details> open, no JavaScript.
const printHtml = html.replace(/<details class="card/g, '<details open class="card').replace(/<script src="app.js"><\/script>\n?/, '').replace('<html lang="en">', '<html lang="en" class="print">');

// Retired service worker: removes the offline cache that earlier versions installed on phones.
const writeSw = () => write('sw.js', read('templates/sw.js'));
const writeManifest = desc => write('manifest.webmanifest', read('templates/manifest.webmanifest')
  .replace('__NAME__', JSON.stringify(model.event.name)).replace('__SHORT__', JSON.stringify(model.event.shortName))
  .replace('__DESC__', JSON.stringify(desc)));

if (!encrypted) {
  write('index.html', html);
  write('print.html', printHtml);
  // The browser (app.js) reads the resolved model, not the raw agenda.
  write('agenda.json', JSON.stringify(model));
  for (const f of ['agenda.enc', 'render.js']) remove(f);
  writeSw();
  const who = model.attendee.name ? `${model.attendee.name}'s ` : '';
  writeManifest(`${who}${model.event.name} agenda`);
} else {
  // Nothing personal may stay in the output from an earlier plain build.
  for (const f of ['agenda.json', 'print.html']) remove(f);

  // 1. Ciphertext. Payload is the render input (render.mjs needs the agenda, not just the resolved model,
  //    for decisions, trade-offs, rules and the travel table), plus the options used here.
  const subtle = webcrypto.subtle;
  const ITER = 600000;
  const salt = loadSalt();
  const iv = webcrypto.getRandomValues(new Uint8Array(12)); // fresh per build; the salt (so the key) stays
  // Key id: lets the browser tell whether its stored key fits this file without a trial decrypt. It depends
  // on the salt and iteration count only, never on the passphrase or the key.
  const kidHash = await subtle.digest('SHA-256', Buffer.concat([Buffer.from(salt), Buffer.from(String(ITER) + 'reinvent-cc-key-v1', 'utf8')]));
  const kid = Buffer.from(kidHash).toString('hex').slice(0, 16);
  const baseKey = await subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const payload = JSON.stringify({ v: 1, pack, agenda, options: { stamp, banner } });
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(payload));
  const b64 = u => Buffer.from(u instanceof ArrayBuffer ? new Uint8Array(u) : u).toString('base64');
  write('agenda.enc', JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), kid, iv: b64(iv), ct: b64(ct) }));

  // 2. Shell page. Head comes from templates/index.html; the body is templates/locked.html (event pack
  //    content only). The unfilled agenda body template rides along in a non-executable script element so
  //    the browser can fill it with render.mjs after decrypting. It holds placeholders, never data.
  const bodyStart = template.indexOf('<body>\n') + '<body>\n'.length;
  const bodyEnd = template.indexOf('<script src="app.js"></script>');
  if (bodyStart < 7 || bodyEnd < bodyStart) fail('templates/index.html: cannot find <body> and the app.js script tag');
  const agendaTpl = template.slice(bodyStart, bodyEnd);
  if (/<\/script/i.test(agendaTpl)) fail('templates/index.html: the agenda body must not contain a script tag');
  // Whitelist: only event pack values (plus the example banner and build stamp) reach the shell.
  const shellPlaceholders = {};
  for (const k of ['TITLE', 'SHORT_NAME', 'H1', 'BANNER', 'DATES', 'GETTING_AROUND', 'BASICS', 'SUPPORT_EMAIL', 'BUILD_STAMP']) shellPlaceholders[k] = placeholders[k];
  const shellBody = fillTemplate(read('templates/locked.html'), shellPlaceholders);
  const head = fillTemplate(template.slice(0, bodyStart), { TITLE: placeholders.TITLE, SHORT_NAME: placeholders.SHORT_NAME })
    .replace('<html lang="en">', '<html lang="en" data-encrypted>');
  const shell = head + shellBody +
    '<script type="text/x-agenda-template" id="agenda-template">\n' + agendaTpl + '</script>\n' +
    '<script src="app.js"></script>\n<script type="module" src="unlock.js"></script>\n</body>\n</html>\n';
  write('index.html', shell);

  // 3. The renderer for the browser. .js so every static host serves it as JavaScript.
  writeFileSync(out('render.js'), readFileSync(new URL('render.mjs', root)));
  writeSw();
  writeManifest(`${model.event.name} agenda`);

  // 4. Print variant for the local PDF only, outside the deployed folder.
  mkdirSync(privDir, { recursive: true });
  writeFileSync(join(privDir, '.gitignore'), '*\n');
  writeFileSync(join(privDir, 'print.html'), printHtml);
  cpSync(join(defaultOut, 'styles.css'), join(privDir, 'styles.css'));
  console.log(`print variant (not deployed): ${join(privDir, 'print.html')}`);
}

const counts = model.days.map(d => d.items.filter(i => i.kind !== 'travel').length);
console.log(`built ${stamp}${example ? ' (example agenda)' : ''}${encrypted ? ' (encrypted)' : ''}: items per day ${counts.join('/')} (${counts.reduce((a, b) => a + b, 0)} total, travel rows excluded)${outDir !== defaultOut ? ' into ' + outDir : ''}`);
