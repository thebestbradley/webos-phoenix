// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Assistant > Follow-up questions (docs/AI-AND-MCP.md): whether
// the assistant asks about what it just made (on by default), the quiet
// hours its questions never come in later (22:00 to 08:00 by default), the
// questions waiting, and Follow-up topics: a switch per kind of question,
// off for one the user told it to stop asking. All through
// org.webosphoenix.assistant (getSettings / setSettings, followUps).

import { assistant, type AssistantSettings, type FollowUp, type FollowUpKind } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Group, ListSelector, Row, ToggleButton } from "@phoenix/ui";

// The topics, each with a switch: one turned off with "Stop asking" (the
// assistant asks before it stops a topic Skipped often) shows off here.
const TOPICS: FollowUpKind[] = ["location", "invitees", "duration", "alert", "due", "list", "repeat", "label", "email", "phone"];
const TOPIC_TITLES: Record<string, string> = {
    location: "Where events are", invitees: "Who's coming", duration: "How long events last", alert: "Reminders before events",
    due: "When reminders and tasks are due", list: "Which list a task goes on", repeat: "Whether alarms repeat", label: "What alarms are for",
    email: "New contacts' email addresses", phone: "New contacts' phone numbers",
};

function hourLabel(hhmm: string): string {
    const [h, m] = hhmm.split(":").map(Number);
    if (h === 0 && m === 0) return "Midnight";
    if (h === 12 && m === 0) return "Noon";
    return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "AM" : "PM"}`;
}
/** Every hour, and the value itself when it is not on the hour. */
function hours(current: string) {
    const list = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
    if (!list.includes(current)) list.push(current);
    return list.sort().map((v) => ({ label: hourLabel(v), value: v }));
}
function nextText(f: FollowUp, now = Date.now()): string {
    if (f.state === "open") return "Waiting for your answer in the Assistant";
    const t = new Date(f.nextAt), n = new Date(now);
    const time = t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const day = t.toDateString() === n.toDateString() ? "" : ` on ${t.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`;
    return f.state === "delivered" ? `In your notifications; asks once more at ${time}${day}` : `Asks at ${time}${day}`;
}

export function FollowUpQuestions({ settings: s, set, off }: { settings: AssistantSettings; set: (c: Partial<AssistantSettings>) => void; off: boolean }) {
    const q = useLuna<{ followUps: FollowUp[]; topicsOff: FollowUpKind[] }>((cb, err) => assistant.watchFollowUps(cb, err), []).value;
    const on = s.followUps && !off;
    const topicsOff = s.followUpTopicsOff ?? [];
    const setTopic = (k: FollowUpKind, v: boolean) =>
        set({ followUpTopicsOff: v ? topicsOff.filter((x) => x !== k) : [...topicsOff.filter((x) => x !== k), k] });
    return (
        <>
            <Group label="Follow-up questions">
                <Row title="Follow-up questions" subtitle="After making something, ask about what it lacks, like where an event is" disabled={off}>
                    <ToggleButton value={s.followUps} label="Follow-up questions" testId="as-followups" disabled={off} onChange={(v) => set({ followUps: v })} />
                </Row>
                <ListSelector title="Quiet from" value={s.quietStart} disabled={!on} testId="as-quiet-start"
                              options={hours(s.quietStart)} onChange={(v) => set({ quietStart: v })} />
                <ListSelector title="Quiet until" value={s.quietEnd} disabled={!on} testId="as-quiet-end"
                              options={hours(s.quietEnd)} onChange={(v) => set({ quietEnd: v })} />
                {on && q?.followUps.map((f) => (
                    <Row key={f.id} testId={`as-followup-${f.id}`} title={f.question} subtitle={nextText(f)} />
                ))}
            </Group>
            <Group label="Follow-up topics">
                {TOPICS.map((k) => (
                    <Row key={k} title={TOPIC_TITLES[k]} disabled={!on}>
                        <ToggleButton value={!topicsOff.includes(k)} label={TOPIC_TITLES[k]} testId={`as-topic-${k}`} disabled={!on}
                                      onChange={(v) => setTopic(k, v)} />
                    </Row>
                ))}
            </Group>
        </>
    );
}
