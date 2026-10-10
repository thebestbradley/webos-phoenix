// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device's services: files, media, playback and the media keys,
// location, device information and preferences, the clipboard, printing.
// Each is @phoenix/luna's wrapper of the OSE (or Phoenix) service, typed
// and with PhoenixErrors.

import { app } from "./app";
import { guard, PhoenixError, palmSystem, request, subscribeTo, toPhoenixError, watchLuna, type OnError, type OnValue, type Watch } from "./core";
import { fileManager, fileUrl, type FileEntry } from "../../luna/src/files";
import { mediaIndexer, type AudioItem, type ImageItem, type VideoItem } from "../../luna/src/media";
import { audioFocus, postNowPlaying, type NowPlaying } from "../../luna/src/playback";
import { watchMediaKeys, type MediaKeyTarget } from "../../luna/src/mediakeys";
import { location as lunaLocation, LOCATION_ERRORS, type LocationFix, type ReverseLocation } from "../../luna/src/location";
import { system } from "../../luna/src/services";
import type { SystemPreferences } from "../../luna/src/types";
import { vibrator, type VibrationEffect } from "../../luna/src/device";
import { clipboard as lunaClipboard, type ClipboardHistory, type HistoryQuery } from "../../luna/src/clipboard";
import { printManager, type Printer, type PrintJob } from "../../luna/src/print";

export type { FileEntry, ImageItem, AudioItem, VideoItem, NowPlaying, MediaKeyTarget, LocationFix, ReverseLocation,
              SystemPreferences, VibrationEffect, ClipboardHistory, HistoryQuery, Printer, PrintJob };

// ---- Files -------------------------------------------------------------------------------

const FM = "luna://org.webosphoenix.filemanager";

/** The user's files under /media/internal (org.webosphoenix.filemanager, as Files uses it). */
export const files = {
    list(path: string): Promise<FileEntry[]> { return guard(fileManager.list(path), FM); },
    stat(path: string): Promise<FileEntry> { return guard(fileManager.stat(path), FM); },
    readText(path: string, maxBytes?: number): Promise<string> { return guard(fileManager.readText(path, maxBytes), FM); },
    async writeText(path: string, text: string, overwrite = true): Promise<void> { await guard(fileManager.writeText(path, text, overwrite), FM); },
    async mkdir(path: string): Promise<void> { await guard(fileManager.mkdir(path), FM); },
    async copy(from: string, to: string, overwrite = false): Promise<void> { await guard(fileManager.copy(from, to, overwrite), FM); },
    async move(from: string, to: string, overwrite = false): Promise<void> { await guard(fileManager.move(from, to, overwrite), FM); },
    async remove(path: string, recursive = true): Promise<void> { await guard(fileManager.remove(path, recursive), FM); },
    /** A URL an <img>, <video> or fetch() can load the file from. */
    url(path: string): Promise<string> { return fileUrl(path); },
    /** Open the file in the app for its type. */
    open(path: string): Promise<void> { return app.open(path.startsWith("/") ? "file://" + path : path); },
};

// ---- Media -------------------------------------------------------------------------------

/** The media indexer: the device's pictures, music and videos. */
export const media = {
    images(): Promise<ImageItem[]> { return guard(mediaIndexer.images()); },
    audio(): Promise<AudioItem[]> { return guard(mediaIndexer.audio()); },
    videos(): Promise<VideoItem[]> { return guard(mediaIndexer.videos()); },
    watchImages(onValue?: OnValue<ImageItem[]>, onError?: OnError): Watch<ImageItem[]> { return watchLuna(mediaIndexer.watchImages, onValue, onError); },
    watchAudio(onValue?: OnValue<AudioItem[]>, onError?: OnError): Watch<AudioItem[]> { return watchLuna(mediaIndexer.watchAudio, onValue, onError); },
    watchVideos(onValue?: OnValue<VideoItem[]>, onError?: OnError): Watch<VideoItem[]> { return watchLuna(mediaIndexer.watchVideos, onValue, onError); },
};

