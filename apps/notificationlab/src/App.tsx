// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Notification Lab: a developer's tool that puts everything the
// notification area shows in front of you, to review how it looks.
//
// - Live activities (org.webosphoenix.ongoing): a download, an upload, an
//   install (with progress), a sync and a timer (without), one or several
//   at once; pause, stop, or let them finish (a banner). Tap a row in the
//   notification area: the lab opens and says which. Minimize the card:
//   they keep going (the work runs in this page), and close it: they go.
// - Notifications as webOS apps make them: a banner
//   (PalmSystem.addBannerMessage), a dashboard (a window of type
//   "dashboard": the app's own page as a row, here ?view=dashboard) and a
//   popup alert (type "popupalert", ?view=alert).
// - Background tasks (com.palm.activitymanager): one due in 10 or 60
//   seconds, or when the device charges; when it runs, the app is
//   relaunched with {$activity} and posts a banner and a dashboard.
//
// Launch params: {from: <activity id>} (a live activity's row was tapped),
// {from: "dashboard" | "alert" | "banner"}, {task, $activity} (a task ran).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { call } from "@phoenix/luna";
import { useLaunchParams } from "@phoenix/luna/react";
import { Button, Group, Note, Page, PageHeader, Row } from "@phoenix/ui";
import { APP_ID, Lab, TASK_NAME, rowFor, taskRequest, type Host, type TaskLaunch } from "./lib/lab";

type Palm = {
    addBannerMessage?: (msg: string, params: string, icon?: string, soundClass?: string) => string;
};
const palm = () => (globalThis as { PalmSystem?: Palm }).PalmSystem;

function banner(text: string, params: object, sound = false) {
    palm()?.addBannerMessage?.(text, JSON.stringify(params), "icon.png", sound ? "notifications" : "");
}

const host: Host = {
    setOngoing: (row) => { void call("luna://org.webosphoenix.ongoing/set", { ...row, icon: "icon.png" }).catch(() => {}); },
    clearOngoing: (id) => { void call("luna://org.webosphoenix.ongoing/clear", { id }).catch(() => {}); },
    banner: (text, params) => banner(text, params),
};

let dashboards = 0;
/** A dashboard: this app's own page as a row of the notification area. */
export function openDashboard(title: string, text: string) {
    const n = ++dashboards;
    const q = new URLSearchParams({ view: "dashboard", title, text, n: String(n) });
    window.open(`index.html?${q}`, `lab-dashboard-${n}-${Date.now()}`,
        'height=52, attributes={"window":"dashboard","icon":"icon.png"}');
}

/** A popup alert (phones: over the bottom of the screen; tablets: top right). */
export function openAlert() {
    window.open("index.html?view=alert", `lab-alert-${Date.now()}`,
        'height=130, attributes={"window":"popupalert","soundclass":"notifications"}');
}

function describeLaunch(p: TaskLaunch): string {
    if (p.$activity) return `Opened by the background task (${p.task ?? "?"})`;
    if (!p.from) return "";
    if (p.from === "dashboard") return "Opened from its dashboard";
    if (p.from === "alert") return "Opened from its alert";
    if (p.from === "banner") return "Opened from its banner";
    if (p.from === "task") return "Opened from the background task's banner";
    return `Opened from the live activity "${p.from}"`;
}

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });

