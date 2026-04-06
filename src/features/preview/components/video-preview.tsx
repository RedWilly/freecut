import { useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback, memo } from 'react';
import { getDecoderPrewarmMetricsSnapshot } from '../utils/decoder-prewarm';
import { Player, type PlayerRef } from '@/features/preview/deps/player-core';
import type { CaptureOptions, PreviewQuality } from '@/shared/state/playback';
import { usePlaybackStore } from '@/shared/state/playback';
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge';
import {
  useTimelineStore,
  useItemsStore,
  useTransitionsStore,
  useMediaDependencyStore,
} from '@/features/preview/deps/timeline-store';
import { resolveEffectiveTrackStates } from '@/features/preview/deps/timeline-utils';
import {
  useRollingEditPreviewStore,
  useRippleEditPreviewStore,
  useSlipEditPreviewStore,
  useSlideEditPreviewStore,
} from '@/features/preview/deps/timeline-edit-preview';
import { useSelectionStore } from '@/shared/state/selection';
import { MainComposition } from '@/features/preview/deps/composition-runtime';
import { resolveProxyUrl } from '../utils/media-resolver';
import { useMediaLibraryStore } from '@/features/preview/deps/media-library';
import { useBlobUrlVersion } from '@/infrastructure/browser/blob-url-manager';
import { GizmoOverlay } from './gizmo-overlay';
import { MaskEditorContainer } from './mask-editor-container';
import { CornerPinContainer } from './corner-pin-container';
import { RollingEditOverlay } from './rolling-edit-overlay';
import { RippleEditOverlay } from './ripple-edit-overlay';
import { SlipEditOverlay } from './slip-edit-overlay';
import { SlideEditOverlay } from './slide-edit-overlay';
import { useGizmoStore } from '../stores/gizmo-store';
import { useCornerPinStore } from '../stores/corner-pin-store';
import { useMaskEditorStore } from '../stores/mask-editor-store';
import type { CompositionInputProps } from '@/types/export';
import type { ItemEffect } from '@/types/effects';
import type { TimelineItem } from '@/types/timeline';
import type { ResolvedTransform } from '@/types/transform';
import { isMarqueeJustFinished } from '@/hooks/use-marquee-selection';
import { createCompositionRenderer } from '@/features/preview/deps/export';
import {
  resolveTransitionWindows,
  type ResolvedTransitionWindow,
} from '@/domain/timeline/transitions/transition-planner';
import {
  getPreviewRuntimeSnapshotFromPlaybackState,
} from '../utils/preview-state-coordinator';
import {
  recordSeekLatency,
  recordSeekLatencyTimeout,
  type SeekLatencyStats,
} from '../utils/preview-perf-metrics';
import {
  createAdaptivePreviewQualityState,
  getEffectivePreviewQuality,
  getFrameBudgetMs,
  updateAdaptivePreviewQuality,
} from '../utils/adaptive-preview-quality';
import { shouldPreferPlayerForStyledTextScrub as shouldPreferPlayerForStyledTextScrubGuard } from '../utils/text-render-guard';
import {
  shouldForceContinuousPreviewOverlay,
  useGpuEffectsOverlay,
} from '../hooks/use-gpu-effects-overlay';
import { useCustomPlayer } from '../hooks/use-custom-player';
import { usePreviewCaptureBridge } from '../hooks/use-preview-capture-bridge';
import { usePreviewMediaResolution } from '../hooks/use-preview-media-resolution';
import { usePreviewMediaPreload } from '../hooks/use-preview-media-preload';
import { usePreviewOverlayController } from '../hooks/use-preview-overlay-controller';
import { usePreviewRenderPump } from '../hooks/use-preview-render-pump-controller';
import { usePreviewSourceWarm } from '../hooks/use-preview-source-warm';
import {
  usePreviewTransitionSessionController,
  type TransitionPreviewSessionTrace,
  type TransitionPreviewTelemetry,
} from '../hooks/use-preview-transition-session-controller';
import { createLogger } from '@/shared/logging/logger';
import { EDITOR_LAYOUT_CSS_VALUES } from '@/shared/ui/editor-layout';
import { isFrameInRanges } from '@/shared/utils/frame-invalidation';

// DEV-only: cached reference loaded via dynamic import so the module
// is excluded from production bundles entirely.
let _devJitterMonitor: import('@/shared/logging/frame-jitter-monitor').FrameJitterMonitor | null = null;
if (import.meta.env.DEV) {
  void import('@/shared/logging/frame-jitter-monitor').then((m) => {
    _devJitterMonitor = m.getFrameJitterMonitor();
  });
}
import {
  FAST_SCRUB_RENDERER_ENABLED,
  FAST_SCRUB_PRELOAD_BUDGET_MS,
  PREVIEW_PERF_PUBLISH_INTERVAL_MS,
  PREVIEW_PERF_PANEL_STORAGE_KEY,
  PREVIEW_PERF_PANEL_QUERY_KEY,
  PREVIEW_PERF_SEEK_TIMEOUT_MS,
  ADAPTIVE_PREVIEW_QUALITY_ENABLED,
  type VideoSourceSpan,
  type FastScrubBoundarySource,
  type PreviewPerfSnapshot,
  toTrackFingerprint,
  getMediaResolveCost,
  parsePreviewPerfPanelQuery,
  blobToDataUrl,
} from '../utils/preview-constants';
import { collectVisualInvalidationRanges } from '../utils/preview-frame-invalidation';

const logger = createLogger('VideoPreview');

type CompositionRenderer = Awaited<ReturnType<typeof createCompositionRenderer>>;

interface VideoPreviewProps {
  project: {
    width: number;
    height: number;
    backgroundColor?: string;
  };
  containerSize: {
    width: number;
    height: number;
  };
  suspendOverlay?: boolean;
}

/**
 * Video Preview Component
 *
 * Displays the custom Player with:
 * - Real-time video rendering
 * - Bidirectional sync with timeline
 * - Responsive sizing based on zoom and container
 * - Frame counter
 * - Fullscreen toggle
 *
 * Memoized to prevent expensive Player re-renders.
 */
