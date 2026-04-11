export const PROXY_GENERATION_MODES = ['smart', 'manual', 'all'] as const;
export type ProxyGenerationMode = (typeof PROXY_GENERATION_MODES)[number];

export const PROXY_GENERATION_RESOLUTIONS = ['1080p', '1440p', '2160p'] as const;
export type ProxyGenerationResolution = (typeof PROXY_GENERATION_RESOLUTIONS)[number];

export const DEFAULT_PROXY_GENERATION_MODE: ProxyGenerationMode = 'smart';
export const DEFAULT_PROXY_GENERATION_RESOLUTION: ProxyGenerationResolution = '1080p';

export const PROXY_GENERATION_MODE_OPTIONS: Array<{
  value: ProxyGenerationMode;
  label: string;
  description: string;
}> = [
  {
    value: 'smart',
    label: 'Smart (Recommended)',
    description: 'Auto-generate proxies for high-resolution and harder-to-play video.',
  },
  {
    value: 'manual',
    label: 'Manual Only',
    description: 'Only generate proxies when you ask for them.',
  },
  {
    value: 'all',
    label: 'All Videos',
    description: 'Auto-generate proxies for every video in the project.',
  },
];

export const PROXY_GENERATION_RESOLUTION_OPTIONS: Array<{
  value: ProxyGenerationResolution;
  label: string;
  description: string;
}> = [
  {
    value: '1080p',
    label: '1080p and Up',
    description: 'Create proxies for Full HD, 4K, and larger sources.',
  },
  {
    value: '1440p',
    label: '1440p and Up',
    description: 'Skip standard 1080p clips and focus on higher-resolution media.',
  },
  {
    value: '2160p',
    label: '4K and Up',
    description: 'Only auto-generate proxies for 4K and larger sources.',
  },
];

const PROXY_GENERATION_THRESHOLDS: Record<ProxyGenerationResolution, { width: number; height: number }> = {
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '2160p': { width: 3840, height: 2160 },
};

export function isVideoProxyCandidate(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

export function getProxyGenerationThreshold(
  resolution: ProxyGenerationResolution,
): { width: number; height: number } {
  return PROXY_GENERATION_THRESHOLDS[resolution];
}

export function normalizeProxyGenerationMode(
  value: unknown,
): ProxyGenerationMode {
  return PROXY_GENERATION_MODES.includes(value as ProxyGenerationMode)
    ? value as ProxyGenerationMode
    : DEFAULT_PROXY_GENERATION_MODE;
}

export function normalizeProxyGenerationResolution(
  value: unknown,
): ProxyGenerationResolution {
  return PROXY_GENERATION_RESOLUTIONS.includes(value as ProxyGenerationResolution)
    ? value as ProxyGenerationResolution
    : DEFAULT_PROXY_GENERATION_RESOLUTION;
}
