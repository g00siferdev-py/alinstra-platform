import { getEnv } from "@alinstra/config";
import { Redis } from "ioredis";

export type Counter = {
  increment(key: string, windowSeconds: number): Promise<number>;
  get(key: string): Promise<number>;
  clear(key: string): Promise<void>;
};

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

export function memoryCounter(): Counter {
  return {
    async increment(key, windowSeconds) {
      const now = Date.now();
      const existing = memoryBuckets.get(key);
      if (!existing || existing.resetAt <= now) {
        memoryBuckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
        return 1;
      }
      existing.count += 1;
      return existing.count;
    },
    async get(key) {
      const existing = memoryBuckets.get(key);
      if (!existing || existing.resetAt <= Date.now()) return 0;
      return existing.count;
    },
    async clear(key) {
      memoryBuckets.delete(key);
    },
  };
}

let redisCounter: Counter | undefined;

function redisBackedCounter(): Counter {
  if (!redisCounter) {
    const redis = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true, family: 0 });
    redisCounter = {
      async increment(key, windowSeconds) {
        const count = await redis.incr(key);
        if (count === 1) await redis.expire(key, windowSeconds);
        return count;
      },
      async get(key) {
        const value = await redis.get(key);
        return value ? Number(value) : 0;
      },
      async clear(key) {
        await redis.del(key);
      },
    };
  }
  return redisCounter;
}

export function getCounter(): Counter {
  const env = getEnv();
  if (env.NODE_ENV === "test" || env.LOCKOUT_STORE === "memory") return memoryCounter();
  return redisBackedCounter();
}

export function resetMemoryCounter(): void {
  memoryBuckets.clear();
}