export const VideoPreview = memo(function VideoPreview({
  project,
  containerSize,
  suspendOverlay = false,
}: VideoPreviewProps) {
  const playerRef = useRef<PlayerRef>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const scrubCanvasRef = useRef<HTMLCanvasElement>(null);
  const gpuEffectsCanvasRef = useRef<HTMLCanvasElement>(null);
  const scrubFrameDirtyRef = useRef(false);
  const bypassPreviewSeekRef = useRef(false);
  const scrubRendererRef = useRef<CompositionRenderer | null>(null);
  const ensureFastScrubRendererRef = useRef<() => Promise<CompositionRenderer | null>>(async () => null);
  const scrubInitPromiseRef = useRef<Promise<CompositionRenderer | null> | null>(null);
  const scrubPreloadPromiseRef = useRef<Promise<void> | null>(null);
  const scrubOffscreenCanvasRef = useRef<OffscreenCanvas | null>(null);
  const scrubOffscreenCtxRef = useRef<OffscreenCanvasRenderingContext2D | null>(null);
  const scrubRendererStructureKeyRef = useRef<string | null>(null);
  const scrubRenderInFlightRef = useRef(false);
  const scrubRenderGenerationRef = useRef(0);
  const scrubRequestedFrameRef = useRef<number | null>(null);
  // Dedicated background renderer for transition pre-rendering.
  // Separate from the main scrub renderer so pre-renders don't conflict
  // with the rAF pump's render loop (different canvas, different decoders).
  const bgTransitionRendererRef = useRef<CompositionRenderer | null>(null);
  const bgTransitionInitPromiseRef = useRef<Promise<CompositionRenderer | null> | null>(null);
  const bgTransitionRendererStructureKeyRef = useRef<string | null>(null);
  const bgTransitionRenderInFlightRef = useRef(false);
  const scrubPrewarmQueueRef = useRef<number[]>([]);
  const scrubPrewarmQueuedSetRef = useRef<Set<number>>(new Set());
  const scrubPrewarmedFramesRef = useRef<number[]>([]);
  const scrubPrewarmedFrameSetRef = useRef<Set<number>>(new Set());
  const scrubPrewarmedSourcesRef = useRef<Set<string>>(new Set());
  const scrubPrewarmedSourceOrderRef = useRef<string[]>([]);
  const scrubPrewarmedSourceTouchFrameRef = useRef<Map<string, number>>(new Map());
  const scrubOffscreenRenderedFrameRef = useRef<number | null>(null);
  const playbackTransitionPreparePromiseRef = useRef<Promise<boolean> | null>(null);
  const playbackTransitionPreparingFrameRef = useRef<number | null>(null);
  const deferredPlaybackTransitionPrepareFrameRef = useRef<number | null>(null);
  const transitionPrepareTimeoutRef = useRef<number | null>(null);
  const transitionSessionWindowRef = useRef<ResolvedTransitionWindow<TimelineItem> | null>(null);
  const transitionSessionPinnedElementsRef = useRef<Map<string, HTMLVideoElement | null>>(new Map());
  const transitionExitElementsRef = useRef<Map<string, HTMLVideoElement | null>>(new Map());
  const transitionSessionStallCountRef = useRef<Map<string, { ct: number; count: number }>>(new Map());
  const transitionSessionBufferedFramesRef = useRef<Map<number, OffscreenCanvas>>(new Map());
  const transitionPrewarmPromiseRef = useRef<Promise<void> | null>(null);
  const captureCanvasSourceInFlightRef = useRef<Promise<OffscreenCanvas | HTMLCanvasElement | null> | null>(null);
  const captureInFlightRef = useRef<Promise<string | null> | null>(null);
  const captureImageDataInFlightRef = useRef<Promise<ImageData | null> | null>(null);
  const captureScaleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrubDirectionRef = useRef<-1 | 0 | 1>(0);
  const suppressScrubBackgroundPrewarmRef = useRef(false);
  const fallbackToPlayerScrubRef = useRef(false);
  const lastForwardScrubPreloadAtRef = useRef(0);
  const lastBackwardScrubPreloadAtRef = useRef(0);
  const lastBackwardScrubRenderAtRef = useRef(0);
  const lastBackwardRequestedFrameRef = useRef<number | null>(null);
  const resumeScrubLoopRef = useRef<() => void>(() => {});
  const scrubMountedRef = useRef(true);
  const pendingSeekLatencyRef = useRef<{ targetFrame: number; startedAtMs: number } | null>(null);
  const seekLatencyStatsRef = useRef<SeekLatencyStats>({
    samples: 0,
    totalMs: 0,
    lastMs: 0,
    timeouts: 0,
  });
  const [showPerfPanel, setShowPerfPanel] = useState(false);
  const [perfPanelSnapshot, setPerfPanelSnapshot] = useState<PreviewPerfSnapshot | null>(null);
  const transitionSessionTraceRef = useRef<TransitionPreviewSessionTrace | null>(null);
  const transitionTelemetryRef = useRef<TransitionPreviewTelemetry>({
    sessionCount: 0,
    lastPrepareMs: 0,
    lastReadyLeadMs: 0,
    lastEntryMisses: 0,
    lastSessionDurationMs: 0,
  });
  const lastPausedPrearmTargetRef = useRef<number | null>(null);
  const lastPlayingPrearmTargetRef = useRef<number | null>(null);

  // State for gizmo overlay positioning
  const [playerContainerRect, setPlayerContainerRect] = useState<DOMRect | null>(null);

  // Callback ref that measures immediately when element is available
  const setPlayerContainerRefCallback = useCallback((el: HTMLDivElement | null) => {
    playerContainerRef.current = el;
    if (el) {
      setPlayerContainerRect(el.getBoundingClientRect());
    }
  }, []);

  // Granular selectors - avoid subscribing to currentFrame here to prevent re-renders
  const fps = useTimelineStore((s) => s.fps);
  const tracks = useTimelineStore((s) => s.tracks);
  const keyframes = useTimelineStore((s) => s.keyframes);
  const items = useItemsStore((s) => s.items);
  const itemsByTrackId = useItemsStore((s) => s.itemsByTrackId);
  const mediaDependencyVersion = useMediaDependencyStore((s) => s.mediaDependencyVersion);
  const transitions = useTransitionsStore((s) => s.transitions);
  const mediaById = useMediaLibraryStore((s) => s.mediaById);
  const brokenMediaCount = useMediaLibraryStore((s) => s.brokenMediaIds.length);
  const hasRolling2Up = useRollingEditPreviewStore(
    (s) => Boolean(s.trimmedItemId && s.neighborItemId && s.handle),
  );
  const hasRipple2Up = useRippleEditPreviewStore((s) => Boolean(s.trimmedItemId && s.handle));
  const hasSlip4Up = useSlipEditPreviewStore((s) => Boolean(s.itemId));
  const hasSlide4Up = useSlideEditPreviewStore((s) => Boolean(s.itemId));
  const activeGizmoItemId = useGizmoStore((s) => s.activeGizmo?.itemId ?? null);
  const isGizmoInteracting = useGizmoStore((s) => s.activeGizmo !== null);
  const isMaskEditingActive = useMaskEditorStore((s) => s.isEditing);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const showGpuEffectsOverlay = useGpuEffectsOverlay(gpuEffectsCanvasRef, playerContainerRef, scrubOffscreenCanvasRef, scrubFrameDirtyRef);
  const zoom = usePlaybackStore((s) => s.zoom);
  const useProxy = usePlaybackStore((s) => s.useProxy);
  // Derive a stable count of ready proxies to avoid recomputing resolvedTracks
  // on every proxyStatus Map recreation (e.g. during progress updates)
  const proxyReadyCount = useMediaLibraryStore((s) => {
    let count = 0;
    for (const status of s.proxyStatus.values()) {
      if (status === 'ready') count++;
    }
    return count;
  });
  const activeGizmoItemType = useMemo(
    () => activeGizmoItemId
      ? (items.find((item) => item.id === activeGizmoItemId)?.type ?? null)
      : null,
    [activeGizmoItemId, items]
  );
  const isGizmoInteractingRef = useRef(isGizmoInteracting);
  isGizmoInteractingRef.current = isGizmoInteracting;
  const preferPlayerForTextGizmoRef = useRef(false);
  const preferPlayerForStyledTextScrubRef = useRef(false);
  const adaptiveQualityStateRef = useRef(createAdaptivePreviewQualityState(1));
  const adaptiveFrameSampleRef = useRef<{ frame: number; tsMs: number } | null>(null);
  const [adaptiveQualityCap, setAdaptiveQualityCap] = useState<PreviewQuality>(1);
  const blobUrlVersion = useBlobUrlVersion();

  const shouldPreferPlayerForPreview = useCallback((previewFrame: number | null) => {
    return (
      preferPlayerForTextGizmoRef.current
      || (preferPlayerForStyledTextScrubRef.current && previewFrame !== null)
    );
  }, []);

  const setCaptureFrame = usePreviewBridgeStore((s) => s.setCaptureFrame);
  const setCaptureFrameImageData = usePreviewBridgeStore((s) => s.setCaptureFrameImageData);
  const setDisplayedFrame = usePreviewBridgeStore((s) => s.setDisplayedFrame);

  const {
    isRenderedOverlayVisible,
    showFastScrubOverlayRef,
    showPlaybackTransitionOverlayRef,
    renderSourceRef,
    renderSourceSwitchCountRef,
    renderSourceHistoryRef,
    pendingFastScrubHandoffFrameRef,
    clearPendingFastScrubHandoff,
    hideFastScrubOverlay,
    hidePlaybackTransitionOverlay,
    maybeCompleteFastScrubHandoff,
    scheduleFastScrubHandoffCheck,
    beginFastScrubHandoff,
    showFastScrubOverlayForFrame,
    showPlaybackTransitionOverlayForFrame,
  } = usePreviewOverlayController({
    playerRef,
    bypassPreviewSeekRef,
    shouldPreferPlayerForPreview,
    setDisplayedFrame,
  });

  const pushTransitionTrace = useCallback((phase: string, data: Record<string, unknown> = {}) => {
    if (!import.meta.env.DEV) return;

    const nextEntry: Record<string, unknown> = {
      ts: Date.now(),
      phase,
      renderSource: renderSourceRef.current,
      currentFrame: usePlaybackStore.getState().currentFrame,
      ...data,
    };
    const history = window.__PREVIEW_TRANSITIONS__ ?? [];
    window.__PREVIEW_TRANSITIONS__ = [...history.slice(-99), nextEntry];
  }, [renderSourceRef]);

  const recordRenderFrameJitter = useCallback((
    frame: number,
    renderMs: number,
    inTransition: boolean,
    transitionId: string | null,
    progress: number | null,
  ) => {
    _devJitterMonitor?.recordRenderFrame(frame, renderMs, inTransition, transitionId, progress);
  }, []);

  const trackPlayerSeek = useCallback((targetFrame: number) => {
    if (!import.meta.env.DEV) return;
    pendingSeekLatencyRef.current = {
      targetFrame,
      startedAtMs: performance.now(),
    };
  }, []);

  const resolvePendingSeekLatency = useCallback((frame: number) => {
    if (!import.meta.env.DEV) return;
    const pending = pendingSeekLatencyRef.current;
    if (!pending) return;
    if (pending.targetFrame !== frame) return;
    seekLatencyStatsRef.current = recordSeekLatency(
      seekLatencyStatsRef.current,
      performance.now() - pending.startedAtMs
    );
    pendingSeekLatencyRef.current = null;
  }, []);

  // Custom Player integration (hook handles bidirectional sync)
  const { ignorePlayerUpdatesRef } = useCustomPlayer(
    playerRef,
    bypassPreviewSeekRef,
    preferPlayerForStyledTextScrubRef,
    isGizmoInteractingRef,
    trackPlayerSeek,
  );

  useEffect(() => {
    const playback = usePlaybackStore.getState();
    if (playback.previewFrame !== null) {
      // Preserve the currently viewed frame before clearing preview mode.
      if (playback.currentFrame !== playback.previewFrame) {
        playback.setCurrentFrame(playback.previewFrame);
      }
      playback.setPreviewFrame(null);
    }
  }, []);

  useEffect(() => {
    isGizmoInteractingRef.current = isGizmoInteracting;
    if (!isGizmoInteracting) return;
    // During active transform drags, clear stale hover-scrub state without
    // changing the viewed frame. This avoids a one-frame render source/frame jump.
    const playbackState = usePlaybackStore.getState();
    if (playbackState.previewFrame !== null) {
      if (playbackState.currentFrame !== playbackState.previewFrame) {
        playbackState.setCurrentFrame(playbackState.previewFrame);
      }
      playbackState.setPreviewFrame(null);
    }
  }, [isGizmoInteracting]);

  useEffect(() => {
    if (!ADAPTIVE_PREVIEW_QUALITY_ENABLED) {
      adaptiveFrameSampleRef.current = null;
      adaptiveQualityStateRef.current = createAdaptivePreviewQualityState(1);
      if (adaptiveQualityCap !== 1) {
        setAdaptiveQualityCap(1);
      }
      return;
    }

    if (isPlaying) {
      adaptiveFrameSampleRef.current = null;
      return;
    }

    adaptiveFrameSampleRef.current = null;
    adaptiveQualityStateRef.current = createAdaptivePreviewQualityState(1);
    if (adaptiveQualityCap !== 1) {
      setAdaptiveQualityCap(1);
    }
  }, [adaptiveQualityCap, isPlaying]);

  const previewPerfRef = useRef({
    resolveSamples: 0,
    resolveTotalMs: 0,
    resolveTotalIds: 0,
    resolveLastMs: 0,
    resolveLastIds: 0,
    preloadScanSamples: 0,
    preloadScanTotalMs: 0,
    preloadScanLastMs: 0,
    preloadBatchSamples: 0,
    preloadBatchTotalMs: 0,
    preloadBatchLastMs: 0,
    preloadBatchLastIds: 0,
    preloadCandidateIds: 0,
    preloadBudgetBase: 0,
    preloadBudgetAdjusted: 0,
    preloadWindowMaxCost: 0,
    preloadScanBudgetYields: 0,
    preloadContinuations: 0,
    preloadScrubDirection: 0 as -1 | 0 | 1,
    preloadDirectionPenaltyCount: 0,
    sourceWarmTarget: 0,
    sourceWarmKeep: 0,
    sourceWarmEvictions: 0,
    sourcePoolSources: 0,
    sourcePoolElements: 0,
    sourcePoolActiveClips: 0,
    fastScrubPrewarmedSources: 0,
    fastScrubPrewarmSourceEvictions: 0,
    staleScrubOverlayDrops: 0,
    scrubDroppedFrames: 0,
    scrubUpdates: 0,
    adaptiveQualityDowngrades: 0,
    adaptiveQualityRecovers: 0,
  });

  // Combine tracks and items into TimelineTrack format
  // resolveEffectiveTrackStates applies parent group gate behavior (mute/hide/lock)
  // and filters out group container tracks (which hold no items)
  const combinedTracks = useMemo(() => {
    const effectiveTracks = resolveEffectiveTrackStates(tracks).toSorted((a, b) => b.order - a.order);
    return effectiveTracks.map((track) => ({
      ...track,
      items: itemsByTrackId[track.id] ?? [],
    }));
  }, [tracks, itemsByTrackId]);

  const mediaResolveCostById = useMemo(() => {
    const costs = new Map<string, number>();
    for (const [mediaId, media] of Object.entries(mediaById)) {
      costs.set(mediaId, getMediaResolveCost(media));
    }
    return costs;
  }, [mediaById]);

  const {
    resolvedUrls,
    setResolvedUrls,
    isResolving,
    unresolvedMediaIdSetRef,
    preloadResolveInFlightRef,
    preloadBurstRemainingRef,
    preloadScanTrackCursorRef,
    preloadScanItemCursorRef,
    preloadLastAnchorFrameRef,
    getUnresolvedQueueSize,
    getPendingResolveCount,
    getResolveRetryAt,
    resolveMediaBatch,
    clearResolveRetryState,
    removeUnresolvedMediaIds,
    markResolveFailures,
    scheduleResolveRetryWake,
    kickResolvePass,
    resetResolveRetryState,
  } = usePreviewMediaResolution({
    fps,
    combinedTracks,
    mediaResolveCostById,
    mediaDependencyVersion,
    blobUrlVersion,
    brokenMediaCount,
    previewPerfRef: previewPerfRef as typeof previewPerfRef & {
      current: {
        resolveSamples: number;
        resolveTotalMs: number;
        resolveTotalIds: number;
        resolveLastMs: number;
        resolveLastIds: number;
      };
    },
    isGizmoInteractingRef,
  });

  const {
    resolvedTracks,
    fastScrubTracks,
    playbackVideoSourceSpans,
    scrubVideoSourceSpans,
    fastScrubBoundaryFrames,
    fastScrubBoundarySources,
    fastScrubTracksFingerprint,
  } = useMemo(() => {
    const resolvedTrackList: CompositionInputProps['tracks'] = [];
    const fastScrubTrackList: CompositionInputProps['tracks'] = [];
    const playbackSpans: VideoSourceSpan[] = [];
    const scrubSpans: VideoSourceSpan[] = [];
    const boundaryFrames = new Set<number>();
    const boundarySources = new Map<number, Set<string>>();

    for (const track of combinedTracks) {
      const resolvedItems: typeof track.items = [];
      const fastScrubItems: typeof track.items = [];

      for (const item of track.items) {
        if (!item.mediaId || (item.type !== 'video' && item.type !== 'audio' && item.type !== 'image')) {
          resolvedItems.push(item);
          fastScrubItems.push(item);
          continue;
        }

        const sourceUrl = resolvedUrls.get(item.mediaId) ?? '';
        const proxyUrl = item.type === 'video'
          ? (resolveProxyUrl(item.mediaId) || sourceUrl)
          : sourceUrl;
        const resolvedSrc = useProxy && item.type === 'video' ? proxyUrl : sourceUrl;
        const fastScrubSrc = item.type === 'video' ? proxyUrl : sourceUrl;

        const resolvedItem = ('src' in item && item.src === resolvedSrc)
          ? item
          : { ...item, src: resolvedSrc };
        const fastScrubItem = ('src' in item && item.src === fastScrubSrc)
          ? item
          : { ...item, src: fastScrubSrc };

        resolvedItems.push(resolvedItem);
        fastScrubItems.push(fastScrubItem);

        if (resolvedItem.type === 'video' && resolvedSrc) {
          playbackSpans.push({
            src: resolvedSrc,
            startFrame: resolvedItem.from,
            endFrame: resolvedItem.from + resolvedItem.durationInFrames,
          });
        }

        if (fastScrubItem.type === 'video' && fastScrubSrc) {
          scrubSpans.push({
            src: fastScrubSrc,
            startFrame: fastScrubItem.from,
            endFrame: fastScrubItem.from + fastScrubItem.durationInFrames,
          });
          if (fastScrubItem.durationInFrames > 0) {
            const startFrame = fastScrubItem.from;
            const endFrame = fastScrubItem.from + fastScrubItem.durationInFrames;
            boundaryFrames.add(startFrame);
            boundaryFrames.add(endFrame);

            let startSet = boundarySources.get(startFrame);
            if (!startSet) {
              startSet = new Set<string>();
              boundarySources.set(startFrame, startSet);
            }
            startSet.add(fastScrubSrc);

            let endSet = boundarySources.get(endFrame);
            if (!endSet) {
              endSet = new Set<string>();
              boundarySources.set(endFrame, endSet);
            }
            endSet.add(fastScrubSrc);
          }
        }
      }

      resolvedTrackList.push({ ...track, items: resolvedItems });
      fastScrubTrackList.push({ ...track, items: fastScrubItems });
    }

    const sortedBoundaryFrames = [...boundaryFrames].sort((a, b) => a - b);
    const sortedBoundarySources: FastScrubBoundarySource[] = [...boundarySources.entries()]
      .map(([frame, srcSet]) => ({ frame, srcs: [...srcSet] }))
      .sort((a, b) => a.frame - b.frame);

    return {
      resolvedTracks: resolvedTrackList,
      fastScrubTracks: fastScrubTrackList,
      playbackVideoSourceSpans: playbackSpans,
      scrubVideoSourceSpans: scrubSpans,
      fastScrubBoundaryFrames: sortedBoundaryFrames,
      fastScrubBoundarySources: sortedBoundarySources,
      fastScrubTracksFingerprint: toTrackFingerprint(fastScrubTrackList),
    };
  }, [combinedTracks, resolvedUrls, useProxy, proxyReadyCount]);

  // Calculate total frames from item data in local memoized pass.
  const furthestItemEndFrame = useMemo(
    () => items.reduce((max, item) => Math.max(max, item.from + item.durationInFrames), 0),
    [items]
  );
  const totalFrames = useMemo(() => {
    if (furthestItemEndFrame === 0) return 900; // Default 30s at 30fps
    return furthestItemEndFrame + (fps * 5);
  }, [furthestItemEndFrame, fps]);

  usePreviewSourceWarm({
    resolvedUrlCount: resolvedUrls.size,
    playbackVideoSourceSpans,
    scrubVideoSourceSpans,
    fps,
    previewPerfRef: previewPerfRef as typeof previewPerfRef & {
      current: {
        sourceWarmTarget: number;
        sourceWarmKeep: number;
        sourceWarmEvictions: number;
        sourcePoolSources: number;
        sourcePoolElements: number;
        sourcePoolActiveClips: number;
      };
    },
    isGizmoInteractingRef,
  });

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const publish = () => {
      const stats = previewPerfRef.current;
      const seekNow = performance.now();
      const playbackState = usePlaybackStore.getState();
      const timelineFps = useTimelineStore.getState().fps;
      const adaptiveQualityState = adaptiveQualityStateRef.current;
      const frameTimeBudgetMs = getFrameBudgetMs(timelineFps, playbackState.playbackRate);
      const userPreviewQuality = playbackState.previewQuality;
      const effectiveQuality = getEffectivePreviewQuality(
        userPreviewQuality,
        adaptiveQualityState.qualityCap
      );
      const pendingSeek = pendingSeekLatencyRef.current;
      if (
        pendingSeek
        && (seekNow - pendingSeek.startedAtMs) >= PREVIEW_PERF_SEEK_TIMEOUT_MS
      ) {
        seekLatencyStatsRef.current = recordSeekLatencyTimeout(seekLatencyStatsRef.current);
        pendingSeekLatencyRef.current = null;
      }
      const seekStats = seekLatencyStatsRef.current;
      const activeTransitionTrace = transitionSessionTraceRef.current;
      const transitionTelemetry = transitionTelemetryRef.current;
      const pendingSeekAgeMs = pendingSeekLatencyRef.current
        ? Math.max(0, seekNow - pendingSeekLatencyRef.current.startedAtMs)
        : 0;
      const preseekMetrics = getDecoderPrewarmMetricsSnapshot();
      const snapshot: PreviewPerfSnapshot = {
        ts: Date.now(),
        unresolvedQueue: getUnresolvedQueueSize(),
        pendingResolves: getPendingResolveCount(),
        renderSource: renderSourceRef.current,
        renderSourceSwitches: renderSourceSwitchCountRef.current,
        renderSourceHistory: [...renderSourceHistoryRef.current],
        resolveAvgMs: stats.resolveSamples > 0 ? stats.resolveTotalMs / stats.resolveSamples : 0,
        resolveMsPerId: stats.resolveTotalIds > 0 ? stats.resolveTotalMs / stats.resolveTotalIds : 0,
        resolveLastMs: stats.resolveLastMs,
        resolveLastIds: stats.resolveLastIds,
        preloadScanAvgMs: stats.preloadScanSamples > 0 ? stats.preloadScanTotalMs / stats.preloadScanSamples : 0,
        preloadScanLastMs: stats.preloadScanLastMs,
        preloadBatchAvgMs: stats.preloadBatchSamples > 0 ? stats.preloadBatchTotalMs / stats.preloadBatchSamples : 0,
        preloadBatchLastMs: stats.preloadBatchLastMs,
        preloadBatchLastIds: stats.preloadBatchLastIds,
        preloadCandidateIds: stats.preloadCandidateIds,
        preloadBudgetBase: stats.preloadBudgetBase,
        preloadBudgetAdjusted: stats.preloadBudgetAdjusted,
        preloadWindowMaxCost: stats.preloadWindowMaxCost,
        preloadScanBudgetYields: stats.preloadScanBudgetYields,
        preloadContinuations: stats.preloadContinuations,
        preloadScrubDirection: stats.preloadScrubDirection,
        preloadDirectionPenaltyCount: stats.preloadDirectionPenaltyCount,
        sourceWarmTarget: stats.sourceWarmTarget,
        sourceWarmKeep: stats.sourceWarmKeep,
        sourceWarmEvictions: stats.sourceWarmEvictions,
        sourcePoolSources: stats.sourcePoolSources,
        sourcePoolElements: stats.sourcePoolElements,
        sourcePoolActiveClips: stats.sourcePoolActiveClips,
        fastScrubPrewarmedSources: stats.fastScrubPrewarmedSources,
        fastScrubPrewarmSourceEvictions: stats.fastScrubPrewarmSourceEvictions,
        preseekRequests: preseekMetrics.requests,
        preseekCacheHits: preseekMetrics.cacheHits,
        preseekInflightReuses: preseekMetrics.inflightReuses,
        preseekWorkerPosts: preseekMetrics.workerPosts,
        preseekWorkerSuccesses: preseekMetrics.workerSuccesses,
        preseekWorkerFailures: preseekMetrics.workerFailures,
        preseekWaitRequests: preseekMetrics.waitRequests,
        preseekWaitMatches: preseekMetrics.waitMatches,
        preseekWaitResolved: preseekMetrics.waitResolved,
        preseekWaitTimeouts: preseekMetrics.waitTimeouts,
        preseekCachedBitmaps: preseekMetrics.cacheBitmaps,
        staleScrubOverlayDrops: stats.staleScrubOverlayDrops,
        scrubDroppedFrames: stats.scrubDroppedFrames,
        scrubUpdates: stats.scrubUpdates,
        seekLatencyAvgMs: seekStats.samples > 0 ? seekStats.totalMs / seekStats.samples : 0,
        seekLatencyLastMs: seekStats.lastMs,
        seekLatencyPendingMs: pendingSeekAgeMs,
        seekLatencyTimeouts: seekStats.timeouts,
        userPreviewQuality,
        adaptiveQualityCap: adaptiveQualityState.qualityCap,
        effectivePreviewQuality: effectiveQuality,
        frameTimeBudgetMs,
        frameTimeEmaMs: adaptiveQualityState.frameTimeEmaMs,
        adaptiveQualityDowngrades: stats.adaptiveQualityDowngrades,
        adaptiveQualityRecovers: stats.adaptiveQualityRecovers,
        transitionSessionActive: activeTransitionTrace !== null,
        transitionSessionMode: activeTransitionTrace?.mode ?? 'none',
        transitionSessionComplex: activeTransitionTrace?.complex ?? false,
        transitionSessionStartFrame: activeTransitionTrace?.startFrame ?? -1,
        transitionSessionEndFrame: activeTransitionTrace?.endFrame ?? -1,
        transitionBufferedFrames: transitionSessionBufferedFramesRef.current.size,
        transitionPreparedFrame: activeTransitionTrace?.lastPreparedFrame ?? -1,
        transitionLastPrepareMs: activeTransitionTrace?.lastPrepareMs ?? transitionTelemetry.lastPrepareMs,
        transitionLastReadyLeadMs: activeTransitionTrace && activeTransitionTrace.enteredAtMs !== null && activeTransitionTrace.firstPreparedAtMs !== null
          ? Math.max(0, activeTransitionTrace.enteredAtMs - activeTransitionTrace.firstPreparedAtMs)
          : transitionTelemetry.lastReadyLeadMs,
        transitionLastEntryMisses: activeTransitionTrace?.entryMisses ?? transitionTelemetry.lastEntryMisses,
        transitionLastSessionDurationMs: activeTransitionTrace
          ? Math.max(0, seekNow - activeTransitionTrace.startedAtMs)
          : transitionTelemetry.lastSessionDurationMs,
        transitionSessionCount: transitionTelemetry.sessionCount,
      };

      window.__PREVIEW_PERF__ = snapshot;
      if (window.__PREVIEW_PERF_LOG__) {
        logger.warn('PreviewPerf', snapshot);
      }
    };

    publish();
    const intervalId = setInterval(publish, PREVIEW_PERF_PUBLISH_INTERVAL_MS);
    return () => {
      clearInterval(intervalId);
      window.__PREVIEW_PERF__ = undefined;
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    let panelEnabled = window.__PREVIEW_PERF_PANEL__ === true;
    const queryOverride = parsePreviewPerfPanelQuery(
      new URLSearchParams(window.location.search).get(PREVIEW_PERF_PANEL_QUERY_KEY)
    );
    if (queryOverride !== null) {
      panelEnabled = queryOverride;
      try {
        window.localStorage.setItem(PREVIEW_PERF_PANEL_STORAGE_KEY, panelEnabled ? '1' : '0');
      } catch {
        // Ignore storage failures (private mode / quota / disabled storage).
      }
    } else {
      try {
        const persisted = window.localStorage.getItem(PREVIEW_PERF_PANEL_STORAGE_KEY);
        if (persisted === '1' || persisted === '0') {
          panelEnabled = persisted === '1';
        }
      } catch {
        // Ignore storage failures (private mode / quota / disabled storage).
      }
    }
    window.__PREVIEW_PERF_PANEL__ = panelEnabled;
    setShowPerfPanel(panelEnabled);
    setPerfPanelSnapshot(panelEnabled ? window.__PREVIEW_PERF__ ?? null : null);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.altKey && event.shiftKey && event.key.toLowerCase() === 'p')) return;
      event.preventDefault();
      const nextEnabled = !(window.__PREVIEW_PERF_PANEL__ === true);
      window.__PREVIEW_PERF_PANEL__ = nextEnabled;
      try {
        window.localStorage.setItem(PREVIEW_PERF_PANEL_STORAGE_KEY, nextEnabled ? '1' : '0');
      } catch {
        // Ignore storage failures (private mode / quota / disabled storage).
      }
      setShowPerfPanel(nextEnabled);
      if (!nextEnabled) {
        setPerfPanelSnapshot(null);
      }
    };

    const intervalId = setInterval(() => {
      if (window.__PREVIEW_PERF_PANEL__ !== true) return;
      setPerfPanelSnapshot(window.__PREVIEW_PERF__ ?? null);
    }, 250);

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearInterval(intervalId);
    };
  }, []);
  // Memoize inputProps to prevent Player from re-rendering
  const inputProps: CompositionInputProps = useMemo(() => ({
    fps,
    width: project.width,
    height: project.height,
    tracks: resolvedTracks as CompositionInputProps['tracks'],
    transitions,
    backgroundColor: project.backgroundColor,
    keyframes,
  }), [fps, project.width, project.height, resolvedTracks, transitions, project.backgroundColor, keyframes]);

  // Keep main Player geometry fixed at project resolution.
  // This prevents quality toggles from changing the live preview sampling path,
  // which can look like layout drift on certain source aspect ratios.
  const playerRenderSize = useMemo(() => {
    const w = Math.max(2, project.width);
    const h = Math.max(2, project.height);
    return { width: w, height: h };
  }, [project.width, project.height]);

  // Keep fast-scrub renderer at project resolution until the renderer
  // separates logical composition space from physical canvas size.
  const renderSize = useMemo(() => {
    const projectWidth = Math.max(1, Math.round(project.width));
    const projectHeight = Math.max(1, Math.round(project.height));
    return { width: Math.max(2, projectWidth), height: Math.max(2, projectHeight) };
  }, [project.width, project.height]);

  // Provide live gizmo preview transforms to fast-scrub renderer so dragged
  // items move with LUT preview instead of freezing at committed transforms.
  const getPreviewTransformOverride = useCallback((itemId: string): Partial<ResolvedTransform> | undefined => {
    const gizmoState = useGizmoStore.getState();
    const unifiedPreviewTransform = gizmoState.preview?.[itemId]?.transform;
    if (unifiedPreviewTransform) return unifiedPreviewTransform;
    if (gizmoState.activeGizmo?.itemId === itemId && gizmoState.previewTransform) {
      return gizmoState.previewTransform;
    }
    return undefined;
  }, []);

  const getPreviewEffectsOverride = useCallback((itemId: string): ItemEffect[] | undefined => {
    const gizmoState = useGizmoStore.getState();
    return gizmoState.preview?.[itemId]?.effects;
  }, []);

  const getPreviewCornerPinOverride = useCallback((itemId: string) => {
    const cpState = useCornerPinStore.getState();
    if (cpState.editingItemId === itemId && cpState.previewCornerPin) {
      return cpState.previewCornerPin;
    }
    return undefined;
  }, []);

  const getPreviewPathVerticesOverride = useCallback((itemId: string) => {
    const maskState = useMaskEditorStore.getState();
    if (maskState.editingItemId === itemId && maskState.previewVertices) {
      return maskState.previewVertices;
    }
    return undefined;
  }, []);

  const fastScrubScaledTracks = useMemo(() => {
    return fastScrubTracks as CompositionInputProps['tracks'];
  }, [
    fastScrubTracks,
    fastScrubTracksFingerprint,
  ]);

  const fastScrubLiveItemsById = useMemo(() => {
    const map = new Map<string, TimelineItem>();
    for (const track of fastScrubScaledTracks) {
      for (const item of track.items as TimelineItem[]) {
        map.set(item.id, item);
      }
    }
    return map;
  }, [fastScrubScaledTracks]);
  const fastScrubLiveItemsByIdRef = useRef<Map<string, TimelineItem>>(fastScrubLiveItemsById);
  fastScrubLiveItemsByIdRef.current = fastScrubLiveItemsById;

  const fastScrubKeyframesByItemId = useMemo(() => (
    new Map(keyframes.map((entry) => [entry.itemId, entry]))
  ), [keyframes]);
  const fastScrubKeyframesByItemIdRef = useRef<Map<string, typeof keyframes[number]>>(fastScrubKeyframesByItemId);
  fastScrubKeyframesByItemIdRef.current = fastScrubKeyframesByItemId;

  const getLiveItemSnapshot = useCallback((itemId: string) => {
    return fastScrubLiveItemsByIdRef.current.get(itemId);
  }, []);

  const getLiveKeyframes = useCallback((itemId: string) => {
    return fastScrubKeyframesByItemIdRef.current.get(itemId);
  }, []);

  const fastScrubScaledKeyframes = useMemo(() => {
    return keyframes;
  }, [
    keyframes,
  ]);
  const previousFastScrubVisualStateRef = useRef<{
    tracks: CompositionInputProps['tracks'];
    keyframes: typeof fastScrubScaledKeyframes;
  }>({
    tracks: fastScrubScaledTracks,
    keyframes: fastScrubScaledKeyframes,
  });

  const fastScrubInputProps: CompositionInputProps = useMemo(() => ({
    fps,
    width: project.width,
    height: project.height,
    tracks: fastScrubScaledTracks,
    transitions,
    backgroundColor: project.backgroundColor,
    keyframes: fastScrubScaledKeyframes,
  }), [
    fps,
    project.width,
    project.height,
    fastScrubScaledTracks,
    transitions,
    project.backgroundColor,
    fastScrubScaledKeyframes,
  ]);

  const playbackTransitionFingerprint = useMemo(() => (
    transitions
      .map((transition) => (
        `${transition.id}:${transition.type}:${transition.leftClipId}:${transition.rightClipId}:${transition.trackId ?? ''}:${transition.durationInFrames}:${transition.presentation ?? ''}:${transition.timing ?? ''}`
      ))
      .join('|')
  ), [transitions]);

  const fastScrubRendererStructureKey = useMemo(() => (
    [
      fps,
      project.width,
      project.height,
      project.backgroundColor ?? '',
      fastScrubTracksFingerprint,
      playbackTransitionFingerprint,
    ].join('::')
  ), [
    fastScrubTracksFingerprint,
    fps,
    playbackTransitionFingerprint,
    project.backgroundColor,
    project.height,
    project.width,
  ]);

  const playbackTransitionWindows = useMemo(() => {
    const clipMap = new Map<string, TimelineItem>();
    for (const track of fastScrubScaledTracks) {
      for (const item of track.items as TimelineItem[]) {
        clipMap.set(item.id, item);
      }
    }
    return resolveTransitionWindows(transitions, clipMap);
  }, [fastScrubScaledTracks, transitions]);
  const fastScrubPreviewItems = useMemo(
    () => fastScrubScaledTracks.flatMap((track) => track.items as TimelineItem[]),
    [fastScrubScaledTracks],
  );

  const playbackTransitionLookaheadFrames = useMemo(
    () => Math.max(2, Math.round(fps * 0.25)),
    [fps],
  );
  const playbackTransitionCooldownFrames = useMemo(
    () => Math.max(2, Math.round(fps * 0.1)),
    [fps],
  );
  const pausedTransitionPrearmFrames = useMemo(
    () => Math.max(playbackTransitionLookaheadFrames, Math.round(fps * 3)),
    [fps, playbackTransitionLookaheadFrames],
  );
  const playingComplexTransitionPrearmFrames = useMemo(
    () => Math.max(playbackTransitionLookaheadFrames, Math.round(fps * 1.5)),
    [fps, playbackTransitionLookaheadFrames],
  );
  const playbackTransitionPrerenderRunwayFrames = 8;
  const playbackTransitionEffectfulStartFrames = useMemo(() => {
    const hasExpensiveVisuals = (item: TimelineItem) => (
      item.effects?.some((effect) => effect.enabled)
      || (item.blendMode !== undefined && item.blendMode !== 'normal')
    );

    const effectfulStartFrames = new Set<number>();
    for (const window of playbackTransitionWindows) {
      if (hasExpensiveVisuals(window.leftClip) || hasExpensiveVisuals(window.rightClip)) {
        effectfulStartFrames.add(window.startFrame);
      }
    }

    return effectfulStartFrames;
  }, [playbackTransitionWindows]);

  const playbackTransitionVariableSpeedStartFrames = useMemo(() => {
    const variableSpeedStartFrames = new Set<number>();
    for (const window of playbackTransitionWindows) {
      const leftSpeed = window.leftClip.speed ?? 1;
      const rightSpeed = window.rightClip.speed ?? 1;
      if (Math.abs(leftSpeed - 1) > 0.001 || Math.abs(rightSpeed - 1) > 0.001) {
        variableSpeedStartFrames.add(window.startFrame);
      }
    }
    return variableSpeedStartFrames;
  }, [playbackTransitionWindows]);

  const playbackTransitionComplexStartFrames = useMemo(() => {
    const complexStartFrames = new Set<number>();
    for (const frame of playbackTransitionEffectfulStartFrames) {
      complexStartFrames.add(frame);
    }
    for (const frame of playbackTransitionVariableSpeedStartFrames) {
      complexStartFrames.add(frame);
    }
    return complexStartFrames;
  }, [playbackTransitionEffectfulStartFrames, playbackTransitionVariableSpeedStartFrames]);

  const transitionWindowUsesDomProvider = useCallback((window: ResolvedTransitionWindow<TimelineItem> | null) => {
    if (!window) return true;
    return !playbackTransitionComplexStartFrames.has(window.startFrame);
  }, [playbackTransitionComplexStartFrames]);

  const getTransitionWindowByStartFrame = useCallback((startFrame: number | null) => {
    if (startFrame === null) return null;
    return playbackTransitionWindows.find((window) => window.startFrame === startFrame) ?? null;
  }, [playbackTransitionWindows]);

  const getTransitionCooldownForWindow = useCallback((window: ResolvedTransitionWindow<TimelineItem>) => {
    const leftOriginId = window.leftClip.originId;
    const rightOriginId = window.rightClip.originId;

    // Split/same-origin handoffs keep the primary lane alive across the exit,
    // so extra post-overlap overlay frames just prolong the stale handoff path
    // and can leak a visible 1-2 frame hitch.
    if (leftOriginId && rightOriginId && leftOriginId === rightOriginId) {
      return 0;
    }

    return playbackTransitionCooldownFrames;
  }, [playbackTransitionCooldownFrames]);

  const getTransitionWindowForFrame = useCallback((frame: number) => {
    return playbackTransitionWindows.find((window) => (
      frame >= window.startFrame && frame < window.endFrame + getTransitionCooldownForWindow(window)
    )) ?? null;
  }, [getTransitionCooldownForWindow, playbackTransitionWindows]);

  /** Like getTransitionWindowForFrame but without cooldown Ã¢â‚¬â€ true only in the active span. */
  const getActiveTransitionWindowForFrame = useCallback((frame: number) => {
    return playbackTransitionWindows.find((window) => (
      frame >= window.startFrame && frame < window.endFrame
    )) ?? null;
  }, [playbackTransitionWindows]);

  const playbackTransitionOverlayWindows = useMemo(
    () => playbackTransitionWindows.map((window) => ({
      startFrame: window.startFrame,
      endFrame: window.endFrame,
      cooldownFrames: getTransitionCooldownForWindow(window),
    })),
    [getTransitionCooldownForWindow, playbackTransitionWindows],
  );
  const shouldPreserveHighFidelityBackwardPreview = useCallback((frame: number | null) => {
    if (frame === null) return false;
    if (getTransitionWindowForFrame(frame) !== null) {
      return true;
    }
    return shouldForceContinuousPreviewOverlay(fastScrubPreviewItems, transitions.length, frame);
  }, [fastScrubPreviewItems, getTransitionWindowForFrame, transitions.length]);
  const forceFastScrubOverlay = showGpuEffectsOverlay;
  const {
    clearTransitionPlaybackSession,
    pinTransitionPlaybackSession,
    getPinnedTransitionElementForItem,
    getPausedTransitionPrewarmStartFrame,
    getPlayingAnyTransitionPrewarmStartFrame,
    isPausedTransitionOverlayActive,
    cacheTransitionSessionFrame,
    preparePlaybackTransitionFrame,
  } = usePreviewTransitionSessionController({
    fps,
    forceFastScrubOverlay,
    pausedTransitionPrearmFrames,
    playingComplexTransitionPrearmFrames,
    playbackTransitionWindows,
    playbackTransitionComplexStartFrames,
    playbackTransitionPrerenderRunwayFrames,
    playbackTransitionCooldownFrames,
    transitionWindowUsesDomProvider,
    getTransitionWindowByStartFrame,
    getActiveTransitionWindowForFrame,
    pushTransitionTrace,
    ensureFastScrubRendererRef,
    scrubMountedRef,
    scrubRenderInFlightRef,
    scrubRequestedFrameRef,
    scrubOffscreenCanvasRef,
    scrubOffscreenRenderedFrameRef,
    resumeScrubLoopRef,
    playbackTransitionPreparePromiseRef,
    playbackTransitionPreparingFrameRef,
    transitionSessionWindowRef,
    transitionSessionPinnedElementsRef,
    transitionExitElementsRef,
    transitionSessionStallCountRef,
    transitionSessionBufferedFramesRef,
    transitionPrewarmPromiseRef,
    transitionSessionTraceRef,
    transitionTelemetryRef,
  });

  // Styled, animated text can visibly flip between the DOM Player renderer
  // and the fast-scrub canvas renderer. Keep scrub preview on the Player path.
  const preferPlayerForStyledTextScrub = (
    !forceFastScrubOverlay
    && shouldPreferPlayerForStyledTextScrubGuard(combinedTracks, keyframes)
  );
  const preferPlayerForTextGizmo = (
    !forceFastScrubOverlay
    && isGizmoInteracting
    && activeGizmoItemType === 'text'
  );
  preferPlayerForTextGizmoRef.current = preferPlayerForTextGizmo;
  preferPlayerForStyledTextScrubRef.current = preferPlayerForStyledTextScrub;

  // Keep the on-screen scrub canvas at project resolution so quality toggles
  // only change offscreen sampling, not display buffer geometry.
  useLayoutEffect(() => {
    const canvas = scrubCanvasRef.current;
    if (!canvas) return;
    if (canvas.width !== playerRenderSize.width) canvas.width = playerRenderSize.width;
    if (canvas.height !== playerRenderSize.height) canvas.height = playerRenderSize.height;
  }, [playerRenderSize.width, playerRenderSize.height]);

  const disposeFastScrubRenderer = useCallback(() => {
    clearPendingFastScrubHandoff();
    scrubInitPromiseRef.current = null;
    scrubPreloadPromiseRef.current = null;
    scrubRequestedFrameRef.current = null;
    scrubRenderInFlightRef.current = false;
    scrubPrewarmQueueRef.current = [];
    scrubPrewarmQueuedSetRef.current.clear();
    scrubPrewarmedFramesRef.current = [];
    scrubPrewarmedFrameSetRef.current.clear();
    scrubPrewarmedSourcesRef.current.clear();
    scrubPrewarmedSourceOrderRef.current = [];
    scrubPrewarmedSourceTouchFrameRef.current.clear();
    scrubOffscreenRenderedFrameRef.current = null;
    playbackTransitionPreparePromiseRef.current = null;
    playbackTransitionPreparingFrameRef.current = null;
    deferredPlaybackTransitionPrepareFrameRef.current = null;
    if (transitionPrepareTimeoutRef.current !== null) {
      clearTimeout(transitionPrepareTimeoutRef.current);
      transitionPrepareTimeoutRef.current = null;
    }
    clearTransitionPlaybackSession();
    captureCanvasSourceInFlightRef.current = null;
    previewPerfRef.current.fastScrubPrewarmedSources = 0;
    bypassPreviewSeekRef.current = false;

    if (scrubRendererRef.current) {
      try {
        scrubRendererRef.current.dispose();
      } catch (error) {
        logger.warn('Failed to dispose renderer:', error);
      }
      scrubRendererRef.current = null;
    }
    scrubRendererStructureKeyRef.current = null;

    scrubOffscreenCanvasRef.current = null;
    scrubOffscreenCtxRef.current = null;

    if (bgTransitionRendererRef.current) {
      try { bgTransitionRendererRef.current.dispose(); } catch { /* */ }
      bgTransitionRendererRef.current = null;
    }
    bgTransitionRendererStructureKeyRef.current = null;
    bgTransitionInitPromiseRef.current = null;
    bgTransitionRenderInFlightRef.current = false;
  }, [clearPendingFastScrubHandoff, clearTransitionPlaybackSession]);

  // Background transition renderer Ã¢â‚¬â€ independent instance for pre-rendering
  // transition frames without conflicting with the main rAF pump renderer.
  const ensureBgTransitionRenderer = useCallback(async (): Promise<CompositionRenderer | null> => {
    if (!FAST_SCRUB_RENDERER_ENABLED || typeof OffscreenCanvas === 'undefined' || isResolving) return null;
    if (
      bgTransitionRendererRef.current
      && bgTransitionRendererStructureKeyRef.current !== fastScrubRendererStructureKey
    ) {
      disposeFastScrubRenderer();
    }
    if (bgTransitionRendererRef.current) return bgTransitionRendererRef.current;
    if (bgTransitionInitPromiseRef.current) return bgTransitionInitPromiseRef.current;

    bgTransitionInitPromiseRef.current = (async () => {
      try {
        const canvas = new OffscreenCanvas(renderSize.width, renderSize.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const renderer = await createCompositionRenderer(fastScrubInputProps, canvas, ctx, {
          mode: 'preview',
          getPreviewTransformOverride,
          getPreviewEffectsOverride,
          getPreviewCornerPinOverride,
          getPreviewPathVerticesOverride,
          getLiveItemSnapshot,
          getLiveKeyframes,
        });
        if ('warmGpuPipeline' in renderer) {
          void renderer.warmGpuPipeline();
        }
        bgTransitionRendererRef.current = renderer;
        bgTransitionRendererStructureKeyRef.current = fastScrubRendererStructureKey;
        return renderer;
      } catch {
        return null;
      } finally {
        bgTransitionInitPromiseRef.current = null;
      }
    })();
    return bgTransitionInitPromiseRef.current;
  }, [
    disposeFastScrubRenderer,
    fastScrubInputProps,
    fastScrubRendererStructureKey,
    getLiveItemSnapshot,
    getLiveKeyframes,
    getPreviewCornerPinOverride,
    getPreviewEffectsOverride,
    getPreviewPathVerticesOverride,
    getPreviewTransformOverride,
    isResolving,
    renderSize.width,
    renderSize.height,
  ]);

  const ensureFastScrubRenderer = useCallback(async (): Promise<CompositionRenderer | null> => {
    if (!FAST_SCRUB_RENDERER_ENABLED) return null;
    if (typeof OffscreenCanvas === 'undefined') return null;
    if (isResolving) return null;
    if (
      scrubRendererRef.current
      && scrubRendererStructureKeyRef.current !== fastScrubRendererStructureKey
    ) {
      disposeFastScrubRenderer();
    }
    if (scrubRendererRef.current) return scrubRendererRef.current;
    if (scrubInitPromiseRef.current) return scrubInitPromiseRef.current;

    scrubInitPromiseRef.current = (async () => {
      try {
        const offscreen = new OffscreenCanvas(renderSize.width, renderSize.height);
        const offscreenCtx = offscreen.getContext('2d');
        if (!offscreenCtx) return null;

        const renderer = await createCompositionRenderer(fastScrubInputProps, offscreen, offscreenCtx, {
          mode: 'preview',
          getPreviewTransformOverride,
          getPreviewEffectsOverride,
          getPreviewCornerPinOverride,
          getPreviewPathVerticesOverride,
          getLiveItemSnapshot,
          getLiveKeyframes,
        });
        const playbackState = usePlaybackStore.getState();
        const runtimeSnapshot = getPreviewRuntimeSnapshotFromPlaybackState(
          playbackState,
          isGizmoInteractingRef.current,
        );
        const preloadPriorityFrame = runtimeSnapshot.anchorFrame;
        const preloadPromise = renderer.preload({
          priorityFrame: preloadPriorityFrame,
          priorityWindowFrames: Math.max(12, Math.round(fps * 4)),
        })
          .catch((error) => {
            logger.warn('Renderer preload failed:', error);
          })
          .finally(() => {
            if (scrubPreloadPromiseRef.current === preloadPromise) {
              scrubPreloadPromiseRef.current = null;
            }
          });
        scrubPreloadPromiseRef.current = preloadPromise;

        await Promise.race([
          preloadPromise,
          new Promise<void>((resolve) => {
            setTimeout(resolve, FAST_SCRUB_PRELOAD_BUDGET_MS);
          }),
        ]);

        scrubOffscreenCanvasRef.current = offscreen;
        scrubOffscreenCtxRef.current = offscreenCtx;
        scrubOffscreenRenderedFrameRef.current = null;
        scrubRendererRef.current = renderer;
        scrubRendererStructureKeyRef.current = fastScrubRendererStructureKey;
        // Eagerly warm the GPU pipeline in the background so the first
        // transition frame doesn't pay the ~100-150ms WebGPU init cost.
        if ('warmGpuPipeline' in renderer) {
          void renderer.warmGpuPipeline();
        }
        return renderer;
      } catch (error) {
        logger.warn('Failed to initialize renderer, falling back to Player seeks:', error);
        scrubRendererRef.current = null;
        scrubOffscreenCanvasRef.current = null;
        scrubOffscreenCtxRef.current = null;
        scrubOffscreenRenderedFrameRef.current = null;
        return null;
      } finally {
        scrubInitPromiseRef.current = null;
      }
    })();

    return scrubInitPromiseRef.current;
  }, [
    disposeFastScrubRenderer,
    fastScrubInputProps,
    fastScrubRendererStructureKey,
    fps,
    getLiveItemSnapshot,
    getLiveKeyframes,
    getPreviewTransformOverride,
    getPreviewEffectsOverride,
    getPreviewCornerPinOverride,
    getPreviewPathVerticesOverride,
    isResolving,
    renderSize.height,
    renderSize.width,
  ]);
  ensureFastScrubRendererRef.current = ensureFastScrubRenderer;

  const renderOffscreenFrame = useCallback(async (targetFrame: number): Promise<OffscreenCanvas | null> => {
    const offscreen = scrubOffscreenCanvasRef.current;
    if (offscreen && scrubOffscreenRenderedFrameRef.current === targetFrame) {
      return offscreen;
    }

    const renderer = await ensureFastScrubRenderer();
    const nextOffscreen = scrubOffscreenCanvasRef.current;
    if (!renderer || !nextOffscreen) return null;

    if (scrubOffscreenRenderedFrameRef.current !== targetFrame) {
      await renderer.renderFrame(targetFrame);
      scrubOffscreenRenderedFrameRef.current = targetFrame;
    }

    return nextOffscreen;
  }, [ensureFastScrubRenderer]);


  // Dispose/recreate fast scrub renderer when composition inputs change.
  useEffect(() => {
    disposeFastScrubRenderer();
  }, [disposeFastScrubRenderer, fastScrubRendererStructureKey, renderSize.height, renderSize.width]);

  // Visual-only edits should keep the warm renderer alive. Invalidate cached
  // frames and ask the overlay to repaint instead of rebuilding GPU/decoder state.
  useEffect(() => {
    const previousVisualState = previousFastScrubVisualStateRef.current;
    previousFastScrubVisualStateRef.current = {
      tracks: fastScrubScaledTracks,
      keyframes: fastScrubScaledKeyframes,
    };

    const visualInvalidationRanges = collectVisualInvalidationRanges({
      previousTracks: previousVisualState.tracks,
      nextTracks: fastScrubScaledTracks,
      previousKeyframes: previousVisualState.keyframes,
      nextKeyframes: fastScrubScaledKeyframes,
    });
    if (visualInvalidationRanges.length === 0) {
      return;
    }

    const scrubRenderer = scrubRendererRef.current;
    const bgRenderer = bgTransitionRendererRef.current;
    const scrubRendererMatchesStructure = (
      scrubRendererStructureKeyRef.current === fastScrubRendererStructureKey
    );
    const bgRendererMatchesStructure = (
      bgTransitionRendererStructureKeyRef.current === fastScrubRendererStructureKey
    );

    if (!scrubRendererMatchesStructure && !bgRendererMatchesStructure) {
      return;
    }

    const invalidationRequest = { ranges: visualInvalidationRanges };
    if (scrubRenderer && scrubRendererMatchesStructure) {
      scrubRenderer.invalidateFrameCache(invalidationRequest);
    }
    if (bgRenderer && bgRendererMatchesStructure) {
      bgRenderer.invalidateFrameCache(invalidationRequest);
    }

    const playbackState = usePlaybackStore.getState();
    const targetFrame = playbackState.previewFrame ?? playbackState.currentFrame;
    const currentFrameInvalidated = isFrameInRanges(targetFrame, visualInvalidationRanges);

    if (
      scrubOffscreenRenderedFrameRef.current !== null
      && isFrameInRanges(scrubOffscreenRenderedFrameRef.current, visualInvalidationRanges)
    ) {
      scrubOffscreenRenderedFrameRef.current = null;
    }

    let removedBufferedFrame = false;
    for (const frame of [...transitionSessionBufferedFramesRef.current.keys()]) {
      if (!isFrameInRanges(frame, visualInvalidationRanges)) continue;
      transitionSessionBufferedFramesRef.current.delete(frame);
      removedBufferedFrame = true;
    }
    if (removedBufferedFrame) {
      lastPausedPrearmTargetRef.current = null;
    }

    if (
      scrubRenderer
      && scrubRendererMatchesStructure
      && currentFrameInvalidated
      && (
        forceFastScrubOverlay
        || playbackState.previewFrame !== null
        || showFastScrubOverlayRef.current
        || showPlaybackTransitionOverlayRef.current
      )
    ) {
      scrubRequestedFrameRef.current = targetFrame;
      void resumeScrubLoopRef.current();
    }
  }, [
    fastScrubInputProps,
    fastScrubScaledKeyframes,
    fastScrubScaledTracks,
    fastScrubRendererStructureKey,
    forceFastScrubOverlay,
  ]);

  const captureCurrentFrame = useCallback(async (options?: CaptureOptions): Promise<string | null> => {
    if (captureInFlightRef.current) {
      return captureInFlightRef.current;
    }

    const task = (async () => {
      try {
        const playback = usePlaybackStore.getState();
        const targetFrame = playback.previewFrame ?? playback.currentFrame;
        const offscreen = await renderOffscreenFrame(targetFrame);
        if (!offscreen) return null;

        const format = options?.format ?? 'image/jpeg';
        const quality = options?.quality ?? 0.9;
        const targetWidth = Math.max(2, Math.round(options?.width ?? offscreen.width));
        const targetHeight = Math.max(2, Math.round(options?.height ?? offscreen.height));
        const shouldScale = !options?.fullResolution
          && (targetWidth !== offscreen.width || targetHeight !== offscreen.height);

        if (!shouldScale) {
          const blob = await offscreen.convertToBlob({
            type: format,
            quality,
          });
          return blobToDataUrl(blob);
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx2d = canvas.getContext('2d');
        if (!ctx2d) return null;

        ctx2d.drawImage(offscreen, 0, 0, targetWidth, targetHeight);
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, format, quality);
        });
        if (!blob) return null;
        return blobToDataUrl(blob);
      } catch (error) {
        logger.warn('Failed to capture frame:', error);
        return null;
      } finally {
        captureInFlightRef.current = null;
      }
    })();

    captureInFlightRef.current = task;
    return task;
  }, [renderOffscreenFrame]);

  const captureCurrentFrameImageData = useCallback(async (options?: CaptureOptions): Promise<ImageData | null> => {
    if (captureImageDataInFlightRef.current) {
      return captureImageDataInFlightRef.current;
    }

    const task = (async () => {
      try {
        const playback = usePlaybackStore.getState();
        const targetFrame = playback.previewFrame ?? playback.currentFrame;
        const offscreen = await renderOffscreenFrame(targetFrame);
        if (!offscreen) return null;

        const targetWidth = Math.max(2, Math.round(options?.width ?? offscreen.width));
        const targetHeight = Math.max(2, Math.round(options?.height ?? offscreen.height));
        const shouldScale = !options?.fullResolution
          && (targetWidth !== offscreen.width || targetHeight !== offscreen.height);

        if (!shouldScale) {
          const offscreenCtx = scrubOffscreenCtxRef.current
            ?? offscreen.getContext('2d', { willReadFrequently: true });
          if (!offscreenCtx) return null;
          return offscreenCtx.getImageData(0, 0, offscreen.width, offscreen.height);
        }

        let scaleCanvas = captureScaleCanvasRef.current;
        if (!scaleCanvas) {
          scaleCanvas = document.createElement('canvas');
          captureScaleCanvasRef.current = scaleCanvas;
        }
        if (scaleCanvas.width !== targetWidth || scaleCanvas.height !== targetHeight) {
          scaleCanvas.width = targetWidth;
          scaleCanvas.height = targetHeight;
        }
        const scaleCtx = scaleCanvas.getContext('2d', { willReadFrequently: true });
        if (!scaleCtx) return null;

        scaleCtx.clearRect(0, 0, targetWidth, targetHeight);
        scaleCtx.drawImage(offscreen, 0, 0, targetWidth, targetHeight);
        return scaleCtx.getImageData(0, 0, targetWidth, targetHeight);
      } catch (error) {
        logger.warn('Failed to capture raw frame:', error);
        return null;
      } finally {
        captureImageDataInFlightRef.current = null;
      }
    })();

    captureImageDataInFlightRef.current = task;
    return task;
  }, [renderOffscreenFrame]);

  const captureCanvasSource = useCallback(async (): Promise<OffscreenCanvas | HTMLCanvasElement | null> => {
    if (captureCanvasSourceInFlightRef.current) {
      return captureCanvasSourceInFlightRef.current;
    }

    const task = (async () => {
      try {
        const playback = usePlaybackStore.getState();
        const targetFrame = playback.previewFrame ?? playback.currentFrame;
        return await renderOffscreenFrame(targetFrame);
      } catch (error) {
        logger.warn('Failed to capture canvas source:', error);
        return null;
      } finally {
        captureCanvasSourceInFlightRef.current = null;
      }
    })();

    captureCanvasSourceInFlightRef.current = task;
    return task;
  }, [renderOffscreenFrame]);

  const setCaptureCanvasSource = usePreviewBridgeStore((s) => s.setCaptureCanvasSource);

  usePreviewCaptureBridge({
    captureCurrentFrame,
    captureCurrentFrameImageData,
    captureCanvasSource,
    setCaptureFrame,
    setCaptureFrameImageData,
    setCaptureCanvasSource,
    setDisplayedFrame,
    captureInFlightRef,
    captureImageDataInFlightRef,
    captureScaleCanvasRef,
  });

  // Eager GPU warm-up on mount Ã¢â‚¬â€ request the WebGPU device BEFORE media
  // finishes resolving. This is the most expensive single cold-start cost
  // (~50-100ms for device request, plus ~100-400ms for shader compilation).
  // The device is cached globally so the renderer reuses it instead of
  // requesting a second one.
  useEffect(() => {
    if (!FAST_SCRUB_RENDERER_ENABLED) return;
    void (async () => {
      try {
        const { EffectsPipeline } = await import('@/infrastructure/gpu/effects');
        // requestCachedDevice warms the adapter + device. The subsequent
        // EffectsPipeline.create() inside the renderer reuses it.
        const device = await EffectsPipeline.requestCachedDevice();
        if (device) {
          // Pre-create a throwaway pipeline to compile all effect shaders.
          // Shader binaries are cached by the GPU driver, so the renderer's
          // own pipeline creation will be near-instant.
          const warmPipeline = await EffectsPipeline.create();
          if (warmPipeline) {
            try {
              const { TransitionPipeline } = await import('@/infrastructure/gpu/transitions');
              TransitionPipeline.create(device)?.destroy();
            } finally {
              warmPipeline.destroy();
            }
          }
        }
      } catch {
        // GPU not available Ã¢â‚¬â€ renderer will fall back to CPU path.
      }
    })();
  }, []);

  // Background warm-up of full renderer once media URLs are resolved.
  useEffect(() => {
    if (!FAST_SCRUB_RENDERER_ENABLED || isResolving) return;
    if (scrubRendererRef.current || scrubInitPromiseRef.current) return;

    let cancelled = false;
    const warmup = () => {
      if (cancelled || scrubRendererRef.current || scrubInitPromiseRef.current) return;
      void ensureFastScrubRenderer();
    };

    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = (window as Window & { requestIdleCallback: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number })
        .requestIdleCallback(() => warmup(), { timeout: 400 });
    } else {
      timeoutId = setTimeout(warmup, 120);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        (window as Window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, [ensureFastScrubRenderer, isResolving]);

  usePreviewRenderPump({
    playerRef,
    fps,
    forceFastScrubOverlay,
    combinedTracks,
    fastScrubBoundaryFrames,
    fastScrubBoundarySources,
    playbackTransitionOverlayWindows,
    playbackTransitionLookaheadFrames,
    playbackTransitionCooldownFrames,
    playbackTransitionPrerenderRunwayFrames,
    previewPerfRef,
    isGizmoInteractingRef,
    bypassPreviewSeekRef,
    showFastScrubOverlayRef,
    pendingFastScrubHandoffFrameRef,
    scrubCanvasRef,
    scrubRendererRef,
    scrubMountedRef,
    scrubRenderInFlightRef,
    scrubRenderGenerationRef,
    scrubDirectionRef,
    scrubRequestedFrameRef,
    scrubPrewarmQueueRef,
    scrubPrewarmQueuedSetRef,
    scrubPrewarmedFramesRef,
    scrubPrewarmedFrameSetRef,
    scrubPrewarmedSourcesRef,
    scrubPrewarmedSourceOrderRef,
    scrubPrewarmedSourceTouchFrameRef,
    scrubOffscreenCanvasRef,
    scrubOffscreenRenderedFrameRef,
    bgTransitionRenderInFlightRef,
    resumeScrubLoopRef,
    lastBackwardScrubPreloadAtRef,
    lastBackwardScrubRenderAtRef,
    lastBackwardRequestedFrameRef,
    suppressScrubBackgroundPrewarmRef,
    fallbackToPlayerScrubRef,
    lastPausedPrearmTargetRef,
    lastPlayingPrearmTargetRef,
    deferredPlaybackTransitionPrepareFrameRef,
    transitionPrepareTimeoutRef,
    transitionSessionWindowRef,
    transitionSessionPinnedElementsRef,
    transitionSessionStallCountRef,
    transitionSessionBufferedFramesRef,
    transitionPrewarmPromiseRef,
    transitionSessionTraceRef,
    setDisplayedFrame,
    clearPendingFastScrubHandoff,
    hideFastScrubOverlay,
    hidePlaybackTransitionOverlay,
    maybeCompleteFastScrubHandoff,
    scheduleFastScrubHandoffCheck,
    beginFastScrubHandoff,
    showFastScrubOverlayForFrame,
    showPlaybackTransitionOverlayForFrame,
    shouldPreferPlayerForPreview,
    shouldPreserveHighFidelityBackwardPreview,
    getTransitionWindowByStartFrame,
    getTransitionWindowForFrame,
    getPlayingAnyTransitionPrewarmStartFrame,
    getPausedTransitionPrewarmStartFrame,
    getPinnedTransitionElementForItem,
    pinTransitionPlaybackSession,
    clearTransitionPlaybackSession,
    cacheTransitionSessionFrame,
    preparePlaybackTransitionFrame,
    disposeFastScrubRenderer,
    ensureFastScrubRenderer,
    ensureBgTransitionRenderer,
    pushTransitionTrace,
    isPausedTransitionOverlayActive,
    trackPlayerSeek,
    recordRenderFrameJitter,
  });
  usePreviewMediaPreload({
    fps,
    combinedTracks,
    mediaResolveCostById,
    previewPerfRef,
    setResolvedUrls,
    isGizmoInteractingRef,
    unresolvedMediaIdSetRef,
    preloadResolveInFlightRef,
    preloadBurstRemainingRef,
    preloadScanTrackCursorRef,
    preloadScanItemCursorRef,
    preloadLastAnchorFrameRef,
    lastForwardScrubPreloadAtRef,
    lastBackwardScrubPreloadAtRef,
    getResolveRetryAt,
    resolveMediaBatch,
    clearResolveRetryState,
    removeUnresolvedMediaIds,
    markResolveFailures,
    scheduleResolveRetryWake,
    kickResolvePass,
  });

  useEffect(() => {
    return () => {
      scrubMountedRef.current = false;
      resetResolveRetryState();
      disposeFastScrubRenderer();
    };
  }, [disposeFastScrubRenderer, resetResolveRetryState]);

  // Calculate player size based on zoom mode
  const playerSize = useMemo(() => {
    const aspectRatio = project.width / project.height;

    if (zoom === -1) {
      if (containerSize.width > 0 && containerSize.height > 0) {
        const containerAspectRatio = containerSize.width / containerSize.height;

        let width: number;
        let height: number;

        if (containerAspectRatio > aspectRatio) {
          height = containerSize.height;
          width = height * aspectRatio;
        } else {
          width = containerSize.width;
          height = width / aspectRatio;
        }

        return { width, height };
      }
      return { width: project.width, height: project.height };
    }

    const targetWidth = project.width * zoom;
    const targetHeight = project.height * zoom;
    return { width: targetWidth, height: targetHeight };
  }, [project.width, project.height, zoom, containerSize]);

  // Check if overflow is needed (video larger than container)
  const needsOverflow = useMemo(() => {
    if (zoom === -1) return false;
    if (containerSize.width === 0 || containerSize.height === 0) return false;
    return playerSize.width > containerSize.width || playerSize.height > containerSize.height;
  }, [zoom, playerSize, containerSize]);

  // Track player container rect changes for gizmo positioning
  useLayoutEffect(() => {
    if (suspendOverlay) return;
    const container = playerContainerRef.current;
    if (!container) return;

    const updateRect = () => {
      const nextRect = container.getBoundingClientRect();
      setPlayerContainerRect((prev) => {
        if (
          prev
          && prev.left === nextRect.left
          && prev.top === nextRect.top
          && prev.width === nextRect.width
          && prev.height === nextRect.height
        ) {
          return prev;
        }
        return nextRect;
      });
    };

    updateRect();

    const resizeObserver = new ResizeObserver(updateRect);
    resizeObserver.observe(container);

    window.addEventListener('scroll', updateRect, true);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [suspendOverlay]);

  // Handle click on background area to deselect items
  const backgroundRef = useRef<HTMLDivElement>(null);
  const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
    if (isMaskEditingActive) {
      e.stopPropagation();
      return;
    }
    if (isMarqueeJustFinished()) return;

    const target = e.target as HTMLElement;
    if (target.closest('[data-gizmo]')) return;

    useSelectionStore.getState().clearItemSelection();
  }, [isMaskEditingActive]);

  // Handle frame change from player
  // Skip when in preview mode to keep primary playhead stationary
  const handleFrameChange = useCallback((frame: number) => {
    const nextFrame = Math.round(frame);
    resolvePendingSeekLatency(nextFrame);
    maybeCompleteFastScrubHandoff(nextFrame);
    const pendingHandoffFrame = pendingFastScrubHandoffFrameRef.current;
    if (pendingHandoffFrame !== null && nextFrame !== pendingHandoffFrame) {
      scheduleFastScrubHandoffCheck();
      return;
    }
    if (ignorePlayerUpdatesRef.current) return;
    const playbackState = usePlaybackStore.getState();
    const runtimeSnapshot = getPreviewRuntimeSnapshotFromPlaybackState(
      playbackState,
      isGizmoInteractingRef.current,
    );
    const interactionMode = runtimeSnapshot.mode;
    if (interactionMode === 'scrubbing') return;

    if (ADAPTIVE_PREVIEW_QUALITY_ENABLED && interactionMode === 'playing') {
      const nowMs = performance.now();
      const previousSample = adaptiveFrameSampleRef.current;
      if (previousSample && nextFrame !== previousSample.frame) {
        const frameDelta = Math.max(1, Math.abs(nextFrame - previousSample.frame));
        const elapsedMs = nowMs - previousSample.tsMs;
        if (elapsedMs > 0) {
          const result = updateAdaptivePreviewQuality({
            state: adaptiveQualityStateRef.current,
            sampleMsPerFrame: elapsedMs / frameDelta,
            frameBudgetMs: getFrameBudgetMs(fps, playbackState.playbackRate),
            userQuality: playbackState.previewQuality,
            nowMs,
            allowRecovery: false,
          });
          adaptiveQualityStateRef.current = result.state;
          if (result.qualityChanged) {
            if (result.qualityChangeDirection === 'degrade') {
              previewPerfRef.current.adaptiveQualityDowngrades += 1;
            } else if (result.qualityChangeDirection === 'recover') {
              previewPerfRef.current.adaptiveQualityRecovers += 1;
            }
            setAdaptiveQualityCap(result.state.qualityCap);
          }
        }
      }
      adaptiveFrameSampleRef.current = { frame: nextFrame, tsMs: nowMs };
    } else {
      adaptiveFrameSampleRef.current = null;
      if (
        adaptiveQualityStateRef.current.overBudgetSamples !== 0
        || adaptiveQualityStateRef.current.underBudgetSamples !== 0
      ) {
        adaptiveQualityStateRef.current = {
          ...adaptiveQualityStateRef.current,
          overBudgetSamples: 0,
          underBudgetSamples: 0,
        };
      }
    }

    const { currentFrame, setCurrentFrame } = playbackState;
    if (currentFrame === nextFrame) return;
    setCurrentFrame(nextFrame);
  }, [
    fps,
    maybeCompleteFastScrubHandoff,
    resolvePendingSeekLatency,
    scheduleFastScrubHandoffCheck,
  ]);

  // Handle play state change from player
  const handlePlayStateChange = useCallback((playing: boolean) => {
    if (playing) {
      usePlaybackStore.getState().play();
    } else {
      usePlaybackStore.getState().pause();
    }
  }, []);
  const latestRenderSourceSwitch = perfPanelSnapshot?.renderSourceHistory[
    perfPanelSnapshot.renderSourceHistory.length - 1
  ] ?? null;

  return (
    <div
      ref={backgroundRef}
      className="w-full h-full bg-video-preview-background relative"
      style={{ overflow: needsOverflow ? 'auto' : 'visible' }}
      onClick={handleBackgroundClick}
      role="img"
      aria-label="Video preview"
    >
      <div
        className="min-w-full min-h-full grid place-items-center"
        style={{ padding: `calc(${EDITOR_LAYOUT_CSS_VALUES.previewPadding} / 2)` }}
        onClick={handleBackgroundClick}
      >
        <div className="relative">
          <div
            ref={setPlayerContainerRefCallback}
            data-player-container
            className="relative shadow-2xl"
            style={{
              width: `${playerSize.width}px`,
              height: `${playerSize.height}px`,
              transition: 'none',
              outline: '2px solid hsl(var(--border))',
              outlineOffset: 0,
            }}
            onDoubleClick={(e) => e.preventDefault()}
          >
            {isResolving && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
                <p className="text-white text-sm">Loading media...</p>
              </div>
            )}

            <Player
              ref={playerRef}
              durationInFrames={totalFrames}
              fps={fps}
              width={playerRenderSize.width}
              height={playerRenderSize.height}
              autoPlay={false}
              loop={false}
              controls={false}
              style={{
                width: '100%',
                height: '100%',
              }}
              onFrameChange={handleFrameChange}
              onPlayStateChange={handlePlayStateChange}
            >
              <MainComposition {...inputProps} />
            </Player>

            {FAST_SCRUB_RENDERER_ENABLED && (
              <canvas
                ref={scrubCanvasRef}
                className="absolute inset-0 pointer-events-none"
                style={{
                  width: '100%',
                  height: '100%',
                  zIndex: 4,
                  visibility: isRenderedOverlayVisible ? 'visible' : 'hidden',
                }}
              />
            )}

            {/* GPU effects overlay canvas Ã¢â‚¬â€ kept hidden. GPU effects are now
                applied per-item in the composition renderer. The canvas ref is
                retained for API compatibility. */}
            <canvas
              ref={gpuEffectsCanvasRef}
              className="absolute inset-0 pointer-events-none"
              style={{
                width: '100%',
                height: '100%',
                zIndex: 5,
                visibility: 'hidden',
              }}
            />

            {import.meta.env.DEV && showPerfPanel && perfPanelSnapshot && (() => {
              const p = perfPanelSnapshot;
              const srcLabel = p.renderSource === 'fast_scrub_overlay' ? 'Overlay'
                : p.renderSource === 'playback_transition_overlay' ? 'Transition' : 'Player';
              const srcColor = p.renderSource === 'player' ? '#4ade80' : '#60a5fa';
              const seekOk = p.seekLatencyAvgMs < 50;
              const qualOk = p.effectivePreviewQuality >= p.userPreviewQuality;
              const frameOk = p.frameTimeEmaMs <= p.frameTimeBudgetMs * 1.2;
              const trActive = p.transitionSessionActive;
              const trMode = p.transitionSessionMode === 'none' ? null
                : p.transitionSessionMode === 'dom' ? 'DOM' : 'Canvas';
              const lastSw = latestRenderSourceSwitch;
              const fmtSrc = (s: string) => s === 'fast_scrub_overlay' ? 'Overlay'
                : s === 'playback_transition_overlay' ? 'Transition' : 'Player';
              return (
                <div
                  className="absolute right-2 bottom-2 z-30 bg-black/80 text-white/90 rounded-md text-[10px] leading-[14px] font-mono pointer-events-none select-none backdrop-blur-sm"
                  style={{ padding: '6px 8px', minWidth: 180 }}
                  data-testid="preview-perf-panel"
                  title={`Toggle: Alt+Shift+P | URL: ?${PREVIEW_PERF_PANEL_QUERY_KEY}=1`}
                >
                  {/* Render source */}
                  <div style={{ marginBottom: 3 }}>
                    <span style={{ color: srcColor }}>{srcLabel}</span>
                    {p.staleScrubOverlayDrops > 0 && (
                      <span style={{ color: '#f87171' }}> {p.staleScrubOverlayDrops} stale</span>
                    )}
                    {lastSw && (
                      <span style={{ color: '#a1a1aa' }}>
                        {' '}{fmtSrc(lastSw.from)}{'\u2192'}{fmtSrc(lastSw.to)} @{lastSw.atFrame}
                      </span>
                    )}
                  </div>

                  {/* Seek & scrub */}
                  <div>
                    <span style={{ color: seekOk ? '#a1a1aa' : '#fbbf24' }}>
                      Seek {p.seekLatencyAvgMs.toFixed(0)}ms
                    </span>
                    {p.seekLatencyTimeouts > 0 && (
                      <span style={{ color: '#f87171' }}> {p.seekLatencyTimeouts} timeout</span>
                    )}
                    {p.scrubDroppedFrames > 0 && (
                      <span style={{ color: '#fbbf24' }}>
                        {' '}Scrub {p.scrubDroppedFrames}/{p.scrubUpdates} dropped
                      </span>
                    )}
                  </div>

                  {/* Quality & frame time */}
                  <div>
                    <span style={{ color: qualOk ? '#a1a1aa' : '#fbbf24' }}>
                      Quality {p.effectivePreviewQuality}x
                      {p.effectivePreviewQuality < p.userPreviewQuality && ` (cap ${p.adaptiveQualityCap}x)`}
                    </span>
                    {' '}
                    <span style={{ color: frameOk ? '#a1a1aa' : '#f87171' }}>
                      {p.frameTimeEmaMs.toFixed(0)}/{p.frameTimeBudgetMs.toFixed(0)}ms
                    </span>
                    {(p.adaptiveQualityDowngrades > 0 || p.adaptiveQualityRecovers > 0) && (
                      <span style={{ color: '#a1a1aa' }}>
                        {' '}{'\u2193'}{p.adaptiveQualityDowngrades} {'\u2191'}{p.adaptiveQualityRecovers}
                      </span>
                    )}
                  </div>

                  {/* Source pool */}
                  <div style={{ color: '#a1a1aa' }}>
                    Pool {p.sourceWarmKeep}/{p.sourceWarmTarget}
                    {' '}({p.sourcePoolSources}src {p.sourcePoolElements}el)
                    {p.sourceWarmEvictions > 0 && (
                      <span style={{ color: '#fbbf24' }}> {p.sourceWarmEvictions} evict</span>
                    )}
                  </div>

                  {/* Preseek worker */}
                  {(p.preseekRequests > 0 || p.preseekCachedBitmaps > 0) && (
                    <div style={{ color: '#a1a1aa' }}>
                      Preseek {p.preseekCacheHits + p.preseekInflightReuses}/{p.preseekRequests} hit
                      {' '}post {p.preseekWorkerSuccesses}/{p.preseekWorkerPosts}
                      {' '}cache {p.preseekCachedBitmaps}
                      {p.preseekWaitMatches > 0 && (
                        <span>
                          {' '}wait {p.preseekWaitResolved}/{p.preseekWaitMatches}
                        </span>
                      )}
                      {p.preseekWorkerFailures > 0 && (
                        <span style={{ color: '#fbbf24' }}> {p.preseekWorkerFailures} fail</span>
                      )}
                      {p.preseekWaitTimeouts > 0 && (
                        <span style={{ color: '#fbbf24' }}> {p.preseekWaitTimeouts} timeout</span>
                      )}
                    </div>
                  )}

                  {/* Media resolution */}
                  {(p.unresolvedQueue > 0 || p.pendingResolves > 0) && (
                    <div style={{ color: '#fbbf24' }}>
                      Resolving {p.pendingResolves} pending, {p.unresolvedQueue} queued
                      {' '}({p.resolveAvgMs.toFixed(0)}ms avg)
                    </div>
                  )}

                  {/* Transition session Ã¢â‚¬â€ only show when active or recent */}
                  {(trActive || p.transitionSessionCount > 0) && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: 3, paddingTop: 3 }}>
                      <div>
                        <span style={{ color: trActive ? '#60a5fa' : '#a1a1aa' }}>
                          {trActive ? `Transition ${trMode}` : 'Last transition'}
                          {p.transitionSessionComplex ? ' (complex)' : ''}
                        </span>
                        {trActive && (
                          <span style={{ color: '#a1a1aa' }}>
                            {' '}{p.transitionSessionStartFrame}{'\u2192'}{p.transitionSessionEndFrame}
                            {' '}buf:{p.transitionBufferedFrames}
                          </span>
                        )}
                      </div>
                      {p.transitionLastPrepareMs > 0 && (
                        <div style={{ color: p.transitionLastEntryMisses > 0 ? '#f87171' : '#a1a1aa' }}>
                          Prep {p.transitionLastPrepareMs.toFixed(0)}ms
                          {p.transitionLastReadyLeadMs > 0 && ` lead ${p.transitionLastReadyLeadMs.toFixed(0)}ms`}
                          {p.transitionLastEntryMisses > 0 && ` ${p.transitionLastEntryMisses} miss`}
                          <span style={{ color: '#a1a1aa' }}> #{p.transitionSessionCount}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Edit frame comparison overlays */}
            {hasRolling2Up ? (
              <RollingEditOverlay fps={fps} />
            ) : hasRipple2Up ? (
              <RippleEditOverlay fps={fps} />
            ) : hasSlip4Up ? (
              <SlipEditOverlay fps={fps} />
            ) : hasSlide4Up ? (
              <SlideEditOverlay fps={fps} />
            ) : null}
          </div>

          {!suspendOverlay && (
            <>
              <GizmoOverlay
                containerRect={playerContainerRect}
                playerSize={playerSize}
                projectSize={{ width: project.width, height: project.height }}
                zoom={zoom}
                hitAreaRef={backgroundRef as React.RefObject<HTMLDivElement>}
              />
              <MaskEditorContainer
                containerRect={playerContainerRect}
                playerSize={playerSize}
                projectSize={{ width: project.width, height: project.height }}
                zoom={zoom}
              />
              <CornerPinContainer
                containerRect={playerContainerRect}
                playerSize={playerSize}
                projectSize={{ width: project.width, height: project.height }}
                zoom={zoom}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
});
