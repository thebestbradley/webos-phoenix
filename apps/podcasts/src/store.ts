// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Subscriptions and episodes in db8, downloads, and the background refresh.
//
//   org.webosphoenix.podcast:1          feedUrl, title, author, description,
//       image, link, subscribed, lastRefresh, lastError
//   org.webosphoenix.podcast.episode:1  podcastId, guid, title, description,
//       published, duration, url, type, length, position (s), played,
//       file (downloaded path), downloadedSize
//
//   Feeds: HTTP GET (web.ts), parsed by feed.ts.
//   Downloads: com.webos.service.downloadmanager download {target,
//       targetDir: /media/internal/podcasts/<podcast>, targetFilename}, as
//       the browser downloads; the files are then in Files as well.
//   Removing a download: org.webosphoenix.service.mediafiles remove (the
//       Camera's way to delete a file under /media/internal).
//   Background refresh: an activity (com.palm.activitymanager create) whose
//       callback launches the app with {refresh: true} every few hours;
//       each run schedules the next, as the Clock schedules alarms.

import { call, db, downloadManager, httpText, LunaError, mediaFiles, postNotification, type DbObject, type DownloadHandle } from "@phoenix/luna";
import { parseFeed, type Feed, type FeedEpisode } from "./feed";

export const APP_ID = "org.webosphoenix.podcasts";
export const PODCAST_KIND = "org.webosphoenix.podcast:1";
export const EPISODE_KIND = "org.webosphoenix.podcast.episode:1";
export const DOWNLOAD_ROOT = "/media/internal/podcasts";
export const REFRESH_ACTIVITY = `${APP_ID}.refresh`;
/** Hours between background refreshes. */
export const REFRESH_HOURS = 6;
/** Episodes kept per podcast (the newest); older ones are dropped unless downloaded or started. */
export const KEEP_EPISODES = 100;

export interface Podcast extends DbObject {
    feedUrl: string;
    title: string;
    author: string;
    description: string;
    image?: string;
    link?: string;
    subscribed: number;
    lastRefresh?: number;
    lastError?: string;
}

export interface Episode extends DbObject {
    podcastId: string;
    guid: string;
    title: string;
    description: string;
    published: number;
    duration: number;
    url: string;
    type: string;
    length: number;
    /** Seconds listened. */
    position: number;
    played: boolean;
    /** The downloaded file, when there is one. */
    file?: string;
    downloadedSize?: number;
    image?: string;
}

// ---- Merging a refreshed feed ----------------------------------------------------------

/**
 * The episodes to store after a refresh: new ones added, known ones
 * updated from the feed but keeping where the listener was and what was
 * downloaded; gone ones dropped unless downloaded or started. Returns the
 * objects to put, the ids to delete and how many are new.
 */
export function mergeEpisodes(podcastId: string, feed: FeedEpisode[], stored: Episode[], firstTime: boolean):
    { put: Episode[]; del: string[]; added: number } {
    const byGuid = new Map(stored.map((e) => [e.guid, e]));
    const keep = feed.slice(0, KEEP_EPISODES);
    const seen = new Set<string>();
    const put: Episode[] = [];
    let added = 0;
    keep.forEach((f, i) => {
        seen.add(f.guid);
        const old = byGuid.get(f.guid);
        if (!old) added++;
        put.push({
            ...(old ?? {}),
            _kind: EPISODE_KIND,
            podcastId, guid: f.guid, title: f.title, description: f.description, published: f.published,
            duration: f.duration || old?.duration || 0, url: f.url, type: f.type, length: f.length, image: f.image,
            position: old?.position ?? 0,
            // Subscribing marks the back catalogue as played, except the newest episode.
            played: old?.played ?? (firstTime && i > 0),
            file: old?.file, downloadedSize: old?.downloadedSize,
        });
    });
    const del = stored.filter((e) => !seen.has(e.guid) && !e.file && !e.position && e._id).map((e) => e._id!);
    return { put, del, added: firstTime ? 0 : added };
}

// ---- Feeds ---------------------------------------------------------------------------

export async function fetchFeed(url: string): Promise<Feed> {
    return parseFeed(await httpText(url), url);
}

