// A POINT ON A SCREEN SEEN AT AN ANGLE: the inverse of the projective map a flat quad's four corners make on the picture.
// Pure; the Room Stage (room-stage.js tvPoint) and the street view on foot (freelook-view.js owTvPoint) both ask it.
// Where a point of the picture (x, y, px) falls on a set's screen, { u, v } 0 to 1 from its top left, or null off it.
// `q` is the screen's four corners on the picture (top left, top right, bottom right, bottom left), as projected.
// The Room Stage's and the street view's (one-world) pointer on the picture both ask this.
export function quadUV(q, x, y) {
  if (!q || q.some((p) => !p)) return null;
  const [a, b, c, d] = q;
  const dx1 = b.x - c.x, dx2 = d.x - c.x, sx = a.x - b.x + c.x - d.x, dy1 = b.y - c.y, dy2 = d.y - c.y, sy = a.y - b.y + c.y - d.y;
  const den = dx1 * dy2 - dx2 * dy1;
  if (!den) return null;
  const g = (sx * dy2 - dx2 * sy) / den, k = (dx1 * sy - sx * dy1) / den;
  const A = b.x - a.x + g * b.x, B = d.x - a.x + k * d.x, D = b.y - a.y + g * b.y, E = d.y - a.y + k * d.y;
  // screen = (A u + B v + a) / (g u + k v + 1), the same in y: two lines in u and v
  const m00 = A - g * x, m01 = B - k * x, r0 = x - a.x, m10 = D - g * y, m11 = E - k * y, r1 = y - a.y, det = m00 * m11 - m01 * m10;
  if (!det) return null;
  const u = (r0 * m11 - m01 * r1) / det, v = (m00 * r1 - r0 * m10) / det;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? { u, v } : null;
}
