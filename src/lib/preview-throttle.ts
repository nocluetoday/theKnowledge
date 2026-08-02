/**
 * Coalesce a rapid stream of preview updates into at most one `send` per
 * interval. Streamed text arrives token by token; repainting a UI that often is
 * wasted work. `flush()` delivers whatever the interval was still holding back,
 * so the consumer never ends on a stale tail.
 */

export interface PreviewThrottle {
  /** Record the latest full text, sending it if the interval has elapsed. */
  push(text: string): void;
  /** Send the latest text if it has not been sent yet. */
  flush(): void;
}

export function createPreviewThrottle(
  send: (text: string) => void,
  intervalMs = 250,
  now: () => number = Date.now,
): PreviewThrottle {
  let latest = '';
  let sent = '';
  let lastSentAt = -Infinity;

  return {
    push(text: string): void {
      latest = text;
      const time = now();
      if (time - lastSentAt < intervalMs) return;
      lastSentAt = time;
      sent = latest;
      send(latest);
    },
    flush(): void {
      if (!latest || latest === sent) return;
      sent = latest;
      send(latest);
    },
  };
}
