import { renderTriage, escapeHtml } from '../lib/markdown-lite.js';

const HOST_ORIGINS = ['http://localhost:11434/*', 'http://127.0.0.1:11434/*'];
const OLLAMA_ORIGINS_CMD = 'launchctl setenv OLLAMA_ORIGINS "moz-extension://*"';

const root = document.getElementById('root');
const btnCancel = document.getElementById('btn-cancel');
const btnCopy = document.getElementById('btn-copy');
const btnRegen = document.getElementById('btn-regen');

let port = null;
let currentTabId = null;
let currentText = '';

document.getElementById('btn-options').addEventListener('click', () => messenger.runtime.openOptionsPage());
btnCancel.addEventListener('click', () => port?.postMessage({ command: 'cancel' }));
btnCopy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(currentText);
  btnCopy.textContent = 'Copiato ✓';
  setTimeout(() => (btnCopy.textContent = 'Copia'), 1500);
});
btnRegen.addEventListener('click', () => summarize(true));

init();

async function init() {
  const [tab] = await messenger.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;
  port = messenger.runtime.connect({ name: 'summary' });
  port.onMessage.addListener(onEvent);
  summarize(false);
}

function summarize(force) {
  currentText = '';
  setButtons({ cancel: false, copy: false, regen: false });
  renderPhase('Preparazione…');
  port.postMessage({ command: 'summarize', tabId: currentTabId, force });
}

function onEvent(event) {
  switch (event.type) {
    case 'phase':
      if (event.phase === 'building') renderPhase('Ricostruzione del thread…');
      else renderPhase(`Generazione… (${event.messageCount} messaggi)`);
      setButtons({ cancel: event.phase === 'generating', copy: false, regen: false });
      break;
    case 'chunk':
      currentText += event.text;
      root.innerHTML = renderTriage(currentText);
      root.scrollTop = root.scrollHeight;
      setButtons({ cancel: true, copy: false, regen: false });
      break;
    case 'done':
      currentText = event.summary;
      root.innerHTML = renderTriage(event.summary) + metaBar(event.meta);
      setButtons({ cancel: false, copy: true, regen: true });
      break;
    case 'interrupted':
      currentText = event.partial;
      root.innerHTML =
        '<p class="note">Generazione interrotta: riassunto parziale.</p>' + renderTriage(event.partial);
      setButtons({ cancel: false, copy: true, regen: true });
      break;
    case 'cancelled':
      root.innerHTML = '<p class="note">Generazione annullata.</p>';
      setButtons({ cancel: false, copy: false, regen: true });
      break;
    case 'error':
      renderError(event);
      break;
  }
}

function metaBar(meta) {
  const parts = [`${meta.usedCount} messaggi`, `modello ${meta.model}`];
  if (meta.truncatedCount > 0) parts.push(`thread troncato (esclusi ${meta.truncatedCount} più vecchi)`);
  if (meta.usedCount < meta.totalFound) parts.push(`trovati ${meta.totalFound} in totale`);
  if (meta.cached) parts.push('dalla cache');
  return `<div class="meta">${escapeHtml(parts.join(' · '))}</div>`;
}

function renderPhase(text) {
  root.innerHTML = `<div class="phase"><div class="spinner"></div><span>${escapeHtml(text)}</span></div>`;
}

function renderError({ code, detail }) {
  const views = {
    unreachable: {
      title: 'Ollama non è in esecuzione',
      body: '<p>Avvia Ollama e riprova.</p>',
      action: { label: 'Riprova', run: () => summarize(false) },
    },
    cors: {
      title: 'Ollama rifiuta le richieste dalle estensioni (403)',
      body: `<p>Esegui una volta nel Terminale, poi riavvia Ollama:</p><pre class="cmd">${escapeHtml(OLLAMA_ORIGINS_CMD)}</pre>`,
      action: { label: 'Riprova', run: () => summarize(false) },
    },
    model_missing: {
      title: 'Modello non disponibile',
      body: '<p>Scaricalo con <code>ollama pull</code> oppure scegli un altro modello nelle opzioni.</p>',
      action: { label: 'Apri opzioni', run: () => messenger.runtime.openOptionsPage() },
    },
    permission: {
      title: 'Serve il permesso per contattare Ollama',
      body: '<p>Concedi l’accesso a <code>localhost:11434</code> (resta tutto sul tuo computer).</p>',
      action: {
        label: 'Concedi accesso',
        run: async () => {
          const ok = await messenger.permissions.request({ origins: HOST_ORIGINS });
          if (ok) summarize(false);
        },
      },
    },
    timeout: {
      title: 'Tempo scaduto (120 s)',
      body: '<p>Il modello è troppo lento su questo thread: riprova o scegli un modello più piccolo.</p>',
      action: { label: 'Riprova', run: () => summarize(false) },
    },
    no_message: {
      title: 'Nessun messaggio visualizzato',
      body: '<p>Apri un messaggio e riprova.</p>',
      action: null,
    },
  };
  const view = views[code] ?? {
    title: 'Errore imprevisto',
    body: `<p class="detail">${escapeHtml(detail ?? '')}</p>`,
    action: { label: 'Riprova', run: () => summarize(false) },
  };
  root.innerHTML = `<div class="error"><strong>${escapeHtml(view.title)}</strong>${view.body}</div>`;
  if (view.action) {
    const btn = document.createElement('button');
    btn.className = 'action';
    btn.textContent = view.action.label;
    btn.addEventListener('click', view.action.run);
    root.querySelector('.error').appendChild(btn);
  }
  setButtons({ cancel: false, copy: false, regen: false });
}

function setButtons({ cancel, copy, regen }) {
  btnCancel.hidden = !cancel;
  btnCopy.hidden = !copy;
  btnRegen.hidden = !regen;
}
