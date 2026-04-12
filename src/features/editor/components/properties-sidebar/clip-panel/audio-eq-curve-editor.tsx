import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/shared/ui/cn';
import {
  AUDIO_EQ_GAIN_DB_MAX,
  AUDIO_EQ_GAIN_DB_MIN,
  AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
  AUDIO_EQ_MID_FREQUENCY_HZ,
  clampAudioEqFrequencyHz,
  clampAudioEqGainDb,
  getAudioEqSettings,
  resolveAudioEqSettings,
  sampleAudioEqResponseCurve,
  type AudioEqFieldSource,
} from '@/shared/utils/audio-eq';
import type { ResolvedAudioEqSettings } from '@/types/audio';

export type AudioEqPatch = Partial<AudioEqFieldSource>;

interface AudioEqCurveEditorProps {
  settings: ResolvedAudioEqSettings;
  disabled?: boolean;
  className?: string;
  onLiveChange: (patch: AudioEqPatch) => void;
  onChange: (patch: AudioEqPatch) => void;
}

interface GainHandleDefinition {
  id: 'low' | 'low-mid' | 'mid' | 'high-mid' | 'high';
  kind: 'gain';
  label: string;
  frequencyField?:
    | 'audioEqLowFrequencyHz'
    | 'audioEqLowMidFrequencyHz'
    | 'audioEqHighMidFrequencyHz'
    | 'audioEqHighFrequencyHz';
  gainField:
    | 'audioEqLowGainDb'
    | 'audioEqLowMidGainDb'
    | 'audioEqMidGainDb'
    | 'audioEqHighMidGainDb'
    | 'audioEqHighGainDb';
  fixedFrequency?: boolean;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  defaultFrequencyHz: number;
  getFrequencyHz: (settings: ResolvedAudioEqSettings) => number;
  getGainDb: (settings: ResolvedAudioEqSettings) => number;
}

interface CutHandleDefinition {
  id: 'low-cut' | 'high-cut';
  kind: 'cut';
  label: string;
  enabledField: 'audioEqLowCutEnabled' | 'audioEqHighCutEnabled';
  frequencyField: 'audioEqLowCutFrequencyHz' | 'audioEqHighCutFrequencyHz';
  minFrequencyHz: number;
  maxFrequencyHz: number;
  defaultFrequencyHz: number;
  getEnabled: (settings: ResolvedAudioEqSettings) => boolean;
  getFrequencyHz: (settings: ResolvedAudioEqSettings) => number;
}

type AudioEqHandleDefinition = GainHandleDefinition | CutHandleDefinition;

const CURVE_WIDTH = 320;
const CURVE_HEIGHT = 140;
const CURVE_PADDING_X = 12;
const CURVE_PADDING_TOP = 10;
const CURVE_PADDING_BOTTOM = 22;
const CURVE_MIN_FREQUENCY_HZ = 30;
const CURVE_MAX_FREQUENCY_HZ = 22000;
const CURVE_GRID_LEVELS_DB = [18, 9, 0, -9, -18] as const;
const CURVE_GRID_FREQUENCIES_HZ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
const KEYBOARD_GAIN_STEP_DB = 0.5;
const KEYBOARD_FREQUENCY_RATIO = 1.06;
const KEYBOARD_FREQUENCY_RATIO_FAST = 1.16;

