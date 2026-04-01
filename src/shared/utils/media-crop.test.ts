import { describe, expect, it } from 'vitest';
import {
  calculateContainedRect,
  calculateMediaCropLayout,
  cropPixelsToRatio,
  cropRatioToPixels,
  hasMediaCrop,
  normalizeCropSettings,
  resolveCropSettings,
} from './media-crop';

describe('media-crop', () => {
  it('normalizes empty crop objects to undefined', () => {
    expect(normalizeCropSettings({ left: 0, right: 0, top: 0, bottom: 0 })).toBeUndefined();
  });

  it('clamps opposing edges so they never fully collapse the visible area', () => {
    const resolved = resolveCropSettings({ left: 0.8, right: 0.5 });
    expect(resolved.left).toBeCloseTo(0.6147692308);
    expect(resolved.right).toBeCloseTo(0.3842307692);
    expect(resolved.top).toBe(0);
    expect(resolved.bottom).toBe(0);
  });

  it('calculates a contained media rect inside the item box', () => {
    expect(calculateContainedRect(1920, 1080, 400, 400)).toEqual({
      x: 0,
      y: 87.5,
      width: 400,
      height: 225,
    });
  });

  it('derives a cropped viewport from the contained media rect', () => {
    const layout = calculateMediaCropLayout(1920, 1080, 400, 400, {
      left: 0.1,
      right: 0.05,
      top: 0.2,
      bottom: 0,
    });

    expect(layout.mediaRect).toEqual({
      x: 0,
      y: 87.5,
      width: 400,
      height: 225,
    });
    expect(layout.viewportRect).toEqual({
      x: 40,
      y: 132.5,
      width: 340,
      height: 180,
    });
  });

  it('round-trips crop ratios through source pixels', () => {
    expect(cropRatioToPixels(0.125, 1920)).toBe(240);
    expect(cropPixelsToRatio(240, 1920)).toBeCloseTo(0.125);
  });

  it('detects when any crop edge is active', () => {
    expect(hasMediaCrop()).toBe(false);
    expect(hasMediaCrop({ bottom: 0.01 })).toBe(true);
  });
});
