const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 24;
const rateBuckets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now - bucket.start > RATE_LIMIT_WINDOW_MS) rateBuckets.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

export { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, rateBuckets };

export function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX;
}
