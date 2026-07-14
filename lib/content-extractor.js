function findPart(part, contentType) {
  if (!part) return null;
  if ((part.contentType ?? '').toLowerCase().startsWith(contentType)) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, contentType);
    if (found) return found;
  }
  return null;
}

export function extractMessageText(fullPart) {
  const plain = findPart(fullPart, 'text/plain');
  if (plain?.body) return cleanBody(plain.body);
  const html = findPart(fullPart, 'text/html');
  if (html?.body) return cleanBody(stripHtml(html.body));
  return '';
}

export function stripHtml(html) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&egrave;/gi, 'è')
    .replace(/&agrave;/gi, 'à')
    .replace(/&ugrave;/gi, 'ù')
    .replace(/&ograve;/gi, 'ò')
    .replace(/&igrave;/gi, 'ì')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function cleanBody(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const kept = [];
  for (const line of lines) {
    if (line.trimStart().startsWith('>')) continue; // quoted reply
    if (line.trim() === '--') break; // signature delimiter ("-- " per RFC 3676)
    kept.push(line);
  }
  return kept
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function renderMessage(index, total, author, dateIso, text) {
  return `[${index}/${total}] ${author} — ${dateIso}\n${text}`;
}
