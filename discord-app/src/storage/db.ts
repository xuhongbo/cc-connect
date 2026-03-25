import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface OpenStorageOptions {
  dataDir: string;
}

export interface StorageHandle {
  readonly kind: 'storage';
  readonly dataDir: string;
}

export async function openStorage(options: OpenStorageOptions): Promise<StorageHandle> {
  await mkdir(options.dataDir, { recursive: true });
  return {
    kind: 'storage',
    dataDir: options.dataDir,
  };
}

export async function loadCollection<T>(storage: StorageHandle, fileName: string): Promise<T[]> {
  const path = join(storage.dataDir, fileName);
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function saveCollection<T>(storage: StorageHandle, fileName: string, items: T[]): Promise<void> {
  const path = join(storage.dataDir, fileName);
  await writeFile(path, JSON.stringify(items, null, 2), 'utf-8');
}
