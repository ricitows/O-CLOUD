'use client';

import { useEffect, useRef } from 'react';

const RENEW_AFTER_MS = 20 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 1000;

export function shouldRenewSignedImages(now: number, lastRefreshAt: number, visible: boolean, refreshing: boolean) {
  return visible && !refreshing && now - lastRefreshAt >= RENEW_AFTER_MS;
}

/** Refresh private-image URLs before their 30-minute expiry, only while a section is active. */
export function useSignedImageRenewal(refresh: () => void | Promise<unknown>, enabled = true) {
  const refreshRef = useRef(refresh);
  const lastRefreshAt = useRef(Date.now());
  const refreshing = useRef(false);

  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    if (!enabled) return;

    const refreshIfStale = async () => {
      if (!shouldRenewSignedImages(Date.now(), lastRefreshAt.current, document.visibilityState === 'visible', refreshing.current)) return;
      refreshing.current = true;
      try {
        const refreshed = await refreshRef.current();
        if (refreshed !== false) lastRefreshAt.current = Date.now();
      } catch {
        // Keep the last successful time so a later focus/check can retry.
      } finally {
        refreshing.current = false;
      }
    };

    const timer = window.setInterval(() => { void refreshIfStale(); }, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', refreshIfStale);
    window.addEventListener('focus', refreshIfStale);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfStale);
      window.removeEventListener('focus', refreshIfStale);
    };
  }, [enabled]);
}
