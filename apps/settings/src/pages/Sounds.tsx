// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Sounds & Ringtones: volumes, mute, system sounds, ringtone.
// Services: com.webos.service.audio master/getVolume, master/setVolume,
// master/muteVolume, getInputVolume / setInputVolume (streamType
// pringtones, palerts, pmedia), playFeedback;
// com.webos.service.systemservice get/setPreferences (systemSounds, ringtone).

import { useState } from "react";
import { audio, system, type AudioStream, type SystemPreferences } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Group, ListSelector, Page, PageHeader, Row, Slider, ToggleButton } from "@phoenix/ui";

// The original Palm ringtones are not open source; these name the sounds a
// Phoenix image ships in /usr/share/sounds/phoenix/ringtones.
const RINGTONES = ["Phoenix", "Dawn Chorus", "Marimba", "Classic Bell", "Soft Pulse", "Ascend"].map((name) => ({
    label: name,
    value: name,
    fullPath: `/usr/share/sounds/phoenix/ringtones/${name.toLowerCase().replace(/ /g, "-")}.ogg`,
}));

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
    const prefs = useLuna<SystemPreferences>((cb, err) => system.watchPreferences(["systemSounds", "ringtone"], cb, err), []).value ?? {};
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
                <StreamVolume title="Media" stream="pmedia" />
            </Group>

            <Group label="Ringtones">
                <ListSelector title="Ringtone" value={RINGTONES.find((r) => r.value === prefs.ringtone?.name)?.value ?? RINGTONES[0].value} options={RINGTONES} testId="ringtone"
                              onChange={(name) => {
                                  const r = RINGTONES.find((x) => x.value === name)!;
                                  void system.setPreferences({ ringtone: { name: r.value, fullPath: r.fullPath } });
                              }} />
            </Group>

            <Group label="System sounds">
                <Row title="Touch sounds">
                    <ToggleButton value={prefs.systemSounds !== false} label="System sounds"
                                  onChange={(v) => {
                                      void system.setPreferences({ systemSounds: v });
                                      if (v) void audio.playFeedback("touch").catch(() => {});
                                  }} />
                </Row>
            </Group>
        </Page>
    );
}
