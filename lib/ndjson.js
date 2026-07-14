export function createNdjsonParser(onObject) {
  let buffer = '';

  function processLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    onObject(JSON.parse(trimmed));
  }

  return {
    push(text) {
      buffer += text;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        processLine(line);
      }
    },
    flush() {
      const rest = buffer;
      buffer = '';
      processLine(rest);
    },
  };
}
