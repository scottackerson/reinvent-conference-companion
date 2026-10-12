# Privacy

Your agenda shows where you will be, hour by hour, and where you are staying. Choose how it is protected. Set `privacy` in `agenda.json`. The build refuses to run without it.

## The rule

`agenda.json` must never be committed to a public repository. In a public repo, either keep it out of git (add `agenda.json` to `.gitignore` in your copy) or make the repo private. Do not deploy without running `npm run check-private -- <url>`.

## Three modes

### host-login

The site is built as static HTML and works without JavaScript. A login in front of the host keeps others out. The repo that holds `agenda.json` must be private. See [hosting.md](hosting.md) for Vercel, Cloudflare Pages and Netlify.

Trade-offs: simplest and most reliable on the phone. Safe only if the login covers every address of the site, which is why check-private exists.

### passphrase

For hosts with no login, including GitHub Pages. Build with `PASSPHRASE='...' node build.mjs` and set `"privacy": "passphrase"`. The public folder holds an encrypted `agenda.enc` and a page shell. You enter the passphrase once on the phone, and the agenda decrypts on the device. The locked page shows only event facts (dates, getting around, basics) and no map. The print and PDF version is written to `build-private/print.html` (or the folder given by `--private-out`), which is gitignored and never deployed; `npm run pdf` uses it and writes `agenda.pdf`.

Trade-offs:
- The passphrase comes from an environment variable. Never put it in a file in the repo.
- No agenda is shown without JavaScript.
- The key salt stays the same across builds, so a phone that unlocked once keeps opening the agenda after an update without asking again. The salt comes from the `PASSPHRASE_SALT` environment variable (base64 of 16 bytes) or, when that is not set, from `.passphrase-salt` in the repo root, which the first passphrase build creates and which is gitignored. The salt is not secret; keeping it out of a public repo is still fine. The encryption IV is new on every build.
- Hosts that build from a clean checkout (Cloudflare Pages, Netlify) have no `.passphrase-salt`, so set `PASSPHRASE_SALT` there to the contents of your local `.passphrase-salt`. Without it every deploy gets a new salt and phones ask for the passphrase again.
- To make every device enter the passphrase again (for example after a phone was lost), delete `.passphrase-salt` (or change `PASSPHRASE_SALT`) and rebuild. Changing only the passphrase also makes every device ask again, because the stored key no longer decrypts the new file. Lock on a device removes its stored key.
- With `--out DIR` the encrypted site goes to DIR; the plaintext print variant still goes only to the private folder.
- Anyone can download the ciphertext and try passphrases offline. Use at least 5 random words or 20 characters. The build warns when the passphrase is shorter than 20 characters.
- The event name and the size of the file are visible.
- The plaintext must never reach the host. Either build locally and publish only `public/` (`npm run publish:gh-pages`), or build on a host that reads `PASSPHRASE` from a secret environment variable.

### Map and Around Vegas

In every mode, the Map section loads map images from OpenFreeMap (the `map.style` in the event pack). The request carries the area of the map being viewed and your IP address, never the agenda, and the page sends no referrer. Your hotel and route are drawn on the phone, not requested from the server. Your location is used only on the device and only after you tap the location button. Set `"externalMap": false` in `agenda.json` for a page with no outside requests; the map falls back to a schematic. Around Vegas and food lists are shared event pack data and hold nothing personal.

### public

The build allows it. Anyone with the link sees your hotel and your hour-by-hour location. Choose this only if you want that.

## Files that must never be published

`agenda.json` (in a public repo), PDFs, `build-private/`, `.vercel/`, `.env*`, and personal plan documents. The `.gitignore` covers generated files and the template's CI check blocks them from the template repo.
