export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function inlineBold(s) {
  return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

export function renderTriage(markdown) {
  const lines = escapeHtml(markdown).split('\n');
  let html = '';
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += '</ul>';
      inList = false;
    }
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const heading = t.match(/^\*\*(.+?)\*\*:?$/);
    if (heading) {
      closeList();
      html += `<h2>${heading[1]}</h2>`;
      continue;
    }
    if (/^[-*•]\s+/.test(t)) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${inlineBold(t.replace(/^[-*•]\s+/, ''))}</li>`;
      continue;
    }
    closeList();
    html += `<p>${inlineBold(t)}</p>`;
  }
  closeList();
  return html;
}
