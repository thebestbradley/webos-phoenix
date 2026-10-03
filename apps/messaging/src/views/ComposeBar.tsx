// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The message field at the bottom of a conversation: which transport it
// goes by, a picture to attach, the text, and Send. Enter sends, as on
// webOS.
//
// The transport is the conversation's: a text (SMS) to a phone number,
// which becomes a picture message (MMS) once a picture is attached, or the
// IM service of a buddy (Jabber). Tapping it lists them, with the IM
// networks webOS had that Phoenix cannot reach greyed out. A picture comes
// from the system's picture picker (org.webosphoenix.filepicker/pick); it
// waits above the field until it is sent or taken off.

import { useEffect, useRef, useState } from "react";
import { filePicker, IM_SERVICES, isImService, serviceLabel, type MessagePart } from "@phoenix/luna";
import { useFileUrl } from "@phoenix/luna/react";
import { PopupMenu } from "@phoenix/ui";
import { AttachPicture, SendArrow } from "../icons";

function Staged({ part, onRemove }: { part: MessagePart; onRemove: () => void }) {
    const url = useFileUrl(part.path);
    return (
        <div className="staged-part" data-testid="staged-picture">
            {url ? <img src={url} alt="" /> : <span className="staged-blank" />}
            <span className="staged-name">{part.name ?? part.path.replace(/^.*\//, "")}</span>
            <button type="button" className="staged-remove" aria-label="Remove picture" data-testid="remove-picture" onClick={onRemove}>×</button>
        </div>
    );
}

export function ComposeBar({ onSend, disabled, autoFocus, initialText, initialParts, service = "sms" }: {
    onSend: (text: string, parts: MessagePart[]) => void;
    disabled?: boolean;
    autoFocus?: boolean;
    initialText?: string;
    initialParts?: MessagePart[];
    /** The conversation's transport: "sms", or an IM service ("type_jabber"). */
    service?: string;
}) {
    const [text, setText] = useState(initialText ?? "");
    const [parts, setParts] = useState<MessagePart[]>(initialParts ?? []);
    const [open, setOpen] = useState(false);
    const [picking, setPicking] = useState(false);
    const pill = useRef<HTMLButtonElement>(null);
    const im = isImService(service);
    // IM sends text only: a waiting picture is taken off when the message
    // turns into an instant message (a buddy chosen in "To:").
    useEffect(() => { if (im) setParts([]); }, [im]);
    const send = () => {
        const t = text.trim();
        if ((!t && !parts.length) || disabled) return;
        onSend(t, parts);
        setText("");
        setParts([]);
    };
    const attach = async () => {
        if (picking) return;
        setPicking(true);
        try {
            const r = await filePicker.pick({ kinds: ["image"], title: "Attach a Picture" });
            if ("files" in r && r.files[0])
                setParts([{ path: r.files[0].fullPath, mimeType: r.files[0].mimeType || "image/jpeg", name: r.files[0].name }]);
        } catch { /* no picker */ }
        setPicking(false);
    };
    const label = im ? serviceLabel(service).replace(/ \(.*\)$/, "") : parts.length ? "MMS" : "SMS";
    const options = [
        { value: im ? service : "sms", label: im ? serviceLabel(service) : parts.length ? "Picture (MMS)" : "Text (SMS)" },
        ...IM_SERVICES.filter((s) => !s.available).map((s) => ({
            value: s.id, disabled: true, label: <>{s.label} <small className="unavailable">not available</small></> })),
    ];
    return (
        <div className="compose-bar-wrap">
            {parts.length > 0 && (
                <div className="staged">
                    {parts.map((p, i) => <Staged key={p.path} part={p} onRemove={() => setParts(parts.filter((_, j) => j !== i))} />)}
                </div>
            )}
            <div className="compose-bar">
                <button ref={pill} type="button" className="transport-pill" data-testid="transport" onClick={() => setOpen(true)}
                        aria-label={`Send as ${label}`}>
                    {label}<span className="pui-row-arrow" />
                </button>
                {!im && (
                    <button type="button" className="attach-button" data-testid="attach" onClick={() => void attach()}
                            disabled={disabled || picking} aria-label="Attach a picture"><AttachPicture /></button>
                )}
                <div className="compose-field">
                    <textarea data-testid="message-input" rows={1} value={text} placeholder="Enter message here…"
                              autoFocus={autoFocus} maxLength={1600}
                              onChange={(e) => setText(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
                </div>
                <button type="button" className="send-button" data-testid="send" onClick={send}
                        disabled={disabled || (!text.trim() && !parts.length)} aria-label="Send"><SendArrow /></button>
                {open && (
                    <PopupMenu anchor={pill.current} value={options[0].value} onClose={() => setOpen(false)} onSelect={() => undefined}
                               options={options} />
                )}
            </div>
        </div>
    );
}