/** A player's part in the system: the audio focus, what plays, the media and headset keys. */
export const playback = {
    /**
     * Ask for the media audio focus (com.webos.service.audiofocusmanager);
     * onLost runs when another player takes it (pause then). Cancel to give it back.
     */
    requestFocus(onLost: () => void): { cancel(): void } {
        return audioFocus.request(onLost);
    },
    /** Tell the system what plays (the shell's now playing, the Assistant's "what's playing"). */
    nowPlaying(n: Omit<NowPlaying, "appId">): void {
        postNowPlaying({ ...n, appId: app.id });
    },
    /** The media and headset keys (play, pause, next, previous), for the player that has the focus. */
    mediaKeys(target: MediaKeyTarget): { cancel(): void } {
        return watchMediaKeys(target);
    },
};

// ---- Location ------------------------------------------------------------------------------

function locationError(e: unknown): PhoenixError {
    const err = toPhoenixError(e, "luna://com.webos.service.location/getLocationUpdates");
    if (err.errorCode === LOCATION_ERRORS.PERMISSION_DENIED) return new PhoenixError(err.uri, err.reply, "permission-denied");
    if (err.errorCode === LOCATION_ERRORS.LOCATION_OFF) return new PhoenixError(err.uri, err.reply, "unavailable");
    if (err.errorCode === LOCATION_ERRORS.TIMEOUT) return new PhoenixError(err.uri, err.reply, "timeout");
    return err;
}

/**
 * Where the device is (com.webos.service.location). The first request
 * asks the user to allow the app; a refusal is a PhoenixError with code
 * "permission-denied", Location Services off is "unavailable".
 */
export const location = {
    async current(handler?: "gps" | "network"): Promise<LocationFix> {
        try { return await lunaLocation.currentPosition(handler); } catch (e) { throw locationError(e); }
    },
    watch(onValue?: OnValue<LocationFix>, onError?: OnError, minimumIntervalMs = 1000): Watch<LocationFix> {
        return watchLuna<LocationFix>((cb, err) => lunaLocation.watch(cb, err, minimumIntervalMs), onValue,
                                      onError ? (e) => onError(locationError(e)) : undefined);
    },
    /** The place at a position (street, city, country). */
    async reverse(latitude: number, longitude: number): Promise<ReverseLocation> {
        try { return await lunaLocation.reverse(latitude, longitude); } catch (e) { throw locationError(e); }
    },
};

// ---- Device ----------------------------------------------------------------------------------

export interface DeviceDetails {
    modelName: string;
    platformVersion: string;
    screenWidth?: number;
    screenHeight?: number;
    /** osInfo/query: the build, the OS name. */
    os: Record<string, unknown>;
}

export const device = {
    /** The model, the platform version and the screen (PalmSystem.deviceInfo and osInfo/query). */
    async info(): Promise<DeviceDetails> {
        const d = app.deviceInfo;
        const os = await request("luna://com.webos.service.systemservice/osInfo/query", {}).catch(() => ({}));
        return { modelName: String(d.modelName ?? ""), platformVersion: String(d.platformVersion ?? ""),
                 screenWidth: d.screenWidth, screenHeight: d.screenHeight, os: os as Record<string, unknown> };
    },
    /**
     * System preferences (com.webos.service.systemservice getPreferences):
     * "locale", "timeFormat", "timeZone", "wallpaper", ... with every change.
     */
    preferences(keys: (keyof SystemPreferences & string)[], onValue?: OnValue<SystemPreferences>, onError?: OnError): Watch<SystemPreferences> {
        return watchLuna<SystemPreferences>((cb, err) => system.watchPreferences(keys, cb, err), onValue, onError);
    },
    /** A vibration effect (LunaSysMgr's vibrator): "notification", "alert", "tapdown", ... */
    async vibrate(effect: VibrationEffect = "notification"): Promise<void> {
        await guard(vibrator.effect(effect));
    },
};

// ---- Clipboard ------------------------------------------------------------------------------

