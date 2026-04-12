export const PREVIEW_AUDIO_GAIN_RAMP_SECONDS = 0.008;

export interface PreviewClipAudioGraph {
  context: AudioContext;
  sourceInputNode: GainNode;
  outputGainNode: GainNode;
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

/**
 * Shared clip graph used by preview audio sources.
 *
 * Current chain:
 *   source -> sourceInputNode -> outputGainNode -> destination
 *
 * Future EQ/SFX nodes should be inserted between `sourceInputNode` and
 * `outputGainNode` so both MediaElement and AudioBuffer sources can share the
 * same clip-level processing path.
 */
export function createPreviewClipAudioGraph(): PreviewClipAudioGraph | null {
  const context = getSharedPreviewAudioContext();
  if (!context) {
    return null;
  }

  const sourceInputNode = context.createGain();
  const outputGainNode = context.createGain();
  outputGainNode.gain.value = 0;

  sourceInputNode.connect(outputGainNode);
  outputGainNode.connect(context.destination);

  return {
    context,
    sourceInputNode,
    outputGainNode,
    dispose: () => {
      sourceInputNode.disconnect();
      outputGainNode.disconnect();
    },
  };
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
