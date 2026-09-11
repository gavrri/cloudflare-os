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

/** Minimal shape Cap'n Web's string-encoded transports (WebSocket, HTTP batch) satisfy. */
export interface DeadlineGuardableTransport {
  readonly encodingLevel?: "string";
  send(message: string): void | Promise<void>;
  receive(): Promise<string>;
  abort?(reason: unknown): void;
  /** Cap'n Web's optional pre-invocation hook; see capnweb's `RpcTransport.checkDeadline`. */
  checkDeadline?(): void;
}

/**
 * Wraps an inbound RPC transport so no message is dispatched into the session, and no method is
 * actually invoked on an exported capability, once `deadline` has passed. Two independent checks
 * are needed because neither alone covers every path a call can take to reach the target:
 *
 * - `receive()` is checked after every inbound message lands, which stops a *new* message --
 *   including one carrying a call on a capability minted before expiry -- from being dispatched.
 *   It cannot, on its own, stop a call whose message was already received before the deadline but
 *   whose target or arguments were still resolving (e.g. an async method returning a nested
 *   capability, or a pipelined call queued on that pending result): no further `receive()` ever
 *   happens for that call, so a receive-only check would let it through once the pending promise
 *   settles past the deadline.
 * - `checkDeadline()` is Cap'n Web's optional pre-invocation hook (capnweb#patch, see
 *   patches/capnweb.patch), called immediately before every local method invocation, after the
 *   call's target and arguments have finished resolving. This is the only point that is
 *   temporally accurate regardless of how many promise hops it took to get there.
 *
 * Both funnel through the same idempotent `expire()` so `abortSession` fires at most once no
 * matter which check (or how many calls) observe the expired deadline.
 *
 * The `receive()` check runs *after* awaiting the underlying `receive()`, not before: a message
 * can arrive while the check is pending, and only a check performed once the message has actually
 * landed catches that case. A close timer alone cannot substitute for either check, because a
 * timer may fire late (event loop lag, a busy isolate); these checks have no such delay since they
 * run inline with the message/call they gate.
 */
export function guardTransportDeadline<T extends DeadlineGuardableTransport>(
    transport: T,
    deadline: number,
    abortSession: (reason: Error) => void,
    now: () => number = Date.now): T {
  let expired: Error | undefined;
  const expire = (): Error => {
    if (!expired) {
      expired = new Error("Access session expired.");
      abortSession(expired);
    }
    return expired;
  };
  return {
    encodingLevel: transport.encodingLevel,
    send: (message: string) => transport.send(message),
    receive: async () => {
      const message = await transport.receive();
      if (now() >= deadline) throw expire();
      return message;
    },
    checkDeadline: () => {
      if (now() >= deadline) throw expire();
    },
    abort: transport.abort ? (reason: unknown) => transport.abort!(reason) : undefined,
  } as T;
}
