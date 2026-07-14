import { describe, it, expect } from 'vitest';
import { extractMessageText, stripHtml, cleanBody, renderMessage } from '../lib/content-extractor.js';

describe('extractMessageText', () => {
  it('prefers the text/plain part over html', () => {
    const part = {
      contentType: 'multipart/alternative',
      parts: [
        { contentType: 'text/plain', body: 'testo semplice' },
        { contentType: 'text/html', body: '<p>testo <b>html</b></p>' },
      ],
    };
    expect(extractMessageText(part)).toBe('testo semplice');
  });

  it('falls back to stripped html when no plain part exists', () => {
    const part = {
      contentType: 'multipart/mixed',
      parts: [{ contentType: 'text/html', body: '<p>solo &amp; html</p>' }],
    };
    expect(extractMessageText(part)).toBe('solo & html');
  });

  it('returns empty string when no textual part exists', () => {
    expect(extractMessageText({ contentType: 'application/pdf' })).toBe('');
  });
});

describe('stripHtml', () => {
  it('drops tags, style blocks and decodes basic entities', () => {
    const html = '<style>p{color:red}</style><p>Ciao<br>mondo &egrave;&nbsp;&lt;ok&gt;</p>';
    const out = stripHtml(html);
    expect(out).toContain('Ciao\nmondo');
    expect(out).toContain('<ok>');
    expect(out).not.toContain('color:red');
  });
});

describe('cleanBody', () => {
  it('removes quoted lines and signature block, collapses blank runs', () => {
    const raw = [
      'Buongiorno,',
      '',
      '',
      '',
      'confermo la scadenza del 15 luglio.',
      '> Il giorno 10 luglio Mario ha scritto:',
      '> vecchio testo citato',
      '-- ',
      'Avv. Gianluca Puzio',
    ].join('\r\n');
    expect(cleanBody(raw)).toBe('Buongiorno,\n\nconfermo la scadenza del 15 luglio.');
  });
});

describe('renderMessage', () => {
  it('formats the per-message block', () => {
    expect(renderMessage(2, 5, 'Mario Rossi <m@x.it>', '2026-07-10', 'corpo')).toBe(
      '[2/5] Mario Rossi <m@x.it> — 2026-07-10\ncorpo'
    );
  });
});
