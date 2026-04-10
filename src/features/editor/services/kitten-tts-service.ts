import { createLogger } from '@/shared/logging/logger';
import { KITTEN_TTS_MODEL_CACHE_NAME as MODEL_CACHE_NAME } from '@/shared/utils/local-model-cache';
import {
  localInferenceRuntimeRegistry,
  useLocalInferenceStore,
} from '@/shared/state/local-inference';
import type { ModelSize, KittenTTSEngine } from 'kitten-tts-webgpu';

const logger = createLogger('KittenTtsService');

/**
 * Fetch a URL with persistent Cache API caching.
 * Returns a blob URL that can be passed to loadModel() so the library's
 * internal fetch() hits a blob: URL instead of re-downloading from the network.
 */
async function fetchCached(url: string, onProgress?: (stage: string) => void): Promise<string> {
  const cache = await caches.open(MODEL_CACHE_NAME);
  const cached = await cache.match(url);
  if (cached) {
    onProgress?.('Loading model from cache...');
    const blob = await cached.blob();
    return URL.createObjectURL(blob);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Download timed out for ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }

  // Clone before consuming so we can store the original in the cache
  await cache.put(url, response.clone());
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

type KittenTtsModule = typeof import('kitten-tts-webgpu');

export type KittenTtsVoice =
  | 'Bella'
  | 'Luna'
  | 'Rosie'
  | 'Kiki'
  | 'Jasper'
  | 'Bruno'
  | 'Hugo'
  | 'Leo';

export interface KittenTtsModelOption {
  value: ModelSize;
  label: string;
  downloadLabel: string;
  qualityLabel: string;
  estimatedBytes: number;
}

interface KittenModelConfig extends KittenTtsModelOption {
  modelUrl: string;
  voicesUrl: string;
}

interface GenerateSpeechOptions {
  text: string;
  voice: KittenTtsVoice;
  speed: number;
  model: ModelSize;
  onProgress?: (stage: string) => void;
}

interface KittenRuntime {
  engine: KittenTTSEngine;
  model: ModelSize;
}

const MB = 1024 * 1024;

const MODEL_CONFIGS: Record<ModelSize, KittenModelConfig> = {
  nano: {
    value: 'nano',
    label: 'Nano',
    downloadLabel: '24 MB',
    qualityLabel: 'Fastest',
    estimatedBytes: 24 * MB,
    modelUrl: 'https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/main/kitten_tts_nano_v0_8.onnx',
    voicesUrl: 'https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/main/voices.npz',
  },
  micro: {
    value: 'micro',
    label: 'Micro',
    downloadLabel: '41 MB',
    qualityLabel: 'Balanced',
    estimatedBytes: 41 * MB,
    modelUrl: 'https://huggingface.co/KittenML/kitten-tts-micro-0.8/resolve/main/kitten_tts_micro_v0_8.onnx',
    voicesUrl: 'https://huggingface.co/KittenML/kitten-tts-micro-0.8/resolve/main/voices.npz',
  },
  mini: {
    value: 'mini',
    label: 'Mini',
    downloadLabel: '78 MB',
    qualityLabel: 'Best quality',
    estimatedBytes: 78 * MB,
    modelUrl: 'https://huggingface.co/KittenML/kitten-tts-mini-0.8/resolve/main/kitten_tts_mini_v0_8.onnx',
    voicesUrl: 'https://huggingface.co/KittenML/kitten-tts-mini-0.8/resolve/main/voices.npz',
  },
};

export const KITTEN_TTS_MODEL_OPTIONS: KittenTtsModelOption[] = [
  MODEL_CONFIGS.nano,
  MODEL_CONFIGS.micro,
  MODEL_CONFIGS.mini,
];

export const KITTEN_TTS_VOICE_OPTIONS: Array<{ value: KittenTtsVoice; label: string }> = [
  { value: 'Bella', label: 'Bella' },
  { value: 'Luna', label: 'Luna' },
  { value: 'Rosie', label: 'Rosie' },
  { value: 'Kiki', label: 'Kiki' },
  { value: 'Jasper', label: 'Jasper' },
  { value: 'Bruno', label: 'Bruno' },
  { value: 'Hugo', label: 'Hugo' },
  { value: 'Leo', label: 'Leo' },
];

function makeSafeFileNameSegment(text: string): string {
  const collapsed = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return collapsed.slice(0, 32) || 'speech';
}

function createOutputFileName(text: string, voice: KittenTtsVoice, model: ModelSize): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `ai-tts-${makeSafeFileNameSegment(text)}-${voice.toLowerCase()}-${model}-${timestamp}.wav`;
}

