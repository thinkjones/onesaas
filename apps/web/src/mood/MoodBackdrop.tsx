import { useEffect, useState } from 'react';
import './MoodBackdrop.css';
import { DEFAULT_MOOD_IMAGES, MOOD_CROSSFADE_MS } from './mood.ts';

/**
 * M5 Task 4: the calm design-mode backdrop. An absolutely positioned layer
 * that sits behind the canvas (the parent provides the positioning context),
 * showing Dad's generated set when there is one, else the bundled defaults.
 * Global Constraints: opacity 0.16 (Evening 0.10), a 60 s slow drift, a
 * crossfade every 45 s, static under prefers-reduced-motion. Toggling
 * `visible` fades over 600 ms. DesignView passes visible, RuntimeView false.
 */

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export default function MoodBackdrop({
  visible,
  fileIds = [],
}: {
  visible: boolean;
  /** Generated set (settings.moodFileIds); empty falls back to the defaults. */
  fileIds?: string[];
}) {
  const reduced = usePrefersReducedMotion();
  const images =
    fileIds.length > 0
      ? fileIds.map((id) => `/api/files/${encodeURIComponent(id)}`)
      : DEFAULT_MOOD_IMAGES;
  const [index, setIndex] = useState(0);
  // Under reduced motion there is no rotation: the first image stays put.
  useEffect(() => {
    if (reduced || images.length < 2) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % images.length);
    }, MOOD_CROSSFADE_MS);
    return () => clearInterval(timer);
  }, [reduced, images.length]);
  const current = images.length === 0 ? 0 : index % images.length;

  return (
    <div aria-hidden="true" className={`mood-backdrop${visible ? '' : ' mood-backdrop-hidden'}`}>
      <div className={reduced ? 'mood-backdrop-stack' : 'mood-backdrop-stack mood-backdrop-drift'}>
        {images.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            draggable={false}
            className={
              `mood-backdrop-image${i === current ? ' mood-backdrop-active' : ''}` +
              (reduced ? '' : ' mood-backdrop-fade')
            }
          />
        ))}
      </div>
    </div>
  );
}
