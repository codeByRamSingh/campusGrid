type LogLevel = "debug" | "info" | "warn" | "error";

const isDev = process.env.NODE_ENV !== "production";

const LEVEL_PREFIX: Record<LogLevel, string> = {
  debug: "[DEBUG]",
  info: " [INFO]",
  warn: " [WARN]",
  error: "[ERROR]",
};

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (isDev) {
    const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    const output = `${new Date().toISOString()} ${LEVEL_PREFIX[level]} ${message}${suffix}`;
    if (level === "error") {
      console.error(output);
    } else if (level === "warn") {
      console.warn(output);
    } else {
      console.log(output);
    }
  } else {
    const entry = { time: new Date().toISOString(), level, msg: message, ...meta };
    if (level === "error") {
      console.error(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => emit("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => emit("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit("error", message, meta),
};