class KittenTtsService {
  private readonly runtimeFeature = 'tts';
  private readonly runtimeFeatureLabel = 'Kitten TTS';
  private modulePromise: Promise<KittenTtsModule> | null = null;
  private runtimePromises = new Map<ModelSize, Promise<KittenRuntime>>();
  private activeJobs = new Map<ModelSize, number>();
  private generationChains = new Map<ModelSize, Promise<void>>();

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  }

  private getRuntimeId(model: ModelSize): string {
    return `kitten-tts:${model}`;
  }

  private getModule(): Promise<KittenTtsModule> {
    if (!this.modulePromise) {
      this.modulePromise = import('kitten-tts-webgpu');
    }

    return this.modulePromise;
  }

  private upsertRuntime(model: ModelSize, state: 'loading' | 'running' | 'ready' | 'error', errorMessage?: string): void {
    const runtimeId = this.getRuntimeId(model);
    const existing = useLocalInferenceStore.getState().runtimesById[runtimeId];
    const config = MODEL_CONFIGS[model];
    const now = Date.now();
    const activeJobs = this.activeJobs.get(model) ?? 0;

    if (existing) {
      localInferenceRuntimeRegistry.updateRuntime(runtimeId, {
        feature: this.runtimeFeature,
        featureLabel: this.runtimeFeatureLabel,
        modelKey: model,
        modelLabel: config.label,
        backend: 'webgpu',
        state,
        estimatedBytes: config.estimatedBytes,
        activeJobs,
        unloadable: true,
        errorMessage,
        lastUsedAt: now,
      });
      return;
    }

    localInferenceRuntimeRegistry.registerRuntime({
      id: runtimeId,
      feature: this.runtimeFeature,
      featureLabel: this.runtimeFeatureLabel,
      modelKey: model,
      modelLabel: config.label,
      backend: 'webgpu',
      state,
      estimatedBytes: config.estimatedBytes,
      activeJobs,
      loadedAt: now,
      lastUsedAt: now,
      unloadable: true,
      errorMessage,
    }, {
      unload: () => this.unloadModel(model),
    });
  }

  private incrementJobs(model: ModelSize): void {
    const nextJobs = (this.activeJobs.get(model) ?? 0) + 1;
    this.activeJobs.set(model, nextJobs);
    this.upsertRuntime(model, 'running');
  }

  private decrementJobs(model: ModelSize): void {
    const nextJobs = Math.max(0, (this.activeJobs.get(model) ?? 0) - 1);
    this.activeJobs.set(model, nextJobs);
    this.upsertRuntime(model, 'ready');
  }

  private async ensureRuntime(model: ModelSize, onProgress?: (stage: string) => void): Promise<KittenRuntime> {
    const existingPromise = this.runtimePromises.get(model);
    if (existingPromise) {
      return existingPromise;
    }

    this.upsertRuntime(model, 'loading');

    const runtimePromise = (async () => {
      const config = MODEL_CONFIGS[model];
      const { KittenTTSEngine } = await this.getModule();
      const engine = new KittenTTSEngine();

      onProgress?.('Initializing WebGPU...');
      await engine.init();

      onProgress?.(`Downloading ${config.label} model (${config.downloadLabel})...`);
      const [modelBlobUrl, voicesBlobUrl] = await Promise.all([
        fetchCached(config.modelUrl, onProgress),
        fetchCached(config.voicesUrl),
      ]);

      onProgress?.('Loading model weights...');
      await engine.loadModel(modelBlobUrl, voicesBlobUrl);

      URL.revokeObjectURL(modelBlobUrl);
      URL.revokeObjectURL(voicesBlobUrl);

      this.upsertRuntime(model, 'ready');
      return { engine, model };
    })();

    this.runtimePromises.set(model, runtimePromise);

    try {
      return await runtimePromise;
    } catch (error) {
      this.runtimePromises.delete(model);
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to initialize ${model} Kitten TTS runtime`, error);
      this.upsertRuntime(model, 'error', message);
      throw error;
    }
  }

  private async withGenerationLock<T>(model: ModelSize, task: () => Promise<T>): Promise<T> {
    const previous = this.generationChains.get(model) ?? Promise.resolve();
    let releaseCurrent = () => {};
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const queued = previous.then(() => current);
    this.generationChains.set(model, queued);

    await previous;

    try {
      return await task();
    } finally {
      releaseCurrent();
      if (this.generationChains.get(model) === queued) {
        this.generationChains.delete(model);
      }
    }
  }

  async unloadModel(model: ModelSize): Promise<void> {
    const runtimeId = this.getRuntimeId(model);
    const runtimePromise = this.runtimePromises.get(model);

    if (!runtimePromise) {
      localInferenceRuntimeRegistry.unregisterRuntime(runtimeId);
      this.activeJobs.delete(model);
      return;
    }

    try {
      const pendingGeneration = this.generationChains.get(model);
      if (pendingGeneration) {
        await pendingGeneration;
      }

      const runtime = await runtimePromise;
      runtime.engine.destroy();
    } catch (error) {
      logger.warn(`Failed to unload ${model} Kitten TTS runtime cleanly`, error);
    } finally {
      this.runtimePromises.delete(model);
      this.generationChains.delete(model);
      this.activeJobs.delete(model);
      localInferenceRuntimeRegistry.unregisterRuntime(runtimeId);
    }
  }

  async generateSpeechFile({
    text,
    voice,
    speed,
    model,
    onProgress,
  }: GenerateSpeechOptions): Promise<{ blob: Blob; file: File; duration: number }> {
    const trimmedText = text.trim();
    if (!trimmedText) {
      throw new Error('Enter some text to synthesize.');
    }

    if (!this.isSupported()) {
      throw new Error('WebGPU is not available in this browser.');
    }

    return this.withGenerationLock(model, async () => {
      const runtime = await this.ensureRuntime(model, onProgress);
      const { float32ToWav, textToInputIds } = await this.getModule();

      this.incrementJobs(model);

      try {
        onProgress?.('Preparing text...');
        const { ids } = await textToInputIds(trimmedText);

        onProgress?.('Generating speech...');
        const { waveform } = await runtime.engine.generate(
          ids,
          voice,
          speed,
          trimmedText.length,
          onProgress,
        );

        const sampleRate = 24000;
        const blob = float32ToWav(waveform, sampleRate);
        const file = new File([blob], createOutputFileName(trimmedText, voice, model), {
          type: 'audio/wav',
          lastModified: Date.now(),
        });

        return { blob, file, duration: waveform.length / sampleRate };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to generate speech with ${model} Kitten TTS runtime`, error);
        this.upsertRuntime(model, 'error', message);
        throw error;
      } finally {
        this.decrementJobs(model);
      }
    });
  }
}

export const kittenTtsService = new KittenTtsService();
