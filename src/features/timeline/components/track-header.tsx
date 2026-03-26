import { memo } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Eye, EyeOff, Lock, GripVertical, Volume2, VolumeX, Radio, FoldHorizontal } from 'lucide-react';
import type { TimelineTrack } from '@/types/timeline';
import { useTrackDrag } from '../hooks/use-track-drag';
import { TIMELINE_SIDEBAR_WIDTH } from '../constants';

interface TrackHeaderProps {
  track: TimelineTrack;
  itemCount: number;
  isActive: boolean;
  isSelected: boolean;
  canDeleteTrack: boolean;
  canDeleteEmptyTracks: boolean;
  onToggleLock: () => void;
  onToggleVisibility: () => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onSetVolume: (volume: number) => void;
  onSelect: (e: React.MouseEvent) => void;
  onCloseGaps?: () => void;
  onAddVideoTrack: () => void;
  onAddAudioTrack: () => void;
  onRepairLegacyAvTracks: () => void;
  onDeleteTrack: () => void;
  onDeleteEmptyTracks: () => void;
}

/**
 * Custom equality for TrackHeader memo - ignores callback props which are recreated each render
 */
function areTrackHeaderPropsEqual(prev: TrackHeaderProps, next: TrackHeaderProps): boolean {
  return (
    prev.track === next.track &&
    prev.itemCount === next.itemCount &&
    prev.isActive === next.isActive &&
    prev.isSelected === next.isSelected &&
    prev.canDeleteTrack === next.canDeleteTrack &&
    prev.canDeleteEmptyTracks === next.canDeleteEmptyTracks
  );
  // Callbacks (onToggleLock, etc.) are ignored - they're recreated each render but functionality is same
}

/**
 * Track Header Component
 *
 * Displays track name, controls, and handles selection.
 * Shows active state with background color.
 * Supports group tracks with collapse/expand and indentation.
 * Right-click context menu for track actions.
 * Memoized to prevent re-renders when props haven't changed.
 */
export const TrackHeader = memo(function TrackHeader({
  track,
  itemCount,
  isActive,
  isSelected,
  canDeleteTrack,
  canDeleteEmptyTracks,
  onToggleLock,
  onToggleVisibility,
  onToggleMute,
  onToggleSolo,
  onSetVolume,
  onSelect,
  onCloseGaps,
  onAddVideoTrack,
  onAddAudioTrack,
  onRepairLegacyAvTracks,
  onDeleteTrack,
  onDeleteEmptyTracks,
}: TrackHeaderProps) {
  // Use track drag hook (visuals handled centrally by timeline.tsx via DOM)
  const { handleDragStart } = useTrackDrag(track);
  const trackVolume = track.volume ?? 0;
  const formattedTrackVolume = `${trackVolume > 0 ? '+' : ''}${trackVolume.toFixed(1)} dB`;
  const itemCountLabel = `${itemCount} ${itemCount === 1 ? 'Clip' : 'Clips'}`;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`
            flex flex-col overflow-hidden px-1
            cursor-grab active:cursor-grabbing relative
            ${isSelected ? 'bg-primary/10' : 'hover:bg-secondary/50'}
            ${isActive ? 'border-l-3 border-l-primary' : 'border-l-3 border-l-transparent'}
            transition-all duration-150
          `}
          style={{
            height: `${track.height}px`,
            // content-visibility optimization for long track lists (rendering-content-visibility)
            contentVisibility: 'auto',
            containIntrinsicSize: `${TIMELINE_SIDEBAR_WIDTH}px ${track.height}px`,
          }}
          onClick={onSelect}
          onMouseDown={handleDragStart}
          data-track-id={track.id}
        >
          <div className="flex h-6 shrink-0 items-center gap-0.5 overflow-hidden border-b border-border/60">
            <div className="flex h-5 w-4 shrink-0 items-center justify-center">
              <GripVertical className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
            </div>
            {/* Visibility Button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 rounded hover:bg-secondary"
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisibility();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={track.visible ? 'Hide track' : 'Show track'}
              data-tooltip={track.visible ? 'Hide track' : 'Show track'}
            >
              {track.visible ? (
                <Eye className="w-3 h-3" />
              ) : (
                <EyeOff className="w-3 h-3 opacity-50" />
              )}
            </Button>

            {/* Audio Mute Button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 rounded hover:bg-secondary"
              onClick={(e) => {
                e.stopPropagation();
                onToggleMute();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={track.muted ? 'Unmute track' : 'Mute track'}
              data-tooltip={track.muted ? 'Unmute track' : 'Mute track'}
            >
              {track.muted ? (
                <VolumeX className="w-3 h-3 opacity-50" />
              ) : (
                <Volume2 className="w-3 h-3" />
              )}
            </Button>

            {/* Solo Button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 rounded hover:bg-secondary"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSolo();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={track.solo ? 'Unsolo track' : 'Solo track'}
              data-tooltip={track.solo ? 'Unsolo track' : 'Solo track'}
            >
              <Radio
                className={`w-3 h-3 ${track.solo ? 'text-primary' : ''}`}
              />
            </Button>

            {/* Lock Button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 rounded hover:bg-secondary"
              onClick={(e) => {
                e.stopPropagation();
                onToggleLock();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={track.locked ? 'Unlock track' : 'Lock track'}
              data-tooltip={track.locked ? 'Unlock track' : 'Lock track'}
            >
              <Lock
                className={`w-3 h-3 ${track.locked ? 'opacity-50' : ''}`}
              />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 rounded hover:bg-secondary"
              onClick={(e) => {
                e.stopPropagation();
                onCloseGaps?.();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Close all gaps"
              data-tooltip="Close all gaps"
            >
              <FoldHorizontal className="w-3 h-3" />
            </Button>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-5 px-1.5 rounded-sm text-[10px] font-mono text-muted-foreground hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  aria-label={`Track gain ${formattedTrackVolume}`}
                >
                  {formattedTrackVolume}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-52 p-3"
                align="start"
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium">Track gain</span>
                    <span className="text-[11px] font-mono text-muted-foreground">{formattedTrackVolume}</span>
                  </div>
                  <Slider
                    value={[trackVolume]}
                    min={-60}
                    max={12}
                    step={0.1}
                    onValueChange={(values) => onSetVolume(values[0] ?? 0)}
                    aria-label="Track gain"
                  />
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>-60 dB</span>
                    <button
                      type="button"
                      className="hover:text-foreground transition-colors"
                      onClick={() => onSetVolume(0)}
                    >
                      Reset
                    </button>
                    <span>+12 dB</span>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex min-h-0 flex-1 flex-col items-start justify-start px-1.5 py-1">
            <span className="max-w-full truncate text-xs font-semibold leading-none font-mono">
              {track.name}
            </span>
            <span className="mt-1 text-[10px] leading-none text-muted-foreground">
              {itemCountLabel}
            </span>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={onCloseGaps}>
          Close All Gaps
        </ContextMenuItem>

        <ContextMenuSeparator />
        <ContextMenuItem onClick={onAddVideoTrack}>
          Add Video Track
        </ContextMenuItem>
        <ContextMenuItem onClick={onAddAudioTrack}>
          Add Audio Track
        </ContextMenuItem>
        <ContextMenuItem onClick={onRepairLegacyAvTracks}>
          Repair Legacy A/V Tracks
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!canDeleteTrack} onClick={onDeleteTrack}>
          Delete Track
        </ContextMenuItem>
        <ContextMenuItem disabled={!canDeleteEmptyTracks} onClick={onDeleteEmptyTracks}>
          Delete Empty Tracks
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}, areTrackHeaderPropsEqual);
