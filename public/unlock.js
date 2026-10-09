/* Passphrase mode (privacy "passphrase"). The page arrives as a locked shell with no schedule in it.
   This module fetches agenda.enc, derives the key from the passphrase (PBKDF2-SHA-256, same parameters as
   build.mjs), decrypts with AES-256-GCM, renders with render.js (a build-time copy of render.mjs), then hands
   the model to app.js for the live features. The derived key is kept in IndexedDB as a non-extractable
   CryptoKey so this device reopens the agenda without the passphrase, also offline, until Lock is used.
   It is stored with the file's kid (a hash of the salt and iteration count, not of the passphrase). The salt
   stays the same across builds, so after an update the kid still matches and the stored key keeps working.
   A different kid (new salt) or a failed decrypt (new passphrase, same salt) asks for the passphrase again.
   Nothing here logs, stores or sends the passphrase. Unused in host-login builds. */
import { render, fillTemplate } from './render.js';

const DB = 'agenda-lock', STORE = 'keys', KEY_ID = 'agenda';
const WRONG = 'That passphrase did not unlock the agenda. Check it and try again.';
const NO_FILE = 'Could not load the agenda. Check your connection and try again.';
const $ = id => document.getElementById(id);
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/* ---------- key storage (IndexedDB can be missing or blocked: every call fails soft) ---------- */
function idb(mode, op) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction(STORE, mode);
        const req = op(tx.objectStore(STORE));
        tx.oncomplete = () => { db.close(); resolve(req.result); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      } catch (e) { db.close(); reject(e); }
    };
  });
}
async function loadKey() { try { return (await idb('readonly', s => s.get(KEY_ID))) || null; } catch (e) { return null; } }
async function saveKey(rec) { try { await idb('readwrite', s => s.put(rec, KEY_ID)); } catch (e) { /* this visit still works */ } }
async function dropKey() { try { await idb('readwrite', s => s.delete(KEY_ID)); } catch (e) { /* nothing stored */ } }

/* ---------- crypto ---------- */
async function fetchEnc() {
  const r = await fetch('agenda.enc'); // service worker: network first, saved copy when offline
  if (!r.ok) throw new Error('agenda.enc ' + r.status);
  const enc = await r.json();
  if (enc.v !== 1 || enc.kdf !== 'PBKDF2-SHA256' || !(enc.iter >= 100000)) throw new Error('agenda.enc format');
  return { enc, fromCache: r.headers.get('x-saved-copy') === '1' };
}
async function deriveKey(passphrase, enc) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(enc.salt), iterations: enc.iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}
async function decrypt(key, enc) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(enc.iv) }, key, fromB64(enc.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ---------- render ---------- */
function show(payload, fromCache) {
  const { model, placeholders } = render(payload.pack, payload.agenda, payload.options || {});
  const tpl = document.createElement('template'); // inert: nothing runs while parsing
  tpl.innerHTML = fillTemplate($('agenda-template').textContent, placeholders);
  const top = tpl.content.querySelector('.top');
  if (top) {
    const p = document.createElement('p');
    p.innerHTML = '<button type="button" class="lock" id="lock">Lock</button>';
    top.appendChild(p);
  }
  $('locked').replaceWith(tpl.content);
  $('lock').addEventListener('click', async () => { await dropKey(); location.reload(); });
  if (window.AgendaLive) window.AgendaLive.start(model, fromCache);
  // Keep the hash target (for example #wed) in view now that it exists.
  if (location.hash) { const el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView(); }
}

/* ---------- boot ---------- */
async function main() {
  const form = $('unlock-form'), input = $('passphrase'), msg = $('unlock-msg'), btn = $('unlock-btn');
  if (!form) return;
  if (!window.crypto || !crypto.subtle) {
    // Keep the form hidden: without a submit handler the browser would submit it natively.
    const p = document.createElement('p'); p.className = 'unlock-msg';
    p.textContent = 'This browser cannot decrypt the agenda. Try an up-to-date Safari, Chrome or Firefox.';
    form.after(p);
    return;
  }
  const say = text => { msg.textContent = text; };
  const showForm = text => { form.hidden = false; say(text || ''); };
  let got = null;

  // Attach the handler before the form can be shown. The input has no name, so even a native submit
  // could not put the passphrase in a URL.
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const pass = input.value;
    if (!pass) return;
    btn.disabled = true; btn.textContent = 'Unlocking'; say('');
    try {
      if (!got) {
        try { got = await fetchEnc(); } catch (err) { say(NO_FILE); return; }
      }
      let key, payload;
      try { key = await deriveKey(pass, got.enc); payload = await decrypt(key, got.enc); }
      catch (err) { say(WRONG); input.select(); return; }
      input.value = '';
      await saveKey({ key, kid: got.enc.kid || null, salt: got.enc.salt });
      try { show(payload, got.fromCache); } catch (err) { say('The agenda could not be shown.'); }
    } finally {
      btn.disabled = false; btn.textContent = 'Unlock';
    }
  });

  const [stored, fetched] = await Promise.all([loadKey(), fetchEnc().catch(() => null)]);
  if (!got) got = fetched;
  if (stored && stored.key && got) {
    // kid identifies salt plus iterations. Older stored records have no kid: fall back to the salt.
    const fits = got.enc.kid && stored.kid ? stored.kid === got.enc.kid : stored.salt === got.enc.salt;
    let payload = null;
    if (fits) {
      try { payload = await decrypt(stored.key, got.enc); } catch (e) { /* passphrase changed, salt kept */ }
    }
    if (payload) {
      try { show(payload, got.fromCache); } catch (e) { showForm('The agenda could not be shown.'); }
      return;
    }
    await dropKey(); // new salt, or same salt with a new passphrase: the stored key no longer fits
    showForm('The agenda was updated. Enter the passphrase again.');
  }
  if (form.hidden) showForm(got ? '' : NO_FILE);
}

main();
