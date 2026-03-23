import { describe, expect, it } from 'vitest';
import {
  resolveSmartBodyIntent,
  resolveSmartTrimIntent,
  smartTrimIntentToHandle,
  smartTrimIntentToMode,
} from './smart-trim-zones';

describe('smart-trim-zones', () => {
  it('returns roll intent on the inner cut band when a neighbor exists', () => {
    expect(resolveSmartTrimIntent({
      x: 3,
      width: 120,
      hasLeftNeighbor: true,
      hasRightNeighbor: false,
    })).toBe('roll-start');

    expect(resolveSmartTrimIntent({
      x: 117,
      width: 120,
      hasLeftNeighbor: false,
      hasRightNeighbor: true,
    })).toBe('roll-end');
  });

  it('falls back to ripple on outer edge bands', () => {
    expect(resolveSmartTrimIntent({
      x: 9,
      width: 120,
      hasLeftNeighbor: true,
      hasRightNeighbor: false,
    })).toBe('ripple-start');

    expect(resolveSmartTrimIntent({
      x: 111,
      width: 120,
      hasLeftNeighbor: false,
      hasRightNeighbor: true,
    })).toBe('ripple-end');
  });

  it('uses ripple when no adjacent neighbor exists for rolling', () => {
    expect(resolveSmartTrimIntent({
      x: 2,
      width: 120,
      hasLeftNeighbor: false,
      hasRightNeighbor: false,
    })).toBe('ripple-start');

    expect(resolveSmartTrimIntent({
      x: 118,
      width: 120,
      hasLeftNeighbor: false,
      hasRightNeighbor: false,
    })).toBe('ripple-end');
  });

  it('returns null away from smart edge zones', () => {
    expect(resolveSmartTrimIntent({
      x: 40,
      width: 120,
      hasLeftNeighbor: true,
      hasRightNeighbor: true,
    })).toBeNull();
  });

  it('keeps edge intent sticky until the pointer clearly leaves the zone', () => {
    expect(resolveSmartTrimIntent({
      x: 11,
      width: 120,
      hasLeftNeighbor: true,
      hasRightNeighbor: false,
      currentIntent: 'ripple-start',
    })).toBe('ripple-start');

    expect(resolveSmartTrimIntent({
      x: 7,
      width: 120,
      hasLeftNeighbor: true,
      hasRightNeighbor: false,
      currentIntent: 'roll-start',
    })).toBe('roll-start');
  });

  it('maps intent to handle and mode', () => {
    expect(smartTrimIntentToHandle('roll-start')).toBe('start');
    expect(smartTrimIntentToHandle('ripple-end')).toBe('end');
    expect(smartTrimIntentToMode('roll-start')).toBe('rolling');
    expect(smartTrimIntentToMode('ripple-end')).toBe('ripple');
    expect(smartTrimIntentToMode(null)).toBeNull();
  });

  it('maps top label row to slide and lower body to slip', () => {
    expect(resolveSmartBodyIntent({
      y: 8,
      height: 40,
      labelRowHeight: 14,
      isMediaItem: true,
    })).toBe('slide-body');

    expect(resolveSmartBodyIntent({
      y: 24,
      height: 40,
      labelRowHeight: 14,
      isMediaItem: true,
    })).toBe('slip-body');
  });

  it('returns null for non-media or invalid body geometry', () => {
    expect(resolveSmartBodyIntent({
      y: 10,
      height: 40,
      labelRowHeight: 14,
      isMediaItem: false,
    })).toBeNull();

    expect(resolveSmartBodyIntent({
      y: 10,
      height: 10,
      labelRowHeight: 10,
      isMediaItem: true,
    })).toBeNull();
  });

  it('keeps body intent sticky around the row boundary', () => {
    expect(resolveSmartBodyIntent({
      y: 19,
      height: 40,
      labelRowHeight: 14,
      isMediaItem: true,
      currentIntent: 'slide-body',
    })).toBe('slide-body');

    expect(resolveSmartBodyIntent({
      y: 9,
      height: 40,
      labelRowHeight: 14,
      isMediaItem: true,
      currentIntent: 'slip-body',
    })).toBe('slip-body');
  });
});
