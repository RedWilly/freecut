import type { CropSettings } from '@/types/transform';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResolvedCropSettings {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface MediaCropLayout {
  mediaRect: Rect;
  viewportRect: Rect;
  cropPixels: ResolvedCropSettings;
  crop: ResolvedCropSettings;
}

const MAX_EDGE_SUM = 0.999;

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function clampAxisPair(start: number, end: number): [number, number] {
  const total = start + end;
  if (total <= MAX_EDGE_SUM) {
    return [start, end];
  }

  if (total <= 0) {
    return [0, 0];
  }

  const scale = MAX_EDGE_SUM / total;
  return [start * scale, end * scale];
}

export function resolveCropSettings(crop?: CropSettings): ResolvedCropSettings {
  const [left, right] = clampAxisPair(
    clamp01(crop?.left ?? 0),
    clamp01(crop?.right ?? 0),
  );
  const [top, bottom] = clampAxisPair(
    clamp01(crop?.top ?? 0),
    clamp01(crop?.bottom ?? 0),
  );

  return { left, right, top, bottom };
}

export function normalizeCropSettings(crop?: CropSettings): CropSettings | undefined {
  if (!crop) return undefined;

  const normalized = resolveCropSettings(crop);
  if (
    normalized.left === 0
    && normalized.right === 0
    && normalized.top === 0
    && normalized.bottom === 0
  ) {
    return undefined;
  }

  return normalized;
}

export function hasMediaCrop(crop?: CropSettings): boolean {
  const normalized = resolveCropSettings(crop);
  return normalized.left > 0 || normalized.right > 0 || normalized.top > 0 || normalized.bottom > 0;
}

export function cropRatioToPixels(ratio: number | undefined, dimension: number): number {
  if (!Number.isFinite(dimension) || dimension <= 0) return 0;
  return clamp01(ratio ?? 0) * dimension;
}

export function cropPixelsToRatio(pixels: number, dimension: number): number {
  if (!Number.isFinite(dimension) || dimension <= 0) return 0;
  return clamp01(pixels / dimension);
}

export function calculateContainedRect(
  sourceWidth: number,
  sourceHeight: number,
  containerWidth: number,
  containerHeight: number,
): Rect {
  if (
    !Number.isFinite(sourceWidth) || sourceWidth <= 0 ||
    !Number.isFinite(sourceHeight) || sourceHeight <= 0 ||
    !Number.isFinite(containerWidth) || containerWidth <= 0 ||
    !Number.isFinite(containerHeight) || containerHeight <= 0
  ) {
    return {
      x: 0,
      y: 0,
      width: Math.max(0, containerWidth),
      height: Math.max(0, containerHeight),
    };
  }

  const fitScale = Math.min(containerWidth / sourceWidth, containerHeight / sourceHeight);
  const width = sourceWidth * fitScale;
  const height = sourceHeight * fitScale;

  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}

export function calculateMediaCropLayout(
  sourceWidth: number,
  sourceHeight: number,
  containerWidth: number,
  containerHeight: number,
  crop?: CropSettings,
): MediaCropLayout {
  const mediaRect = calculateContainedRect(sourceWidth, sourceHeight, containerWidth, containerHeight);
  const resolvedCrop = resolveCropSettings(crop);

  const cropPixels = {
    left: mediaRect.width * resolvedCrop.left,
    right: mediaRect.width * resolvedCrop.right,
    top: mediaRect.height * resolvedCrop.top,
    bottom: mediaRect.height * resolvedCrop.bottom,
  };

  const viewportRect = {
    x: mediaRect.x + cropPixels.left,
    y: mediaRect.y + cropPixels.top,
    width: Math.max(0, mediaRect.width - cropPixels.left - cropPixels.right),
    height: Math.max(0, mediaRect.height - cropPixels.top - cropPixels.bottom),
  };

  return {
    mediaRect,
    viewportRect,
    cropPixels,
    crop: resolvedCrop,
  };
}
