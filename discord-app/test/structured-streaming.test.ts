import { describe, expect, it, vi } from 'vitest';

import { createStreamingPreview } from '../src/app/streaming.js';
import { createTextDeltaEvent, createTextFinalEvent, createThinkingEvent, createToolUseEvent, createRuntimeErrorEvent, createTurnCompletedEvent } from '../src/agents/events.js';

async function applyEvents(preview: ReturnType<typeof createStreamingPreview>, events: any[]) {
  await preview.start('处理中');
  let finalText = '';
  for (const event of events) {
    switch (event.kind) {
      case 'text_delta':
        finalText += event.content;
        await preview.push(event.content);
        break;
      case 'text_final':
        finalText = event.content;
        await preview.finish(finalText);
        break;
      case 'thinking':
        await preview.push(`\n[thinking] ${event.content}`);
        break;
      case 'tool_use':
        await preview.push(`\n[tool] ${event.toolName}`);
        break;
      case 'runtime_error':
        await preview.fail(event.message);
        break;
      case 'turn_completed':
        await preview.finish(finalText);
        break;
    }
  }
}

describe('structured streaming', () => {
  it('renders deltas, thinking, tool use and final completion into one preview', async () => {
    const create = vi.fn(async (content: string) => ({ messageId: 'm1', content }));
    const update = vi.fn(async () => undefined);
    const preview = createStreamingPreview({ create, update, throttleMs: 0 });

    await applyEvents(preview, [
      createThinkingEvent({ content: '思考中' }),
      createToolUseEvent({ toolName: 'Bash' }),
      createTextDeltaEvent({ content: '第一段' }),
      createTextDeltaEvent({ content: '第二段' }),
      createTurnCompletedEvent({}),
    ]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalled();
    const updateCalls = update.mock.calls as unknown as Array<[string, string]>;
    const lastUpdateCall = updateCalls[updateCalls.length - 1];
    expect(lastUpdateCall?.[1]).toContain('第一段第二段');
  });

  it('renders error state on runtime_error and respects text_final override', async () => {
    const create = vi.fn(async (content: string) => ({ messageId: 'm1', content }));
    const update = vi.fn(async () => undefined);
    const preview = createStreamingPreview({ create, update, throttleMs: 0 });

    await applyEvents(preview, [
      createTextDeltaEvent({ content: 'partial' }),
      createTextFinalEvent({ content: 'final' }),
      createRuntimeErrorEvent({ message: 'boom', runtimeFailureKind: 'runtime_broken' }),
    ]);

    const updateCalls = update.mock.calls as unknown as Array<[string, string]>;
    const lastUpdateCall = updateCalls[updateCalls.length - 1];
    expect(lastUpdateCall?.[1]).toBe('boom');
  });
});
