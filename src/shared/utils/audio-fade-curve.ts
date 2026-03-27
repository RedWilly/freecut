export const AUDIO_FADE_CURVE_MIN = -1;
export const AUDIO_FADE_CURVE_MAX = 1;
export const AUDIO_FADE_CURVE_X_MIN = 0.15;
export const AUDIO_FADE_CURVE_X_MAX = 0.85;
export const AUDIO_FADE_CURVE_X_DEFAULT = 0.52;

export interface AudioClipFadeSpan {
  startFrame: number;
  durationInFrames: number;
  fadeInFrames?: number;
  fadeOutFrames?: number;
  fadeInCurve?: number;
  fadeOutCurve?: number;
  fadeInCurveX?: number;
  fadeOutCurveX?: number;
}

export function clampAudioFadeCurve(curve: number | undefined): number {
  const value = typeof curve === 'number' && Number.isFinite(curve) ? curve : 0;
  return Math.max(AUDIO_FADE_CURVE_MIN, Math.min(AUDIO_FADE_CURVE_MAX, Math.round(value * 100) / 100));
}

export function clampAudioFadeCurveX(curveX: number | undefined): number {
  const value = typeof curveX === 'number' && Number.isFinite(curveX) ? curveX : AUDIO_FADE_CURVE_X_DEFAULT;
  return Math.max(AUDIO_FADE_CURVE_X_MIN, Math.min(AUDIO_FADE_CURVE_X_MAX, Math.round(value * 1000) / 1000));
}

function getFadeInControlY(curve: number | undefined, curveX: number | undefined): number {
  const normalizedX = clampAudioFadeCurveX(curveX);
  const normalizedCurve = clampAudioFadeCurve(curve);
  const linearY = normalizedX;
  const upwardRange = 1 - linearY;
  const downwardRange = linearY;
  return normalizedCurve >= 0
    ? linearY + normalizedCurve * upwardRange
    : linearY + normalizedCurve * downwardRange;
}

function getFadeOutControlY(curve: number | undefined, curveX: number | undefined): number {
  const normalizedX = clampAudioFadeCurveX(curveX);
  const normalizedCurve = clampAudioFadeCurve(curve);
  const linearY = 1 - normalizedX;
  const upwardRange = 1 - linearY;
  const downwardRange = linearY;
  return normalizedCurve >= 0
    ? linearY + normalizedCurve * upwardRange
    : linearY + normalizedCurve * downwardRange;
}

function solveQuadraticBezierTime(progress: number, controlX: number): number {
  const x = Math.max(0, Math.min(1, progress));
  const cx = clampAudioFadeCurveX(controlX);
  const a = 1 - (2 * cx);
  const b = 2 * cx;
  const c = -x;

  if (Math.abs(a) < 0.000001) {
    return b === 0 ? x : Math.max(0, Math.min(1, x / b));
  }

  const discriminant = Math.max(0, (b * b) - (4 * a * c));
  const sqrt = Math.sqrt(discriminant);
  const t1 = (-b + sqrt) / (2 * a);
  const t2 = (-b - sqrt) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  if (t2 >= 0 && t2 <= 1) return t2;
  return Math.max(0, Math.min(1, t1));
}

function evaluateQuadraticBezierY(progress: number, controlX: number, controlY: number, startY: number, endY: number): number {
  const t = solveQuadraticBezierTime(progress, controlX);
  const oneMinusT = 1 - t;
  return (oneMinusT * oneMinusT * startY) + (2 * oneMinusT * t * controlY) + (t * t * endY);
}

export function evaluateAudioFadeInCurve(progress: number, curve: number | undefined, curveX?: number): number {
  return evaluateQuadraticBezierY(progress, clampAudioFadeCurveX(curveX), getFadeInControlY(curve, curveX), 0, 1);
}

export function evaluateAudioFadeOutCurve(progress: number, curve: number | undefined, curveX?: number): number {
  return evaluateQuadraticBezierY(progress, clampAudioFadeCurveX(curveX), getFadeOutControlY(curve, curveX), 1, 0);
}

interface AudioFadeMultiplierOptions {
  frame: number;
  durationInFrames: number;
  fadeInFrames?: number;
  fadeOutFrames?: number;
  contentStartOffsetFrames?: number;
  contentEndOffsetFrames?: number;
  fadeInDelayFrames?: number;
  fadeOutLeadFrames?: number;
  fadeInCurve?: number;
  fadeOutCurve?: number;
  fadeInCurveX?: number;
  fadeOutCurveX?: number;
  useEqualPower?: boolean;
}

