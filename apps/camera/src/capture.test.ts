// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { CAMERA_DIR } from "@phoenix/luna";
import { captureSize, nextCapturePath, nextFlash, recordingTime } from "./capture";

describe("camera capture helpers", () => {
    it("numbers captures after the highest in the camera folder", () => {
        expect(nextCapturePath([], "jpg")).toBe(`${CAMERA_DIR}/CIMG0001.jpg`);
        expect(nextCapturePath([`${CAMERA_DIR}/CIMG0002.jpg`, `${CAMERA_DIR}/CIMG0009.webm`, "/media/internal/other/CIMG0100.jpg"], "webm"))
            .toBe(`${CAMERA_DIR}/CIMG0010.webm`);
    });

    it("scales captures to a 640px long side and never up", () => {
        expect(captureSize(1280, 720)).toEqual({ width: 640, height: 360 });
        expect(captureSize(480, 640)).toEqual({ width: 480, height: 640 });
        expect(captureSize(320, 240)).toEqual({ width: 320, height: 240 });
    });

    it("cycles the flash and formats the recording time", () => {
        expect(nextFlash("auto")).toBe("on");
        expect(nextFlash("on")).toBe("off");
        expect(nextFlash("off")).toBe("auto");
        expect(recordingTime(65_400)).toBe("1:05");
    });
});