const AUDIO_EQ_HANDLES: ReadonlyArray<AudioEqHandleDefinition> = Object.freeze([
  {
    id: 'low-cut',
    kind: 'cut',
    label: 'Low Cut',
    enabledField: 'audioEqLowCutEnabled',
    frequencyField: 'audioEqLowCutFrequencyHz',
    minFrequencyHz: AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
    maxFrequencyHz: AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
    defaultFrequencyHz: AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
    getEnabled: (settings) => settings.lowCutEnabled,
    getFrequencyHz: (settings) => settings.lowCutFrequencyHz,
  },
  {
    id: 'low',
    kind: 'gain',
    label: 'Low',
    frequencyField: 'audioEqLowFrequencyHz',
    gainField: 'audioEqLowGainDb',
    minFrequencyHz: AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
    maxFrequencyHz: AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
    defaultFrequencyHz: AUDIO_EQ_LOW_FREQUENCY_HZ,
    getFrequencyHz: (settings) => settings.lowFrequencyHz,
    getGainDb: (settings) => settings.lowGainDb,
  },
  {
    id: 'low-mid',
    kind: 'gain',
    label: 'Low Mid',
    frequencyField: 'audioEqLowMidFrequencyHz',
    gainField: 'audioEqLowMidGainDb',
    minFrequencyHz: AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
    maxFrequencyHz: AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
    defaultFrequencyHz: AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
    getFrequencyHz: (settings) => settings.lowMidFrequencyHz,
    getGainDb: (settings) => settings.lowMidGainDb,
  },
  {
    id: 'mid',
    kind: 'gain',
    label: 'Mid',
    gainField: 'audioEqMidGainDb',
    fixedFrequency: true,
    minFrequencyHz: AUDIO_EQ_MID_FREQUENCY_HZ,
    maxFrequencyHz: AUDIO_EQ_MID_FREQUENCY_HZ,
    defaultFrequencyHz: AUDIO_EQ_MID_FREQUENCY_HZ,
    getFrequencyHz: () => AUDIO_EQ_MID_FREQUENCY_HZ,
    getGainDb: (settings) => settings.midGainDb,
  },
  {
    id: 'high-mid',
    kind: 'gain',
    label: 'High Mid',
    frequencyField: 'audioEqHighMidFrequencyHz',
    gainField: 'audioEqHighMidGainDb',
    minFrequencyHz: AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
    maxFrequencyHz: AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
    defaultFrequencyHz: AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
    getFrequencyHz: (settings) => settings.highMidFrequencyHz,
    getGainDb: (settings) => settings.highMidGainDb,
  },
  {
    id: 'high',
    kind: 'gain',
    label: 'High',
    frequencyField: 'audioEqHighFrequencyHz',
    gainField: 'audioEqHighGainDb',
    minFrequencyHz: AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
    maxFrequencyHz: AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
    defaultFrequencyHz: AUDIO_EQ_HIGH_FREQUENCY_HZ,
    getFrequencyHz: (settings) => settings.highFrequencyHz,
    getGainDb: (settings) => settings.highGainDb,
  },
  {
    id: 'high-cut',
    kind: 'cut',
    label: 'High Cut',
    enabledField: 'audioEqHighCutEnabled',
    frequencyField: 'audioEqHighCutFrequencyHz',
    minFrequencyHz: AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
    maxFrequencyHz: AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
    defaultFrequencyHz: AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
    getEnabled: (settings) => settings.highCutEnabled,
    getFrequencyHz: (settings) => settings.highCutFrequencyHz,
  },
]);

function clampEqGainDb(value: number): number {
  return Math.round(clampAudioEqGainDb(value) * 10) / 10;
}

function roundFrequency(value: number): number {
  return Math.round(value);
}

function frequencyToX(frequencyHz: number): number {
  const normalized = (
    Math.log(frequencyHz) - Math.log(CURVE_MIN_FREQUENCY_HZ)
  ) / (
    Math.log(CURVE_MAX_FREQUENCY_HZ) - Math.log(CURVE_MIN_FREQUENCY_HZ)
  );
  return CURVE_PADDING_X + normalized * (CURVE_WIDTH - CURVE_PADDING_X * 2);
}

function xToFrequency(x: number): number {
  const plotWidth = CURVE_WIDTH - CURVE_PADDING_X * 2;
  const clampedX = Math.max(CURVE_PADDING_X, Math.min(CURVE_WIDTH - CURVE_PADDING_X, x));
  const normalized = (clampedX - CURVE_PADDING_X) / Math.max(plotWidth, 1);
  return CURVE_MIN_FREQUENCY_HZ * Math.pow(CURVE_MAX_FREQUENCY_HZ / CURVE_MIN_FREQUENCY_HZ, normalized);
}

function gainToY(gainDb: number): number {
  const clamped = clampEqGainDb(gainDb);
  const normalized = (AUDIO_EQ_GAIN_DB_MAX - clamped) / (AUDIO_EQ_GAIN_DB_MAX - AUDIO_EQ_GAIN_DB_MIN);
  return CURVE_PADDING_TOP + normalized * (CURVE_HEIGHT - CURVE_PADDING_TOP - CURVE_PADDING_BOTTOM);
}

