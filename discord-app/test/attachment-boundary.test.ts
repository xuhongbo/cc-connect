import { mkdtempSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { createProject } from '../src/domain/project.js';
import { createConversationThread } from '../src/domain/thread.js';
import { createAgentSessionBinding } from '../src/domain/session-binding.js';
import { createAgentsManager } from '../src/agents/manager.js';
import { createSessionManager } from '../src/sessions/session-manager.js';
import { createRuntimeEventPump } from '../src/app/runtime-event-pump.js';
import { handleThreadMessage } from '../src/discord/message-handler.js';
import type { AgentRuntimeInput, AgentSessionRuntime } from '../src/agents/types.js';
import type { InputFile, InputImage } from '../src/agents/base/attachment-staging.js';
import { stageAttachments } from '../src/utils/files.js';

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('共享附件落盘', () => {
  it('在 .cc-connect 目录使用净化后文件名、附带时间戳与两位序号', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'discord-app-attachment-'));
    cleanupDirs.push(workDir);

    const staged = await stageAttachments({
      workDir,
      files: [
        { fileName: 'Report Final v2?.txt', data: Buffer.from('hello') },
        { fileName: '???', data: Buffer.from('oops') },
      ],
      images: [
        { fileName: 'Screens/Hot🔥.png', data: Buffer.from([1, 2]), mimeType: 'image/png' },
      ],
      timestamp: 1_234_567_890,
      batchId: 'batch001',
    });

    expect(staged.files).toHaveLength(2);
    expect(staged.images).toHaveLength(1);

    expect(staged.files[0].name).toBe('Report_Final_v2__1234567890_batch001_01.txt');
    expect(staged.files[0].originalName).toBe('Report Final v2?.txt');
    expect(staged.files[1].name).toBe('attachment__1234567890_batch001_02');
    expect(staged.files[1].originalName).toBe('???');
    expect(staged.images[0].name).toBe('Hot__1234567890_batch001_03.png');
    expect(staged.images[0].originalName).toBe('Screens/Hot🔥.png');
    expect(staged.images[0].mimeType).toBe('image/png');

    expect(staged.files[0].path).toContain(join('.cc-connect', 'attachments'));
    expect(staged.images[0].path).toContain(join('.cc-connect', 'images'));

    expect(await readFile(staged.files[0].path, 'utf-8')).toBe('hello');
    expect(await readFile(staged.files[1].path, 'utf-8')).toBe('oops');
    expect(await readFile(staged.images[0].path)).toEqual(Buffer.from([1, 2]));
  });

  it('同毫秒同名附件在不同批次下不会覆盖', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'discord-app-attachment-'));
    cleanupDirs.push(workDir);

    const first = await stageAttachments({
      workDir,
      files: [{ fileName: 'report.txt', data: Buffer.from('one') }],
      images: [],
      timestamp: 1_234_567_890,
      batchId: 'batch001',
    });
    const second = await stageAttachments({
      workDir,
      files: [{ fileName: 'report.txt', data: Buffer.from('two') }],
      images: [],
      timestamp: 1_234_567_890,
      batchId: 'batch002',
    });

    expect(first.files[0].path).not.toBe(second.files[0].path);
    expect(await readFile(first.files[0].path, 'utf-8')).toBe('one');
    expect(await readFile(second.files[0].path, 'utf-8')).toBe('two');
  });
});

describe('message handler 附件边界', () => {
  it('只收集原始附件并把已落盘路径交给运行时', async () => {
    const sessions = createSessionManager();
    const eventPump = createRuntimeEventPump(sessions);
    const agents = createAgentsManager();
    const project = createProject({
      id: 'proj-attach',
      name: 'Attachment Project',
      guildId: 'guild',
      channelId: 'channel',
      channelType: 'guildText',
      baseWorkDir: '',
      defaultAgent: 'claude',
      defaultModel: 'model',
      defaultMode: 'fast',
    });
    const thread = createConversationThread({
      id: 'thread-attach',
      projectId: project.id,
      guildId: project.guildId,
      parentChannelId: 'parent',
      threadId: 'thread-attach-id',
      threadTitle: 'Attachments',
      threadPrefix: '[Claude]',
      agentKind: project.defaultAgent,
      ownerUserId: 'owner',
      createdFrom: 'command',
    });
    const binding = createAgentSessionBinding({
      id: 'binding-attach',
      threadRecordId: thread.id,
      agentKind: thread.agentKind,
      runtimeKind: 'persistent',
      resumeStrategy: 'stdio',
      cliBin: 'claude',
    });

    const threadsRepo = { async getByThreadId() { return thread; } };
    const bindingsRepo = { async getByThreadRecordId() { return binding; } };

    let capturedInput: AgentRuntimeInput | null = null;
    const runtime: AgentSessionRuntime = {
      async send(input) {
        capturedInput = input;
      },
      async cancel() {},
      async close() {},
      isBusy() {
        return false;
      },
      isAlive() {
        return true;
      },
      getSessionId() {
        return 'runtime-attachments';
      },
      async respondPermission() {},
      getPendingPermission() {
        return null;
      },
      async *events() {
        return;
      },
    };

    agents.register({
      kind: 'claude',
      runtimeKind: 'persistent',
      async createSession() {
        return runtime;
      },
      async detectAvailability() {
        return true;
      },
    });

    const workDir = mkdtempSync(join(tmpdir(), 'discord-app-attachment-'));
    cleanupDirs.push(workDir);

    const files: InputFile[] = [{ fileName: 'Notes & Plan.md', data: Buffer.from('notes') }];
    const images: InputImage[] = [
      { fileName: 'Diagram☄️.png', data: Buffer.from([4, 5, 6]), mimeType: 'image/png' },
    ];

    await handleThreadMessage({
      threadId: thread.threadId,
      text: 'attachments',
      project,
      workDir,
      files,
      images,
      threadsRepo,
      bindingsRepo,
      agents,
      sessions,
      eventPump,
    });

    expect(capturedInput).not.toBeNull();
    const runtimeInput = capturedInput!;
    expect(runtimeInput.files).toBeDefined();
    expect(runtimeInput.images).toBeDefined();

    const [fileRef] = runtimeInput.files!;
    const [imageRef] = runtimeInput.images!;
    expect(fileRef.path).toContain(join('.cc-connect', 'attachments'));
    expect(imageRef.path).toContain(join('.cc-connect', 'images'));
    expect(fileRef.originalName).toBe('Notes & Plan.md');
    expect(imageRef.originalName).toBe('Diagram☄️.png');
    expect(imageRef.path).not.toMatch(/^data:/);
    expect('data' in fileRef).toBe(false);
    expect('data' in imageRef).toBe(false);
    expect(await readFile(fileRef.path, 'utf-8')).toBe('notes');
    expect(await readFile(imageRef.path)).toEqual(images[0].data);
    expect(imageRef.mimeType).toBe('image/png');
    const snapshot = sessions.getLastTurnSnapshot(thread.id);
    expect(snapshot?.attachmentRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ originalName: 'Notes & Plan.md' }),
      expect.objectContaining({ originalName: 'Diagram☄️.png' }),
    ]));
  });
});
