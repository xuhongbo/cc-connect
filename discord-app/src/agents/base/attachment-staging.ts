import type { AttachmentRef } from '../../domain/last-turn.js';
import type { RuntimeFileRef, RuntimeImageRef } from '../types.js';
import { stageAttachments, type InputFile, type InputImage, type StageAttachmentsInput } from '../../utils/files.js';

export interface StagedRuntimeAttachments {
  files: RuntimeFileRef[];
  images: RuntimeImageRef[];
  attachmentRefs: AttachmentRef[];
}

export interface StageAttachmentsForRuntimeInput extends StageAttachmentsInput {}

export async function stageAttachmentsForRuntime(
  input: StageAttachmentsForRuntimeInput,
): Promise<StagedRuntimeAttachments> {
  const staged = await stageAttachments(input);

  const files: RuntimeFileRef[] = staged.files.map(({ name, originalName, path }) => ({ name, originalName, path }));
  const images: RuntimeImageRef[] = staged.images.map(({ name, originalName, path, mimeType }) => ({
    name,
    originalName,
    path,
    mimeType,
  }));
  const attachmentRefs: AttachmentRef[] = [
    ...files.map((file) => ({ kind: 'file' as const, path: file.path, name: file.name, originalName: file.originalName })),
    ...images.map((image) => ({
      kind: 'image' as const,
      path: image.path,
      name: image.name,
      originalName: image.originalName,
      mimeType: image.mimeType,
    })),
  ];

  return { files, images, attachmentRefs };
}

export type {
  InputFile,
  InputImage,
  StageAttachmentsInput,
};
