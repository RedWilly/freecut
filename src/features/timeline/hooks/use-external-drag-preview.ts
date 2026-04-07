import { useCallback, useRef } from 'react';
import {
  buildExternalPreviewSignature,
  resolveExternalDragPreviewEntries,
  type ExternalDragPreviewEntry,
} from '../utils/drag-drop-preview';

interface UseExternalDragPreviewOptions<TGhostPreview> {
  buildGhostPreviews: (
    entries: ExternalDragPreviewEntry[],
    dropFrame: number
  ) => TGhostPreview[];
  setGhostPreviews: (ghostPreviews: TGhostPreview[]) => void;
  onError?: (error: unknown) => void;
}

export function useExternalDragPreview<TGhostPreview>({
  buildGhostPreviews,
  setGhostPreviews,
  onError,
}: UseExternalDragPreviewOptions<TGhostPreview>) {
  const externalPreviewItemsRef = useRef<ExternalDragPreviewEntry[] | null>(null);
  const externalPreviewSignatureRef = useRef<string | null>(null);
  const externalPreviewPromiseRef = useRef<Promise<void> | null>(null);
  const externalPreviewTokenRef = useRef(0);
  const lastDragFrameRef = useRef(0);

  const clearExternalPreviewSession = useCallback(() => {
    externalPreviewItemsRef.current = null;
    externalPreviewSignatureRef.current = null;
    externalPreviewPromiseRef.current = null;
    externalPreviewTokenRef.current += 1;
  }, []);

  const primeExternalPreviewEntries = useCallback((dataTransfer: DataTransfer) => {
    const signature = buildExternalPreviewSignature(dataTransfer);

    if (externalPreviewSignatureRef.current === signature && externalPreviewItemsRef.current) {
      return;
    }

    if (externalPreviewSignatureRef.current === signature && externalPreviewPromiseRef.current) {
      return;
    }

    clearExternalPreviewSession();
    externalPreviewSignatureRef.current = signature;
    const token = externalPreviewTokenRef.current;

    const previewPromise = (async () => {
      const previewEntries = await resolveExternalDragPreviewEntries(dataTransfer);
      if (!previewEntries || token !== externalPreviewTokenRef.current) {
        return;
      }

      externalPreviewItemsRef.current = previewEntries;
      externalPreviewPromiseRef.current = null;

      if (previewEntries.length > 0) {
        setGhostPreviews(buildGhostPreviews(previewEntries, lastDragFrameRef.current));
      }
    })().catch((error) => {
      if (token === externalPreviewTokenRef.current) {
        externalPreviewPromiseRef.current = null;
        onError?.(error);
      }
    });

    externalPreviewPromiseRef.current = previewPromise;
  }, [buildGhostPreviews, clearExternalPreviewSession, onError, setGhostPreviews]);

  return {
    clearExternalPreviewSession,
    externalPreviewItemsRef,
    lastDragFrameRef,
    primeExternalPreviewEntries,
  };
}
