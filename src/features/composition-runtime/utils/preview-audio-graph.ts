import {
  AUDIO_EQ_MID_FREQUENCY_HZ,
  AUDIO_EQ_MID_Q,
  DEFAULT_AUDIO_EQ_SETTINGS,
  buildAudioEqPassIirCoefficients,
} from '@/shared/utils/audio-eq';
import type { ResolvedAudioEqSettings } from '@/types/audio';

export const PREVIEW_AUDIO_GAIN_RAMP_SECONDS = 0.008;
export const PREVIEW_AUDIO_EQ_RAMP_SECONDS = 0.012;

interface PreviewClipAudioEqStageNodes {
  lowCutNodes: IIRFilterNode[];
  lowShelfNode: BiquadFilterNode;
  lowMidPeakingNode: BiquadFilterNode;
  midPeakingNode: BiquadFilterNode;
  highMidPeakingNode: BiquadFilterNode;
  highShelfNode: BiquadFilterNode;
  highCutNodes: IIRFilterNode[];
  resolvedStage: ResolvedAudioEqSettings;
}

export interface PreviewClipAudioGraph {
  context: AudioContext;
  sourceInputNode: GainNode;
  outputGainNode: GainNode;
  eqStageNodes: PreviewClipAudioEqStageNodes[];
  dispose: () => void;
}

let sharedPreviewAudioContext: AudioContext | null = null;

export function getSharedPreviewAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  const webkitWindow = window as Window & {
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextCtor = window.AudioContext ?? webkitWindow.webkitAudioContext;
  if (!AudioContextCtor) return null;

  if (sharedPreviewAudioContext === null || sharedPreviewAudioContext.state === 'closed') {
    sharedPreviewAudioContext = new AudioContextCtor();
  }

  return sharedPreviewAudioContext;
}

function createPassNodes(
  context: AudioContext,
  type: 'highpass' | 'lowpass',
  enabled: boolean,
  frequencyHz: number,
  slopeDbPerOct: ResolvedAudioEqSettings['lowCutSlopeDbPerOct'],
): IIRFilterNode[] {
  if (!enabled) return [];

  const count = Math.max(1, Math.round(slopeDbPerOct / 6));
  const coefficients = buildAudioEqPassIirCoefficients(type, frequencyHz, context.sampleRate);

  return Array.from({ length: count }, () => context.createIIRFilter(
    coefficients.feedforward,
    coefficients.feedback,
  ));
}

function getStageEntryNode(stageNodes: PreviewClipAudioEqStageNodes): AudioNode {
  return stageNodes.lowCutNodes[0] ?? stageNodes.lowShelfNode;
}

function getStageExitNode(stageNodes: PreviewClipAudioEqStageNodes): AudioNode {
  return stageNodes.highCutNodes.at(-1) ?? stageNodes.highShelfNode;
}

function connectStageInternals(stageNodes: PreviewClipAudioEqStageNodes): void {
  let previousNode: AudioNode | null = null;

  for (const node of stageNodes.lowCutNodes) {
    if (previousNode) previousNode.connect(node);
    previousNode = node;
  }

  const lowShelfInput = stageNodes.lowShelfNode;
  if (previousNode) {
    previousNode.connect(lowShelfInput);
  }
  stageNodes.lowShelfNode.connect(stageNodes.lowMidPeakingNode);
  stageNodes.lowMidPeakingNode.connect(stageNodes.midPeakingNode);
  stageNodes.midPeakingNode.connect(stageNodes.highMidPeakingNode);
  stageNodes.highMidPeakingNode.connect(stageNodes.highShelfNode);

  previousNode = stageNodes.highShelfNode;
  for (const node of stageNodes.highCutNodes) {
    previousNode.connect(node);
    previousNode = node;
  }
}

function disconnectStageInternals(stageNodes: PreviewClipAudioEqStageNodes): void {
  for (const node of stageNodes.lowCutNodes) {
    node.disconnect();
  }
  stageNodes.lowShelfNode.disconnect();
  stageNodes.lowMidPeakingNode.disconnect();
  stageNodes.midPeakingNode.disconnect();
  stageNodes.highMidPeakingNode.disconnect();
  stageNodes.highShelfNode.disconnect();
  for (const node of stageNodes.highCutNodes) {
    node.disconnect();
  }
}

