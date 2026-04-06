import { useRef, useEffect, useState, useMemo, useCallback, memo } from 'react';
import { type PlayerRef } from '@/features/preview/deps/player-core';
import type { PreviewQuality } from '@/shared/state/playback';
import { usePlaybackStore } from '@/shared/state/playback';
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge';
import { resolveEffectiveTrackStates } from '@/features/preview/deps/timeline-utils';
import { resolveProxyUrl } from '../utils/media-resolver';
import { GizmoOverlay } from './gizmo-overlay';
import { MaskEditorContainer } from './mask-editor-container';
import { CornerPinContainer } from './corner-pin-container';
import { PreviewPerfPanel } from './preview-perf-panel';
import { PreviewStage } from './preview-stage';
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
import {
  resolveTransitionWindows,
  type ResolvedTransitionWindow,
} from '@/domain/timeline/transitions/transition-planner';
import {
  getPreviewRuntimeSnapshotFromPlaybackState,
} from '../utils/preview-state-coordinator';
import {
  createAdaptivePreviewQualityState,
  getFrameBudgetMs,
  updateAdaptivePreviewQuality,
} from '../utils/adaptive-preview-quality';
import { shouldPreferPlayerForStyledTextScrub as shouldPreferPlayerForStyledTextScrubGuard } from '../utils/text-render-guard';
import {
  shouldForceContinuousPreviewOverlay,
  useGpuEffectsOverlay,
} from '../hooks/use-gpu-effects-overlay';
import { useCustomPlayer } from '../hooks/use-custom-player';
import { usePreviewMediaResolution } from '../hooks/use-preview-media-resolution';
import { usePreviewMediaPreload } from '../hooks/use-preview-media-preload';
import { usePreviewOverlayController } from '../hooks/use-preview-overlay-controller';
import { usePreviewPerfPanel } from '../hooks/use-preview-perf-panel';
import { usePreviewPerfPublisher } from '../hooks/use-preview-perf-publisher';
import { usePreviewRenderPump } from '../hooks/use-preview-render-pump-controller';
import {
  usePreviewRendererController,
  type PreviewCompositionRenderer,
} from '../hooks/use-preview-renderer-controller';
import { usePreviewSourceWarm } from '../hooks/use-preview-source-warm';
import { usePreviewViewModel } from '../hooks/use-preview-view-model';
import {
  usePreviewTransitionSessionController,
  type TransitionPreviewSessionTrace,
  type TransitionPreviewTelemetry,
} from '../hooks/use-preview-transition-session-controller';

