import type { TimelineItem } from '@/types/timeline';
import { useItemsStore } from '../items-store';
import type { CollisionRect } from '../../utils/collision-utils';

function findNextAvailableSpaceOnTrack(
  proposedFrom: number,
  durationInFrames: number,
  trackItems: ReadonlyArray<CollisionRect>
): number {
  let nextFrom = Math.max(0, proposedFrom);

  for (const item of trackItems) {
    const itemEnd = item.from + item.durationInFrames;
    if (itemEnd <= nextFrom) {
      continue;
    }

    if (item.from >= nextFrom + durationInFrames) {
      break;
    }

    nextFrom = itemEnd;
  }

  return nextFrom;
}

export function placeItemsWithoutTimelineOverlap(items: TimelineItem[]): TimelineItem[] {
  const occupiedRangesByTrack = new Map<string, CollisionRect[]>();
  const placedItems: TimelineItem[] = [];

  for (const item of useItemsStore.getState().items) {
    const trackItems = occupiedRangesByTrack.get(item.trackId);
    if (trackItems) {
      trackItems.push(item);
    } else {
      occupiedRangesByTrack.set(item.trackId, [item]);
    }
  }

  for (const trackItems of occupiedRangesByTrack.values()) {
    trackItems.sort((a, b) => a.from - b.from);
  }

  for (const item of items) {
    let trackItems = occupiedRangesByTrack.get(item.trackId);
    if (!trackItems) {
      trackItems = [];
      occupiedRangesByTrack.set(item.trackId, trackItems);
    }

    const finalFrom = findNextAvailableSpaceOnTrack(
      item.from,
      item.durationInFrames,
      trackItems
    );
    const placedItem = finalFrom === item.from
      ? item
      : { ...item, from: finalFrom };

    placedItems.push(placedItem);
    trackItems.push({
      trackId: placedItem.trackId,
      from: placedItem.from,
      durationInFrames: placedItem.durationInFrames,
    });
    trackItems.sort((a, b) => a.from - b.from);
  }

  return placedItems;
}
