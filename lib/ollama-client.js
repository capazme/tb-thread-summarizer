import { createNdjsonParser } from './ndjson.js';

export class OllamaError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'OllamaError';
    this.code = code;
    this.detail = detail;
  }
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

export function createOllamaClient({ endpoint, fetchFn = globalThis.fetch }) {
  const base = endpoint.replace(/\/+$/, '');

  async function request(path, init = {}) {
    let res;
    try {
      res = await fetchFn(`${base}${path}`, init);
    } catch (err) {
      if (err instanceof OllamaError) throw err;
      if (init.signal?.aborted) throw abortError(init.signal);
      throw new OllamaError('unreachable', String(err));
    }
    if (res.status === 403) throw new OllamaError('cors', await safeText(res));
    if (res.status === 404) throw new OllamaError('model_missing', await safeText(res));
    if (!res.ok) throw new OllamaError('unknown', `HTTP ${res.status}: ${await safeText(res)}`);
    return res;
  }

  function abortError(signal) {
    return signal.reason instanceof OllamaError
      ? signal.reason
      : new OllamaError('cancelled', 'generation cancelled');
  }

  async function listModels() {
    const res = await request('/api/tags');
    const data = await res.json();
    return (data.models ?? []).map((m) => m.name);
  }

  async function version() {
    const res = await request('/api/version');
    return (await res.json()).version;
  }

  async function chatStream({ model, messages, numCtx = 8192, signal, onChunk, timeoutMs = 120000 }) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new OllamaError('timeout', `no completion within ${timeoutMs} ms`)),
      timeoutMs
    );
    const onOuterAbort = () => controller.abort(abortError(signal));
    signal?.addEventListener('abort', onOuterAbort, { once: true });
    if (signal?.aborted) onOuterAbort();

    try {
      const res = await request('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: true, options: { num_ctx: numCtx } }),
        signal: controller.signal,
      });

      let text = '';
      const parser = createNdjsonParser((obj) => {
        if (obj.error) {
          throw new OllamaError(/not found/i.test(obj.error) ? 'model_missing' : 'unknown', obj.error);
        }
        const piece = obj.message?.content ?? '';
        if (piece) {
          text += piece;
          onChunk?.(piece);
        }
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.flush();
      return text;
    } catch (err) {
      if (err instanceof OllamaError) throw err;
      if (controller.signal.aborted) {
        throw controller.signal.reason instanceof OllamaError
          ? controller.signal.reason
          : new OllamaError('cancelled', 'generation cancelled');
      }
      throw new OllamaError('unknown', String(err));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  }

  return { listModels, version, chatStream };
}