function yToGain(y: number): number {
  const plotHeight = CURVE_HEIGHT - CURVE_PADDING_TOP - CURVE_PADDING_BOTTOM;
  const clampedY = Math.max(CURVE_PADDING_TOP, Math.min(CURVE_HEIGHT - CURVE_PADDING_BOTTOM, y));
  const normalized = (clampedY - CURVE_PADDING_TOP) / plotHeight;
  return clampEqGainDb(AUDIO_EQ_GAIN_DB_MAX - normalized * (AUDIO_EQ_GAIN_DB_MAX - AUDIO_EQ_GAIN_DB_MIN));
}

function formatFrequencyLabel(frequencyHz: number): string {
  if (frequencyHz >= 1000) {
    const khz = frequencyHz / 1000;
    return `${Number.isInteger(khz) ? khz.toFixed(0) : khz.toFixed(1)}k`;
  }
  return `${Math.round(frequencyHz)}`;
}

function nudgeFrequency(
  currentFrequencyHz: number,
  direction: -1 | 1,
  fast: boolean,
  minFrequencyHz: number,
  maxFrequencyHz: number,
): number {
  const ratio = fast ? KEYBOARD_FREQUENCY_RATIO_FAST : KEYBOARD_FREQUENCY_RATIO;
  const nextFrequencyHz = direction < 0
    ? currentFrequencyHz / ratio
    : currentFrequencyHz * ratio;
  return roundFrequency(clampAudioEqFrequencyHz(nextFrequencyHz, minFrequencyHz, maxFrequencyHz, currentFrequencyHz));
}

