import { memo } from 'react';

const TRACK_PUSH_COLORS = {
  edge: 'rgba(56, 189, 248, 0.9)',
  glow: '0 0 8px rgba(56, 189, 248, 0.5)',
  fade: 'rgba(56, 189, 248, 0.3)',
};

interface TrackPushHandleProps {
  enabled: boolean;
  isActive: boolean;
  /** Pixel position of the clip's left edge */
  clipLeftPx: number;
  /** Width of the trigger zone in pixels (computed by parent based on zoom + gap) */
  zonePx: number;
  onMouseDown: (e: React.MouseEvent) => void;
}

/**
 * Small trigger zone that sits in the gap immediately to the LEFT of a clip.
 * Rendered as a sibling of the clip container (outside `contain: paint`) so
 * it is not clipped.
 *
 * On hover it reveals a cyan edge halo; dragging it pushes ALL items at or
 * after this clip's time position (across every track) left or right.
 *
 * Hover visuals are CSS-only (group-hover) to avoid re-renders.
 */
export const TrackPushHandle = memo(function TrackPushHandle({
  enabled,
  isActive,
  clipLeftPx,
  zonePx,
  onMouseDown,
}: TrackPushHandleProps) {
  if (!enabled && !isActive) return null;

  return (
    <div
      className="absolute inset-y-px cursor-track-push group/trackpush"
      data-track-push
      style={{
        left: `${clipLeftPx - zonePx}px`,
        width: `${zonePx}px`,
        zIndex: 1,
      }}
      onMouseDown={onMouseDown}
    >
      {/* Visuals: CSS-only hover — no state re-renders */}
      <div
        className={isActive ? 'opacity-100' : 'opacity-0 group-hover/trackpush:opacity-100'}
        style={{ transition: 'opacity 75ms', position: 'absolute', inset: 0 }}
      >
        {/* Solid edge line (right side = clip boundary) */}
        <div
          className="absolute inset-y-0 right-0"
          style={{ width: '2px', background: TRACK_PUSH_COLORS.edge, boxShadow: TRACK_PUSH_COLORS.glow }}
        />
        {/* Fade halo into gap */}
        <div
          className="absolute inset-y-0"
          style={{ right: '2px', width: `${Math.max(0, zonePx - 2)}px`, background: `linear-gradient(to left, ${TRACK_PUSH_COLORS.fade}, transparent)` }}
        />
      </div>
    </div>
  );
});
