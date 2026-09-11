import type { JWTPayload } from "jose";

/** Maximum host lifetime, measured from the verified assertion's issue time. */
export const ACCESS_SESSION_MAX_SECONDS = 8 * 60 * 60;

/** Compute an immutable deadline from verified claims; never use unverified JWT decoding. */
export function accessSessionDeadline(payload: JWTPayload, now = Date.now()): number {
  const { iat, exp } = payload;
  if (typeof iat !== "number" || typeof exp !== "number" ||
      !Number.isSafeInteger(iat) || !Number.isSafeInteger(exp) ||
      iat < 0 || exp <= iat || iat * 1000 > now) {
    throw new Error("Invalid Access session lifetime claims.");
  }
  const deadline = Math.min(exp, iat + ACCESS_SESSION_MAX_SECONDS) * 1000;
  if (!Number.isSafeInteger(deadline) || deadline <= now) {
    throw new Error("Access session expired.");
  }
  return deadline;
}
