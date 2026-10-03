// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The certificate store: com.palm.certificatemanager, as legacy webOS's
// Certificate Manager (com.palm.app.certificate) and Wi-Fi setup used it:
//
//   listcertificates            -> {userCertificateStore: [...]} (Enyo 1.0
//       lib/wifi/wifi.js); Phoenix adds `certificates` (all of them, the
//       system's too) and {subscribe}
//   getcertificatedetails {certificateFilename} (isis-browser
//       CertificateDetail.js); Phoenix also takes certificateId and adds
//       fingerprints, the key's size, trusted, system and the PEM
//   addcertificate {certificateFilename}, setcertificatetrust {certificateId,
//       trusted}, removecertificate {certificateId}, restorecertificates:
//       Phoenix, in the same style
//
// The simulator implements them in runtime/phoenix-runtime.js
// ("Certificate manager").

import { call, subscribe, type LunaError, type Subscription } from "./bridge";

const CM = "luna://com.palm.certificatemanager";

/** errorCode values. */
export const CERTIFICATE_ERRORS = { BAD_PARAMS: -1, NOT_CERT: -2, EXISTS: -3, NOT_FOUND: -4, READ: -5 } as const;

/** A distinguished name, as the service names its parts. */
export interface CertificateName {
    commonname?: string;
    organization?: string;
    organizationalunit?: string;
    country?: string;
    state?: string;
    location?: string;
    email?: string;
    altname?: string[];
}

export interface CertificateSummary {
    certificateId: string;
    certificateFilename: string;
    commonname: string;
    organization: string;
    /** Who issued it (common name or organization). */
    issuer: string;
    /** ms since the epoch. */
    startdate: number;
    expiredate: number;
    trusted: boolean;
    /** Shipped with the system (a root CA). */
    system: boolean;
    isCA: boolean;
}

export interface CertificateDetails {
    certificateId: string;
    certificateFilename: string;
    subject: CertificateName;
    issuer: CertificateName;
    startdate: number;
    expiredate: number;
    serialNumber: string;
    version: number;
    signature: { algorithm: string };
    publicKey: { algorithm: string; bits?: number; curve?: string };
    isCA: boolean;
    trusted: boolean;
    system: boolean;
    fingerprints: { sha256: string; sha1: string };
    pem: string;
}

type OnError = (e: LunaError) => void;

export const certificates = {
    watch(cb: (list: CertificateSummary[]) => void, onError?: OnError): Subscription {
        return subscribe(`${CM}/listcertificates`, {}, (r) => {
            cb(((r as unknown as { certificates?: CertificateSummary[] }).certificates) ?? []);
        }, onError);
    },
    async details(certificateId: string): Promise<CertificateDetails> {
        return (await call(`${CM}/getcertificatedetails`, { certificateId })) as unknown as CertificateDetails;
    },
    /** Install the certificates in a .pem / .crt / .cer / .der file on the device. */
    async add(certificateFilename: string): Promise<string[]> {
        return ((await call(`${CM}/addcertificate`, { certificateFilename })) as unknown as { certificateIds: string[] }).certificateIds;
    },
    setTrusted(certificateId: string, trusted: boolean) {
        return call(`${CM}/setcertificatetrust`, { certificateId, trusted });
    },
    remove(certificateId: string) {
        return call(`${CM}/removecertificate`, { certificateId });
    },
    restoreSystem() {
        return call(`${CM}/restorecertificates`, {});
    },
};

/** The file types addcertificate reads. */
export const CERTIFICATE_EXTENSIONS = ["crt", "pem", "cer", "der"];
