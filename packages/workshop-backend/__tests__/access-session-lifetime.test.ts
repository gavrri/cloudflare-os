import { describe, expect, it, vi } from "vitest";
import { newWorkersRpcResponse } from "../src/server";
import { RpcSession, RpcTarget } from "capnweb";
import { accessSessionDeadline, ACCESS_SESSION_MAX_SECONDS, guardTransportDeadline,
    type DeadlineGuardableTransport } from "../src/auth/access-session-lifetime";

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

// Exercise the production HTTP adapter with real Requests and client-generated wire batches.
describe("Access HTTP dispatch deadline", () => {
  it("preserves malformed batch rejection instead of misreporting Access expiry", async () => {
    const controller = new AbortController();
    const request = () => new Request("https://workshop.example/api", {
      method: "POST", body: "not valid JSON",
    });
    await expect(newWorkersRpcResponse(request(), new RpcTarget())).rejects.toThrow();
    await expect(newWorkersRpcResponse(request(), new RpcTarget(), {
      accessDeadline: Date.now() + 28_800_000,
      abortSignal: controller.signal,
      abortSession: (error) => controller.abort(error),
    })).rejects.toThrow();
  });
  function batch(pipeline: boolean) {
    const messages: string[] = [];
    const client = new RpcSession({
      send: (message: string) => { messages.push(message); },
      receive: () => new Promise<string>(() => {}),
    }).getRemoteMain() as any;
    const result = pipeline ? client.mint().act() : client.act();
    Promise.resolve(result).catch(() => {});
    return { messages, client };
  }

  it.each([false, true])("never dispatches after a delayed request body (pipeline=%s)", async (pipeline) => {
    const act = vi.fn(() => "acted");
    class Nested extends RpcTarget { act() { return act(); } }
    class Main extends Nested { mint() { return new Nested(); } }
    let time = 100;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => time);
    const wire = batch(pipeline);
    await Promise.resolve();
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const request = new Request("https://workshop.example/api", { method: "POST",
      body: new ReadableStream<Uint8Array>({ start(controller) { body = controller; } }) });
    const controller = new AbortController();
    const pending = newWorkersRpcResponse(request, new Main(), {
      accessDeadline: 200, abortSignal: controller.signal,
      abortSession: (error) => controller.abort(error),
    });
    time = 200;
    body.enqueue(new TextEncoder().encode(wire.messages.join("\n")));
    body.close();
    try {
      await pending;
      expect(act).not.toHaveBeenCalled();
    } finally { wire.client[Symbol.dispose](); clock.mockRestore(); }
  });

  it.each([false, true])("gates asynchronous nested pipeline execution (Access=%s)", async (access) => {
    let time = 100;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => time);
    const act = vi.fn(() => "acted");
    class Nested extends RpcTarget { act() { return act(); } }
    class Main extends RpcTarget {
      async mint() { await Promise.resolve(); time = 200; return new Nested(); }
    }
    const wire = batch(true);
    await Promise.resolve();
    const controller = new AbortController();
    try {
      await newWorkersRpcResponse(new Request("https://workshop.example/api", {
        method: "POST", body: wire.messages.join("\n"),
      }), new Main(), { accessDeadline: access ? 200 : undefined,
        abortSignal: controller.signal, abortSession: (error) => controller.abort(error) });
      expect(act).toHaveBeenCalledTimes(access ? 0 : 1);
    } finally { wire.client[Symbol.dispose](); clock.mockRestore(); }
  });
});

// A minimal in-memory duplex transport pair, so the tests below drive a real Cap'n Web
// `RpcSession` (real serialization, real dispatch) instead of asserting against a fake target.
class Queue {
  #items: string[] = [];
  #waiters: Array<{ resolve: (v: string) => void; reject: (e: unknown) => void }> = [];
  #error: unknown;

