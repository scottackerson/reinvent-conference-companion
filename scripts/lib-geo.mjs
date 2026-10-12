// Shared helpers for the map data scripts (make-routes.mjs, make-transit.mjs). Node only.
export const UA = 'reinvent-conference-companion (github.com/scottackerson/reinvent-conference-companion)';
export const r5 = n => Math.round(n * 1e5) / 1e5;
export const sleep = ms => new Promise(r => setTimeout(r, ms));
// Douglas-Peucker on [lon, lat] points. tol is in degrees (1e-5 is about 1 m in Las Vegas).
export function simplify(pts, tol = 3e-5) {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    if (d > max) { max = d; idx = i; }
  }
  if (max <= tol) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}
