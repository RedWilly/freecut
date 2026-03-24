import { create } from 'zustand';
import type { DroppableMediaType } from '../utils/dropped-media';

export interface NewTrackZoneGhostPreview {
  left: number;
  width: number;
  label: string;
  type: 'composition' | DroppableMediaType | 'external-file' | 'text' | 'shape';
  targetZone: 'video' | 'audio';
}

interface NewTrackZonePreviewState {
  ghostPreviews: NewTrackZoneGhostPreview[];
  setGhostPreviews: (ghostPreviews: NewTrackZoneGhostPreview[]) => void;
  clearGhostPreviews: () => void;
}

export const useNewTrackZonePreviewStore = create<NewTrackZonePreviewState>((set) => ({
  ghostPreviews: [],
  setGhostPreviews: (ghostPreviews) => set({ ghostPreviews }),
  clearGhostPreviews: () => set({ ghostPreviews: [] }),
}));
