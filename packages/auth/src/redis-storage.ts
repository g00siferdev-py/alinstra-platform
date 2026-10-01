import type { Redis } from "ioredis";
import type { SecondaryStorage } from "better-auth";

export function redisSecondaryStorage(redis: Redis): SecondaryStorage {
  return {
    async get(key) {
      return redis.get(key);
    },
    async getAndDelete(key) {
      const value = await redis.get(key);
      if (value !== null) await redis.del(key);
      return value;
    },
    async increment(key, ttl) {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, ttl);
      return count;
    },
    async set(key, value, ttl) {
      if (ttl) await redis.set(key, value, "EX", ttl);
      else await redis.set(key, value);
    },
    async delete(key) {
      await redis.del(key);
    },
  };
}
