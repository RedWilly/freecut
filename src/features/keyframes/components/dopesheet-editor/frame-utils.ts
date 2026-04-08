import type { BlockedFrameRange } from '../../utils/transition-region';

export function clampFrame(frame: number, totalFrames: number): number {
  if (totalFrames <= 0) return 0;
  return Math.max(0, Math.min(totalFrames - 1, frame));
}

export function clampToAvoidBlockedRanges(
  frame: number,
  initialFrame: number,
  blockedRanges: BlockedFrameRange[]
): number {
  if (blockedRanges.length === 0) return frame;
  for (const range of blockedRanges) {
    if (frame >= range.start && frame < range.end) {
      if (initialFrame < range.start) return range.start - 1;
      if (initialFrame >= range.end) return range.end;
      const distToStart = frame - range.start;
      const distToEnd = range.end - frame;
      return distToStart < distToEnd ? range.start - 1 : range.end;
    }
  }
  return frame;
}
