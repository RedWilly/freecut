import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TimelineItem } from '@/types/timeline';
import { useSettingsStore } from '@/features/timeline/deps/settings';
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store';
import { useItemsStore } from '../../stores/items-store';
import { ClipContent } from './clip-content';

describe('ClipContent', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      showFilmstrips: false,
      showWaveforms: false,
    });
    useMediaLibraryStore.setState({
      mediaItems: [],
      mediaById: {},
      brokenMediaIds: [],
      selectedMediaIds: [],
      notification: null,
    });
    useItemsStore.getState().setItems([]);
  });

  it('renders the linked delta badge before the clip title text', () => {
    const item: TimelineItem = {
      id: 'video-1',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Clip title',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem;

    render(
      <ClipContent
        item={item}
        clipWidth={320}
        fps={30}
        isLinked={true}
        isClipVisible={true}
        pixelsPerSecond={30}
        linkedSyncOffsetFrames={-283}
      />,
    );

    expect(screen.getByText('-09:13')).toBeInTheDocument();
    expect(screen.getByTitle('Linked audio/video pair out of sync by -09:13')).toBeInTheDocument();
    expect(screen.getByText('Clip title')).toBeInTheDocument();
  });

  it('renders the linked icon before the title when clips are still in sync', () => {
    const item: TimelineItem = {
      id: 'video-1',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Linked clip',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem;

    render(
      <ClipContent
        item={item}
        clipWidth={320}
        fps={30}
        isLinked={true}
        isClipVisible={true}
        pixelsPerSecond={30}
      />,
    );

    expect(screen.getByTitle('Linked audio/video pair')).toBeInTheDocument();
    expect(screen.getByText('Linked clip')).toBeInTheDocument();
  });
});
