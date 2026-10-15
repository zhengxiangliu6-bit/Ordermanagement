import { randomUUID } from 'node:crypto';
import {
  AckRequestSchema,
  CommandSchema,
  PullRequestSchema,
  type Command,
  type CommandResultEnvelope,
  type PulledMessage,
} from '@om/relay-contract';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Client for the Relay Worker's private synchronization surface
 * (ADR-002): the API submits platform commands and receives result
 * envelopes over the pull/lease/ack queue. Webhook envelopes are not
 * expected in this deployment phase (no public endpoint yet); the
 * webhook milestone will route them into their own consumer.
 *
 * One command round-trip at a time (serialized): a pull may deliver
 * another caller's result, and only a single consumer loop may ack.
 *
 * Environment:
 * - RELAY_URL               base URL of the worker (default localhost:3100)
 * - RELAY_MACHINE_TOKEN     must match the worker's RELAY_MACHINE_TOKEN
 */

export class RelayCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RelayCommandError';
  }
}

export interface RunCommandInput {
  platform?: 'shopify';
  kind: string;
  payload?: unknown;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

interface RelayHttpResponse {
  status: number;
  body: unknown;
}

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_INTERVAL_MS = 400;

@Injectable()
export class RelayClient {
  private readonly logger = new Logger(RelayClient.name);
  private readonly baseUrl: string;
  private readonly machineToken: string;
  /** Serializes round-trips so concurrent commands cannot ack each other's results. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor() {
    this.baseUrl = (
      process.env.RELAY_URL ?? 'http://localhost:3100'
    ).replace(/\/+$/, '');
    this.machineToken = process.env.RELAY_MACHINE_TOKEN ?? '';
  }

  get configured(): boolean {
    return this.machineToken.length > 0;
  }

  /** Liveness probe against the worker's public health endpoint. */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/relay/v1/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Submits a command and resolves with its `succeeded` response.
   * Throws RelayCommandError for failed/unsupported results, relay
   * connectivity problems, and timeouts.
   */
  runCommand(input: RunCommandInput): Promise<{ response: unknown }> {
    const attempt = () => this.roundTrip(input);
    const result = this.chain.then(attempt, attempt);
    this.chain = result.catch(() => undefined);
    return result;
  }

  private async roundTrip(input: RunCommandInput): Promise<{ response: unknown }> {
    const command: Command = CommandSchema.parse({
      id: randomUUID(),
      protocolVersion: 'v1',
      platform: input.platform ?? 'shopify',
      kind: input.kind,
      payload: input.payload ?? {},
      issuedAt: new Date().toISOString(),
    });

    const submit = await this.request('POST', '/relay/v1/commands', {
      command,
    });
    if (submit.status === 401) {
      throw new RelayCommandError(
        'RELAY_UNAUTHORIZED',
        'Relay rejected the machine credential (RELAY_MACHINE_TOKEN mismatch).',
      );
    }
    if (submit.status !== 202) {
      throw new RelayCommandError(
        'RELAY_SUBMIT_FAILED',
        `Relay command submit failed: HTTP ${submit.status} ${JSON.stringify(submit.body).slice(0, 200)}`,
      );
    }

    const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const interval = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    while (Date.now() < deadline) {
      await sleep(interval);
      const pull = await this.request('POST', '/relay/v1/messages/pull', {
        max: PullRequestSchema.shape.max.parse(10),
      });
      if (pull.status === 401) {
        throw new RelayCommandError('RELAY_UNAUTHORIZED', 'Relay pull was unauthorized.');
      }
      if (pull.status >= 500) {
        continue; // transient worker trouble: keep polling until the deadline
      }
      if (pull.status !== 200) {
        throw new RelayCommandError(
          'RELAY_PULL_FAILED',
          `Relay pull failed: HTTP ${pull.status}`,
        );
      }

      const messages = (pull.body as { messages?: PulledMessage[] }).messages ?? [];
      for (const message of messages) {
        const envelope = message.envelope;
        if (
          envelope.kind === 'command-result' &&
          envelope.commandId === command.id
        ) {
          await this.acknowledge(message.leaseToken);
          return this.unwrap(envelope);
        }
        // Not this command's result. Local pull-only phase: ack everything
        // so the queue keeps moving; webhook routing arrives with the
        // public-endpoint milestone.
        if (envelope.kind === 'webhook') {
          this.logger.warn(
            `Acked an unexpected webhook envelope (${envelope.topic}) during a command round-trip; webhook routing is not implemented yet.`,
          );
        }
        await this.acknowledge(message.leaseToken);
      }
    }

    throw new RelayCommandError(
      'RELAY_TIMEOUT',
      `Relay command ${command.kind} timed out after ${input.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`,
    );
  }

  private unwrap(envelope: CommandResultEnvelope): { response: unknown } {
    if (envelope.status === 'succeeded') {
      return { response: envelope.response };
    }
    const code = envelope.error?.code ?? envelope.status;
    const detail = envelope.error?.message ?? 'no error detail';
    throw new RelayCommandError(
      code,
      `Relay command failed (${code}): ${detail}`,
    );
  }

  private acknowledge(leaseToken: string): Promise<void> {
    const body: unknown = AckRequestSchema.parse({ leaseToken });
    return this.request('POST', '/relay/v1/messages/ack', body).then(() => undefined);
  }

  private async request(
    method: 'POST',
    path: string,
    body: unknown,
  ): Promise<RelayHttpResponse> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.machineToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const parsed: unknown = await res.json().catch(() => ({}));
    return { status: res.status, body: parsed };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
