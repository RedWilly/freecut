import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { CompositionInputProps } from '@/types/export';

const playbackState = vi.hoisted(() => ({
  zoom: -1,
  useProxy: true,
}));

const compositionState = vi.hoisted(() => {
  const composition = {
    id: 'composition-1',
    name: 'Compound 1',
    fps: 30,
    width: 1280,
    height: 720,
    durationInFrames: 90,
    items: [],
    tracks: [],
    transitions: [],
    keyframes: [],
    backgroundColor: '#000000',
  };

  return {
    composition,
    compositionById: {
      'composition-1': composition,
    } as Record<string, typeof composition | undefined>,
  };
});

const buildSubCompositionInputMock = vi.hoisted(() => vi.fn());
const collectSubCompositionMediaIdsMock = vi.hoisted(() => vi.fn());
const resolveMediaUrlMock = vi.hoisted(() => vi.fn());
const resolveMediaUrlsMock = vi.hoisted(() => vi.fn());

vi.mock('@/shared/state/playback', () => {
  const usePlaybackStore = Object.assign(
    (selector: (state: typeof playbackState) => unknown) => selector(playbackState),
    { getState: () => playbackState },
  );

  return { usePlaybackStore };
});

vi.mock('@/features/preview/deps/player-context', () => ({
  PlayerEmitterProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ClockBridgeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  VideoConfigProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useClock: () => ({
    seekToFrame: vi.fn(),
  }),
}));

vi.mock('@/features/preview/deps/timeline-contract', () => {
  const useCompositionsStore = Object.assign(
    (selector: (state: typeof compositionState) => unknown) => selector(compositionState),
    { getState: () => compositionState },
  );

  return {
    useCompositionsStore,
    buildSubCompositionInput: buildSubCompositionInputMock,
    collectSubCompositionMediaIds: collectSubCompositionMediaIdsMock,
  };
});

vi.mock('@/features/preview/deps/media-library-contract', () => ({
  resolveMediaUrl: resolveMediaUrlMock,
  resolveMediaUrls: resolveMediaUrlsMock,
}));

vi.mock('@/features/preview/deps/composition-runtime-contract', () => ({
  MainComposition: ({ useProxyMedia }: { useProxyMedia?: boolean }) => (
    <div data-testid="main-composition" data-use-proxy-media={useProxyMedia ? 'true' : 'false'} />
  ),
}));

import { InlineCompositionPreview } from './inline-composition-preview';

describe('InlineCompositionPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    playbackState.zoom = -1;
    playbackState.useProxy = true;

    const inputProps: CompositionInputProps = {
      fps: 30,
      durationInFrames: 90,
      width: 1280,
      height: 720,
      tracks: [{
        id: 'track-1',
        name: 'V1',
        kind: 'video',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      }],
      transitions: [],
      keyframes: [],
      backgroundColor: '#000000',
    };

    buildSubCompositionInputMock.mockReturnValue(inputProps);
    collectSubCompositionMediaIdsMock.mockReturnValue(['media-1']);
    resolveMediaUrlMock.mockResolvedValue('blob:media-1');
    resolveMediaUrlsMock.mockResolvedValue(inputProps.tracks);
  });

  it('resolves compound clip tracks with proxy playback when enabled', async () => {
    render(
      <InlineCompositionPreview
        compositionId="composition-1"
        seekFrame={12}
        containerSize={{ width: 800, height: 600 }}
      />
    );

    await waitFor(() => {
      expect(resolveMediaUrlsMock).toHaveBeenCalledWith(expect.any(Array), { useProxy: true });
    });

    expect(screen.getByTestId('main-composition')).toHaveAttribute('data-use-proxy-media', 'true');
  });
});
