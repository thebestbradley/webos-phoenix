// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Certificate Manager against the simulated com.palm.certificatemanager: the
// system's CAs read from runtime/certs (checked against what openssl says
// of them), a certificate added from a file on the device (PEM and DER),
// trusted, distrusted, deleted and restored, and the pane doing the same.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { call, certificates, fileManager, CERTIFICATE_ERRORS, LunaError, type CertificateSummary } from "@phoenix/luna";
import { CertificatesPage, certStatus, findCertificateFiles } from "./Certificates";

const REPO = resolve(__dirname, "../../../..");
const LAB_CA = readFileSync(resolve(REPO, "apps/media-samples/media/documents/phoenix-lab-root-ca.crt"), "utf8");
const hostMessages: { type: string; payload: Record<string, unknown> }[] = [];

beforeAll(() => {
    (window as unknown as Record<string, unknown>).phoenixHost = {
        postToHost: (type: string, payload: Record<string, unknown>) => hostMessages.push({ type, payload }),
    };
    new Function(readFileSync(resolve(REPO, "runtime/phoenix-runtime.js"), "utf8")).call(window);
    const ps = (window as unknown as { PalmSystem: { getResource(p: string): string | undefined } }).PalmSystem;
    const get = ps.getResource;
    ps.getResource = (p: string) => {
        const m = /^\/usr\/share\/phoenix\/runtime\/certs\/([a-z0-9-]+\.pem)$/.exec(p);
        if (m) return readFileSync(resolve(REPO, "runtime/certs", m[1]), "utf8");
        return get.call(ps, p);
    };
});

const list = () => new Promise<CertificateSummary[]>((res) => { const s = certificates.watch((l) => { s.cancel(); res(l); }); });
const failure = (p: Promise<unknown>) => p.then(() => null, (e: LunaError) => e.errorCode);

describe("com.palm.certificatemanager", () => {
    it("lists the system's root certificates as openssl reads them", async () => {
        const l = await list();
        expect(l.map((c) => c.commonname)).toEqual(["Amazon Root CA 1", "DigiCert Global Root G2", "GTS Root R1",
                                                    "ISRG Root X1", "ISRG Root X2", "USERTrust RSA Certification Authority"]);
        expect(l.every((c) => c.system && c.trusted && c.isCA)).toBe(true);
        const x1 = l.find((c) => c.commonname === "ISRG Root X1")!;
        expect(x1).toMatchObject({ organization: "Internet Security Research Group", issuer: "ISRG Root X1",
                                   expiredate: Date.UTC(2035, 5, 4, 11, 4, 38) });
        const d = await certificates.details(x1.certificateId);
        expect(d.fingerprints.sha256).toBe("96:BC:EC:06:26:49:76:F3:74:60:77:9A:CF:28:C5:A7:CF:E8:A3:C0:AA:E1:1A:8F:FC:EE:05:C0:BD:DF:08:C6");
        expect(d.fingerprints.sha1).toBe("CA:BD:2A:79:A1:07:6A:31:F2:1D:25:36:35:CB:03:9D:43:29:A5:E8");
        expect(d.publicKey).toEqual({ algorithm: "RSA", bits: 4096 });
        expect(d.signature.algorithm).toBe("SHA-256 with RSA");
        expect(d.version).toBe(3);
        const x2 = await certificates.details(l.find((c) => c.commonname === "ISRG Root X2")!.certificateId);
        expect(x2.publicKey).toEqual({ algorithm: "Elliptic curve", curve: "P-384", bits: 384 });
        expect(x2.fingerprints.sha256).toBe("69:72:9B:8E:15:A8:6E:FC:17:7A:57:AF:B7:17:1D:FC:64:AD:D2:8C:2F:CA:8C:F1:50:7E:34:45:3C:CB:14:70");
        const ut = await certificates.details(l.find((c) => c.commonname?.startsWith("USERTrust"))!.certificateId);
        expect(ut.subject).toMatchObject({ state: "New Jersey", location: "Jersey City", country: "US" });
        // Wi-Fi's view (Enyo 1.0 lib/wifi/wifi.js): only what the user added.
        const r = await call("luna://com.palm.certificatemanager/listcertificates", {});
        expect((r as unknown as { userCertificateStore: unknown[] }).userCertificateStore).toEqual([]);
    });

    it("adds a certificate from a file, refuses others, and keeps the user's choices", async () => {
        await fileManager.writeText("/media/internal/Downloads/lab.crt", LAB_CA);
        await fileManager.writeText("/media/internal/Downloads/notes.pem", "not a certificate");
        expect(await failure(certificates.add("/media/internal/Downloads/notes.pem"))).toBe(CERTIFICATE_ERRORS.NOT_CERT);
        expect(await failure(certificates.add("/media/internal/Downloads/missing.crt"))).toBe(CERTIFICATE_ERRORS.READ);
        const [id] = await certificates.add("/media/internal/Downloads/lab.crt");
        expect(await failure(certificates.add("/media/internal/Downloads/lab.crt"))).toBe(CERTIFICATE_ERRORS.EXISTS);
        const d = await certificates.details(id);
        expect(d.subject).toMatchObject({ commonname: "Phoenix Lab Root CA", organization: "webOS Phoenix Demo", organizationalunit: "Lab",
                                          altname: ["lab.webosphoenix.example", "lab@webosphoenix.example"] });
        expect(d.serialNumber).toBe("50:68:6F:65:6E:69:78");
        expect(d.publicKey).toEqual({ algorithm: "Elliptic curve", curve: "P-256", bits: 256 });
        expect(d.signature.algorithm).toBe("ECDSA with SHA-256");
        expect(d.isCA).toBe(true);
        expect(d.system).toBe(false);
        // The same certificate as DER is the same certificate.
        await fileManager.writeBase64("/media/internal/Downloads/lab.der", d.pem.replace(/-----[A-Z ]+-----|\s/g, ""));
        expect(await failure(certificates.add("/media/internal/Downloads/lab.der"))).toBe(CERTIFICATE_ERRORS.EXISTS);

        await certificates.setTrusted(id, false);
        expect((await list()).find((c) => c.certificateId === id)!.trusted).toBe(false);
        const amazon = (await list()).find((c) => c.commonname === "Amazon Root CA 1")!;
        await certificates.remove(amazon.certificateId);
        expect((await list()).some((c) => c.commonname === "Amazon Root CA 1")).toBe(false);
        await certificates.restoreSystem();
        expect((await list()).some((c) => c.commonname === "Amazon Root CA 1")).toBe(true);
        await certificates.remove(id);
        expect(await failure(certificates.details(id))).toBe(CERTIFICATE_ERRORS.NOT_FOUND);
        expect(await failure(certificates.remove(id))).toBe(CERTIFICATE_ERRORS.NOT_FOUND);
    });

    it("opens from com.palm.app.certificate", async () => {
        await call("luna://com.palm.applicationManager/launch", { id: "com.palm.app.certificate" });
        expect(hostMessages.filter((m) => m.type === "launch").pop()!.payload).toEqual({ id: "org.webosphoenix.settings", params: { page: "certificates" } });
    });
});