function createPreviewClipAudioEqStage(
  context: AudioContext,
  resolvedStage: ResolvedAudioEqSettings = DEFAULT_AUDIO_EQ_SETTINGS,
): PreviewClipAudioEqStageNodes {
  const lowShelfNode = context.createBiquadFilter();
  lowShelfNode.type = 'lowshelf';
  lowShelfNode.frequency.value = resolvedStage.lowFrequencyHz;
  lowShelfNode.gain.value = resolvedStage.lowGainDb;

  const lowMidPeakingNode = context.createBiquadFilter();
  lowMidPeakingNode.type = 'peaking';
  lowMidPeakingNode.frequency.value = resolvedStage.lowMidFrequencyHz;
  lowMidPeakingNode.Q.value = resolvedStage.lowMidQ;
  lowMidPeakingNode.gain.value = resolvedStage.lowMidGainDb;

  const midPeakingNode = context.createBiquadFilter();
  midPeakingNode.type = 'peaking';
  midPeakingNode.frequency.value = AUDIO_EQ_MID_FREQUENCY_HZ;
  midPeakingNode.Q.value = AUDIO_EQ_MID_Q;
  midPeakingNode.gain.value = resolvedStage.midGainDb;

  const highMidPeakingNode = context.createBiquadFilter();
  highMidPeakingNode.type = 'peaking';
  highMidPeakingNode.frequency.value = resolvedStage.highMidFrequencyHz;
  highMidPeakingNode.Q.value = resolvedStage.highMidQ;
  highMidPeakingNode.gain.value = resolvedStage.highMidGainDb;

  const highShelfNode = context.createBiquadFilter();
  highShelfNode.type = 'highshelf';
  highShelfNode.frequency.value = resolvedStage.highFrequencyHz;
  highShelfNode.gain.value = resolvedStage.highGainDb;

  const stageNodes: PreviewClipAudioEqStageNodes = {
    lowCutNodes: createPassNodes(
      context,
      'highpass',
      resolvedStage.lowCutEnabled,
      resolvedStage.lowCutFrequencyHz,
      resolvedStage.lowCutSlopeDbPerOct,
    ),
    lowShelfNode,
    lowMidPeakingNode,
    midPeakingNode,
    highMidPeakingNode,
    highShelfNode,
    highCutNodes: createPassNodes(
      context,
      'lowpass',
      resolvedStage.highCutEnabled,
      resolvedStage.highCutFrequencyHz,
      resolvedStage.highCutSlopeDbPerOct,
    ),
    resolvedStage,
  };

  connectStageInternals(stageNodes);
  return stageNodes;
}

function reconnectPreviewClipAudioGraph(graph: PreviewClipAudioGraph): void {
  graph.sourceInputNode.disconnect();
  for (const stageNodes of graph.eqStageNodes) {
    disconnectStageInternals(stageNodes);
    connectStageInternals(stageNodes);
  }

  let previousNode: AudioNode = graph.sourceInputNode;
  for (const stageNodes of graph.eqStageNodes) {
    previousNode.connect(getStageEntryNode(stageNodes));
    previousNode = getStageExitNode(stageNodes);
  }

  previousNode.connect(graph.outputGainNode);
}

function shouldRebuildStageTopology(
  currentStage: ResolvedAudioEqSettings,
  nextStage: ResolvedAudioEqSettings,
): boolean {
  return (
    currentStage.lowCutEnabled !== nextStage.lowCutEnabled
    || currentStage.lowCutFrequencyHz !== nextStage.lowCutFrequencyHz
    || currentStage.lowCutSlopeDbPerOct !== nextStage.lowCutSlopeDbPerOct
    || currentStage.highCutEnabled !== nextStage.highCutEnabled
    || currentStage.highCutFrequencyHz !== nextStage.highCutFrequencyHz
    || currentStage.highCutSlopeDbPerOct !== nextStage.highCutSlopeDbPerOct
  );
}

function rampAudioParam(
  param: AudioParam,
  targetValue: number,
  startAt: number,
  rampSeconds: number,
): void {
  param.cancelScheduledValues(startAt);
  param.setValueAtTime(param.value, startAt);
  param.linearRampToValueAtTime(targetValue, startAt + rampSeconds);
}

function applyStageParams(
  stageNodes: PreviewClipAudioEqStageNodes,
  targetStage: ResolvedAudioEqSettings,
  startAt?: number,
  rampSeconds?: number,
): void {
  const write = startAt === undefined || rampSeconds === undefined
    ? (param: AudioParam, targetValue: number) => {
      param.value = targetValue;
    }
    : (param: AudioParam, targetValue: number) => {
      rampAudioParam(param, targetValue, startAt, rampSeconds);
    };

  write(stageNodes.lowShelfNode.frequency, targetStage.lowFrequencyHz);
  write(stageNodes.lowShelfNode.gain, targetStage.lowGainDb);
  write(stageNodes.lowMidPeakingNode.frequency, targetStage.lowMidFrequencyHz);
  write(stageNodes.lowMidPeakingNode.Q, targetStage.lowMidQ);
  write(stageNodes.lowMidPeakingNode.gain, targetStage.lowMidGainDb);
  write(stageNodes.midPeakingNode.gain, targetStage.midGainDb);
  write(stageNodes.highMidPeakingNode.frequency, targetStage.highMidFrequencyHz);
  write(stageNodes.highMidPeakingNode.Q, targetStage.highMidQ);
  write(stageNodes.highMidPeakingNode.gain, targetStage.highMidGainDb);
  write(stageNodes.highShelfNode.frequency, targetStage.highFrequencyHz);
  write(stageNodes.highShelfNode.gain, targetStage.highGainDb);
  stageNodes.resolvedStage = targetStage;
}

