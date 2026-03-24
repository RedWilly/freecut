import type { VisualEffect } from '@/types/effects';
import type {
  AdjustmentItem,
  ShapeItem,
  ShapeType,
  TextItem,
} from '@/types/timeline';

export const DEFAULT_GENERATED_LAYER_DURATION_SECONDS = 60;

export interface TimelineTemplateDragData {
  type: 'timeline-template';
  itemType: 'text' | 'shape';
  label: string;
  shapeType?: ShapeType;
}

interface LayerPlacement {
  trackId: string;
  from: number;
  durationInFrames: number;
}

interface VisualLayerPlacement extends LayerPlacement {
  canvasWidth: number;
  canvasHeight: number;
}

export function isTimelineTemplateDragData(value: unknown): value is TimelineTemplateDragData {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<TimelineTemplateDragData>;
  if (candidate.type !== 'timeline-template') return false;
  if (candidate.itemType !== 'text' && candidate.itemType !== 'shape') return false;
  if (typeof candidate.label !== 'string' || candidate.label.trim().length === 0) return false;

  return candidate.itemType !== 'shape'
    || candidate.shapeType === 'rectangle'
    || candidate.shapeType === 'circle'
    || candidate.shapeType === 'triangle'
    || candidate.shapeType === 'ellipse'
    || candidate.shapeType === 'star'
    || candidate.shapeType === 'polygon'
    || candidate.shapeType === 'heart'
    || candidate.shapeType === 'path';
}

export function getDefaultGeneratedLayerDurationInFrames(fps: number): number {
  return Math.max(1, Math.round(fps * DEFAULT_GENERATED_LAYER_DURATION_SECONDS));
}

export function createDefaultTextItem(params: VisualLayerPlacement): TextItem {
  const { trackId, from, durationInFrames, canvasWidth, canvasHeight } = params;

  return {
    id: crypto.randomUUID(),
    type: 'text',
    trackId,
    from,
    durationInFrames,
    label: 'Text',
    text: 'Your Text Here',
    fontSize: 60,
    fontFamily: 'Inter',
    fontWeight: 'normal',
    fontStyle: 'normal',
    underline: false,
    color: '#ffffff',
    textAlign: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    transform: {
      x: 0,
      y: 0,
      width: canvasWidth * 0.8,
      height: canvasHeight * 0.3,
      rotation: 0,
      opacity: 1,
    },
  };
}

export function createDefaultShapeItem(params: VisualLayerPlacement & { shapeType: ShapeType }): ShapeItem {
  const { trackId, from, durationInFrames, canvasWidth, canvasHeight, shapeType } = params;
  const shapeSize = Math.min(canvasWidth, canvasHeight) * 0.25;

  return {
    id: crypto.randomUUID(),
    type: 'shape',
    trackId,
    from,
    durationInFrames,
    label: shapeType.charAt(0).toUpperCase() + shapeType.slice(1),
    shapeType,
    fillColor: '#3b82f6',
    strokeColor: undefined,
    strokeWidth: 0,
    cornerRadius: shapeType === 'rectangle' ? 0 : undefined,
    direction: shapeType === 'triangle' ? 'up' : undefined,
    points: shapeType === 'star' ? 5 : shapeType === 'polygon' ? 6 : undefined,
    innerRadius: shapeType === 'star' ? 0.5 : undefined,
    transform: {
      x: 0,
      y: 0,
      width: shapeSize,
      height: shapeSize,
      rotation: 0,
      opacity: 1,
      aspectRatioLocked: true,
    },
  };
}

export function createDefaultAdjustmentItem(params: LayerPlacement & {
  effects?: VisualEffect[];
  label?: string;
}): AdjustmentItem {
  const { trackId, from, durationInFrames, effects, label } = params;

  return {
    id: crypto.randomUUID(),
    type: 'adjustment',
    trackId,
    from,
    durationInFrames,
    label: label ?? 'Adjustment Layer',
    effects: effects?.map((effect) => ({
      id: crypto.randomUUID(),
      effect,
      enabled: true,
    })) ?? [],
    effectOpacity: 1,
  };
}

export function createTimelineTemplateItem(params: {
  template: TimelineTemplateDragData;
  placement: VisualLayerPlacement;
}): TextItem | ShapeItem {
  const { template, placement } = params;

  if (template.itemType === 'text') {
    return createDefaultTextItem(placement);
  }

  return createDefaultShapeItem({
    ...placement,
    shapeType: template.shapeType ?? 'rectangle',
  });
}
