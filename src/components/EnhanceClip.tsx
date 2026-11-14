import { useEffect, useRef, useState } from 'react';
import { analyzeClip, type Analysis } from '../analyze';
import { blobUrl } from '../db';
import { savePostAnalysis } from '../store';
import type { Post, Target } from '../types';
import { ClipPlayer, TargetRing } from './ClipPlayer';
import { Icon } from './Icon';

type Step = 'tap' | 'working' | 'preview';

/** Add a target ring and flight trail to a clip that was recorded without them. */
export function EnhanceClip({ post, onClose }: { post: Post; onClose: () => void }) {
  const [url, setUrl] = useState<string>();
  const [dims, setDims] = useState({ w: 16, h: 9 });
  const [target, setTarget] = useState<Target | undefined>(post.target ? { ...post.target } : undefined);
  const [ring, setRing] = useState(post.target?.r ?? 0.07);
  const [step, setStep] = useState<Step>('tap');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Analysis>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // When in the clip the target was tapped: tells the analysis which camera part holds the shot.
  const tapMs = useRef(post.momentMs);
  const videoRef = useRef<HTMLVideoElement>(null);
  // A target called while recording is drawn into the video itself, so it can't move.
  const burnedIn = !!post.target && !post.target.late;

  useEffect(() => {
    void blobUrl(post.videoId).then(setUrl);
  }, [post.videoId]);

  useEffect(() => {
    setTarget((t) => (t ? { ...t, r: ring } : t));
  }, [ring]);

  const onLoaded = () => {
    const v = videoRef.current!;
    setDims({ w: v.videoWidth || 16, h: v.videoHeight || 9 });
    // Show the landing moment (or the middle) so the target is easy to find.
    const show = () => {
      v.currentTime = Math.max(0, post.momentMs / 1000);
    };
    if (Number.isFinite(v.duration)) show();
    else {
      v.ontimeupdate = () => {
        v.ontimeupdate = null;
        show();
      };
      v.currentTime = 1e9;
    }
  };

  const tap = (e: React.PointerEvent<HTMLDivElement>) => {
    if (step !== 'tap' || burnedIn) return;
    const rect = e.currentTarget.getBoundingClientRect();
    tapMs.current = (videoRef.current?.currentTime ?? post.momentMs / 1000) * 1000;
    setTarget({ x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height, r: ring, late: true });
  };

  const analyze = async () => {
    if (!url || !target) return;
    setStep('working');
    setError('');
    try {
      setResult(await analyzeClip(url, target, burnedIn ? post.momentMs : tapMs.current, setProgress));
      setStep('preview');
    } catch (e) {
      setError((e as Error).message);
      setStep('tap');
    }
  };

  // A trail found live while recording is sharper than one found later from the
  // compressed video, so keep it if there is one.
  const keptTrail = post.trail ?? result?.trail ?? undefined;

  const save = async () => {
    if (!target || !result) return;
    setSaving(true);
    try {
      await savePostAnalysis(post.id, { target: burnedIn ? post.target! : { ...target, late: true, fromMs: result.fromMs, toMs: result.toMs }, trail: keptTrail, momentMs: result.momentMs });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body enhance" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 className="section-title grow" style={{ margin: 0 }}>
            ✨ Add target & trail
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>

        {step !== 'preview' && (
          <>
            <ol className="steps">
              <li className={target ? 'done' : 'now'}>
                {burnedIn ? 'Using the target you called when recording' : 'Tap the target (the cup, jar, hoop) in the picture'}
              </li>
              <li className={step === 'working' ? 'now' : ''}>Tap <b>Find the trail</b>. The app watches the clip once (a few seconds)</li>
              <li>Check the preview and save</li>
            </ol>
            <div className="enhance-frame" onPointerDown={tap} style={{ aspectRatio: `${dims.w} / ${dims.h}` }}>
              {url && <video ref={videoRef} src={url} muted playsInline preload="auto" onLoadedMetadata={onLoaded} />}
              {target && !burnedIn && (
                <svg viewBox={`0 0 ${dims.w} ${dims.h}`} className="clip-trail">
                  <TargetRing target={target} w={dims.w} h={dims.h} />
                </svg>
              )}
              {step === 'working' && (
                <div className="enhance-working">
                  Watching the clip… {Math.round(progress * 100)}%
                  <div className="result-bar">
                    <span style={{ width: `${progress * 100}%` }} />
                  </div>
                </div>
              )}
            </div>
            <label className="field">
              <span>Scrub to a frame where you can see the target</span>
              <input
                type="range"
                min={0}
                max={Math.round(post.durationMs)}
                step={50}
                defaultValue={Math.round(post.momentMs)}
                disabled={step === 'working'}
                onChange={(e) => {
                  const v = videoRef.current;
                  if (v) v.currentTime = Number(e.target.value) / 1000;
                }}
              />
            </label>
            <label className="field" hidden={burnedIn}>
              <span>Ring size</span>
              <input type="range" min={0.03} max={0.2} step={0.005} value={ring} onChange={(e) => setRing(Number(e.target.value))} />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-big full" disabled={!target || step === 'working'} onClick={analyze}>
              {step === 'working' ? 'Working…' : 'Find the trail'}
            </button>
          </>
        )}

        {step === 'preview' && result && target && url && (
          <>
            <p className="small muted">
              {keptTrail
                ? 'Found it! Here’s your shot with the target, trail and sound.'
                : 'Couldn’t spot the object in flight (too small, too dark, or the phone moved), but the target and the replay are added.'}
            </p>
            <ClipPlayer src={url} momentMs={result.momentMs} target={burnedIn ? post.target : { ...target, late: true, fromMs: result.fromMs, toMs: result.toMs }} trail={keptTrail} celebrate />
            {!burnedIn && <p className="small muted">Shows as “Target added later” so everyone knows it wasn’t called before the throw.</p>}
            {error && <p className="error">{error}</p>}
            <div className="row">
              <button className="btn btn-quiet grow" onClick={() => setStep('tap')}>
                Redo
              </button>
              <button className="btn grow" disabled={saving} onClick={save}>
                {saving ? 'Saving…' : 'Save to clip'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
