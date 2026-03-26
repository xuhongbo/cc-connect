import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { createAgentSessionBinding } from '../src/domain/session-binding.js';
import { createConversationThread } from '../src/domain/thread.js';
import { createProject } from '../src/domain/project.js';
import { createAgentsManager } from '../src/agents/manager.js';
import { createSessionManager } from '../src/sessions/session-manager.js';
import { NoopSessionRuntime } from '../src/agents/base/cli-agent.js';
import { handleThreadMessage } from '../src/discord/message-handler.js';
import { createRuntimeEventPump } from '../src/app/runtime-event-pump.js';
import type { CreateAgentSessionInput } from '../src/agents/types.js';

describe('message handler runtime context', () => {
  it('passes only the minimal runtime context and explicit workDir', async () => {
    const sessions = createSessionManager();
    const eventPump = createRuntimeEventPump(sessions);
    const threadsRepo = {
      async getByThreadId() {
        return thread;
      },
    };
    const bindingsRepo = {
      async getByThreadRecordId() {
        return binding;
      },
    };
    const agents = createAgentsManager();
    let capturedInput: CreateAgentSessionInput | null = null;
    agents.register({
      kind: 'claude',
      runtimeKind: 'persistent',
      async createSession(input) {
        capturedInput = input;
        return new NoopSessionRuntime();
      },
      async detectAvailability() {
        return true;
      },
    });

    const workDir = mkdtempSync(join(tmpdir(), 'message-handler-context-'));
    const project = createProject({
      id: 'proj-context',
      name: 'Context Project',
      guildId: 'guild',
      channelId: 'channel',
      channelType: 'guildText',
      baseWorkDir: '/tmp/base',
      defaultAgent: 'claude',
      defaultModel: 'context-model',
      defaultMode: 'fast',
    });
    const thread = createConversationThread({
      id: 'thread-ctx',
      projectId: project.id,
      guildId: project.guildId,
      parentChannelId: 'parent',
      threadId: 'thread-id',
      threadTitle: 'Context thread',
      threadPrefix: '[Claude]',
      agentKind: project.defaultAgent,
      ownerUserId: 'user',
      createdFrom: 'command',
    });
    const binding = createAgentSessionBinding({
      id: 'binding-ctx',
      threadRecordId: thread.id,
      agentKind: thread.agentKind,
      runtimeKind: 'persistent',
      resumeStrategy: 'stdio',
      cliBin: 'claude',
    });

    try {
      await handleThreadMessage({
        threadId: thread.threadId,
        text: 'Hello',
        project,
        workDir,
      threadsRepo,
      bindingsRepo,
      agents,
      sessions,
      eventPump,
      });

      expect(capturedInput).not.toBeNull();
      const runtimeInput = capturedInput!;
      expect(runtimeInput.workDir).toBe(workDir);
      expect(runtimeInput.binding).toBe(binding);
      expect(runtimeInput.projectContext).toEqual({
        projectId: project.id,
        defaultAgent: project.defaultAgent,
        defaultModel: project.defaultModel,
        defaultMode: project.defaultMode,
      });
      expect(Object.keys(runtimeInput.projectContext)).toEqual([
        'projectId',
        'defaultAgent',
        'defaultModel',
        'defaultMode',
      ]);
      expect(runtimeInput.projectContext).not.toHaveProperty('baseWorkDir');
      expect(runtimeInput.projectContext).not.toHaveProperty('currentWorkDir');
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
