import { describe, expect, it } from "vitest";
import { InMemoryRelayStore } from "./store.js";

const TTL_MS = 60_000;

function enqueue(store: InMemoryRelayStore, id: string): void {
  store.enqueue(id, JSON.stringify({ id }));
}

describe("InMemoryRelayStore", () => {
  it("leases queued messages and acknowledges them", () => {
    const store = new InMemoryRelayStore(TTL_MS);
    enqueue(store, "a");
    enqueue(store, "b");

    const messages = store.pull(10);
    expect(messages).toHaveLength(2);
    expect(messages[0].envelopeId).toBe("a");

    expect(store.acknowledge(messages[0].leaseToken)).toBe(true);
    expect(store.isDelivered("a")).toBe(true);
    // Acknowledged messages are not redelivered.
    expect(store.pull(10, Date.now() + TTL_MS * 2)).toHaveLength(1);
  });

  it("respects the pull limit", () => {
    const store = new InMemoryRelayStore(TTL_MS);
    enqueue(store, "a");
    enqueue(store, "b");
    enqueue(store, "c");

    expect(store.pull(2)).toHaveLength(2);
    expect(store.pull(2)).toHaveLength(1);
  });

  it("requeues messages whose lease expired (duplicate delivery)", () => {
    const store = new InMemoryRelayStore(TTL_MS);
    enqueue(store, "a");

    const [message] = store.pull(1);
    expect(store.acknowledge(message.leaseToken, Date.now() + TTL_MS + 1)).toBe(
      false,
    );

    // Expired lease becomes pullable again; duplicate delivery is expected.
    const redelivered = store.pull(1, Date.now() + TTL_MS + 2);
    expect(redelivered).toHaveLength(1);
    expect(redelivered[0].envelopeId).toBe("a");
  });

  it("rejects unknown lease tokens", () => {
    const store = new InMemoryRelayStore(TTL_MS);
    expect(store.acknowledge("nope")).toBe(false);
  });

  it("counts pending messages", () => {
    const store = new InMemoryRelayStore(TTL_MS);
    expect(store.pendingCount()).toBe(0);
    enqueue(store, "a");
    expect(store.pendingCount()).toBe(1);
  });
});
