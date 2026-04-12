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

class AudioContextMock {
  currentTime = 1.5;
  state: AudioContextState = 'running';
  destination = { kind: 'destination' };

  createGain() {
    return new GainNodeMock();
  }

  createBiquadFilter() {
    return new BiquadFilterNodeMock();
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

  it('creates a five-node EQ stage chain for each requested stage', () => {
    const graph = createPreviewClipAudioGraph({ eqStageCount: 2 });

    expect(graph).not.toBeNull();
    expect(graph?.eqStageNodes).toHaveLength(2);

    const firstStage = graph!.eqStageNodes[0]!;
    const secondStage = graph!.eqStageNodes[1]!;

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

    expect(getConnections(graph!.sourceInputNode)).toEqual([firstStage.lowShelfNode]);
    expect(getConnections(firstStage.lowShelfNode)).toEqual([firstStage.lowMidPeakingNode]);
    expect(getConnections(firstStage.lowMidPeakingNode)).toEqual([firstStage.midPeakingNode]);
    expect(getConnections(firstStage.midPeakingNode)).toEqual([firstStage.highMidPeakingNode]);
    expect(getConnections(firstStage.highMidPeakingNode)).toEqual([firstStage.highShelfNode]);
    expect(getConnections(firstStage.highShelfNode)).toEqual([secondStage.lowShelfNode]);
    expect(getConnections(secondStage.highShelfNode)).toEqual([graph!.outputGainNode]);
  });

  it('sets and ramps all five EQ gains on each stage', () => {
    const graph = createPreviewClipAudioGraph({ eqStageCount: 1 });
    expect(graph).not.toBeNull();

    setPreviewClipEq(graph!, [{
      lowGainDb: 1,
      lowMidGainDb: 2,
      midGainDb: 3,
      highMidGainDb: 4,
      highGainDb: 5,
    }]);

    const stage = graph!.eqStageNodes[0]!;
    expect(stage.lowShelfNode.gain.value).toBe(1);
    expect(stage.lowMidPeakingNode.gain.value).toBe(2);
    expect(stage.midPeakingNode.gain.value).toBe(3);
    expect(stage.highMidPeakingNode.gain.value).toBe(4);
    expect(stage.highShelfNode.gain.value).toBe(5);

    rampPreviewClipEq(graph!, [{
      lowGainDb: -1,
      lowMidGainDb: -2,
      midGainDb: -3,
      highMidGainDb: -4,
      highGainDb: -5,
    }], 2, 0.25);

    expect(getRampCalls(stage.lowShelfNode.gain).at(-1)).toEqual({ value: -1, time: 2.25 });
    expect(getRampCalls(stage.lowMidPeakingNode.gain).at(-1)).toEqual({ value: -2, time: 2.25 });
    expect(getRampCalls(stage.midPeakingNode.gain).at(-1)).toEqual({ value: -3, time: 2.25 });
    expect(getRampCalls(stage.highMidPeakingNode.gain).at(-1)).toEqual({ value: -4, time: 2.25 });
    expect(getRampCalls(stage.highShelfNode.gain).at(-1)).toEqual({ value: -5, time: 2.25 });
  });
});
