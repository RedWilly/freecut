import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MouseEvent, ReactNode } from 'react';
import type { MediaMetadata } from '@/types/storage';

const mediaLibraryServiceMocks = vi.hoisted(() => ({
  getThumbnailBlobUrl: vi.fn(),
  getMediaBlobUrl: vi.fn(),
}));

const proxyServiceMocks = vi.hoisted(() => ({
  needsProxy: vi.fn(),
  setProxyKey: vi.fn(),
  generateProxy: vi.fn(),
  deleteProxy: vi.fn(),
  clearProxyKey: vi.fn(),
}));

const mediaTranscriptionServiceMocks = vi.hoisted(() => ({
  transcribeMedia: vi.fn(),
}));

const mediaStoreState = vi.hoisted(() => ({
  selectedMediaIds: [] as string[],
  mediaItems: [] as MediaMetadata[],
  importingIds: [] as string[],
  proxyStatus: new Map<string, 'generating' | 'ready' | 'error'>(),
  proxyProgress: new Map<string, number>(),
  transcriptStatus: new Map<string, 'idle' | 'transcribing' | 'ready' | 'error'>(),
  transcriptProgress: new Map(),
  setProxyStatus: vi.fn(),
  clearProxyStatus: vi.fn(),
  setTranscriptStatus: vi.fn(),
  setTranscriptProgress: vi.fn(),
  clearTranscriptProgress: vi.fn(),
  showNotification: vi.fn(),
}));

const editorStoreState = vi.hoisted(() => ({
  setMediaSkimPreview: vi.fn(),
  clearMediaSkimPreview: vi.fn(),
  mediaSkimPreviewMediaId: null as string | null,
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
  }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
  }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
}));

vi.mock('./media-info-popover', () => ({
  MediaInfoPopover: () => <div data-testid="media-info-popover" />,
}));

vi.mock('../services/media-library-service', () => ({
  mediaLibraryService: mediaLibraryServiceMocks,
}));

vi.mock('../services/proxy-service', () => ({
  proxyService: proxyServiceMocks,
}));

vi.mock('../services/media-transcription-service', () => ({
  mediaTranscriptionService: mediaTranscriptionServiceMocks,
}));

vi.mock('../stores/media-library-store', () => {
  const useMediaLibraryStore = Object.assign(
    (selector: (state: typeof mediaStoreState) => unknown) => selector(mediaStoreState),
    {
      getState: () => mediaStoreState,
    }
  );

  return { useMediaLibraryStore };
});

vi.mock('@/shared/state/editor', () => {
  const useEditorStore = Object.assign(
    (selector: (state: typeof editorStoreState) => unknown) => selector(editorStoreState),
    {
      getState: () => editorStoreState,
    }
  );

  return { useEditorStore };
});

vi.mock('../utils/proxy-key', () => ({
  getSharedProxyKey: vi.fn((media: { id: string }) => `proxy-${media.id}`),
}));

vi.mock('../utils/drag-data-cache', () => ({
  setMediaDragData: vi.fn(),
  clearMediaDragData: vi.fn(),
}));

vi.mock('@/shared/state/local-inference', () => ({
  isLocalInferenceCancellationError: vi.fn(() => false),
}));

import { MediaCard } from './media-card';

function makeMedia(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: 'media-1',
    storageType: 'handle',
    fileName: 'clip.mp4',
    fileSize: 1024,
    mimeType: 'video/mp4',
    duration: 5,
    width: 3840,
    height: 2160,
    fps: 30,
    codec: 'h264',
    bitrate: 5000,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('MediaCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mediaStoreState.selectedMediaIds = [];
    mediaStoreState.mediaItems = [makeMedia()];
    mediaStoreState.importingIds = [];
    mediaStoreState.proxyStatus = new Map();
    mediaStoreState.proxyProgress = new Map();
    mediaStoreState.transcriptStatus = new Map();
    mediaStoreState.transcriptProgress = new Map();

    mediaLibraryServiceMocks.getThumbnailBlobUrl.mockResolvedValue(null);
    mediaLibraryServiceMocks.getMediaBlobUrl.mockResolvedValue('blob:media-1');
    proxyServiceMocks.needsProxy.mockReturnValue(true);
    proxyServiceMocks.deleteProxy.mockResolvedValue(undefined);
    mediaTranscriptionServiceMocks.transcribeMedia.mockResolvedValue(undefined);
  });

  it('uses the shared action menu to generate a proxy', async () => {
    const media = makeMedia();
    render(<MediaCard media={media} viewMode="list" />);

    fireEvent.click(screen.getByText('Generate Proxy'));

    await waitFor(() => {
      expect(mediaLibraryServiceMocks.getMediaBlobUrl).toHaveBeenCalledWith('media-1');
    });
    expect(proxyServiceMocks.setProxyKey).toHaveBeenCalledWith('media-1', 'proxy-media-1');
    expect(proxyServiceMocks.generateProxy).toHaveBeenCalledWith(
      'media-1',
      'blob:media-1',
      3840,
      2160,
      'proxy-media-1'
    );
  });

  it('uses the shared action menu to relink broken media in grid view', () => {
    const onRelink = vi.fn();
    render(<MediaCard media={makeMedia()} isBroken onRelink={onRelink} viewMode="grid" />);

    fireEvent.click(screen.getByText('Relink File...'));

    expect(onRelink).toHaveBeenCalledTimes(1);
  });
});
