export const SYSTEM_PROMPT = [
  'Sei un assistente che riassume thread di email per un avvocato italiano.',
  'Rispondi ESCLUSIVAMENTE in italiano, qualunque sia la lingua del thread.',
  'Usa ESATTAMENTE questo formato markdown, senza aggiungere altre sezioni:',
  '**Sintesi**',
  '(2-3 frasi che riassumono la conversazione)',
  '**Punti chiave**',
  '(elenco puntato dei fatti salienti)',
  '**Azioni e scadenze**',
  '(elenco puntato; riporta le date esattamente come compaiono nel thread; se non ce ne sono scrivi "Nessuna")',
  '**In attesa di una tua risposta**',
  "(elenco di chi attende una risposta e su cosa; ometti l'intera sezione se nessuno attende)",
  'Non inventare fatti non presenti nel thread.',
].join('\n');

export function buildChatMessages(renderedMessages, { charBudget = 28000 } = {}) {
  const kept = [];
  let used = 0;
  for (let i = renderedMessages.length - 1; i >= 0; i--) {
    const len = renderedMessages[i].length + 2;
    if (kept.length > 0 && used + len > charBudget) break;
    kept.unshift(renderedMessages[i]);
    used += len;
  }
  const truncatedCount = renderedMessages.length - kept.length;
  const note =
    truncatedCount > 0
      ? `(Nota: thread troncato per limiti di contesto, considerati solo gli ultimi ${kept.length} messaggi su ${renderedMessages.length}.)\n\n`
      : '';
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${note}Riassumi questo thread di ${kept.length} messaggi:\n\n${kept.join('\n\n')}` },
    ],
    truncatedCount,
    usedCount: kept.length,
  };
}