export function getAudioFadeMultiplier({
  frame,
  durationInFrames,
  fadeInFrames = 0,
  fadeOutFrames = 0,
  contentStartOffsetFrames = 0,
  contentEndOffsetFrames = 0,
  fadeInDelayFrames = 0,
  fadeOutLeadFrames = 0,
  fadeInCurve = 0,
  fadeOutCurve = 0,
  fadeInCurveX = AUDIO_FADE_CURVE_X_DEFAULT,
  fadeOutCurveX = AUDIO_FADE_CURVE_X_DEFAULT,
  useEqualPower = false,
}: AudioFadeMultiplierOptions): number {
  const clampedFadeInFrames = Math.min(Math.max(0, fadeInFrames), durationInFrames);
  const clampedFadeOutFrames = Math.min(Math.max(0, fadeOutFrames), durationInFrames);
  const baseContentStart = Math.max(0, Math.min(contentStartOffsetFrames, durationInFrames));
  const baseContentEnd = Math.max(0, Math.min(contentEndOffsetFrames, durationInFrames - baseContentStart));
  const clampedFadeInDelay = Math.max(0, fadeInDelayFrames);
  const clampedFadeOutLead = Math.max(0, fadeOutLeadFrames);
  const clampedContentStart = Math.max(0, Math.min(baseContentStart + clampedFadeInDelay, durationInFrames));
  const clampedContentEnd = Math.max(0, Math.min(baseContentEnd + clampedFadeOutLead, durationInFrames - clampedContentStart));
  const contentDuration = Math.max(0, durationInFrames - clampedContentStart - clampedContentEnd);
  const contentFrame = frame - clampedContentStart;
  const hasFadeIn = clampedFadeInFrames > 0;
  const hasFadeOut = clampedFadeOutFrames > 0;

  if (!hasFadeIn && !hasFadeOut) {
    return 1;
  }

  const fadeOutStart = contentDuration - clampedFadeOutFrames;

  if (useEqualPower) {
    if (hasFadeIn && frame < clampedFadeInFrames) {
      const progress = frame / Math.max(clampedFadeInFrames, 1);
      return Math.sin(progress * Math.PI / 2);
    }

    if (hasFadeOut && frame >= durationInFrames - clampedFadeOutFrames) {
      const progress = (frame - (durationInFrames - clampedFadeOutFrames)) / Math.max(clampedFadeOutFrames, 1);
      return Math.cos(progress * Math.PI / 2);
    }

    return 1;
  }

  if (hasFadeIn && hasFadeOut) {
    if (contentFrame < 0 || contentFrame > contentDuration) return 0;

    if (clampedFadeInFrames >= fadeOutStart) {
      const midPoint = contentDuration / 2;
      const peakVolume = Math.min(1, midPoint / Math.max(clampedFadeInFrames, 1));
      if (contentFrame <= midPoint) {
        return (contentFrame / Math.max(midPoint, 1)) * peakVolume;
      }
      return ((contentDuration - contentFrame) / Math.max(contentDuration - midPoint, 1)) * peakVolume;
    }

    if (contentFrame < clampedFadeInFrames) {
      return evaluateAudioFadeInCurve(contentFrame / clampedFadeInFrames, fadeInCurve, fadeInCurveX);
    }

    if (contentFrame >= fadeOutStart) {
      return evaluateAudioFadeOutCurve((contentFrame - fadeOutStart) / clampedFadeOutFrames, fadeOutCurve, fadeOutCurveX);
    }

    return 1;
  }

  if (hasFadeIn) {
    if (contentFrame < 0) return 0;
    if (contentFrame >= clampedFadeInFrames) return 1;
    return evaluateAudioFadeInCurve(contentFrame / clampedFadeInFrames, fadeInCurve, fadeInCurveX);
  }

  if (contentFrame <= fadeOutStart) return 1;
  if (contentFrame > contentDuration) return 0;
  return evaluateAudioFadeOutCurve((contentFrame - fadeOutStart) / clampedFadeOutFrames, fadeOutCurve, fadeOutCurveX);
}

export function getAudioClipFadeMultiplier(frame: number, fadeSpans: AudioClipFadeSpan[] | undefined): number {
  if (!fadeSpans || fadeSpans.length === 0) {
    return 1;
  }

  const activeSpan = fadeSpans.find((span) => frame >= span.startFrame && frame < (span.startFrame + span.durationInFrames));
  if (!activeSpan) {
    return 1;
  }

  return getAudioFadeMultiplier({
    frame: frame - activeSpan.startFrame,
    durationInFrames: activeSpan.durationInFrames,
    fadeInFrames: activeSpan.fadeInFrames,
    fadeOutFrames: activeSpan.fadeOutFrames,
    fadeInCurve: activeSpan.fadeInCurve,
    fadeOutCurve: activeSpan.fadeOutCurve,
    fadeInCurveX: activeSpan.fadeInCurveX,
    fadeOutCurveX: activeSpan.fadeOutCurveX,
  });
}
