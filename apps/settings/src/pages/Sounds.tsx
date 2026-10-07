// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Sounds & Ringtones (com.palm.app.soundsandalerts): mute, volumes, the
// ringtone, the alert and notification tones, "System Sounds" and the
// keyboard's clicks.
// Services: com.webos.service.audio master/getVolume, master/setVolume,
// master/muteVolume, getInputVolume / setInputVolume (streamType
// pringtones, palerts, pfeedback, pmedia), playFeedback, playSound;
// com.webos.service.systemservice get/setPreferences (systemSounds,
// ringtone, alerttone, notificationtone, x_palm_virtualkeyboard_prefs),
// ringtone/listRingtones.
//
// The shell plays what these set (shell/qml/Phoenix/Shell/SystemSounds.qml):
// the ringtone for incoming calls; the alert tone for alerts, alarms and
// calendar reminders, the notification tone for other banners and popups
// that name no sound of their own (LunaSysMgr's Preferences alerttone /
// notificationtone, conf/defaultPreferences.txt; AlertWindow.cpp:202-216,
// BannerMessageHandler.cpp:730-740); "System Sounds" for the feedback
// sounds (keyboard clicks, closing a card), "Keyboard clicks" for the
// keyboard's.
//
// Repeat alerts (Phoenix; the community's Notification Repeat patches,
// docs/M6-PLAN.md F4): system preference notificationRepeat {enabled,
// minutes, apps: {appId: false}}: the shell sounds an app's notification
// again every so many minutes until it is seen.

import { useEffect, useRef, useState } from "react";
import { audio, keyboardPrefs, system, withTapSounds, type AudioStream, type Ringtone, type SystemPreferences } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Group, ListSelector, Note, Page, PageHeader, Row, Slider, ToggleButton } from "@phoenix/ui";

// Until the list arrives: the default (runtime defaultPrefs, LunaSysMgr's
// ringtone preference).
// The apps the patches repeated for (Messaging, Email, Phone, Calendar);
// any other app repeats too unless it is turned off here.
const REPEAT_APPS = [
    { id: "org.webosphoenix.messaging", title: "Messaging" },
    { id: "org.webosphoenix.phone", title: "Phone" },
    { id: "com.palm.app.email", title: "Email" },
    { id: "com.palm.app.calendar", title: "Calendar" },
];
const REPEAT_MINUTES = [1, 2, 5, 10, 15];

const DEFAULT_RINGTONE: Ringtone = { name: "Ringtone", fullPath: "/usr/palm/sounds/ringtone.mp3", system: true };
// The alert and notification tones LunaSysMgr shipped and defaults to
// (Settings.cpp:103-108, conf/defaultPreferences.txt); either tone may
// also be any ringtone.
export const SYSTEM_TONES: Ringtone[] = [
    { name: "Alert", fullPath: "/usr/palm/sounds/alert.wav", system: true },
    { name: "Notification", fullPath: "/usr/palm/sounds/notification.wav", system: true },
];
type ToneKey = "ringtone" | "alerttone" | "notificationtone";

/** The choices for a tone: [label, fullPath], the current one kept when it is not in the list. */
export function toneOptions(list: Ringtone[], current: { name: string; fullPath: string } | undefined) {
    const options: { label: string; value: string }[] = [];
    for (const t of list)
        if (!options.some((o) => o.value === t.fullPath)) options.push({ label: t.name, value: t.fullPath });
    if (current && !options.some((o) => o.value === current.fullPath))
        options.push({ label: current.name, value: current.fullPath });
    return options;
}

function VolumeRow({ title, value, onChange, testId }: { title: string; value: number | undefined; onChange: (v: number) => void; testId: string }) {
    const [drag, setDrag] = useState<number | null>(null);
    return (
        <div className="volume-row">
            <div className="volume-title">{title}</div>
            <Slider value={drag ?? value ?? 0} disabled={value === undefined} label={title} testId={testId}
                    onChange={setDrag} onChangeComplete={(v) => { setDrag(null); onChange(v); }} />
        </div>
    );
}

function StreamVolume({ title, stream }: { title: string; stream: AudioStream }) {
    const v = useLuna<number>((cb, err) => audio.watchStream(stream, cb, err), [stream]).value;
    return <VolumeRow title={title} value={v} testId={`volume-${stream}`} onChange={(x) => void audio.setStreamVolume(stream, x)} />;
}

