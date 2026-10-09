// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's bird (docs/ASSISTANT-CHARACTER.md), in the app: the same
// drawing, poses and motion as the shell's (AssistantBird.qml), from the
// same source (art/assistant-bird/bird.json, through birdData.ts and
// bird.generated.css). SVG paths; pose changes are CSS transitions, the
// flames' flicker, the breath, the extras, the hop and the speaking beak
// are the generated keyframes; blinks come at random times. Moves (the
// entrance, the idle pool, the reactions: motion.moves) are the generated
// ab-mv-* keyframes on a group of their own over each part's acting, their
// cues (a face for a moment, an effect) timed here; the effects (embers,
// the fireball, dust) the generated ab-fx-* keyframes over SVG shapes.
// Its magic (magic): the aura breathing behind it, flickering with its
// crest and radiating rings (ab-aura-*), the sparks and motes around it
// (ab-spark-<lane>-<n>) and now and then a mist (ab-mist-<n>), each lane
// started at a random point (--ab-phase).
//
// Follows the system's Animation speed (Fast: 60% of the time) and Reduce
// motion, and the browser's prefers-reduced-motion: with either it holds
// each pose still.

import { Component, createRef, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { accessibility, system } from "@phoenix/luna";
import { BIRD, type BirdPose } from "./birdData";
import "./bird.generated.css";

type PartName = keyof typeof BIRD.parts;
type Pivot = readonly [number, number];

/** The system's Animation speed and Reduce motion, and the browser's reduced motion. */
export function useBirdMotion(): { speed: number; still: boolean } {
    const [speed, setSpeed] = useState(1);
    const [reduce, setReduce] = useState(false);
    const [prefers, setPrefers] = useState(() => matchReduced());
    useEffect(() => {
        const subs = [
            system.watchPreferences(["animationSpeed"], (p) => setSpeed(p.animationSpeed === "fast" ? 0.6 : 1), () => undefined),
            accessibility.watch((a) => setReduce(!!a.reduceMotion), () => undefined),
        ];
        const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
        const onChange = () => setPrefers(!!mq?.matches);
        mq?.addEventListener?.("change", onChange);
        return () => { subs.forEach((s) => s.cancel()); mq?.removeEventListener?.("change", onChange); };
    }, []);
    return { speed, still: reduce || prefers };
}

function matchReduced(): boolean {
    try { return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

const about = ([x, y]: Pivot, t: string) => `translate(${x}px, ${y}px) ${t} translate(${-x}px, ${-y}px)`;

function Part({ name, style, className }: { name: PartName; style?: CSSProperties; className?: string }) {
    const p = BIRD.parts[name] as { d: string; fill?: keyof typeof BIRD.colors; stroke?: keyof typeof BIRD.colors; width?: number; opacity?: number };
    return (
        <path d={p.d} className={className} style={style}
              fill={p.fill ? BIRD.colors[p.fill] : "none"}
              stroke={p.stroke ? BIRD.colors[p.stroke] : undefined}
              strokeWidth={p.stroke ? p.width : undefined}
              strokeLinecap={p.stroke ? "round" : undefined} strokeLinejoin={p.stroke ? "round" : undefined}
              opacity={p.opacity} />
    );
}

type Channel = keyof typeof BIRD.motion.acting.channels;
interface Acting { period: number; every?: readonly number[]; tracks: Partial<Record<Channel, unknown>> }
const ACTING = BIRD.motion.acting.poses as unknown as Partial<Record<BirdPose, Acting>>;

export type MoveName = keyof typeof BIRD.motion.moves;
interface Cue { at: number; eyes?: string; beak?: string; fx?: string }
interface Move { kind: "enter" | "leave" | "idle" | "react"; period: number; tracks: Partial<Record<Channel, unknown>>; cues: readonly Cue[] }
const MOVES = BIRD.motion.moves as unknown as Record<MoveName, Move>;
type FxName = keyof typeof BIRD.effects;
interface Effect { kind: "swirl" | "glow" | "puff" | "burst" | "surge"; origin: readonly number[]; period: number; radius?: number; particles?: readonly (readonly (number | string)[])[] }
const EFFECTS = BIRD.effects as unknown as Record<FxName, Effect>;

const MAGIC = BIRD.magic as unknown as {
    aura: { origin: readonly number[]; radius: number; color: keyof typeof BIRD.colors; alpha: number; still: number; ease: number;
            rings: { count: number; radius: number; inner: number; alpha: number } };
    poses: Record<string, readonly number[]>;
    sparkLanes: readonly { period: number; sparks: readonly (readonly (number | string)[])[] }[];
    mistLane: { period: number; mists: readonly (readonly number[])[] };
    mist: { color: keyof typeof BIRD.colors; alpha: number };
};
const behind = (k: Effect["kind"]) => k === "glow" || k === "surge";

/** A spark (magic.sparkLanes: [gap, life, x, y, size, colour, drift, rise, glint, spin]),
 *  drawn about its centre: a four-pointed glint or a mote, with its halo. */
function SparkView({ s }: { s: readonly (number | string)[] }) {
    const size = Number(s[4]), tint = BIRD.colors[s[5] as keyof typeof BIRD.colors], glint = s[8] === 1;
    return (<>
        <circle r={size * (glint ? 1.5 : 1.3)} fill={tint} opacity={0.26} />
        {glint && <rect x={-size * 1.7} y={-size * 0.275} width={size * 3.4} height={size * 0.55} rx={size * 0.275} fill={tint} />}
        {glint && <rect x={-size * 0.275} y={-size * 1.7} width={size * 0.55} height={size * 3.4} rx={size * 0.275} fill={tint} />}
        <circle r={size * (glint ? 0.45 : 0.5)} fill={glint ? BIRD.colors.flameCore : tint} />
        <circle r={size * (glint ? 0.2 : 0.22)} fill={BIRD.colors.flameCore} />
    </>);
}

/** A move playing: its name and a key (a new one for each time it plays). */
interface Playing { name: MoveName; key: number }

interface ActProps { pose: BirdPose; channel: Channel; calm: boolean; speed: number; fidget: boolean; move: Playing | null; children: ReactNode }

/** A part's acting: the pose's loop for `channel` (the class of its generated
 *  keyframes), on top of the pose's values. Each loop starts and ends at
 *  rest; when the pose changes, the outer group takes over where the part
 *  was (its transform as drawn just then) and eases back to none over
 *  motion.acting.lead, so the new loop never jumps. A class component for
 *  getSnapshotBeforeUpdate: the old loop's transform is read before the
 *  class changes. Styles are set through the CSSOM (the CSP allows that). */
class Act extends Component<ActProps> {
    private outer = createRef<SVGGElement>();
    private mover = createRef<SVGGElement>();
    private inner = createRef<SVGGElement>();

    static className(p: ActProps): string | undefined {
        const a = ACTING[p.pose];
        if (p.calm || !a || !(p.channel in a.tracks) || (a.every && !p.fidget)) return undefined;
        return `ab-act-${p.pose}-${p.channel}`;
    }

    /** The move's class for this part, if it moves it. */
    static moveClass(p: ActProps): string | undefined {
        if (p.calm || !p.move || !(p.channel in MOVES[p.move.name].tracks)) return undefined;
        return `ab-mv-${p.move.name}-${p.channel}`;
    }

    getSnapshotBeforeUpdate(prev: ActProps): string | null {
        if (this.props.calm) return null;
        const loopChanged = Act.className(prev) !== Act.className(this.props);
        // A move ending early (an idle one, as the pose changes) blends away too; one
        // ending as it should is at rest.
        const moveChanged = Act.moveClass(prev) !== Act.moveClass(this.props) || prev.move?.key !== this.props.move?.key;
        if (!loopChanged && !moveChanged) return null;
        const o = this.outer.current, m = this.mover.current, i = this.inner.current;
        if (!o || !m || !i) return null;
        const t = (el: Element) => { const v = getComputedStyle(el).transform; return v && v !== "none" ? v : ""; };
        const all = [t(o), t(m), t(i)].filter(Boolean);
        if (all.length === 0) return null;
        if (all.length === 1 || typeof DOMMatrix === "undefined") return all[0];
        return all.reduce((a, b) => new DOMMatrix(a).multiply(new DOMMatrix(b)).toString());
    }

    componentDidUpdate(prev: ActProps, _state: unknown, snapshot: string | null) {
        // The same move again: its animation from the start.
        const m = this.mover.current, cls = Act.moveClass(this.props);
        if (m && cls && prev.move && this.props.move && prev.move.key !== this.props.move.key && Act.moveClass(prev) === cls) {
            m.setAttribute("class", "");
            m.getBoundingClientRect();
            m.setAttribute("class", cls);
        }
        const o = this.outer.current;
        if (!o || !snapshot) return;
        o.style.transition = "none";
        o.style.transform = snapshot;
        o.getBoundingClientRect();    // the start, drawn before the ease begins
        o.style.transition = `transform ${Math.round(BIRD.motion.acting.lead * this.props.speed)}ms cubic-bezier(0.33, 1, 0.68, 1)`;
        o.style.transform = "";
    }

    render() {
        return (
            <g ref={this.outer} data-act={this.props.channel}>
                <g ref={this.mover} className={Act.moveClass(this.props)} data-mover={this.props.channel}>
                    <g ref={this.inner} className={Act.className(this.props)}>{this.props.children}</g>
                </g>
            </g>
        );
    }
}

export interface BirdProps {
    pose: BirdPose;
    /** Its width in CSS pixels (its height is 1.1 times that). */
    size?: number;
    className?: string;
    testId?: string;
    /** Overrides for tests and reviews: else the system's settings. */
    speed?: number;
    still?: boolean;
    /** A move to play as it appears (the entrance: "enter"; a cheer as a request is sent). */
    start?: MoveName;
    /** A reaction to play: a new n plays it (once at a time; not while it enters). */
    react?: { name: MoveName; n: number } | null;
    /** Where it looks, x and y from -1 to 1 (the words typed, a scroll). */
    gaze?: readonly [number, number];
    /** Plays the idle pool now and then (off while the user types). */
    fidgety?: boolean;
    onClick?: () => void;
}

/** How long a move takes at a speed (0 held still). */
export function moveMs(name: MoveName, speed: number, still: boolean): number {
    return still ? 0 : Math.round(MOVES[name].period * speed);
}

export function Bird({ pose, size = 120, className, testId = "as-bird", speed, still, start, react, gaze, fidgety = true, onClick }: BirdProps) {
    const motion = useBirdMotion();
    const k = speed ?? motion.speed;
    const calm = still ?? motion.still;
    const p = BIRD.poses[pose] ?? BIRD.poses.idle;

    // ---- Moves: the one playing, its face for a moment, the effects it plays ----
    // The move to play as it appears is there from the first paint (an
    // entrance would else show the bird at rest for a frame); its cues are
    // timed as it mounts (below).
    const [move, setMove] = useState<Playing | null>(() => (start && !(still ?? matchReduced()) ? { name: start, key: 0 } : null));
    const [face, setFace] = useState<{ eyes?: string; beak?: string }>({});
    const [fx, setFx] = useState<{ name: FxName; key: number }[]>([]);
    const serial = useRef(0);
    const timers = useRef<number[]>([]);
    const moveRef = useRef<Playing | null>(null);
    moveRef.current = move;
    const clearTimers = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };
    const play = useCallback((name: MoveName, mounting = false): boolean => {
        const m = MOVES[name];
        if (calm || !m) return false;
        clearTimers();
        // As it mounts, the move already drawn goes on (only its cues to time).
        const cur = moveRef.current;
        const key = mounting && cur && cur.name === name ? cur.key : ++serial.current;
        if (key !== cur?.key) setMove({ name, key });
        setFace({});
        const later = (ms: number, f: () => void) => { timers.current.push(window.setTimeout(f, ms * k)); };
        for (const c of m.cues) {
            later(c.at * m.period, () => {
                if (c.eyes !== undefined || c.beak !== undefined)
                    setFace((f) => ({ eyes: c.eyes !== undefined ? c.eyes : f.eyes, beak: c.beak !== undefined ? c.beak : f.beak }));
                if (c.fx) {
                    const e = { name: c.fx as FxName, key: ++serial.current };
                    setFx((list) => [...list, e]);
                    window.setTimeout(() => setFx((list) => list.filter((x) => x !== e)), (EFFECTS[e.name].period + 50) * k);
                }
            });
        }
        later(m.period, () => { setMove((cur) => (cur && cur.key === key ? null : cur)); setFace({}); });
        return true;
    }, [calm, k]);
    useEffect(() => () => clearTimers(), []);
    // Held still: none.
    useEffect(() => { if (calm) { clearTimers(); setMove(null); setFace({}); setFx([]); } }, [calm]);
    // The move to play as it appears.
    useEffect(() => { if (start) play(start, true); }, []);    // eslint-disable-line react-hooks/exhaustive-deps
    // An idle move ends with the pose (blending away).
    useEffect(() => {
        if (moveRef.current && MOVES[moveRef.current.name].kind === "idle") { clearTimers(); setMove(null); setFace({}); }
    }, [pose]);
    // A reaction asked for: once at a time, not while it enters.
    const reactN = react?.n;
    useEffect(() => {
        if (!react) return;
        const cur = moveRef.current;
        if (cur && (cur.name === react.name || MOVES[cur.name].kind === "enter" || MOVES[cur.name].kind === "leave")) return;
        play(react.name);
    }, [reactN]);    // eslint-disable-line react-hooks/exhaustive-deps

    const eyes = BIRD.eyes[(face.eyes || p.eyes) as keyof typeof BIRD.eyes];
    const beak = BIRD.beaks[(face.beak || p.beak) as keyof typeof BIRD.beaks];
    const t = BIRD.motion.transition;
    const pv = BIRD.pivots;
    const ms = (v: number) => (calm ? 0 : Math.round(v * k));
    const ease = (v: number, curve = "cubic-bezier(0.65, 0, 0.35, 1)") => `transform ${ms(v)}ms ${curve}, opacity ${ms(v)}ms ease`;
    const back = "cubic-bezier(0.34, 1.56, 0.64, 1)";

    // The hop: a take-off as it rises into a lifted pose, a landing as it comes down.
    const lastLift = useRef<number>(p.lift);
    const [hop, setHop] = useState<"" | "up" | "down">("");
    useEffect(() => {
        if (p.lift === lastLift.current) return;
        setHop(calm ? "" : p.lift > lastLift.current ? "up" : "down");
        lastLift.current = p.lift;
    }, [p.lift, calm]);
    const h = BIRD.motion.hop;
    const liftTransition = calm ? "none" : hop === "down"
        ? `transform ${ms(h.fall)}ms cubic-bezier(0.11, 0, 0.5, 0)`
        : `transform ${ms(h.rise)}ms cubic-bezier(0.33, 1, 0.68, 1) ${ms(h.takeoff)}ms`;

    // Blinks, now and then (twice sometimes), with the eyes open.
    const [blink, setBlink] = useState(false);
    useEffect(() => {
        if (calm || eyes.show < 0.5) return undefined;
        const b = BIRD.motion.blink;
        let timer = 0;
        const next = () => {
            timer = window.setTimeout(() => {
                const twice = Math.random() < b.twice;
                const shut = b.close + b.hold;
                setBlink(true);
                window.setTimeout(() => setBlink(false), shut * k);
                if (twice) {
                    window.setTimeout(() => setBlink(true), (shut + b.open) * k);
                    window.setTimeout(() => setBlink(false), (2 * shut + b.open) * k);
                }
                next();
            }, (b.minGap + Math.random() * (b.maxGap - b.minGap)) * k);
        };
        next();
        return () => window.clearTimeout(timer);
    }, [calm, eyes.show, k]);

    // Idle, now and then, after a random gap (motion.acting's every): the
    // look around and a full-body move from the pool (motion.idles) in turn.
    const [fidget, setFidget] = useState(false);
    const every = ACTING[pose]?.every;
    const lastIdle = useRef("");
    useEffect(() => {
        setFidget(false);
        const a = ACTING[pose];
        if (calm || !a?.every || !fidgety) return undefined;
        const [lo, hi] = a.every;
        let timer = 0, pool = false;
        const next = () => {
            timer = window.setTimeout(() => {
                if (moveRef.current) { next(); return; }
                if (pool) {
                    const others = BIRD.motion.idles.pool.filter((n) => n !== lastIdle.current);
                    const name = others[Math.floor(Math.random() * others.length)] as MoveName;
                    lastIdle.current = name;
                    play(name);
                    pool = false;
                    timer = window.setTimeout(next, MOVES[name].period * k);
                    return;
                }
                pool = true;
                setFidget(true);
                timer = window.setTimeout(() => { setFidget(false); next(); }, a.period * k);
            }, (lo + Math.random() * (hi - lo)) * k);
        };
        next();
        return () => window.clearTimeout(timer);
    }, [pose, calm, every, k, fidgety, play]);
    const act = (channel: Channel, children: ReactNode) => (
        <Act pose={pose} channel={channel} calm={calm} speed={k} fidget={fidget} move={move}>{children}</Act>
    );
    // Its gaze: the eyes, the head, a lean of the body.
    const gz = BIRD.motion.gaze;
    const [gx, gy] = calm || !gaze ? [0, 0] : [Math.max(-1, Math.min(1, gaze[0])), Math.max(-1, Math.min(1, gaze[1]))];
    const gazeEase = `transform ${ms(gz.ms)}ms cubic-bezier(0.33, 1, 0.68, 1)`;
    const headGaze = { transform: `${about(pv.neck, `rotate(${gx * gz.head}deg)`)} translate(0px, ${gy * gz.headY}px)`, transition: gazeEase };

    const talking = pose === "speaking" && !calm;
    const anim = (cls: string) => (calm ? undefined : cls);
    const eye = (side: "L" | "R") => {
        const [x, y, rx, ry] = eyes[side];
        return (
            <g style={{ transform: `translate(${x}px, ${y}px) scale(${rx / 10}, ${ry / 10})`, transition: ease(t.eyes), opacity: eyes.show }}>
                <g style={{ transform: `scale(1, ${blink ? 0.08 : 1})`, transition: calm ? "none" : `transform ${blink ? BIRD.motion.blink.close : BIRD.motion.blink.open}ms ease` }}>
                    <Part name="eye" />
                </g>
            </g>
        );
    };

    // Held still, it enters with a plain fade (Reduce motion).
    const [shown, setShown] = useState(!(start === "enter" && calm));
    useEffect(() => { if (!shown) { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r); } return undefined; }, [shown]);

    // Magic: the pose's aura, how many spark lanes show, the mist; each lane from a random point.
    const mp = MAGIC.poses[pose] ?? MAGIC.poses.idle;
    const [phases] = useState(() => [...MAGIC.sparkLanes.map((l) => -Math.round(Math.random() * l.period)),
                                     -Math.round(Math.random() * MAGIC.mistLane.period)]);
    const sparkling = !calm && !(move && (MOVES[move.name].kind === "enter" || MOVES[move.name].kind === "leave"));
    const au = MAGIC.aura;
    const magicEase = `opacity ${ms(au.ease)}ms ease`;

    const shadowMove = move && !calm && ("whole" in MOVES[move.name].tracks || "body" in MOVES[move.name].tracks) ? `ab-mv-${move.name}-shadow` : undefined;
    return (
        <svg className={["ab-bird", calm && "ab-still", className].filter(Boolean).join(" ")} data-testid={testId} data-pose={pose}
             data-move={move?.name ?? ""} onClick={onClick}
             viewBox={`0 0 ${BIRD.viewBox[0]} ${BIRD.viewBox[1]}`} width={size} height={Math.round(size * 1.1)}
             style={{ overflow: "visible", ["--ab-speed" as string]: k, opacity: shown ? 1 : 0,
                      transition: `opacity ${Math.round(250 * k)}ms ease` } as CSSProperties}
             role="img" aria-label={`The assistant: ${p.label}`}>
            <defs>
                <radialGradient id="ab-fire">
                    <stop offset="0" stopColor={BIRD.colors.flameCore} />
                    <stop offset="0.3" stopColor={BIRD.colors.flame} />
                    <stop offset="0.6" stopColor={BIRD.colors.ember} stopOpacity={0.75} />
                    <stop offset="1" stopColor={BIRD.colors.ember} stopOpacity={0} />
                </radialGradient>
                {/* Dust on the app's light ground: a darker warm grey-brown than the shell's (dark ground). */}
                {/* The aura's gold: its light, its rings' bands, a surge's; the mist. */}
                <radialGradient id="ab-aura">
                    <stop offset="0" stopColor={BIRD.colors[au.color]} stopOpacity={au.alpha} />
                    <stop offset="0.45" stopColor={BIRD.colors[au.color]} stopOpacity={au.alpha * 0.45} />
                    <stop offset="1" stopColor={BIRD.colors[au.color]} stopOpacity={0} />
                </radialGradient>
                <radialGradient id="ab-aura-ring">
                    <stop offset={au.rings.inner} stopColor={BIRD.colors[au.color]} stopOpacity={0} />
                    <stop offset={(1 + 2 * au.rings.inner) / 3} stopColor={BIRD.colors[au.color]} stopOpacity={au.rings.alpha} />
                    <stop offset="1" stopColor={BIRD.colors[au.color]} stopOpacity={0} />
                </radialGradient>
                <radialGradient id="ab-aura-surge">
                    <stop offset="0" stopColor={BIRD.colors[au.color]} stopOpacity={0.6} />
                    <stop offset="0.3" stopColor={BIRD.colors[au.color]} stopOpacity={0.4} />
                    <stop offset="0.6" stopColor={BIRD.colors[au.color]} stopOpacity={0.15} />
                    <stop offset="1" stopColor={BIRD.colors[au.color]} stopOpacity={0} />
                </radialGradient>
                <radialGradient id="ab-mist">
                    <stop offset="0" stopColor={BIRD.colors[MAGIC.mist.color]} stopOpacity={MAGIC.mist.alpha} />
                    <stop offset="0.5" stopColor={BIRD.colors[MAGIC.mist.color]} stopOpacity={MAGIC.mist.alpha} />
                    <stop offset="1" stopColor={BIRD.colors[MAGIC.mist.color]} stopOpacity={0} />
                </radialGradient>
                <radialGradient id="ab-dust">
                    <stop offset="0" stopColor={BIRD.colors.dustOnLight} stopOpacity={0.8} />
                    <stop offset="0.55" stopColor={BIRD.colors.dustOnLight} stopOpacity={0.5} />
                    <stop offset="1" stopColor={BIRD.colors.dustOnLight} stopOpacity={0} />
                </radialGradient>
            </defs>
            {fx.filter((e) => behind(EFFECTS[e.name].kind)).map((e) => <FxView key={e.key} name={e.name} />)}
            {!calm && (
                <g data-magic="mist" style={{ opacity: sparkling && mp[2] === 1 ? 1 : 0, transition: magicEase, ["--ab-phase" as string]: `${phases[phases.length - 1]}ms` } as CSSProperties}>
                    {MAGIC.mistLane.mists.map((_m, i) => <circle key={i} className={`ab-mist ab-mist-${i + 1}`} r={100} fill="url(#ab-mist)" />)}
                </g>
            )}
            <g className={shadowMove} key={shadowMove ? move?.key : 0}>
                <Part name="shadow" style={{ transform: about(pv.shadow, `scale(${p.lift > 0 ? 0.7 : 1}, 1)`), transition: ease(t.body) }} />
            </g>
            {act("whole",
            <g style={{ transform: `translate(0px, ${-p.lift}px)`, transition: liftTransition }}>
                {/* The aura: breathing, flickering with the crest, radiating rings; still, a faint glow. */}
                <g data-magic="aura" style={{ opacity: mp[0] * (calm ? au.still : 1), transition: magicEase }}>
                    <g className={anim("ab-aura-breath")}><g className={anim("ab-aura-flicker")}>
                        <circle cx={au.origin[0]} cy={au.origin[1]} r={au.radius} fill="url(#ab-aura)" />
                    </g></g>
                    {!calm && mp[3] === 1 && Array.from({ length: au.rings.count }, (_v, i) => (
                        <circle key={i} className={`ab-aura-ring ab-aura-ring-${i + 1}`} r={au.rings.radius} fill="url(#ab-aura-ring)" />
                    ))}
                </g>
                <g style={{ transform: about(pv.body, `rotate(${p.tilt}deg)`), transition: ease(t.body) }}>
                    {/* Not remounted for the hop (its class alternates, take-off and
                        landing, which restarts it): the parts within ease and blend on. */}
                    <g className={hop === "up" ? anim("ab-takeoff") : hop === "down" ? anim("ab-landing") : undefined}>
                        <g className={anim("ab-breath")}>
                            {act("body", <g style={{ transform: about(pv.feet, `rotate(${gx * gz.body}deg)`), transition: gazeEase }}>
                                {act("tail", <>
                                    <g className={anim("ab-flicker-tail")}><Part name="tail" /></g>
                                    <g className={anim("ab-flicker-tailInner")}><Part name="tailInner" /></g>
                                </>)}
                                {act("head", <g style={headGaze}>
                                    <g style={{ transform: `translate(${pv.crest[0]}px, ${pv.crest[1]}px) rotate(${p.crestRotation}deg) scale(${p.crestScale})`, transition: ease(t.crest, back) }}>
                                        {act("crest",
                                            <g className={anim("ab-flicker-crestGust")}>
                                                <g className={anim("ab-flicker-crest")}><Part name="crest" /></g>
                                                <g className={anim("ab-flicker-crestInner")}><Part name="crestInner" /></g>
                                                <g className={anim("ab-flicker-crestCore")}><Part name="crestCore" /></g>
                                            </g>)}
                                    </g>
                                </g>)}
                                {act("footL", <Part name="footL" />)}
                                {act("footR", <Part name="footR" />)}
                                <Part name="body" />
                                <Part name="belly" />
                                <g style={{ transform: about(pv.wingL, `rotate(${p.wingL}deg)`), transition: ease(t.wings, back) }}>
                                    {act("wingL", <><Part name="wingL" /><Part name="wingTipL" /></>)}
                                </g>
                                <g style={{ transform: about(pv.wingR, `rotate(${p.wingR}deg)`), transition: ease(t.wings, back) }}>
                                    {act("wingR", <><Part name="wingR" /><Part name="wingTipR" /></>)}
                                </g>
                                {/* The face (eyes, lids, beak) acts as the head, with the crest. */}
                                {act("head", <g style={headGaze}>
                                    {act("eyes", <g style={{ transform: `translate(${gx * gz.eyes[0]}px, ${gy * gz.eyes[1]}px)`, transition: gazeEase }} data-gaze="eyes">
                                        {eye("L")}
                                        {eye("R")}
                                        {act("lids", (Object.keys(BIRD.overlays) as (keyof typeof BIRD.overlays)[]).map((o) => {
                                            const on = (eyes.overlays as readonly string[]).includes(o);
                                            return (
                                                <g key={o} data-overlay={o} style={{ opacity: on ? 1 : 0, transform: `translate(0px, ${on ? 0 : BIRD.overlays[o].dy}px)`, transition: ease(t.eyes) }}>
                                                    <Part name={o} />
                                                </g>
                                            );
                                        }))}
                                    </g>)}
                                    <g style={{ transform: about(pv.beak, `rotate(${p.beakTilt}deg)`), transition: ease(t.beak) }}>
                                        {act("beak", <>
                                            <g style={{ opacity: 1 - beak.grin, transform: `translate(0px, ${beak.jaw[0]}px) ${about(pv.jaw, `scale(${beak.jaw[1]}, ${beak.jaw[2]})`)}`, transition: ease(t.beak) }}>
                                                <g className={talking ? "ab-talk-jaw" : undefined}><Part name="jaw" /></g>
                                            </g>
                                            <g style={{ opacity: beak.mouth[2], transform: about(pv.jaw, `scale(${beak.mouth[0]}, ${beak.mouth[1]})`), transition: ease(t.beak) }}>
                                                <g className={talking ? "ab-talk-mouth" : undefined}><Part name="mouth" /></g>
                                            </g>
                                            <g style={{ opacity: beak.tongue, transition: ease(t.beak) }}><Part name="tongue" /></g>
                                            <g style={{ opacity: beak.grin, transition: ease(t.beak) }}><Part name="grinJaw" /><Part name="grinMouth" /></g>
                                            <g style={{ transform: `translate(0px, ${beak.upper[0]}px) ${about(pv.upperBeak, `scale(1, ${talking ? 1 : beak.upper[1]})`)}`, transition: ease(t.beak) }}>
                                                <g className={talking ? "ab-talk-upper" : undefined}><Part name="upperBeak" /></g>
                                            </g>
                                            <g style={{ transform: `translate(0px, ${beak.upper[0]}px)`, transition: ease(t.beak) }}>
                                                <Part name="beakShine" /><Part name="nostrilL" /><Part name="nostrilR" />
                                            </g>
                                        </>)}
                                    </g>
                                </g>)}
                            </g>)}
                        </g>
                    </g>
                </g>
            </g>)}
            {(Object.keys(BIRD.extras) as (keyof typeof BIRD.extras)[]).map((x) => {
                const on = (p.extras as readonly string[]).includes(x);
                return (
                    <g key={x} data-extra={x} style={{ opacity: on ? 1 : 0, transition: `opacity ${ms(t.extras)}ms ease` }}>
                        {BIRD.extras[x].parts.map((part, i) => (
                            <g key={part} className={on && !calm ? `ab-${x}-${i + 1}` : undefined}><Part name={part as PartName} /></g>
                        ))}
                    </g>
                );
            })}
            {!calm && (
                <g data-magic="sparks" style={{ opacity: sparkling ? 1 : 0, transition: magicEase }}>
                    {MAGIC.sparkLanes.map((lane, l) => (
                        <g key={l} data-lane={l} style={{ opacity: l < mp[1] ? 1 : 0, transition: magicEase, ["--ab-phase" as string]: `${phases[l]}ms` } as CSSProperties}>
                            {lane.sparks.map((s, i) => <g key={i} className={`ab-spark ab-spark-${l + 1}-${i + 1}`}><SparkView s={s} /></g>)}
                        </g>
                    ))}
                </g>
            )}
            {fx.filter((e) => !behind(EFFECTS[e.name].kind)).map((e) => <FxView key={e.key} name={e.name} />)}
        </svg>
    );
}

/** An effect (art's effects) playing: its particles, each a few nested
 *  groups with their generated keyframes (bird.generated.css). */
function FxView({ name }: { name: FxName }) {
    const e = EFFECTS[name];
    const c = (v: number | string | undefined) => BIRD.colors[(v ?? "dust") as keyof typeof BIRD.colors];
    if (behind(e.kind))
        return <g data-fx={name}><g className={`ab-fx-${name}`}><circle r={e.radius} fill={e.kind === "surge" ? "url(#ab-aura-surge)" : "url(#ab-fire)"} /></g></g>;
    return (
        <g data-fx={name}>
            {(e.particles ?? []).map((pt, i) => {
                const cls = `ab-fx-${name}-${i + 1}`;
                const size = Number(pt[2]);
                if (e.kind === "swirl")
                    return (
                        <g key={i} className={`${cls}-a`}><g className={`${cls}-r`}><g className={`${cls}-o`}>
                            <circle r={size * 1.3} fill={c(pt[4])} opacity={0.3} />
                            <rect x={-size / 2} y={-size * 1.2} width={size} height={size * 2.4} rx={size / 2} fill={c(pt[4])} />
                            <ellipse rx={size * 0.22} ry={size * 0.54} fill={BIRD.colors.flameCore} />
                        </g></g></g>
                    );
                if (e.kind === "puff")
                    return <g key={i} className={`${cls}-t`}><g className={`${cls}-s`}><circle className={`${cls}-o`} r={size} fill="url(#ab-dust)" /></g></g>;
                return (
                    <g key={i} className={`${cls}-t`}><g className={`${cls}-s`}><g className={`${cls}-o`}>
                        <circle r={size * 1.3} fill={c(pt[4])} opacity={0.3} />
                        <circle r={size / 2} fill={c(pt[4])} />
                        <circle r={size * 0.22} fill={BIRD.colors.flameCore} />
                    </g></g></g>
                );
            })}
        </g>
    );
}
