import { useEffect, useRef, useState } from 'react';
import { analyzeClip, type Analysis } from '../analyze';
import { blobUrl } from '../db';
import { savePostAnalysis } from '../store';
import type { Post, Target } from '../types';
import { ClipPlayer, TargetRing } from './ClipPlayer';
import { Icon } from './Icon';

type Step = 'tap' | 'working' | 'preview' | 'draw';
type TrailPts = NonNullable<Post['trail']>;

/** A smooth throwing arc from the release point to the target (for trails drawn by hand). */
function drawnArc(from: { t: number; x: number; y: number }, to: { x: number; y: number }, landMs: number, height: number): TrailPts {
  const pts: TrailPts = [];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    pts.push({
      t: Math.round(from.t + (landMs - from.t) * u),
      x: +(from.x + (to.x - from.x) * u).toFixed(4),
      y: +(from.y + (to.y - from.y) * u - 4 * height * u * (1 - u)).toFixed(4),
    });
  }
  return pts;
}

/** Add, redo, draw or remove the target ring and flight trail on one of your clips. */
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
  // Draw-it-yourself
  const [release, setRelease] = useState<{ t: number; x: number; y: number }>();
  const [landMs, setLandMs] = useState<number>();
  const [arcHeight, setArcHeight] = useState(0.15);
  // When in the clip the target was tapped: tells the analysis which camera part holds the shot.
  const tapMs = useRef(post.momentMs);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
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

  const nowMs = () => (videoRef.current?.currentTime ?? post.momentMs / 1000) * 1000;

  const tap = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (step === 'draw') {
      setRelease({ t: nowMs(), x, y });
      return;
    }
    if (step !== 'tap' || burnedIn) return;
    tapMs.current = nowMs();
    setTarget({ x, y, r: ring, late: true });
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

  const startDrawing = () => {
    setRelease(undefined);
    setLandMs(result?.momentMs);
    setStep('draw');
  };

  // A trail found live while recording (if there is one) is kept over a later re-analysis.
  const foundTrail = (post.target?.late ? result?.trail : post.trail ?? result?.trail) ?? undefined;
  const drawn = release && target && landMs !== undefined && landMs > release.t ? drawnArc(release, target, landMs, arcHeight) : undefined;

  const finalTarget = (extra: Partial<Target>): Target =>
    burnedIn ? { ...post.target!, ...extra } : { ...target!, late: true, ...extra };

  const save = async (trail: TrailPts | undefined, momentMs: number, extra: Partial<Target>) => {
    if (!target) return;
    setSaving(true);
    try {
      await savePostAnalysis(post.id, { target: finalTarget(extra), trail, momentMs });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const removeTrail = () => {
    if (!confirm('Remove the trail from this clip?')) return;
    setTarget(post.target);
    void save(undefined, post.momentMs, { trailByHand: false });
  };

  const scrubber = (label: string) => (
    <label className="field">
      <span>{label}</span>
      <input
        ref={scrubRef}
        type="range"
        min={0}
        max={Math.round(post.durationMs)}
        step={33}
        defaultValue={Math.round(post.momentMs)}
        disabled={step === 'working'}
        onChange={(e) => {
          const v = videoRef.current;
          if (v) v.currentTime = Number(e.target.value) / 1000;
        }}
      />
    </label>
  );

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body enhance" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 className="section-title grow" style={{ margin: 0 }}>
            {step === 'draw' ? '✏️ Draw the trail' : '✨ Target & trail'}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>

        {(step === 'tap' || step === 'working' || step === 'draw') && (
          <>
            {step === 'draw' ? (
              <ol className="steps">
                <li className={release ? 'done' : 'now'}>Scrub to the moment it leaves your hand, then tap where it is</li>
                <li className={release && landMs === undefined ? 'now' : landMs !== undefined ? 'done' : ''}>
                  Scrub to the moment it lands, then tap <b>It lands here</b>
                </li>
                <li className={drawn ? 'now' : ''}>Adjust the arc and save</li>
              </ol>
            ) : (
              <ol className="steps">
                <li className={target ? 'done' : 'now'}>
                  {burnedIn ? 'Using the target you called when recording' : 'Scrub to the shot (after any selfie part) and tap the target'}
                </li>
                <li className={step === 'working' ? 'now' : ''}>
                  Tap <b>Find the trail</b>. The app watches the clip once
                </li>
                <li>Check the preview and save</li>
              </ol>
            )}
            <div className="enhance-frame" onPointerDown={tap} style={{ aspectRatio: `${dims.w} / ${dims.h}` }}>
              {url && <video ref={videoRef} src={url} muted playsInline preload="auto" onLoadedMetadata={onLoaded} />}
              {(target || release) && (
                <svg viewBox={`0 0 ${dims.w} ${dims.h}`} className="clip-trail">
                  {target && !burnedIn && <TargetRing target={target} w={dims.w} h={dims.h} />}
                  {drawn && (
                    <path
                      d={'M' + drawn.map((p) => `${(p.x * dims.w).toFixed(1)} ${(p.y * dims.h).toFixed(1)}`).join(' L')}
                      fill="none"
                      strokeWidth={dims.w * 0.012}
                      strokeLinecap="round"
                    />
                  )}
                  {release && <circle cx={release.x * dims.w} cy={release.y * dims.h} r={dims.w * 0.02} className="release-dot" />}
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
            {scrubber(step === 'draw' ? 'Scrub through the clip' : 'Scrub to a frame where you can see the target')}

            {step === 'draw' ? (
              <>
                <button className="btn btn-quiet full" disabled={!release} onClick={() => setLandMs(nowMs())}>
                  {landMs !== undefined ? `Lands at ${(landMs / 1000).toFixed(1)}s · set again` : 'It lands here'}
                </button>
                {drawn && (
                  <label className="field">
                    <span>Arc height</span>
                    <input type="range" min={-0.1} max={0.45} step={0.01} value={arcHeight} onChange={(e) => setArcHeight(Number(e.target.value))} />
                  </label>
                )}
                {landMs !== undefined && release && landMs <= release.t && <p className="error">It has to land after it leaves your hand.</p>}
                {error && <p className="error">{error}</p>}
                <div className="row">
                  <button className="btn btn-quiet grow" onClick={() => setStep('tap')}>
                    Back
                  </button>
                  <button
                    className="btn grow"
                    disabled={!drawn || saving}
                    onClick={() =>
                      void save(drawn, landMs!, {
                        trailByHand: true,
                        ...(burnedIn ? {} : { fromMs: Math.max(0, release!.t - 800), toMs: landMs! + 2500 }),
                      })
                    }
                  >
                    {saving ? 'Saving…' : 'Save drawn trail'}
                  </button>
                </div>
                <p className="small muted">Shows as “✏️ Trail drawn by you”, so everyone knows it wasn’t tracked.</p>
              </>
            ) : (
              <>
                <label className="field" hidden={burnedIn}>
                  <span>Ring size</span>
                  <input type="range" min={0.03} max={0.2} step={0.005} value={ring} onChange={(e) => setRing(Number(e.target.value))} />
                </label>
                {error && <p className="error">{error}</p>}
                <button className="btn btn-big full" disabled={!target || step === 'working'} onClick={analyze}>
                  {step === 'working' ? 'Working…' : 'Find the trail'}
                </button>
                <div className="row">
                  <button className="btn btn-quiet btn-sm grow" disabled={!target || step === 'working'} onClick={startDrawing}>
                    ✏️ Draw it myself
                  </button>
                  {post.trail && (
                    <button className="btn btn-miss btn-sm grow" disabled={saving || step === 'working'} onClick={removeTrail}>
                      Remove trail
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {step === 'preview' && result && target && url && (
          <>
            <p className="small muted">
              {foundTrail
                ? 'Found it! Here’s your shot with the target, trail and sound.'
                : 'Couldn’t see the object fly (too small or blurry, hidden by your hand, or the phone moved). Save the target and replay as is, or draw the trail yourself.'}
            </p>
            <ClipPlayer
              src={url}
              momentMs={result.momentMs}
              target={finalTarget(burnedIn ? {} : { fromMs: result.fromMs, toMs: result.toMs })}
              trail={foundTrail}
              celebrate
            />
            {!burnedIn && <p className="small muted">Shows as “Target added later” so everyone knows it wasn’t called before the throw.</p>}
            {error && <p className="error">{error}</p>}
            {!foundTrail && (
              <button className="btn btn-quiet full" onClick={startDrawing}>
                ✏️ Draw the trail myself
              </button>
            )}
            <div className="row">
              <button className="btn btn-quiet grow" onClick={() => setStep('tap')}>
                Redo
              </button>
              <button
                className="btn grow"
                disabled={saving}
                onClick={() => void save(foundTrail, result.momentMs, { trailByHand: false, ...(burnedIn ? {} : { fromMs: result.fromMs, toMs: result.toMs }) })}
              >
                {saving ? 'Saving…' : 'Save to clip'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
