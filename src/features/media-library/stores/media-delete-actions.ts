import type { MediaLibraryState, MediaLibraryActions } from '../types';
import { mediaLibraryService } from '../services/media-library-service';
import { proxyService } from '../services/proxy-service';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';

type Set = (
  partial:
    | Partial<MediaLibraryState>
    | ((state: MediaLibraryState & MediaLibraryActions) => Partial<MediaLibraryState>)
) => void;
type Get = () => MediaLibraryState & MediaLibraryActions;

function applyOptimisticDelete(set: Set, ids: string[]): void {
  set((state) => ({
    mediaItems: state.mediaItems.filter((item) => !ids.includes(item.id)),
    selectedMediaIds: state.selectedMediaIds.filter((selectedId) => !ids.includes(selectedId)),
  }));
}

function releaseDeletedMediaResources(ids: string[]): void {
  for (const id of ids) {
    blobUrlManager.release(id);
    proxyService.clearProxyKey(id);
  }
}

export function createDeleteActions(
  set: Set,
  get: Get
): Pick<MediaLibraryActions, 'deleteMedia' | 'deleteMediaBatch'> {
  const deleteMediaInternal = async (
    ids: string[],
    deleteOperation: () => Promise<void>,
    fallbackError: string
  ): Promise<void> => {
    set({ error: null });

    const previousItems = get().mediaItems;
    applyOptimisticDelete(set, ids);

    try {
      await deleteOperation();
      releaseDeletedMediaResources(ids);
    } catch (error) {
      set({
        mediaItems: previousItems,
        error: error instanceof Error ? error.message : fallbackError,
      });
      throw error;
    }
  };

  return {
    // Delete a media item (v3: project-scoped with reference counting)
    deleteMedia: async (id: string) => {
      const { currentProjectId } = get();
      await deleteMediaInternal(
        [id],
        () =>
          currentProjectId
            ? mediaLibraryService.deleteMediaFromProject(currentProjectId, id)
            : mediaLibraryService.deleteMedia(id),
        'Delete failed'
      );
    },

    // Delete multiple media items in batch (v3: project-scoped)
    deleteMediaBatch: async (ids: string[]) => {
      const { currentProjectId } = get();
      await deleteMediaInternal(
        ids,
        () =>
          currentProjectId
            ? mediaLibraryService.deleteMediaBatchFromProject(currentProjectId, ids)
            : mediaLibraryService.deleteMediaBatch(ids),
        'Batch delete failed'
      );
    },
  };
}
