import type { ResolvedAudioEqSettings } from '@/types/audio';
import type { TimelineItem } from '@/types/timeline';
import type { AudioEqPatch } from './audio-eq-curve-editor';

export type AudioEqControlRangeId = 'L' | 'ML' | 'MH' | 'H';

export interface AudioEqControlRange {
  id: AudioEqControlRangeId;
  label: AudioEqControlRangeId;
  minFrequencyHz: number;
  maxFrequencyHz: number;
}

export const AUDIO_EQ_CONTROL_RANGES: ReadonlyArray<AudioEqControlRange> = Object.freeze([
  { id: 'L', label: 'L', minFrequencyHz: 30, maxFrequencyHz: 399 },
  { id: 'ML', label: 'ML', minFrequencyHz: 100, maxFrequencyHz: 1500 },
  { id: 'MH', label: 'MH', minFrequencyHz: 450, maxFrequencyHz: 8000 },
  { id: 'H', label: 'H', minFrequencyHz: 1400, maxFrequencyHz: 22000 },
]);

export function getAudioEqControlRangeById(id: AudioEqControlRangeId): AudioEqControlRange {
  return AUDIO_EQ_CONTROL_RANGES.find((range) => range.id === id) ?? AUDIO_EQ_CONTROL_RANGES[0]!;
}

export function audioEqControlRangeContainsFrequency(id: AudioEqControlRangeId, frequencyHz: number): boolean {
  const range = getAudioEqControlRangeById(id);
  return frequencyHz >= range.minFrequencyHz && frequencyHz <= range.maxFrequencyHz;
}

export function inferAudioEqControlRangeId(
  frequencyHz: number,
  preferred: AudioEqControlRangeId,
): AudioEqControlRangeId {
  const matchingRanges = AUDIO_EQ_CONTROL_RANGES.filter((range) => (
    frequencyHz >= range.minFrequencyHz && frequencyHz <= range.maxFrequencyHz
  ));
  if (matchingRanges.some((range) => range.id === preferred)) {
    return preferred;
  }
  if (matchingRanges.length > 0) {
    return matchingRanges[0]!.id;
  }
  if (frequencyHz < 100) return 'L';
  if (frequencyHz < 1000) return 'ML';
  if (frequencyHz < 6000) return 'MH';
  return 'H';
}

export function clampFrequencyToAudioEqControlRange(
  frequencyHz: number,
  rangeId: AudioEqControlRangeId,
): number {
  const range = getAudioEqControlRangeById(rangeId);
  if (!Number.isFinite(frequencyHz)) return range.minFrequencyHz;
  return Math.max(range.minFrequencyHz, Math.min(range.maxFrequencyHz, frequencyHz));
}

export function buildTimelineEqPatchFromResolvedSettings(settings: ResolvedAudioEqSettings): Partial<TimelineItem> {
  return {
    audioEqLowCutEnabled: settings.lowCutEnabled,
    audioEqLowCutFrequencyHz: settings.lowCutFrequencyHz,
    audioEqLowCutSlopeDbPerOct: settings.lowCutSlopeDbPerOct,
    audioEqLowGainDb: settings.lowGainDb,
    audioEqLowFrequencyHz: settings.lowFrequencyHz,
    audioEqLowMidGainDb: settings.lowMidGainDb,
    audioEqLowMidFrequencyHz: settings.lowMidFrequencyHz,
    audioEqLowMidQ: settings.lowMidQ,
    audioEqMidGainDb: settings.midGainDb,
    audioEqHighMidGainDb: settings.highMidGainDb,
    audioEqHighMidFrequencyHz: settings.highMidFrequencyHz,
    audioEqHighMidQ: settings.highMidQ,
    audioEqHighGainDb: settings.highGainDb,
    audioEqHighFrequencyHz: settings.highFrequencyHz,
    audioEqHighCutEnabled: settings.highCutEnabled,
    audioEqHighCutFrequencyHz: settings.highCutFrequencyHz,
    audioEqHighCutSlopeDbPerOct: settings.highCutSlopeDbPerOct,
  };
}

export function normalizeUiEqPatch(patch: AudioEqPatch): AudioEqPatch {
  return {
    audioEqMidGainDb: 0,
    ...patch,
  };
}

export function toTimelineEqPatch(patch: AudioEqPatch): Partial<TimelineItem> {
  return normalizeUiEqPatch(patch) as Partial<TimelineItem>;
}
