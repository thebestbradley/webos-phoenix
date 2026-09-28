// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Camera: a full-card viewfinder with the webOS 2.x controls: flash at the
// top left, the last shot at the bottom left (tap to open it in Photos),
// the shutter in the middle and the photo/video switch at the right.
//
// Services:
//   com.webos.service.camera2 getCameraList: is there a camera at all
//       (OSE's camera app starts the same way). The viewfinder itself is the
//       web runtime's getUserMedia (WebAppMgr is Chromium): on OSE the camera
//       service's own preview is a camera:// <video> source fed by
//       uMediaServer, which only OSE's media pipeline can render.
//   org.webosphoenix.service.mediafiles write: saves the JPEG or WebM under
//       /media/internal/DCIM/100PHNX (a page cannot write files itself).
//   com.webos.service.mediaindexer requestMediaScan {path}: index the new
//       file, as com.webos.app.camera does after a snapshot; Photos is
//       subscribed to the image list and shows it at once.
//   com.webos.applicationManager launch: open the shot in Photos with
//       {imageList: {results: [item], count: 1}}, the params OSE's camera
//       passes its image viewer.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apps, CAMERA_DIR, cameraService, folderOf, mediaFiles, mediaIndexer, type ImageItem, type MediaItem, type VideoItem } from "@phoenix/luna";
import { useLuna, useMediaUrl } from "@phoenix/luna/react";
import { AppMenu, Glyph, GroupedToolButtons, Spinner } from "@phoenix/ui";
import { grabFrame, nextCapturePath, nextFlash, recorderType, recordingTime, type FlashMode } from "./capture";

type Status = "starting" | "ready" | "none" | "denied";
type Mode = "photo" | "video";

const FLASH_KEY = "org.webosphoenix.camera.flash";

function loadFlash(): FlashMode {
    try {
        const v = localStorage.getItem(FLASH_KEY);
        return v === "on" || v === "off" || v === "auto" ? v : "auto";
    } catch {
        return "auto";
    }
}

function newest(items: MediaItem[]): MediaItem | undefined {
    return items
        .filter((it) => folderOf(it.file_path) === CAMERA_DIR)
        .sort((a, b) => (Date.parse(b.last_modified_date ?? "") || 0) - (Date.parse(a.last_modified_date ?? "") || 0)
            || (a.file_path < b.file_path ? 1 : -1))[0];
}

function LastShot({ item, preview, onOpen, thumbRef }: {
    item?: MediaItem; preview?: string; onOpen: () => void; thumbRef: React.Ref<HTMLButtonElement>;
}) {
    const url = useMediaUrl(preview ? undefined : item?.file_path);
    const src = preview ?? url;
    const video = !preview && item && (item.type === "video" || (item.mime ?? "").startsWith("video/"));
    return (
        <button type="button" ref={thumbRef} className={"cam-thumb" + (src ? "" : " empty")} data-testid="last-shot"
                aria-label="Open in Photos" disabled={!item} onClick={onOpen}>
            {src && (video
                ? <video src={src + "#t=0.1"} muted playsInline preload="metadata" />
                : <img src={src} alt="" draggable={false} />)}
        </button>
    );
}

