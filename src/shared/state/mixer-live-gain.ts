/**
 * Lightweight per-item gain overrides for real-time mixer fader adjustments.
 *
 * During fader drag, the mixer sets linear gain multipliers keyed by itemId.
 * Audio components subscribe per item, so only affected audio nodes re-render.
 * On fader release, overrides are cleared and the committed store value takes over.
 */

import { useCallback, useSyncExternalStore } from 'react';

const overrides = new Map<string, number>();
const listenersByItemId = new Map<string, Set<() => void>>();

function notifyItemIds(itemIds: Iterable<string>): void {
  const callbacks = new Set<() => void>();
  for (const itemId of itemIds) {
    const listeners = listenersByItemId.get(itemId);
    if (!listeners) continue;
    for (const listener of listeners) {
      callbacks.add(listener);
    }
  }
  for (const callback of callbacks) {
    callback();
  }
}

export function setMixerLiveGains(entries: Array<{ itemId: string; gain: number }>): void {
  const changedItemIds = new Set<string>();

  for (const { itemId, gain } of entries) {
    const nextGain = Object.is(gain, 1) ? undefined : gain;
    const previousGain = overrides.get(itemId);

    if (nextGain === undefined) {
      if (overrides.delete(itemId)) {
        changedItemIds.add(itemId);
      }
      continue;
    }

    if (Object.is(previousGain, nextGain)) {
      continue;
    }

    overrides.set(itemId, nextGain);
    changedItemIds.add(itemId);
  }

  if (changedItemIds.size > 0) {
    notifyItemIds(changedItemIds);
  }
}

export function clearMixerLiveGains(): void {
  if (overrides.size === 0) return;
  const changedItemIds = [...overrides.keys()];
  overrides.clear();
  notifyItemIds(changedItemIds);
}

export function clearMixerLiveGain(itemId: string): void {
  if (!overrides.delete(itemId)) return;
  notifyItemIds([itemId]);
}

export function getMixerLiveGain(itemId: string): number {
  return overrides.get(itemId) ?? 1;
}

function subscribe(itemId: string, callback: () => void): () => void {
  let listeners = listenersByItemId.get(itemId);
  if (!listeners) {
    listeners = new Set<() => void>();
    listenersByItemId.set(itemId, listeners);
  }

  listeners.add(callback);

  return () => {
    const currentListeners = listenersByItemId.get(itemId);
    if (!currentListeners) return;
    currentListeners.delete(callback);
    if (currentListeners.size === 0) {
      listenersByItemId.delete(itemId);
    }
  };
}

export function useMixerLiveGain(itemId: string): number {
  const subscribeToItem = useCallback((callback: () => void) => subscribe(itemId, callback), [itemId]);
  const getSnapshot = useCallback(() => getMixerLiveGain(itemId), [itemId]);
  return useSyncExternalStore(subscribeToItem, getSnapshot, getSnapshot);
}
