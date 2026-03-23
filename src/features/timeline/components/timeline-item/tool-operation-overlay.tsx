import { memo } from 'react';
import { cn } from '@/shared/ui/cn';
import type { OperationBoundsVisual } from './tool-operation-overlay-utils';

interface ToolOperationOverlayProps {
  visual: OperationBoundsVisual | null;
}

export const ToolOperationOverlay = memo(function ToolOperationOverlay({
  visual,
}: ToolOperationOverlayProps) {
  if (!visual) return null;

  const boxAccentClass = visual.mode === 'ripple'
    ? 'border-amber-200/85 bg-amber-300/[0.06] shadow-[0_0_0_1px_rgba(251,191,36,0.26),0_10px_24px_rgba(15,23,42,0.18)]'
    : visual.mode === 'rolling'
    ? 'border-sky-200/85 bg-sky-300/[0.05] shadow-[0_0_0_1px_rgba(125,211,252,0.24),0_10px_24px_rgba(15,23,42,0.18)]'
    : 'border-white/80 bg-white/[0.035] shadow-[0_0_0_1px_rgba(15,23,42,0.45),0_10px_24px_rgba(15,23,42,0.18)]';

  const edgeModeClass = visual.mode === 'ripple'
    ? 'bg-amber-300/20 shadow-[0_0_10px_rgba(251,191,36,0.26)]'
    : visual.mode === 'rolling'
    ? 'bg-sky-300/18 shadow-[0_0_10px_rgba(125,211,252,0.22)]'
    : 'bg-transparent shadow-none';

  return (
    <>
      {visual.boxLeftPx !== null && visual.boxWidthPx !== null && (
        <div
          className={cn(
            'absolute pointer-events-none z-30 rounded-[6px] border',
            boxAccentClass,
          )}
          style={{
            left: `${visual.boxLeftPx}px`,
            width: `${visual.boxWidthPx}px`,
            top: 4,
            bottom: 4,
          }}
        />
      )}

      {visual.edgePositionsPx.map((edgePx, index) => (
        <div
          key={`${index}-${Math.round(edgePx)}`}
          className="absolute pointer-events-none z-40 -translate-x-1/2"
          style={{
            left: `${edgePx}px`,
            top: 2,
            bottom: 2,
          }}
        >
          <div
            className={cn(
              'absolute inset-y-0 left-1/2 w-[8px] -translate-x-1/2 rounded-full',
              edgeModeClass,
            )}
          />
          <div
            className={cn(
              'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 rounded-full bg-white/95',
              visual.constrained
                ? 'shadow-[0_0_8px_rgba(254,226,226,0.92)]'
                : 'shadow-[0_0_8px_rgba(236,253,245,0.96)]',
            )}
          />
          <div
            className={cn(
              'absolute inset-y-1 left-1/2 w-[3px] -translate-x-1/2 rounded-full',
              visual.constrained
                ? 'bg-red-400/85 shadow-[0_0_14px_rgba(248,113,113,0.95),0_0_28px_rgba(239,68,68,0.58)]'
                : 'bg-emerald-300/90 shadow-[0_0_14px_rgba(74,222,128,0.98),0_0_28px_rgba(34,197,94,0.62)]',
            )}
          />
        </div>
      ))}
    </>
  );
});
