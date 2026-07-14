const SUBJECT_PREFIX_RE = /^(re|fw|fwd|r|i)\s*:\s*/i;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const QUERY_CAP = 500;

export function normalizeSubject(subject) {
  let s = (subject ?? '').trim();
  while (SUBJECT_PREFIX_RE.test(s)) s = s.replace(SUBJECT_PREFIX_RE, '').trim();
  return s.toLowerCase();
}

export function collectReferencedIds(headers) {
  const get = (name) => headers?.[name] ?? [];
  const raw = [...get('references'), ...get('in-reply-to')].join(' ');
  return [...new Set([...raw.matchAll(/<([^<>]+)>/g)].map((m) => m[1]))];
}

async function queryAll(messenger, queryInfo, cap = QUERY_CAP) {
  const out = [];
  let page = await messenger.messages.query(queryInfo);
  out.push(...(page.messages ?? []));
  while (page.id && out.length < cap) {
    page = await messenger.messages.continueList(page.id);
    out.push(...(page.messages ?? []));
  }
  return out;
}

export async function buildThread(messenger, currentHeader, { maxMessages = 30 } = {}) {
  const byMessageId = new Map();
  const add = (h) => {
    if (h?.headerMessageId && !byMessageId.has(h.headerMessageId)) {
      byMessageId.set(h.headerMessageId, h);
    }
  };
  add(currentHeader);

  // 1. Ancestors: walk References / In-Reply-To of the displayed message.
  const full = await messenger.messages.getFull(currentHeader.id);
  for (const mid of collectReferencedIds(full.headers)) {
    for (const h of await queryAll(messenger, { headerMessageId: mid })) add(h);
  }

  // 2. Descendants/siblings: same normalized subject, same account, +/-90 days.
  //    messages.query subject matching semantics vary; we post-filter with
  //    normalizeSubject equality so the heuristic can only add true matches.
  const core = normalizeSubject(currentHeader.subject);
  if (core) {
    const times = [...byMessageId.values()].map((h) => new Date(h.date).getTime());
    const candidates = await queryAll(messenger, {
      subject: core,
      ...(currentHeader.folder?.accountId ? { accountId: currentHeader.folder.accountId } : {}),
      fromDate: new Date(Math.min(...times) - NINETY_DAYS_MS),
      toDate: new Date(Math.max(...times) + NINETY_DAYS_MS),
    });
    for (const h of candidates) {
      if (normalizeSubject(h.subject) === core) add(h);
    }
  }

  const all = [...byMessageId.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
  let messages = all.slice(-maxMessages);
  if (!messages.some((h) => h.headerMessageId === currentHeader.headerMessageId)) {
    const otherCount = Math.max(0, maxMessages - 1);
    const others = all.filter((h) => h.headerMessageId !== currentHeader.headerMessageId);
    const keptOthers = otherCount > 0 ? others.slice(-otherCount) : [];
    messages = [...keptOthers, currentHeader].sort((a, b) => new Date(a.date) - new Date(b.date));
  }
  return { messages, totalFound: all.length };
}
