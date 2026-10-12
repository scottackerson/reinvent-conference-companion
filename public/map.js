/* Interactive map. Loaded by app.js when the Map section comes near the screen, after vendor/maplibre.
   Draws the venues on your plan, your hotel, each day's walking route, the monorail and trams, and things
   happening around the city. Map images come from the style in the event pack (OpenFreeMap by default); only
   the map area travels to that server, never the agenda. Your location is used only on this device, and only
   after you tap the location button. If anything fails, the schematic stays in place. */
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toMin(s) { var a = s.split(':'); return +a[0] * 60 + +a[1]; }
  function t12(s) { var m = toMin(s), h = Math.floor(m / 60) % 24; return (h % 12 || 12) + ':' + ('0' + (m % 60)).slice(-2) + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function dirUrl(q) { return 'https://maps.apple.com/?daddr=' + encodeURIComponent(q) + '&dirflg=w'; }
  function label(it) { return (it.code ? it.code + ' ' : '') + it.title; }

  function mount(box, data, opts) {
    var ml = window.maplibregl; if (!ml || !data.map) throw new Error('map unavailable');
    var V = {}; data.venues.forEach(function (v) { V[v.id] = v; });
    var H = data.hotel;
    var geoOf = function (id) { return id === '@hotel' ? H.geo : (V[id] && V[id].geo); };
    var state = { day: opts.day || 'all', around: true, transit: true };

    // ---- UI around the map ----
    var svg = box.firstElementChild;
    var ui = document.createElement('div'); ui.className = 'mapui';
    var chips = '<button type="button" class="chip" data-day="all">All days</button>' +
      data.days.map(function (d) { return '<button type="button" class="chip" data-day="' + d.id + '">' + esc(d.tab) + '</button>'; }).join('');
    ui.innerHTML = '<div class="chips" role="group" aria-label="Day to show">' + chips + '</div>' +
      '<div class="mapgl" role="region" aria-label="Map of your venues and hotel"></div>' +
      '<div class="chips toggles" role="group" aria-label="Layers">' +
      '<button type="button" class="chip" data-toggle="around">Around Vegas</button>' +
      '<button type="button" class="chip" data-toggle="transit">Monorail and trams</button></div>' +
      '<p class="maplist" aria-live="polite"></p>';
    box.classList.add('live'); box.appendChild(ui);
    if (svg) svg.hidden = true;
    var el = ui.querySelector('.mapgl'), summary = ui.querySelector('.maplist');

    var map;
    var failed = false;
    function fail() {
      if (failed) return; failed = true;
      try { if (map) map.remove(); } catch (e) { /* already gone */ }
      ui.remove(); box.classList.remove('live'); if (svg) svg.hidden = false;
      box.insertAdjacentHTML('afterend', '<p class="caption">The interactive map could not load. Showing the schematic.</p>');
    }
    try {
      map = new ml.Map({
        container: el, style: data.map.style, center: data.map.center, zoom: data.map.zoom,
        attributionControl: { compact: true }, cooperativeGestures: true,
        dragRotate: false, pitchWithRotate: false, touchPitch: false, maxZoom: 18, minZoom: 11,
      });
    } catch (e) { fail(); return; }
    map.touchZoomRotate.disableRotation();
    map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new ml.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: true }), 'top-right');
    var timer = setTimeout(function () { if (!map.loaded()) fail(); }, 15000);

    var markers = [];
    function clearMarkers() { markers.forEach(function (m) { m.remove(); }); markers = []; }
    function addMarker(lngLat, html, cls, popupHtml, z) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'mk ' + cls; b.innerHTML = html;
      if (z) b.style.zIndex = z;
      var m = new ml.Marker({ element: b, anchor: 'center' }).setLngLat(lngLat);
      if (popupHtml) m.setPopup(new ml.Popup({ offset: 16, maxWidth: '280px', closeButton: true }).setHTML(popupHtml));
      m.addTo(map); markers.push(m); return m;
    }

    function itemsAt(venueId, dayId) {
      var out = [];
      data.days.forEach(function (d) {
        if (dayId !== 'all' && d.id !== dayId) return;
        d.items.forEach(function (it) { if (it.kind !== 'travel' && it.venueId === venueId) out.push(d.tab + ', ' + t12(it.start) + ': ' + label(it)); });
      });
      return out;
    }
    function venuePopup(v, dayId) {
      var list = itemsAt(v.id, dayId);
      return '<div class="pp"><b>' + esc(v.name) + '</b>' + (v.notes ? '<div class="pp-s">' + esc(v.notes) + '</div>' : '') +
        (list.length ? '<ul>' + list.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<div class="pp-s">' + (v.days.length ? 'Nothing here this day.' : 'Backup sessions only.') + '</div>') +
        '<a href="' + dirUrl(v.appleMapsQuery) + '">Directions from where you are</a></div>';
    }
    function hotelPopup() {
      return '<div class="pp"><b>' + esc(H.name) + '</b><div class="pp-s">' + esc(H.note || 'Hotel.') + '</div>' +
        (H.appleMapsQuery ? '<a href="' + dirUrl(H.appleMapsQuery) + '">Directions from where you are</a>' : '') + '</div>';
    }
    function aroundPopup(h, dayDate) {
      var times = dayDate ? ((h.times && h.times[dayDate]) || (h.start ? [h.start] : [])) : [];
      var when = dayDate ? (times.length ? times.map(t12).join(', ') : 'Time not published') : h.dates.length + ' day' + (h.dates.length === 1 ? '' : 's') + ' during your stay';
      return '<div class="pp"><b>' + esc(h.title) + '</b><div class="pp-s">' + esc(h.place) + '. ' + esc(when) + '.' + (h.price ? ' ' + esc(h.price) + '.' : '') + (h.status === 'confirmed' ? '' : ' Unconfirmed.') + '</div>' +
        (h.note ? '<div class="pp-s">' + esc(h.note) + '</div>' : '') +
        (h.source ? '<a href="' + esc(h.source) + '" rel="noopener noreferrer">Source</a>' : '') + '</div>';
    }

    function legFeatures(day) {
      return day.legs.map(function (l) {
        var a = geoOf(l.from), b = geoOf(l.to);
        var line = l.line || (a && b ? [a, b] : null);
        return line ? { type: 'Feature', properties: { approx: !l.line }, geometry: { type: 'LineString', coordinates: line } } : null;
      }).filter(Boolean);
    }

    function draw() {
      clearMarkers();
      var day = data.days.filter(function (d) { return d.id === state.day; })[0] || null;
      var pts = [];
      // Route lines
      var fc = { type: 'FeatureCollection', features: day ? legFeatures(day) : [] };
      if (map.getSource('legs')) map.getSource('legs').setData(fc);
      // Hotel
      if (H.geo && !(H.venueId && V[H.venueId])) { addMarker(H.geo, '<span class="mk-dot">H</span><span class="mk-l">' + esc(H.name) + '</span>', 'mk-h', hotelPopup(), 3); pts.push(H.geo); }
      // Venues: in day view, numbered in visiting order; others dimmed
      var order = {};
      if (day) day.venueSequence.forEach(function (id, i) { (order[id] = order[id] || []).push(i + 1); });
      data.venues.forEach(function (v) {
        if (!v.geo) return;
        var on = day ? !!order[v.id] : v.days.length > 0;
        var isHotel = H.venueId === v.id;
        var dot = day && order[v.id] ? order[v.id].join(',') : isHotel ? 'H' : '';
        var sub = '';
        if (day && order[v.id]) {
          var its = day.items.filter(function (i) { return i.kind !== 'travel' && i.venueId === v.id; });
          sub = t12(its[0].start);
        } else if (!day) sub = v.days.map(function (d) { return d.charAt(0).toUpperCase() + d.slice(1); }).join(' ') || 'Backup only';
        addMarker(v.geo, '<span class="mk-dot">' + esc(dot) + '</span><span class="mk-l">' + esc(v.shortName || v.name) + (sub ? '<small>' + esc(sub) + '</small>' : '') + (isHotel ? '<small>Hotel</small>' : '') + '</span>',
          'mk-v' + (on ? '' : ' mk-dim') + (isHotel ? ' mk-hv' : ''), venuePopup(v, state.day), on ? 2 : 1);
        if (on) pts.push(v.geo);
      });
      // Around Vegas
      if (state.around) {
        (data.around.items || []).forEach(function (h) {
          if (!h.geo || (day && h.dates.indexOf(day.date) < 0) || h.category === 'heads-up') return;
          addMarker(h.geo, '<span class="mk-dot"></span>', 'mk-e', aroundPopup(h, day ? day.date : null), 0);
        });
      }
      // Summary for screen readers and as a text version
      if (day) {
        summary.textContent = day.title + ': leave the ' + H.name + ' by ' + t12(day.leaveHotelBy.time) + ', then ' +
          day.venueSequence.map(function (id, i) { return (i + 1) + ' ' + V[id].name; }).join(', ') + '. Walking paths are approximate.';
      } else summary.textContent = 'All venues on your plan and your hotel. Pick a day to see its route.';
      // Fit
      if (pts.length) {
        var bb = new ml.LngLatBounds(pts[0], pts[0]); pts.forEach(function (p) { bb.extend(p); });
        if (day) legFeatures(day).forEach(function (f) { f.geometry.coordinates.forEach(function (c) { bb.extend(c); }); });
        map.fitBounds(bb, { padding: { top: 56, bottom: 48, left: 48, right: 96 }, maxZoom: 16, duration: 0 });
      }
      ui.querySelectorAll('[data-day]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.day === state.day ? 'true' : 'false'); });
      ui.querySelectorAll('[data-toggle]').forEach(function (b) { b.setAttribute('aria-pressed', state[b.dataset.toggle] ? 'true' : 'false'); });
      ['transit-line', 'transit-tram', 'transit-stations', 'transit-labels'].forEach(function (id) { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', state.transit ? 'visible' : 'none'); });
    }

    map.on('load', function () {
      clearTimeout(timer);
      if (failed) return;
      if (svg) svg.remove();
      var violet = css('--violet') || '#8B5CF6', teal = css('--res') || '#2DD4BF', bg = css('--bg') || '#0F0B1E';
      var tr = data.transit || { lines: [], stations: [] };
      map.addSource('transit', { type: 'geojson', data: { type: 'FeatureCollection', features: tr.lines.map(function (l) { return { type: 'Feature', properties: { kind: l.kind, name: l.name }, geometry: { type: 'MultiLineString', coordinates: l.lines } }; }) } });
      map.addSource('stations', { type: 'geojson', data: { type: 'FeatureCollection', features: tr.stations.map(function (s) { return { type: 'Feature', properties: { name: s.name, kind: s.kind }, geometry: { type: 'Point', coordinates: s.geo } }; }) } });
      map.addLayer({ id: 'transit-line', type: 'line', source: 'transit', filter: ['==', ['get', 'kind'], 'monorail'], paint: { 'line-color': teal, 'line-width': 3, 'line-opacity': .85 } });
      map.addLayer({ id: 'transit-tram', type: 'line', source: 'transit', filter: ['==', ['get', 'kind'], 'tram'], paint: { 'line-color': teal, 'line-width': 2.5, 'line-dasharray': [2, 1.5], 'line-opacity': .85 } });
      map.addLayer({ id: 'transit-stations', type: 'circle', source: 'stations', paint: { 'circle-radius': 4, 'circle-color': bg, 'circle-stroke-color': teal, 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'transit-labels', type: 'symbol', source: 'stations', minzoom: 14, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': teal, 'text-halo-color': bg, 'text-halo-width': 1.5 } });
      map.addSource('legs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'legs-casing', type: 'line', source: 'legs', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': bg, 'line-width': 8 } });
      map.addLayer({ id: 'legs', type: 'line', source: 'legs', filter: ['!', ['get', 'approx']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': violet, 'line-width': 4.5 } });
      map.addLayer({ id: 'legs-approx', type: 'line', source: 'legs', filter: ['get', 'approx'], layout: { 'line-cap': 'round' }, paint: { 'line-color': violet, 'line-width': 3, 'line-dasharray': [1.5, 1.5] } });
      draw();
    });
    map.on('error', function (e) { if (!map.loaded() && e && e.error && /style/i.test(String(e.error.message || ''))) fail(); });

    ui.addEventListener('click', function (e) {
      var b = e.target.closest('button.chip'); if (!b) return;
      if (b.dataset.day) state.day = b.dataset.day;
      if (b.dataset.toggle) state[b.dataset.toggle] = !state[b.dataset.toggle];
      if (map.loaded()) draw();
    });
    // Following the agenda's day switcher keeps the map on the same day.
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('.seg a[data-day]');
      if (a && map.loaded()) { state.day = a.dataset.day; draw(); }
    });
  }

  window.AgendaMap = { mount: mount };
})();
