import type { MediaMetadata } from '@/types/storage';
import { createLogger } from '@/shared/logging/logger';
import {
  associateMediaWithProject,
  createMedia as createMediaDB,
  deleteMedia as deleteMediaDB,
  deleteThumbnailsByMediaId,
  saveThumbnail as saveThumbnailDB,
} from '@/infrastructure/storage/indexeddb';
import { opfsService } from './opfs-service';

const logger = createLogger('MediaLibraryService');

function getImageDimensionsFromBitmap(bitmap: ImageBitmap): { width: number; height: number } {
  return {
    width: bitmap.width,
    height: bitmap.height,
  };
}

export function getThumbnailDimensions(
  width: number,
  height: number,
  maxSize: number
): { width: number; height: number } {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));

  if (safeWidth >= safeHeight) {
    return {
      width: maxSize,
      height: Math.max(1, Math.floor((maxSize * safeHeight) / safeWidth)),
    };
  }

  return {
    width: Math.max(1, Math.floor((maxSize * safeWidth) / safeHeight)),
    height: maxSize,
  };
}

export async function getGeneratedImageDimensions(
  file: File
): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    const dimensions = getImageDimensionsFromBitmap(bitmap);
    bitmap.close();
    return dimensions;
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load generated image'));
    };

    image.src = url;
  });
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }

  return new Response(blob).arrayBuffer();
}

export function buildGeneratedMediaOpfsPath(mediaId: string): string {
  return `content/${mediaId.slice(0, 2)}/${mediaId.slice(2, 4)}/${mediaId}/data`;
}

interface PersistGeneratedMediaOptions {
  file: File;
  projectId: string;
  mediaMetadata: MediaMetadata;
  thumbnailBlob?: Blob;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
}

export async function persistGeneratedMediaAsset({
  file,
  projectId,
  mediaMetadata,
  thumbnailBlob,
  thumbnailWidth,
  thumbnailHeight,
}: PersistGeneratedMediaOptions): Promise<MediaMetadata> {
  let metadataCreated = false;
  let thumbnailSaved = false;

  try {
    if (!mediaMetadata.opfsPath) {
      throw new Error('Generated media is missing an OPFS path.');
    }

    await opfsService.saveFile(mediaMetadata.opfsPath, await blobToArrayBuffer(file));

    if (thumbnailBlob && thumbnailWidth && thumbnailHeight) {
      const thumbnailId = crypto.randomUUID();

      await saveThumbnailDB({
        id: thumbnailId,
        mediaId: mediaMetadata.id,
        blob: thumbnailBlob,
        timestamp: 0,
        width: thumbnailWidth,
        height: thumbnailHeight,
      });

      mediaMetadata.thumbnailId = thumbnailId;
      thumbnailSaved = true;
    }

    await createMediaDB(mediaMetadata);
    metadataCreated = true;
    await associateMediaWithProject(projectId, mediaMetadata.id);
    return mediaMetadata;
  } catch (error) {
    if (metadataCreated) {
      try {
        await deleteMediaDB(mediaMetadata.id);
      } catch (cleanupError) {
        logger.warn(`Failed to roll back generated media metadata ${mediaMetadata.id}:`, cleanupError);
      }
    }

    if (thumbnailSaved) {
      try {
        await deleteThumbnailsByMediaId(mediaMetadata.id);
      } catch (cleanupError) {
        logger.warn(`Failed to roll back generated thumbnail ${mediaMetadata.id}:`, cleanupError);
      }
    }

    if (mediaMetadata.opfsPath) {
      try {
        await opfsService.deleteFile(mediaMetadata.opfsPath);
      } catch (cleanupError) {
        logger.warn(`Failed to roll back generated OPFS file ${mediaMetadata.opfsPath}:`, cleanupError);
      }
    }

    throw error;
  }
}
