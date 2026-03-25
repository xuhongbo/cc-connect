import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
  path: string;
}

export interface StageAttachmentsInput {
  workDir: string;
  files: InputFile[];
  images: InputImage[];
}

export interface StagedAttachments {
  files: StagedAttachmentRef[];
  images: Array<StagedAttachmentRef & { mimeType: string }>;
}

export async function stageAttachments(input: StageAttachmentsInput): Promise<StagedAttachments> {
  const filesDir = join(input.workDir, '.discord-agent', 'files');
  const imagesDir = join(input.workDir, '.discord-agent', 'images');

  await mkdir(filesDir, { recursive: true });
  await mkdir(imagesDir, { recursive: true });

  const files: StagedAttachmentRef[] = [];
  for (const file of input.files) {
    const path = join(filesDir, file.fileName);
    await writeFile(path, file.data);
    files.push({ name: file.fileName, path });
  }

  const images: Array<StagedAttachmentRef & { mimeType: string }> = [];
  for (const image of input.images) {
    const path = join(imagesDir, image.fileName);
    await writeFile(path, image.data);
    images.push({ name: image.fileName, path, mimeType: image.mimeType });
  }

  return { files, images };
}
