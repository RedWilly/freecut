import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Info,
  ListPlus,
  Loader2,
  Pause,
  Play,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { SliderInput } from '@/shared/ui/property-controls';
import {
  importMediaLibraryService,
  useMediaLibraryStore,
} from '@/features/editor/deps/media-library';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import {
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
} from '@/features/editor/deps/timeline-utils';
import { usePlaybackStore } from '@/shared/state/playback';
import { useSelectionStore } from '@/shared/state/selection';
import type { AudioItem } from '@/types/timeline';
import type { MediaMetadata } from '@/types/storage';
import {
  KITTEN_TTS_MODEL_OPTIONS,
  KITTEN_TTS_VOICE_OPTIONS,
  kittenTtsService,
  type KittenTtsVoice,
} from '../services/kitten-tts-service';

const DEFAULT_PROMPT = 'Welcome to free cut. This voice was generated locally in the browser with WebGPU.';

interface Generation {
  id: string;
  file: File;
  objectUrl: string;
  byteSize: number;
  duration: number;
  textSnippet: string;
  voice: KittenTtsVoice;
  model: string;
  /** null = unsaved, string = saved media ID */
  savedMediaId: string | null;
  saving: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const MiniAudioPlayer = memo(function MiniAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const isSeekingRef = useRef(false);
  isSeekingRef.current = isSeeking;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => {
      if (!isSeekingRef.current) setCurrentTime(el.currentTime);
    };
    const onLoaded = () => setDuration(el.duration);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('ended', onEnded);

    return () => {
      el.pause();
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('ended', onEnded);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
    } else {
      el.pause();
    }
  }, []);

  const handleSeek = useCallback((values: number[]) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const time = ((values[0] ?? 0) / 100) * duration;
    el.currentTime = time;
    setCurrentTime(time);
  }, [duration]);

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/30 px-1.5 py-1">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm glow-primary-sm transition-colors hover:bg-primary/90"
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying
          ? <Pause className="h-3 w-3" />
          : <Play className="h-3 w-3 ml-px" />}
      </button>
      <Slider
        value={[progressPercent]}
        onValueChange={(values) => {
          setIsSeeking(true);
          handleSeek(values);
        }}
        onValueCommit={() => setIsSeeking(false)}
        max={100}
        step={0.1}
        className="min-w-0 flex-1"
        aria-label="Seek"
      />
      <span className="shrink-0 select-none font-mono text-[10px] tabular-nums text-muted-foreground">
        {formatTime(currentTime)}
        <span className="text-muted-foreground/40"> / </span>
        {formatTime(duration)}
      </span>
    </div>
  );
});

function insertAudioItemAtPlayhead(media: MediaMetadata, blobUrl: string): boolean {
  const { tracks, items, fps, addItem } = useTimelineStore.getState();
  const { activeTrackId, selectItems } = useSelectionStore.getState();

  const targetTrack = findCompatibleTrackForItemType({
    tracks,
    items,
    itemType: 'audio',
    preferredTrackId: activeTrackId,
  });

  if (!targetTrack) return false;

  const sourceFps = media.fps || fps;
  const durationInFrames = Math.max(1, Math.round(media.duration * fps));
  const sourceDurationFrames = Math.round(media.duration * sourceFps);

  const proposedPosition = usePlaybackStore.getState().currentFrame;
  const finalPosition =
    findNearestAvailableSpace(proposedPosition, durationInFrames, targetTrack.id, items) ??
    proposedPosition;

  const audioItem: AudioItem = {
    id: crypto.randomUUID(),
    type: 'audio',
    trackId: targetTrack.id,
    from: finalPosition,
    durationInFrames,
    label: media.fileName,
    mediaId: media.id,
    originId: crypto.randomUUID(),
    src: blobUrl,
    sourceStart: 0,
    sourceEnd: sourceDurationFrames,
    sourceDuration: sourceDurationFrames,
    sourceFps,
    trimStart: 0,
    trimEnd: 0,
  };

  addItem(audioItem);

  // addItem may silently drop the item if placement fails — verify it landed
  const added = useTimelineStore.getState().items.some((i) => i.id === audioItem.id);
  if (added) {
    selectItems([audioItem.id]);
  }
  return added;
}

