import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ValueGraphEditor } from './index';
import { DEFAULT_GRAPH_PADDING } from './types';

function SelectionHarness() {
  const [selection, setSelection] = useState<Set<string>>(new Set(['kf-1']));

  return (
    <TooltipProvider>
      <ValueGraphEditor
        itemId="item-1"
        keyframesByProperty={{
          opacity: [
            { id: 'kf-1', frame: 0, value: 0.4, easing: 'linear' },
            { id: 'kf-2', frame: 30, value: 0.6, easing: 'linear' },
          ],
        }}
        selectedProperty="opacity"
        selectedKeyframeIds={selection}
        onSelectionChange={setSelection}
        width={480}
        height={260}
        totalFrames={60}
        showToolbar={false}
      />
      <output data-testid="selection">{[...selection].join(',')}</output>
    </TooltipProvider>
  );
}

function PointSelectionHarness() {
  const [selection, setSelection] = useState<Set<string>>(new Set());

  return (
    <TooltipProvider>
      <ValueGraphEditor
        itemId="item-1"
        keyframesByProperty={{
          opacity: [
            { id: 'kf-1', frame: 0, value: 0.4, easing: 'linear' },
            { id: 'kf-2', frame: 30, value: 0.6, easing: 'linear' },
          ],
        }}
        selectedProperty="opacity"
        selectedKeyframeIds={selection}
        onSelectionChange={setSelection}
        width={480}
        height={260}
        totalFrames={60}
        showToolbar={false}
      />
      <output data-testid="point-selection">{[...selection].join(',')}</output>
    </TooltipProvider>
  );
}

function installSvgDomMocks(svg: SVGSVGElement) {
  Object.defineProperty(svg, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 480,
      bottom: 260,
      width: 480,
      height: 260,
      toJSON: () => ({}),
    }),
  });

  Object.defineProperty(svg, 'setPointerCapture', {
    configurable: true,
    value: () => {},
  });

  Object.defineProperty(svg, 'releasePointerCapture', {
    configurable: true,
    value: () => {},
  });
}

