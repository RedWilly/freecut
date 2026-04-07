import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { TimelineItem } from '@/types/timeline';
import { useSelectionStore } from '@/shared/state/selection';
import { useTimelineStore } from '../../stores/timeline-store';
import { DRAG_OPACITY } from '../../constants';
import { dragOffsetRef, dragPreviewOffsetByItemRef } from '../../hooks/use-timeline-drag';
import {
  getTimelineItemDragParticipation,
  shouldDimTimelineItemForDrag,
  type TimelineItemGestureMode,
} from './drag-visual-mode';

type JoinDragState = { left: boolean; right: boolean };

type DragVisualItem = Pick<TimelineItem, 'id' | 'from' | 'durationInFrames' | 'trackId'>;

interface UseDragVisualStateParams {
  item: DragVisualItem;
  gestureMode: TimelineItemGestureMode;
  isDragging: boolean;
  transformRef: RefObject<HTMLDivElement | null>;
  ghostRef: RefObject<HTMLDivElement | null>;
}

interface UseDragVisualStateResult {
  dragAffectsJoin: JoinDragState;
  isAnyDragActiveRef: MutableRefObject<boolean>;
  dragWasActiveRef: MutableRefObject<boolean>;
  isPartOfMultiDrag: boolean;
  isAltDrag: boolean;
  isPartOfDrag: boolean;
  isBeingDragged: boolean;
  shouldDimForDrag: boolean;
}

function getJoinDragStateForItem(params: {
  item: DragVisualItem;
  items: TimelineItem[];
  draggedItemIds: string[];
}): JoinDragState {
  const { item, items, draggedItemIds } = params;

  const leftNeighbor = items.find(
    (other) => other.id !== item.id
      && other.trackId === item.trackId
      && other.from + other.durationInFrames === item.from,
  );
  const rightNeighbor = items.find(
    (other) => other.id !== item.id
      && other.trackId === item.trackId
      && other.from === item.from + item.durationInFrames,
  );

  return {
    left: draggedItemIds.includes(item.id) || !!(leftNeighbor && draggedItemIds.includes(leftNeighbor.id)),
    right: draggedItemIds.includes(item.id) || !!(rightNeighbor && draggedItemIds.includes(rightNeighbor.id)),
  };
}

export function useDragVisualState({
  item,
  gestureMode,
  isDragging,
  transformRef,
  ghostRef,
}: UseDragVisualStateParams): UseDragVisualStateResult {
  const [dragAffectsJoin, setDragAffectsJoin] = useState<JoinDragState>({ left: false, right: false });
  const wasDraggingRef = useRef(false);
  const isAnyDragActiveRef = useRef(false);
  const dragWasActiveRef = useRef(false);
  const dragParticipationRef = useRef<0 | 1 | 2>(0);
  const rafIdRef = useRef<number | null>(null);

  const itemFromRef = useRef(item.from);
  const itemDurationRef = useRef(item.durationInFrames);
  const itemTrackIdRef = useRef(item.trackId);
  itemFromRef.current = item.from;
  itemDurationRef.current = item.durationInFrames;
  itemTrackIdRef.current = item.trackId;

  useEffect(() => {
    const updateTransform = () => {
      if (!transformRef.current) return;

      const participation = dragParticipationRef.current;
      const isPartOfDrag = participation > 0 && !isDragging;
      const isAltDrag = participation === 2;

      if (isPartOfDrag) {
        const offset = dragPreviewOffsetByItemRef.current[item.id] ?? dragOffsetRef.current;

        if (isAltDrag) {
          transformRef.current.style.transform = '';
          transformRef.current.style.opacity = '';
          transformRef.current.style.transition = 'none';
          transformRef.current.style.pointerEvents = 'none';

          if (ghostRef.current) {
            ghostRef.current.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
            ghostRef.current.style.display = 'block';
          }
        } else {
          transformRef.current.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
          transformRef.current.style.opacity = String(DRAG_OPACITY);
          transformRef.current.style.transition = 'none';
          transformRef.current.style.pointerEvents = 'none';
          transformRef.current.style.zIndex = '50';

          if (ghostRef.current) {
            ghostRef.current.style.display = 'none';
          }
        }

        rafIdRef.current = requestAnimationFrame(updateTransform);
      }
    };

    const cleanupDragStyles = () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      if (transformRef.current) {
        transformRef.current.style.transition = 'none';
        transformRef.current.style.transform = '';
        transformRef.current.style.opacity = '';
        transformRef.current.style.pointerEvents = '';
        transformRef.current.style.zIndex = '';
      }

      if (ghostRef.current) {
        ghostRef.current.style.display = 'none';
      }
    };

    let dragWasActiveTimeout: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = useSelectionStore.subscribe((state) => {
      const wasDragActive = isAnyDragActiveRef.current;
      const isDragActive = !!state.dragState?.isDragging;
      isAnyDragActiveRef.current = isDragActive;

      if (isDragActive && state.dragState?.draggedItemIds) {
        const nextJoinState = getJoinDragStateForItem({
          item: {
            id: item.id,
            from: itemFromRef.current,
            durationInFrames: itemDurationRef.current,
            trackId: itemTrackIdRef.current,
          },
          items: useTimelineStore.getState().items,
          draggedItemIds: state.dragState.draggedItemIds,
        });

        setDragAffectsJoin((previous) => (
          previous.left === nextJoinState.left && previous.right === nextJoinState.right
            ? previous
            : nextJoinState
        ));
      } else if (wasDragActive && !isDragActive) {
        setDragAffectsJoin((previous) => (
          !previous.left && !previous.right ? previous : { left: false, right: false }
        ));
      }

      if (wasDragActive && !isDragActive) {
        dragWasActiveRef.current = true;
        if (dragWasActiveTimeout) clearTimeout(dragWasActiveTimeout);
        dragWasActiveTimeout = setTimeout(() => {
          dragWasActiveRef.current = false;
        }, 100);
      }

      const nextParticipation = getTimelineItemDragParticipation({
        itemId: item.id,
        dragState: state.dragState,
        gestureMode,
      });
      const previousParticipation = dragParticipationRef.current;
      dragParticipationRef.current = nextParticipation;

      if (previousParticipation === 0 && nextParticipation > 0 && !isDragging) {
        rafIdRef.current = requestAnimationFrame(updateTransform);
      }

      if (previousParticipation > 0 && nextParticipation === 0) {
        cleanupDragStyles();
      }
    });

    return () => {
      unsubscribe();
      cleanupDragStyles();
      if (dragWasActiveTimeout) clearTimeout(dragWasActiveTimeout);
    };
  }, [gestureMode, item.id, isDragging]);

  useEffect(() => {
    if (wasDraggingRef.current && !isDragging && transformRef.current) {
      transformRef.current.style.transition = 'none';
      requestAnimationFrame(() => {
        if (transformRef.current) {
          transformRef.current.style.transition = '';
        }
      });
    }

    wasDraggingRef.current = isDragging;
  }, [isDragging]);

  const isPartOfMultiDrag = dragParticipationRef.current > 0;
  const isAltDrag = dragParticipationRef.current === 2;
  const isPartOfDrag = isPartOfMultiDrag && !isDragging;
  const isBeingDragged = isDragging || isPartOfDrag;

  return {
    dragAffectsJoin,
    isAnyDragActiveRef,
    dragWasActiveRef,
    isPartOfMultiDrag,
    isAltDrag,
    isPartOfDrag,
    isBeingDragged,
    shouldDimForDrag: shouldDimTimelineItemForDrag({
      isBeingDragged,
      isAltDrag,
      gestureMode,
    }),
  };
}
