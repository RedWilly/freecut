import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AUDIO_EQ_HIGH_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_Q,
  AUDIO_EQ_LOW_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_Q,
  AUDIO_EQ_MID_FREQUENCY_HZ,
  AUDIO_EQ_MID_Q,
  resolveAudioEqSettings,
} from '@/shared/utils/audio-eq';
import {
  createPreviewClipAudioGraph,
  rampPreviewClipEq,
  setPreviewClipEq,
} from './preview-audio-graph';

class AudioParamMock {
  value = 0;
  readonly cancelledAt: number[] = [];
  readonly setCalls: Array<{ value: number; time: number }> = [];
  readonly rampCalls: Array<{ value: number; time: number }> = [];

  cancelScheduledValues(time: number) {
    this.cancelledAt.push(time);
  }

  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.setCalls.push({ value, time });
  }

  linearRampToValueAtTime(value: number, time: number) {
    this.value = value;
    this.rampCalls.push({ value, time });
  }
}

class ConnectableNodeMock {
  readonly connections: unknown[] = [];
  disconnected = false;

  connect(target: unknown) {
    this.connections.push(target);
  }

  disconnect() {
    this.disconnected = true;
    this.connections.length = 0;
  }
}

class GainNodeMock extends ConnectableNodeMock {
  gain = new AudioParamMock();
}

class BiquadFilterNodeMock extends ConnectableNodeMock {
  type: BiquadFilterType = 'peaking';
  frequency = new AudioParamMock();
  gain = new AudioParamMock();
  Q = new AudioParamMock();
}

class IIRFilterNodeMock extends ConnectableNodeMock {
  constructor(
    readonly feedforward: number[],
    readonly feedback: number[],
  ) {
    super();
  }
}

class AudioContextMock {
  currentTime = 1.5;
  state: AudioContextState = 'running';
  sampleRate = 48000;
  destination = { kind: 'destination' };

  createGain() {
    return new GainNodeMock();
  }

  createBiquadFilter() {
    return new BiquadFilterNodeMock();
  }

  createIIRFilter(feedforward: number[], feedback: number[]) {
    return new IIRFilterNodeMock(feedforward, feedback);
  }
}

function getConnections(node: unknown): unknown[] {
  return (node as ConnectableNodeMock).connections;
}

function getRampCalls(param: unknown): Array<{ value: number; time: number }> {
  return (param as AudioParamMock).rampCalls;
}

