import { describe, expect, it } from 'vitest';
import { MAX_TRACK_HEIGHT, MIN_TRACK_HEIGHT } from '../constants';
import {
  clampTrackHeight,
  getMinimumTrackSectionSpacerHeight,
  resizeTrackInList,
} from './track-resize';

describe('track-resize', () => {
  it('clamps resized track heights into the supported range', () => {
    expect(clampTrackHeight(MIN_TRACK_HEIGHT - 20)).toBe(MIN_TRACK_HEIGHT);
    expect(clampTrackHeight(MAX_TRACK_HEIGHT + 20)).toBe(MAX_TRACK_HEIGHT);
    expect(clampTrackHeight(96.6)).toBe(97);
  });

  it('updates only the requested track and preserves unchanged arrays', () => {
    const tracks = [
      { id: 'v1', name: 'V1', kind: 'video' as const, order: 0, height: 72, locked: false, visible: true, muted: false, solo: false, items: [] },
      { id: 'a1', name: 'A1', kind: 'audio' as const, order: 1, height: 72, locked: false, visible: true, muted: false, solo: false, items: [] },
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
});
