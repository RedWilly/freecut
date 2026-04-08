import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaMetadata } from '@/types/storage';

const mediaLibraryServiceMocks = vi.hoisted(() => ({
  getMediaForProject: vi.fn(),
  getMediaBlobUrl: vi.fn(),
}));

const proxyServiceMocks = vi.hoisted(() => ({
  clearProxyKey: vi.fn(),
  needsProxy: vi.fn(),
  setProxyKey: vi.fn(),
  loadExistingProxies: vi.fn(),
  generateProxy: vi.fn(),
  onStatusChange: vi.fn(),
}));

const indexedDbMocks = vi.hoisted(() => ({
  getTranscriptMediaIds: vi.fn(),
}));

const loggerEventMocks = vi.hoisted(() => ({
  set: vi.fn(),
  merge: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
}));

const loggerMocks = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  event: vi.fn(),
  startEvent: vi.fn(() => loggerEventMocks),
  child: vi.fn(),
  setLevel: vi.fn(),
}));

vi.mock('../services/media-library-service', () => ({
  mediaLibraryService: mediaLibraryServiceMocks,
}));

vi.mock('../services/proxy-service', () => ({
  proxyService: proxyServiceMocks,
}));

vi.mock('../utils/proxy-key', () => ({
  getSharedProxyKey: vi.fn((media: { id: string }) => `proxy-${media.id}`),
}));

vi.mock('@/infrastructure/storage/indexeddb', () => ({
  getTranscriptMediaIds: indexedDbMocks.getTranscriptMediaIds,
}));

vi.mock('./media-import-actions', () => ({
  createImportActions: vi.fn(() => ({})),
}));

vi.mock('./media-delete-actions', () => ({
  createDeleteActions: vi.fn(() => ({})),
}));

vi.mock('./media-relinking-actions', () => ({
  createRelinkingActions: vi.fn(() => ({})),
}));

vi.mock('@/shared/logging/logger', () => ({
  createOperationId: vi.fn(() => 'test-op-id'),
  createLogger: vi.fn(() => loggerMocks),
}));

import { useMediaLibraryStore } from './media-library-store';

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

function resetStore(): void {
  useMediaLibraryStore.setState({
    currentProjectId: null,
    mediaItems: [],
    mediaById: {},
    isLoading: false,
    importingIds: [],
    error: null,
    errorLink: null,
    notification: null,
    selectedMediaIds: [],
    selectedCompositionIds: [],
    searchQuery: '',
    filterByType: null,
    sortBy: 'date',
    viewMode: 'grid',
    mediaItemSize: 1,
    brokenMediaIds: [],
    brokenMediaInfo: new Map(),
    showMissingMediaDialog: false,
    orphanedClips: [],
    showOrphanedClipsDialog: false,
    unsupportedCodecFiles: [],
    showUnsupportedCodecDialog: false,
    unsupportedCodecResolver: null,
    proxyStatus: new Map(),
    proxyProgress: new Map(),
    transcriptStatus: new Map(),
    transcriptProgress: new Map(),
  });
}

describe('useMediaLibraryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('clears loading without fetching when no project is selected', async () => {
    useMediaLibraryStore.setState({ isLoading: true, currentProjectId: null });

    await useMediaLibraryStore.getState().loadMediaItems();

    expect(useMediaLibraryStore.getState().isLoading).toBe(false);
    expect(mediaLibraryServiceMocks.getMediaForProject).not.toHaveBeenCalled();
  });

  it('loads media, transcript availability, and stale proxies for the current project', async () => {
    const video = makeMedia({ id: 'video-1', fileName: 'video.mp4' });
    const audio = makeMedia({
      id: 'audio-1',
      fileName: 'audio.mp3',
      mimeType: 'audio/mpeg',
      width: 0,
      height: 0,
    });

    mediaLibraryServiceMocks.getMediaForProject.mockResolvedValue([video, audio]);
    mediaLibraryServiceMocks.getMediaBlobUrl.mockResolvedValue('blob:video-1');
    indexedDbMocks.getTranscriptMediaIds.mockResolvedValue(new Set(['video-1']));
    proxyServiceMocks.needsProxy.mockImplementation((_w, _h, mimeType: string) => mimeType.startsWith('video/'));
    proxyServiceMocks.loadExistingProxies.mockResolvedValue(['video-1']);

    useMediaLibraryStore.setState({ currentProjectId: 'project-1' });

    await useMediaLibraryStore.getState().loadMediaItems();

    const state = useMediaLibraryStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.mediaItems).toEqual([video, audio]);
    expect(state.mediaById['video-1']).toEqual(video);
    expect(state.mediaById['audio-1']).toEqual(audio);
    expect(state.transcriptStatus.get('video-1')).toBe('ready');
    expect(state.transcriptStatus.get('audio-1')).toBe('idle');
    expect(proxyServiceMocks.setProxyKey).toHaveBeenCalledWith('video-1', 'proxy-video-1');
    expect(proxyServiceMocks.loadExistingProxies).toHaveBeenCalledWith(['video-1']);
    expect(proxyServiceMocks.generateProxy).toHaveBeenCalledWith(
      'video-1',
      'blob:video-1',
      3840,
      2160,
      'proxy-video-1'
    );
  });

  it('falls back to idle transcript status when transcript lookup fails', async () => {
    const video = makeMedia({ id: 'video-1' });
    mediaLibraryServiceMocks.getMediaForProject.mockResolvedValue([video]);
    indexedDbMocks.getTranscriptMediaIds.mockRejectedValue(new Error('boom'));
    proxyServiceMocks.needsProxy.mockReturnValue(false);

    useMediaLibraryStore.setState({ currentProjectId: 'project-1' });

    await useMediaLibraryStore.getState().loadMediaItems();

    const state = useMediaLibraryStore.getState();
    expect(state.transcriptStatus.get('video-1')).toBe('idle');
    expect(proxyServiceMocks.loadExistingProxies).not.toHaveBeenCalled();
  });
});
