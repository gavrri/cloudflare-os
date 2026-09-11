import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcSession, RpcTarget, WebSocketTransport } from "capnweb";
import { newWorkersRpcResponse } from "../src/server";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Access adapter cleanup with real WebSocketPair", () => {
  it.each(["close", "error", "abort", "expiry"] as const)("releases the lease and child capabilities on %s", async (cause) => {
    vi.useFakeTimers();
    const NativePair = WebSocketPair;
    let pair!: InstanceType<typeof WebSocketPair>;
    vi.stubGlobal("WebSocketPair", class {
      constructor() { pair = new NativePair(); return pair; }
    });
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, "addEventListener");
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    const abortSession = vi.fn((error: Error) => controller.abort(error));
    const act = vi.fn(() => "acted");
    const childDisposed = vi.fn();
    class Child extends RpcTarget {
      act() { return act(); }
      [Symbol.dispose]() { childDisposed(); }
    }
    class Main extends RpcTarget { mint() { return new Child(); } }
    const response = await newWorkersRpcResponse(new Request("https://workshop.example/api", {
      headers: { Upgrade: "websocket" },
    }), new Main(), { accessDeadline: Date.now() + 28_800_000,
      abortSignal: controller.signal, abortSession });
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    socket.accept();
    const client = new RpcSession<Main>(new WebSocketTransport(socket)).getRemoteMain();
    const child = await client.mint();
    try {
      expect(await child.act()).toBe("acted");
      expect(vi.getTimerCount()).toBe(1);
      const cleanup = added.mock.calls.find(([event]) => event === "abort")![1];
      if (cause === "close") {
        const closed = new Promise<void>((resolve) => pair[0].addEventListener("close", () => resolve(), { once: true }));
        socket.close(1000, "done");
        await closed;
      }
      else if (cause === "error") pair[0].dispatchEvent(new Event("error"));
      else if (cause === "abort") controller.abort(new Error("test abort"));
      else await vi.advanceTimersByTimeAsync(28_800_000);
      // Wait for the actual socket close/error propagation, not an arbitrary sleep.
      await expect(child.act()).rejects.toThrow();
      expect(act).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(removed).toHaveBeenCalledWith("abort", cleanup);
      expect(childDisposed).toHaveBeenCalledTimes(1);
      expect(abortSession).toHaveBeenCalledTimes(cause === "expiry" ? 1 : 0);
      await vi.advanceTimersByTimeAsync(28_800_000);
      expect(abortSession).toHaveBeenCalledTimes(cause === "expiry" ? 1 : 0);
    } finally { child[Symbol.dispose](); client[Symbol.dispose](); }
  });

  it.each(["", "not valid JSON"])("HTTP batch %j leaves no lease timer or abort listener", async (body) => {
    vi.useFakeTimers();
    const timer = vi.spyOn(globalThis, "setTimeout");
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, "addEventListener");
    const disposed = vi.fn();
    class Main extends RpcTarget { [Symbol.dispose]() { disposed(); } }
    const response = newWorkersRpcResponse(new Request("https://workshop.example/api", {
      method: "POST", body,
    }), new Main(), { accessDeadline: Date.now() + 28_800_000,
      abortSignal: controller.signal, abortSession: (error) => controller.abort(error) });
    if (body) await expect(response).rejects.toThrow();
    else expect((await response).status).toBe(200);
    expect(timer.mock.calls.filter(([, delay]) => Number(delay) > 1000)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(added.mock.calls.filter(([event]) => event === "abort")).toEqual([]);
    expect(disposed).toHaveBeenCalledTimes(1);
  });
});
