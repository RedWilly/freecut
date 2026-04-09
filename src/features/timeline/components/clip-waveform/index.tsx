import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TiledCanvas } from '../clip-filmstrip/tiled-canvas';
import { WaveformSkeleton } from './waveform-skeleton';
import { useWaveform } from '../../hooks/use-waveform';
import { mediaLibraryService } from '@/features/timeline/deps/media-library-service';
import { resolveMediaUrl } from '@/features/timeline/deps/media-library-resolver';
import { useMediaBlobUrl } from '../../hooks/use-media-blob-url';
import { needsCustomAudioDecoder } from '@/features/timeline/deps/composition-runtime';
import { WAVEFORM_FILL_COLOR, WAVEFORM_STROKE_COLOR } from '../../constants';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('ClipWaveform');

// Continuous filled-path waveform styling (NLE-style)
const WAVEFORM_VERTICAL_PADDING_PX = 3;
const ZOOM_SETTLE_MS = 80;
const RENDER_PPS_QUANTUM = 5;

function quantizeRenderPps(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.round(value / RENDER_PPS_QUANTUM) * RENDER_PPS_QUANTUM);
}

interface ClipWaveformProps {
  /** Media ID from the timeline item */
  mediaId: string;
  /** Width of the clip in pixels */
  clipWidth: number;
  /** Source start time in seconds (for trimmed clips) */
  sourceStart: number;
  /** Total source duration in seconds */
  sourceDuration: number;
  /** Trim start in seconds (how much trimmed from beginning) */
  trimStart: number;
  /** Playback speed multiplier */
  speed: number;
  /** Frames per second */
  fps: number;
  /** Whether the clip is visible (from IntersectionObserver) */
  isVisible: boolean;
  /** Pixels per second from parent (avoids redundant zoom subscription) */
  pixelsPerSecond: number;
}

/**
 * Clip Waveform Component
 *
 * Renders audio waveform as a symmetrical mirrored visualization for timeline clips.
 * Uses tiled canvas for large clips and shows skeleton while loading.
 */
