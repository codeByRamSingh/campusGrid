import type { RequestHandler } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { consumeRateLimit } from "./redis.js";

type RateLimitOptions = {
  scope: string;
  windowMs: number;
  max: number;
  message: string;
  key: (req: AuthenticatedRequest) => string | undefined;
};

export function createRateLimitMiddleware(options: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    const rateLimitKey = options.key(req as AuthenticatedRequest);
    if (!rateLimitKey) {
      next();
      return;
    }

    try {
      const result = await consumeRateLimit(`rate_limit:${options.scope}:${rateLimitKey}`, options.windowMs);
      if (!result) {
        next();
        return;
      }

      res.setHeader("X-RateLimit-Limit", String(options.max));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, options.max - result.count)));
      res.setHeader("X-RateLimit-Reset", new Date(result.resetAt).toISOString());

      if (result.count > options.max) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))));
        res.status(429).json({ message: options.message });
        return;
      }
    } catch {
      // Fail open if Redis is unavailable so application traffic is not blocked.
    }

    next();
  };
}