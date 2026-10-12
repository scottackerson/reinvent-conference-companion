---
name: build-my-agenda
description: Build or update a person's re:Invent agenda site from their schedule. Use when the user wants to create their agenda.json from a pasted schedule, screenshot, calendar export or session codes, change an existing agenda (swap a session, add a backup), choose a privacy mode, deploy the site, or make the PDF.
---

# Build my agenda

Goal: turn the person's schedule into `agenda.json`, validate it, preview it, deploy it privately, and verify it. Do not hand back an agenda until `node build.mjs --check` passes.

## 1. Gather what they have

Ask for any of these: a paste or screenshot of "My agenda" from the AWS Events app, a calendar export, a list of session codes, or plain text. Also ask for:
- Name (shown in the header only).
- Hotel, check-in and check-out dates.
- Priorities: their own tier labels in order, for example `["Serverless", "Data", "Leadership"]`. Each session may carry one as `tier`.

## 2. Fill in details without inventing

Use what they gave for titles, rooms, times and venues. If a room, time or venue is missing, ask. Never invent one silently.
- **Unknown room:** leave `room` out and tell them; the card shows only the venue.
- **Unknown end time:** `end` is required. Ask first. If they do not know, use the typical length for the session type (table below), set `"status": "estimated"`, `"estimated": true`, `"endApprox": true`, and a `detail` line such as "End time not provided; assumed one hour.", then tell them which items you estimated.
- **Unknown type:** ask, or look it up in the catalog. If neither works, use "Breakout" and say so.

| Type (free text, use these spellings) | Typical length |
|---|---|
| Keynote | 2.5 hours (mark estimated until AWS publishes times) |
| Breakout | 60 min |
| Chalk talk | 60 min |
| Builders' session | 60 min |
| Code talk | 60 min |
| Workshop | 2 hours |
| Lightning talk | 20 min |
 If the session catalog is reachable, look sessions up and tell them which values came from there. Venue ids come from `events/reinvent-2026/event.json` `venues[]` (`wynn`, `ven`, `sphere`, `cp`, `mgm`, `forum`). Look at `agenda.example.json` for a working reference.

Hotel: list the ids in `events/reinvent-2026/event.json` `hotels[]` (aria, bellagio, cosmopolitan, caesars, venetian, wynn, mgm-grand, mandalay-bay, park-mgm, luxor, harrahs, linq) and let them pick: `"hotel": { "id": "bellagio", "checkIn": "2026-11-29", "checkOut": "2026-12-04" }`. For a hotel not in the list, use a custom hotel: `"hotel": { "name": "...", "address": "...", "appleMapsQuery": "...", "minutesTo": { "wynn": 25, "ven": 25, "sphere": 30, "cp": 15, "mgm": 15, "forum": 20 }, "checkIn": "...", "checkOut": "..." }` and say the minutes are their estimate.

## 3. Write agenda.json and check

Copy `agenda.example.json` to `agenda.json` if it does not exist, then replace all of its content, including the example's `decisions`, `tradeoffs`, `rules`, every `backups` list and any `arriveNote`. Nothing of Alex Example may remain. Shape:

```json
{
  "$schema": "./agenda.schema.json",
  "event": "reinvent-2026",
  "attendee": { "name": "Alex Example" },
  "hotel": { "id": "bellagio", "checkIn": "2026-11-29", "checkOut": "2026-12-04" },
  "priorities": ["Serverless", "Data", "Leadership"],
  "days": [
    {
      "date": "2026-12-01",
      "items": [
        {
          "kind": "session", "code": "COP303", "title": "Improving operations with agentic AI",
          "type": "Chalk talk", "start": "13:30", "end": "14:30", "venueId": "wynn",
          "room": "Cristal 2 Purple Theater", "status": "walkup", "seats": 60,
          "tier": "Serverless", "backups": []
        }
      ]
    }
  ],
  "privacy": "host-login",
  "meta": { "lastUpdated": "2026-10-09", "reservationsAsOf": "2026-10-09" }
}
```

Rules: times are 24-hour ("13:00") in the event time zone. `kind` is `session`, `event` or `keynote`. `status` is `reserved`, `walkup`, `estimated` or `event`. A code always has a title. Backups need `time`, `title` and a code or venue. Optional: `decisions`, `tradeoffs`, `rules`, `room`, `seats`, `tier`, `backups`. A walk-up session without `seats` gives a warning; that is fine when the seat count is unknown. For estimated items use `estimated`, `endApprox` and `detail` (see the Expo item in `agenda.example.json`). See `agenda.schema.json` for every field.

Run `node build.mjs --check`. Fix errors and re-run until it passes. Warnings are advice.

## 4. Report problems in plain words

Summarize overlaps, tight venue changes (less time than the travel estimate), and long gaps. Offer to suggest backups only if they ask.

## 5. Choose privacy

Ask: "Who should be able to see this? Your hotel and hourly location will be on it." Explain the options from `docs/privacy.md`:
- `host-login`: a login in front of the host. Needs a private repo and a host with login (Vercel, Cloudflare Pages, Netlify).
- `passphrase`: encrypted, works on any static host including GitHub Pages. Needs a long passphrase (at least 20 characters or 5 random words), supplied as the `PASSPHRASE` environment variable, never written to a file.
- `public`: open to anyone with the link. Ask for explicit confirmation first.

Also tell them the Map section loads map images from OpenFreeMap (only the map area is sent, never the agenda); if they want no outside requests at all, set `"externalMap": false`. Set `privacy` in `agenda.json`. Then check the repo's visibility with `gh repo view --json visibility` (or ask). If it is public, or has no remote yet and they plan to make it public, uncomment the `agenda.json` line in `.gitignore` before anything is committed, and confirm with `git check-ignore agenda.json`. `host-login` requires a private repo.

## 6. Build and preview

```
node build.mjs
npm run serve
```

Give them http://localhost:8000. To preview a live clock, add `?now=2026-12-01T13:00` to the address. In passphrase mode, run `PASSPHRASE='...' node build.mjs` instead; it also creates `build-private/` (the print variant) and `.passphrase-salt` in the working folder, both gitignored. `--out DIR` builds into another folder and `--private-out DIR` moves the passphrase-mode print variant (default `build-private/print.html`). The locked page shows no map; tell them that phones stay unlocked after an update because the first passphrase build creates `.passphrase-salt` (gitignored, not secret) and later builds reuse it; that hosts which build from a clean checkout (Cloudflare Pages, Netlify) need `PASSPHRASE_SALT` set to that file's contents; and that deleting the file or changing the passphrase makes every phone ask again.

## 7. Deploy

Follow `docs/hosting.md` for their host. GitHub Pages project subpaths (`https://<owner>.github.io/<repo>/`) work with no flag. Then run `npm run check-private -- <live url>` and report the result. If it fails, stop and fix the protection before sharing the link. Never skip this step.

## 8. PDF

Run `npm run pdf`. It writes `agenda.pdf`, which is gitignored (in passphrase mode it prints `build-private/print.html`, so `PASSPHRASE` must be set). Tell them to save it to their phone or iCloud Drive as a backup for when there is no signal. Never deploy or commit it.

## 9. Later changes

For requests like "swap my Wednesday 11:30": edit `agenda.json`, update `meta.lastUpdated`, run `node build.mjs --check`, rebuild, redeploy, run check-private, and regenerate the PDF if they use it.
