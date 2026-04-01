import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContainedMediaLayout } from './contained-media-layout';

describe('ContainedMediaLayout', () => {
  it('positions the contained media rect and crop viewport using percentages', () => {
    const { container } = render(
      <ContainedMediaLayout
        sourceWidth={1920}
        sourceHeight={1080}
        containerWidth={400}
        containerHeight={400}
        crop={{ left: 0.1, top: 0.2 }}
      >
        <div data-testid="media" />
      </ContainedMediaLayout>
    );

    const wrappers = container.querySelectorAll('div');
    const mediaRect = wrappers[1] as HTMLDivElement | undefined;
    const viewport = wrappers[2] as HTMLDivElement | undefined;
    const content = wrappers[3] as HTMLDivElement | undefined;

    expect(mediaRect?.style.top).toBe('21.875%');
    expect(mediaRect?.style.height).toBe('56.25%');
    expect(viewport?.style.left).toBe('10%');
    expect(viewport?.style.top).toBe('20%');
    expect(content?.style.left).toBe('-11.11111111111111%');
    expect(content?.style.top).toBe('-25%');
    expect(parseFloat(content?.style.width ?? '0')).toBeCloseTo(111.1111111111, 6);
    expect(parseFloat(content?.style.height ?? '0')).toBeCloseTo(125, 6);
    expect(parseFloat(content?.style.left ?? '0') + parseFloat(content?.style.width ?? '0')).toBeCloseTo(100, 6);
    expect(parseFloat(content?.style.top ?? '0') + parseFloat(content?.style.height ?? '0')).toBeCloseTo(100, 6);
  });
});
