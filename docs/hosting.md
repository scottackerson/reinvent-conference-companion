# Hosting

Pick the privacy mode first (see [privacy.md](privacy.md)). Host login modes need a host that can put a login in front of the site. Passphrase mode works on any static host.

After the first deploy on any host, run:

```
npm run check-private -- https://your-site.example
```

It requests the site with no login. It fails if your agenda is readable by anyone. Do not share the link until it passes.

Build output is the `public/` folder (or the folder given with `node build.mjs --out DIR`). Everything is linked relative to the page, so the site works at a domain root and under a subpath, for example `https://<owner>.github.io/<repo>/`, with no build flag. The build command is `node build.mjs` and there is no install step.

## Vercel (host login)

Needs: a private repo that holds `agenda.json`. Deployment Protection on the Hobby plan covers Vercel Authentication; check your plan for the "All deployments" option and for password protection.

1. Import the private repo in Vercel. Build command `node build.mjs`, output directory `public`, no install command.
2. Before the first deploy, open Project, Settings, Deployment Protection. Set Vercel Authentication to **All deployments**.
3. Deploy. Do not attach a custom domain unless you have confirmed protection covers it.
4. Run `npm run check-private -- https://<project>.vercel.app`.

Watch out: the default setting, "Standard", protects preview deployments but can leave the production `.vercel.app` address public. Set All deployments before the first deploy. Always verify with check-private. By hand, `curl -s -o /dev/null -w "%{http_code}" https://<project>.vercel.app/agenda.json` must print `302` or `401`, never `200`.

## Cloudflare Pages with Access (host login)

Needs: a Cloudflare account. Access (Zero Trust) has a free tier for a small number of users; check your plan.

1. Create a Pages project from the private repo. Build command `node build.mjs`, output directory `public`.
2. In Zero Trust, add an Access application that covers both the `<project>.pages.dev` address and the preview addresses (`*.<project>.pages.dev`).
3. Add a policy that allows your email address, with the one-time code login method.
4. Run `npm run check-private -- https://<project>.pages.dev` and also against one preview address.

Alternative: use passphrase mode and set `PASSPHRASE` as a build environment variable in the Pages project. Also set `PASSPHRASE_SALT` to the contents of your local `.passphrase-salt` (run a passphrase build locally once to create it). The salt is not secret. Without it every deploy gets a new salt and phones ask for the passphrase again.

## Netlify (host login)

Needs: password protection and SSO are plan-dependent. Check your plan before relying on them.

1. Create a site from the private repo. Build command `node build.mjs`, publish directory `public`.
2. In Site configuration, Access and security, turn on password protection or SSO if your plan allows it.
3. Run `npm run check-private -- https://<site>.netlify.app`.

If your plan has no protection, use passphrase mode and set `PASSPHRASE` as an environment variable for the build. Also set `PASSPHRASE_SALT` to the contents of your local `.passphrase-salt`, so phones stay unlocked across deploys.

## GitHub Pages (passphrase mode)

GitHub Pages has no login, and on a free account the site is public even if the repo is private. Use passphrase mode.

1. Set `"privacy": "passphrase"` in `agenda.json`.
2. Keep `agenda.json` out of git for this copy (see [privacy.md](privacy.md)): add it to `.gitignore`.
3. Run `PASSPHRASE='a long passphrase of five random words' npm run publish:gh-pages`. The script builds locally and force-pushes only `public/` (encrypted) to the `gh-pages` branch.
4. In GitHub, Settings, Pages, deploy from branch `gh-pages`, folder `/ (root)`.
5. Run `npm run check-private -- https://<owner>.github.io/<repo>/`. It requests paths relative to the URL you give and should report that passphrase mode is detected. The project subpath works as is.
6. After an update, phones stay unlocked: the build keeps the salt in `.passphrase-salt` (gitignored), so the stored key still fits. Keep that file. Deleting it, or changing the passphrase, makes every phone ask again.

## Any static host (S3, a web server, others)

Use passphrase mode. Build locally with `PASSPHRASE='...' node build.mjs` and upload the contents of `public/`. Keep `.passphrase-salt` so phones stay unlocked after updates. Never upload `agenda.json`, `build-private/` or a PDF. Then run check-private against the live address.

## After deploying

- Open the site in Safari on your phone and add it to the Home Screen (see the README).
- Keep the PDF (`npm run pdf`, written to `agenda.pdf`) on the phone as a backup. It is never deployed.
