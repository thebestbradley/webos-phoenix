// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Media services for Camera, Photos and Music, checked against the OSE
// sources (webosose GitHub, master):
//
//   com.webos.service.mediaindexer   com.webos.service.mediaindexer
//       src/indexerservice.cpp (methods), src/dbconnector/mediadb.cpp (reply
//       shapes and item fields), src/mediaitem.cpp (field names)
//   com.webos.service.camera2        com.webos.service.camera
//       src/services/camera/camera_service.cpp, json_parser.cpp,
//       include/public/camera/camera_constants.h
//   org.webosphoenix.service.mediafiles   Phoenix (simulator only so far):
//       writes and removes files under /media/internal, which a web page
//       cannot do itself
//
// Media is stored under /media/internal as on webOS 2.x/3.x (DCIM/100PHNX
// for the camera). OSE's media indexer indexes the paths in its
// STORAGE_DEVS build setting (/media/multimedia by default); Phoenix
// configures /media/internal.

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

type OnError = (e: LunaError) => void;

export const MEDIA_ROOT = "/media/internal";
/** The media indexer's uri for the internal storage device ("storage" plugin + mount point). */
export const MEDIA_DEVICE_URI = "storage://" + MEDIA_ROOT;
/** Where the camera saves (legacy webOS: /media/internal/DCIM/100PALM). */
export const CAMERA_DIR = MEDIA_ROOT + "/DCIM/100PHNX";

// ---- Types ------------------------------------------------------------------------

/** An item of the media indexer (mediadb.cpp select lists; mediaitem.cpp names). */
export interface MediaItem {
    /** Device uri + path, e.g. "storage:///media/internal/DCIM/100PHNX/CIMG0001.jpg". */
    uri: string;
    file_path: string;
    type?: "image" | "audio" | "video";
    mime?: string;
    title?: string;
    file_size?: number;
    last_modified_date?: string;
    dirty?: boolean;
    width?: number;
    height?: number;
    /** Seconds. */
    duration?: number;
    [key: string]: unknown;
}

export interface ImageItem extends MediaItem {
    width?: number;
    height?: number;
}

export interface AudioItem extends MediaItem {
    artist?: string;
    album?: string;
    album_artist?: string;
    genre?: string;
    track?: number;
    total_tracks?: number;
    year?: number;
    /** Path of the extracted cover art. */
    thumbnail?: string;
}

export type VideoItem = MediaItem;

export interface MediaList<T> {
    results: T[];
    count: number;
}

type Sub = { subscribe?: boolean };
type ListParams = Sub & { uri?: string; count?: number };

declare module "./types" {
    interface LunaApi {
        "luna://com.webos.service.mediaindexer/getImageList": { params: ListParams; result: { imageList?: MediaList<ImageItem> } };
        "luna://com.webos.service.mediaindexer/getAudioList": { params: ListParams; result: { audioList?: MediaList<AudioItem> } };
        "luna://com.webos.service.mediaindexer/getVideoList": { params: ListParams; result: { videoList?: MediaList<VideoItem> } };
        "luna://com.webos.service.mediaindexer/getImageMetadata": { params: { uri: string }; result: { metadata: ImageItem } };
        "luna://com.webos.service.mediaindexer/getAudioMetadata": { params: { uri: string }; result: { metadata: AudioItem } };
        "luna://com.webos.service.mediaindexer/requestDelete": { params: { uri: string }; result: Record<string, never> };
        "luna://com.webos.service.mediaindexer/requestMediaScan": { params: { path: string }; result: Record<string, never> };
        "luna://com.webos.service.camera2/getCameraList": { params: Sub; result: { deviceList: { id: string }[] } };
        "luna://com.webos.service.camera2/getInfo": { params: { id: string }; result: { info: CameraInfo } };
        "luna://org.webosphoenix.service.mediafiles/write": { params: { path: string; data: string; mimeType?: string }; result: { path: string; file_size: number } };
        "luna://org.webosphoenix.service.mediafiles/remove": { params: { path: string }; result: Record<string, never> };
    }
}

export interface CameraInfo {
    name: string;
    type: string;
    builtin?: boolean;
    details?: Record<string, unknown>;
}

// ---- com.webos.service.mediaindexer ----------------------------------------------------

function watchList<T>(uri: string, key: string, cb: (items: T[]) => void, onError?: OnError, deviceUri = MEDIA_DEVICE_URI): Subscription {
    // The first reply only says {subscribed: true}; the list follows, and
    // again whenever the index changes.
    return subscribe(uri, { uri: deviceUri }, (r) => {
        const list = r[key] as MediaList<T> | undefined;
        if (list) cb(list.results);
    }, onError);
}

