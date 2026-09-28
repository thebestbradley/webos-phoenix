// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The message field at the bottom of a conversation: which transport it
// goes by (only SMS works; the IM transports webOS offered are listed but
// unavailable), the text, and Send. Enter sends, as on webOS.

import { useRef, useState } from "react";
import { TRANSPORTS } from "@phoenix/luna";
import { PopupMenu } from "@phoenix/ui";
import { SendArrow } from "../icons";

export function ComposeBar({ onSend, disabled, autoFocus }: { onSend: (text: string) => void; disabled?: boolean; autoFocus?: boolean }) {
    const [text, setText] = useState("");
    const [transport, setTransport] = useState("sms");
    const [open, setOpen] = useState(false);
    const pill = useRef<HTMLButtonElement>(null);
    const send = () => {
        const t = text.trim();
        if (!t || disabled) return;
        onSend(t);
        setText("");
    };
    const current = TRANSPORTS.find((t) => t.id === transport)!;
    return (
        <div className="compose-bar">
            <button ref={pill} type="button" className="transport-pill" data-testid="transport" onClick={() => setOpen(true)}
                    aria-label={`Send as ${current.label}`}>
                {current.id === "sms" ? "SMS" : current.label}<span className="pui-row-arrow" />
            </button>
            <div className="compose-field">
                <textarea data-testid="message-input" rows={1} value={text} placeholder="Enter message here…"
                          autoFocus={autoFocus} maxLength={1600}
                          onChange={(e) => setText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            </div>
            <button type="button" className="send-button" data-testid="send" onClick={send}
                    disabled={disabled || !text.trim()} aria-label="Send"><SendArrow /></button>
            {open && (
                <PopupMenu anchor={pill.current} value={transport} onClose={() => setOpen(false)} onSelect={setTransport}
                           options={TRANSPORTS.map((t) => ({ value: t.id, disabled: !t.available,
                               label: t.available ? t.label : <>{t.label} <small className="unavailable">not available yet</small></> }))} />
            )}
        </div>
    );
}
