import { timingSafeEqual } from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import {
  AckRequestSchema,
  CommandSubmitRequestSchema,
  EnvelopeSchema,
  PullRequestSchema,
  RELAY_PROTOCOL_VERSION,
  RelayHealthSchema,
  type Command,
  type Envelope,
} from "@om/relay-contract";
import type { RelayConfig } from "./config.js";
import { verifyShopifyHmac } from "./signature.js";
import { ShopifyCommands, type CommandOutcome } from "./shopify/commands.js";
import { InMemoryRelayStore } from "./store.js";

const startedAtMs = Date.now();

function timingSafeTokenMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Machine-credential guard for private-system synchronization routes. */
function requireMachineToken(config: RelayConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? "";
    const [scheme, token] = header.split(" ");
    if (
      scheme !== "Bearer" ||
      !token ||
      !timingSafeTokenMatch(token, config.machineToken)
    ) {
      res.status(401).json({ error: "machine credential required" });
      return;
    }
    next();
  };
}

export interface BuildAppOptions {
  config: RelayConfig;
  store: InMemoryRelayStore;
  now?: () => number;
  /** Injected into the default shopify runtime (tests stub the platform). */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Full command-execution override for tests. */
  executeCommand?: (command: Command) => Promise<CommandOutcome>;
}

export function buildApp({
  config,
  store,
  now = Date.now,
  fetchImpl,
  sleep,
  executeCommand,
}: BuildAppOptions): Express {
  const app = express();

  const guard = requireMachineToken(config);

  const shopify = config.shopify
    ? new ShopifyCommands(config.shopify, { fetchImpl, sleep })
    : null;

  const outcomeFor = async (command: Command): Promise<CommandOutcome> => {
    if (executeCommand) {
      return executeCommand(command);
    }
    if (command.platform === "shopify") {
      if (!shopify) {
        return {
          status: "unsupported",
          response: null,
          error: {
            code: "PLATFORM_NOT_CONFIGURED",
            message: "Shopify credentials are not configured on this worker.",
          },
        };
      }
      return shopify.run(command.kind, command.payload);
    }
    return {
      status: "unsupported",
      response: null,
      error: {
        code: "PLATFORM_NOT_SUPPORTED",
        message: `Platform ${command.platform} has no adapter on this worker yet.`,
      },
    };
  };

  const executeAndEnqueue = (command: Command): void => {
    void outcomeFor(command)
      .then((outcome) => {
        const envelope: Envelope = {
          id: `result-${command.id}`,
          kind: "command-result",
          protocolVersion: RELAY_PROTOCOL_VERSION,
          platform: command.platform,
          commandId: command.id,
          status: outcome.status,
          response: outcome.response,
          error: outcome.error,
          completedAt: new Date(now()).toISOString(),
        };
        store.enqueue(envelope.id, JSON.stringify(envelope));
      })
      .catch((err: unknown) => {
        const envelope: Envelope = {
          id: `result-${command.id}`,
          kind: "command-result",
          protocolVersion: RELAY_PROTOCOL_VERSION,
          platform: command.platform,
          commandId: command.id,
          status: "failed",
          response: null,
          error: {
            code: "INTERNAL",
            message: err instanceof Error ? err.message : String(err),
          },
          completedAt: new Date(now()).toISOString(),
        };
        store.enqueue(envelope.id, JSON.stringify(envelope));
      });
  };

  // Public, non-sensitive liveness only.
  app.get("/relay/v1/health", (_req, res) => {
    res.json(
      RelayHealthSchema.parse({
        status: "ok",
        protocolVersion: RELAY_PROTOCOL_VERSION,
        uptimeSeconds: Math.floor((now() - startedAtMs) / 1000),
      }),
    );
  });

  // Platform webhook intake: validate signature on the raw body, persist the
  // envelope, and acknowledge to the platform quickly. The webhook is a
  // change signal; the private system later pulls the envelope.
  app.post(
    "/relay/v1/webhooks/shopify",
    express.raw({ type: "*/*", limit: "2mb" }),
    (req, res) => {
      if (!config.shopifyWebhookSecret) {
        res.status(503).json({ error: "webhook intake not configured" });
        return;
      }
      const hmac = req.headers["x-shopify-hmac-sha256"] as string | undefined;
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
      if (!verifyShopifyHmac(rawBody, hmac, config.shopifyWebhookSecret)) {
        res.status(401).json({ error: "invalid signature" });
        return;
      }
      const envelope: Envelope = {
        id: (req.headers["x-shopify-webhook-id"] as string) || cryptoWebhookId(),
        kind: "webhook",
        protocolVersion: RELAY_PROTOCOL_VERSION,
        platform: "shopify",
        topic: (req.headers["x-shopify-topic"] as string) || "unknown",
        storeRef: (req.headers["x-shopify-shop-domain"] as string) || null,
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, String(v)]),
        ),
        bodyBase64: rawBody.toString("base64"),
        receivedAt: new Date(now()).toISOString(),
      };
      store.enqueue(envelope.id, JSON.stringify(envelope));
      res.status(202).json({ accepted: true, envelopeId: envelope.id });
    },
  );

  // Private-system synchronization (machine credential required).
  app.post(
    "/relay/v1/messages/pull",
    guard,
    express.json(),
    (req, res) => {
      const body = PullRequestSchema.parse(req.body ?? {});
      const messages = store
        .pull(body.max, now())
        .map((message) => ({
          leaseToken: message.leaseToken,
          expiresAt: new Date(message.expiresAtMs).toISOString(),
          envelope: EnvelopeSchema.parse(JSON.parse(message.payloadJson)),
        }));
      res.json({ messages });
    },
  );

  app.post(
    "/relay/v1/messages/ack",
    guard,
    express.json(),
    (req, res) => {
      const body = AckRequestSchema.parse(req.body);
      const delivered = store.acknowledge(body.leaseToken, now());
      res.json({ delivered });
    },
  );

  // Command intake: accepted immediately, executed asynchronously; the
  // result envelope lands on the pull queue when the platform answers.
  app.post(
    "/relay/v1/commands",
    guard,
    express.json(),
    (req, res) => {
      const body = CommandSubmitRequestSchema.parse(req.body);
      executeAndEnqueue(body.command);
      res.status(202).json({ commandId: body.command.id });
    },
  );

  return app;
}

function cryptoWebhookId(): string {
  return `wh-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
