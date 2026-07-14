import { describe, it, expect, vi } from 'vitest';
import { createOllamaClient, OllamaError } from '../lib/ollama-client.js';

function streamFrom(lines) {
  return new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const line of lines) controller.enqueue(enc.encode(line));
      controller.close();
    },
  });
}

function res(status, { body, json, text } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    json: async () => json,
    text: async () => text ?? '',
  };
}

describe('chatStream', () => {
  const messages = [{ role: 'user', content: 'ciao' }];

  it('concatenates streamed content and reports chunks', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      res(200, {
        body: streamFrom([
          '{"message":{"content":"Sin"},"done":false}\n',
          '{"message":{"content":"tesi"},"done":false}\n{"message":{"content":"."},"done":true}\n',
        ]),
      })
    );
    const client = createOllamaClient({ endpoint: 'http://localhost:11434', fetchFn });
    const pieces = [];
    const text = await client.chatStream({ model: 'gemma3', messages, onChunk: (p) => pieces.push(p) });
    expect(text).toBe('Sintesi.');
    expect(pieces).toEqual(['Sin', 'tesi', '.']);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'gemma3', stream: true, options: { num_ctx: 8192 } });
  });

  it('maps network failure to unreachable', async () => {
    const client = createOllamaClient({ endpoint: 'http://localhost:11434', fetchFn: vi.fn().mockRejectedValue(new TypeError('fetch failed')) });
    await expect(client.chatStream({ model: 'm', messages })).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('maps HTTP 403 to cors', async () => {
    const client = createOllamaClient({ endpoint: 'http://localhost:11434', fetchFn: vi.fn().mockResolvedValue(res(403, { text: 'forbidden' })) });
    await expect(client.chatStream({ model: 'm', messages })).rejects.toMatchObject({ code: 'cors' });
  });

  it('maps error lines mentioning "not found" to model_missing', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(200, { body: streamFrom(['{"error":"model \'x\' not found"}\n']) }));
    const client = createOllamaClient({ endpoint: 'http://localhost:11434', fetchFn });
    await expect(client.chatStream({ model: 'x', messages })).rejects.toMatchObject({ code: 'model_missing' });
  });

  it('maps external abort to cancelled', async () => {
    const fetchFn = vi.fn().mockImplementation((url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new DOMException('Aborted', 'AbortError')));
      })
    );
    const client = createOllamaClient({ endpoint: 'http://localhost:11434', fetchFn });
    const ac = new AbortController();
    const promise = client.chatStream({ model: 'm', messages, signal: ac.signal });
    ac.abort();
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('maps timeout to timeout code', async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn().mockImplementation((url, init) =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new DOMException('Aborted', 'AbortError')));
        })
      );
      const client = createOllamaClient({ endpoint: 'http://localhost:11434', fetchFn });
      const promise = client.chatStream({ model: 'm', messages, timeoutMs: 1000 });
      const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' });
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('listModels / version', () => {
  it('lists installed model names', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(200, { json: { models: [{ name: 'gemma3:latest' }, { name: 'velvet:2b' }] } }));
    const client = createOllamaClient({ endpoint: 'http://localhost:11434/', fetchFn });
    expect(await client.listModels()).toEqual(['gemma3:latest', 'velvet:2b']);
    expect(fetchFn.mock.calls[0][0]).toBe('http://localhost:11434/api/tags');
  });

  it('returns the server version', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(200, { json: { version: '0.31.2' } }));
    const client = createOllamaClient({ endpoint: 'http://localhost:11434', fetchFn });
    expect(await client.version()).toBe('0.31.2');
  });
});
