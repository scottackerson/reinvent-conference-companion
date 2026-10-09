#!/usr/bin/env node
// Usage: node scripts/check-private.mjs <url>
// Requests the site with no cookies and fails (exit 1) if the agenda is readable by anyone.
// No dependencies.

const base = process.argv[2];
if (!base || !/^https?:\/\//.test(base)) {
  console.error('Usage: node scripts/check-private.mjs <https://your-site.example>');
  process.exit(2);
}
// Paths are relative to the URL given, so a subpath works: https://user.github.io/project/
const root = base.replace(/\/+$/, '');

async function get(path) {
  try {
    const res = await fetch(path === '/' ? root + '/' : root + '/' + path, { redirect: 'manual', headers: { cookie: '', 'user-agent': 'check-private/1.0' } });
    const body = res.status === 200 ? await res.text() : '';
    return { status: res.status, location: res.headers.get('location') || '', body };
  } catch (err) {
    return { status: 0, location: '', body: '', error: err.message };
  }
}

// A rendered agenda has day sections and session cards (see render.mjs).
const hasCards = (html) => /<section class="day"/.test(html) || /<details class="card/.test(html);
function hasAgendaJson(text) {
  try {
    const j = JSON.parse(text);
    return j && Array.isArray(j.days) && j.days.length > 0;
  } catch { return false; }
}

function redirectHost(loc) {
  try { return new URL(loc, root).host; } catch { return loc || 'unknown'; }
}

const paths = ['/', 'index.html', 'agenda.json', 'agenda.enc'];
const results = {};
for (const p of paths) results[p] = await get(p);

const rows = [];
let exposed = [];
for (const p of paths) {
  const r = results[p];
  let verdict;
  if (r.error) verdict = 'request failed: ' + r.error;
  else if (r.status >= 300 && r.status < 400) verdict = `protected (redirect to ${redirectHost(r.location)})`;
  else if (r.status === 401 || r.status === 403) verdict = 'protected';
  else if (r.status === 200) {
    if (p === 'agenda.json') {
      if (hasAgendaJson(r.body)) { verdict = 'PUBLIC: readable agenda data'; exposed.push(p); }
      else verdict = 'open, no agenda data';
    } else if (p === 'agenda.enc') verdict = 'open (ciphertext only)';
    else if (hasCards(r.body)) { verdict = 'PUBLIC: readable agenda page'; exposed.push(p); }
    else verdict = 'open, no agenda content';
  } else verdict = r.status === 404 ? 'not found' : 'status ' + r.status;
  rows.push([p, String(r.status || 'ERR'), verdict]);
}

const w = [Math.max(...rows.map(r => r[0].length), 4), 6];
console.log(`Checking ${root}`);
console.log('PATH'.padEnd(w[0]) + '  ' + 'STATUS'.padEnd(w[1]) + '  RESULT');
for (const r of rows) console.log(r[0].padEnd(w[0]) + '  ' + r[1].padEnd(w[1]) + '  ' + r[2]);

if (exposed.length) {
  console.log(`\nFAIL: your agenda is public at: ${exposed.map(p => p === '/' ? root + '/' : root + '/' + p).join(', ')}`);
  console.log('Turn on host login (see docs/hosting.md) or switch to passphrase mode (docs/privacy.md), then redeploy and re-run this check.');
  process.exit(1);
}
const enc = results['agenda.enc'], aj = results['agenda.json'];
if (aj.status === 404 && enc.status === 200) {
  console.log('\nPASS: passphrase mode detected: content is encrypted.');
  process.exit(0);
}
if (Object.values(results).every(r => r.status === 0)) {
  console.log('\nFAIL: could not reach the site, so privacy is unverified.');
  process.exit(1);
}
console.log('\nPASS: no agenda content is readable without logging in.');
process.exit(0);
