import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/shared/ui/cn';
import {
  AUDIO_EQ_GAIN_DB_MAX,
  AUDIO_EQ_GAIN_DB_MIN,
  AUDIO_EQ_HIGH_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  AUDIO_EQ_LOW_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  AUDIO_EQ_MID_FREQUENCY_HZ,
  sampleAudioEqResponseCurve,
} from '@/shared/utils/audio-eq';
import type { ResolvedAudioEqSettings } from '@/types/audio';

export type AudioEqField =
  | 'audioEqLowGainDb'
  | 'audioEqLowMidGainDb'
  | 'audioEqMidGainDb'
  | 'audioEqHighMidGainDb'
  | 'audioEqHighGainDb';

interface AudioEqCurveEditorProps {
  settings: ResolvedAudioEqSettings;
  disabled?: boolean;
  className?: string;
  onLiveChange: (field: AudioEqField, value: number) => void;
  onChange: (field: AudioEqField, value: number) => void;
}

interface AudioEqBandDefinition {
  field: AudioEqField;
  settingsField: keyof ResolvedAudioEqSettings;
  label: string;
  frequencyHz: number;
}

const CURVE_WIDTH = 300;
const CURVE_HEIGHT = 132;
const CURVE_PADDING_X = 12;
const CURVE_PADDING_TOP = 10;
const CURVE_PADDING_BOTTOM = 20;
const CURVE_MIN_FREQUENCY_HZ = 40;
const CURVE_MAX_FREQUENCY_HZ = 16000;
const CURVE_GRID_LEVELS_DB = [18, 9, 0, -9, -18] as const;
const KEYBOARD_STEP_DB = 0.5;
const AUDIO_EQ_BANDS: ReadonlyArray<AudioEqBandDefinition> = Object.freeze([
  {
    field: 'audioEqLowGainDb',
    settingsField: 'lowGainDb',
    label: 'Low',
    frequencyHz: AUDIO_EQ_LOW_FREQUENCY_HZ,
  },
  {
    field: 'audioEqLowMidGainDb',
    settingsField: 'lowMidGainDb',
    label: 'Low Mid',
    frequencyHz: AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  },
  {
    field: 'audioEqMidGainDb',
    settingsField: 'midGainDb',
    label: 'Mid',
    frequencyHz: AUDIO_EQ_MID_FREQUENCY_HZ,
  },
  {
    field: 'audioEqHighMidGainDb',
    settingsField: 'highMidGainDb',
    label: 'High Mid',
    frequencyHz: AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  },
  {
    field: 'audioEqHighGainDb',
    settingsField: 'highGainDb',
    label: 'High',
    frequencyHz: AUDIO_EQ_HIGH_FREQUENCY_HZ,
  },
]);

function clampEqGainDb(value: number): number {
  return Math.max(AUDIO_EQ_GAIN_DB_MIN, Math.min(AUDIO_EQ_GAIN_DB_MAX, Math.round(value * 10) / 10));
}

