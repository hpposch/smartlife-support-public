// Einfaches Redis-basiertes Rate-Limiting (Fixed Window) für Login,
// Magic-Links und andere missbrauchsanfällige Endpunkte.
import { queues } from "./queue";

export async function rateLimit(
  bucket: string,
  key: string,
  opts: { max: number; windowSeconds: number }
): Promise<{ allowed: boolean }> {
  const redis = queues().connection;
  const redisKey = `ratelimit:${bucket}:${key}`;
  const count = await redis.incr(redisKey);
  if (count === 1) await redis.expire(redisKey, opts.windowSeconds);
  return { allowed: count <= opts.max };
}

/** Fehlversuch-Zähler zurücksetzen (z. B. nach erfolgreichem Login). */
export async function rateLimitReset(bucket: string, key: string): Promise<void> {
  await queues().connection.del(`ratelimit:${bucket}:${key}`);
}
