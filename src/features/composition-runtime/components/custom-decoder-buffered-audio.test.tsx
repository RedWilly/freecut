import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const audioDecodeMocks = vi.hoisted(() => ({
  getOrDecodeAudio: vi.fn(),
  getOrDecodeAudioForPlayback: vi.fn(),
  isPreviewAudioDecodePending: vi.fn(() => false),
}));

vi.mock('../utils/audio-decode-cache', () => audioDecodeMocks);

vi.mock('./hooks/use-audio-playback-state', () => ({
  useAudioPlaybackState: vi.fn(() => ({
    frame: 0,
    fps: 30,
    playing: false,
    resolvedVolume: 1,
  })),
}));

import { CustomDecoderBufferedAudio } from './custom-decoder-buffered-audio';

describe('CustomDecoderBufferedAudio', () => {
  beforeAll(() => {
    class AudioParamMock {
      value = 0;
      cancelScheduledValues() {}
      setValueAtTime(value: number) {
        this.value = value;
      }
      linearRampToValueAtTime(value: number) {
        this.value = value;
      }
    }

    class GainNodeMock {
      gain = new AudioParamMock();
      connect() {}
      disconnect() {}
    }

    class AudioBufferSourceNodeMock {
      buffer: AudioBuffer | null = null;
      playbackRate = new AudioParamMock();
      onended: (() => void) | null = null;
      connect() {}
      disconnect() {}
      start() {}
      stop() {}
    }

    class AudioContextMock {
      currentTime = 0;
      state: AudioContextState = 'running';
      destination = {};
      createGain() {
        return new GainNodeMock();
      }
      createBufferSource() {
        return new AudioBufferSourceNodeMock();
      }
      resume() {
        return Promise.resolve();
      }
    }

    vi.stubGlobal('AudioContext', AudioContextMock);
    vi.stubGlobal('webkitAudioContext', AudioContextMock);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    const pendingDecode = new Promise<AudioBuffer>(() => {});
    audioDecodeMocks.getOrDecodeAudioForPlayback.mockReturnValue(pendingDecode);
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(pendingDecode);
  });

  it('starts with partial decode playback and continues full decode in background', async () => {
    render(
      <CustomDecoderBufferedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
      />
    );

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioForPlayback).toHaveBeenCalledWith(
        'media-1',
        'blob:audio',
        {
          minReadySeconds: 8,
          waitTimeoutMs: 6000,
        },
      );
    });

    expect(audioDecodeMocks.getOrDecodeAudio).toHaveBeenCalledWith('media-1', 'blob:audio');
  });
});