describe("Settings > Certificate Manager", () => {
    it("says why a certificate is not to be relied on", () => {
        const c = { trusted: true, startdate: Date.UTC(2020, 0, 1), expiredate: Date.UTC(2030, 0, 1), issuer: "X" } as CertificateSummary;
        expect(certStatus(c, Date.UTC(2026, 0, 1))).toBe("Issued by X");
        expect(certStatus(c, Date.UTC(2031, 0, 1))).toMatch(/^Expired/);
        expect(certStatus({ ...c, trusted: false }, Date.UTC(2026, 0, 1))).toBe("Not trusted");
    });

    it("finds the certificate files on the storage", async () => {
        await fileManager.writeText("/media/internal/Documents/work.pem", LAB_CA);
        const files = (await findCertificateFiles()).map((f) => f.path);
        expect(files).toContain("/media/internal/Documents/work.pem");
        expect(files).toContain("/media/internal/Downloads/lab.der");
        expect(files.some((f) => f.endsWith("notes.pem"))).toBe(true);
        expect(files.some((f) => f.endsWith(".txt"))).toBe(false);
    });

    it("adds one from the picker, shows it, distrusts and deletes it", async () => {
        render(<CertificatesPage />);
        await screen.findByTestId("cert-isrg-root-x1");
        fireEvent.click(screen.getByTestId("cert-add"));
        const picker = await screen.findByTestId("cert-picker");
        fireEvent.click(await within(picker).findByTestId("cert-file-notes.pem"));
        expect((await within(picker).findByTestId("cert-picker-error")).textContent).toMatch(/no certificate/);
        fireEvent.click(within(picker).getByTestId("cert-file-work.pem"));
        await waitFor(() => expect(screen.queryByTestId("cert-picker")).toBeNull());
        expect(screen.getByTestId("cert-notice").textContent).toBe("Certificate added.");
        const row = await screen.findByText("Phoenix Lab Root CA");
        fireEvent.click(row);
        await waitFor(() => expect(screen.getByTestId("cert-sha256").textContent).toBe(
            "06:1E:77:61:18:F8:E6:8D:DC:5B:A0:B8:34:CA:9F:D0:E8:DF:C7:01:8E:49:D1:9B:03:D8:DD:64:7E:56:D8:FD"));
        fireEvent.click(screen.getByTestId("cert-trusted"));
        await waitFor(async () => expect((await list()).find((c) => c.commonname === "Phoenix Lab Root CA")!.trusted).toBe(false));
        fireEvent.click(screen.getByTestId("cert-delete"));
        fireEvent.click(await screen.findByTestId("cert-delete-confirm"));
        await screen.findByTestId("cert-add");
        await waitFor(() => expect(screen.queryByText("Phoenix Lab Root CA")).toBeNull());
    });
});
