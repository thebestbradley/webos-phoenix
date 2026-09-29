// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Stands in for Node's "crypto" and @xmldom/xmldom in the app bundle (see
// vite.config.ts): kdbxweb reaches for them only when the page lacks
// WebCrypto, DOMParser or XMLSerializer, which the web runtime always has.

function missing(): never {
    throw new Error("Not available in the web runtime");
}

export class DOMParser { constructor() { missing(); } }
export class XMLSerializer { constructor() { missing(); } }
export const createHash = missing, createHmac = missing, createCipheriv = missing, createDecipheriv = missing, randomBytes = missing;
export default { DOMParser, XMLSerializer, createHash, createHmac, createCipheriv, createDecipheriv, randomBytes };
