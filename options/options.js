import { getSettings } from '../lib/settings.js';
import { createOllamaClient } from '../lib/ollama-client.js';

const $ = (id) => document.getElementById(id);

async function client() {
  return createOllamaClient({ endpoint: $('endpoint').value.trim() || 'http://localhost:11434' });
}

async function refreshModels(selected) {
  const select = $('model');
  for (const opt of [...select.options].slice(1)) opt.remove();
  try {
    const models = await (await client()).listModels();
    for (const name of models) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
  } catch {
    // endpoint down: keep the automatic option only
  }
  if (selected && ![...select.options].some((o) => o.value === selected)) {
    const opt = document.createElement('option');
    opt.value = selected;
    opt.textContent = `${selected} (non verificato)`;
    select.appendChild(opt);
  }
  select.value = selected;
}

async function load() {
  const settings = await getSettings(messenger.storage.local);
  $('endpoint').value = settings.endpointUrl;
  $('max-messages').value = settings.maxMessages;
  await refreshModels(settings.model);
}

$('btn-refresh').addEventListener('click', () => refreshModels($('model').value));

$('btn-test').addEventListener('click', async () => {
  const status = $('status');
  status.textContent = '…';
  status.className = '';
  try {
    const v = await (await client()).version();
    status.textContent = `OK — Ollama ${v}`;
    status.className = 'ok';
  } catch (err) {
    status.textContent = err.code === 'cors' ? 'Rifiutato (403): vedi Setup Ollama qui sotto' : 'Non raggiungibile';
    status.className = 'err';
  }
});

$('btn-save').addEventListener('click', async () => {
  const settings = {
    endpointUrl: $('endpoint').value.trim().replace(/\/+$/, '') || 'http://localhost:11434',
    model: $('model').value,
    maxMessages: Math.min(100, Math.max(2, Number($('max-messages').value) || 30)),
  };
  await messenger.storage.local.set({ settings });
  $('save-status').textContent = 'Salvato ✓';
  $('save-status').className = 'ok';
  setTimeout(() => ($('save-status').textContent = ''), 1500);
});

load();