export const ClipWaveform = memo(function ClipWaveform({
  mediaId,
  clipWidth,
  sourceStart,
  sourceDuration,
  trimStart,
  speed,
  fps,
  isVisible,
  pixelsPerSecond,
}: ClipWaveformProps) {
  void fps;
  const containerRef = useRef<HTMLDivElement>(null);
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
  pixelsPerSecondRef.current = pixelsPerSecond;
  const [height, setHeight] = useState(0);
  const [isZooming, setIsZooming] = useState(false);
  const zoomSettleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPpsRef = useRef(pixelsPerSecond);
  const { blobUrl, setBlobUrl, hasStartedLoadingRef, blobUrlVersion } = useMediaBlobUrl(mediaId);

  // Measure container height
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const parent = container.parentElement;
      if (parent) {
        setHeight(parent.clientHeight);
      }
    };

    measure();

    const resizeObserver = new ResizeObserver(measure);
    if (container.parentElement) {
      resizeObserver.observe(container.parentElement);
    }

    return () => resizeObserver.disconnect();
  }, []);

  // Track if audio codec is supported for waveform generation
  const [audioCodecSupported, setAudioCodecSupported] = useState(true);

  // Load blob URL for the media when visible, including post-invalidation retries.
  useEffect(() => {
    // Skip if already started loading (prevents re-triggering on visibility changes)
    if (hasStartedLoadingRef.current) {
      return;
    }

    // Only start loading when visible
    if (!isVisible || !mediaId) {
      return;
    }

    hasStartedLoadingRef.current = true;
    let mounted = true;

    const loadBlobUrl = async () => {
      try {
        // First check if audio codec is supported
        const media = await mediaLibraryService.getMedia(mediaId);
        if (!mounted) return;

        // AC-3/E-AC-3 can still generate waveform via mediabunny even if old metadata
        // marked codec unsupported before custom decode was added.
        const codecSupported = media
          ? (media.audioCodecSupported !== false || needsCustomAudioDecoder(media.audioCodec))
          : true;
        setAudioCodecSupported(codecSupported);

        if (!codecSupported) {
          // Skip waveform generation for unsupported codecs
          return;
        }

        const url = await resolveMediaUrl(mediaId);
        if (mounted && url) {
          setBlobUrl(url);
        }
      } catch (error) {
        logger.error('Failed to load media blob URL:', error);
      }
    };

    loadBlobUrl();

    return () => {
      mounted = false;
    };
  }, [mediaId, isVisible, blobUrlVersion]);

  // Use waveform hook - enabled once we have blobUrl (independent of visibility after that)
  const { peaks, duration, sampleRate, isLoading, progress, error } = useWaveform({
    mediaId,
    blobUrl,
    isVisible: true, // Always consider visible once we start - prevents re-triggers
    enabled: !!blobUrl,
  });

  // Normalize visual scale per clip so low-amplitude sources are still readable.
  const normalizationPeak = useMemo(() => {
    if (!peaks || peaks.length === 0) return 1;
    let maxPeak = 0;
    for (let i = 0; i < peaks.length; i++) {
      const value = peaks[i] ?? 0;
      if (value > maxPeak) {
        maxPeak = value;
      }
    }
    return maxPeak > 0 ? maxPeak : 1;
  }, [peaks]);

  // During active zoom, redraw only when the quantized zoom bucket changes.
  // Once zoom settles, force one exact redraw at the final pixels-per-second.
  useEffect(() => {
    if (lastPpsRef.current === pixelsPerSecond) return;
    lastPpsRef.current = pixelsPerSecond;

    setIsZooming(true);
    if (zoomSettleTimeoutRef.current) {
      clearTimeout(zoomSettleTimeoutRef.current);
    }

    zoomSettleTimeoutRef.current = setTimeout(() => {
      setIsZooming(false);
      zoomSettleTimeoutRef.current = null;
    }, ZOOM_SETTLE_MS);
  }, [pixelsPerSecond]);

  useEffect(() => {
    return () => {
      if (zoomSettleTimeoutRef.current) {
        clearTimeout(zoomSettleTimeoutRef.current);
      }
    };
  }, []);

  // Render function for tiled canvas. Keep the callback stable through zoom
  // changes and use versioning to decide when to redraw.
  const renderTile = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      _tileIndex: number,
      tileOffset: number,
      tileWidth: number
    ) => {
      if (!peaks || peaks.length === 0 || duration === 0) {
        return;
      }

      const effectiveStart = sourceStart + trimStart;
      const currentPps = Math.max(1, pixelsPerSecondRef.current);
      const centerY = height / 2;
      const maxWaveHeight = Math.max(1, (height / 2) - WAVEFORM_VERTICAL_PADDING_PX);
      const amplitudes = new Array<number>(tileWidth + 1).fill(0);

      ctx.beginPath();
      ctx.moveTo(0, centerY);

      for (let x = 0; x <= tileWidth; x++) {
        const timelinePosition = (tileOffset + x) / currentPps;
        const sourceTime = effectiveStart + (timelinePosition * speed);

        if (sourceTime < 0 || sourceTime > sourceDuration || sampleRate <= 0) {
          continue;
        }

        const peakIndex = Math.floor(sourceTime * sampleRate);
        if (peakIndex < 0 || peakIndex >= peaks.length) {
          continue;
        }

        // Window sampling to avoid aliasing
        const pointWindowSeconds = Math.max(
          1 / sampleRate,
          (1 / currentPps) * speed * 0.5
        );
        const samplesPerPoint = Math.max(1, Math.ceil(pointWindowSeconds * sampleRate));
        const halfWindow = Math.floor(samplesPerPoint / 2);
        const windowStart = Math.max(0, peakIndex - halfWindow);
        const windowEnd = Math.min(peaks.length, peakIndex + halfWindow + 1);

        let max1 = 0;
        let max2 = 0;
        let windowSum = 0;
        let sampleCount = 0;
        for (let i = windowStart; i < windowEnd; i++) {
          const value = peaks[i] ?? 0;
          if (value >= max1) {
            max2 = max1;
            max1 = value;
          } else if (value > max2) {
            max2 = value;
          }
          windowSum += value;
          sampleCount++;
        }

        if (sampleCount === 0) {
          continue;
        }

        const normalizedMax1 = Math.min(1, max1 / normalizationPeak);
        const normalizedMax2 = Math.min(1, max2 / normalizationPeak);
        const normalizedMean = Math.min(1, (windowSum / sampleCount) / normalizationPeak);
        const needle = Math.max(0, normalizedMax1 - normalizedMax2);
        const peakValue = Math.min(
          1,
          normalizedMean * 0.38 + normalizedMax2 * 0.34 + needle * 2.35
        );
        const amp = peakValue <= 0.001 ? 0 : Math.pow(peakValue, 1.05);
        amplitudes[x] = amp * maxWaveHeight;
      }

      for (let x = 0; x <= tileWidth; x++) {
        ctx.lineTo(x, centerY - amplitudes[x]!);
      }
      for (let x = tileWidth; x >= 0; x--) {
        ctx.lineTo(x, centerY + amplitudes[x]!);
      }
      ctx.closePath();

      ctx.fillStyle = WAVEFORM_FILL_COLOR;
      ctx.fill();

      // Thin stroke along the top contour for definition
      ctx.strokeStyle = WAVEFORM_STROKE_COLOR;
      ctx.lineWidth = 0.75;
      ctx.stroke();
    },
    [peaks, duration, sampleRate, sourceStart, trimStart, speed, sourceDuration, height, normalizationPeak]
  );

  // Show empty state for unsupported/failed waveforms (no infinite skeleton).
  if (!audioCodecSupported || !!error) {
    return (
      <div ref={containerRef} className="absolute inset-0 flex items-center">
        {/* Flat line to indicate no waveform available */}
        <div
          className="w-full h-[1px] bg-foreground/20"
          style={{ marginTop: 0 }}
        />
      </div>
    );
  }

  // Show skeleton only while actively loading.
  if (!peaks || peaks.length === 0 || height === 0) {
    if (!isLoading && height > 0) {
      return (
        <div ref={containerRef} className="absolute inset-0 flex items-center">
          <div className="w-full h-[1px] bg-foreground/20" style={{ marginTop: 0 }} />
        </div>
      );
    }
    return (
      <div ref={containerRef} className="absolute inset-0">
        <WaveformSkeleton clipWidth={clipWidth} height={height || 24} />
      </div>
    );
  }

  const progressBucket = Math.floor(progress);
  const isActiveZoomRender = isZooming || lastPpsRef.current !== pixelsPerSecond;
  const renderPpsKey = isActiveZoomRender
    ? `q${quantizeRenderPps(pixelsPerSecond)}`
    : `e${Math.round(Math.max(1, pixelsPerSecond) * 1000)}`;
  const renderVersion = `${progressBucket}:${peaks.length}:${height}:${renderPpsKey}`;

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* Show shimmer skeleton behind canvas while loading progressively */}
      {isLoading && (
        <WaveformSkeleton clipWidth={clipWidth} height={height} />
      )}
      <TiledCanvas
        width={clipWidth}
        height={height}
        renderTile={renderTile}
        version={renderVersion}
      />
    </div>
  );
});
