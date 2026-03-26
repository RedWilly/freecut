import type { TimelineTrack } from '@/types/timeline';
import {
  MAX_TRACK_HEIGHT,
  MIN_TRACK_HEIGHT,
  TRACK_SECTION_DIVIDER_HEIGHT,
} from '../constants';
import { getTrackKind } from './classic-tracks';

interface TrackSectionLayoutParams {
  viewportHeight: number;
  tracks: TimelineTrack[];
  sectionDividerOffset: number;
  trackTitleBarHeight: number;
}

interface TrackSectionLayout {
  hasTrackSections: boolean;
  availableSpacerHeight: number;
  maximumSectionDividerOffset: number;
  clampedSectionDividerOffset: number;
  topSectionSpacerHeight: number;
  bottomSectionSpacerHeight: number;
  videoSectionHeight: number;
}

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

export function getTrackSectionLayout({
  viewportHeight,
  tracks,
  sectionDividerOffset,
  trackTitleBarHeight,
}: TrackSectionLayoutParams): TrackSectionLayout {
  const videoSectionHeight = tracks.reduce(
    (sum, track) => sum + (getTrackKind(track) === 'video' ? track.height : 0),
    0,
  );
  const audioSectionHeight = tracks.reduce(
    (sum, track) => sum + (getTrackKind(track) === 'audio' ? track.height : 0),
    0,
  );
  const hasTrackSections = videoSectionHeight > 0 && audioSectionHeight > 0;
  const tracksContentHeight = tracks.reduce((sum, track) => sum + track.height, 0)
    + (hasTrackSections ? TRACK_SECTION_DIVIDER_HEIGHT : 0);
  const availableSpacerHeight = Math.max(0, viewportHeight - tracksContentHeight);
  const minimumSectionZoneHeight = hasTrackSections
    ? Math.min(
      getMinimumTrackSectionSpacerHeight(trackTitleBarHeight),
      Math.floor(availableSpacerHeight / 2),
    )
    : 0;
  const maximumSectionDividerOffset = Math.max(
    0,
    (availableSpacerHeight / 2) - minimumSectionZoneHeight,
  );
  const clampedSectionDividerOffset = Math.max(
    -maximumSectionDividerOffset,
    Math.min(maximumSectionDividerOffset, sectionDividerOffset),
  );

  return {
    hasTrackSections,
    availableSpacerHeight,
    maximumSectionDividerOffset,
    clampedSectionDividerOffset,
    topSectionSpacerHeight: hasTrackSections
      ? Math.max(0, Math.round((availableSpacerHeight / 2) + clampedSectionDividerOffset))
      : 0,
    bottomSectionSpacerHeight: hasTrackSections
      ? Math.max(0, Math.round((availableSpacerHeight / 2) - clampedSectionDividerOffset))
      : 0,
    videoSectionHeight,
  };
}

export function getAnchoredSectionDividerOffset(
  params: Omit<TrackSectionLayoutParams, 'sectionDividerOffset'> & {
    dividerAnchorY: number;
  }
): number {
  const layout = getTrackSectionLayout({
    ...params,
    sectionDividerOffset: 0,
  });

  if (!layout.hasTrackSections) {
    return 0;
  }

  const topSpacerHeight = params.dividerAnchorY - layout.videoSectionHeight;
  const requestedOffset = topSpacerHeight - (layout.availableSpacerHeight / 2);

  return Math.max(
    -layout.maximumSectionDividerOffset,
    Math.min(layout.maximumSectionDividerOffset, requestedOffset),
  );
}
