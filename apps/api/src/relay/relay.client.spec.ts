import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RelayCommandError, RelayClient } from './relay.client';

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown>;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function resultEnvelope(
  commandId: string,
  status: 'succeeded' | 'failed' | 'unsupported',
  response: unknown = null,
  error: { code: string; message: string } | null = null,
) {
  return {
    leaseToken: `lease-${commandId}`,
    expiresAt: new Date().toISOString(),
    envelope: {
      id: `result-${commandId}`,
      kind: 'command-result',
      protocolVersion: 'v1',
      platform: 'shopify',
      commandId,
      status,
      response,
      error,
      completedAt: new Date().toISOString(),
    },
  };
}

describe('RelayClient', () => {
  let calls: Call[];
  let responses: Array<(call: Call) => Response>;

  beforeEach(() => {
    process.env.RELAY_MACHINE_TOKEN = 'test-machine-token';
    delete process.env.RELAY_URL;
    calls = [];
    responses = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const call: Call = {
          method: String(init?.method),
          url: String(url),
          body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
        };
        calls.push(call);
        const handler = responses.shift();
        return handler ? handler(call) : jsonResponse({ messages: [] });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RELAY_MACHINE_TOKEN;
  });

  it('submits a command, pulls the result, and acks it', async () => {
    let submittedId = '';
    responses.push((call) => {
      submittedId = (call.body.command as { id: string }).id;
      expect(call.url).toBe('http://localhost:3100/relay/v1/commands');
      expect(call.body.command).toMatchObject({ kind: 'scopes.check', platform: 'shopify' });
      return jsonResponse({ commandId: submittedId }, 202);
    });
    responses.push(() =>
      jsonResponse({
        messages: [resultEnvelope(submittedId, 'succeeded', { shop: { name: 'Attaky Dev' } })],
      }),
    );
    responses.push((call) => {
      expect(call.url).toBe('http://localhost:3100/relay/v1/messages/ack');
      expect(call.body).toEqual({ leaseToken: `lease-${submittedId}` });
      return jsonResponse({ delivered: true });
    });

    const client = new RelayClient();
    const { response } = await client.runCommand(
      { kind: 'scopes.check', pollIntervalMs: 1 },
    );
    expect(response).toEqual({ shop: { name: 'Attaky Dev' } });
    expect(calls[0]?.body.command).toMatchObject({ kind: 'scopes.check', protocolVersion: 'v1' });
  });

  it('throws RelayCommandError with the platform error code on failed results', async () => {
    let submittedId = '';
    responses.push((call) => {
      submittedId = (call.body.command as { id: string }).id;
      return jsonResponse({ commandId: submittedId }, 202);
    });
    responses.push(() =>
      jsonResponse({
        messages: [
          resultEnvelope(submittedId, 'failed', null, {
            code: 'USER_ERRORS',
            message: 'Already fulfilled',
          }),
        ],
      }),
    );
    responses.push(() => jsonResponse({ delivered: true }));

    const client = new RelayClient();
    const error: RelayCommandError = await client
      .runCommand({ kind: 'fulfillment.create', pollIntervalMs: 1 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(RelayCommandError);
    expect(error.code).toBe('USER_ERRORS');
    expect(error.message).toContain('Already fulfilled');
  });

  it('times out when no result arrives', async () => {
    responses.push((call) =>
      jsonResponse({ commandId: (call.body.command as { id: string }).id }, 202),
    );
    // Subsequent pulls (the default handler) return empty message lists.

    const client = new RelayClient();
    const error: RelayCommandError = await client
      .runCommand({ kind: 'orders.fetch', pollIntervalMs: 1, timeoutMs: 20 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(RelayCommandError);
    expect(error.code).toBe('RELAY_TIMEOUT');
  });

  it('acks foreign envelopes without failing the round-trip', async () => {
    let submittedId = '';
    responses.push((call) => {
      submittedId = (call.body.command as { id: string }).id;
      return jsonResponse({ commandId: submittedId }, 202);
    });
    responses.push(() => jsonResponse({ messages: [resultEnvelope('other', 'succeeded', {})] }));
    responses.push(() => jsonResponse({ delivered: true }));
    responses.push(() =>
      jsonResponse({ messages: [resultEnvelope(submittedId, 'succeeded', { ok: 1 })] }),
    );
    responses.push(() => jsonResponse({ delivered: true }));

    const client = new RelayClient();
    const { response } = await client.runCommand({ kind: 'scopes.check', pollIntervalMs: 1 });
    expect(response).toEqual({ ok: 1 });
    const acked = calls.filter((c) => c.url.endsWith('/ack')).map((c) => c.body);
    expect(acked).toEqual([{ leaseToken: 'lease-other' }, { leaseToken: `lease-${submittedId}` }]);
  });

  it('serializes concurrent commands: one full round-trip at a time', async () => {
    const submittedIds: string[] = [];
    const submitHandler = (call: Call) => {
      const id = (call.body.command as { id: string }).id;
      submittedIds.push(id);
      return jsonResponse({ commandId: id }, 202);
    };
    const pullFor = (index: number) => () =>
      jsonResponse({
        messages: [
          resultEnvelope(submittedIds[index] ?? '', 'succeeded', { n: index + 1 }),
        ],
      });

    // Serialized execution must consume exactly: submit1, pull1, ack1, submit2, pull2, ack2.
    responses.push(submitHandler, pullFor(0), () => jsonResponse({ delivered: true }));
    responses.push(submitHandler, pullFor(1), () => jsonResponse({ delivered: true }));

    const client = new RelayClient();
    const [first, second] = await Promise.all([
      client.runCommand({ kind: 'scopes.check', pollIntervalMs: 1 }),
      client.runCommand({ kind: 'products.fetch', pollIntervalMs: 1 }),
    ]);
    expect(first.response).toEqual({ n: 1 });
    expect(second.response).toEqual({ n: 2 });
    expect(calls.map((c) => c.url.replace('http://localhost:3100/relay/v1/', ''))).toEqual([
      'commands',
      'messages/pull',
      'messages/ack',
      'commands',
      'messages/pull',
      'messages/ack',
    ]);
  });

  it('surfaces a 401 on submit as RELAY_UNAUTHORIZED', async () => {
    responses.push(() => jsonResponse({ error: 'machine credential required' }, 401));

    const client = new RelayClient();
    const error: RelayCommandError = await client
      .runCommand({ kind: 'scopes.check', pollIntervalMs: 1 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(RelayCommandError);
    expect(error.code).toBe('RELAY_UNAUTHORIZED');
  });
});
