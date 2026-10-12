# re:Invent Conference Companion

Created by Scott Ackerson.

An iPhone web app for your AWS re:Invent agenda. You put in your own sessions and it builds a small site you add to your Home Screen. The top of the page is a "Today Console" showing what is happening now and what is next. Below it are tabs for each day, with a timeline of sessions as tappable cards, a "leave the hotel by" time, a route diagram between venues, backups for sessions that fill up, and your free time with ideas for it: shows, games and other things on nearby, and quick food at the venue you are in. An interactive map shows your venues, your hotel, each day's walking route, the monorail and the free trams. An Around Vegas tab lists what is on during your stay, and a travel-time table covers the rest. The site needs a connection; keep the PDF as a backup.

## Quick start (with Claude Code)

1. Click "Use this template" on GitHub and create your copy. Choose private if you will use host login.
2. Clone it and open the folder in Claude Code.
3. Run `/build-my-agenda`. Paste or screenshot your agenda from the AWS Events app. Claude builds `agenda.json`, validates it, helps you pick a privacy mode and deploy, and verifies the result.

## Manual route

Needs Node 20 or newer. No dependencies.

```
cp agenda.example.json agenda.json
# edit agenda.json (see agenda.schema.json), set "privacy"
npm run check
npm run build
npm run serve
```

Open http://localhost:8000. To build somewhere else, use `node build.mjs --out DIR`. With no `agenda.json`, the build uses the example agenda and shows an "Example agenda" banner.

## Privacy

Your agenda shows your hotel and where you will be hour by hour. Set `privacy` in `agenda.json`; the build refuses to run without it.

- `host-login`: a login in front of the host. Keep the repo private.
- `passphrase`: the agenda is encrypted and works on any static host, including GitHub Pages. Build with `PASSPHRASE='...' node build.mjs`.
- `public`: open to anyone with the link.

In passphrase mode the locked page shows only the event facts (no map and no schedule), and the print version for the PDF goes to `build-private/print.html`, which is never deployed. Details and trade-offs: [docs/privacy.md](docs/privacy.md). Never commit `agenda.json` to a public repo. If your copy is public, add `agenda.json` to `.gitignore` and publish with passphrase mode (`npm run publish:gh-pages`). After every first deploy, run `npm run check-private -- <url>`.

## Hosting

Steps for Vercel, Cloudflare Pages, Netlify, GitHub Pages and other static hosts: [docs/hosting.md](docs/hosting.md). All links are relative, so the site also works from a subpath such as `https://<owner>.github.io/<repo>/` with no build flag.

## Around Vegas and food

The shared list of things happening during the conference (`events/reinvent-2026/happenings.json`) and food near each venue (`food.json`) are part of the template, so everyone gets them. Every item links to a primary source and says whether it is confirmed. To refresh them, run `/refresh-around-vegas` in Claude Code. Pull template updates into your copy to get the latest list.

## The map

The Map section loads map images from [OpenFreeMap](https://openfreemap.org) (OpenStreetMap data, no account or key). Only the map area you look at goes to that server, never your agenda. Your location is used on the phone only, after you tap the location button. Walking paths come from OpenStreetMap and are approximate. To keep the page free of outside requests, set `"externalMap": false` in `agenda.json`; the map then falls back to a schematic. The map library (MapLibre GL JS, BSD-3-Clause) is vendored in `public/vendor/maplibre/`, so no third-party script runs on the page.

## Updating for a new year

Facts about the event (venues, hotels, travel estimates, dates, map coordinates) live in event packs under `events/`. For a new year, copy `events/reinvent-2026/` to a new folder, update the dates, venues and basics, run `node scripts/make-routes.mjs` and `node scripts/make-transit.mjs` for the map, refresh Around Vegas, and set `"event"` in `agenda.json` to the new id. The engine does not change.

## Setting up your iPhone

1. Open the site in Safari and log in or enter your passphrase if asked.
2. Tap Share, then Add to Home Screen. Open it from the icon.
3. Keep the PDF (`npm run pdf`, written to `agenda.pdf`) on your phone as a backup for when there is no signal.

To update, edit `agenda.json`, rebuild and redeploy. The phone shows the update the next time it opens the site. In passphrase mode the phone stays unlocked after an update, because the build keeps the key salt in `.passphrase-salt` (gitignored, not secret). Hosts that build from a clean checkout need `PASSPHRASE_SALT` set to that file's contents. To make every phone ask again, delete `.passphrase-salt` or change the passphrase, then rebuild.

## Testing the clock

Add `?now=2026-11-30T11:20` (event wall-clock time) to the address to see how the console looks at that moment.

## Commands

`npm run check`, `build`, `serve`, `test`, `pdf`, `check-private -- <url>`, `publish:gh-pages`.

## License

MIT. See [LICENSE](LICENSE).
