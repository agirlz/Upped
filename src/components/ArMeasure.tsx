/// <reference types="webxr" />
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

// Measures shooting distance with the phone's AR tracking (WebXR "immersive-ar").
// Works in Chrome on most Android phones. iPhone Safari has no WebXR, so the
// button is hidden there and players pick a distance bucket instead.
//
// How it works: hold the phone over the target and tap Start. The phone's
// position is tracked as you walk back; Done records the distance across the
// floor (height is ignored, so a cup on the floor and a phone at chest height
// still measure correctly).

const M_TO_FT = 3.28084;

let supportCache: Promise<boolean> | null = null;
export function arMeasureSupported(): Promise<boolean> {
  if (!supportCache) {
    supportCache = (async () => {
      try {
        return !!(await navigator.xr?.isSessionSupported('immersive-ar'));
      } catch {
        return false;
      }
    })();
  }
  return supportCache;
}

type Phase = 'starting' | 'place' | 'walk';

export function ArMeasure({ onDone, onClose }: { onDone: (feet: number) => void; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<XRSession | null>(null);
  const latest = useRef<{ x: number; z: number; tracked: boolean } | null>(null);
  const start = useRef<{ x: number; z: number } | null>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [feet, setFeet] = useState(0);
  const feetRef = useRef(0);
  const [tracked, setTracked] = useState(false);
  const [error, setError] = useState('');
  const phaseRef = useRef<Phase>('starting');
  phaseRef.current = phase;

  const finish = (ft?: number) => {
    const s = sessionRef.current;
    sessionRef.current = null;
    void s?.end().catch(() => {});
    if (ft !== undefined) onDone(ft);
    else onClose();
  };

  const markStart = () => {
    const p = latest.current;
    if (!p || !p.tracked) return;
    start.current = { x: p.x, z: p.z };
    navigator.vibrate?.(40);
    setPhase('walk');
  };

  const markDone = () => {
    if (!start.current) return;
    navigator.vibrate?.([30, 40, 30]);
    finish(Math.round(feetRef.current * 10) / 10);
  };

  useEffect(() => {
    let cancelled = false;
    let lastUi = 0;
    (async () => {
      try {
        const xr = navigator.xr;
        if (!xr) throw new Error('AR is not available on this phone.');
        const session = await xr.requestSession('immersive-ar', {
          requiredFeatures: ['local'],
          optionalFeatures: ['dom-overlay'],
          domOverlay: { root: overlayRef.current! },
        } as XRSessionInit);
        if (cancelled) {
          void session.end();
          return;
        }
        sessionRef.current = session;
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl', { xrCompatible: true }) as WebGLRenderingContext | null;
        if (!gl) throw new Error('This phone could not start AR (no WebGL).');
        await session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
        const space = await session.requestReferenceSpace('local');

        // Without the on-screen overlay, a screen tap advances the steps instead.
        session.addEventListener('select', () => {
          if (phaseRef.current === 'place') markStart();
          else if (phaseRef.current === 'walk') markDone();
        });
        session.addEventListener('end', () => {
          if (sessionRef.current) {
            sessionRef.current = null;
            onClose();
          }
        });

        setPhase('place');
        const onFrame: XRFrameRequestCallback = (t, frame) => {
          const s = frame.session;
          s.requestAnimationFrame(onFrame);
          const layer = s.renderState.baseLayer!;
          gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          const pose = frame.getViewerPose(space);
          if (!pose) return;
          const pos = pose.transform.position;
          const ok = !pose.emulatedPosition;
          latest.current = { x: pos.x, z: pos.z, tracked: ok };
          if (start.current) feetRef.current = Math.hypot(pos.x - start.current.x, pos.z - start.current.z) * M_TO_FT;
          if (t - lastUi > 100) {
            lastUi = t;
            setTracked(ok);
            setFeet(feetRef.current);
          }
        };
        session.requestAnimationFrame(onFrame);
      } catch (e) {
        setError((e as Error).message || 'Could not start AR measuring.');
      }
    })();
    return () => {
      cancelled = true;
      void sessionRef.current?.end().catch(() => {});
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="ar-overlay" ref={overlayRef}>
      <div className="ar-top">
        <span className="pill pill-lime">
          <Icon name="target" /> Measure distance
        </span>
        <button className="icon-btn" onClick={() => finish()} aria-label="Cancel measuring">
          <Icon name="x" size={24} />
        </button>
      </div>

      {error ? (
        <div className="ar-card">
          <p className="error">{error}</p>
          <button className="btn full" onClick={onClose}>
            Pick a distance instead
          </button>
        </div>
      ) : (
        <>
          <div className="ar-readout">
            {phase === 'walk' ? (
              <>
                <span className="ar-num">{feet.toFixed(1)}</span>
                <span className="ar-unit">ft</span>
              </>
            ) : (
              <span className="ar-hint">{phase === 'starting' ? 'Starting AR…' : tracked ? 'Ready' : 'Move the phone slowly…'}</span>
            )}
          </div>
          <div className="ar-card">
            {phase === 'place' && (
              <>
                <p>
                  <b>1.</b> Hold your phone right over the target (the cup, the hoop).
                </p>
                <button className="btn full" disabled={!tracked} onClick={markStart}>
                  {tracked ? 'Start here' : 'Finding the room…'}
                </button>
              </>
            )}
            {phase === 'walk' && (
              <>
                <p>
                  <b>2.</b> Walk back to where you'll shoot from. Keep the camera pointed at the room.
                </p>
                <button className="btn full" onClick={markDone}>
                  I'm shooting from here
                </button>
              </>
            )}
            <p className="small muted">Works best in good light with stuff in view. Blank walls confuse it.</p>
          </div>
        </>
      )}
    </div>
  );
}
