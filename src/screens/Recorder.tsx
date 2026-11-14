import { useEffect, useMemo, useRef, useState } from 'react';
import { canvasToBlob, drawOverlay, pickMimeType, TargetMotion } from '../capture';
import { ArMeasure, arMeasureSupported } from '../components/ArMeasure';
import { ClipPlayer } from '../components/ClipPlayer';
import { Icon } from '../components/Icon';
import { PageTitle, TopBar } from '../components/ui';
import { bucketForFeet, difficulty, DISTANCES, distanceLabel, TARGETS } from '../difficulty';
import { go } from '../router';
import { cloudMode, createPost, myLobbies, randomCode, useAppState } from '../store';
import { RULE_OPTIONS, type DistanceBucket, type PostKind, type Spot, type Target, type TargetSize } from '../types';

interface Props {
  lobbyId?: string;
  rootId?: string;
  kind: PostKind;
  challengeId?: string;
}

type Phase = 'aim' | 'countdown' | 'recording' | 'judge' | 'review';

interface Clip {
  blob: Blob;
  url: string;
  durationMs: number;
  momentMs: number;
  thumb?: Blob;
  recordedAt: number;
}

// Online, only the last few misses upload, to save storage.
const MAX_BLOOPERS = cloudMode ? 3 : 12;

