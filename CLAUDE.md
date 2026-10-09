# re:Invent conference companion

An offline iPhone web app that shows one person's AWS re:Invent agenda: a "Today Console" with the next session, a timeline per day, leave-the-hotel times, route diagrams, a Strip map and travel table. It is a static site built by a dependency-free Node script. Anyone can use it for their own schedule by creating an `agenda.json`.

To build someone's agenda, use the `/build-my-agenda` skill (`.claude/skills/build-my-agenda/SKILL.md`).

## File map

- `events/reinvent-2026/event.json`: event pack (shared facts): dates, time zone, venues with map positions, hotels with estimated minutes to each venue, venue-to-venue travel times, getting-around text, basics, defaults. Next year, copy the folder to `events/reinvent-2027/` and update it.
- `agenda.json`: one person's schedule. Private. Not present in the template; `agenda.example.json` is used (with an "Example agenda" banner) when it is missing.
- `agenda.example.json`: fictional "Alex Example" agenda, the best reference for the shape.
- `agenda.schema.json`: JSON Schema for `agenda.json`.
- `validate.mjs`: schema and meaning checks (overlaps, tight venue changes, unknown ids, code without title, dates, privacy).
- `render.mjs`: pure ES module that derives the full model and renders HTML. Shared by Node and the browser.
- `build.mjs`: the build. Writes `public/`. `--check` validates only, `--agenda FILE` uses another file, `--out DIR` writes the site to another folder, `--private-out DIR` (passphrase mode) moves the print variant, `--salt-file FILE` (passphrase mode) reads or creates the salt somewhere other than `.passphrase-salt`.
- `templates/`: page shell, service worker, manifest. `public/app.js`, `public/styles.css`, `public/icons/`: hand-written static files.
- `scripts/`: `make-pdf.sh`, `check-private.mjs`, `publish-gh-pages.sh`, `make-icons.sh`.
- `docs/hosting.md`, `docs/privacy.md`: host setup and privacy modes.
- `test/`: `node --test`.

## Data split

- Event pack (public, shared): venues, hotels, travel estimates, basics. Edit only to correct facts or add a new year.
- Personal agenda (private): attendee, hotel choice and dates, priorities, days with items, decisions, trade-offs, rules, `privacy`, meta. Day titles, tabs, venue sequences, travel rows, leave-by times and maps are derived at build time, so only write sessions.

## Commands

- `npm run check` (`node build.mjs --check`): validate. Errors stop the build; warnings are advice.
- `npm run build`: build to `public/`.
- `npm run serve`: serve `public/` at http://localhost:8000.
- `npm test`: run tests.
- `npm run pdf`: print `agenda.pdf` with headless Chrome. Uses `build-private/print.html` in passphrase mode (or when it is newer than `public/print.html`), otherwise `public/print.html`.
- `npm run check-private -- <url>`: verify a deployed site is not public.
- `npm run publish:gh-pages`: passphrase mode only, publish `public/` to GitHub Pages.

The site is subpath safe: service worker, manifest and links are relative, so GitHub Pages project sites (`https://<owner>.github.io/<repo>/`) work with no flag. Passphrase mode: the locked page shows event facts only (no map), the saved-copy banner says Reload, and the PBKDF2 salt is stable across builds (`PASSPHRASE_SALT`, else `.passphrase-salt`, created on first use and gitignored; not secret) so a phone's stored key keeps working after an update. The IV is new every build. `agenda.enc` carries a `kid` (hash of salt, iterations and a fixed label, never of the passphrase) that `unlock.js` compares with the stored key. Deleting `.passphrase-salt` or changing the passphrase makes every device ask again. Tests must pass `--salt-file` so they never create `.passphrase-salt` in the repo.

Test live features with `?now=2026-11-30T11:20` (Pacific wall-clock time) on the URL.

## Privacy rules

- Never commit `agenda.json` to a public repo. In a public repo, gitignore it.
- Never deploy without running `npm run check-private -- <url>` afterward and reporting the result.
- Never commit PDFs, `build-private/`, `.vercel/` or `.env*`.
- Never put a passphrase in a file. It comes from the `PASSPHRASE` environment variable.
- `privacy` is required in `agenda.json`. Ask the person which mode they want. Confirm explicitly before setting `"public"`.

## Copy rules

- No emojis. No em dashes in engine copy; use commas, periods or colons.
- A session code is always shown with its title.
- Plain, direct sentences.
- Never invent rooms, times, seat counts or session details. If something is missing, ask or leave it out and say so.
- Always run `node build.mjs --check` after editing `agenda.json` and before handing work back.
