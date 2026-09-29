// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The cards and gestures tutorial. webOS's First Use ended with a short
// animated tutorial on cards and the gesture area (the Palm First Use app,
// never open-sourced, so this is new): a small phone (or tablet) plays each
// gesture over and over while the text says what it does. The demos are
// CSS animations (firstuse.css, "Tutorial"), drawn with plain shapes.

import { useState } from "react";
import { Button } from "@phoenix/ui";
import { lessons, type Lesson } from "./lib/flow";

function Screen({ lesson }: { lesson: Lesson }) {
    // Three cards in a row, the middle one the app; the launcher's icon
    // grid; Just Type's field and results.
    return (
        <div className={`tut-screen lesson-${lesson.id}`}>
            <div className="tut-clip">
            <div className="tut-statusbar" />
            <div className="tut-cards">
                <div className="tut-card left" />
                <div className="tut-card mid"><div className="tut-page two" /></div>
                <div className="tut-card right" />
                <div className="tut-card far" />
            </div>
            <div className="tut-launcher">
                {Array.from({ length: 12 }, (_, i) => <span key={i} className="tut-icon" />)}
            </div>
            <div className="tut-justtype">
                <div className="tut-field"><span className="tut-typed" /></div>
                <div className="tut-result" /><div className="tut-result" /><div className="tut-result short" />
            </div>
            </div>
            <div className="tut-finger" />
        </div>
    );
}

export function Tutorial({ tablet, onDone, onBack }: { tablet: boolean; onDone: () => void; onBack: () => void }) {
    const list = lessons(tablet);
    const [i, setI] = useState(0);
    const lesson = list[i];
    return (
        <div className="tutorial" data-testid="tutorial" data-lesson={lesson.id}>
            <div className={`tut-device${tablet ? " tablet" : ""}`} aria-hidden>
                <Screen key={lesson.id} lesson={lesson} />
                {!tablet && <div className="tut-gesture-area"><span className="tut-lightbar" /></div>}
            </div>
            <div className="tut-text">
                <div className="tut-title" data-testid="lesson-title">{lesson.title}</div>
                <div className="tut-body">{lesson.text}</div>
            </div>
            <div className="tut-dots" aria-label={`${i + 1} of ${list.length}`}>
                {list.map((l, j) => (
                    <button key={l.id} type="button" className={`tut-dot${j === i ? " on" : ""}`} aria-label={l.title}
                            onClick={() => setI(j)} />
                ))}
            </div>
            <div className="tut-buttons">
                <Button variant="dark" data-testid="lesson-back" onClick={() => (i > 0 ? setI(i - 1) : onBack())}>Back</Button>
                <Button variant="affirmative" data-testid="lesson-next"
                        onClick={() => (i < list.length - 1 ? setI(i + 1) : onDone())}>
                    {i < list.length - 1 ? "Next Tip" : "Got It"}
                </Button>
            </div>
        </div>
    );
}