export function Recorder({ lobbyId: lobbyParam, rootId, kind, challengeId }: Props) {
  const s = useAppState();
  const lobbies = myLobbies(s);
  const root = rootId ? s.posts[rootId] : undefined;
  const challenge = challengeId ? s.challenges[challengeId] : undefined;
  const [lobbyId, setLobbyId] = useState(lobbyParam ?? root?.lobbyId ?? lobbies[0]?.id ?? '');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const motion = useMemo(() => new TargetMotion(), []);
  const thumbCanvas = useMemo(() => document.createElement('canvas'), []);

  const [camError, setCamError] = useState<string>();
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('aim');
  const [target, setTarget] = useState<Target | undefined>(root?.target ? { ...root.target } : undefined);
  const [ringSize, setRingSize] = useState(root?.target?.r ?? 0.07);
  const [clipLen, setClipLen] = useState(10);
  const [countdownLen, setCountdownLen] = useState(5);
  const [code] = useState(() => randomCode());
  const [attempt, setAttempt] = useState(1);
  const [misses, setMisses] = useState<Blob[]>([]);
  const [clip, setClip] = useState<Clip>();
  const [title, setTitle] = useState('');
  const [rules, setRules] = useState<string[]>(root?.rules ?? challenge?.rules ?? []);
  const [posting, setPosting] = useState(false);
  const [spot, setSpot] = useState<Spot>(root?.spot ?? 'court');
  const [distance, setDistance] = useState<DistanceBucket | undefined>(root?.distance);
  const [distanceFt, setDistanceFt] = useState<number>();
  const [targetSize, setTargetSize] = useState<TargetSize | undefined>(root?.targetSize);
  const [canMeasure, setCanMeasure] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [camOn, setCamOn] = useState(true);

  useEffect(() => {
    void arMeasureSupported().then(setCanMeasure);
  }, []);

  // The AR session needs the camera, so ours is switched off while measuring.
  const startMeasure = () => {
    setCamOn(false);
    setMeasuring(true);
  };
  const endMeasure = (ft?: number) => {
    setMeasuring(false);
    setCamOn(true);
    if (ft !== undefined) {
      setDistanceFt(ft);
      setDistance(bucketForFeet(ft));
    }
  };

  // Live values the draw loop reads without re-subscribing.
  const live = useRef({ phase, target, attempt, countdown: 0, recStart: 0, maxMotion: 0 });
  live.current.phase = phase;
  live.current.target = target;
  live.current.attempt = attempt;

  // ---- camera -------------------------------------------------------------
  useEffect(() => {
    if (!camOn) return;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamError('This browser cannot use the camera. Open the app in Safari or Chrome on your phone.');
        return;
      }
      const video = { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        } catch (e) {
          setCamError(
            (e as Error)?.name === 'NotAllowedError'
              ? 'Camera access was blocked. Allow camera access for this site in your browser settings, then reload.'
              : 'No camera was found on this device.',
          );
          return;
        }
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play().catch(() => {});
      setReady(true);
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setReady(false);
      recRef.current?.state === 'recording' && recRef.current.stop();
    };
  }, [camOn]);

  // ---- draw loop: camera + burned-in overlay onto the canvas we record ------
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    const v = videoRef.current!;
    const c = canvasRef.current!;
    const ctx = c.getContext('2d')!;
    const draw = () => {
      const vw = v.videoWidth || 1280;
      const vh = v.videoHeight || 720;
      const scale = Math.min(1, 720 / vw);
      const w = Math.round(vw * scale);
      const h = Math.round(vh * scale);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      ctx.drawImage(v, 0, 0, w, h);
      const L = live.current;
      const recording = L.phase === 'recording';
      const elapsed = recording ? performance.now() - L.recStart : 0;
      let hit = false;
      if (recording && L.target) {
        const d = motion.sample(v, vw, vh, L.target, elapsed);
        if (d > L.maxMotion && elapsed > 500) {
          L.maxMotion = d;
          hit = d > 8;
          thumbCanvas.width = 480;
          thumbCanvas.height = Math.round((480 * h) / w);
          thumbCanvas.getContext('2d')!.drawImage(c, 0, 0, thumbCanvas.width, thumbCanvas.height);
        }
      }
      drawOverlay(ctx, w, h, {
        target: L.target,
        code,
        attempt: L.attempt,
        recording,
        elapsedMs: elapsed,
        clock: new Date(),
        countdown: L.phase === 'countdown' ? L.countdown : undefined,
        hit,
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [ready, code, motion, thumbCanvas]);

  // ---- aiming ---------------------------------------------------------------
  const onCanvasTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (phase !== 'aim') return;
    const rect = e.currentTarget.getBoundingClientRect();
    setTarget({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
      r: ringSize,
    });
  };

  useEffect(() => {
    setTarget((t) => (t ? { ...t, r: ringSize } : t));
  }, [ringSize]);

  // ---- record an attempt ------------------------------------------------------
  const startAttempt = () => {
    live.current.countdown = countdownLen;
    setPhase('countdown');
    const tick = () => {
      live.current.countdown -= 1;
      if (live.current.countdown <= 0) beginRecording();
      else window.setTimeout(tick, 1000);
    };
    window.setTimeout(tick, 1000);
  };

  const beginRecording = () => {
    const c = canvasRef.current!;
    const out = c.captureStream(30);
    streamRef.current?.getAudioTracks().forEach((t) => out.addTrack(t));
    const mimeType = pickMimeType();
    const rec = new MediaRecorder(out, mimeType ? { mimeType, videoBitsPerSecond: 1_000_000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const recordedAt = Date.now();
    rec.onstop = () => {
      const durationMs = performance.now() - live.current.recStart;
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'video/webm' });
      const momentMs = target ? motion.peak(durationMs / 2) : durationMs / 2;
      void canvasToBlob(thumbCanvas).then((thumb) => {
        setClip({ blob, url: URL.createObjectURL(blob), durationMs, momentMs, thumb: thumb ?? undefined, recordedAt });
        setPhase('judge');
      });
    };
    motion.reset();
    live.current.maxMotion = 0;
    // default thumbnail: first frame
    thumbCanvas.width = 480;
    thumbCanvas.height = Math.round((480 * c.height) / c.width);
    thumbCanvas.getContext('2d')!.drawImage(c, 0, 0, thumbCanvas.width, thumbCanvas.height);
    recRef.current = rec;
    live.current.recStart = performance.now();
    rec.start(250);
    setPhase('recording');
    window.setTimeout(() => rec.state === 'recording' && rec.stop(), clipLen * 1000);
  };

  const stopEarly = () => {
    if (recRef.current?.state === 'recording') recRef.current.stop();
  };

  const judge = (made: boolean) => {
    if (!clip) return;
    if (made) {
      setPhase('review');
      return;
    }
    setMisses((m) => [...m, clip.blob].slice(-MAX_BLOOPERS));
    URL.revokeObjectURL(clip.url);
    setClip(undefined);
    setAttempt((a) => a + 1);
    setPhase('aim');
  };

  const [postErr, setPostErr] = useState('');
  const post = async () => {
    if (!clip || !lobbyId) return;
    setPosting(true);
    setPostErr('');
    let p;
    try {
      p = await createPost({
      lobbyId,
      kind,
      rootId,
      challengeId,
      title: title || (kind === 'original' ? 'Untitled trick shot' : root?.title ?? ''),
      rules,
      spot,
      distance,
      distanceFt,
      measured: distanceFt !== undefined,
      targetSize,
      video: clip.blob,
      thumb: clip.thumb,
      misses,
      attempts: attempt,
      target,
      momentMs: clip.momentMs,
      durationMs: clip.durationMs,
      verifyCode: code,
      recordedAt: clip.recordedAt,
      });
    } catch (e) {
      setPostErr((e as Error).message);
      setPosting(false);
      return;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    go(`/post/${p.rootId ?? p.id}`);
  };

  // ---- UI -------------------------------------------------------------------
  const heading =
    kind === 'matched' ? 'Match it' : kind === 'upped' ? 'Up it' : challenge ? 'Challenge entry' : 'Called shot';
  const close = () => history.back();

  if (!lobbies.length) {
    return (
      <div className="page">
        <PageTitle>{heading}</PageTitle>
        <p className="muted">Join or create a lobby first so your shot has somewhere to go.</p>
        <button className="btn" onClick={() => go('/')}>
          Go to lobbies
        </button>
      </div>
    );
  }

  if (phase === 'review' && clip) {
    return (
      <div className="page">
        <TopBar back={() => setPhase('judge')} title={`ATTEMPT #${attempt}`} />
        <PageTitle>Nice. It's a make</PageTitle>
        <ClipPlayer src={clip.url} momentMs={clip.momentMs} target={target} />
        <label className="field">
          <span>Moment the ball hit the target ({(clip.momentMs / 1000).toFixed(1)}s)</span>
          <input
            type="range"
            min={0}
            max={Math.round(clip.durationMs)}
            step={50}
            value={Math.round(clip.momentMs)}
            onChange={(e) => setClip({ ...clip, momentMs: Number(e.target.value) })}
          />
          <small className="muted">The app guessed this from motion inside your target ring. Drag to fix it.</small>
        </label>
        <div className="field">
          <span>
            Distance
            {distanceFt !== undefined && <b className="lime"> · 📏 {distanceFt.toFixed(1)} ft measured</b>}
          </span>
          <div className="chips">
            {DISTANCES.map((d) => (
              <button
                key={d.id}
                className={`chip ${distance === d.id ? 'chip-on' : ''}`}
                onClick={() => {
                  setDistance(d.id);
                  setDistanceFt(undefined);
                }}
                title={d.hint}
              >
                {d.label}
              </button>
            ))}
          </div>
          <small className="muted">{DISTANCES.find((d) => d.id === distance)?.hint ?? 'Pick roughly how far you were.'}</small>
        </div>
        <div className="field">
          <span>Target size</span>
          <div className="chips">
            {TARGETS.map((t) => (
              <button key={t.id} className={`chip ${targetSize === t.id ? 'chip-on' : ''}`} onClick={() => setTargetSize(t.id)}>
                {t.label} <span className="muted">· {t.hint}</span>
              </button>
            ))}
          </div>
        </div>
        <DifficultyLine mine={difficulty({ distance, targetSize, rules })} theirs={root ? difficulty(root) : undefined} kind={kind} theirLabel={root ? distanceLabel(root) : undefined} />
        <div className="field">
          <span>Where</span>
          <div className="chips">
            {(['court', 'home'] as const).map((sp) => (
              <button key={sp} className={`chip ${spot === sp ? 'chip-on' : ''}`} onClick={() => setSpot(sp)}>
                <Icon name={sp === 'court' ? 'hoop' : 'home'} /> {sp === 'court' ? 'Court' : 'At home'}
              </button>
            ))}
          </div>
        </div>
        {kind === 'original' && (
          <>
            <label className="field">
              <span>Name your shot</span>
              <input
                value={title}
                maxLength={60}
                placeholder="e.g. Couch-to-hamper double bank"
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <div className="field">
              <span>Rules others must follow</span>
              <div className="chips">
                {RULE_OPTIONS.map((r) => (
                  <button
                    key={r}
                    className={`chip ${rules.includes(r) ? 'chip-on' : ''}`}
                    onClick={() => setRules((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]))}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        {!lobbyParam && !root && lobbies.length > 1 && (
          <label className="field">
            <span>Post to</span>
            <select value={lobbyId} onChange={(e) => setLobbyId(e.target.value)}>
              {lobbies.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {postErr && <p className="error">Couldn't post: {postErr}</p>}
        <div className="verify-box">
          <b>Verified take</b>
          <span><Icon name="check" /> Recorded in the app, one continuous take</span>
          <span><Icon name="check" /> Session code {code} and clock burned into the video</span>
          <span><Icon name="check" /> {attempt} attempt{attempt === 1 ? '' : 's'} logged ({misses.length} blooper clip{misses.length === 1 ? '' : 's'} kept)</span>
          {target && <span><Icon name="check" /> Target called before the shot</span>}
        </div>
        <div className="row">
          <button className="btn grow" disabled={posting || !distance || !targetSize} onClick={post}>
            {posting ? (cloudMode ? 'Uploading…' : 'Posting…') : 'Post to lobby'} <Icon name="upRight" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page recorder">
      {measuring && <ArMeasure onDone={(ft) => endMeasure(ft)} onClose={() => endMeasure()} />}
      <TopBar
        title={heading.toUpperCase()}
        right={
          <button className="icon-btn" onClick={close} aria-label="Close">
            <Icon name="x" size={24} />
          </button>
        }
      />
      {root && (
        <p className="muted small">
          {kind === 'matched' ? 'Do the same shot: ' : 'Do something harder than: '}
          <b>{root.title}</b>
          {root.rules.length > 0 && <> · Rules: {root.rules.join(', ')}</>}
        </p>
      )}
      {challenge && (
        <p className="muted small">
          <b>{challenge.title}</b> · {challenge.description}
        </p>
      )}

      <div className="cam">
        <video ref={videoRef} muted playsInline className="cam-src" />
        <canvas ref={canvasRef} onPointerDown={onCanvasTap} className={phase === 'aim' ? 'aimable' : ''} />
        {!ready && !camError && <div className="cam-msg">Starting camera…</div>}
        {camError && <div className="cam-msg error">{camError}</div>}
        {phase === 'judge' && clip && (
          <div className="cam-judge">
            <ClipPlayer src={clip.url} momentMs={clip.momentMs} target={target} compact />
          </div>
        )}
      </div>

      {(phase === 'aim' || phase === 'countdown' || phase === 'recording') && ready && (
        <div className="attempt-tag">Attempt #{attempt}</div>
      )}
      {phase === 'aim' && ready && (
        <>
          <p className="hint">{target ? 'Target called. Tap again to move it.' : 'Tap your target on the screen to call your shot.'}</p>
          <button className="btn btn-quiet full" onClick={canMeasure ? startMeasure : undefined} disabled={!canMeasure}>
            <Icon name="pin" />{' '}
            {distanceFt !== undefined
              ? `Measured ${distanceFt.toFixed(1)} ft · measure again`
              : canMeasure
                ? 'Measure distance (AR)'
                : 'AR measuring needs an Android phone'}
          </button>
          <div className="settings">
            <label>
              Ring size
              <input type="range" min={0.03} max={0.2} step={0.005} value={ringSize} onChange={(e) => setRingSize(Number(e.target.value))} />
            </label>
            <label>
              Countdown
              <select value={countdownLen} onChange={(e) => setCountdownLen(Number(e.target.value))}>
                {[3, 5, 10, 15].map((n) => (
                  <option key={n} value={n}>
                    {n}s
                  </option>
                ))}
              </select>
            </label>
            <label>
              Clip length
              <select value={clipLen} onChange={(e) => setClipLen(Number(e.target.value))}>
                {[5, 8, 10, 15, 20].map((n) => (
                  <option key={n} value={n}>
                    {n}s
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="rec-controls">
            <span className="small muted center">{misses.length > 0 ? `${misses.length} blooper${misses.length === 1 ? '' : 's'}` : ''}</span>
            <button className="rec-btn" onClick={startAttempt} aria-label={`Record attempt ${attempt}`}>
              <span />
            </button>
            <span />
          </div>
          <p className="rec-label">Tap to record · stops by itself after {clipLen}s</p>
        </>
      )}
      {phase === 'countdown' && <p className="hint big">Get in position…</p>}
      {phase === 'recording' && (
        <div className="rec-controls">
          <span />
          <button className="rec-btn stop" onClick={stopEarly} aria-label="Stop recording">
            <span />
          </button>
          <span />
        </div>
      )}
      {phase === 'judge' && (
        <>
          <p className="hint big">Did it go in?</p>
          <div className="row">
            <button className="btn btn-miss grow" onClick={() => judge(false)}>
              <Icon name="x" /> Missed
            </button>
            <button className="btn grow" onClick={() => judge(true)}>
              <Icon name="target" /> Made it!
            </button>
          </div>
          <p className="muted small center">Misses are saved to your blooper reel and count toward your attempt total.</p>
        </>
      )}
    </div>
  );
}

function DifficultyLine({ mine, theirs, kind, theirLabel }: { mine?: number; theirs?: number; kind: PostKind; theirLabel?: string }) {
  if (mine === undefined) return <p className="small muted">Pick a distance and target size to get a difficulty score.</p>;
  let verdict = '';
  if (theirs !== undefined && kind === 'upped') verdict = mine > theirs ? ' · harder than theirs ✓' : ' · not harder than theirs yet';
  if (theirs !== undefined && kind === 'matched') verdict = mine >= theirs ? ' · at least as hard ✓' : ' · easier than theirs';
  return (
    <div className="difficulty-line">
      <span className="num">{mine}</span>
      <span>
        <b>Difficulty</b>
        {theirs !== undefined && (
          <>
            {' '}
            vs theirs <b>{theirs}</b>
            {theirLabel && <span className="muted"> ({theirLabel})</span>}
          </>
        )}
        <span className="muted">{verdict}</span>
      </span>
    </div>
  );
}