export function App() {
    const launch = useLaunchParams<TaskLaunch>();
    const lab = useMemo(() => new Lab(host), []);
    useEffect(() => () => { lab.stopAll(); lab.dispose(); }, [lab]);
    const runs = useSyncExternalStore((f) => lab.onChange(f), () => lab.list());
    const [tasks, setTasks] = useState<Record<string, string>>({});
    const [log, setLog] = useState<string[]>([]);
    const say = (s: string) => setLog((l) => [`${timeOf(Date.now())}  ${s}`, ...l].slice(0, 30));

    // A launch (or relaunch): say why; a background task that ran finishes
    // here, as an activity's callback would.
    const seen = useRef<string>("");
    useEffect(() => {
        const key = JSON.stringify(launch);
        if (key === seen.current) return;
        seen.current = key;
        const why = describeLaunch(launch);
        if (why) say(why);
        const act = launch.$activity;
        if (act) {
            void call("luna://com.palm.activitymanager/complete", { activityId: act.activityId }).catch(() => {});
            const late = launch.scheduled ? Math.round((Date.now() - launch.scheduled) / 1000) : 0;
            banner(`Background task ran (${launch.task ?? "task"})`, { from: "task" }, true);
            openDashboard("Background task ran", `${launch.task ?? "task"} · ${late} s after it was set`);
            setTasks((t) => { const n = { ...t }; delete n[act.name]; return n; });
        }
    }, [launch]);

    const schedule = async (seconds: number, charging = false) => {
        const name = charging ? TASK_NAME + ".charging" : TASK_NAME;
        try {
            await call("luna://com.palm.activitymanager/create", taskRequest(seconds, Date.now(), charging));
            const what = charging ? "when charging" : `at ${timeOf(Date.now() + seconds * 1000)}`;
            setTasks((t) => ({ ...t, [name]: what }));
            say(`Background task set: ${what}`);
        } catch (e) {
            say(`The task was not set: ${(e as Error).message}`);
        }
    };
    const cancelTask = async (name: string) => {
        await call("luna://com.palm.activitymanager/cancel", { activityName: name }).catch(() => {});
        setTasks((t) => { const n = { ...t }; delete n[name]; return n; });
        say("Background task cancelled");
    };

    const startSeveral = () => { lab.start("download"); lab.start("upload"); lab.start("sync"); };

    return (
        <Page className="nl-page">
            <PageHeader title="Notification Lab" icon="icon.png" />

            <Group label="Live activities">
                <div className="nl-buttons">
                    <Button data-testid="start-download" onClick={() => lab.start("download")}>Download</Button>
                    <Button data-testid="start-install" onClick={() => lab.start("install")}>Install</Button>
                    <Button data-testid="start-sync" onClick={() => lab.start("sync")}>Sync</Button>
                    <Button data-testid="start-timer" onClick={() => lab.start("timer")}>Timer</Button>
                    <Button data-testid="start-several" variant="affirmative" onClick={startSeveral}>Three at Once</Button>
                </div>
                {runs.length === 0 && <Note>None running. Start one, then open the notification area (Sync and Timer have no progress bar).</Note>}
                {runs.map((r) => {
                    const row = rowFor(r);
                    return (
                        <div key={r.id} className="nl-run" data-testid={`run-${r.id}`}>
                            <div className="nl-run-head">
                                <div className="nl-run-title">{row.title}</div>
                                {r.kind.determinate && <div className="nl-run-pct">{row.progress}%</div>}
                            </div>
                            <div className="nl-run-body">{row.body}</div>
                            <div className={"nl-run-bar" + (r.kind.determinate ? "" : " indeterminate")}>
                                <div style={r.kind.determinate ? { width: `${row.progress}%` } : undefined} />
                            </div>
                            <div className="nl-row-buttons">
                                <Button className="nl-small" onClick={() => lab.togglePause(r.id)}>{r.paused ? "Resume" : "Pause"}</Button>
                                <Button className="nl-small" variant="negative" onClick={() => lab.stop(r.id)}>Stop</Button>
                            </div>
                        </div>
                    );
                })}
                {runs.length > 1 && (
                    <div className="nl-buttons"><Button variant="negative" onClick={() => lab.stopAll()}>Stop All</Button></div>
                )}
            </Group>

            <Group label="Notifications">
                <div className="nl-buttons">
                    <Button data-testid="banner" onClick={() => { banner("Hello from the Notification Lab", { from: "banner" }, true); say("Banner shown"); }}>Banner</Button>
                    <Button data-testid="dashboard" onClick={() => { openDashboard("New lab message", "Tap to open the lab, swipe to dismiss"); say("Dashboard opened"); }}>Dashboard</Button>
                    <Button data-testid="alert" onClick={() => { openAlert(); say("Alert opened"); }}>Popup Alert</Button>
                </div>
            </Group>

            <Group label="Background tasks">
                <div className="nl-buttons">
                    <Button data-testid="task-10" onClick={() => schedule(10)}>10 Seconds</Button>
                    <Button data-testid="task-60" onClick={() => schedule(60)}>1 Minute</Button>
                    <Button data-testid="task-charging" onClick={() => schedule(0, true)}>When Charging</Button>
                </div>
                {Object.entries(tasks).map(([name, what]) => (
                    <Row key={name} title="Waiting" subtitle={what}>
                        <Button className="nl-small" variant="negative" onClick={() => cancelTask(name)}>Cancel</Button>
                    </Row>
                ))}
                <Note>
                    A task relaunches the lab when it is due (a banner and a dashboard say so), even after the
                    card is closed. In the simulator F7 plugs the charger in.
                </Note>
            </Group>

            {log.length > 0 && (
                <Group label="What happened">
                    <div className="nl-log" data-testid="log">{log.map((l, i) => <div key={i}>{l}</div>)}</div>
                </Group>
            )}
        </Page>
    );
}

/** ?view=dashboard: the row in the notification area. A tap opens the lab. */
export function Dashboard() {
    const q = new URLSearchParams(location.search);
    const open = () => {
        // Closed once the launch is on its way: closing first can take the
        // page (and the call) away before it is sent.
        void call("luna://com.palm.applicationManager/launch", { id: APP_ID, params: { from: "dashboard" } })
            .catch(() => {})
            .finally(() => window.close());
    };
    return (
        <div className="nl-dashboard" onClick={open} data-testid="dashboard-view">
            <img className="nl-dashboard-icon" src="icon.png" alt="" />
            <div className="nl-dashboard-text">
                <div className="nl-dashboard-title">{q.get("title") || "Notification Lab"}</div>
                <div className="nl-dashboard-body">{q.get("text") || ""}</div>
            </div>
        </div>
    );
}

/** ?view=alert: a popup alert with two buttons, as webOS apps made them. */
export function Alert() {
    const open = () => {
        // Closed once the launch is on its way: closing first can take the
        // page (and the call) away before it is sent.
        void call("luna://com.palm.applicationManager/launch", { id: APP_ID, params: { from: "alert" } })
            .catch(() => {})
            .finally(() => window.close());
    };
    return (
        <div className="nl-alert" data-testid="alert-view">
            <div className="nl-alert-head">
                <img src="icon.png" alt="" />
                <div>
                    <div className="nl-alert-title">Notification Lab</div>
                    <div className="nl-alert-body">This is a popup alert.</div>
                </div>
            </div>
            <div className="nl-alert-buttons">
                <Button variant="affirmative" onClick={open}>Open</Button>
                <Button onClick={() => window.close()}>Dismiss</Button>
            </div>
        </div>
    );
}

