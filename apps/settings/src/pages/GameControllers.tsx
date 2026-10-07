// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Game Controllers (Phoenix; docs/M6-PLAN.md F4 item 8, after the webOS
// Archive's Bluetooth Gamepad support): the controllers connected over
// Bluetooth or USB, as web apps see them through the Gamepad API
// (org.webosphoenix.gamepads/list), and a test of their buttons. A
// Bluetooth controller is paired in Settings > Bluetooth; a USB one works
// when it is plugged in.

import { gamepads, type GamepadInfo } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Group, Note, Page, PageHeader, Row } from "@phoenix/ui";

// The standard mapping's buttons (w3c.github.io/gamepad, "Standard Gamepad").
const NAMES = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back", "Start", "LS", "RS", "Up", "Down", "Left", "Right", "Home"];

export function connectionText(p: GamepadInfo): string {
    return p.connection === "bluetooth" ? "Bluetooth" : p.connection === "usb" ? "USB" : "Connected";
}

export function GameControllersPage() {
    const pads = useLuna<GamepadInfo[]>((cb, err) => gamepads.watch(cb, err), []).value;
    return (
        <Page>
            <PageHeader title="Game Controllers" icon="icons/gamepads.png" />
            {pads && pads.length === 0 && (
                <Note testId="gp-none">No game controllers. Pair a Bluetooth controller in Settings &gt; Bluetooth, or plug one in
                    with a USB cable.</Note>
            )}
            {pads && pads.map((p) => (
                <Group key={p.index} label={p.name}>
                    <Row title={connectionText(p)} subtitle={p.mapping === "standard" ? "Standard layout" : "Its own layout"}
                         testId={`gp-pad-${p.index}`} />
                    <div className="gp-buttons" data-testid={`gp-buttons-${p.index}`}>
                        {NAMES.map((n, i) => (
                            <span key={n} className={"gp-button" + (p.buttons.includes(i) ? " gp-pressed" : "")}>{n}</span>
                        ))}
                    </div>
                </Group>
            ))}
            <Note>Games and other web apps use the controllers through the Gamepad API. Press a button to test it.</Note>
        </Page>
    );
}
