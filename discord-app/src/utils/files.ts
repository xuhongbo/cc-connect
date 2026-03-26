import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

export interface InputFile {
  fileName: string;
  data: Uint8Array;
}

export interface InputImage {
  fileName: string;
  data: Uint8Array;
  mimeType: string;
}

export interface StagedAttachmentRef {
  name: string;
  originalName: string;
  path: string;
}

export interface StageAttachmentsInput {
  workDir: string;
  files: InputFile[];
  images: InputImage[];
  timestamp?: number;
  batchId?: string;
}

export interface StagedAttachments {
  files: StagedAttachmentRef[];
  images: Array<StagedAttachmentRef & { mimeType: string }>;
}

const ATTACHMENTS_DIR = '.cc-connect/attachments';
const IMAGES_DIR = '.cc-connect/images';
const INVALID_CHARS = /[^A-Za-z0-9._-]+/g;

function sanitizeBaseName(candidate: string): string {
  const cleaned = candidate.replace(INVALID_CHARS, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'attachment';
}

function formatWithTimestamp(fileName: string, timestamp: number, batchId: string, seqLabel: string): string {
  const extension = extname(fileName);
  const base = sanitizeBaseName(basename(fileName, extension));
  return `${base}__${timestamp}_${batchId}_${seqLabel}${extension}`;
}

export async function stageAttachments(input: StageAttachmentsInput): Promise<StagedAttachments> {
  const attachmentsDir = join(input.workDir, ATTACHMENTS_DIR);
  const imagesDir = join(input.workDir, IMAGES_DIR);

  await mkdir(attachmentsDir, { recursive: true });
  await mkdir(imagesDir, { recursive: true });

  const timestamp = input.timestamp ?? Date.now();
  const batchId = input.batchId ?? randomUUID().slice(0, 8);
  let seq = 1;

  const files: StagedAttachmentRef[] = [];
  for (const file of input.files) {
    const seqLabel = seq.toString().padStart(2, '0');
    seq += 1;
    const name = formatWithTimestamp(file.fileName, timestamp, batchId, seqLabel);
    const path = join(attachmentsDir, name);
    await writeFile(path, file.data);
    files.push({ name, originalName: file.fileName, path });
  }

  const images: Array<StagedAttachmentRef & { mimeType: string }> = [];
  for (const image of input.images) {
    const seqLabel = seq.toString().padStart(2, '0');
    seq += 1;
    const name = formatWithTimestamp(image.fileName, timestamp, batchId, seqLabel);
    const path = join(imagesDir, name);
    await writeFile(path, image.data);
    images.push({ name, originalName: image.fileName, path, mimeType: image.mimeType });
  }

  return { files, images };
}
