import crypto from "crypto";

export function generateOpaqueToken(length = 48): string {
  return crypto.randomBytes(length).toString("hex");
}

export function hashOpaqueToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function buildInviteLink(rawToken: string): string {
  const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  return `${baseUrl}/setup-password?token=${rawToken}`;
}

export function validatePasswordStrength(password: string): string[] {
  const issues: string[] = [];

  if (password.length < 10) {
    issues.push("Password must be at least 10 characters long.");
  }
  if (!/[A-Z]/.test(password)) {
    issues.push("Password must include at least one uppercase letter.");
  }
  if (!/[a-z]/.test(password)) {
    issues.push("Password must include at least one lowercase letter.");
  }
  if (!/[0-9]/.test(password)) {
    issues.push("Password must include at least one number.");
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    issues.push("Password must include at least one special character.");
  }

  return issues;
}
