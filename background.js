import { buildThread } from './lib/thread-builder.js';
import { extractMessageText, renderMessage } from './lib/content-extractor.js';
import { buildChatMessages } from './lib/prompt.js';
import { createOllamaClient, OllamaError } from './lib/ollama-client.js';
import { threadKey, createSummaryManager } from './lib/summary-manager.js';
import { getSettings, pickDefaultModel } from './lib/settings.js';

const HOST_ORIGINS = ['http://localhost:11434/*', 'http://127.0.0.1:11434/*'];
const manager = createSummaryManager({ storage: messenger.storage.session });

messenger.runtime.onConnect.addListener((port) => {
  if (port.name !== 'summary') return;
  let attachedJob = null;
  const listener = (event) => {
    try {
      port.postMessage(event);
    } catch {
      // port already closed; detach happens in onDisconnect
    }
  };

  port.onMessage.addListener(async (msg) => {
    try {
      if (msg.command === 'summarize') {
        attachedJob = await handleSummarize(msg, listener, attachedJob);
      } else if (msg.command === 'cancel') {
        attachedJob?.abortController.abort();
      }
    } catch (err) {
      listener(toErrorEvent(err));
      attachedJob = null;
    }
  });

  port.onDisconnect.addListener(() => {
    if (attachedJob) manager.detach(attachedJob, listener);
  });
});

async function handleSummarize({ tabId, force }, listener, previousJob) {
  if (previousJob) manager.detach(previousJob, listener);

  const displayed = await messenger.messageDisplay.getDisplayedMessages(tabId);
  const header = (displayed.messages ?? displayed)[0];
  if (!header) {
    listener({ type: 'error', code: 'no_message', detail: 'no displayed message in this tab' });
    return null;
  }

  // Gecko MV3 may treat host permissions as user-grantable, not install-time.
  const granted = await messenger.permissions.contains({ origins: HOST_ORIGINS });
  if (!granted) {
    listener({ type: 'error', code: 'permission', detail: 'host permission not granted' });
    return null;
  }

  const settings = await getSettings(messenger.storage.local);
  listener({ type: 'phase', phase: 'building' });
  const { messages: thread, totalFound } = await buildThread(messenger, header, {
    maxMessages: settings.maxMessages,
  });
  const key = threadKey(thread.map((h) => h.headerMessageId));

  const existing = manager.getJob(key);
  if (existing) {
    manager.attach(existing, listener);
    return existing;
  }

  if (!force) {
    const cached = await manager.getCached(key);
    if (cached?.summary) {
      listener({ type: 'done', summary: cached.summary, meta: { ...cached.meta, cached: true } });
      return null;
    }
    if (cached?.status === 'interrupted') {
      listener({ type: 'interrupted', partial: cached.partial });
      return null;
    }
  }

  const job = manager.createJob(key);
  manager.attach(job, listener);
  runGeneration(job, thread, totalFound, settings); // errors handled inside
  return job;
}

async function runGeneration(job, thread, totalFound, settings) {
  let pendingSave = Promise.resolve();
  try {
    const client = createOllamaClient({ endpoint: settings.endpointUrl });
    let model = settings.model;
    if (!model) model = pickDefaultModel(await client.listModels());
    if (!model) throw new OllamaError('model_missing', 'no models installed');

    const rendered = [];
    for (let i = 0; i < thread.length; i++) {
      const h = thread[i];
      const full = await messenger.messages.getFull(h.id);
      rendered.push(renderMessage(i + 1, thread.length, h.author, formatDate(h.date), extractMessageText(full)));
    }
    const { messages, truncatedCount, usedCount } = buildChatMessages(rendered);

    manager.emit(job, { type: 'phase', phase: 'generating', messageCount: usedCount, totalFound });

    let lastSave = 0;
    const summary = await client.chatStream({
      model,
      messages,
      signal: job.abortController.signal,
      onChunk: (piece) => {
        manager.emit(job, { type: 'chunk', text: piece });
        // Throttled partial save so an event-page suspension loses at most ~2s.
        const now = Date.now();
        if (now - lastSave > 2000) {
          lastSave = now;
          pendingSave = manager
            .setCached(job.key, { status: 'interrupted', partial: job.partial, savedAt: new Date().toISOString() })
            .catch(() => {});
        }
      },
    });

    const meta = {
      usedCount,
      totalFound,
      truncatedCount,
      model,
      cached: false,
      generatedAt: new Date().toISOString(),
    };
    await pendingSave;
    await manager.setCached(job.key, { summary, meta, savedAt: meta.generatedAt });
    manager.emit(job, { type: 'done', summary, meta });
  } catch (err) {
    if (err instanceof OllamaError && err.code === 'cancelled') {
      await pendingSave;
      manager.clearCached(job.key).catch(() => {});
      manager.emit(job, { type: 'cancelled' });
    } else {
      await pendingSave;
      manager.clearCached(job.key).catch(() => {});
      manager.emit(job, toErrorEvent(err));
    }
  } finally {
    manager.finish(job);
  }
}

function toErrorEvent(err) {
  if (err instanceof OllamaError) return { type: 'error', code: err.code, detail: err.detail };
  return { type: 'error', code: 'unknown', detail: String(err) };
}

function formatDate(date) {
  const d = new Date(date);
  return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`;
}