describe('preview-audio-graph', () => {
  beforeAll(() => {
    vi.stubGlobal('AudioContext', AudioContextMock);
    vi.stubGlobal('webkitAudioContext', AudioContextMock);
  });

  it('creates a stage chain with default shelf and bell nodes', () => {
    const graph = createPreviewClipAudioGraph({ eqStageCount: 2 });

    expect(graph).not.toBeNull();
    expect(graph?.eqStageNodes).toHaveLength(2);

    const firstStage = graph!.eqStageNodes[0]!;
    const secondStage = graph!.eqStageNodes[1]!;

    expect(firstStage.lowCutNodes).toHaveLength(0);
    expect(firstStage.lowShelfNode.type).toBe('lowshelf');
    expect(firstStage.lowShelfNode.frequency.value).toBe(AUDIO_EQ_LOW_FREQUENCY_HZ);
    expect(firstStage.lowMidPeakingNode.type).toBe('peaking');
    expect(firstStage.lowMidPeakingNode.frequency.value).toBe(AUDIO_EQ_LOW_MID_FREQUENCY_HZ);
    expect(firstStage.lowMidPeakingNode.Q.value).toBe(AUDIO_EQ_LOW_MID_Q);
    expect(firstStage.midPeakingNode.frequency.value).toBe(AUDIO_EQ_MID_FREQUENCY_HZ);
    expect(firstStage.midPeakingNode.Q.value).toBe(AUDIO_EQ_MID_Q);
    expect(firstStage.highMidPeakingNode.frequency.value).toBe(AUDIO_EQ_HIGH_MID_FREQUENCY_HZ);
    expect(firstStage.highMidPeakingNode.Q.value).toBe(AUDIO_EQ_HIGH_MID_Q);
    expect(firstStage.highShelfNode.type).toBe('highshelf');
    expect(firstStage.highShelfNode.frequency.value).toBe(AUDIO_EQ_HIGH_FREQUENCY_HZ);
    expect(firstStage.highCutNodes).toHaveLength(0);

    expect(getConnections(graph!.sourceInputNode)).toEqual([firstStage.band1BypassNode]);
    expect(getConnections(firstStage.band1BypassNode)).toEqual([firstStage.lowShelfNode]);
    expect(getConnections(firstStage.lowShelfNode)).toEqual([firstStage.lowMidPeakingNode]);
    expect(getConnections(firstStage.lowMidPeakingNode)).toEqual([firstStage.midPeakingNode]);
    expect(getConnections(firstStage.midPeakingNode)).toEqual([firstStage.highMidPeakingNode]);
    expect(getConnections(firstStage.highMidPeakingNode)).toEqual([firstStage.highShelfNode]);
    expect(getConnections(firstStage.highShelfNode)).toEqual([firstStage.band6BypassNode]);
    expect(getConnections(firstStage.band6BypassNode)).toEqual([firstStage.outputGainNode]);
    expect(getConnections(firstStage.outputGainNode)).toEqual([secondStage.band1BypassNode]);
    expect(getConnections(secondStage.band1BypassNode)).toEqual([secondStage.lowShelfNode]);
    expect(getConnections(secondStage.highShelfNode)).toEqual([secondStage.band6BypassNode]);
    expect(getConnections(secondStage.band6BypassNode)).toEqual([secondStage.outputGainNode]);
    expect(getConnections(secondStage.outputGainNode)).toEqual([graph!.outputGainNode]);
  });

  it('creates cut nodes when needed and ramps frequency, gain, and Q parameters', () => {
    const graph = createPreviewClipAudioGraph({ eqStageCount: 1 });
    expect(graph).not.toBeNull();

    setPreviewClipEq(graph!, [resolveAudioEqSettings({
      lowCutEnabled: true,
      lowCutFrequencyHz: 90,
      lowCutSlopeDbPerOct: 18,
      lowGainDb: 1,
      lowFrequencyHz: 150,
      lowMidGainDb: 2,
      lowMidFrequencyHz: 500,
      lowMidQ: 1.4,
      midGainDb: 3,
      highMidGainDb: 4,
      highMidFrequencyHz: 2600,
      highMidQ: 1.3,
      highGainDb: 5,
      highFrequencyHz: 7000,
      outputGainDb: 6,
      highCutEnabled: true,
      highCutFrequencyHz: 6000,
      highCutSlopeDbPerOct: 24,
    })]);

    const stage = graph!.eqStageNodes[0]!;
    expect(stage.lowCutNodes).toHaveLength(3);
    expect(stage.highCutNodes).toHaveLength(4);
    expect(getConnections(graph!.sourceInputNode)[0]).toBe(stage.lowCutNodes[0]);
    expect(getConnections(stage.lowCutNodes.at(-1)!)[0]).toBe(stage.lowShelfNode);
    expect(getConnections(stage.highShelfNode)[0]).toBe(stage.highCutNodes[0]);
    expect(getConnections(stage.highCutNodes.at(-1)!)[0]).toBe(stage.outputGainNode);
    expect(getConnections(stage.outputGainNode)[0]).toBe(graph!.outputGainNode);

    expect(stage.lowShelfNode.frequency.value).toBe(150);
    expect(stage.lowShelfNode.gain.value).toBe(1);
    expect(stage.lowMidPeakingNode.frequency.value).toBe(500);
    expect(stage.lowMidPeakingNode.Q.value).toBe(1.4);
    expect(stage.lowMidPeakingNode.gain.value).toBe(2);
    expect(stage.midPeakingNode.gain.value).toBe(3);
    expect(stage.highMidPeakingNode.frequency.value).toBe(2600);
    expect(stage.highMidPeakingNode.Q.value).toBe(1.3);
    expect(stage.highMidPeakingNode.gain.value).toBe(4);
    expect(stage.highShelfNode.frequency.value).toBe(7000);
    expect(stage.highShelfNode.gain.value).toBe(5);
    expect(stage.outputGainNode.gain.value).toBeCloseTo(Math.pow(10, 6 / 20), 5);

    rampPreviewClipEq(graph!, [resolveAudioEqSettings({
      lowCutEnabled: true,
      lowCutFrequencyHz: 90,
      lowCutSlopeDbPerOct: 18,
      lowGainDb: -1,
      lowFrequencyHz: 130,
      lowMidGainDb: -2,
      lowMidFrequencyHz: 450,
      lowMidQ: 1.1,
      midGainDb: -3,
      highMidGainDb: -4,
      highMidFrequencyHz: 2400,
      highMidQ: 1.05,
      highGainDb: -5,
      highFrequencyHz: 6500,
      outputGainDb: -3,
      highCutEnabled: true,
      highCutFrequencyHz: 6000,
      highCutSlopeDbPerOct: 24,
    })], 2, 0.25);

    expect(getRampCalls(stage.lowShelfNode.frequency).at(-1)).toEqual({ value: 130, time: 2.25 });
    expect(getRampCalls(stage.lowShelfNode.gain).at(-1)).toEqual({ value: -1, time: 2.25 });
    expect(getRampCalls(stage.lowMidPeakingNode.frequency).at(-1)).toEqual({ value: 450, time: 2.25 });
    expect(getRampCalls(stage.lowMidPeakingNode.Q).at(-1)).toEqual({ value: 1.1, time: 2.25 });
    expect(getRampCalls(stage.lowMidPeakingNode.gain).at(-1)).toEqual({ value: -2, time: 2.25 });
    expect(getRampCalls(stage.midPeakingNode.gain).at(-1)).toEqual({ value: -3, time: 2.25 });
    expect(getRampCalls(stage.highMidPeakingNode.frequency).at(-1)).toEqual({ value: 2400, time: 2.25 });
    expect(getRampCalls(stage.highMidPeakingNode.Q).at(-1)).toEqual({ value: 1.05, time: 2.25 });
    expect(getRampCalls(stage.highMidPeakingNode.gain).at(-1)).toEqual({ value: -4, time: 2.25 });
    expect(getRampCalls(stage.highShelfNode.frequency).at(-1)).toEqual({ value: 6500, time: 2.25 });
    expect(getRampCalls(stage.highShelfNode.gain).at(-1)).toEqual({ value: -5, time: 2.25 });
    expect(getRampCalls(stage.outputGainNode.gain).at(-1)).toEqual({ value: Math.pow(10, -3 / 20), time: 2.25 });
  });
});
