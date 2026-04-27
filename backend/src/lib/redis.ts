import { createClient } from "redis";

type RedisConnection = ReturnType<typeof createClient>;

let redisClient: RedisConnection | null = null;
let connectPromise: Promise<RedisConnection | null> | null = null;
let loggedConnectionFailure = false;

async function connectRedis(): Promise<RedisConnection | null> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    return null;
  }

  const client = createClient({ url: redisUrl });
  client.on("error", (error) => {
    if (!loggedConnectionFailure) {
      loggedConnectionFailure = true;
      console.error("Redis unavailable, falling back to non-distributed rate limits:", error.message);
    }
  });

  try {
    await client.connect();
    loggedConnectionFailure = false;
    return client;
  } catch (error) {
    if (!loggedConnectionFailure) {
      loggedConnectionFailure = true;
      console.error("Redis connection failed, falling back to non-distributed rate limits:", error);
    }
    try {
      await client.disconnect();
    } catch {
      // Ignore cleanup failures after an unsuccessful connect attempt.
    }
    return null;
  }
}

export async function getRedisClient(): Promise<RedisConnection | null> {
  if (redisClient?.isOpen) {
    return redisClient;
  }

  if (!connectPromise) {
    connectPromise = connectRedis().then((client) => {
      redisClient = client;
      connectPromise = null;
      return client;
    });
  }

  return connectPromise;
}

export async function consumeRateLimit(key: string, windowMs: number): Promise<{ count: number; resetAt: number } | null> {
  const redis = await getRedisClient();
  if (!redis) {
    return null;
  }

  const count = await redis.incr(key);
  let ttl = await redis.pTTL(key);

  if (count === 1 || ttl < 0) {
    await redis.pExpire(key, windowMs);
    ttl = windowMs;
  }

  return {
    count,
    resetAt: Date.now() + ttl,
  };
}