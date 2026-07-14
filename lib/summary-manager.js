const CACHE_PREFIX = 'summary:';

export function threadKey(headerMessageIds) {
  const joined = [...headerMessageIds].sort().join('\n');
  let h = 5381;
  for (let i = 0; i < joined.length; i++) {
    h = ((h << 5) + h + joined.charCodeAt(i)) >>> 0; // djb2, unsigned
  }
  return h.toString(16).padStart(8, '0');
}

export function createSummaryManager({ storage }) {
  const jobs = new Map();

  async function getCached(key) {
    const storageKey = CACHE_PREFIX + key;
    const found = await storage.get(storageKey);
    return found[storageKey] ?? null;
  }

  async function setCached(key, record) {
    await storage.set({ [CACHE_PREFIX + key]: record });
  }

  async function clearCached(key) {
    await storage.remove(CACHE_PREFIX + key);
  }

  function getJob(key) {
    return jobs.get(key) ?? null;
  }

  function createJob(key) {
    const job = {
      key,
      status: 'building',
      partial: '',
      messageCount: 0,
      totalFound: 0,
      listeners: new Set(),
      abortController: new AbortController(),
    };
    jobs.set(key, job);
    return job;
  }

  function replayEvents(job) {
    if (job.status === 'building') return [{ type: 'phase', phase: 'building' }];
    if (job.status === 'generating') {
      const events = [{ type: 'phase', phase: 'generating', messageCount: job.messageCount, totalFound: job.totalFound }];
      if (job.partial) events.push({ type: 'chunk', text: job.partial });
      return events;
    }
    return [];
  }

  function attach(job, listener) {
    job.listeners.add(listener);
    for (const event of replayEvents(job)) listener(event);
  }

  function detach(job, listener) {
    job.listeners.delete(listener);
  }

  function emit(job, event) {
    if (event.type === 'phase') {
      job.status = event.phase;
      if (event.phase === 'generating') {
        job.messageCount = event.messageCount;
        job.totalFound = event.totalFound;
      }
    } else if (event.type === 'chunk') {
      job.partial += event.text;
    } else if (event.type === 'done') {
      job.status = 'done';
    } else if (event.type === 'error') {
      job.status = 'error';
    } else if (event.type === 'cancelled') {
      job.status = 'cancelled';
    }
    for (const listener of job.listeners) listener(event);
  }

  function finish(job) {
    jobs.delete(job.key);
  }

  return { getCached, setCached, clearCached, getJob, createJob, attach, detach, emit, finish };
}
