import { memo, useCallback, useMemo } from 'react';
import type { TimelineItem } from '@/types/timeline';
import { ClipFilmstrip } from '../clip-filmstrip';
import { ClipWaveform } from '../clip-waveform';
import { CompoundClipWaveform } from '../clip-waveform/compound-clip-waveform';
import { useSettingsStore } from '@/features/timeline/deps/settings';
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store';
import { useCompositionsStore } from '../../stores/compositions-store';
import { useItemsStore } from '../../stores/items-store';
import { EDITOR_LAYOUT_CSS_VALUES } from '@/shared/ui/editor-layout';
import { summarizeCompositionClipContent } from '../../utils/composition-clip-summary';
import { hasLinkedAudioCompanion } from '@/shared/utils/linked-media';

interface ClipContentProps {
  item: TimelineItem;
  clipWidth: number;
  fps: number;
  isClipVisible: boolean;
  visibleStartRatio?: number;
  visibleEndRatio?: number;
  pixelsPerSecond: number;
  preferImmediateRendering?: boolean;
  audioWaveformScale?: number;
}

/**
 * Renders the visual content of a timeline clip based on its type.
 * - Video: 2-row layout — label | filmstrip
 * - Audio: Label row + waveform
 * - Composition (with video): Label | filmstrip | waveform
 * - Text: Text content preview
 * - Adjustment: Effects summary
 * - Image/Shape: Simple label
 */
