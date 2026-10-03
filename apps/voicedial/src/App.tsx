// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Voice Dial (com.palm.sysapp.voicedial on webOS, here
// org.webosphoenix.voicedial): say "Call Ada Palmer", "Call Marcus at
// work" or "Dial 4 0 8 5 5 5 0 1 4 2", say "Yes" (or tap Call), and Phone
// calls.
//
// It listens as soon as it opens, through the shell's dictation (the
// keyboard's microphone and whisper.cpp: org.webosphoenix.dictation), with
// the contacts' names as the words to expect, and stops by itself when you
// have finished speaking; a tap on the microphone stops it sooner, or
// listens again. A name is matched to the contacts that have a phone
// number (lib/match.ts); when two are about as likely, both are offered.
// The confirmation listens for "Yes" or "No" too. Phone places the call
// (launched with {number, dial: true}) and shows it.
//
// On webOS the Voice Dial icon called com.palm.pmvoicecommand, which was
// never released; the runtime sends that call here.

import { useCallback, useEffect, useRef, useState } from "react";
import { apps, contacts, dictation, DICTATION_ERRORS, LunaError, personDisplayName, sameNumber, type Listening,
         type Person } from "@phoenix/luna";
import { Avatar, Button, formatNumber, Group, Page, PageHeader, Row, Spinner } from "@phoenix/ui";
import { decide, matchPeople, numberTypeLabel, parseAnswer, parseCommand, personWithNumber, pickNumber, promptFor } from "./lib/match";

const PHONE_APP = "org.webosphoenix.phone";

interface Target { person?: Person; name: string; number: string; type?: string }

type Stage =
    | { kind: "starting" }
    | { kind: "listening" }
    | { kind: "transcribing" }
    | { kind: "confirm"; target: Target; heard: string; asking: boolean; answering?: boolean }
    | { kind: "choose"; heard: string; choices: Target[] }
    | { kind: "nomatch"; heard: string }
    | { kind: "error"; text: string }
    | { kind: "calling"; target: Target };

function targetOf(person: Person, numberType?: string): Target | null {
    const n = pickNumber(person, numberType);
    return n ? { person, name: personDisplayName(person), number: n.value, type: n.type } : null;
}

function errorText(e: unknown): string {
    if (e instanceof LunaError) {
        if (e.errorCode === DICTATION_ERRORS.NOTHING_HEARD) return "Nothing was heard. Tap the microphone and say a name or number.";
        if (e.errorCode === DICTATION_ERRORS.NOT_AVAILABLE) return e.errorText || "Voice Dial needs a microphone.";
        return e.errorText || "Voice Dial did not hear that.";
    }
    return "Voice Dial did not hear that.";
}

function Microphone({ state, small, onTap }: { state: "listening" | "transcribing" | "idle"; small: boolean; onTap: () => void }) {
    return (
        <button type="button" className={"vd-mic vd-" + state + (small ? " vd-small" : "")} data-testid="mic" data-state={state} onClick={onTap}
                aria-label={state === "listening" ? "Done speaking" : "Listen"}>
            <span className="vd-ring" />
            <svg viewBox="0 0 48 48" aria-hidden="true">
                <rect x="17" y="6" width="14" height="24" rx="7" />
                <path d="M11 22a13 13 0 0 0 26 0" fill="none" strokeWidth="3" strokeLinecap="round" />
                <path d="M24 35v6M17 42h14" fill="none" strokeWidth="3" strokeLinecap="round" />
            </svg>
            {state === "transcribing" && <span className="vd-mic-spinner"><Spinner label="Recognizing" /></span>}
        </button>
    );
}

