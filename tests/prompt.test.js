import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, buildChatMessages } from '../lib/prompt.js';

describe('SYSTEM_PROMPT', () => {
  it('mandates Italian and the four triage sections', () => {
    expect(SYSTEM_PROMPT).toContain('italiano');
    for (const section of ['**Sintesi**', '**Punti chiave**', '**Azioni e scadenze**', '**In attesa di una tua risposta**']) {
      expect(SYSTEM_PROMPT).toContain(section);
    }
  });
});

describe('buildChatMessages', () => {
  it('builds system+user messages preserving chronological order', () => {
    const { messages, truncatedCount, usedCount } = buildChatMessages(['[1/2] A — d1\nprimo', '[2/2] B — d2\nsecondo']);
    expect(messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(messages[1].role).toBe('user');
    expect(messages[1].content.indexOf('primo')).toBeLessThan(messages[1].content.indexOf('secondo'));
    expect(truncatedCount).toBe(0);
    expect(usedCount).toBe(2);
  });

  it('drops oldest messages when over budget and prepends the truncation note', () => {
    const old = `[1/3] A — d1\n${'x'.repeat(50)}`;
    const mid = `[2/3] B — d2\n${'y'.repeat(50)}`;
    const last = `[3/3] C — d3\n${'z'.repeat(50)}`;
    const { messages, truncatedCount, usedCount } = buildChatMessages([old, mid, last], { charBudget: 140 });
    expect(truncatedCount).toBe(1);
    expect(usedCount).toBe(2);
    expect(messages[1].content).toContain('troncato');
    expect(messages[1].content).not.toContain('xxxx');
    expect(messages[1].content).toContain('zzzz');
  });

  it('always keeps the newest message even when it alone exceeds the budget', () => {
    const huge = `[1/1] A — d1\n${'w'.repeat(1000)}`;
    const { usedCount, truncatedCount } = buildChatMessages([huge], { charBudget: 10 });
    expect(usedCount).toBe(1);
    expect(truncatedCount).toBe(0);
  });
});
