import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { TimelineItem } from '@/types/timeline';
import type { ResolvedTransform } from '@/types/transform';
import {
  useKeyframesStore,
  useTimelineSettingsStore,
} from '@/features/preview/deps/timeline-store';
import { usePlaybackStore } from '@/shared/state/playback';
import { getResolvedPlaybackFrame } from '@/shared/state/playback/frame-resolution';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import {
  applyTransformOverride,
  resolveItemTransformAtFrame,
} from '@/features/preview/deps/composition-runtime';
import { expandTextTransformForPreview } from '../utils/text-layout';

interface ProjectSize {
  width: number;
  height: number;
}

function applyTextExpansion(
  item: TimelineItem,
  transform: ResolvedTransform,
  preview: Record<string, { properties?: Parameters<typeof expandTextTransformForPreview>[2] }> | null,
): ResolvedTransform {
  if (item.type !== 'text') return transform;
  return expandTextTransformForPreview(item, transform, preview?.[item.id]?.properties);
}

/**
 * Resolve visual transforms for multiple items (base -> keyframes -> preview).
 */
export function useVisualTransforms(
  items: TimelineItem[],
  projectSize: ProjectSize
): Map<string, ResolvedTransform> {
  const fps = useTimelineSettingsStore((s) => s.fps);
  const itemIds = useMemo(() => items.map((item) => item.id), [items]);
  const itemKeyframes = useKeyframesStore(
    useShallow(
      useCallback(
        (s) => itemIds.map((itemId) => s.keyframesByItemId[itemId] ?? null),
        [itemIds]
      )
    )
  );
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const previewFrame = usePlaybackStore((s) => s.previewFrame);
  const displayedFrame = usePlaybackStore((s) => s.displayedFrame);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const currentFrameEpoch = usePlaybackStore((s) => s.currentFrameEpoch);
  const previewFrameEpoch = usePlaybackStore((s) => s.previewFrameEpoch);
  const activeGizmo = useGizmoStore((s) => s.activeGizmo);
  const gizmoPreviewTransform = useGizmoStore((s) => s.previewTransform);
  const preview = useGizmoStore((s) => s.preview);
  const animationFrame = getResolvedPlaybackFrame({
    currentFrame,
    previewFrame,
    displayedFrame,
    isPlaying,
    currentFrameEpoch,
    previewFrameEpoch,
  });

  return useMemo(() => {
    const transforms = new Map<string, ResolvedTransform>();
    const canvas = { width: projectSize.width, height: projectSize.height, fps };

    for (const [index, item] of items.entries()) {
      const itemKeyframe = itemKeyframes[index] ?? undefined;
      const animatedTransform = resolveItemTransformAtFrame(item, {
        canvas,
        frame: animationFrame,
        keyframes: itemKeyframe,
      });

      if (activeGizmo?.itemId === item.id && gizmoPreviewTransform) {
        let gizmoTransform = applyTransformOverride(animatedTransform, gizmoPreviewTransform);
        gizmoTransform = applyTextExpansion(item, gizmoTransform, preview);
        transforms.set(item.id, gizmoTransform);
        continue;
      }

      const previewTransform = preview?.[item.id]?.transform;
      if (previewTransform) {
        let resolvedPreview = applyTransformOverride(animatedTransform, previewTransform);
        resolvedPreview = applyTextExpansion(item, resolvedPreview, preview);
        transforms.set(item.id, resolvedPreview);
        continue;
      }

      transforms.set(item.id, applyTextExpansion(item, animatedTransform, preview));
    }

    return transforms;
  }, [
    items,
    projectSize.height,
    projectSize.width,
    itemKeyframes,
    animationFrame,
    activeGizmo?.itemId,
    gizmoPreviewTransform,
    preview,
    fps,
  ]);
}
