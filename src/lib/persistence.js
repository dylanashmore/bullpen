import { Redis } from '@upstash/redis';

// Supports both env var namings: KV_REST_API_URL/TOKEN (Vercel KV, backed by
// Upstash) and UPSTASH_REDIS_REST_URL/TOKEN (connecting an Upstash database
// directly via the Vercel Marketplace). When neither is present (e.g. local
// dev with no database linked), `redis` stays null and every store falls
// back to an in-memory Map/array — matching the original zero-setup
// behavior, just without cross-instance persistence.
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const redis = url && token ? new Redis({ url, token }) : null;
export const isPersistent = Boolean(redis);

// The Upstash REST client auto-parses JSON values it recognizes, but stored
// values written as plain strings come back as strings — this normalizes
// either case rather than assuming one.
export function parseStored(value) {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}
