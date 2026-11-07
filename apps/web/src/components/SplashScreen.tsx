import { useEffect, useRef, useState } from 'react';
import splashImage from '../assets/splash.webp';
import { getRememberedClient } from '../state/clientIdentity.js';

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * The opening animation: the logo image pops in, glows, shows the client (brand) name of this computer, then fades
 * away and the software appears. Click or any key skips it. The app underneath keeps loading meanwhile.
 */
export const SplashScreen = ({ onDone }: { onDone: () => void }) => {
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);
  const [client] = useState(getRememberedClient);
  const quick = useRef(reducedMotion());

  const finish = useRef(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  });
  finish.current = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };

  useEffect(() => {
    const hold = quick.current ? 900 : 2700;
    const fade = quick.current ? 200 : 500;
    const t1 = window.setTimeout(() => setLeaving(true), hold);
    const t2 = window.setTimeout(() => finish.current(), hold + fade);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  const skip = () => {
    setLeaving(true);
    window.setTimeout(() => finish.current(), 200);
  };

  useEffect(() => {
    window.addEventListener('keydown', skip);
    return () => window.removeEventListener('keydown', skip);
  }, []);

  return (
    <div
      role="presentation"
      data-testid="splash"
      onClick={skip}
      className={`splash-root fixed inset-0 z-[100] flex cursor-pointer flex-col items-center justify-center bg-[#0f1538] ${leaving ? 'splash-leave' : ''}`}
    >
      <img
        src={splashImage}
        alt="MAFK Retail-Flow POS"
        draggable={false}
        className="splash-pop max-h-[68vh] w-[min(92vw,900px)] select-none object-contain"
      />
      {client ? (
        <div className="splash-brand mt-4 text-center">
          <p className="text-4xl font-bold tracking-[0.3em] text-white">{client.code}</p>
          <p className="mt-1 text-sm tracking-wide text-slate-300">{client.name}</p>
        </div>
      ) : null}
      <p className="splash-hint absolute bottom-6 text-xs text-slate-400">Click to skip</p>
    </div>
  );
};