export const mediaIndexer = {
    /** getImageList {uri, subscribe}: pictures, again whenever they change. */
    watchImages(cb: (items: ImageItem[]) => void, onError?: OnError): Subscription {
        return watchList("luna://com.webos.service.mediaindexer/getImageList", "imageList", cb, onError);
    },
    /** getAudioList {uri, subscribe} */
    watchAudio(cb: (items: AudioItem[]) => void, onError?: OnError): Subscription {
        return watchList("luna://com.webos.service.mediaindexer/getAudioList", "audioList", cb, onError);
    },
    /** getVideoList {uri, subscribe} */
    watchVideos(cb: (items: VideoItem[]) => void, onError?: OnError): Subscription {
        return watchList("luna://com.webos.service.mediaindexer/getVideoList", "videoList", cb, onError);
    },
    /** getImageList {uri}: one answer. */
    async images(): Promise<ImageItem[]> {
        const r = await call("luna://com.webos.service.mediaindexer/getImageList", { uri: MEDIA_DEVICE_URI });
        return r.imageList?.results ?? [];
    },
    /** getAudioList {uri}: one answer. */
    async audio(): Promise<AudioItem[]> {
        const r = await call("luna://com.webos.service.mediaindexer/getAudioList", { uri: MEDIA_DEVICE_URI });
        return r.audioList?.results ?? [];
    },
    /** getVideoList {uri}: one answer. */
    async videos(): Promise<VideoItem[]> {
        const r = await call("luna://com.webos.service.mediaindexer/getVideoList", { uri: MEDIA_DEVICE_URI });
        return r.videoList?.results ?? [];
    },
    /** requestMediaScan {path}: index new files (com.webos.app.camera does this after a snapshot). */
    scan(path = MEDIA_ROOT) {
        return call("luna://com.webos.service.mediaindexer/requestMediaScan", { path });
    },
    /** requestDelete {uri}: drop an item from the index. */
    forget(uri: string) {
        return call("luna://com.webos.service.mediaindexer/requestDelete", { uri });
    },
};

// ---- com.webos.service.camera2 ---------------------------------------------------------

export const cameraService = {
    /** getCameraList: ids of the attached cameras ("camera1", ...). */
    async list(): Promise<string[]> {
        const r = await call("luna://com.webos.service.camera2/getCameraList", {});
        return (r.deviceList ?? []).map((d) => d.id);
    },
    /** getInfo {id} */
    async info(id: string): Promise<CameraInfo> {
        return (await call("luna://com.webos.service.camera2/getInfo", { id })).info;
    },
};

// ---- Files (Phoenix) -------------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

function bytesOf(blob: Blob): Promise<Uint8Array> {
    if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer().then((b) => new Uint8Array(b));
    return new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(new Uint8Array(fr.result as ArrayBuffer));
        fr.onerror = () => rej(fr.error);
        fr.readAsArrayBuffer(blob);
    });
}

export const mediaFiles = {
    /** org.webosphoenix.service.mediafiles/write {path, data, mimeType} */
    async write(path: string, blob: Blob) {
        const data = toBase64(await bytesOf(blob));
        return call("luna://org.webosphoenix.service.mediafiles/write", { path, data, mimeType: blob.type });
    },
    /** org.webosphoenix.service.mediafiles/remove {path} */
    remove(path: string) {
        return call("luna://org.webosphoenix.service.mediafiles/remove", { path });
    },
};

/**
 * Delete a picture, song or video: the file, then its index entry (OSE's
 * requestDelete only drops the entry).
 */
export async function deleteMedia(item: MediaItem): Promise<void> {
    await mediaFiles.remove(item.file_path);
    await mediaIndexer.forget(item.uri);
}

// ---- URLs ----------------------------------------------------------------------------

interface RuntimeFiles { url(path: string): Promise<string> }

/**
 * A URL to show or play a media file. On a device the app page can read
 * the file directly (file://); the simulator keeps stored files in
 * IndexedDB and hands out blob: URLs, and serves the demo media itself.
 */
export function mediaUrl(path: string): Promise<string> {
    const rt = (globalThis as { __phoenixRuntime?: { onDevice?: boolean; mediaFiles?: RuntimeFiles } }).__phoenixRuntime;
    if (rt?.mediaFiles && !rt.onDevice) return rt.mediaFiles.url(path);
    return Promise.resolve(path.startsWith("/") ? "file://" + path : path);
}

/** The folder a file is in ("/media/internal/DCIM/100PHNX"). */
export function folderOf(path: string): string {
    return path.replace(/\/[^/]*$/, "");
}