  push(item: string) {
    if (this.#error !== undefined) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter.resolve(item);
    else this.#items.push(item);
  }
  pull(): Promise<string> {
    if (this.#items.length > 0) return Promise.resolve(this.#items.shift()!);
    if (this.#error !== undefined) return Promise.reject(this.#error);
    return new Promise((resolve, reject) => this.#waiters.push({ resolve, reject }));
  }
  fail(err: unknown) {
    if (this.#error !== undefined) return;
    this.#error = err;
    for (const w of this.#waiters) w.reject(err);
    this.#waiters = [];
  }
}

function transportPair(): [DeadlineGuardableTransport, DeadlineGuardableTransport] {
  const toServer = new Queue();
  const toClient = new Queue();
  const client: DeadlineGuardableTransport = {
    send: (m) => toServer.push(m),
    receive: () => toClient.pull(),
    abort: (reason) => { toServer.fail(reason); toClient.fail(reason); },
  };
  const server: DeadlineGuardableTransport = {
    send: (m) => toClient.push(m),
    receive: () => toServer.pull(),
    abort: (reason) => { toServer.fail(reason); toClient.fail(reason); },
  };
  return [client, server];
}

describe("guardTransportDeadline", () => {
  it("allows a message strictly before the deadline", async () => {
    const abortSession = vi.fn();
    const inner: DeadlineGuardableTransport = { send: vi.fn(), receive: async () => "msg" };
    const guarded = guardTransportDeadline(inner, 1_000, abortSession, () => 500);
    await expect(guarded.receive()).resolves.toBe("msg");
    expect(abortSession).not.toHaveBeenCalled();
  });

  it("rejects a message that lands exactly at the deadline and aborts the session", async () => {
    const abortSession = vi.fn();
    const inner: DeadlineGuardableTransport = { send: vi.fn(), receive: async () => "msg" };
    const guarded = guardTransportDeadline(inner, 1_000, abortSession, () => 1_000);
    await expect(guarded.receive()).rejects.toThrow(/expired/i);
    expect(abortSession).toHaveBeenCalledTimes(1);
  });

  it("checks the deadline against when the message actually arrives, not when receive() was called", async () => {
    // Regression guard for a check-before-await version: here receive() is invoked while time is
    // still under the deadline, and only resolves with a message after the deadline has passed.
    // A check performed before the await would let this through; the real read loop keeps a
    // receive() pending the whole time a connection is idle, so this is the realistic shape of a
    // late-arriving message.
    let resolveInner!: (v: string) => void;
    const inner: DeadlineGuardableTransport = {
      send: vi.fn(),
      receive: () => new Promise((resolve) => { resolveInner = resolve; }),
    };
    const abortSession = vi.fn();
    let time = 0;
    const guarded = guardTransportDeadline(inner, 1_000, abortSession, () => time);

    const pending = guarded.receive();
    time = 1_000;
    resolveInner("late-message");

    await expect(pending).rejects.toThrow(/expired/i);
    expect(abortSession).toHaveBeenCalledTimes(1);
  });

  it("forwards abort() to the underlying transport", () => {
    const inner: DeadlineGuardableTransport = { send: vi.fn(), receive: vi.fn(), abort: vi.fn() };
    const guarded = guardTransportDeadline(inner, 1_000, vi.fn(), () => 0);
    guarded.abort?.("reason");
    expect(inner.abort).toHaveBeenCalledWith("reason");
  });

  it("two guarded transports with independent deadlines don't affect each other", async () => {
    const abortA = vi.fn();
    const abortB = vi.fn();
    const innerA: DeadlineGuardableTransport = { send: vi.fn(), receive: async () => "a" };
    const innerB: DeadlineGuardableTransport = { send: vi.fn(), receive: async () => "b" };
    const guardedA = guardTransportDeadline(innerA, 10_000, abortA, () => 10_500);
    const guardedB = guardTransportDeadline(innerB, 20_000, abortB, () => 10_500);

    await expect(guardedA.receive()).rejects.toThrow();
    expect(abortA).toHaveBeenCalledTimes(1);

    await expect(guardedB.receive()).resolves.toBe("b");
    expect(abortB).not.toHaveBeenCalled();
  });

  describe("wired into a real Cap'n Web session", () => {
    class Nested extends RpcTarget {
      actSpy = vi.fn(() => "acted");
      act() { return this.actSpy(); }
    }
    class Target extends RpcTarget {
      mintNestedSpy = vi.fn(() => new Nested());
      mintNested() { return this.mintNestedSpy(); }
    }

    it("blocks calls on a capability minted before expiry, once the deadline passes -- no timer involved", async () => {
      const [clientTransport, serverTransport] = transportPair();
      const abortSession = vi.fn();
      let time = 0;
      const guardedServerTransport = guardTransportDeadline(
          serverTransport, 1_000, abortSession, () => time);

      const target = new Target();
      new RpcSession(guardedServerTransport, target);
      const client = new RpcSession(clientTransport).getRemoteMain() as any;

      time = 500;
      const nested = await client.mintNested();
      expect(await nested.act()).toBe("acted");

      // Deadline has passed. No close timer fires in this test -- enforcement is purely the
      // per-message check on the transport that already carried the nested capability.
      time = 1_500;
      await expect(nested.act()).rejects.toThrow();

      const nestedInstance = target.mintNestedSpy.mock.results[0]!.value as Nested;
      expect(nestedInstance.actSpy).toHaveBeenCalledTimes(1);
      expect(abortSession).toHaveBeenCalledTimes(1);
    });

    it("blocks an already-received pipeline whose nested target resolves after expiry", async () => {
      const [clientTransport, serverTransport] = transportPair();
      let time = 100;
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => { release = resolve; });
      const act = vi.fn(() => "acted");
      class NestedTarget extends RpcTarget { act() { return act(); } }
      class AsyncTarget extends RpcTarget {
        async mint() { await waiting; return new NestedTarget(); }
      }
      const server = new RpcSession(guardTransportDeadline(
        serverTransport, 200, vi.fn(), () => time), new AsyncTarget());
      const client = new RpcSession(clientTransport).getRemoteMain() as any;
      const call = Promise.resolve(client.mint().act()).catch(() => undefined);
      // Let both frames enter the dispatch queue while the lease is valid.
      for (let i = 0; i < 20; ++i) await Promise.resolve();
      time = 200;
      release();
      try {
        await call;
        expect(act).not.toHaveBeenCalled();
      } finally { client[Symbol.dispose](); server.getRemoteMain()[Symbol.dispose](); }
    });

    it("a fresh session with its own deadline is unaffected by another session's expiry", async () => {
      const [clientTransportOld, serverTransportOld] = transportPair();
      const [clientTransportNew, serverTransportNew] = transportPair();
      const abortOld = vi.fn();
      const abortNew = vi.fn();

      new RpcSession(
          guardTransportDeadline(serverTransportOld, 10_000, abortOld, () => 10_500),
          new Target());
      new RpcSession(
          guardTransportDeadline(serverTransportNew, 20_000, abortNew, () => 10_500),
          new Target());

      const oldClient = new RpcSession(clientTransportOld).getRemoteMain() as any;
      const newClient = new RpcSession(clientTransportNew).getRemoteMain() as any;

      await expect(oldClient.mintNested()).rejects.toThrow();
      expect(abortOld).toHaveBeenCalledTimes(1);

      const nested = await newClient.mintNested();
      expect(await nested.act()).toBe("acted");
      expect(abortNew).not.toHaveBeenCalled();
    });
  });
});
