# re:Invent Conference Companion

Created by Scott Ackerson.

An offline-capable iPhone web app for your AWS re:Invent agenda. You put in your own sessions and it builds a small site you add to your Home Screen. The top of the page is a "Today Console" showing what is happening now and what is next. Below it are tabs for each day, with a timeline of sessions as tappable cards, a "leave the hotel by" time, a route diagram between venues, backups for sessions that fill up, a map of the Strip showing only the venues you use, and a travel-time table. After one visit it works with no signal.

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

## Updating for a new year

Facts about the event (venues, hotels, travel estimates, dates) live in event packs under `events/`. For a new year, copy `events/reinvent-2026/` to a new folder, update the dates, venues and basics, and set `"event"` in `agenda.json` to the new id. The engine does not change.

## Setting up your iPhone

1. Open the site in Safari and log in or enter your passphrase if asked.
2. Tap Share, then Add to Home Screen. Open it from the icon.
3. Open it once more in airplane mode to confirm the saved copy works.
4. Open it the day before you fly and again on arrival so the saved copy is fresh. iOS can clear saved site data that has not been used for a few weeks.
5. Keep the PDF (`npm run pdf`, written to `agenda.pdf`) on your phone as a backup.

To update, edit `agenda.json`, rebuild and redeploy. The phone updates on its next online visit. In passphrase mode the phone stays unlocked after an update, because the build keeps the key salt in `.passphrase-salt` (gitignored, not secret). Hosts that build from a clean checkout need `PASSPHRASE_SALT` set to that file's contents. To make every phone ask again, delete `.passphrase-salt` or change the passphrase, then rebuild. When there is no signal, a saved copy shows a banner with a Reload link (host login shows Log in).

## Testing the clock

Add `?now=2026-11-30T11:20` (event wall-clock time) to the address to see how the console looks at that moment.

## Commands

`npm run check`, `build`, `serve`, `test`, `pdf`, `check-private -- <url>`, `publish:gh-pages`.

## License

MIT. See [LICENSE](LICENSE).
