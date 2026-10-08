// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's bird (docs/ASSISTANT-CHARACTER.md), in the app: the same
// drawing, poses and motion as the shell's (AssistantBird.qml), from the
// same source (art/assistant-bird/bird.json, through birdData.ts and
// bird.generated.css). SVG paths; pose changes are CSS transitions, the
// flames' flicker, the breath, the extras, the hop and the speaking beak
// are the generated keyframes; blinks come at random times.
//
// Follows the system's Animation speed (Fast: 60% of the time) and Reduce
// motion, and the browser's prefers-reduced-motion: with either it holds
// each pose still.

import { Component, createRef, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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

interface ActProps { pose: BirdPose; channel: Channel; calm: boolean; speed: number; fidget: boolean; children: ReactNode }

/** A part's acting: the pose's loop for `channel` (the class of its generated
 *  keyframes), on top of the pose's values. Each loop starts and ends at
 *  rest; when the pose changes, the outer group takes over where the part
 *  was (its transform as drawn just then) and eases back to none over
 *  motion.acting.lead, so the new loop never jumps. A class component for
 *  getSnapshotBeforeUpdate: the old loop's transform is read before the
 *  class changes. Styles are set through the CSSOM (the CSP allows that). */
class Act extends Component<ActProps> {
    private outer = createRef<SVGGElement>();
    private inner = createRef<SVGGElement>();

    static className(p: ActProps): string | undefined {
        const a = ACTING[p.pose];
        if (p.calm || !a || !(p.channel in a.tracks) || (a.every && !p.fidget)) return undefined;
        return `ab-act-${p.pose}-${p.channel}`;
    }

    getSnapshotBeforeUpdate(prev: ActProps): string | null {
        if (this.props.calm || Act.className(prev) === Act.className(this.props)) return null;
        const o = this.outer.current, i = this.inner.current;
        if (!o || !i) return null;
        const t = (el: Element) => { const v = getComputedStyle(el).transform; return v && v !== "none" ? v : ""; };
        const ot = t(o), it = t(i);
        if (!ot && !it) return null;
        if (!ot || !it || typeof DOMMatrix === "undefined") return ot || it;
        return new DOMMatrix(ot).multiply(new DOMMatrix(it)).toString();
    }

    componentDidUpdate(_prev: ActProps, _state: unknown, snapshot: string | null) {
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
                <g ref={this.inner} className={Act.className(this.props)}>{this.props.children}</g>
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
}

export function Bird({ pose, size = 120, className, testId = "as-bird", speed, still }: BirdProps) {
    const motion = useBirdMotion();
    const k = speed ?? motion.speed;
    const calm = still ?? motion.still;
    const p = BIRD.poses[pose] ?? BIRD.poses.idle;
    const eyes = BIRD.eyes[p.eyes];
    const beak = BIRD.beaks[p.beak];
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

    // Idle's look around: now and then, after a random gap (motion.acting's every).
    const [fidget, setFidget] = useState(false);
    const every = ACTING[pose]?.every;
    useEffect(() => {
        setFidget(false);
        const a = ACTING[pose];
        if (calm || !a?.every) return undefined;
        const [lo, hi] = a.every;
        let timer = 0;
        const next = () => {
            timer = window.setTimeout(() => {
                setFidget(true);
                timer = window.setTimeout(() => { setFidget(false); next(); }, a.period * k);
            }, (lo + Math.random() * (hi - lo)) * k);
        };
        next();
        return () => window.clearTimeout(timer);
    }, [pose, calm, every, k]);
    const act = (channel: Channel, children: ReactNode) => (
        <Act pose={pose} channel={channel} calm={calm} speed={k} fidget={fidget}>{children}</Act>
    );

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

    return (
        <svg className={["ab-bird", calm && "ab-still", className].filter(Boolean).join(" ")} data-testid={testId} data-pose={pose}
             viewBox={`0 0 ${BIRD.viewBox[0]} ${BIRD.viewBox[1]}`} width={size} height={Math.round(size * 1.1)}
             style={{ overflow: "visible", ["--ab-speed" as string]: k } as CSSProperties}
             role="img" aria-label={`The assistant: ${p.label}`}>
            <Part name="shadow" style={{ transform: about(pv.shadow, `scale(${p.lift > 0 ? 0.7 : 1}, 1)`), transition: ease(t.body) }} />
            <g style={{ transform: `translate(0px, ${-p.lift}px)`, transition: liftTransition }}>
                <g style={{ transform: about(pv.body, `rotate(${p.tilt}deg)`), transition: ease(t.body) }}>
                    {/* Not remounted for the hop (its class alternates, take-off and
                        landing, which restarts it): the parts within ease and blend on. */}
                    <g className={hop === "up" ? anim("ab-takeoff") : hop === "down" ? anim("ab-landing") : undefined}>
                        <g className={anim("ab-breath")}>
                            {act("body", <>
                                <g className={anim("ab-flicker-tail")}><Part name="tail" /></g>
                                <g className={anim("ab-flicker-tailInner")}><Part name="tailInner" /></g>
                                {act("head",
                                    <g style={{ transform: `translate(${pv.crest[0]}px, ${pv.crest[1]}px) rotate(${p.crestRotation}deg) scale(${p.crestScale})`, transition: ease(t.crest, back) }}>
                                        {act("crest",
                                            <g className={anim("ab-flicker-crestGust")}>
                                                <g className={anim("ab-flicker-crest")}><Part name="crest" /></g>
                                                <g className={anim("ab-flicker-crestInner")}><Part name="crestInner" /></g>
                                                <g className={anim("ab-flicker-crestCore")}><Part name="crestCore" /></g>
                                            </g>)}
                                    </g>)}
                                <Part name="footL" />
                                <Part name="footR" />
                                <Part name="body" />
                                <Part name="belly" />
                                <g style={{ transform: about(pv.wingL, `rotate(${p.wingL}deg)`), transition: ease(t.wings, back) }}>
                                    {act("wingL", <><Part name="wingL" /><Part name="wingTipL" /></>)}
                                </g>
                                <g style={{ transform: about(pv.wingR, `rotate(${p.wingR}deg)`), transition: ease(t.wings, back) }}>
                                    {act("wingR", <><Part name="wingR" /><Part name="wingTipR" /></>)}
                                </g>
                                {/* The face (eyes, lids, beak) acts as the head, with the crest. */}
                                {act("head", <>
                                    {act("eyes", <>
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
                                    </>)}
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
                                </>)}
                            </>)}
                        </g>
                    </g>
                </g>
            </g>
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
        </svg>
    );
}
