import { useRippleEditPreviewStore } from '../stores/ripple-edit-preview-store';
import { useRollingEditPreviewStore } from '../stores/rolling-edit-preview-store';
import { useZoomStore } from '../stores/zoom-store';
import { useSelectionStore } from '@/shared/state/selection';

const SHORT_PREVIEW_DELAY_MS = 120;
const LONG_PREVIEW_DELAY_MS = 220;
const VERY_LONG_PREVIEW_DELAY_MS = 360;
const PREVIEW_IDLE_TIMEOUT_MS = 1200;

interface SchedulePreviewWorkOptions {
  delayMs?: number;
  idleTimeoutMs?: number;
}

function hasActiveTimelineGesture(): boolean {
  return !!useSelectionStore.getState().dragState?.isDragging;
}

function hasActiveEditPreview(): boolean {
  const rolling = useRollingEditPreviewStore.getState();
  if (rolling.trimmedItemId !== null || rolling.neighborItemId !== null || rolling.handle !== null) {
    return true;
  }

  const ripple = useRippleEditPreviewStore.getState();
  return ripple.trimmedItemId !== null || ripple.handle !== null;
}

export function isPreviewWorkDeferred(): boolean {
  return useZoomStore.getState().isZoomInteracting
    || hasActiveTimelineGesture()
    || hasActiveEditPreview();
}

export function subscribePreviewWorkBudget(callback: () => void): () => void {
  const unsubscribers = [
    useZoomStore.subscribe(callback),
    useSelectionStore.subscribe(callback),
    useRollingEditPreviewStore.subscribe(callback),
    useRippleEditPreviewStore.subscribe(callback),
  ];

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}

export function getPreviewStartupDelayMs(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return SHORT_PREVIEW_DELAY_MS;
  }
  if (durationSec >= 3600) {
    return VERY_LONG_PREVIEW_DELAY_MS;
  }
  if (durationSec >= 900) {
    return LONG_PREVIEW_DELAY_MS;
  }
  return SHORT_PREVIEW_DELAY_MS;
}

function scheduleOnIdle(callback: () => void, delayMs: number, idleTimeoutMs: number): () => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let idleId: number | null = null;
  let cancelled = false;

  const run = () => {
    if (cancelled) return;

    if (typeof requestIdleCallback === 'function') {
      idleId = requestIdleCallback(() => {
        idleId = null;
        if (!cancelled) {
          callback();
        }
      }, { timeout: idleTimeoutMs });
      return;
    }

    timeoutId = setTimeout(() => {
      timeoutId = null;
      if (!cancelled) {
        callback();
      }
    }, 0);
  };

  timeoutId = setTimeout(() => {
    timeoutId = null;
    run();
  }, Math.max(0, delayMs));

  return () => {
    cancelled = true;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    if (idleId !== null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(idleId);
    }
  };
}

export function schedulePreviewWork(
  task: () => void,
  options: SchedulePreviewWorkOptions = {},
): () => void {
  const delayMs = options.delayMs ?? 0;
  const idleTimeoutMs = options.idleTimeoutMs ?? PREVIEW_IDLE_TIMEOUT_MS;

  let cancelled = false;
  let cancelScheduled = () => {};
  let unsubscribeBudget = () => {};

  const cleanup = () => {
    cancelScheduled();
    unsubscribeBudget();
  };

  const scheduleAttempt = () => {
    cancelScheduled();
    cancelScheduled = scheduleOnIdle(() => {
      if (cancelled) return;
      if (isPreviewWorkDeferred()) {
        waitForBudget();
        return;
      }
      task();
    }, delayMs, idleTimeoutMs);
  };

  const onBudgetChange = () => {
    if (cancelled || isPreviewWorkDeferred()) {
      return;
    }
    unsubscribeBudget();
    unsubscribeBudget = () => {};
    scheduleAttempt();
  };

  const waitForBudget = () => {
    unsubscribeBudget();
    unsubscribeBudget = subscribePreviewWorkBudget(onBudgetChange);
  };

  if (isPreviewWorkDeferred()) {
    waitForBudget();
  } else {
    scheduleAttempt();
  }

  return () => {
    cancelled = true;
    cleanup();
  };
}
