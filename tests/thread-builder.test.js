import { describe, it, expect } from 'vitest';
import { normalizeSubject, collectReferencedIds, buildThread } from '../lib/thread-builder.js';

describe('normalizeSubject', () => {
  it('strips reply/forward prefixes iteratively and lowercases', () => {
    expect(normalizeSubject('Re: RE: Fwd: R: Contratto Alfa')).toBe('contratto alfa');
    expect(normalizeSubject('I: aggiornamento')).toBe('aggiornamento');
    expect(normalizeSubject('Relazione annuale')).toBe('relazione annuale'); // "Re" only as prefix with colon
  });
});

describe('collectReferencedIds', () => {
  it('collects and dedups ids from references and in-reply-to', () => {
    const headers = {
      references: ['<a@x.it> <b@x.it>'],
      'in-reply-to': ['<b@x.it>'],
    };
    expect(collectReferencedIds(headers)).toEqual(['a@x.it', 'b@x.it']);
  });
  it('returns empty array when headers are missing', () => {
    expect(collectReferencedIds({})).toEqual([]);
    expect(collectReferencedIds(undefined)).toEqual([]);
  });
});

// ---- fake messenger ----------------------------------------------------
function makeHeader(id, headerMessageId, subject, dateIso, accountId = 'acc1') {
  return { id, headerMessageId, subject, date: dateIso, author: `a${id}@x.it`, folder: { accountId } };
}

function makeFakeMessenger({ store, fullHeadersById }) {
  const queries = [];
  return {
    queries,
    messages: {
      async getFull(id) {
        return { headers: fullHeadersById[id] ?? {} };
      },
      async query(queryInfo) {
        queries.push(queryInfo);
        let out = store;
        if (queryInfo.headerMessageId) {
          out = out.filter((h) => h.headerMessageId === queryInfo.headerMessageId);
        }
        if (queryInfo.subject) {
          out = out.filter((h) => h.subject.toLowerCase().includes(queryInfo.subject.toLowerCase()));
        }
        if (queryInfo.accountId) {
          out = out.filter((h) => h.folder.accountId === queryInfo.accountId);
        }
        return { id: null, messages: out };
      },
      async continueList() {
        throw new Error('not used in tests');
      },
    },
  };
}

describe('buildThread', () => {
  const m1 = makeHeader(1, 'root@x.it', 'Contratto Alfa', '2026-07-01T10:00:00Z');
  const m2 = makeHeader(2, 'mid@x.it', 'Re: Contratto Alfa', '2026-07-02T10:00:00Z');
  const m3 = makeHeader(3, 'leaf@x.it', 'Re: Contratto Alfa', '2026-07-03T10:00:00Z');
  const unrelated = makeHeader(9, 'other@x.it', 'Parcella Beta', '2026-07-02T09:00:00Z');
  const store = [m1, m2, m3, unrelated];
  const fullHeadersById = {
    3: { references: ['<root@x.it> <mid@x.it>'], 'in-reply-to': ['<mid@x.it>'] },
    1: {},
  };

  it('resolves ancestors via references and sorts by date ascending', async () => {
    const messenger = makeFakeMessenger({ store, fullHeadersById });
    const { messages, totalFound } = await buildThread(messenger, m3, { maxMessages: 30 });
    expect(messages.map((h) => h.headerMessageId)).toEqual(['root@x.it', 'mid@x.it', 'leaf@x.it']);
    expect(totalFound).toBe(3);
  });

  it('finds descendants of an old message via the subject heuristic', async () => {
    const messenger = makeFakeMessenger({ store, fullHeadersById });
    const { messages } = await buildThread(messenger, m1, { maxMessages: 30 });
    expect(messages.map((h) => h.headerMessageId)).toEqual(['root@x.it', 'mid@x.it', 'leaf@x.it']);
  });

  it('never includes messages with a different normalized subject', async () => {
    const messenger = makeFakeMessenger({ store, fullHeadersById });
    const { messages } = await buildThread(messenger, m3, { maxMessages: 30 });
    expect(messages.some((h) => h.headerMessageId === 'other@x.it')).toBe(false);
  });

  it('caps to the most recent maxMessages', async () => {
    const messenger = makeFakeMessenger({ store, fullHeadersById });
    const { messages, totalFound } = await buildThread(messenger, m3, { maxMessages: 2 });
    expect(messages.map((h) => h.headerMessageId)).toEqual(['mid@x.it', 'leaf@x.it']);
    expect(totalFound).toBe(3);
  });

  it('returns at least the current message when nothing else is found', async () => {
    const lone = makeHeader(7, 'lone@x.it', 'Nota spese', '2026-07-05T10:00:00Z');
    const messenger = makeFakeMessenger({ store: [lone], fullHeadersById: { 7: {} } });
    const { messages, totalFound } = await buildThread(messenger, lone, {});
    expect(messages).toHaveLength(1);
    expect(totalFound).toBe(1);
  });

  it('always includes currentHeader even when capping would drop it', async () => {
    const messenger = makeFakeMessenger({ store, fullHeadersById });
    const { messages, totalFound } = await buildThread(messenger, m1, { maxMessages: 2 });
    expect(messages.map((h) => h.headerMessageId)).toEqual(['root@x.it', 'leaf@x.it']);
    expect(totalFound).toBe(3);
  });

  it('omits the accountId key entirely when currentHeader has no folder', async () => {
    const lone = {
      id: 8,
      headerMessageId: 'lone2@x.it',
      subject: 'Nota spese',
      date: '2026-07-05T10:00:00Z',
      author: 'a8@x.it',
    };
    const messenger = makeFakeMessenger({ store: [lone], fullHeadersById: { 8: {} } });
    const { messages } = await buildThread(messenger, lone, {});
    expect(messages).toHaveLength(1);
    const subjectQueries = messenger.queries.filter((q) => 'subject' in q);
    expect(subjectQueries.length).toBeGreaterThan(0);
    for (const q of subjectQueries) {
      expect(Object.hasOwn(q, 'accountId')).toBe(false);
    }
  });
});