export const clipboard = {
    /**
     * Copy text to the system clipboard (and its history). `sensitive`
     * keeps it masked in the history and lets it expire (a password, a code).
     */
    async copy(text: string, opts: { sensitive?: boolean } = {}): Promise<void> {
        if (opts.sensitive) {
            try { await guard(lunaClipboard.add({ text, sensitive: true, kind: "password" })); return; } catch { /* the page's own copy below */ }
        }
        const nav = typeof navigator !== "undefined" ? navigator : undefined;
        if (nav?.clipboard?.writeText) await nav.clipboard.writeText(text);
        else await guard(lunaClipboard.add({ text }));
    },
    /** The clipboard's text (the browser's clipboard, which on Phoenix is the system's). */
    async readText(): Promise<string> {
        const nav = typeof navigator !== "undefined" ? navigator : undefined;
        if (nav?.clipboard?.readText) return nav.clipboard.readText();
        throw new PhoenixError("clipboard.readText", { returnValue: false, errorText: "No clipboard here" }, "unavailable");
    },
    /** Phoenix's clipboard history (org.webosphoenix.clipboard). */
    history(q: HistoryQuery = {}): Promise<ClipboardHistory> { return guard(lunaClipboard.history(q)); },
};

// ---- Printing ---------------------------------------------------------------------------------

const PM = "luna://com.palm.printmgr";

export interface PrintOptions {
    /** The printer (default: the current one). */
    printerID?: string;
    /** What the Print Manager lists the job as (default: the page's title). */
    description?: string;
    numCopies?: number;
    /** "US_Letter" (default), "ISO_A4", "US_Legal". */
    mediaSize?: string;
    landscape?: boolean;
}

async function printerId(given?: string): Promise<string> {
    if (given) return given;
    const p = await guard(printManager.current(), PM);
    if (!p) throw new PhoenixError(PM + "/printers/getCurrent", { returnValue: false, errorText: "No printer" }, "not-found");
    return p.printerID;
}

/** Printing (com.palm.printmgr, as Enyo 1.0's print dialog spoke to it). */
export const print = {
    printers(): Promise<Printer[]> { return guard(printManager.printers(), PM); },
    /** Pictures, one a page. Resolves with the finished job. */
    async images(paths: string[], opts: PrintOptions = {}): Promise<PrintJob> {
        return guard(printManager.printImages({ printerID: await printerId(opts.printerID), paths, appName: app.id,
                                                description: opts.description ?? (typeof document !== "undefined" ? document.title : app.id),
                                                numCopies: opts.numCopies, mediaSize: opts.mediaSize }), PM);
    },
    /**
     * This page, as the user sees it (PalmSystem.printFrame for the job, as
     * PrintDialog's frameToPrint). Without webOS, the browser's print().
     * Resolves when the print manager has it.
     */
    async page(opts: PrintOptions = {}): Promise<void> {
        const palm = palmSystem() as { printFrame?: (...a: unknown[]) => void } | undefined;
        if (!palm?.printFrame) {
            if (typeof window !== "undefined" && typeof window.print === "function") { window.print(); return; }
            throw new PhoenixError("print.page", { returnValue: false, errorText: "No printing here" }, "unavailable");
        }
        const pid = await printerId(opts.printerID);
        const description = opts.description ?? (typeof document !== "undefined" ? document.title : app.id);
        const { jobID } = await request<{ jobID: string }>(PM + "/jobs/open", { printerID: pid, appName: app.id, description });
        const done = new Promise<void>((resolve, reject) => {
            const w = subscribeTo<{ jobID?: string; printerState?: string; jobStatus?: string }>(PM + "/jobs/getStatus", {}, (s) => {
                if (s.jobID !== jobID || s.printerState !== "DONE") return;
                w.cancel();
                if (s.jobStatus && s.jobStatus !== "Success") reject(new PhoenixError(PM + "/jobs/getStatus", { returnValue: false, errorText: s.jobStatus }));
                else resolve();
            }, (e) => { w.cancel(); reject(e); });
        });
        await request(PM + "/jobs/editPrintParams", { jobID, numCopies: opts.numCopies ?? 1, mediaSize: opts.mediaSize ?? "US_Letter",
                                                      landscape: !!opts.landscape });
        const area = await request<{ width?: number; height?: number; pixelUnits?: number; renderInReverseOrder?: boolean }>(
            PM + "/jobs/getFinalParamsAndArea", { jobID });
        palm.printFrame("", jobID, area.width, area.height, area.pixelUnits, !!opts.landscape, !!area.renderInReverseOrder);
        await done;
    },
};