export const ClipContent = memo(function ClipContent({
  item,
  clipWidth,
  fps,
  isClipVisible,
  visibleStartRatio = 0,
  visibleEndRatio = 1,
  pixelsPerSecond,
  preferImmediateRendering = false,
  audioWaveformScale = 1,
}: ClipContentProps) {
  const showWaveforms = useSettingsStore((s) => s.showWaveforms);
  const showFilmstrips = useSettingsStore((s) => s.showFilmstrips);
  const isCompositionAudioWrapper = item.type === 'audio' && !!item.compositionId;

  const renderCompoundClipLabel = useCallback((label: string) => (
    <div
      className="flex items-center gap-1.5 px-2 shrink-0"
      style={{
        height: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight,
        lineHeight: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight,
      }}
    >
      <span className="rounded bg-violet-950/40 px-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-violet-100/90">
        Compound
      </span>
      <span className="min-w-0 truncate text-[11px] font-medium">{label}</span>
    </div>
  ), []);

  // For composition items: find the topmost video in the sub-comp for filmstrip
  const compositionId = item.type === 'composition' || isCompositionAudioWrapper ? item.compositionId : undefined;
  const composition = useCompositionsStore(
    useCallback((s) => (compositionId ? s.compositionById[compositionId] ?? null : null), [compositionId])
  );
  const hasCompositionAudioCompanion = useItemsStore(
    useCallback(
      (s) => item.type === 'composition' && hasLinkedAudioCompanion(s.items, item),
      [item],
    ),
  );
  const compositionSummary = useMemo(() => {
    if (!composition) {
      return {
        visualMediaId: null,
        audioMediaId: null,
        hasOwnedAudio: false,
        hasMultipleOwnedAudioSources: false,
      };
    }

    return summarizeCompositionClipContent({
      items: composition.items,
      tracks: composition.tracks,
      fps: composition.fps,
      });
  }, [composition]);
  const compositionVisualMediaId = compositionSummary.visualMediaId;
  const showCompositionWaveform = showWaveforms && compositionSummary.hasOwnedAudio && !hasCompositionAudioCompanion;

  // Use the relevant mediaId so source mapping remains stable for each clip type.
  const effectiveMediaId = item.mediaId ?? compositionVisualMediaId;

  // sourceStart/sourceDuration are stored in source-frame units. Prefer duration-ratio
  // mapping so rendering remains stable even if media FPS metadata changes after drop.
  const sourceFps = useMediaLibraryStore(
    useCallback((s) => {
      if (!effectiveMediaId) return fps;
      const media = s.mediaById[effectiveMediaId];
      return media?.fps || fps;
    }, [effectiveMediaId, fps])
  );
  const mediaDuration = useMediaLibraryStore(
    useCallback((s) => {
      if (!effectiveMediaId) return 0;
      const media = s.mediaById[effectiveMediaId];
      return media?.duration || 0;
    }, [effectiveMediaId])
  );

  const sourceDurationFrames = Math.max(1, item.sourceDuration ?? item.durationInFrames);
  const sourceStartFrames = Math.max(0, item.sourceStart ?? 0);
  const compositionSourceDurationFrames = Math.max(
    1,
    item.type === 'composition' || isCompositionAudioWrapper
      ? (item.sourceDuration ?? composition?.durationInFrames ?? item.durationInFrames)
      : sourceDurationFrames
  );
  const compositionSourceStartFrames = Math.max(
    0,
    item.type === 'composition' || isCompositionAudioWrapper
      ? (item.sourceStart ?? item.trimStart ?? 0)
      : sourceStartFrames
  );

  const sourceDuration = mediaDuration > 0
    ? mediaDuration
    : (sourceDurationFrames / sourceFps);
  const sourceStart = mediaDuration > 0
    ? (sourceStartFrames / sourceDurationFrames) * mediaDuration
    : (sourceStartFrames / sourceFps);

  const trimStart = (item.trimStart ?? 0) / fps;
  const speed = item.speed ?? 1;
  const compositionVisualSourceFps = useMediaLibraryStore(
    useCallback((s) => {
      if (!compositionVisualMediaId) return fps;
      return s.mediaById[compositionVisualMediaId]?.fps || fps;
    }, [compositionVisualMediaId, fps])
  );
  const compositionVisualMediaDuration = useMediaLibraryStore(
    useCallback((s) => {
      if (!compositionVisualMediaId) return 0;
      return s.mediaById[compositionVisualMediaId]?.duration || 0;
    }, [compositionVisualMediaId])
  );
  const compositionVisualSourceDuration = compositionVisualMediaDuration > 0
    ? compositionVisualMediaDuration
    : (compositionSourceDurationFrames / compositionVisualSourceFps);
  const compositionVisualSourceStart = compositionVisualMediaDuration > 0
    ? (compositionSourceStartFrames / compositionSourceDurationFrames) * compositionVisualMediaDuration
    : (compositionSourceStartFrames / compositionVisualSourceFps);
  const compoundClipTimelineFps = composition?.fps ?? fps;
  const compoundClipSourceDuration = compositionSourceDurationFrames / compoundClipTimelineFps;
  const compoundClipSourceStart = compositionSourceStartFrames / compoundClipTimelineFps;

  // Video clip 2-row layout: label | filmstrip
  if (item.type === 'video' && item.mediaId) {
    return (
      <div className="absolute inset-0 flex flex-col">
        {/* Row 1: Label - fixed height */}
        <div
          className="px-2 text-[11px] font-medium truncate shrink-0"
          style={{
            height: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight,
            lineHeight: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight,
          }}
        >
          {item.label}
        </div>
        {/* Row 2: Filmstrip - flex-1 to fill remaining space */}
        <div className="relative overflow-hidden flex-1 min-h-0">
          {showFilmstrips && (
            <ClipFilmstrip
              mediaId={item.mediaId}
              clipWidth={clipWidth}
              sourceStart={sourceStart}
              sourceDuration={sourceDuration}
              trimStart={trimStart}
              speed={speed}
              fps={fps}
              isVisible={isClipVisible}
              visibleStartRatio={visibleStartRatio}
              visibleEndRatio={visibleEndRatio}
              pixelsPerSecond={pixelsPerSecond}
              preferImmediateRendering={preferImmediateRendering}
            />
          )}
        </div>
      </div>
    );
  }

  // Audio clip - label row + waveform fills remaining space
  if (item.type === 'audio' && item.mediaId) {
    return (
      <div className="absolute inset-0 flex flex-col">
        {/* Row 1: Label - fixed height */}
        <div
          className="px-2 text-[11px] font-medium truncate shrink-0"
          style={{
            height: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight,
            lineHeight: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight,
          }}
        >
          {item.label}
        </div>
        {/* Row 2: Waveform - fills remaining space */}
        {showWaveforms && (
          <div className="relative overflow-hidden bg-waveform-gradient flex-1 min-h-0">
            <div className="absolute inset-0" style={{ transform: `scaleY(${audioWaveformScale})`, transformOrigin: '50% 50%' }}>
              <ClipWaveform
                mediaId={item.mediaId}
                clipWidth={clipWidth}
                sourceStart={sourceStart}
                sourceDuration={sourceDuration}
                trimStart={trimStart}
                speed={speed}
                fps={fps}
                isVisible={isClipVisible}
                pixelsPerSecond={pixelsPerSecond}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (isCompositionAudioWrapper && composition) {
    return (
      <div className="absolute inset-0 flex flex-col">
        {renderCompoundClipLabel(item.label || 'Compound Clip')}
        {showWaveforms && (
          <div className="relative overflow-hidden bg-waveform-gradient flex-1 min-h-0">
            <CompoundClipWaveform
              composition={composition}
              clipWidth={clipWidth}
              sourceStart={compoundClipSourceStart}
              sourceDuration={compoundClipSourceDuration}
              isVisible={isClipVisible}
              pixelsPerSecond={pixelsPerSecond}
            />
          </div>
        )}
      </div>
    );
  }

  // Text item - show text content preview
  if (item.type === 'text') {
    return (
      <div className="absolute inset-0 flex flex-col px-2 py-1 overflow-hidden">
        <div className="text-[10px] text-muted-foreground truncate">Text</div>
        <div className="text-xs font-medium truncate flex-1">
          {item.text || 'Empty text'}
        </div>
      </div>
    );
  }

  // Composition item - filmstrip from topmost video in sub-comp, or label fallback
  if (item.type === 'composition') {
    if (compositionVisualMediaId) {
      return (
        <div className="absolute inset-0 flex flex-col">
          {renderCompoundClipLabel(item.label || 'Compound Clip')}
          {/* Row 2: Filmstrip - flex-1 */}
          <div className="relative overflow-hidden flex-1 min-h-0">
            {showFilmstrips && (
              <ClipFilmstrip
                mediaId={compositionVisualMediaId}
                clipWidth={clipWidth}
                sourceStart={compositionVisualSourceStart}
                sourceDuration={compositionVisualSourceDuration}
                trimStart={0}
                speed={1}
                fps={fps}
                isVisible={isClipVisible}
                visibleStartRatio={visibleStartRatio}
                visibleEndRatio={visibleEndRatio}
                pixelsPerSecond={pixelsPerSecond}
                preferImmediateRendering={preferImmediateRendering}
              />
            )}
          </div>
          {/* Row 3: Waveform */}
          {showCompositionWaveform && composition && (
            <div
              className="relative overflow-hidden bg-waveform-gradient"
              style={{ height: EDITOR_LAYOUT_CSS_VALUES.timelineWaveformRowHeight }}
            >
              <CompoundClipWaveform
                composition={composition}
                clipWidth={clipWidth}
                sourceStart={compoundClipSourceStart}
                sourceDuration={compoundClipSourceDuration}
                isVisible={isClipVisible}
                pixelsPerSecond={pixelsPerSecond}
              />
            </div>
          )}
        </div>
      );
    }
    if (compositionSummary.hasOwnedAudio && composition && !hasCompositionAudioCompanion) {
      return (
        <div className="absolute inset-0 flex flex-col">
          {renderCompoundClipLabel(item.label || 'Compound Clip')}
          {showWaveforms && (
            <div className="relative overflow-hidden bg-waveform-gradient flex-1 min-h-0">
              <CompoundClipWaveform
                composition={composition}
                clipWidth={clipWidth}
                sourceStart={compoundClipSourceStart}
                sourceDuration={compoundClipSourceDuration}
                isVisible={isClipVisible}
                pixelsPerSecond={pixelsPerSecond}
              />
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="absolute inset-0 flex flex-col px-2 py-1 overflow-hidden">
        <div className="text-[10px] text-muted-foreground truncate">Compound Clip</div>
        <div className="text-xs font-medium truncate flex-1">
          {item.label || 'Composition'}
        </div>
      </div>
    );
  }

  // Adjustment layer - show effects summary
  if (item.type === 'adjustment') {
    const enabledEffectsCount = item.effects?.filter(e => e.enabled).length ?? 0;
    return (
      <div className="absolute inset-0 flex flex-col px-2 py-1 overflow-hidden">
        <div className="text-[10px] text-muted-foreground truncate">Adjustment Layer</div>
        <div className="text-xs font-medium truncate flex-1">
          {enabledEffectsCount > 0
            ? `${enabledEffectsCount} effect${enabledEffectsCount > 1 ? 's' : ''}`
            : 'No effects'}
        </div>
      </div>
    );
  }

  // Default for image and shape items - simple label
  return (
    <div className="px-2 py-1 text-xs font-medium truncate">
      {item.label}
    </div>
  );
});
