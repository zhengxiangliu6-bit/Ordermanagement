import { describe, expect, it } from "vitest";
import {
  AckRequestSchema,
  CommandResultEnvelopeSchema,
  CommandSchema,
  EnvelopeSchema,
  PullRequestSchema,
  RELAY_PROTOCOL_VERSION,
  RelayHealthSchema,
  WebhookEnvelopeSchema,
} from "./protocol.js";

const NOW = new Date("2026-09-07T00:00:00.000Z").toISOString();

describe("relay contract v1", () => {
  it("pins the protocol version", () => {
    expect(RELAY_PROTOCOL_VERSION).toBe("v1");
  });

  const webhook = {
    id: "wh-1",
    kind: "webhook",
    protocolVersion: "v1",
    platform: "shopify",
    topic: "orders/create",
    storeRef: null,
    headers: { "x-shopify-topic": "orders/create" },
    bodyBase64: Buffer.from("{}").toString("base64"),
    receivedAt: NOW,
  };

  it("accepts a valid webhook envelope", () => {
    expect(WebhookEnvelopeSchema.parse(webhook)).toMatchObject({ id: "wh-1" });
    expect(EnvelopeSchema.parse(webhook)).toMatchObject({ kind: "webhook" });
  });

  it("rejects a webhook envelope with a wrong protocol version", () => {
    expect(() =>
      WebhookEnvelopeSchema.parse({ ...webhook, protocolVersion: "v2" }),
    ).toThrow();
  });

  const result = {
    id: "res-1",
    kind: "command-result",
    protocolVersion: "v1",
    platform: "etsy",
    commandId: "cmd-1",
    status: "unsupported",
    response: null,
    error: { code: "NOT_SUPPORTED", message: "No adapter in skeleton" },
    completedAt: NOW,
  };

  it("accepts a valid command-result envelope", () => {
    expect(CommandResultEnvelopeSchema.parse(result)).toMatchObject({
      commandId: "cmd-1",
    });
  });

  it("rejects unknown command statuses", () => {
    expect(() =>
      CommandResultEnvelopeSchema.parse({ ...result, status: "maybe" }),
    ).toThrow();
  });

  it("validates commands", () => {
    const command = {
      id: "cmd-1",
      protocolVersion: "v1",
      platform: "shopify",
      kind: "orders.fetch",
      payload: { storeRef: "s1" },
      issuedAt: NOW,
    };
    expect(CommandSchema.parse(command)).toMatchObject({ kind: "orders.fetch" });
    expect(() => CommandSchema.parse({ ...command, kind: "" })).toThrow();
  });

  it("applies the pull max default and bounds", () => {
    expect(PullRequestSchema.parse({})).toMatchObject({ max: 10 });
    expect(() => PullRequestSchema.parse({ max: 101 })).toThrow();
  });

  it("validates ack and health payloads", () => {
    expect(AckRequestSchema.parse({ leaseToken: "t" })).toMatchObject({
      leaseToken: "t",
    });
    expect(
      RelayHealthSchema.parse({
        status: "ok",
        protocolVersion: "v1",
        uptimeSeconds: 1.5,
      }),
    ).toMatchObject({ status: "ok" });
  });
});