describe('ValueGraphEditor clipping', () => {
  it('clips graph content to the plotted graph area', () => {
    const { container } = render(
      <TooltipProvider>
        <ValueGraphEditor
          itemId="item-1"
          keyframesByProperty={{
            opacity: [
              {
                id: 'kf-1',
                frame: 0,
                value: 0.5,
                easing: 'linear',
              },
            ],
          }}
          selectedProperty="opacity"
          width={480}
          height={260}
        />
      </TooltipProvider>
    );

    const clipPath = container.querySelector('clipPath');
    expect(clipPath).toBeInTheDocument();

    const clipRect = clipPath?.querySelector('rect');
    expect(clipRect).toHaveAttribute('x', String(DEFAULT_GRAPH_PADDING.left));
    expect(clipRect).toHaveAttribute('y', String(DEFAULT_GRAPH_PADDING.top));

    const clippedGroup = container.querySelector('g[clip-path^="url(#"]');
    expect(clippedGroup).toBeInTheDocument();
    expect(clippedGroup?.querySelector('.graph-keyframes')).toBeInTheDocument();
    expect(clippedGroup?.querySelector('.graph-extension-lines')).toBeInTheDocument();
  });

  it('formats the time ruler in seconds when requested', () => {
    const { container } = render(
      <TooltipProvider>
        <ValueGraphEditor
          itemId="item-1"
          keyframesByProperty={{
            opacity: [
              { id: 'kf-1', frame: 0, value: 0.4, easing: 'ease-in' },
              { id: 'kf-2', frame: 30, value: 0.6, easing: 'linear' },
            ],
          }}
          selectedProperty="opacity"
          width={480}
          height={260}
          totalFrames={60}
          fps={30}
          rulerUnit="seconds"
          showToolbar={false}
        />
      </TooltipProvider>
    );

    expect(container.textContent).toContain('0.33s');
  });

  it('shows selected handles by default and can show all handles', () => {
    const props = {
      itemId: 'item-1',
      keyframesByProperty: {
        opacity: [
          {
            id: 'kf-1',
            frame: 0,
            value: 0.4,
            easing: 'ease-in' as const,
            easingConfig: {
              type: 'cubic-bezier' as const,
              bezier: { x1: 0.42, y1: 0, x2: 1, y2: 1 },
            },
          },
          {
            id: 'kf-2',
            frame: 30,
            value: 0.6,
            easing: 'ease-out' as const,
          },
          { id: 'kf-3', frame: 60, value: 0.8, easing: 'linear' as const },
        ],
      },
      selectedProperty: 'opacity' as const,
      selectedKeyframeIds: new Set(['kf-1']),
      width: 480,
      height: 260,
      totalFrames: 60,
      showToolbar: false,
    };

    const { container, rerender } = render(
      <TooltipProvider>
        <ValueGraphEditor {...props} />
      </TooltipProvider>
    );

    expect(container.querySelector('.graph-handles')).toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <ValueGraphEditor
          {...props}
          selectedKeyframeIds={new Set()}
          showAllHandles
        />
      </TooltipProvider>
    );

    expect(container.querySelectorAll('.bezier-handle').length).toBeGreaterThan(0);
  });

  it('renders a single visible handle for one-handle easing presets', () => {
    const { container } = render(
      <TooltipProvider>
        <ValueGraphEditor
          itemId="item-1"
          keyframesByProperty={{
            opacity: [
              { id: 'kf-1', frame: 0, value: 0.4, easing: 'ease-out' },
              { id: 'kf-2', frame: 30, value: 0.6, easing: 'linear' },
            ],
          }}
          selectedProperty="opacity"
          selectedKeyframeIds={new Set(['kf-2'])}
          width={480}
          height={260}
          totalFrames={60}
          showToolbar={false}
        />
      </TooltipProvider>
    );

    expect(container.querySelectorAll('.bezier-handle')).toHaveLength(1);
  });

  it('shows handles only for the selected keyframe that owns them', () => {
    const { container } = render(
      <TooltipProvider>
        <ValueGraphEditor
          itemId="item-1"
          keyframesByProperty={{
            opacity: [
              {
                id: 'kf-1',
                frame: 0,
                value: 0.4,
                easing: 'ease-in',
                easingConfig: {
                  type: 'cubic-bezier',
                  bezier: { x1: 0.42, y1: 0, x2: 1, y2: 1 },
                },
              },
              { id: 'kf-2', frame: 30, value: 0.6, easing: 'linear' },
            ],
          }}
          selectedProperty="opacity"
          selectedKeyframeIds={new Set(['kf-1'])}
          width={480}
          height={260}
          totalFrames={60}
          showToolbar={false}
        />
      </TooltipProvider>
    );

    // Selecting kf-1 (ease-in) shows its out handle; selecting kf-2 would not show handles
    // because the ease-in handle is anchored at kf-1, not kf-2
    expect(container.querySelector('.graph-handles')).toBeInTheDocument();
    expect(container.querySelectorAll('.bezier-handle').length).toBe(1);
  });

  it('clears selection when clicking the graph canvas', () => {
    const { container } = render(<SelectionHarness />);

    expect(screen.getByTestId('selection')).toHaveTextContent('kf-1');

    fireEvent.click(container.querySelector('svg')!);

    expect(screen.getByTestId('selection')).toHaveTextContent('');
  });

  it('does not immediately clear a point selection from the canvas click handler', () => {
    const { container } = render(<PointSelectionHarness />);
    installSvgDomMocks(container.querySelector('svg') as SVGSVGElement);

    const pointHitArea = container.querySelector('.graph-keyframe circle');
    expect(pointHitArea).toBeTruthy();

    fireEvent.pointerDown(pointHitArea!, {
      button: 0,
      clientX: 50,
      clientY: 50,
      pointerId: 1,
    });
    fireEvent.click(pointHitArea!);

    expect(screen.getByTestId('point-selection')).toHaveTextContent('kf-1');
  });
});
