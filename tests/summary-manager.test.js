import { describe, it, expect, vi } from 'vitest';
import { threadKey, createSummaryManager } from '../lib/summary-manager.js';

function fakeStorage() {
  const data = new Map();
  return {
    async get(key) {
      return data.has(key) ? { [key]: data.get(key) } : {};
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    },
    async remove(key) {
      data.delete(key);
    },
  };
}

describe('threadKey', () => {
  it('is order-independent and stable', () => {
    expect(threadKey(['a@x.it', 'b@x.it'])).toBe(threadKey(['b@x.it', 'a@x.it']));
    expect(threadKey(['a@x.it'])).not.toBe(threadKey(['b@x.it']));
    expect(threadKey(['a@x.it', 'b@x.it'])).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('createSummaryManager', () => {
  it('caches and clears records under the summary: prefix', async () => {
    const m = createSummaryManager({ storage: fakeStorage() });
    expect(await m.getCached('k1')).toBeNull();
    await m.setCached('k1', { summary: 'S', meta: { model: 'gemma3' }, savedAt: 't' });
    expect((await m.getCached('k1')).summary).toBe('S');
    await m.clearCached('k1');
    expect(await m.getCached('k1')).toBeNull();
  });

  it('tracks job state from emitted events', () => {
    const m = createSummaryManager({ storage: fakeStorage() });
    const job = m.createJob('k1');
    expect(m.getJob('k1')).toBe(job);
    m.emit(job, { type: 'phase', phase: 'generating', messageCount: 5, totalFound: 7 });
    m.emit(job, { type: 'chunk', text: 'Sin' });
    m.emit(job, { type: 'chunk', text: 'tesi' });
    expect(job.status).toBe('generating');
    expect(job.partial).toBe('Sintesi');
    expect(job.messageCount).toBe(5);
    m.finish(job);
    expect(m.getJob('k1')).toBeNull();
  });

  it('replays current state to late-attaching listeners', () => {
    const m = createSummaryManager({ storage: fakeStorage() });
    const job = m.createJob('k1');
    m.emit(job, { type: 'phase', phase: 'generating', messageCount: 3, totalFound: 3 });
    m.emit(job, { type: 'chunk', text: 'parzia' });
    const seen = [];
    m.attach(job, (e) => seen.push(e));
    expect(seen).toEqual([
      { type: 'phase', phase: 'generating', messageCount: 3, totalFound: 3 },
      { type: 'chunk', text: 'parzia' },
    ]);
  });

  it('fans out events to all listeners and stops after detach', () => {
    const m = createSummaryManager({ storage: fakeStorage() });
    const job = m.createJob('k1');
    const a = vi.fn();
    const b = vi.fn();
    m.attach(job, a);
    m.attach(job, b);
    m.emit(job, { type: 'chunk', text: 'x' });
    m.detach(job, b);
    m.emit(job, { type: 'chunk', text: 'y' });
    // a sees: replay of phase:building (on attach) + chunk x + chunk y
    expect(a).toHaveBeenCalledTimes(3);
    expect(b.mock.calls.filter(([e]) => e.type === 'chunk')).toHaveLength(1);
  });
});