export function App() {
    const [people, setPeople] = useState<Person[] | null>(null);
    const [stage, setStage] = useState<Stage>({ kind: "starting" });
    const listening = useRef<Listening | null>(null);
    const stageRef = useRef(stage);
    stageRef.current = stage;

    const stopListening = () => {
        listening.current?.cancel();
        listening.current = null;
    };

    const interpret = useCallback((heard: string, everyone: Person[]): Stage => {
        const cmd = parseCommand(heard);
        if (cmd.kind === "number") {
            const person = personWithNumber(cmd.number, everyone);
            return { kind: "confirm", heard, asking: true,
                     target: { person, name: person ? personDisplayName(person) : "", number: cmd.number,
                               type: person?.phoneNumbers?.find((n) => sameNumber(n.value, cmd.number))?.type } };
        }
        if (cmd.kind === "none") return { kind: "nomatch", heard };
        const d = decide(matchPeople(cmd.name, everyone));
        const sure = d.sure && targetOf(d.sure.person, cmd.numberType);
        if (sure) return { kind: "confirm", heard, target: sure, asking: true };
        const choices = d.choices.map((m) => targetOf(m.person, cmd.numberType)).filter((t): t is Target => !!t);
        return choices.length ? { kind: "choose", heard, choices } : { kind: "nomatch", heard };
    }, []);

    // Say a name or number.
    const listen = useCallback((everyone: Person[]) => {
        stopListening();
        setStage({ kind: "listening" });
        const l = dictation.listen({
            prompt: promptFor(everyone), autoStop: true,
            onState: (s) => { if (listening.current === l) setStage({ kind: s }); },
        });
        listening.current = l;
        l.result.then((heard) => {
            if (listening.current !== l) return;
            listening.current = null;
            setStage(interpret(heard, everyone));
        }, (e) => {
            if (listening.current !== l) return;
            listening.current = null;
            setStage({ kind: "error", text: errorText(e) });
        });
    }, [interpret]);

    const place = useCallback((target: Target) => {
        stopListening();
        setStage({ kind: "calling", target });
        // Phone places the call (its card stays up with the call; this one
        // goes).
        apps.launch(PHONE_APP, { number: target.number, dial: true }).then(() => {
            setTimeout(() => window.close(), 600);
        }, (e: LunaError) => setStage({ kind: "error", text: e.errorText || "Phone could not be opened." }));
    }, []);

    // "Call Ada Palmer, mobile?" -- "Yes."
    const askYesNo = useCallback((target: Target) => {
        stopListening();
        const l = dictation.listen({
            prompt: "Yes. No.", autoStop: true,
            // The answer is being recognized.
            onState: (st) => setStage((cur) => listening.current === l && cur.kind === "confirm" ? { ...cur, answering: st === "transcribing" } : cur),
        });
        listening.current = l;
        l.result.then((heard) => {
            if (listening.current !== l) return;
            listening.current = null;
            const yes = parseAnswer(heard);
            const s = stageRef.current;
            if (yes === true) place(target);
            else if (yes === false && people) listen(people);
            else if (s.kind === "confirm") setStage({ ...s, asking: false });
        }, () => {
            if (listening.current !== l) return;
            listening.current = null;
            const s = stageRef.current;
            if (s.kind === "confirm") setStage({ ...s, asking: false });
        });
    }, [listen, people, place]);

    useEffect(() => {
        let alive = true;
        contacts.all().then((all) => { if (alive) setPeople(all); }, () => { if (alive) setPeople([]); });
        return () => { alive = false; stopListening(); };
    }, []);
    useEffect(() => {
        if (people && stage.kind === "starting") listen(people);
    }, [people, stage.kind, listen]);
    const confirmTarget = stage.kind === "confirm" && stage.asking ? stage.target : null;
    useEffect(() => {
        if (confirmTarget) askYesNo(confirmTarget);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [confirmTarget]);

    const asking = stage.kind === "confirm" && stage.asking;
    const tapMic = () => {
        if (stage.kind === "listening" || asking) listening.current?.stop();
        else if (stage.kind !== "transcribing" && stage.kind !== "calling" && people) listen(people);
    };
    const micState = stage.kind === "listening" || stage.kind === "transcribing" ? stage.kind
        : asking ? (stage.answering ? "transcribing" : "listening") : "idle";
    // A favourite with a name, for the example.
    const example = people?.find((p) => p.favorite && p.name?.givenName && p.phoneNumbers?.length)
        ?? people?.find((p) => p.name?.givenName && p.phoneNumbers?.length);
    const small = stage.kind !== "starting" && stage.kind !== "listening" && stage.kind !== "transcribing";

    return (
        <Page className="vd">
            <PageHeader title="Voice Dial" icon="icon.png" />
            <div className="vd-body" data-testid="voicedial" data-stage={stage.kind}>
                <Microphone state={micState} small={small} onTap={tapMic} />
                <div className="vd-status" data-testid="status">
                    {stage.kind === "starting" ? "Getting ready…"
                        : stage.kind === "listening" ? "Say a name or number"
                        : stage.kind === "transcribing" ? "Recognizing…"
                        : stage.kind === "confirm" ? (stage.target.name ? `Call ${stage.target.name}?` : `Call ${formatNumber(stage.target.number)}?`)
                        : stage.kind === "choose" ? "Which one?"
                        : stage.kind === "nomatch" ? "No contact matches that"
                        : stage.kind === "calling" ? "Calling…"
                        : "Voice Dial"}
                </div>
                {"heard" in stage && stage.heard && <div className="vd-heard" data-testid="heard">“{stage.heard}”</div>}
                {stage.kind === "listening" && (
                    <div className="vd-hint">
                        For example “Call {example ? personDisplayName(example) : "Ada Palmer"}” or “Dial 4 0 8 5 5 5 0 1 4 2”.
                        Tap the microphone when you are done.
                    </div>
                )}

                {(stage.kind === "confirm" || stage.kind === "calling") && (
                    <div className="vd-confirm" data-testid="confirm">
                        <Group>
                            <Row icon={<Avatar size={40} src={stage.target.person?.photos?.localPathList || stage.target.person?.photos?.localPathSquare} />}
                                 title={stage.target.name || formatNumber(stage.target.number)}
                                 subtitle={stage.target.name ? `${numberTypeLabel(stage.target.type)} ${formatNumber(stage.target.number)}` : "Phone number"}
                                 testId="target" />
                        </Group>
                        {stage.kind === "confirm" && (
                            <>
                                <div className="vd-say" data-testid="say-yes">{stage.asking ? (stage.answering ? "Recognizing…" : "Say “Yes” to call, or “No”.") : " "}</div>
                                <div className="vd-buttons">
                                    <Button variant="negative" data-testid="cancel" onClick={() => people && listen(people)}>No</Button>
                                    <Button variant="affirmative" data-testid="call" onClick={() => place(stage.target)}>Call</Button>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {stage.kind === "choose" && (
                    <Group>
                        {stage.choices.map((t) => (
                            <Row key={t.number + t.name} testId="choice" title={t.name}
                                 subtitle={`${numberTypeLabel(t.type)} ${formatNumber(t.number)}`}
                                 icon={<Avatar size={40} src={t.person?.photos?.localPathList || t.person?.photos?.localPathSquare} />}
                                 onClick={() => setStage({ kind: "confirm", heard: stage.heard, target: t, asking: false })} chevron />
                        ))}
                    </Group>
                )}

                {(stage.kind === "nomatch" || stage.kind === "error" || stage.kind === "choose") && (
                    <div className="vd-buttons single">
                        {stage.kind === "error" && <div className="vd-error" role="alert" data-testid="error">{stage.text}</div>}
                        <Button data-testid="again" onClick={() => people && listen(people)}>Try Again</Button>
                    </div>
                )}
            </div>
        </Page>
    );
}
