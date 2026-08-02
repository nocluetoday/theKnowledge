import { describe, expect, it } from 'vitest';
import { createPreviewThrottle } from '../src/lib/preview-throttle';

/** Manual clock so the interval logic is tested without real timers. */
function withClock(start = 0) {
  let time = start;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('createPreviewThrottle', () => {
  it('sends the first push immediately and coalesces pushes within the interval', () => {
    const sent: string[] = [];
    const clock = withClock();
    const throttle = createPreviewThrottle((text) => sent.push(text), 250, clock.now);

    throttle.push('a');
    clock.advance(100);
    throttle.push('ab');
    clock.advance(100);
    throttle.push('abc');

    expect(sent).toEqual(['a']);
  });

  it('sends again once the interval has elapsed', () => {
    const sent: string[] = [];
    const clock = withClock();
    const throttle = createPreviewThrottle((text) => sent.push(text), 250, clock.now);

    throttle.push('a');
    clock.advance(250);
    throttle.push('ab');

    expect(sent).toEqual(['a', 'ab']);
  });

  it('flush delivers the text the interval was still holding back', () => {
    const sent: string[] = [];
    const clock = withClock();
    const throttle = createPreviewThrottle((text) => sent.push(text), 250, clock.now);

    throttle.push('a');
    clock.advance(100);
    throttle.push('ab final tail');
    throttle.flush();

    expect(sent).toEqual(['a', 'ab final tail']);
  });

  it('flush does nothing when the latest text was already sent', () => {
    const sent: string[] = [];
    const clock = withClock();
    const throttle = createPreviewThrottle((text) => sent.push(text), 250, clock.now);

    throttle.push('a');
    throttle.flush();

    expect(sent).toEqual(['a']);
  });

  it('flush does nothing when nothing was ever pushed', () => {
    const sent: string[] = [];
    const throttle = createPreviewThrottle((text) => sent.push(text));

    throttle.flush();

    expect(sent).toEqual([]);
  });
});
