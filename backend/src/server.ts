import { app } from "./app.js";

// ---------------------------------------------------------------------------
// Environment Variable Validation (TASK-INF-04)
// Fail fast at startup with clear messages rather than cryptic runtime errors.
// ---------------------------------------------------------------------------

// Required env vars that MUST be set
const REQUIRED_ENV: string[] = ["DATABASE_URL", "JWT_SECRET"];

// Optional env vars with default values
const OPTIONAL_ENV: Record<string, unknown> = {
  PORT: 4000,
  NODE_ENV: "development",
  REDIS_URL: "redis://localhost:6379",
  CORS_ORIGINS: "http://localhost:80,http://localhost",
  FRONTEND_URL: "http://localhost",
  FINANCE_API_RATE_LIMIT_MAX: 180,
  PAYROLL_API_RATE_LIMIT_MAX: 45,
};

// Validate required vars
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`\n❌ FATAL: Missing required environment variables:\n   ${missing.join("\n   ")}\n`);
  console.error("Add these to your .env file or Docker environment configuration.\n");
  process.exit(1);
}

// Validate PORT is a valid number
const port = Number(process.env.PORT || 4000);
if (isNaN(port) || port < 1 || port > 65535) {
  console.error(`\n❌ FATAL: PORT must be a valid port number (1-65535). Got: ${process.env.PORT}\n`);
  process.exit(1);
}

// Validate REDIS_URL format if provided
if (process.env.REDIS_URL && !process.env.REDIS_URL.startsWith("redis://")) {
  console.warn(`⚠️  WARNING: REDIS_URL should start with 'redis://'. Got: ${process.env.REDIS_URL}`);
}

// Validate DATABASE_URL format
if (!process.env.DATABASE_URL?.startsWith("postgresql://")) {
  console.warn(`⚠️  WARNING: DATABASE_URL should start with 'postgresql://'. Got: ${process.env.DATABASE_URL?.substring(0, 20)}...`);
}

// Log configuration on startup (non-sensitive info)
console.log(`\n✅ Environment Validation Passed`);
console.log(`   NODE_ENV: ${process.env.NODE_ENV || "development"}`);
console.log(`   PORT: ${port}`);
console.log(`   Database: ${process.env.DATABASE_URL?.substring(0, 30)}...`);
console.log(`   Redis: ${process.env.REDIS_URL || "(disabled)"}\n`);

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`🚀 CampusGrid backend running on port ${port}`);
});
