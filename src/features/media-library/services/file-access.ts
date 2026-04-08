import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('MediaLibraryService');

/**
 * Error thrown when file handle permission is denied or file is missing.
 */
export class FileAccessError extends Error {
  constructor(
    message: string,
    public readonly type: 'permission_denied' | 'file_missing' | 'unknown'
  ) {
    super(message);
    this.name = 'FileAccessError';
  }
}

/**
 * Check and request permission for a file handle.
 * Returns true if permission is granted, false otherwise.
 */
export async function ensureFileHandlePermission(
  handle: FileSystemFileHandle
): Promise<boolean> {
  try {
    const permission = await handle.queryPermission({ mode: 'read' });
    if (permission === 'granted') {
      return true;
    }

    const newPermission = await handle.requestPermission({ mode: 'read' });
    return newPermission === 'granted';
  } catch (error) {
    logger.error('Failed to get file handle permission:', error);
    return false;
  }
}
