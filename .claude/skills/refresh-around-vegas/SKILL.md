---
name: refresh-around-vegas
description: Refresh the shared "Around Vegas" list (events/<event>/happenings.json) and the food list (food.json) with confirmed shows, games, re:Invent activities, seasonal displays and food near the venues. Use when the user asks to update what is on in Las Vegas during the conference, add an event, check times, or refresh food options.
---

# Refresh Around Vegas

These files are shared, public event pack data used by everyone's site. They never hold anything personal: parties someone is invited to go in their own agenda, not here.

- `events/<event>/happenings.json`: things on during the stay window (the night before the conference through the last day).
- `events/<event>/food.json`: quick food at or next to each conference venue.

## Rules

1. **Primary sources only.** Cite the venue's own site, the official ticketing page that the venue links to, the team or league schedule, the organizer, or aws.amazon.com for re:Invent. Aggregators, blogs and resale sites can point you to a lead but are never the `source`. If you cannot confirm an item on a primary source, leave it out and say so.
2. **Never guess times.** Leave out `start`, `end` and `times` when the source does not publish them. Use `times` when showtimes differ by date or there are several a night.
3. `status` is `confirmed` only when the source shows the date (and the time, if one is given). Otherwise `unconfirmed`, with what is missing in `note`.
4. Keep `id` stable for items already in the file, so links keep working. New ids are short kebab-case.
5. `geo` is `[longitude, latitude]` with 5 decimals, from OpenStreetMap (Nominatim) or the venue's own map. Never send an email address or personal data to a lookup service. When the place is a conference venue, set `venueId` too so walking times come from the travel table.
6. Remove items whose dates have all passed or were cancelled. Update `checked` to today.
7. Copy rules: no emojis, no em dashes, plain short sentences. `note` is one sentence: what it is and what an attendee needs to know (tickets, free, typical length).
8. Food: no hours (they change). Give `where` inside the property when the official dining page says so. `kind` is `coffee`, `quick`, `food hall` or `sit-down`.

## Shape

```json
{
  "checked": "2026-10-12",
  "window": { "start": "2026-11-29", "end": "2026-12-04" },
  "items": [
    {
      "id": "nfr-2026",
      "title": "Wrangler National Finals Rodeo",
      "category": "sports",
      "dates": ["2026-12-03", "2026-12-04"],
      "start": "17:45",
      "place": "Thomas & Mack Center",
      "address": "4505 S Maryland Pkwy, Las Vegas, NV 89154",
      "geo": [-115.1601, 36.10437],
      "note": "Ten nights of rodeo. Tickets required.",
      "price": "Tickets required",
      "status": "confirmed",
      "source": "https://www.prorodeo.com/..."
    }
  ]
}
```

`category` is one of `reinvent`, `sports`, `show`, `seasonal`, `heads-up`. `heads-up` items (crowds, closures, big events that slow traffic) show as a note at the top of that day, not as ideas. Items with no time that run on three or more days show once under "All week".

## Steps

1. Read the current files and `events/<event>/event.json` (dates, venues).
2. Research by category: re:Invent (aws.amazon.com), sports (T-Mobile Arena, Allegiant Stadium, Thomas & Mack, team sites), shows (Sphere, Dolby Live, The Colosseum, other Strip theaters), seasonal displays, heads-up.
3. Edit the files. Run `node build.mjs --check` (it checks the pack: ids, dates, times, categories, https sources, coordinates) and `npm test`.
4. Build and look at the Around Vegas section and a day's free-time rows: `node build.mjs && npm run serve`, then http://localhost:8000/?now=2026-12-01T17:00#vegas.
5. Report: what was added, changed and removed, and what you left out because it could not be confirmed.

## Map data (once a year, or when a venue changes)

- Walking paths: `node scripts/make-routes.mjs events/<event>` after setting `geo` on every venue and hotel in `event.json`. Paths stay on the Strip: each place gets a `stripAccess` point on Las Vegas Boulevard (computed once, `--refresh-access` recomputes), and an off-Strip venue names the neighbor it is reached through with `stripAccessFrom` (Caesars Forum: `linq`, Sphere: `ven`). It prints walking minutes next to the travel table so you can spot a wrong estimate; it does not change the table.
- Conference shuttles: AWS publishes routes, stops and pickup times in the fall. When they are out, add them to the event pack (stops with coordinates, routes, hours and frequency, with the AWS source) and show them on the map and in leave-by advice. Not built yet.
- Monorail and trams: `node scripts/make-transit.mjs events/<event>`.
