import type React from 'react';
import type { CropSettings } from '@/types/transform';
import { calculateMediaCropLayout } from '@/shared/utils/media-crop';

interface ContainedMediaLayoutProps {
  sourceWidth: number;
  sourceHeight: number;
  containerWidth: number;
  containerHeight: number;
  crop?: CropSettings;
  children: React.ReactNode;
}

function percent(value: number, total: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return '0%';
  }
  return `${(value / total) * 100}%`;
}

/**
 * Explicit contain-fit wrapper for media content.
 * This makes media framing deterministic so crop preview and export use the same geometry.
 */
export function ContainedMediaLayout({
  sourceWidth,
  sourceHeight,
  containerWidth,
  containerHeight,
  crop,
  children,
}: ContainedMediaLayoutProps) {
  const layout = calculateMediaCropLayout(
    sourceWidth,
    sourceHeight,
    containerWidth,
    containerHeight,
    crop,
  );

  if (layout.mediaRect.width <= 0 || layout.mediaRect.height <= 0) {
    return <div style={{ position: 'relative', width: '100%', height: '100%' }} />;
  }

  const viewportOffsetX = layout.viewportRect.x - layout.mediaRect.x;
  const viewportOffsetY = layout.viewportRect.y - layout.mediaRect.y;
  const contentWidthPercent = layout.viewportRect.width > 0
    ? (layout.mediaRect.width / layout.viewportRect.width) * 100
    : 100;
  const contentHeightPercent = layout.viewportRect.height > 0
    ? (layout.mediaRect.height / layout.viewportRect.height) * 100
    : 100;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        style={{
          position: 'absolute',
          left: percent(layout.mediaRect.x, containerWidth),
          top: percent(layout.mediaRect.y, containerHeight),
          width: percent(layout.mediaRect.width, containerWidth),
          height: percent(layout.mediaRect.height, containerHeight),
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: percent(viewportOffsetX, layout.mediaRect.width),
            top: percent(viewportOffsetY, layout.mediaRect.height),
            width: percent(layout.viewportRect.width, layout.mediaRect.width),
            height: percent(layout.viewportRect.height, layout.mediaRect.height),
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: percent(-viewportOffsetX, layout.viewportRect.width),
              top: percent(-viewportOffsetY, layout.viewportRect.height),
              width: `${contentWidthPercent}%`,
              height: `${contentHeightPercent}%`,
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
