import { describe, expect, it } from 'vitest';
import { TRACK_SECTION_DIVIDER_HEIGHT, MAX_TRACK_HEIGHT, MIN_TRACK_HEIGHT } from '../constants';
import {
  getAnchoredSectionDividerOffset,
  clampTrackHeight,
  getMinimumTrackSectionSpacerHeight,
  getTrackSectionLayout,
  resizeTrackInList,
} from './track-resize';

function createTrack(id: string, kind: 'video' | 'audio', height: number) {
  return {
    id,
    name: id.toUpperCase(),
    kind,
    order: 0,
    height,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    items: [],
  };
}

describe('track-resize', () => {
  it('clamps resized track heights into the supported range', () => {
    expect(clampTrackHeight(MIN_TRACK_HEIGHT - 20)).toBe(MIN_TRACK_HEIGHT);
    expect(clampTrackHeight(MAX_TRACK_HEIGHT + 20)).toBe(MAX_TRACK_HEIGHT);
    expect(clampTrackHeight(96.6)).toBe(97);
  });

  it('updates only the requested track and preserves unchanged arrays', () => {
    const tracks = [
      createTrack('v1', 'video', 72),
      createTrack('a1', 'audio', 72),
    ];

    const resizedTracks = resizeTrackInList(tracks, 'a1', 118);

    expect(resizedTracks).not.toBe(tracks);
    expect(resizedTracks[0]).toBe(tracks[0]);
    expect(resizedTracks[1]).toMatchObject({ id: 'a1', height: 118 });
    expect(resizeTrackInList(tracks, 'missing', 118)).toBe(tracks);
    expect(resizeTrackInList(tracks, 'v1', 72)).toBe(tracks);
  });

  it('keeps the A/V spacer slightly taller than the title bar', () => {
    expect(getMinimumTrackSectionSpacerHeight(40)).toBe(48);
    expect(getMinimumTrackSectionSpacerHeight(44)).toBe(52);
  });

  it('keeps the A/V divider anchored while video tracks grow upward', () => {
    const viewportHeight = 420;
    const trackTitleBarHeight = 40;
    const tracks = [
      createTrack('v1', 'video', 100),
      createTrack('a1', 'audio', 100),
    ];
    const initialLayout = getTrackSectionLayout({
      viewportHeight,
      tracks,
      sectionDividerOffset: 0,
      trackTitleBarHeight,
    });
    const dividerAnchorY = initialLayout.topSectionSpacerHeight + initialLayout.videoSectionHeight;
    const resizedTracks = resizeTrackInList(tracks, 'v1', 140);
    const anchoredOffset = getAnchoredSectionDividerOffset({
      viewportHeight,
      tracks: resizedTracks,
      dividerAnchorY,
      trackTitleBarHeight,
    });
    const nextLayout = getTrackSectionLayout({
      viewportHeight,
      tracks: resizedTracks,
      sectionDividerOffset: anchoredOffset,
      trackTitleBarHeight,
    });

    expect(initialLayout.topSectionSpacerHeight + initialLayout.videoSectionHeight).toBe(dividerAnchorY);
    expect(nextLayout.topSectionSpacerHeight + nextLayout.videoSectionHeight).toBe(dividerAnchorY);
    expect(nextLayout.bottomSectionSpacerHeight).toBe(
      viewportHeight - dividerAnchorY - TRACK_SECTION_DIVIDER_HEIGHT - resizedTracks[1]!.height,
    );
  });
});
