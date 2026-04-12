import { describe, expect, it } from 'vitest';
import {
  AUDIO_EQ_PRESETS,
  AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  AUDIO_EQ_LOW_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  AUDIO_EQ_MID_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_FREQUENCY_HZ,
  findAudioEqPresetId,
  getAudioEqResponseGainDb,
  applyAudioEqStages,
  areAudioEqStagesEqual,
  clampAudioEqGainDb,
  resolvePreviewAudioEqStages,
} from './audio-eq';

function makeSineWave(frequencyHz: number, sampleRate = 48000, seconds = 0.25): Float32Array {
  const length = Math.floor(sampleRate * seconds);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    samples[i] = Math.sin(2 * Math.PI * frequencyHz * (i / sampleRate));
  }
  return samples;
}

function rms(samples: Float32Array): number {
  let total = 0;
  for (let i = 0; i < samples.length; i++) {
    total += samples[i]! * samples[i]!;
  }
  return Math.sqrt(total / Math.max(1, samples.length));
}

describe('audio-eq', () => {
  it('clamps gains into the supported range', () => {
    expect(clampAudioEqGainDb(40)).toBe(18);
    expect(clampAudioEqGainDb(-40)).toBe(-18);
    expect(clampAudioEqGainDb(Number.NaN)).toBe(0);
  });

  it('applies preview overrides only to the last EQ stage', () => {
    const resolved = resolvePreviewAudioEqStages(
      [
        { lowGainDb: 1, lowMidGainDb: 1.5, midGainDb: 2, highMidGainDb: 2.5, highGainDb: 3 },
        { lowGainDb: 4, lowMidGainDb: 4.5, midGainDb: 5, highMidGainDb: 5.5, highGainDb: 6 },
      ],
      { audioEqMidGainDb: 8 },
    );

    expect(resolved).toEqual([
      { lowGainDb: 1, lowMidGainDb: 1.5, midGainDb: 2, highMidGainDb: 2.5, highGainDb: 3 },
      { lowGainDb: 4, lowMidGainDb: 4.5, midGainDb: 8, highMidGainDb: 5.5, highGainDb: 6 },
    ]);
  });

  it('compares stage arrays structurally', () => {
    expect(areAudioEqStagesEqual(
      [{ lowGainDb: 1, lowMidGainDb: 0, midGainDb: 0, highMidGainDb: 0, highGainDb: 0 }],
      [{ lowGainDb: 1, lowMidGainDb: 0, midGainDb: 0, highMidGainDb: 0, highGainDb: 0 }],
    )).toBe(true);
    expect(areAudioEqStagesEqual(
      [{ lowGainDb: 1, lowMidGainDb: 0, midGainDb: 0, highMidGainDb: 0, highGainDb: 0 }],
      [{ lowGainDb: 0, lowMidGainDb: 0, midGainDb: 0, highMidGainDb: 0, highGainDb: 0 }],
    )).toBe(false);
  });

  it('detects matching presets from resolved settings', () => {
    expect(findAudioEqPresetId({
      lowGainDb: -6,
      lowMidGainDb: -3,
      midGainDb: 2,
      highMidGainDb: 4.5,
      highGainDb: 2,
    })).toBe('voice-clarity');

    expect(findAudioEqPresetId({
      lowGainDb: -5,
      lowMidGainDb: -2,
      midGainDb: 1.5,
      highMidGainDb: 5.5,
      highGainDb: 2.5,
    })).toBe('podcast');

    expect(findAudioEqPresetId({
      audioEqLowGainDb: 7,
      audioEqLowMidGainDb: 3,
      audioEqMidGainDb: -1,
      audioEqHighMidGainDb: -1,
      audioEqHighGainDb: 0.5,
    })).toBe('bass-boost');

    expect(findAudioEqPresetId({
      lowGainDb: 1,
      lowMidGainDb: 1,
      midGainDb: 1,
      highMidGainDb: 1,
      highGainDb: 1,
    })).toBeNull();
  });

  it('round-trips every preset and keeps preset settings unique', () => {
    const uniqueSettings = new Set(
      AUDIO_EQ_PRESETS.map((preset) => JSON.stringify(preset.settings)),
    );

    expect(uniqueSettings.size).toBe(AUDIO_EQ_PRESETS.length);
    for (const preset of AUDIO_EQ_PRESETS) {
      expect(findAudioEqPresetId(preset.settings)).toBe(preset.id);
    }
  });

  it('reports frequency response gains for the curve UI', () => {
    expect(Math.abs(getAudioEqResponseGainDb(undefined, AUDIO_EQ_MID_FREQUENCY_HZ))).toBeLessThan(0.001);
    expect(getAudioEqResponseGainDb({ midGainDb: 8 }, AUDIO_EQ_MID_FREQUENCY_HZ)).toBeGreaterThan(6);
    expect(getAudioEqResponseGainDb({ highMidGainDb: 8 }, AUDIO_EQ_HIGH_MID_FREQUENCY_HZ)).toBeGreaterThan(6);
    expect(getAudioEqResponseGainDb({ lowGainDb: -8 }, AUDIO_EQ_LOW_FREQUENCY_HZ)).toBeLessThan(-3.5);
  });

  it('boosts and cuts the expected frequency bands', () => {
    const lowTone = makeSineWave(AUDIO_EQ_LOW_FREQUENCY_HZ);
    const lowMidTone = makeSineWave(AUDIO_EQ_LOW_MID_FREQUENCY_HZ);
    const midTone = makeSineWave(AUDIO_EQ_MID_FREQUENCY_HZ);
    const highMidTone = makeSineWave(AUDIO_EQ_HIGH_MID_FREQUENCY_HZ);
    const highTone = makeSineWave(AUDIO_EQ_HIGH_FREQUENCY_HZ);

    const lowBoosted = applyAudioEqStages([lowTone], 48000, [
      { lowGainDb: 9, lowMidGainDb: 0, midGainDb: 0, highMidGainDb: 0, highGainDb: 0 },
    ])[0]!;
    const lowCut = applyAudioEqStages([lowTone], 48000, [
      { lowGainDb: -9, lowMidGainDb: 0, midGainDb: 0, highMidGainDb: 0, highGainDb: 0 },
    ])[0]!;
    const lowMidBoosted = applyAudioEqStages([lowMidTone], 48000, [
      { lowGainDb: 0, lowMidGainDb: 9, midGainDb: 0, highMidGainDb: 0, highGainDb: 0 },
    ])[0]!;
    const midBoosted = applyAudioEqStages([midTone], 48000, [
      { lowGainDb: 0, lowMidGainDb: 0, midGainDb: 9, highMidGainDb: 0, highGainDb: 0 },
    ])[0]!;
    const highMidBoosted = applyAudioEqStages([highMidTone], 48000, [
      { lowGainDb: 0, lowMidGainDb: 0, midGainDb: 0, highMidGainDb: 9, highGainDb: 0 },
    ])[0]!;
    const highBoosted = applyAudioEqStages([highTone], 48000, [
      { lowGainDb: 0, lowMidGainDb: 0, midGainDb: 0, highMidGainDb: 0, highGainDb: 9 },
    ])[0]!;

    expect(rms(lowBoosted) / rms(lowTone)).toBeGreaterThan(1.5);
    expect(rms(lowCut) / rms(lowTone)).toBeLessThan(0.75);
    expect(rms(lowMidBoosted) / rms(lowMidTone)).toBeGreaterThan(1.5);
    expect(rms(midBoosted) / rms(midTone)).toBeGreaterThan(1.5);
    expect(rms(highMidBoosted) / rms(highMidTone)).toBeGreaterThan(1.5);
    expect(rms(highBoosted) / rms(highTone)).toBeGreaterThan(1.5);
  });
});
