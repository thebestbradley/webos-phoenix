// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Help: short topics on the gestures, cards, the launcher, notifications,
// Just Type and each app, after the webOS Help app (a list of topics, each
// a short page). The topics are Markdown files in apps/help/topics, easy to
// edit; they are bundled with the app and indexed in db8 for Just Type
// (see lib/topics.ts and vite.config.ts).
//
// Phone: the list, or one topic (the back gesture returns). Tablet: the
// list on the left, the topic on the right.
//
// Launch params: {topic: id} opens a topic (Just Type's content search
// passes the topic's db8 _id, "help-" + id), {search: text} starts a search.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apps, db, type DbObject } from "@phoenix/luna";
import { useLaunchParams } from "@phoenix/luna/react";
import { BackProvider, Button, Divider, Group, Note, Page, PageHeader, Row, useBack } from "@phoenix/ui";
import { parseMarkdown, type Block, type Inline } from "./lib/markdown";
import { buildIndex, CATEGORIES, parseTopic, search, sortTopics, type Topic } from "./lib/topics";

const files = import.meta.glob("../topics/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
export const TOPICS: Topic[] = sortTopics(Object.entries(files).map(([f, src]) => parseTopic(f, src)));

const HELP_KIND = "org.webosphoenix.helptopic:1";

/**
 * Put the topics into db8 for Just Type when they changed (the simulator's
 * runtime also does it at boot; on a device Help does it when it runs).
 */
async function indexTopics() {
    const index = buildIndex(TOPICS);
    try {
        const have = await db.find<DbObject & { version?: string }>({ from: HELP_KIND, limit: 1 });
        if (have[0]?.version === index.version) return;
        await db.delWhere({ from: HELP_KIND });
        await db.put(index.topics.map((t) => ({
            _kind: HELP_KIND, _id: `help-${t.id}`, topicId: t.id, title: t.title, summary: t.summary,
            category: t.category, searchText: t.searchText, version: index.version,
        })));
    } catch { /* no db8: Just Type will not find help */ }
}

function useWide(): boolean {
    const q = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(min-width: 700px)") : null;
    const [wide, setWide] = useState(!!q?.matches);
    useEffect(() => {
        if (!q) return;
        const on = () => setWide(q.matches);
        q.addEventListener("change", on);
        return () => q.removeEventListener("change", on);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return wide;
}

// ---- Rendering Markdown -----------------------------------------------------------------

function renderInline(nodes: Inline[], open: (href: string) => void): ReactNode[] {
    return nodes.map((n, i) => {
        switch (n.t) {
        case "text": return n.text;
        case "strong": return <strong key={i}>{renderInline(n.children, open)}</strong>;
        case "em": return <em key={i}>{renderInline(n.children, open)}</em>;
        case "code": return <code key={i}>{n.text}</code>;
        case "link":
            return (
                <a key={i} href={n.href} className={n.href.startsWith("topic:") ? "help-topic-link" : undefined}
                   onClick={(e) => { e.preventDefault(); open(n.href); }}>
                    {renderInline(n.children, open)}
                </a>
            );
        }
    });
}

function Markdown({ blocks, open }: { blocks: Block[]; open: (href: string) => void }) {
    return (
        <>
            {blocks.map((b, i) => {
                switch (b.t) {
                case "h2": return <h2 key={i}>{renderInline(b.children, open)}</h2>;
                case "h3": return <h3 key={i}>{renderInline(b.children, open)}</h3>;
                case "p": return <p key={i}>{renderInline(b.children, open)}</p>;
                case "quote": return <div key={i} className="help-tip">{renderInline(b.children, open)}</div>;
                case "ul": return <ul key={i}>{b.items.map((it, j) => <li key={j}>{renderInline(it, open)}</li>)}</ul>;
                case "ol": return <ol key={i}>{b.items.map((it, j) => <li key={j}>{renderInline(it, open)}</li>)}</ol>;
                }
            })}
        </>
    );
}

// ---- Views ------------------------------------------------------------------------------

function TopicView({ topic, onOpen }: { topic: Topic; onOpen: (href: string) => void }) {
    const blocks = useMemo(() => parseMarkdown(topic.body), [topic]);
    const appTitle = topic.app ? TOPICS.find((t) => t.app === topic.app && t.category === "Apps")?.title ?? topic.title : null;
    return (
        <Page className="help-topic">
            <PageHeader title={topic.title} icon="icon.png" />
            <article className="help-article" data-testid="topic" data-topic={topic.id}>
                <Markdown blocks={blocks} open={onOpen} />
            </article>
            {topic.app && (
                <Button className="help-open-app" data-testid="open-app" onClick={() => void apps.launch(topic.app!)}>
                    Open {topic.app === "org.webosphoenix.settings" ? "Settings" : topic.app === "org.webosphoenix.firstuse" ? "setup" : appTitle}
                </Button>
            )}
        </Page>
    );
}

function TopicList({ query, setQuery, results, current, onPick }: {
    query: string; setQuery: (q: string) => void; results: Topic[]; current: string | null; onPick: (id: string) => void;
}) {
    const grouped = query.trim() ? [{ label: `${results.length} ${results.length === 1 ? "topic" : "topics"}`, topics: results }]
        : [...CATEGORIES, ...new Set(results.map((t) => t.category).filter((c) => !CATEGORIES.includes(c)))]
            .map((c) => ({ label: c, topics: results.filter((t) => t.category === c) }))
            .filter((g) => g.topics.length);
    return (
        <Page className="help-list">
            <PageHeader title="Help" icon="icon.png" />
            <div className="help-search">
                <input type="search" value={query} placeholder="Search help" aria-label="Search help"
                       data-testid="help-search" onChange={(e) => setQuery(e.target.value)} />
            </div>
            {grouped.map((g) => (
                <div key={g.label}>
                    <Divider caption={g.label} />
                    <Group>
                        {g.topics.map((t) => (
                            <Row key={t.id} title={t.title} subtitle={t.summary} chevron testId={`topic-${t.id}`}
                                 className={t.id === current ? "help-current" : undefined} onClick={() => onPick(t.id)} />
                        ))}
                    </Group>
                </div>
            ))}
            {query.trim() && results.length === 0 && <Note>No help topics match “{query.trim()}”.</Note>}
        </Page>
    );
}

function Help() {
    const params = useLaunchParams<{ topic?: string; search?: string }>();
    // Just Type passes the db8 _id, "help-" + the topic's id.
    const asked = params.topic?.replace(/^help-/, "");
    const wide = useWide();
    const [query, setQuery] = useState(params.search ?? "");
    const [history, setHistory] = useState<string[]>(asked ? [asked] : []);
    const current = history.length ? history[history.length - 1] : null;
    const topic = TOPICS.find((t) => t.id === current) ?? null;

    useEffect(() => { void indexTopics(); }, []);
    useEffect(() => {
        if (asked) setHistory([asked]);
        if (params.search !== undefined) { setQuery(params.search); if (!asked) setHistory([]); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params]);

    const results = useMemo(() => search(TOPICS, query), [query]);
    useBack(() => { setHistory((h) => h.slice(0, -1)); return true; }, history.length > 0 && (!wide || history.length > 1));

    const open = (href: string) => {
        if (href.startsWith("topic:")) setHistory((h) => [...h, href.slice(6)]);
        else if (href.startsWith("app:")) void apps.launch(href.slice(4));
        else void apps.launch("com.palm.app.browser", { target: href });
    };
    const pick = (id: string) => setHistory(wide ? [id] : (h) => [...h, id]);

    const list = <TopicList query={query} setQuery={setQuery} results={results} current={current} onPick={pick} />;
    if (wide) {
        const shown = topic ?? (query.trim() ? results[0] : TOPICS[0]) ?? null;
        return (
            <div className="help-wide">
                <div className="help-left">{list}</div>
                <div className="help-right">{shown && <TopicView key={shown.id} topic={shown} onOpen={open} />}</div>
            </div>
        );
    }
    return topic ? <TopicView key={topic.id} topic={topic} onOpen={open} /> : list;
}

export function App() {
    return (
        <BackProvider>
            <Help />
        </BackProvider>
    );
}