// DEV-only: cached reference loaded via dynamic import so the module
// is excluded from production bundles entirely.
let _devJitterMonitor: import('@/shared/logging/frame-jitter-monitor').FrameJitterMonitor | null = null;
if (import.meta.env.DEV) {
  void import('@/shared/logging/frame-jitter-monitor').then((m) => {
    _devJitterMonitor = m.getFrameJitterMonitor();
  });
}
import {
  ADAPTIVE_PREVIEW_QUALITY_ENABLED,
  type VideoSourceSpan,
  type FastScrubBoundarySource,
  toTrackFingerprint,
  getMediaResolveCost,
} from '../utils/preview-constants';

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
  const scrubCanvasRef = useRef<HTMLCanvasElement>(null);
  const gpuEffectsCanvasRef = useRef<HTMLCanvasElement>(null);
  const scrubFrameDirtyRef = useRef(false);
  const bypassPreviewSeekRef = useRef(false);
  const scrubRendererRef = useRef<PreviewCompositionRenderer | null>(null);
  const ensureFastScrubRendererRef = useRef<() => Promise<PreviewCompositionRenderer | null>>(async () => null);
  const scrubInitPromiseRef = useRef<Promise<PreviewCompositionRenderer | null> | null>(null);
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
  const bgTransitionRendererRef = useRef<PreviewCompositionRenderer | null>(null);
  const bgTransitionInitPromiseRef = useRef<Promise<PreviewCompositionRenderer | null> | null>(null);
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
  const {
    showPerfPanel,
    perfPanelSnapshot,
    latestRenderSourceSwitch,
  } = usePreviewPerfPanel();
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
  const {
    fps,
    tracks,
    keyframes,
    items,
    itemsByTrackId,
    mediaDependencyVersion,
    transitions,
    mediaById,
    brokenMediaCount,
    hasRolling2Up,
    hasRipple2Up,
    hasSlip4Up,
    hasSlide4Up,
    activeGizmoItemType,
    isGizmoInteracting,
    isPlaying,
    zoom,
    useProxy,
    blobUrlVersion,
    proxyReadyCount,
    playerSize,
    needsOverflow,
    playerContainerRef,
    playerContainerRect,
    backgroundRef,
    setPlayerContainerRefCallback,
    handleBackgroundClick,
  } = usePreviewViewModel({
    project,
    containerSize,
    suspendOverlay,
  });
  const showGpuEffectsOverlay = useGpuEffectsOverlay(
    gpuEffectsCanvasRef,
    playerContainerRef,
    scrubOffscreenCanvasRef,
    scrubFrameDirtyRef,
  );
  const isGizmoInteractingRef = useRef(isGizmoInteracting);
  isGizmoInteractingRef.current = isGizmoInteracting;
  const preferPlayerForTextGizmoRef = useRef(false);
  const preferPlayerForStyledTextScrubRef = useRef(false);
  const adaptiveQualityStateRef = useRef(createAdaptivePreviewQualityState(1));
  const adaptiveFrameSampleRef = useRef<{ frame: number; tsMs: number } | null>(null);
  const [adaptiveQualityCap, setAdaptiveQualityCap] = useState<PreviewQuality>(1);

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
    trackPlayerSeek,
    resolvePendingSeekLatency,
  } = usePreviewPerfPublisher({
    previewPerfRef,
    adaptiveQualityStateRef,
    transitionSessionTraceRef,
    transitionTelemetryRef,
    transitionSessionBufferedFramesRef,
    renderSourceRef,
    renderSourceSwitchCountRef,
    renderSourceHistoryRef,
    getUnresolvedQueueSize,
    getPendingResolveCount,
  });

  const { ignorePlayerUpdatesRef } = useCustomPlayer(
    playerRef,
    bypassPreviewSeekRef,
    preferPlayerForStyledTextScrubRef,
    isGizmoInteractingRef,
    trackPlayerSeek,
  );

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

  /** Like getTransitionWindowForFrame but without cooldown â€” true only in the active span. */
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

  const setCaptureCanvasSource = usePreviewBridgeStore((s) => s.setCaptureCanvasSource);

  const {
    disposeFastScrubRenderer,
    ensureFastScrubRenderer,
    ensureBgTransitionRenderer,
  } = usePreviewRendererController({
    fps,
    isResolving,
    forceFastScrubOverlay,
    playerRenderSize,
    renderSize,
    fastScrubInputProps,
    fastScrubScaledTracks,
    fastScrubScaledKeyframes,
    fastScrubRendererStructureKey,
    isGizmoInteractingRef,
    bypassPreviewSeekRef,
    showFastScrubOverlayRef,
    showPlaybackTransitionOverlayRef,
    scrubCanvasRef,
    scrubRendererRef,
    ensureFastScrubRendererRef,
    scrubInitPromiseRef,
    scrubPreloadPromiseRef,
    scrubOffscreenCanvasRef,
    scrubOffscreenCtxRef,
    scrubRendererStructureKeyRef,
    scrubRenderInFlightRef,
    scrubRequestedFrameRef,
    bgTransitionRendererRef,
    bgTransitionInitPromiseRef,
    bgTransitionRendererStructureKeyRef,
    bgTransitionRenderInFlightRef,
    scrubPrewarmQueueRef,
    scrubPrewarmQueuedSetRef,
    scrubPrewarmedFramesRef,
    scrubPrewarmedFrameSetRef,
    scrubPrewarmedSourcesRef,
    scrubPrewarmedSourceOrderRef,
    scrubPrewarmedSourceTouchFrameRef,
    scrubOffscreenRenderedFrameRef,
    playbackTransitionPreparePromiseRef,
    playbackTransitionPreparingFrameRef,
    deferredPlaybackTransitionPrepareFrameRef,
    transitionPrepareTimeoutRef,
    transitionSessionBufferedFramesRef,
    captureCanvasSourceInFlightRef,
    captureInFlightRef,
    captureImageDataInFlightRef,
    captureScaleCanvasRef,
    resumeScrubLoopRef,
    scrubMountedRef,
    lastPausedPrearmTargetRef,
    previewPerfRef,
    getPreviewTransformOverride,
    getPreviewEffectsOverride,
    getPreviewCornerPinOverride,
    getPreviewPathVerticesOverride,
    getLiveItemSnapshot,
    getLiveKeyframes,
    clearPendingFastScrubHandoff,
    clearTransitionPlaybackSession,
    resetResolveRetryState,
    setCaptureFrame,
    setCaptureFrameImageData,
    setCaptureCanvasSource,
    setDisplayedFrame,
  });
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
  const perfPanel = import.meta.env.DEV && showPerfPanel && perfPanelSnapshot ? (
    <PreviewPerfPanel
      snapshot={perfPanelSnapshot}
      latestRenderSourceSwitch={latestRenderSourceSwitch}
    />
  ) : null;

  const comparisonOverlay = hasRolling2Up ? (
    <RollingEditOverlay fps={fps} />
  ) : hasRipple2Up ? (
    <RippleEditOverlay fps={fps} />
  ) : hasSlip4Up ? (
    <SlipEditOverlay fps={fps} />
  ) : hasSlide4Up ? (
    <SlideEditOverlay fps={fps} />
  ) : null;

  const overlayControls = !suspendOverlay ? (
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
  ) : null;

  return (
    <PreviewStage
      backgroundRef={backgroundRef}
      playerRef={playerRef}
      scrubCanvasRef={scrubCanvasRef}
      gpuEffectsCanvasRef={gpuEffectsCanvasRef}
      needsOverflow={needsOverflow}
      playerSize={playerSize}
      playerRenderSize={playerRenderSize}
      totalFrames={totalFrames}
      fps={fps}
      isResolving={isResolving}
      isRenderedOverlayVisible={isRenderedOverlayVisible}
      inputProps={inputProps}
      onBackgroundClick={handleBackgroundClick}
      onFrameChange={handleFrameChange}
      onPlayStateChange={handlePlayStateChange}
      setPlayerContainerRefCallback={setPlayerContainerRefCallback}
      perfPanel={perfPanel}
      comparisonOverlay={comparisonOverlay}
      overlayControls={overlayControls}
    />
  );
});
