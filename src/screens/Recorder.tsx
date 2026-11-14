import { useEffect, useMemo, useRef, useState } from 'react';
import { canvasToBlob, drawCover, drawOverlay, LandingSound, pickMimeType, TargetMotion } from '../capture';
import { ArMeasure, arMeasureSupported } from '../components/ArMeasure';
import { ClipPlayer } from '../components/ClipPlayer';
import { Icon } from '../components/Icon';
import { PageTitle, TopBar } from '../components/ui';
import { bucketForFeet, difficulty, distanceInfo, DISTANCES, distanceLabel, targetInfo, TARGETS } from '../difficulty';
import { loadPrefs, savePrefs } from '../prefs';
import { go } from '../router';
import { champion, cloudMode, createPost, myLobbies, randomCode, useAppState } from '../store';
import { RULE_OPTIONS, type DistanceBucket, type PostKind, type Spot, type Target, type TargetSize } from '../types';

interface Props {
  lobbyId?: string;
  rootId?: string;
  /** Optional: force Match or Up. Otherwise replies are decided by difficulty. */
  kind?: PostKind;
  challengeId?: string;
}

type Phase = 'aim' | 'countdown' | 'recording' | 'judge' | 'review';
type Facing = 'environment' | 'user';

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
const MAX_W = 720;
const STOP_AFTER_LANDING_MS = 2000;

const TARGET_NOUN: Record<TargetSize, string> = { small: 'cup', medium: 'bin', big: 'basket' };