export const podcasts = {
    async list(): Promise<Podcast[]> {
        return db.find<Podcast>({ from: PODCAST_KIND, orderBy: "title", limit: 500 });
    },
    async episodes(podcastId: string): Promise<Episode[]> {
        return db.find<Episode>({ from: EPISODE_KIND, where: [{ prop: "podcastId", op: "=", val: podcastId }], limit: 500 });
    },
    async allEpisodes(): Promise<Episode[]> {
        return db.find<Episode>({ from: EPISODE_KIND, limit: 500 });
    },
    async byUrl(feedUrl: string): Promise<Podcast | undefined> {
        return (await db.find<Podcast>({ from: PODCAST_KIND, where: [{ prop: "feedUrl", op: "=", val: feedUrl }], limit: 1 }))[0];
    },

    /** Fetch the feed and subscribe. Resolves with the podcast (the one already there if subscribed). */
    async subscribe(feedUrl: string): Promise<Podcast> {
        const existing = await podcasts.byUrl(feedUrl);
        if (existing) return existing;
        const feed = await fetchFeed(feedUrl);
        const p: Podcast = {
            _kind: PODCAST_KIND, feedUrl, title: feed.title, author: feed.author, description: feed.description,
            image: feed.image, link: feed.link, subscribed: Date.now(), lastRefresh: Date.now(),
        };
        const [r] = await db.put([p]);
        p._id = r.id;
        const m = mergeEpisodes(r.id, feed.episodes, [], true);
        if (m.put.length) await db.put(m.put);
        return p;
    },

    /** Fetch the feed again. Resolves with how many episodes are new. */
    async refresh(p: Podcast): Promise<number> {
        try {
            const feed = await fetchFeed(p.feedUrl);
            const stored = await podcasts.episodes(p._id!);
            const m = mergeEpisodes(p._id!, feed.episodes, stored, false);
            if (m.put.length) await db.put(m.put);
            if (m.del.length) await db.del(m.del);
            await db.merge([{ _id: p._id!, title: feed.title || p.title, author: feed.author, description: feed.description,
                              image: feed.image ?? p.image, lastRefresh: Date.now(), lastError: "" }]);
            return m.added;
        } catch (e) {
            await db.merge([{ _id: p._id!, lastError: e instanceof Error ? e.message : String(e) }]).catch(() => undefined);
            throw e;
        }
    },

    async refreshAll(): Promise<{ added: number; failed: number }> {
        let added = 0, failed = 0;
        for (const p of await podcasts.list()) {
            try { added += await podcasts.refresh(p); } catch { failed++; }
        }
        return { added, failed };
    },

    /** Unsubscribe: the podcast, its episodes and their downloads. */
    async unsubscribe(p: Podcast): Promise<void> {
        const eps = await podcasts.episodes(p._id!);
        for (const e of eps) if (e.file) await mediaFiles.remove(e.file).catch(() => undefined);
        if (eps.length) await db.del(eps.map((e) => e._id!));
        await db.del([p._id!]);
    },

    async saveProgress(e: Episode, position: number, duration?: number): Promise<void> {
        const done = !!duration && position >= duration - 5;
        await db.merge([{ _id: e._id!, position: done ? 0 : Math.floor(position), played: done || e.played, ...(duration ? { duration: Math.round(duration) } : {}) }]);
    },
    async setPlayed(ids: string[], played: boolean): Promise<void> {
        if (ids.length) await db.merge(ids.map((_id) => ({ _id, played, position: 0 })));
    },
};

// ---- Downloads -----------------------------------------------------------------------

/** A folder name for a podcast: "Harbor Radio" -> "harbor-radio". */
export function slug(s: string): string {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "podcast";
}

const EXT_BY_TYPE: Record<string, string> = { "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac",
    "audio/ogg": "ogg", "audio/opus": "opus", "audio/wav": "wav", "video/mp4": "mp4", "video/webm": "webm" };

/** The file name for an episode's download. */
export function episodeFileName(e: Pick<Episode, "title" | "url" | "type" | "published">): string {
    const fromUrl = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(e.url.replace(/[?#].*$/, ""))?.[1]?.toLowerCase();
    const ext = fromUrl ?? EXT_BY_TYPE[e.type] ?? "mp3";
    const day = e.published ? new Date(e.published).toISOString().slice(0, 10) + "-" : "";
    return `${day}${slug(e.title)}.${ext}`;
}

export function downloadEpisode(p: Podcast, e: Episode, onProgress: (f: number) => void): DownloadHandle {
    const dir = `${DOWNLOAD_ROOT}/${slug(p.title)}`;
    const h = downloadManager.download(e.url, dir, episodeFileName(e), (f) => onProgress(f));
    return {
        cancel: h.cancel,
        done: h.done.then(async (path) => {
            await db.merge([{ _id: e._id!, file: path }]);
            return path;
        }),
    };
}

export async function deleteDownload(e: Episode): Promise<void> {
    if (e.file) await mediaFiles.remove(e.file).catch(() => undefined);
    await db.merge([{ _id: e._id!, file: "", downloadedSize: 0 }]);
}

// ---- Background refresh ----------------------------------------------------------------

/** "2026-09-28 14:05:00Z", the activity manager's schedule format (UTC). */
export function activityDate(ms: number): string {
    return new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

/** (Re)schedule the next background refresh, REFRESH_HOURS from now. */
export async function scheduleRefresh(now = Date.now()): Promise<void> {
    await call("luna://com.palm.activitymanager/create", {
        start: true,
        replace: true,
        activity: {
            name: REFRESH_ACTIVITY,
            description: "Podcasts: look for new episodes",
            type: { background: true, persist: true },
            requirements: { internet: true },
            schedule: { start: activityDate(now + REFRESH_HOURS * 3600_000) },
            callback: { method: "palm://com.palm.applicationManager/launch", params: { id: APP_ID, params: { refresh: true } } },
        },
    });
}

/**
 * The refresh activity fired: complete it, refresh every podcast, say how
 * many episodes are new (a notification), and schedule the next one.
 */
export async function backgroundRefresh(): Promise<number> {
    try { await call("luna://com.palm.activitymanager/complete", { activityName: REFRESH_ACTIVITY }); } catch (e) { if (!(e instanceof LunaError)) throw e; }
    const { added } = await podcasts.refreshAll();
    if (added > 0) postNotification({ appId: APP_ID, title: "Podcasts", body: `${added} new episode${added === 1 ? "" : "s"}`, params: { newEpisodes: true } });
    await scheduleRefresh().catch(() => undefined);
    return added;
}

/** Make sure a refresh is scheduled (on start). */
export async function ensureRefreshScheduled(): Promise<void> {
    try {
        await call("luna://com.palm.activitymanager/getDetails", { activityName: REFRESH_ACTIVITY });
    } catch {
        await scheduleRefresh().catch(() => undefined);
    }
}
