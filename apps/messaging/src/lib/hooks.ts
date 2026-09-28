// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from "react";
import { contacts, messaging, type ChatThread, type Message, type Person } from "@phoenix/luna";

export function usePeople(): Person[] {
    const [p, setP] = useState<Person[]>([]);
    useEffect(() => {
        const sub = contacts.watchAll(setP);
        return () => sub.cancel();
    }, []);
    return p;
}

export function useThreads(): ChatThread[] | null {
    const [t, setT] = useState<ChatThread[] | null>(null);
    useEffect(() => {
        const sub = messaging.watchThreads(setT);
        return () => sub.cancel();
    }, []);
    return t;
}

export function useMessages(threadId: string | null): Message[] | null {
    const [m, setM] = useState<Message[] | null>(null);
    useEffect(() => {
        setM(null);
        if (!threadId) return;
        const sub = messaging.watchMessages(threadId, setM);
        return () => sub.cancel();
    }, [threadId]);
    return m;
}

export function useWide(query = "(min-width: 700px)"): boolean {
    const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query) : null;
    const [wide, setWide] = useState(!!mq?.matches);
    useEffect(() => {
        if (!mq) return;
        const on = () => setWide(mq.matches);
        mq.addEventListener("change", on);
        return () => mq.removeEventListener("change", on);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query]);
    return wide;
}