export function App() {
    const videoEl = useRef<HTMLVideoElement>(null);
    const thumbEl = useRef<HTMLButtonElement>(null);
    const stream = useRef<MediaStream | null>(null);
    const recorder = useRef<MediaRecorder | null>(null);
    const [status, setStatus] = useState<Status>("starting");
    const [cameraCount, setCameraCount] = useState(0);
    const [cameraIndex, setCameraIndex] = useState(0);
    const [mode, setMode] = useState<Mode>("photo");
    const [flash, setFlash] = useState<FlashMode>(loadFlash);
    const [busy, setBusy] = useState(false);
    const [recordStart, setRecordStart] = useState<number | null>(null);
    const [now, setNow] = useState(Date.now());
    const [shutter, setShutter] = useState(0);
    const [flyer, setFlyer] = useState<string | null>(null);
    const [preview, setPreview] = useState<string | undefined>();

    const images = useLuna<ImageItem[]>((cb, err) => mediaIndexer.watchImages(cb, err), []);
    const videos = useLuna<VideoItem[]>((cb, err) => mediaIndexer.watchVideos(cb, err), []);
    const all = useMemo(() => [...(images.value ?? []), ...(videos.value ?? [])] as MediaItem[], [images.value, videos.value]);
    const last = newest(all);
    // Drop the local preview once the index has the shot.
    useEffect(() => { setPreview(undefined); }, [last?.uri]);

    const stop = useCallback(() => {
        stream.current?.getTracks().forEach((t) => t.stop());
        stream.current = null;
        if (videoEl.current) videoEl.current.srcObject = null;
    }, []);

    const start = useCallback(async (index: number) => {
        stop();
        setStatus("starting");
        try {
            const ids = await cameraService.list();
            setCameraCount(ids.length);
            if (ids.length === 0) { setStatus("none"); return; }
        } catch {
            // No camera service (a desktop browser without the runtime): ask the browser.
        }
        const md = navigator.mediaDevices;
        if (!md?.getUserMedia) { setStatus("none"); return; }
        try {
            const inputs = (await md.enumerateDevices()).filter((d) => d.kind === "videoinput");
            const dev = inputs[index % Math.max(1, inputs.length)];
            const s = await md.getUserMedia({
                video: {
                    ...(dev?.deviceId ? { deviceId: { exact: dev.deviceId } } : { facingMode: "environment" }),
                    width: { ideal: 1280 }, height: { ideal: 720 },
                },
                audio: false,
            });
            stream.current = s;
            if (videoEl.current) {
                videoEl.current.srcObject = s;
                await videoEl.current.play().catch(() => {});
            }
            setStatus("ready");
        } catch (e) {
            const name = (e as { name?: string }).name;
            setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "none");
        }
    }, [stop]);

    useEffect(() => {
        void start(cameraIndex);
        const onVis = () => { if (document.hidden) stop(); else void start(cameraIndex); };
        document.addEventListener("visibilitychange", onVis);
        return () => { document.removeEventListener("visibilitychange", onVis); stop(); };
    }, [cameraIndex, start, stop]);

    useEffect(() => {
        try { localStorage.setItem(FLASH_KEY, flash); } catch { /* ignore */ }
    }, [flash]);

    useEffect(() => {
        if (recordStart === null) return;
        const t = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(t);
    }, [recordStart]);

    const torch = async (on: boolean) => {
        const track = stream.current?.getVideoTracks()[0];
        const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
        if (track && caps?.torch)
            await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).catch(() => {});
    };

    const save = async (blob: Blob, ext: "jpg" | "webm") => {
        const path = nextCapturePath(all.map((it) => it.file_path), ext);
        await mediaFiles.write(path, blob);
        await mediaIndexer.scan(CAMERA_DIR);
        return path;
    };

    // The classic capture: the shutter closes and opens, and the frame
    // shrinks into the last-shot thumbnail.
    const takePhoto = async () => {
        const v = videoEl.current;
        if (!v || status !== "ready" || busy || !v.videoWidth) return;
        setBusy(true);
        try {
            if (flash === "on") await torch(true);
            const blob = await grabFrame(v);
            if (flash === "on") void torch(false);
            const url = URL.createObjectURL(blob);
            setShutter((n) => n + 1);
            setFlyer(url);
            setPreview(url);
            await save(blob, "jpg");
        } catch (e) {
            console.warn("[camera] capture failed", e);
        } finally {
            setBusy(false);
        }
    };

    const toggleRecording = async () => {
        if (recorder.current) {
            recorder.current.stop();
            return;
        }
        const s = stream.current;
        if (!s || status !== "ready") return;
        let rec = s;
        try {
            const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
            rec = new MediaStream([...s.getVideoTracks(), ...mic.getAudioTracks()]);
        } catch { /* record without sound */ }
        const type = recorderType();
        const r = new MediaRecorder(rec, type ? { mimeType: type } : undefined);
        const chunks: Blob[] = [];
        r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        r.onstop = () => {
            rec.getAudioTracks().forEach((t) => t.stop());
            recorder.current = null;
            setRecordStart(null);
            if (flash === "on") void torch(false);
            const blob = new Blob(chunks, { type: "video/webm" });
            setBusy(true);
            save(blob, "webm").catch((e) => console.warn("[camera] saving the video failed", e)).finally(() => setBusy(false));
        };
        recorder.current = r;
        if (flash === "on") await torch(true);
        r.start(500);
        setRecordStart(Date.now());
        setNow(Date.now());
    };

    const openLast = () => {
        if (!last) return;
        void apps.launch("org.webosphoenix.photos", { imageList: { results: [last], count: 1 } });
    };

    // Fly the captured frame into the thumbnail.
    const flyerRef = useCallback((el: HTMLImageElement | null) => {
        if (!el) return;
        const to = thumbEl.current?.getBoundingClientRect();
        const from = el.getBoundingClientRect();
        if (!to || !from.width || !el.animate) { setFlyer(null); return; }
        const dx = to.left + to.width / 2 - (from.left + from.width / 2);
        const dy = to.top + to.height / 2 - (from.top + from.height / 2);
        const sc = to.width / from.width;
        // Hidden while the shutter closes, shown as it opens, then flown.
        const a = el.animate([
            { transform: "none", opacity: 0, offset: 0 },
            { transform: "none", opacity: 0, offset: 0.18 },
            { transform: "none", opacity: 1, offset: 0.2 },
            { transform: "none", opacity: 1, offset: 0.45, easing: "cubic-bezier(0.5, 0, 0.3, 1)" },
            { transform: `translate(${dx}px, ${dy}px) scale(${sc})`, opacity: 0.9, offset: 1 },
        ], { duration: 900 });
        a.onfinish = () => setFlyer(null);
    }, []);

    const recording = recordStart !== null;
    const flashLabel = { auto: "Auto", on: "On", off: "Off" }[flash];

    return (
        <div className={"cam" + (recording ? " recording" : "")}>
            <AppMenu items={[
                { label: "Photo", disabled: recording, onSelect: () => setMode("photo") },
                { label: "Video", disabled: recording, onSelect: () => setMode("video") },
            ]} />
            <div className="cam-view">
                <video ref={videoEl} className="cam-video" muted playsInline autoPlay data-testid="viewfinder" />
                {status === "starting" && <div className="cam-message"><Spinner large /></div>}
                {(status === "none" || status === "denied") && (
                    <div className="cam-message" data-testid="no-camera">
                        <Glyph name="camera" size={64} className="cam-message-glyph" />
                        <div className="cam-message-title">{status === "none" ? "No camera found" : "Camera not available"}</div>
                        <div className="cam-message-text">
                            {status === "none"
                                ? "Connect a camera to take photos and videos."
                                : "Another app is using the camera, or access to it was not allowed."}
                        </div>
                    </div>
                )}
                {shutter > 0 && <div key={shutter} className="cam-shutter"><span /><span /></div>}
                {flyer && <img ref={flyerRef} className="cam-flyer" src={flyer} alt="" />}

                <div className="cam-top">
                    <button type="button" className={"cam-flash " + flash} data-testid="flash" aria-label={`Flash: ${flashLabel}`}
                            onClick={() => setFlash(nextFlash(flash))}>
                        <Glyph name="flash" size={24} />
                        <span>{flashLabel}</span>
                    </button>
                    {recording && (
                        <div className="cam-rec" data-testid="rec-time"><span className="cam-rec-dot" />{recordingTime(now - recordStart!)}</div>
                    )}
                    {cameraCount > 1 && (
                        <button type="button" className="cam-switch" aria-label="Switch camera" disabled={recording}
                                onClick={() => setCameraIndex((i) => (i + 1) % cameraCount)}>
                            <Glyph name="switch-camera" size={26} />
                        </button>
                    )}
                </div>
            </div>

            <div className="cam-bar">
                <LastShot item={last} preview={preview} onOpen={openLast} thumbRef={thumbEl} />
                <button type="button" className={"cam-shoot " + mode + (recording ? " stop" : "")} data-testid="shutter"
                        aria-label={mode === "photo" ? "Take photo" : recording ? "Stop recording" : "Record video"}
                        disabled={status !== "ready" || (busy && !recording)}
                        onClick={() => void (mode === "photo" ? takePhoto() : toggleRecording())}>
                    {mode === "photo" ? <Glyph name="camera" /> : <span className="cam-rec-button" />}
                </button>
                <GroupedToolButtons<Mode>
                    className={"cam-mode" + (recording ? " locked" : "")}
                    value={mode}
                    onChange={(m) => { if (!recording) setMode(m); }}
                    options={[
                        { value: "photo", icon: "camera", label: "Photo", testId: "mode-photo" },
                        { value: "video", icon: "video", label: "Video", testId: "mode-video" },
                    ]}
                />
            </div>
        </div>
    );
}