export function SoundsPage() {
    const master = useLuna<{ volume: number; muted: boolean }>((cb, err) => audio.watchMaster(cb, err), []).value;
    const prefs = useLuna<SystemPreferences>((cb, err) => system.watchPreferences(["systemSounds", "ringtone", "alerttone", "notificationtone", "x_palm_virtualkeyboard_prefs", "notificationRepeat"], cb, err), []).value ?? {};
    const [ringtones, setRingtones] = useState<Ringtone[]>([DEFAULT_RINGTONE]);
    useEffect(() => {
        let live = true;
        system.ringtones().then((list) => { if (live && list.length) setRingtones(list); }).catch(() => {});
        return () => { live = false; };
    }, []);
    // A short sample of the tone just picked, as the picker played it, on
    // the stream it will play on (the Ringer or Alerts volume).
    const preview = useRef<string | null>(null);
    const sample = (fullPath: string, stream: AudioStream) => {
        if (preview.current) void audio.stopSound(preview.current).catch(() => {});
        audio.playSound(fullPath, stream, { duration: 3000 }).then((id) => { preview.current = id; }).catch(() => {});
    };
    const tones = SYSTEM_TONES.concat(ringtones);
    const pick = (key: ToneKey, list: Ringtone[], stream: AudioStream) => (fullPath: string) => {
        const r = list.find((x) => x.fullPath === fullPath);
        if (!r) return;
        void system.setPreferences({ [key]: { name: r.name, fullPath: r.fullPath } });
        sample(r.fullPath, stream);
    };
    const toneSelector = (title: string, key: ToneKey, list: Ringtone[], fallback: Ringtone, stream: AudioStream) => (
        <ListSelector title={title} value={prefs[key]?.fullPath ?? fallback.fullPath} options={toneOptions(list, prefs[key])}
                      testId={key} onChange={pick(key, list, stream)} />
    );
    const tapSounds = keyboardPrefs(prefs.x_palm_virtualkeyboard_prefs).TapSounds !== false;
    const repeat = { enabled: false, minutes: 2, apps: {} as Record<string, boolean>, ...prefs.notificationRepeat };
    const setRepeat = (changes: Partial<typeof repeat>) => void system.setPreferences({ notificationRepeat: { ...repeat, ...changes } });
    return (
        <Page>
            <PageHeader title="Sounds & Ringtones" icon="icons/sounds.png" />
            <Group>
                <Row title="Mute all sounds">
                    <ToggleButton value={!!master?.muted} disabled={!master} label="Mute all sounds" testId="mute-toggle"
                                  onChange={(v) => void audio.setMuted(v)} />
                </Row>
            </Group>

            <Group label="Volume">
                <VolumeRow title="Master" value={master?.volume} testId="volume-master"
                           onChange={(v) => void audio.setMasterVolume(v)} />
                <StreamVolume title="Ringer" stream="pringtones" />
                <StreamVolume title="Alerts & notifications" stream="palerts" />
                <StreamVolume title="System sounds" stream="pfeedback" />
                <StreamVolume title="Media" stream="pmedia" />
            </Group>

            <Group label="Ringtones & Alerts">
                {toneSelector("Ringtone", "ringtone", ringtones, DEFAULT_RINGTONE, "pringtones")}
                {toneSelector("Alert tone", "alerttone", tones, SYSTEM_TONES[0], "palerts")}
                {toneSelector("Notification tone", "notificationtone", tones, SYSTEM_TONES[1], "palerts")}
            </Group>
            <Note>The alert tone sounds for alarms and reminders, the notification tone for new messages and other notifications.</Note>

            <Group label="Repeat alerts">
                <Row title="Repeat until seen" subtitle="A notification sounds again until you look at it">
                    <ToggleButton value={!!repeat.enabled} label="Repeat until seen" testId="repeat-toggle"
                                  onChange={(v) => setRepeat({ enabled: v })} />
                </Row>
                <ListSelector title="Every" value={repeat.minutes ?? 2} disabled={!repeat.enabled} testId="repeat-minutes"
                              options={REPEAT_MINUTES.map((n) => ({ label: n === 1 ? "1 minute" : `${n} minutes`, value: n }))}
                              onChange={(v) => setRepeat({ minutes: v })} />
                {REPEAT_APPS.map((a) => (
                    <Row key={a.id} title={a.title} disabled={!repeat.enabled} testId={`repeat-app-${a.id}`}>
                        <ToggleButton value={repeat.apps?.[a.id] !== false} label={`Repeat for ${a.title}`} disabled={!repeat.enabled}
                                      testId={`repeat-app-toggle-${a.id}`}
                                      onChange={(v) => setRepeat({ apps: { ...repeat.apps, [a.id]: v } })} />
                    </Row>
                ))}
            </Group>

            <Group label="System sounds">
                <Row title="System sounds">
                    <ToggleButton value={prefs.systemSounds !== false} label="System sounds" testId="system-sounds"
                                  onChange={(v) => {
                                      void system.setPreferences({ systemSounds: v });
                                      if (v) void audio.playFeedback("key").catch(() => {});
                                  }} />
                </Row>
                <Row title="Keyboard clicks">
                    <ToggleButton value={tapSounds} label="Keyboard clicks" testId="keyboard-clicks"
                                  onChange={(v) => void system.setPreferences({
                                      x_palm_virtualkeyboard_prefs: withTapSounds(prefs.x_palm_virtualkeyboard_prefs, v) })} />
                </Row>
            </Group>
        </Page>
    );
}
