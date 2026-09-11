import { describe, expect, it } from "vitest";
import { accessSessionDeadline, ACCESS_SESSION_MAX_SECONDS } from "../src/auth/access-session-lifetime";

describe("Access session lifetime", () => {
  const iat = 100_000;
  const now = (iat + 1) * 1000;
  it("caps at eight hours from issue, not connection time", () => {
    expect(accessSessionDeadline({ iat, exp: iat + 100_000 }, now))
      .toBe((iat + ACCESS_SESSION_MAX_SECONDS) * 1000);
  });
  it("uses earlier token expiry", () => {
    expect(accessSessionDeadline({ iat, exp: iat + 20 }, now)).toBe((iat + 20) * 1000);
  });
  it.each([undefined, null, "100000", NaN, Infinity, -1, 1.5])("rejects malformed iat %s", (value) => {
    expect(() => accessSessionDeadline({ iat: value as number, exp: iat + 20 }, now)).toThrow();
  });
  it.each([undefined, null, "100020", NaN, Infinity, -1, 1.5])("rejects malformed exp %s", (value) => {
    expect(() => accessSessionDeadline({ iat, exp: value as number }, now)).toThrow();
  });
  it("rejects future issue, reversed interval and exact expiry", () => {
    expect(() => accessSessionDeadline({ iat: iat + 2, exp: iat + 20 }, now)).toThrow();
    expect(() => accessSessionDeadline({ iat, exp: iat }, now)).toThrow();
    expect(() => accessSessionDeadline({ iat, exp: iat + 1 }, now)).toThrow();
    expect(() => accessSessionDeadline({ iat, exp: iat + 100_000 },
      (iat + ACCESS_SESSION_MAX_SECONDS) * 1000)).toThrow();
  });
  it("new assertion cannot alter an old assertion deadline", () => {
    const old = { iat, exp: iat + 100_000 };
    const deadline = accessSessionDeadline(old, now);
    accessSessionDeadline({ iat: iat + 1, exp: iat + 100_001 }, now);
    expect(accessSessionDeadline(old, now)).toBe(deadline);
  });
});
