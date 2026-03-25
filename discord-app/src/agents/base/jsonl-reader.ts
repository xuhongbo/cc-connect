export async function* readJsonLines(stream: NodeJS.ReadableStream): AsyncGenerator<unknown> {
  let buffer = '';

  for await (const chunk of stream) {
    buffer += chunk.toString('utf8');

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line === '') {
        continue;
      }
      yield JSON.parse(line);
    }
  }

  if (buffer.trim() !== '') {
    yield JSON.parse(buffer.trim());
  }
}