function frequencyToX(frequencyHz: number): number {
  const normalized = (
    Math.log(frequencyHz) - Math.log(CURVE_MIN_FREQUENCY_HZ)
  ) / (
    Math.log(CURVE_MAX_FREQUENCY_HZ) - Math.log(CURVE_MIN_FREQUENCY_HZ)
  );
  return CURVE_PADDING_X + normalized * (CURVE_WIDTH - CURVE_PADDING_X * 2);
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

function getSettingsValueByField(settings: ResolvedAudioEqSettings, field: AudioEqField): number {
  switch (field) {
    case 'audioEqLowGainDb':
      return settings.lowGainDb;
    case 'audioEqLowMidGainDb':
      return settings.lowMidGainDb;
    case 'audioEqMidGainDb':
      return settings.midGainDb;
    case 'audioEqHighMidGainDb':
      return settings.highMidGainDb;
    case 'audioEqHighGainDb':
      return settings.highGainDb;
  }
}

export function AudioEqCurveEditor({
  settings,
  disabled = false,
  className,
  onLiveChange,
  onChange,
}: AudioEqCurveEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<{ field: AudioEqField; pointerId: number } | null>(null);
  const [draftValues, setDraftValues] = useState<Partial<Record<AudioEqField, number>> | null>(null);

  const displayedSettings = useMemo<ResolvedAudioEqSettings>(() => ({
    ...settings,
    lowGainDb: draftValues?.audioEqLowGainDb ?? settings.lowGainDb,
    lowMidGainDb: draftValues?.audioEqLowMidGainDb ?? settings.lowMidGainDb,
    midGainDb: draftValues?.audioEqMidGainDb ?? settings.midGainDb,
    highMidGainDb: draftValues?.audioEqHighMidGainDb ?? settings.highMidGainDb,
    highGainDb: draftValues?.audioEqHighGainDb ?? settings.highGainDb,
  }), [draftValues, settings]);

  const responsePoints = useMemo(
    () => sampleAudioEqResponseCurve(displayedSettings, {
      sampleCount: 80,
      minFrequencyHz: CURVE_MIN_FREQUENCY_HZ,
      maxFrequencyHz: CURVE_MAX_FREQUENCY_HZ,
    }),
    [displayedSettings],
  );

  const responsePath = useMemo(() => responsePoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${frequencyToX(point.frequencyHz)} ${gainToY(point.gainDb)}`)
    .join(' '), [responsePoints]);

  const beginDrag = useCallback((field: AudioEqField, pointerId: number, clientY: number) => {
    if (disabled) return;

    const root = rootRef.current;
    const rect = root?.getBoundingClientRect();
    if (!root || !rect || rect.height <= 0) return;

    root.setPointerCapture?.(pointerId);
    const localY = ((clientY - rect.top) / rect.height) * CURVE_HEIGHT;
    const value = yToGain(localY);

    setDragState({ field, pointerId });
    setDraftValues({ [field]: value });
    onLiveChange(field, value);
  }, [disabled, onLiveChange]);

  const updateDrag = useCallback((clientY: number) => {
    const root = rootRef.current;
    const rect = root?.getBoundingClientRect();
    if (!root || !rect || rect.height <= 0 || !dragState) return;

    const localY = ((clientY - rect.top) / rect.height) * CURVE_HEIGHT;
    const value = yToGain(localY);

    setDraftValues((previous) => ({
      ...(previous ?? {}),
      [dragState.field]: value,
    }));
    onLiveChange(dragState.field, value);
  }, [dragState, onLiveChange]);

  const finishDrag = useCallback((pointerId?: number) => {
    const root = rootRef.current;
    if (!dragState) return;
    if (pointerId !== undefined && dragState.pointerId !== pointerId) return;

    const field = dragState.field;
    const value = draftValues?.[field] ?? getSettingsValueByField(settings, field);

    root?.releasePointerCapture?.(dragState.pointerId);
    setDragState(null);
    setDraftValues(null);
    onChange(field, value);
  }, [dragState, draftValues, onChange, settings]);

  const handleBandReset = useCallback((field: AudioEqField) => {
    if (disabled) return;
    setDraftValues(null);
    onLiveChange(field, 0);
    onChange(field, 0);
  }, [disabled, onChange, onLiveChange]);

  const handleBandKeyDown = useCallback((field: AudioEqField, currentValue: number, event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Home') {
      return;
    }

    event.preventDefault();
    const direction = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
    const value = event.key === 'Home'
      ? 0
      : clampEqGainDb(currentValue + direction * (event.shiftKey ? 1 : KEYBOARD_STEP_DB));

    onLiveChange(field, value);
    onChange(field, value);
  }, [disabled, onChange, onLiveChange]);

  return (
    <div className={cn('w-full min-w-0', className)}>
      <div
        ref={rootRef}
        data-eq-curve-root="true"
        className={cn(
          'relative h-[132px] w-full overflow-hidden rounded-md border border-border/60 bg-muted/20 touch-none select-none',
          disabled ? 'opacity-60' : 'cursor-ns-resize',
        )}
        onPointerMove={(event) => {
          if (!dragState) return;
          updateDrag(event.clientY);
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
                stroke={level === 0 ? 'currentColor' : 'currentColor'}
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

          {AUDIO_EQ_BANDS.map((band) => (
            <line
              key={band.field}
              x1={frequencyToX(band.frequencyHz)}
              y1={CURVE_PADDING_TOP}
              x2={frequencyToX(band.frequencyHz)}
              y2={CURVE_HEIGHT - CURVE_PADDING_BOTTOM}
              stroke="currentColor"
              strokeOpacity={0.12}
              strokeDasharray="3 4"
            />
          ))}

          <path
            d={responsePath}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.9}
            strokeWidth={2}
          />

          <line
            x1={CURVE_PADDING_X}
            y1={CURVE_HEIGHT - CURVE_PADDING_BOTTOM}
            x2={CURVE_WIDTH - CURVE_PADDING_X}
            y2={CURVE_HEIGHT - CURVE_PADDING_BOTTOM}
            stroke="currentColor"
            strokeOpacity={0.18}
          />

          {AUDIO_EQ_BANDS.map((band) => (
            <text
              key={`${band.field}-label`}
              x={frequencyToX(band.frequencyHz)}
              y={CURVE_HEIGHT - 6}
              textAnchor="middle"
              fontSize="9"
              fill="currentColor"
              opacity={0.55}
            >
              {formatFrequencyLabel(band.frequencyHz)}
            </text>
          ))}
        </svg>

        {AUDIO_EQ_BANDS.map((band) => {
          const value = displayedSettings[band.settingsField];
          const isActive = dragState?.field === band.field;
          return (
            <button
              key={band.field}
              type="button"
              data-eq-band={band.field}
              aria-label={`${band.label} EQ handle`}
              className={cn(
                'absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-background shadow-sm transition-[transform,background-color] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                isActive ? 'h-4 w-4 scale-110 bg-foreground' : 'h-3.5 w-3.5 bg-primary',
                disabled && 'pointer-events-none',
              )}
              style={{
                left: `${(frequencyToX(band.frequencyHz) / CURVE_WIDTH) * 100}%`,
                top: `${(gainToY(value) / CURVE_HEIGHT) * 100}%`,
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                beginDrag(band.field, event.pointerId, event.clientY);
              }}
              onDoubleClick={() => {
                handleBandReset(band.field);
              }}
              onKeyDown={(event) => {
                handleBandKeyDown(band.field, value, event);
              }}
              title={`${band.label} ${value > 0 ? '+' : ''}${value.toFixed(1)} dB`}
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
