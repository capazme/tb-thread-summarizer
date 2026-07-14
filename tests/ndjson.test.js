import { describe, it, expect, vi } from 'vitest';
import { createNdjsonParser } from '../lib/ndjson.js';

describe('createNdjsonParser', () => {
  it('parses complete lines in a single chunk', () => {
    const seen = [];
    const p = createNdjsonParser((o) => seen.push(o));
    p.push('{"a":1}\n{"b":2}\n');
    expect(seen).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('reassembles objects split across chunks', () => {
    const seen = [];
    const p = createNdjsonParser((o) => seen.push(o));
    p.push('{"message":{"con');
    p.push('tent":"ciao"}}\n');
    expect(seen).toEqual([{ message: { content: 'ciao' } }]);
  });

  it('skips empty lines', () => {
    const seen = [];
    const p = createNdjsonParser((o) => seen.push(o));
    p.push('\n\n{"a":1}\n\n');
    expect(seen).toEqual([{ a: 1 }]);
  });

  it('flush parses a trailing line without newline, and is safe on empty buffer', () => {
    const seen = [];
    const p = createNdjsonParser((o) => seen.push(o));
    p.push('{"done":true}');
    p.flush();
    p.flush();
    expect(seen).toEqual([{ done: true }]);
  });

  it('throws on malformed JSON lines', () => {
    const p = createNdjsonParser(vi.fn());
    expect(() => p.push('not json\n')).toThrow();
  });
});
