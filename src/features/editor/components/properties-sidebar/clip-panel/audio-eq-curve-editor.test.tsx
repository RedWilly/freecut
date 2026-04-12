import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AudioEqCurveEditor } from './audio-eq-curve-editor';

const DEFAULT_SETTINGS = {
  lowGainDb: 0,
  lowMidGainDb: 0,
  midGainDb: 0,
  highMidGainDb: 0,
  highGainDb: 0,
} as const;

describe('AudioEqCurveEditor', () => {
  it('drags a band handle with live preview and final commit', () => {
    const onLiveChange = vi.fn();
    const onChange = vi.fn();

    render(
      <AudioEqCurveEditor
        settings={DEFAULT_SETTINGS}
        onLiveChange={onLiveChange}
        onChange={onChange}
      />,
    );

    const root = document.querySelector('[data-eq-curve-root="true"]') as HTMLDivElement | null;
    const midHandle = document.querySelector('[data-eq-band="audioEqMidGainDb"]') as HTMLButtonElement | null;

    expect(root).not.toBeNull();
    expect(midHandle).not.toBeNull();

    Object.defineProperty(root!, 'getBoundingClientRect', {
      value: () => ({
        x: 0,
        y: 10,
        top: 10,
        bottom: 142,
        left: 0,
        right: 300,
        width: 300,
        height: 132,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(root!, 'setPointerCapture', { value: vi.fn(), configurable: true });
    Object.defineProperty(root!, 'releasePointerCapture', { value: vi.fn(), configurable: true });

    fireEvent.pointerDown(midHandle!, { pointerId: 1, clientY: 16 });
    fireEvent.pointerMove(root!, { pointerId: 1, clientY: 126 });
    fireEvent.pointerUp(root!, { pointerId: 1, clientY: 126 });

    expect(onLiveChange).toHaveBeenCalled();
    expect(onLiveChange.mock.calls[0]?.[0]).toBe('audioEqMidGainDb');
    expect(onLiveChange.mock.calls[0]?.[1]).toBeGreaterThan(15);
    expect(onLiveChange.mock.calls.at(-1)?.[0]).toBe('audioEqMidGainDb');
    expect(onLiveChange.mock.calls.at(-1)?.[1]).toBeLessThan(-12);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toBe('audioEqMidGainDb');
    expect(onChange.mock.calls[0]?.[1]).toBeLessThan(-12);
  });

  it('shows mixed-state messaging and blocks interaction when disabled', () => {
    const onLiveChange = vi.fn();
    const onChange = vi.fn();

    render(
      <AudioEqCurveEditor
        settings={DEFAULT_SETTINGS}
        disabled={true}
        onLiveChange={onLiveChange}
        onChange={onChange}
      />,
    );

    expect(screen.getByText('Mixed EQ values')).toBeInTheDocument();

    const lowHandle = document.querySelector('[data-eq-band="audioEqLowGainDb"]') as HTMLButtonElement | null;
    fireEvent.pointerDown(lowHandle!, { pointerId: 2, clientY: 30 });

    expect(onLiveChange).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