function ensurePreviewClipEqStage(
  graph: PreviewClipAudioGraph,
  index: number,
  targetStage: ResolvedAudioEqSettings,
): PreviewClipAudioEqStageNodes {
  const currentStage = graph.eqStageNodes[index];
  if (!currentStage) {
    const createdStage = createPreviewClipAudioEqStage(graph.context, targetStage);
    graph.eqStageNodes[index] = createdStage;
    reconnectPreviewClipAudioGraph(graph);
    return createdStage;
  }

  if (shouldRebuildStageTopology(currentStage.resolvedStage, targetStage)) {
    disconnectStageInternals(currentStage);
    graph.eqStageNodes[index] = createPreviewClipAudioEqStage(graph.context, targetStage);
    reconnectPreviewClipAudioGraph(graph);
    return graph.eqStageNodes[index]!;
  }

  return currentStage;
}

export function createPreviewClipAudioGraph(options?: { eqStageCount?: number }): PreviewClipAudioGraph | null {
  const context = getSharedPreviewAudioContext();
  if (!context) {
    return null;
  }

  const sourceInputNode = context.createGain();
  const outputGainNode = context.createGain();
  outputGainNode.gain.value = 0;

  const eqStageCount = Math.max(1, options?.eqStageCount ?? 1);
  const eqStageNodes = Array.from(
    { length: eqStageCount },
    () => createPreviewClipAudioEqStage(context, DEFAULT_AUDIO_EQ_SETTINGS),
  );

  const graph: PreviewClipAudioGraph = {
    context,
    sourceInputNode,
    outputGainNode,
    eqStageNodes,
    dispose: () => {
      sourceInputNode.disconnect();
      for (const stageNodes of eqStageNodes) {
        disconnectStageInternals(stageNodes);
      }
      outputGainNode.disconnect();
    },
  };

  reconnectPreviewClipAudioGraph(graph);
  outputGainNode.connect(context.destination);
  return graph;
}

export function rampPreviewClipGain(
  graph: PreviewClipAudioGraph,
  targetGain: number,
  startAt: number = graph.context.currentTime,
  rampSeconds: number = PREVIEW_AUDIO_GAIN_RAMP_SECONDS,
): void {
  const safeGain = Math.max(0, targetGain);
  const gainParam = graph.outputGainNode.gain;
  gainParam.cancelScheduledValues(startAt);
  gainParam.setValueAtTime(gainParam.value, startAt);
  gainParam.linearRampToValueAtTime(safeGain, startAt + rampSeconds);
}

export function setPreviewClipGain(
  graph: PreviewClipAudioGraph,
  targetGain: number,
): void {
  graph.outputGainNode.gain.value = Math.max(0, targetGain);
}

export function rampPreviewClipEq(
  graph: PreviewClipAudioGraph,
  targetStages: ReadonlyArray<ResolvedAudioEqSettings> | undefined,
  startAt: number = graph.context.currentTime,
  rampSeconds: number = PREVIEW_AUDIO_EQ_RAMP_SECONDS,
): void {
  const targetCount = targetStages?.length ?? 0;
  const iterCount = Math.max(graph.eqStageNodes.length, targetCount);
  for (let i = 0; i < iterCount; i++) {
    const targetStage = targetStages?.[i] ?? DEFAULT_AUDIO_EQ_SETTINGS;
    const stageNodes = ensurePreviewClipEqStage(graph, i, targetStage);
    applyStageParams(stageNodes, targetStage, startAt, rampSeconds);
  }
}

export function setPreviewClipEq(
  graph: PreviewClipAudioGraph,
  targetStages: ReadonlyArray<ResolvedAudioEqSettings> | undefined,
): void {
  const targetCount = targetStages?.length ?? 0;
  const iterCount = Math.max(graph.eqStageNodes.length, targetCount);
  for (let i = 0; i < iterCount; i++) {
    const targetStage = targetStages?.[i] ?? DEFAULT_AUDIO_EQ_SETTINGS;
    const stageNodes = ensurePreviewClipEqStage(graph, i, targetStage);
    applyStageParams(stageNodes, targetStage);
  }
}
