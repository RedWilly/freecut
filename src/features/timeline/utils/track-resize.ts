import type { TimelineTrack } from '@/types/timeline';
import { MAX_TRACK_HEIGHT, MIN_TRACK_HEIGHT } from '../constants';

export function clampTrackHeight(height: number): number {
  return Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, Math.round(height)));
}

export function resizeTrackInList(
  tracks: TimelineTrack[],
  trackId: string,
  nextHeight: number
): TimelineTrack[] {
  const clampedHeight = clampTrackHeight(nextHeight);
  let didChange = false;

  const nextTracks = tracks.map((track) => {
    if (track.id !== trackId || track.height === clampedHeight) {
      return track;
    }

    didChange = true;
    return {
      ...track,
      height: clampedHeight,
    };
  });

  return didChange ? nextTracks : tracks;
}

export function getMinimumTrackSectionSpacerHeight(trackTitleBarHeight: number): number {
  return Math.max(0, Math.round(trackTitleBarHeight) + 8);
}
