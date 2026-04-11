import type { TimelineItem } from '@/types/timeline';

const MIN_TIMELINE_SECONDS = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeFrame(frame: number | null | undefined): number | null {
  if (frame === null || frame === undefined || !Number.isFinite(frame)) {
    return null;
  }

  return Math.round(frame);
}

export function getEffectiveTimelineMaxFrame(
  items: ReadonlyArray<Pick<TimelineItem, 'from' | 'durationInFrames'>>,
  fps: number
): number {
  const contentMaxFrame = items.reduce(
    (max, item) => Math.max(max, item.from + item.durationInFrames),
    0
  );
  const minimumFrame = Math.max(1, Math.floor(MIN_TIMELINE_SECONDS * fps));

  return Math.max(contentMaxFrame, minimumFrame);
}

export function sanitizeInOutPoints(params: {
  inPoint: number | null | undefined;
  outPoint: number | null | undefined;
  maxFrame: number;
}): {
  inPoint: number | null;
  outPoint: number | null;
} {
  const maxFrame = Math.max(1, Math.floor(params.maxFrame));

  let inPoint = normalizeFrame(params.inPoint);
  let outPoint = normalizeFrame(params.outPoint);

  if (inPoint !== null) {
    inPoint = clamp(inPoint, 0, maxFrame);
  }

  if (outPoint !== null) {
    outPoint = clamp(outPoint, 1, maxFrame);
  }

  if (inPoint !== null && outPoint !== null && inPoint >= outPoint) {
    if (inPoint >= maxFrame) {
      return {
        inPoint: Math.max(0, maxFrame - 1),
        outPoint: maxFrame,
      };
    }

    return {
      inPoint,
      outPoint: Math.min(maxFrame, inPoint + 1),
    };
  }

  return { inPoint, outPoint };
}
