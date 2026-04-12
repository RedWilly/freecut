import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resolveAudioEqSettings } from '@/shared/utils/audio-eq';
import { AudioEqCurveEditor } from './audio-eq-curve-editor';

const DEFAULT_SETTINGS = resolveAudioEqSettings({});

describe('AudioEqCurveEditor', () => {
  it('drags a parametric band handle with live preview and final commit', () => {
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
    const highMidHandle = document.querySelector('[data-eq-band="high-mid"]') as HTMLButtonElement | null;

    expect(root).not.toBeNull();
    expect(highMidHandle).not.toBeNull();

    Object.defineProperty(root!, 'getBoundingClientRect', {
      value: () => ({
        x: 0,
        y: 10,
        top: 10,
        bottom: 150,
        left: 0,
        right: 320,
        width: 320,
        height: 140,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(root!, 'setPointerCapture', { value: vi.fn(), configurable: true });
    Object.defineProperty(root!, 'releasePointerCapture', { value: vi.fn(), configurable: true });

    fireEvent.pointerDown(highMidHandle!, { pointerId: 1, clientX: 280, clientY: 24 });
    fireEvent.pointerMove(root!, { pointerId: 1, clientX: 180, clientY: 122 });
    fireEvent.pointerUp(root!, { pointerId: 1, clientX: 180, clientY: 122 });

    expect(onLiveChange).toHaveBeenCalled();
    expect(onLiveChange.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      audioEqHighMidFrequencyHz: expect.any(Number),
      audioEqHighMidGainDb: expect.any(Number),
    }));
    expect(onLiveChange.mock.calls[0]?.[0].audioEqHighMidGainDb).toBeGreaterThan(12);
    expect(onLiveChange.mock.calls.at(-1)?.[0].audioEqHighMidGainDb).toBeLessThan(-10);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      audioEqHighMidFrequencyHz: expect.any(Number),
      audioEqHighMidGainDb: expect.any(Number),
    }));
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

    const lowCutHandle = document.querySelector('[data-eq-band="low-cut"]') as HTMLButtonElement | null;
    fireEvent.pointerDown(lowCutHandle!, { pointerId: 2, clientX: 24, clientY: 120 });

    expect(onLiveChange).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
