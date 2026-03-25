import { mkdtempSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { stageAttachments } from '../src/utils/files.js';

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('attachment staging', () => {
  it('writes files under the project attachment directory', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'discord-app-files-'));
    cleanupDirs.push(workDir);

    const staged = await stageAttachments({
      workDir,
      files: [{ fileName: 'report.txt', data: Buffer.from('hello') }],
      images: [],
      timestamp: 1_234_567_890,
      batchId: 'batch001',
    });

    expect(staged.files).toHaveLength(1);
    expect(staged.files[0].originalName).toBe('report.txt');
    expect(staged.files[0].path).toMatch(/\.cc-connect\/attachments\/report__1234567890_batch001_01\.txt$/);
    expect(await readFile(staged.files[0].path, 'utf-8')).toBe('hello');
  });

  it('writes images under the project image directory', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'discord-app-files-'));
    cleanupDirs.push(workDir);

    const staged = await stageAttachments({
      workDir,
      files: [],
      images: [{ fileName: 'screen.png', data: Buffer.from([1, 2, 3]), mimeType: 'image/png' }],
      timestamp: 1_234_567_890,
      batchId: 'batch001',
    });

    expect(staged.images).toHaveLength(1);
    expect(staged.images[0].originalName).toBe('screen.png');
    expect(staged.images[0].path).toMatch(/\.cc-connect\/images\/screen__1234567890_batch001_01\.png$/);
    expect((await readFile(staged.images[0].path)).length).toBe(3);
  });
});
