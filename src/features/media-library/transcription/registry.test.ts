import { describe, expect, it } from 'vitest';
import {
  getDefaultMediaTranscriptionAdapter,
  getDefaultMediaTranscriptionModel,
  getMediaTranscriptionModelLabel,
  getMediaTranscriptionModelOptions,
} from './registry';

describe('mediaTranscriptionAdapterRegistry', () => {
  it('resolves the default transcription adapter and model catalog', () => {
    expect(getDefaultMediaTranscriptionAdapter()).toMatchObject({
      id: 'browser-whisper',
      label: 'Browser Whisper',
    });
    expect(getDefaultMediaTranscriptionModel()).toBe('whisper-tiny');
    expect(getMediaTranscriptionModelOptions()).toContainEqual({
      value: 'whisper-small',
      label: 'Small',
    });
  });

  it('formats model labels through the active adapter', () => {
    expect(getMediaTranscriptionModelLabel('whisper-large')).toBe('Large v3 Turbo');
  });
});