export function Recorder({ lobbyId: lobbyParam, rootId, kind: forcedKind, challengeId }: Props) {
  const s = useAppState();
  const prefs = useMemo(loadPrefs, []);
  const lobbies = myLobbies(s);
  const root = rootId ? s.posts[rootId] : undefined;
  const challenge = challengeId ? s.challenges[challengeId] : undefined;
  const isReply = !!root;
  // What a reply is measured against: whoever holds the crown right now.
  const against = root ? champion(s, root.id) ?? root : undefined;

  const defaultLobby =
    lobbyParam ??
    root?.lobbyId ??
    challenge?.lobbyId ??
    (prefs.lobbyId && lobbies.some((l) => l.id === prefs.lobbyId) ? prefs.lobbyId : lobbies[0]?.id) ??
    '';
  const [lobbyId, setLobbyId] = useState(defaultLobby);

  const videoRef = useRef<HTMLVideoElement>(null);
  const viewRef = useRef<HTMLCanvasElement>(null);
  const recCanvas = useMemo(() => document.createElement('canvas'), []);
  const frameCanvas = useMemo(() => document.createElement('canvas'), []);
  const thumbCanvas = useMemo(() => document.createElement('canvas'), []);
  const videoStream = useRef<MediaStream | null>(null);
  const audioStream = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const motion = useMemo(() => new TargetMotion(), []);
  const landing = useMemo(() => new LandingSound(), []);

  const [camError, setCamError] = useState<string>();
  const [ready, setReady] = useState(false);
  const [camOn, setCamOn] = useState(true);
  const [facing, setFacing] = useState<Facing>('environment');
  const [switching, setSwitching] = useState(false);
  const [phase, setPhase] = useState<Phase>('aim');
  const [target, setTarget] = useState<Target | undefined>();
  const [ringSize, setRingSize] = useState(prefs.ring);
  const [clipLen, setClipLen] = useState(prefs.clipLen);
  const [countdownLen, setCountdownLen] = useState(prefs.countdown);
  const [autoStop, setAutoStop] = useState(prefs.autoStop);
  const [showSettings, setShowSettings] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [stopping, setStopping] = useState(false);
  const [code] = useState(() => randomCode());
  const [attempt, setAttempt] = useState(1);
  const [misses, setMisses] = useState<Blob[]>([]);
  const [clip, setClip] = useState<Clip>();

  // Post details, pre-filled so posting is one tap.
  const [title, setTitle] = useState('');
  const [rules, setRules] = useState<string[]>(root?.rules ?? challenge?.rules ?? []);
  const [spot, setSpot] = useState<Spot>(root?.spot ?? prefs.spot);
  const [distance, setDistance] = useState<DistanceBucket>(root?.distance ?? prefs.distance ?? 'short');
  const [distanceFt, setDistanceFt] = useState<number>();
  const [targetSize, setTargetSize] = useState<TargetSize>(root?.targetSize ?? prefs.targetSize ?? 'small');
  const [kindChoice, setKindChoice] = useState<PostKind | undefined>(forcedKind && forcedKind !== 'original' ? forcedKind : undefined);
  const [editing, setEditing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postErr, setPostErr] = useState('');

  const [canMeasure, setCanMeasure] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  useEffect(() => {
    void arMeasureSupported().then(setCanMeasure);
  }, []);

  // Live values the draw loop reads every frame.
  const live = useRef({
    phase,
    target,
    attempt,
    facing,
    switching: false,
    autoStop,
    countdown: 0,
    recStart: 0,
    maxMotion: 0,
    lastFlip: 0,
    stopAt: 0,
    ignoreUntil: 0,
    size: null as null | { w: number; h: number },
  });
  Object.assign(live.current, { phase, target, attempt, facing, autoStop });

  // ---- camera ---------------------------------------------------------------
  const openVideo = (f: Facing) =>
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: f }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });

  useEffect(() => {
    if (!camOn) return;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamError('This browser cannot use the camera. Open the app in Chrome or Safari on your phone.');
        return;
      }
      let vs: MediaStream;
      try {
        vs = await openVideo(live.current.facing);
      } catch (e) {
        setCamError(
          (e as Error)?.name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow camera access for this site in your browser settings, then reload.'
            : 'No camera was found on this device.',
        );
        return;
      }
      // The microphone has its own stream so flipping cameras never cuts the sound.
      if (!audioStream.current) {
        audioStream.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }).catch(() => null);
      }
      if (cancelled) {
        vs.getTracks().forEach((t) => t.stop());
        return;
      }
      videoStream.current = vs;
      const v = videoRef.current!;
      v.srcObject = vs;
      await v.play().catch(() => {});
      setReady(true);
    })();
    return () => {
      cancelled = true;
      videoStream.current?.getTracks().forEach((t) => t.stop());
      videoStream.current = null;
      setReady(false);
    };
  }, [camOn]);

  // Stop everything when leaving the screen.
  useEffect(
    () => () => {
      if (recRef.current?.state === 'recording') recRef.current.stop();
      audioStream.current?.getTracks().forEach((t) => t.stop());
      landing.stop();
    },
    [landing],
  );

  /** Switch front/back camera. Works mid-recording: the picture freezes briefly, the take continues. */
  const flip = async () => {
    if (live.current.switching || !ready) return;
    const next: Facing = facing === 'environment' ? 'user' : 'environment';
    live.current.switching = true;
    live.current.lastFlip = performance.now();
    setSwitching(true);
    // Many phones can't open both cameras at once, so release this one first.
    videoStream.current?.getTracks().forEach((t) => t.stop());
    let vs: MediaStream;
    try {
      vs = await openVideo(next);
    } catch {
      vs = await openVideo(facing);
      live.current.switching = false;
      setSwitching(false);
      videoStream.current = vs;
      videoRef.current!.srcObject = vs;
      await videoRef.current!.play().catch(() => {});
      return;
    }
    videoStream.current = vs;
    const v = videoRef.current!;
    v.srcObject = vs;
    await v.play().catch(() => {});
    live.current.facing = next;
    setFacing(next);
    live.current.switching = false;
    live.current.lastFlip = performance.now();
    setSwitching(false);
  };

  // ---- draw loop ------------------------------------------------------------
  // frameCanvas: latest camera frame (frozen while switching cameras)
  // recCanvas:   frame + verification overlay, this is what gets recorded
  // view canvas: what you see (mirrored like a normal selfie camera on the front camera)
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    const v = videoRef.current!;
    const view = viewRef.current!;
    const vctx = view.getContext('2d')!;
    const rctx = recCanvas.getContext('2d')!;
    const fctx = frameCanvas.getContext('2d')!;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const L = live.current;
      if (!L.size && v.videoWidth) {
        const scale = Math.min(1, MAX_W / v.videoWidth);
        L.size = { w: Math.round(v.videoWidth * scale), h: Math.round(v.videoHeight * scale) };
        for (const c of [recCanvas, frameCanvas, view]) {
          c.width = L.size.w;
          c.height = L.size.h;
        }
      }
      if (!L.size) return;
      const { w, h } = L.size;
      const fresh = !L.switching && v.readyState >= 2 && v.videoWidth > 0;
      if (fresh) drawCover(fctx, v, v.videoWidth, v.videoHeight, w, h);

      const now = performance.now();
      const recording = L.phase === 'recording';
      const elapsed = recording ? now - L.recStart : 0;
      const back = L.facing === 'environment';
      let hit = false;

      if (recording && back && fresh && L.target) {
        const d = motion.sample(frameCanvas, w, h, L.target, elapsed);
        if (d > L.maxMotion && elapsed > 500) {
          L.maxMotion = d;
          hit = d > 8;
          thumbCanvas.width = 480;
          thumbCanvas.height = Math.round((480 * h) / w);
          thumbCanvas.getContext('2d')!.drawImage(frameCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
        }
        if (d > 14 && elapsed > 800) landed(now);
      }
      if (recording && back && elapsed > 1200 && now - L.lastFlip > 1500 && landing.spike()) landed(now);
      if (recording && L.stopAt && now >= L.stopAt) {
        L.stopAt = 0;
        stopRecording();
      }

      const overlay = {
        target: back ? L.target : undefined,
        code,
        attempt: L.attempt,
        recording,
        elapsedMs: elapsed,
        clock: new Date(),
        countdown: L.phase === 'countdown' ? L.countdown : undefined,
        hit,
      };
      rctx.drawImage(frameCanvas, 0, 0);
      drawOverlay(rctx, w, h, overlay);
      if (back) {
        vctx.drawImage(recCanvas, 0, 0);
      } else {
        drawCover(vctx, frameCanvas, w, h, w, h, true);
        drawOverlay(vctx, w, h, overlay);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  /** A landing was detected: stop shortly after, unless the shooter taps "keep going". */
  function landed(now: number) {
    const L = live.current;
    if (!L.autoStop || L.stopAt || now < L.ignoreUntil) return;
    L.stopAt = now + STOP_AFTER_LANDING_MS;
    setStopping(true);
  }

  const keepGoing = () => {
    live.current.stopAt = 0;
    live.current.ignoreUntil = performance.now() + 1500;
    setStopping(false);
  };

  // ---- aiming ---------------------------------------------------------------
  const lastTap = useRef(0);
  const onViewTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const now = performance.now();
    const double = now - lastTap.current < 300;
    lastTap.current = now;
    if (phase === 'recording' || phase === 'countdown') {
      if (double) void flip(); // double-tap flips camera mid-take
      return;
    }
    if (phase !== 'aim' || facing !== 'environment') return;
    const rect = e.currentTarget.getBoundingClientRect();
    setTarget({ x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height, r: ringSize });
  };

  useEffect(() => {
    setTarget((t) => (t ? { ...t, r: ringSize } : t));
  }, [ringSize]);

  useEffect(() => {
    savePrefs({ ring: ringSize, clipLen, countdown: countdownLen, autoStop });
  }, [ringSize, clipLen, countdownLen, autoStop]);

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

  // ---- recording ------------------------------------------------------------
  const startAttempt = () => {
    live.current.countdown = countdownLen;
    setPhase('countdown');
    // Audio analysis needs a tap to start on phones, so set it up here.
    if (audioStream.current && autoStop) landing.start(audioStream.current);
    const tick = () => {
      live.current.countdown -= 1;
      if (live.current.countdown <= 0) beginRecording();
      else window.setTimeout(tick, 1000);
    };
    window.setTimeout(tick, 1000);
  };

  const beginRecording = () => {
    const out = recCanvas.captureStream(30);
    audioStream.current?.getAudioTracks().forEach((t) => out.addTrack(t));
    const mimeType = pickMimeType();
    const rec = new MediaRecorder(out, mimeType ? { mimeType, videoBitsPerSecond: 1_000_000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const recordedAt = Date.now();
    rec.onstop = () => {
      landing.stop();
      setStopping(false);
      const durationMs = performance.now() - live.current.recStart;
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'video/webm' });
      const momentMs = live.current.target ? motion.peak(durationMs / 2) : durationMs / 2;
      void canvasToBlob(thumbCanvas).then((thumb) => {
        setClip({ blob, url: URL.createObjectURL(blob), durationMs, momentMs, thumb: thumb ?? undefined, recordedAt });
        setPhase('judge');
      });
    };
    motion.reset();
    Object.assign(live.current, { maxMotion: 0, stopAt: 0, ignoreUntil: 0 });
    thumbCanvas.width = 480;
    thumbCanvas.height = Math.round((480 * recCanvas.height) / recCanvas.width);
    thumbCanvas.getContext('2d')!.drawImage(frameCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    recRef.current = rec;
    live.current.recStart = performance.now();
    rec.start(250);
    setPhase('recording');
    window.setTimeout(() => rec.state === 'recording' && rec.stop(), clipLen * 1000);
  };

  function stopRecording() {
    if (recRef.current?.state === 'recording') recRef.current.stop();
  }

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

  // ---- posting --------------------------------------------------------------
  const myDifficulty = difficulty({ distance, targetSize, rules }) ?? 0;
  const theirDifficulty = against ? difficulty(against) : undefined;
  const autoKind: PostKind = !isReply
    ? 'original'
    : theirDifficulty !== undefined && myDifficulty > theirDifficulty
      ? 'upped'
      : 'matched';
  const postKind: PostKind = isReply ? kindChoice ?? autoKind : 'original';
  const autoTitle = `${distanceFt !== undefined ? `${distanceFt.toFixed(1)} ft` : distanceInfo(distance)?.label ?? ''} ${TARGET_NOUN[targetSize]} shot`.trim();
  const lobbyName = s.lobbies[lobbyId]?.name;

  const post = async () => {
    if (!clip || !lobbyId) return;
    setPosting(true);
    setPostErr('');
    let p;
    try {
      p = await createPost({
        lobbyId,
        kind: postKind,
        rootId,
        challengeId,
        title: isReply ? root!.title : title.trim() || autoTitle.charAt(0).toUpperCase() + autoTitle.slice(1),
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
    savePrefs({ lobbyId, distance, targetSize, spot });
    videoStream.current?.getTracks().forEach((t) => t.stop());
    go(`/post/${p.rootId ?? p.id}`);
  };

  const toggleRule = (r: string) => {
    if (root?.rules.includes(r)) return; // their rules are required
    setRules((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));
  };

  // ---- UI -------------------------------------------------------------------
  if (!lobbies.length) {
    return (
      <div className="page">
        <PageTitle>Join a lobby first</PageTitle>
        <p className="muted">Your shot needs somewhere to go. Create a lobby or join one with a code.</p>
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

        <div className="card post-summary">
          {isReply && (
            <div className="row wrap">
              <span className={`pill ${postKind === 'upped' ? 'pill-solid' : 'pill-lime'}`}>
                {postKind === 'upped' ? 'Posting as: UP IT' : 'Posting as: MATCH'}
              </span>
              <button className="link small" onClick={() => setKindChoice(postKind === 'upped' ? 'matched' : 'upped')}>
                Post as {postKind === 'upped' ? 'a match' : 'up it'} instead
              </button>
            </div>
          )}
          {!isReply && <div className="title">{title.trim() || autoTitle.charAt(0).toUpperCase() + autoTitle.slice(1)}</div>}
          <div className="pills">
            <span className={`pill ${distanceFt !== undefined ? 'pill-lime' : ''}`}>
              <Icon name="pin" /> {distanceLabel({ distance, distanceFt, measured: distanceFt !== undefined })}
            </span>
            <span className="pill">{targetInfo(targetSize)?.label} target</span>
            <span className="pill pill-orange">{spot === 'court' ? 'Court' : 'At home'}</span>
            {rules.map((r) => (
              <span key={r} className="pill pill-orange">
                {r}
              </span>
            ))}
          </div>
          <div className="difficulty-line">
            <span className="num">{myDifficulty}</span>
            <span>
              <b>Difficulty</b>
              {theirDifficulty !== undefined && (
                <>
                  {' '}
                  vs <b>{theirDifficulty}</b> <span className="muted">({s.users[against!.authorId]?.name})</span>
                </>
              )}
            </span>
          </div>
          <div className="small muted">
            to <b>{lobbyName}</b> · ✓ in-app take · code {code} · {attempt} attempt{attempt === 1 ? '' : 's'}
          </div>
          <button className="link small" onClick={() => setEditing((e) => !e)}>
            {editing ? 'Hide details' : 'Edit details'}
          </button>
        </div>

        {editing && (
          <div className="card form-card">
            {!isReply && (
              <label className="field">
                <span>Name</span>
                <input value={title} maxLength={60} placeholder={autoTitle} onChange={(e) => setTitle(e.target.value)} />
              </label>
            )}
            <div className="field">
              <span>Distance</span>
              <div className="chips">
                {DISTANCES.map((d) => (
                  <button
                    key={d.id}
                    className={`chip ${distance === d.id ? 'chip-on' : ''}`}
                    onClick={() => {
                      setDistance(d.id);
                      setDistanceFt(undefined);
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <small className="muted">{distanceInfo(distance)?.hint}</small>
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
            <div className="field">
              <span>{isReply ? 'Extras (their rules are locked in)' : 'Extras others must follow'}</span>
              <div className="chips">
                {RULE_OPTIONS.map((r) => (
                  <button key={r} className={`chip ${rules.includes(r) ? 'chip-on' : ''}`} onClick={() => toggleRule(r)}>
                    {root?.rules.includes(r) && '🔒 '}
                    {r}
                  </button>
                ))}
              </div>
            </div>
            {!isReply && !challenge?.lobbyId && lobbies.length > 1 && (
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
            <label className="field">
              <span>Moment it landed ({(clip.momentMs / 1000).toFixed(1)}s)</span>
              <input
                type="range"
                min={0}
                max={Math.round(clip.durationMs)}
                step={50}
                value={Math.round(clip.momentMs)}
                onChange={(e) => setClip({ ...clip, momentMs: Number(e.target.value) })}
              />
            </label>
          </div>
        )}

        {postErr && <p className="error">Couldn't post: {postErr}</p>}
        <button className="btn btn-big full" disabled={posting} onClick={post}>
          {posting ? (cloudMode ? 'Uploading…' : 'Posting…') : 'Post'} <Icon name="upRight" />
        </button>
      </div>
    );
  }

  const recordingish = phase === 'countdown' || phase === 'recording';
  return (
    <div className="page recorder">
      {measuring && <ArMeasure onDone={(ft) => endMeasure(ft)} onClose={() => endMeasure()} />}
      <TopBar
        title={root ? 'TRY IT' : challenge ? 'CHALLENGE' : 'CALLED SHOT'}
        right={
          <button className="icon-btn" onClick={() => history.back()} aria-label="Close">
            <Icon name="x" size={24} />
          </button>
        }
      />

      {root && phase === 'aim' && (
        <div className="rules-card">
          <div className="small muted">
            Beat <b>{s.users[against!.authorId]?.name}</b>'s shot · difficulty {theirDifficulty ?? '?'}
          </div>
          <div className="pills">
            {distanceLabel(against!) && <span className="pill">{distanceLabel(against!)}</span>}
            {targetInfo(against!.targetSize) && <span className="pill">{targetInfo(against!.targetSize)!.label} target</span>}
            {root.rules.map((r) => (
              <span key={r} className="pill pill-orange">
                {r}
              </span>
            ))}
            <span className="pill">Any object</span>
          </div>
        </div>
      )}
      {challenge && phase === 'aim' && (
        <div className="rules-card">
          <b>{challenge.title}</b>
          <div className="small muted">{challenge.description}</div>
        </div>
      )}

      <div className="cam">
        <video ref={videoRef} muted playsInline className="cam-src" />
        <canvas ref={viewRef} onPointerDown={onViewTap} className={phase === 'aim' && facing === 'environment' ? 'aimable' : ''} />
        {!ready && !camError && !measuring && <div className="cam-msg">Starting camera…</div>}
        {camError && <div className="cam-msg error">{camError}</div>}
        {switching && <div className="cam-flash">Switching camera…</div>}
        {ready && phase !== 'judge' && (
          <button className="cam-flip" onClick={() => void flip()} aria-label="Flip camera" disabled={switching}>
            ⇄
          </button>
        )}
        {root && against && phase === 'aim' && showPreview && (
          <div className="cam-pip" onClick={() => setShowPreview(false)} title="Tap to hide">
            <ClipPlayer blobId={against.videoId} momentMs={against.momentMs} target={against.target} compact stampText="" />
          </div>
        )}
        {stopping && phase === 'recording' && (
          <button className="cam-stopping" onClick={keepGoing}>
            Landed! Stopping… <u>Keep going</u>
          </button>
        )}
        {phase === 'judge' && clip && (
          <div className="cam-judge">
            <ClipPlayer src={clip.url} momentMs={clip.momentMs} target={target} compact />
          </div>
        )}
      </div>

      {phase === 'aim' && ready && (
        <>
          <p className="hint">
            {facing === 'user'
              ? 'Selfie camera: say hi, then flip ⇄ to the shot. You can flip while recording too.'
              : target
                ? 'Target called. Tap to move it.'
                : 'Tap your target to call your shot.'}
          </p>
          <div className="rec-controls">
            <button className="icon-btn ctl" onClick={() => setShowSettings((v) => !v)} aria-label="Settings">
              ⚙️
            </button>
            <button className="rec-btn" onClick={startAttempt} aria-label={`Record attempt ${attempt}`}>
              <span />
            </button>
            {canMeasure ? (
              <button className="icon-btn ctl" onClick={startMeasure} aria-label="Measure distance">
                📏
              </button>
            ) : (
              <span />
            )}
          </div>
          <p className="rec-label">
            Attempt #{attempt}
            {misses.length > 0 && ` · ${misses.length} blooper${misses.length === 1 ? '' : 's'}`}
            {distanceFt !== undefined && ` · 📏 ${distanceFt.toFixed(1)} ft`}
          </p>
          {showSettings && (
            <div className="card settings-card">
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
                Longest clip
                <select value={clipLen} onChange={(e) => setClipLen(Number(e.target.value))}>
                  {[5, 10, 15, 20, 30].map((n) => (
                    <option key={n} value={n}>
                      {n}s
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ring size
                <input type="range" min={0.03} max={0.2} step={0.005} value={ringSize} onChange={(e) => setRingSize(Number(e.target.value))} />
              </label>
              <label className="check">
                <input type="checkbox" checked={autoStop} onChange={(e) => setAutoStop(e.target.checked)} />
                Stop automatically when it lands
              </label>
              {!canMeasure && <p className="small muted">📏 AR distance measuring works on Android phones.</p>}
            </div>
          )}
        </>
      )}
      {phase === 'countdown' && <p className="hint big">Get set…</p>}
      {recordingish && (
        <>
          <div className="rec-controls">
            <span />
            {phase === 'recording' ? (
              <button className="rec-btn stop" onClick={stopRecording} aria-label="Stop recording">
                <span />
              </button>
            ) : (
              <span />
            )}
            <button className="icon-btn ctl" onClick={() => void flip()} aria-label="Flip camera" disabled={switching}>
              ⇄
            </button>
          </div>
          <p className="rec-label">
            {autoStop ? 'Stops by itself after it lands' : `Stops after ${clipLen}s`} · double-tap to flip camera
          </p>
        </>
      )}
      {phase === 'judge' && (
        <>
          <p className="hint big">Did it go in?</p>
          <div className="row">
            <button className="btn btn-miss btn-big grow" onClick={() => judge(false)}>
              <Icon name="x" /> Missed
            </button>
            <button className="btn btn-big grow" onClick={() => judge(true)}>
              <Icon name="target" /> Made it!
            </button>
          </div>
          <p className="muted small center">Missed goes straight back to the camera. Your attempts keep counting.</p>
        </>
      )}
    </div>
  );
}
