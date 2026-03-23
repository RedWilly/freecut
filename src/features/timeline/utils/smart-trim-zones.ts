export type SmartTrimIntent = 'ripple-start' | 'ripple-end' | 'roll-start' | 'roll-end' | null;
export type SmartBodyIntent = 'slip-body' | 'slide-body' | null;

interface ResolveSmartTrimIntentParams {
  x: number;
  width: number;
  hasLeftNeighbor: boolean;
  hasRightNeighbor: boolean;
  currentIntent?: SmartTrimIntent;
  edgeZonePx?: number;
  rollZonePx?: number;
  retentionPx?: number;
}

export function resolveSmartTrimIntent({
  x,
  width,
  hasLeftNeighbor,
  hasRightNeighbor,
  currentIntent = null,
  edgeZonePx = 12,
  rollZonePx = 6,
  retentionPx = 4,
}: ResolveSmartTrimIntentParams): SmartTrimIntent {
  if (width <= 0) return null;

  const distanceToStart = Math.max(0, x);
  const distanceToEnd = Math.max(0, width - x);

  if (currentIntent === 'roll-start' || currentIntent === 'ripple-start') {
    if (distanceToStart <= edgeZonePx + retentionPx && distanceToStart <= distanceToEnd + retentionPx) {
      if (hasLeftNeighbor && currentIntent === 'roll-start' && distanceToStart <= rollZonePx + retentionPx) {
        return 'roll-start';
      }
      if (hasLeftNeighbor && currentIntent === 'ripple-start' && distanceToStart <= Math.max(2, rollZonePx - 2)) {
        return 'roll-start';
      }
      return 'ripple-start';
    }
  }

  if (currentIntent === 'roll-end' || currentIntent === 'ripple-end') {
    if (distanceToEnd <= edgeZonePx + retentionPx && distanceToEnd <= distanceToStart + retentionPx) {
      if (hasRightNeighbor && currentIntent === 'roll-end' && distanceToEnd <= rollZonePx + retentionPx) {
        return 'roll-end';
      }
      if (hasRightNeighbor && currentIntent === 'ripple-end' && distanceToEnd <= Math.max(2, rollZonePx - 2)) {
        return 'roll-end';
      }
      return 'ripple-end';
    }
  }

  const closestEdge = distanceToStart <= distanceToEnd ? 'start' : 'end';
  const closestDistance = closestEdge === 'start' ? distanceToStart : distanceToEnd;

  if (closestDistance > edgeZonePx) return null;

  if (closestEdge === 'start') {
    if (hasLeftNeighbor && closestDistance <= rollZonePx) {
      return 'roll-start';
    }
    return 'ripple-start';
  }

  if (hasRightNeighbor && closestDistance <= rollZonePx) {
    return 'roll-end';
  }
  return 'ripple-end';
}

export function smartTrimIntentToHandle(intent: SmartTrimIntent): 'start' | 'end' | null {
  if (intent === 'ripple-start' || intent === 'roll-start') return 'start';
  if (intent === 'ripple-end' || intent === 'roll-end') return 'end';
  return null;
}

export function smartTrimIntentToMode(intent: SmartTrimIntent): 'rolling' | 'ripple' | null {
  if (intent === 'roll-start' || intent === 'roll-end') return 'rolling';
  if (intent === 'ripple-start' || intent === 'ripple-end') return 'ripple';
  return null;
}

interface ResolveSmartBodyIntentParams {
  y: number;
  height: number;
  labelRowHeight: number;
  isMediaItem: boolean;
  currentIntent?: SmartBodyIntent;
  switchBufferPx?: number;
}

export function resolveSmartBodyIntent({
  y,
  height,
  labelRowHeight,
  isMediaItem,
  currentIntent = null,
  switchBufferPx = 8,
}: ResolveSmartBodyIntentParams): SmartBodyIntent {
  if (!isMediaItem || height <= 0) return null;
  if (y < 0 || y > height) return null;

  const safeLabelRowHeight = Math.max(0, Math.min(labelRowHeight, height));
  if (safeLabelRowHeight <= 0 || safeLabelRowHeight >= height) return null;

  if (currentIntent === 'slide-body') {
    return y <= safeLabelRowHeight + switchBufferPx ? 'slide-body' : 'slip-body';
  }

  if (currentIntent === 'slip-body') {
    return y >= safeLabelRowHeight - switchBufferPx ? 'slip-body' : 'slide-body';
  }

  return y <= safeLabelRowHeight ? 'slide-body' : 'slip-body';
}
