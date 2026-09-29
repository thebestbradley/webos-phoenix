// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Sounds & Ringtones (com.palm.app.soundsandalerts): mute, volumes, the
// ringtone, "System Sounds" and the keyboard's clicks.
// Services: com.webos.service.audio master/getVolume, master/setVolume,
// master/muteVolume, getInputVolume / setInputVolume (streamType
// pringtones, palerts, pfeedback, pmedia), playFeedback, playSound;
// com.webos.service.systemservice get/setPreferences (systemSounds,
// ringtone, x_palm_virtualkeyboard_prefs), ringtone/listRingtones.
//
// The shell plays what these set (shell/qml/Phoenix/Shell/SystemSounds.qml):
// the ringtone for incoming calls, "System Sounds" for the feedback sounds
// (keyboard clicks, closing a card), "Keyboard clicks" for the keyboard's.

import { useEffect, useRef, useState } from "react";
import { audio, keyboardPrefs, system, withTapSounds, type AudioStream, type Ringtone, type SystemPreferences } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Group, ListSelector, Page, PageHeader, Row, Slider, ToggleButton } from "@phoenix/ui";

// Until the list arrives: the default (runtime defaultPrefs, LunaSysMgr's
// ringtone preference).
const DEFAULT_RINGTONE: Ringtone = { name: "Ringtone", fullPath: "/usr/palm/sounds/ringtone.mp3", system: true };

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
    const prefs = useLuna<SystemPreferences>((cb, err) => system.watchPreferences(["systemSounds", "ringtone", "x_palm_virtualkeyboard_prefs"], cb, err), []).value ?? {};
    const [ringtones, setRingtones] = useState<Ringtone[]>([DEFAULT_RINGTONE]);
    useEffect(() => {
        let live = true;
        system.ringtones().then((list) => { if (live && list.length) setRingtones(list); }).catch(() => {});
        return () => { live = false; };
    }, []);
    // A short sample of the ringtone just picked, as the picker played it.
    const preview = useRef<string | null>(null);
    const sample = (fullPath: string) => {
        if (preview.current) void audio.stopSound(preview.current).catch(() => {});
        audio.playSound(fullPath, "pringtones", { duration: 3000 }).then((id) => { preview.current = id; }).catch(() => {});
    };
    const current = prefs.ringtone?.fullPath ?? DEFAULT_RINGTONE.fullPath;
    const options = ringtones.map((r) => ({ label: r.name, value: r.fullPath }));
    if (!options.some((o) => o.value === current) && prefs.ringtone)
        options.push({ label: prefs.ringtone.name, value: prefs.ringtone.fullPath });
    const tapSounds = keyboardPrefs(prefs.x_palm_virtualkeyboard_prefs).TapSounds !== false;
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

            <Group label="Ringtones">
                <ListSelector title="Ringtone" value={current} options={options} testId="ringtone"
                              onChange={(fullPath) => {
                                  const r = ringtones.find((x) => x.fullPath === fullPath);
                                  if (!r) return;
                                  void system.setPreferences({ ringtone: { name: r.name, fullPath: r.fullPath } });
                                  sample(r.fullPath);
                              }} />
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
