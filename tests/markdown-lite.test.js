import { describe, it, expect } from 'vitest';
import { escapeHtml, renderTriage } from '../lib/markdown-lite.js';

describe('escapeHtml', () => {
  it('escapes the five HTML special characters', () => {
    expect(escapeHtml(`<img src=x onerror="a&'b">`)).toBe(
      '&lt;img src=x onerror=&quot;a&amp;&#39;b&quot;&gt;'
    );
  });
});

describe('renderTriage', () => {
  it('renders headings, bullets and paragraphs', () => {
    const md = ['**Sintesi**', 'Breve riassunto.', '**Punti chiave**', '- primo punto', '- secondo **importante**'].join('\n');
    const html = renderTriage(md);
    expect(html).toContain('<h2>Sintesi</h2>');
    expect(html).toContain('<p>Breve riassunto.</p>');
    expect(html).toContain('<ul><li>primo punto</li><li>secondo <strong>importante</strong></li></ul>');
  });

  it('closes an open list before a following heading', () => {
    const html = renderTriage(['- a', '**Titolo**'].join('\n'));
    expect(html).toBe('<ul><li>a</li></ul><h2>Titolo</h2>');
  });

  it('never lets raw HTML from the model through', () => {
    const html = renderTriage('- <script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