function mergeDisplayedSettings(
  settings: ResolvedAudioEqSettings,
  patch?: AudioEqPatch | null,
): ResolvedAudioEqSettings {
  if (!patch) return settings;
  const patchSettings = getAudioEqSettings(patch);
  const merged: Record<string, unknown> = { ...settings };
  for (const [key, value] of Object.entries(patchSettings)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return resolveAudioEqSettings(merged as unknown as ResolvedAudioEqSettings);
}

function getCutHandleY(enabled: boolean): number {
  return enabled ? CURVE_HEIGHT - CURVE_PADDING_BOTTOM + 1 : CURVE_HEIGHT - CURVE_PADDING_BOTTOM + 6;
}

function createPatchForPointer(
  handle: AudioEqHandleDefinition,
  localX: number,
  localY: number,
): AudioEqPatch {
  const frequencyHz = roundFrequency(clampAudioEqFrequencyHz(
    xToFrequency(localX),
    handle.minFrequencyHz,
    handle.maxFrequencyHz,
    handle.defaultFrequencyHz,
  ));

  if (handle.kind === 'cut') {
    return {
      [handle.enabledField]: true,
      [handle.frequencyField]: frequencyHz,
    };
  }

  const patch: AudioEqPatch = {
    [handle.gainField]: yToGain(localY),
  };
  if (handle.frequencyField) {
    patch[handle.frequencyField] = frequencyHz;
  }
  return patch;
}

function getResetPatch(handle: AudioEqHandleDefinition): AudioEqPatch {
  if (handle.kind === 'cut') {
    return {
      [handle.enabledField]: false,
      [handle.frequencyField]: handle.defaultFrequencyHz,
    };
  }

  const patch: AudioEqPatch = {
    [handle.gainField]: 0,
  };
  if (handle.frequencyField) {
    patch[handle.frequencyField] = handle.defaultFrequencyHz;
  }
  return patch;
}

export function AudioEqCurveEditor({
  settings,
  disabled = false,
  className,
  onLiveChange,
  onChange,
}: AudioEqCurveEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<{ handleId: AudioEqHandleDefinition['id']; pointerId: number } | null>(null);
  const [draftPatch, setDraftPatch] = useState<AudioEqPatch | null>(null);

  const displayedSettings = useMemo(
    () => mergeDisplayedSettings(settings, draftPatch),
    [draftPatch, settings],
  );

  const responsePoints = useMemo(
    () => sampleAudioEqResponseCurve(displayedSettings, {
      sampleCount: 96,
      minFrequencyHz: CURVE_MIN_FREQUENCY_HZ,
      maxFrequencyHz: CURVE_MAX_FREQUENCY_HZ,
    }),
    [displayedSettings],
  );

  const responsePath = useMemo(
    () => responsePoints
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${frequencyToX(point.frequencyHz)} ${gainToY(point.gainDb)}`)
      .join(' '),
    [responsePoints],
  );

  const getLocalPointer = useCallback((clientX: number, clientY: number) => {
    const root = rootRef.current;
    if (!root) return null;
    const rect = root.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    return {
      x: ((clientX - rect.left) / rect.width) * CURVE_WIDTH,
      y: ((clientY - rect.top) / rect.height) * CURVE_HEIGHT,
    };
  }, []);

  const beginDrag = useCallback((handle: AudioEqHandleDefinition, pointerId: number, clientX: number, clientY: number) => {
    if (disabled) return;
    const root = rootRef.current;
    const localPointer = getLocalPointer(clientX, clientY);
    if (!root || !localPointer) return;

    root.setPointerCapture?.(pointerId);
    const patch = createPatchForPointer(handle, localPointer.x, localPointer.y);
    setDragState({ handleId: handle.id, pointerId });
    setDraftPatch(patch);
    onLiveChange(patch);
  }, [disabled, getLocalPointer, onLiveChange]);

  const updateDrag = useCallback((clientX: number, clientY: number) => {
    if (!dragState) return;
    const localPointer = getLocalPointer(clientX, clientY);
    if (!localPointer) return;

    const handle = AUDIO_EQ_HANDLES.find((entry) => entry.id === dragState.handleId);
    if (!handle) return;

    const patch = createPatchForPointer(handle, localPointer.x, localPointer.y);
    setDraftPatch(patch);
    onLiveChange(patch);
  }, [dragState, getLocalPointer, onLiveChange]);

  const finishDrag = useCallback((pointerId?: number) => {
    if (!dragState) return;
    if (pointerId !== undefined && dragState.pointerId !== pointerId) return;

    const root = rootRef.current;
    root?.releasePointerCapture?.(dragState.pointerId);

    const patch = draftPatch ?? {};
    setDragState(null);
    setDraftPatch(null);
    onChange(patch);
  }, [dragState, draftPatch, onChange]);

  const handleBandReset = useCallback((handle: AudioEqHandleDefinition) => {
    if (disabled) return;
    const patch = getResetPatch(handle);
    setDraftPatch(null);
    onLiveChange(patch);
    onChange(patch);
  }, [disabled, onChange, onLiveChange]);

  const handleBandKeyDown = useCallback((handle: AudioEqHandleDefinition, event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (handle.kind === 'cut') {
      if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();

      const patch = event.key === 'Home'
        ? getResetPatch(handle)
        : {
          [handle.enabledField]: true,
          [handle.frequencyField]: nudgeFrequency(
            handle.getFrequencyHz(displayedSettings),
            event.key === 'ArrowLeft' ? -1 : 1,
            event.shiftKey,
            handle.minFrequencyHz,
            handle.maxFrequencyHz,
          ),
        };
      onLiveChange(patch);
      onChange(patch);
      return;
    }

    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();

    const currentFrequencyHz = handle.getFrequencyHz(displayedSettings);
    const currentGainDb = handle.getGainDb(displayedSettings);

    const patch: AudioEqPatch = event.key === 'Home'
      ? getResetPatch(handle)
      : {
        [handle.gainField]: event.key === 'ArrowUp' || event.key === 'ArrowDown'
          ? clampEqGainDb(currentGainDb + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 1 : KEYBOARD_GAIN_STEP_DB))
          : currentGainDb,
      };

    if (!handle.fixedFrequency && handle.frequencyField && event.key !== 'Home') {
      patch[handle.frequencyField] = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
        ? nudgeFrequency(
          currentFrequencyHz,
          event.key === 'ArrowLeft' ? -1 : 1,
          event.shiftKey,
          handle.minFrequencyHz,
          handle.maxFrequencyHz,
        )
        : currentFrequencyHz;
    }

    onLiveChange(patch);
    onChange(patch);
  }, [disabled, displayedSettings, onChange, onLiveChange]);

  return (
    <div className={cn('w-full min-w-0', className)}>
      <div
        ref={rootRef}
        data-eq-curve-root="true"
        className={cn(
          'relative h-[140px] w-full overflow-hidden rounded-md border border-border/60 bg-muted/20 touch-none select-none',
          disabled ? 'opacity-60' : 'cursor-move',
        )}
        onPointerMove={(event) => {
          if (!dragState) return;
          updateDrag(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          finishDrag(event.pointerId);
        }}
        onPointerCancel={(event) => {
          finishDrag(event.pointerId);
        }}
      >
        <svg
          viewBox={`0 0 ${CURVE_WIDTH} ${CURVE_HEIGHT}`}
          className="h-full w-full"
          aria-label="EQ curve editor"
        >
          {CURVE_GRID_LEVELS_DB.map((level) => (
            <g key={level}>
              <line
                x1={CURVE_PADDING_X}
                y1={gainToY(level)}
                x2={CURVE_WIDTH - CURVE_PADDING_X}
                y2={gainToY(level)}
                stroke="currentColor"
                strokeOpacity={level === 0 ? 0.28 : 0.12}
                strokeDasharray={level === 0 ? undefined : '3 4'}
              />
              <text
                x={4}
                y={gainToY(level) + 3}
                fontSize="9"
                fill="currentColor"
                opacity={0.45}
              >
                {level > 0 ? `+${level}` : level}
              </text>
            </g>
          ))}

          {CURVE_GRID_FREQUENCIES_HZ.map((frequencyHz) => (
            <g key={frequencyHz}>
              <line
                x1={frequencyToX(frequencyHz)}
                y1={CURVE_PADDING_TOP}
                x2={frequencyToX(frequencyHz)}
                y2={CURVE_HEIGHT - CURVE_PADDING_BOTTOM}
                stroke="currentColor"
                strokeOpacity={0.1}
                strokeDasharray="3 4"
              />
              <text
                x={frequencyToX(frequencyHz)}
                y={CURVE_HEIGHT - 6}
                textAnchor="middle"
                fontSize="9"
                fill="currentColor"
                opacity={0.5}
              >
                {formatFrequencyLabel(frequencyHz)}
              </text>
            </g>
          ))}

          <path
            d={responsePath}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.9}
            strokeWidth={2}
          />
        </svg>

        {AUDIO_EQ_HANDLES.map((handle) => {
          const frequencyHz = handle.getFrequencyHz(displayedSettings);
          const isActive = dragState?.handleId === handle.id;
          const top = handle.kind === 'cut'
            ? getCutHandleY(handle.getEnabled(displayedSettings))
            : gainToY(handle.getGainDb(displayedSettings));
          const title = handle.kind === 'cut'
            ? `${handle.label} ${handle.getEnabled(displayedSettings) ? 'on' : 'off'} ${formatFrequencyLabel(frequencyHz)}`
            : `${handle.label} ${handle.getGainDb(displayedSettings) > 0 ? '+' : ''}${handle.getGainDb(displayedSettings).toFixed(1)} dB @ ${formatFrequencyLabel(frequencyHz)}`;

          return (
            <button
              key={handle.id}
              type="button"
              data-eq-band={handle.id}
              aria-label={`${handle.label} EQ handle`}
              className={cn(
                'absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-background shadow-sm transition-[transform,background-color] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                isActive ? 'h-4 w-4 scale-110 bg-foreground' : 'h-3.5 w-3.5 bg-primary',
                handle.kind === 'cut' && !handle.getEnabled(displayedSettings) && 'bg-muted-foreground/60',
                disabled && 'pointer-events-none',
              )}
              style={{
                left: `${(frequencyToX(frequencyHz) / CURVE_WIDTH) * 100}%`,
                top: `${(top / CURVE_HEIGHT) * 100}%`,
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                beginDrag(handle, event.pointerId, event.clientX, event.clientY);
              }}
              onDoubleClick={() => {
                handleBandReset(handle);
              }}
              onKeyDown={(event) => {
                handleBandKeyDown(handle, event);
              }}
              title={title}
            />
          );
        })}

        {disabled ? (
          <div className="pointer-events-none absolute inset-x-0 top-2 text-center text-[10px] text-muted-foreground">
            Mixed EQ values
          </div>
        ) : null}
      </div>
    </div>
  );
}
