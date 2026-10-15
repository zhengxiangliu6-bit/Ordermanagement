/**
 * Relay Worker communication contract (v1).
 *
 * The Relay Worker is a durable transport and platform-adapter boundary on a
 * public VPS; the private Order Management backend initiates all contact.
 * Shared source between the two applications is limited to this contract
 * (schemas + version) and genuinely generic primitives — never business
 * logic (architecture decision ADR-002).
 *
 * Message shapes are intentionally coarse: endpoint layout, polling
 * intervals, and storage stay implementation decisions.
 */

export const RELAY_PROTOCOL_VERSION = "v1";

import { z } from "zod";

export const RelayPlatformSchema = z.enum(["shopify", "etsy", "other"]);
export type RelayPlatform = z.infer<typeof RelayPlatformSchema>;

/** A webhook delivery accepted from a platform and awaiting processing. */
export const WebhookEnvelopeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("webhook"),
  protocolVersion: z.literal(RELAY_PROTOCOL_VERSION),
  platform: RelayPlatformSchema,
  topic: z.string().min(1),
  /** Opaque store identifier from the private system; null when unknown. */
  storeRef: z.string().min(1).nullable(),
  headers: z.record(z.string(), z.string()),
  /** Original request body (base64) kept verbatim for audit/replay. */
  bodyBase64: z.string(),
  receivedAt: z.iso.datetime(),
});
export type WebhookEnvelope = z.infer<typeof WebhookEnvelopeSchema>;

export const CommandStatusSchema = z.enum(["succeeded", "failed", "unsupported"]);
export type CommandStatus = z.infer<typeof CommandStatusSchema>;

/** Result of one platform operation executed by the Relay Worker. */
export const CommandResultEnvelopeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("command-result"),
  protocolVersion: z.literal(RELAY_PROTOCOL_VERSION),
  platform: RelayPlatformSchema,
  commandId: z.string().min(1),
  status: CommandStatusSchema,
  response: z.unknown().nullable(),
  error: z
    .object({ code: z.string().min(1), message: z.string().min(1) })
    .nullable(),
  completedAt: z.iso.datetime(),
});
export type CommandResultEnvelope = z.infer<typeof CommandResultEnvelopeSchema>;

export const EnvelopeSchema = z.discriminatedUnion("kind", [
  WebhookEnvelopeSchema,
  CommandResultEnvelopeSchema,
]);
export type Envelope = z.infer<typeof EnvelopeSchema>;

/** A platform operation requested by the private backend. */
export const CommandSchema = z.object({
  id: z.string().min(1),
  protocolVersion: z.literal(RELAY_PROTOCOL_VERSION),
  platform: RelayPlatformSchema,
  /** Adapter operation name, e.g. `fulfillment.create` or `orders.fetch`. */
  kind: z.string().min(1),
  payload: z.unknown(),
  issuedAt: z.iso.datetime(),
});
export type Command = z.infer<typeof CommandSchema>;

export const PullRequestSchema = z.object({
  max: z.number().int().positive().max(100).default(10),
});
export type PullRequest = z.infer<typeof PullRequestSchema>;

export const PulledMessageSchema = z.object({
  leaseToken: z.string().min(1),
  expiresAt: z.iso.datetime(),
  envelope: EnvelopeSchema,
});
export type PulledMessage = z.infer<typeof PulledMessageSchema>;

export const PullResponseSchema = z.object({
  messages: z.array(PulledMessageSchema),
});
export type PullResponse = z.infer<typeof PullResponseSchema>;

export const AckRequestSchema = z.object({
  leaseToken: z.string().min(1),
});
export type AckRequest = z.infer<typeof AckRequestSchema>;

export const AckResponseSchema = z.object({
  delivered: z.boolean(),
});
export type AckResponse = z.infer<typeof AckResponseSchema>;

export const CommandSubmitRequestSchema = z.object({
  command: CommandSchema,
});
export type CommandSubmitRequest = z.infer<typeof CommandSubmitRequestSchema>;

export const CommandSubmitResponseSchema = z.object({
  commandId: z.string().min(1),
});
export type CommandSubmitResponse = z.infer<typeof CommandSubmitResponseSchema>;

/** Non-sensitive liveness information only. */
export const RelayHealthSchema = z.object({
  status: z.literal("ok"),
  protocolVersion: z.literal(RELAY_PROTOCOL_VERSION),
  uptimeSeconds: z.number().nonnegative(),
});
export type RelayHealth = z.infer<typeof RelayHealthSchema>;
