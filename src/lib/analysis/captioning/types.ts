export interface MediaCaption {
  timeSec: number;
  text: string;
}

export interface CaptioningProgress {
  stage: 'loading-model' | 'captioning';
  percent: number;
  framesAnalyzed: number;
  totalFrames: number;
}

export interface CaptioningOptions {
  onProgress?: (progress: CaptioningProgress) => void;
  signal?: AbortSignal;
  sampleIntervalSec?: number;
}

export interface MediaCaptioningProvider {
  id: string;
  label: string;
  captionVideo(
    video: HTMLVideoElement,
    options?: CaptioningOptions,
  ): Promise<MediaCaption[]>;
  captionImage(
    imageBlob: Blob,
    options?: CaptioningOptions,
  ): Promise<MediaCaption[]>;
}
