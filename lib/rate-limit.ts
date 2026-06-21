import { NextRequest } from "next/server";

type RateLimitConfig = {
  name: string;
  limit: number;
  windowMs: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

declare global {
  // Serverless instances do not share this map, so production should still use
  // platform/WAF limits for global protection. This protects each warm runtime.
  var sustainableEcgRateLimitStore: Map<string, RateLimitBucket> | undefined;
}

export const rateLimits = {
  auth: { name: "auth", limit: 12, windowMs: 60_000 },
  uploads: { name: "uploads", limit: 30, windowMs: 60_000 },
  scans: { name: "scans", limit: 45, windowMs: 60_000 },
  pickups: { name: "pickups", limit: 30, windowMs: 60_000 },
  recycling: { name: "recycling", limit: 20, windowMs: 60_000 },
  adminMutation: { name: "admin-mutation", limit: 20, windowMs: 60_000 },
  webhookRetry: { name: "webhook-retry", limit: 10, windowMs: 60_000 }
} satisfies Record<string, RateLimitConfig>;

export function enforceRateLimit(request: NextRequest, config: RateLimitConfig) {
  const store = getRateLimitStore();
  const now = Date.now();
  const key = `${config.name}:${clientKey(request)}`;
  const bucket = store.get(key);

  if (!bucket || bucket.resetAt <= now) {
    store.set(key, {
      count: 1,
      resetAt: now + config.windowMs
    });
    cleanupExpiredBuckets(store, now);
    return;
  }

  bucket.count += 1;

  if (bucket.count > config.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    throw new Response("Too many requests", {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "X-RateLimit-Limit": String(config.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": new Date(bucket.resetAt).toISOString()
      }
    });
  }
}

function getRateLimitStore() {
  globalThis.sustainableEcgRateLimitStore ||= new Map<string, RateLimitBucket>();
  return globalThis.sustainableEcgRateLimitStore;
}

function clientKey(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const authSubject = request.headers.get("authorization")?.slice(-24);
  const devRole = request.headers.get("x-dev-role");

  return [forwardedFor || realIp || "unknown-ip", authSubject || devRole || "anonymous"].join(":");
}

function cleanupExpiredBuckets(store: Map<string, RateLimitBucket>, now: number) {
  if (store.size < 5000) {
    return;
  }

  for (const [key, bucket] of store.entries()) {
    if (bucket.resetAt <= now) {
      store.delete(key);
    }
  }
}
