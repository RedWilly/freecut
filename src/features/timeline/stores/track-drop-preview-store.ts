import { create } from 'zustand';
import type { DroppableMediaType } from '../utils/dropped-media';

export interface TrackDropGhostPreview {
  left: number;
  width: number;
  label: string;
  type: 'composition' | DroppableMediaType | 'external-file' | 'text' | 'shape';
  targetTrackId: string;
}

interface TrackDropPreviewState {
  ghostPreviews: TrackDropGhostPreview[];
  setGhostPreviews: (ghostPreviews: TrackDropGhostPreview[]) => void;
  clearGhostPreviews: () => void;
}

export const useTrackDropPreviewStore = create<TrackDropPreviewState>((set) => ({
  ghostPreviews: [],
  setGhostPreviews: (ghostPreviews) => set({ ghostPreviews }),
  clearGhostPreviews: () => set({ ghostPreviews: [] }),
}));
