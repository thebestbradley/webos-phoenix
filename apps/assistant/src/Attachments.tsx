// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What an answer found, under its words (the message's data.attachments,
// apps/assistant/service/assistant.js outcome; the shell's view draws the
// same in AssistantAttachments.qml):
//   {type: "images", total, items: [{path, open}]}  thumbnails, "+N more"
//   {type: "cards", items: [{title, subtitle?, detail?, open?}]}  a card each
//   {type: "examples", title, items: [{text}]}  things to ask (help), by app
// A tap shows it in its app, or asks the example: choose "show:<index>",
// index across every attachment's items. The conversation stays where it is.

import type { AssistantMessage } from "@phoenix/luna";
import { useMediaUrl } from "@phoenix/luna/react";
import "./attachments.css";

export interface ShownItem { path?: string; title?: string; subtitle?: string; detail?: string; text?: string; open?: { appId: string } }
export interface Attachment { type: "images" | "cards" | "examples"; title?: string; total?: number; items: ShownItem[] }

export function attachmentsOf(m: AssistantMessage): Attachment[] {
    const a = m.data?.attachments;
    return m.role === "assistant" && Array.isArray(a) ? (a as Attachment[]) : [];
}

function Thumb({ path, onClick, index }: { path: string; onClick: () => void; index: number }) {
    const url = useMediaUrl(path);
    return (
        <button type="button" className="as-thumb" data-testid={`as-thumb-${index}`} onClick={onClick} aria-label={path.replace(/^.*\//, "")}>
            {url && <img src={url} alt="" loading="lazy" />}
        </button>
    );
}

export function Attachments({ m, onShow }: { m: AssistantMessage; onShow: (index: number) => void }) {
    const list = attachmentsOf(m);
    if (!list.length) return null;
    let base = 0;
    return (
        <div className="as-found" data-testid={`as-found-${m.id}`}>
            {list.map((a, k) => {
                const first = base;
                base += a.items.length;
                if (a.type === "images") {
                    const more = (a.total ?? a.items.length) - a.items.length;
                    return (
                        <div key={k} className="as-thumbs">
                            {a.items.map((it, i) => it.path && <Thumb key={it.path} path={it.path} index={first + i} onClick={() => onShow(first + i)} />)}
                            {more > 0 && <span className="as-more">+{more} more</span>}
                        </div>
                    );
                }
                if (a.type === "examples") {
                    if (!a.items.length) return null;
                    return (
                        <div key={k} className="as-examples-group" data-testid={`as-help-${k}`}>
                            {a.title && <div className="as-examples-title">{a.title}</div>}
                            <div className="as-thumbs">
                                {a.items.map((it, i) => (
                                    <button type="button" key={i} className="as-chip" data-testid={`as-ex-${first + i}`} onClick={() => onShow(first + i)}>{it.text}</button>
                                ))}
                            </div>
                        </div>
                    );
                }
                return (
                    <div key={k} className="as-cards">
                        {a.items.map((it, i) => (
                            <button type="button" key={i} className="as-card" data-testid={`as-card-${first + i}`} disabled={!it.open}
                                    onClick={() => onShow(first + i)}>
                                <span className="as-card-title">{it.title}</span>
                                {it.subtitle && <span className="as-card-sub">{it.subtitle}</span>}
                                {it.detail && <span className="as-card-detail">{it.detail}</span>}
                            </button>
                        ))}
                    </div>
                );
            })}
        </div>
    );
}