export const AiPanel = memo(function AiPanel() {
  const currentProjectId = useMediaLibraryStore((state) => state.currentProjectId);
  const loadMediaItems = useMediaLibraryStore((state) => state.loadMediaItems);
  const selectMedia = useMediaLibraryStore((state) => state.selectMedia);
  const showNotification = useMediaLibraryStore((state) => state.showNotification);

  const [text, setText] = useState(DEFAULT_PROMPT);
  const [voice, setVoice] = useState<KittenTtsVoice>('Bella');
  const [model, setModel] = useState<'nano' | 'micro' | 'mini'>('mini');
  const [speed, setSpeed] = useState(1.25);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);

  const generationUrlsRef = useRef<Set<string>>(new Set());

  // Revoke all blob URLs on unmount
  useEffect(() => {
    const urls = generationUrlsRef.current;
    return () => {
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  const isWebGpuSupported = kittenTtsService.isSupported();
  const trimmedText = text.trim();
  const recommendedLength = trimmedText.length <= 500;

  const totalBytes = useMemo(
    () => generations.reduce((sum, g) => sum + g.byteSize, 0),
    [generations]
  );

  const anySaving = generations.some((g) => g.saving);

  // --- actions ---

  const handleGenerate = useCallback(async () => {
    if (!currentProjectId) {
      setError('Open a project before generating audio.');
      return;
    }
    if (!trimmedText) {
      setError('Enter some text to synthesize.');
      return;
    }
    if (!isWebGpuSupported) {
      setError('WebGPU is required for Kitten TTS. Try Chrome 113+, Edge 113+, or Safari 26+.');
      return;
    }

    setError(null);
    setIsGenerating(true);
    setProgress('Preparing local TTS...');

    try {
      const { blob, file, duration } = await kittenTtsService.generateSpeechFile({
        text: trimmedText,
        voice,
        speed,
        model,
        onProgress: setProgress,
      });

      const objectUrl = URL.createObjectURL(blob);
      generationUrlsRef.current.add(objectUrl);

      const gen: Generation = {
        id: crypto.randomUUID(),
        file,
        objectUrl,
        byteSize: blob.size,
        duration,
        textSnippet: trimmedText,
        voice,
        model,
        savedMediaId: null,
        saving: false,
      };

      setGenerations((prev) => [gen, ...prev]);
      setProgress(null);
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : 'Failed to generate speech.'
      );
      setProgress(null);
    } finally {
      setIsGenerating(false);
    }
  }, [currentProjectId, trimmedText, isWebGpuSupported, voice, speed, model]);

  const updateGeneration = useCallback((id: string, patch: Partial<Generation>) => {
    setGenerations((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }, []);

  const saveGeneration = useCallback(async (gen: Generation): Promise<MediaMetadata | null> => {
    if (!currentProjectId) return null;
    updateGeneration(gen.id, { saving: true });

    try {
      const { mediaLibraryService } = await importMediaLibraryService();
      const media = await mediaLibraryService.importGeneratedAudio(gen.file, currentProjectId, {
        tags: [
          'ai-generated',
          'kitten-tts',
          `kitten-model:${gen.model}`,
          `kitten-voice:${gen.voice.toLowerCase()}`,
        ],
      });

      await loadMediaItems();
      selectMedia([media.id]);
      // Remove from tracked URLs so unmount cleanup won't revoke a URL
      // that may be referenced by a timeline item's src
      generationUrlsRef.current.delete(gen.objectUrl);
      updateGeneration(gen.id, { saving: false, savedMediaId: media.id });
      return media;
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to save audio to the media library.'
      );
      updateGeneration(gen.id, { saving: false });
      return null;
    }
  }, [currentProjectId, loadMediaItems, selectMedia, updateGeneration]);

  const handleSave = useCallback(async (gen: Generation) => {
    const media = await saveGeneration(gen);
    if (media) {
      showNotification({
        type: 'success',
        message: `Saved "${media.fileName}" to the media library.`,
      });
    }
  }, [saveGeneration, showNotification]);

  const handleSaveAndInsert = useCallback(async (gen: Generation) => {
    const media = await saveGeneration(gen);
    if (!media) return;

    const inserted = insertAudioItemAtPlayhead(media, gen.objectUrl);
    showNotification({
      type: inserted ? 'success' : 'warning',
      message: inserted
        ? `Saved "${media.fileName}" and added to timeline.`
        : `Saved "${media.fileName}" but no audio track is available.`,
    });
  }, [saveGeneration, showNotification]);

  const handleRemoveGeneration = useCallback((id: string) => {
    setGenerations((prev) => {
      const gen = prev.find((g) => g.id === id);
      if (gen) {
        // Only revoke the blob URL if it hasn't been saved — saved items may
        // have their blob URL referenced by a timeline audio item's `src`.
        if (!gen.savedMediaId) {
          URL.revokeObjectURL(gen.objectUrl);
          generationUrlsRef.current.delete(gen.objectUrl);
        }
      }
      return prev.filter((g) => g.id !== id);
    });
  }, []);

  const handleClearAll = useCallback(() => {
    // Only revoke blob URLs for unsaved generations — saved ones may be
    // referenced by timeline items.
    setGenerations((prev) => {
      for (const gen of prev) {
        if (!gen.savedMediaId) {
          URL.revokeObjectURL(gen.objectUrl);
          generationUrlsRef.current.delete(gen.objectUrl);
        }
      }
      return [];
    });
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">Text to Speech</h2>
          <Popover open={infoOpen} onOpenChange={setInfoOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Info"
                onMouseEnter={() => setInfoOpen(true)}
                onMouseLeave={() => setInfoOpen(false)}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="start"
              className="w-64 space-y-2 p-3 text-xs"
              onMouseEnter={() => setInfoOpen(true)}
              onMouseLeave={() => setInfoOpen(false)}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  WebGPU
                </span>
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Local
                </span>
              </div>
              <p className="leading-relaxed text-muted-foreground">
                Runs entirely in the browser using Kitten TTS on WebGPU. No data is sent to a server.
              </p>
              <table className="w-full text-[11px]">
                <tbody>
                  {KITTEN_TTS_MODEL_OPTIONS.map((opt) => (
                    <tr key={opt.value} className="border-t border-border/50">
                      <td className="py-1 pr-2 font-medium text-foreground">{opt.label}</td>
                      <td className="py-1 pr-2 text-muted-foreground">{opt.qualityLabel}</td>
                      <td className="py-1 text-right text-muted-foreground">{opt.downloadLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="leading-relaxed text-muted-foreground">
                Models are cached after the first download.
              </p>
            </PopoverContent>
          </Popover>
        </div>

        {!isWebGpuSupported && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
            WebGPU is not available in this browser. Kitten TTS needs Chrome 113+, Edge 113+, or Safari 26+.
          </div>
        )}

        {/* Text input */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="ai-tts-text">Text</Label>
            <span className={`text-[11px] ${recommendedLength ? 'text-muted-foreground' : 'text-amber-400'}`}>
              {trimmedText.length}/500 recommended
            </span>
          </div>
          <Textarea
            id="ai-tts-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Enter the text you want to hear spoken..."
            className="min-h-24 resize-y bg-secondary/30 text-sm"
            disabled={isGenerating}
          />
        </div>

        {/* Model + Voice */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Model</Label>
            <Select value={model} onValueChange={(value) => setModel(value as typeof model)} disabled={isGenerating}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KITTEN_TTS_MODEL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-xs">
                    {option.label} ({option.downloadLabel})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Voice</Label>
            <Select value={voice} onValueChange={(value) => setVoice(value as KittenTtsVoice)} disabled={isGenerating}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KITTEN_TTS_VOICE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-xs">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Speed + Generate */}
        <div className="flex items-center gap-2">
          <SliderInput
            label="Speed"
            value={speed}
            onChange={setSpeed}
            min={0.5}
            max={2}
            step={0.05}
            unit="x"
            disabled={isGenerating}
          />
          <Button
            size="sm"
            onClick={() => { void handleGenerate(); }}
            disabled={isGenerating || !trimmedText || !currentProjectId || !isWebGpuSupported}
            className="h-7 shrink-0 gap-1.5"
          >
            {isGenerating
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <WandSparkles className="h-3.5 w-3.5" />}
            {isGenerating ? 'Generating...' : 'Generate'}
          </Button>
        </div>

        {/* Progress */}
        {progress && (
          <div className="rounded-lg border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
            {progress}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Generation history */}
        {generations.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                History ({generations.length}) — {formatBytes(totalBytes)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
                onClick={handleClearAll}
                disabled={anySaving}
              >
                <Trash2 className="h-3 w-3" />
                Clear all
              </Button>
            </div>

            <div className="space-y-2">
              {generations.map((gen) => (
                <GenerationRow
                  key={gen.id}
                  generation={gen}
                  onSave={handleSave}
                  onSaveAndInsert={handleSaveAndInsert}
                  onRemove={handleRemoveGeneration}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

// --- Row component ---

const GenerationRow = memo(function GenerationRow({
  generation: gen,
  onSave,
  onSaveAndInsert,
  onRemove,
}: {
  generation: Generation;
  onSave: (gen: Generation) => Promise<void>;
  onSaveAndInsert: (gen: Generation) => Promise<void>;
  onRemove: (id: string) => void;
}) {
  const saved = gen.savedMediaId !== null;

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${
      saved
        ? 'border-emerald-500/25 bg-emerald-500/5'
        : 'border-border bg-secondary/20'
    }`}>
      {/* Meta row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="line-clamp-3 text-xs leading-relaxed" title={gen.textSnippet}>
            {gen.textSnippet}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {gen.voice} · {gen.model} · {gen.duration > 0 ? `${gen.duration.toFixed(1)}s` : '—'} · {formatBytes(gen.byteSize)}
          </p>
        </div>
        {!gen.saving && (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => onRemove(gen.id)}
            aria-label="Remove"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Audio player */}
      <MiniAudioPlayer src={gen.objectUrl} />

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1.5">
        {saved ? (
          <span className="flex items-center gap-1 text-[11px] text-emerald-400">
            <CheckCircle2 className="h-3 w-3" />
            Saved
          </span>
        ) : (
          <>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => { void onSaveAndInsert(gen); }}
              disabled={gen.saving}
            >
              {gen.saving
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <ListPlus className="h-3 w-3" />}
              {gen.saving ? 'Saving...' : 'Save & Insert'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => { void onSave(gen); }}
              disabled={gen.saving}
            >
              <Download className="h-3 w-3" />
              Save to Library
            </Button>
          </>
        )}
      </div>
    </div>
  );
});
