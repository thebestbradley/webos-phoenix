// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
.pragma library

// HTTP error documents can contain a site's verification or sign-in UI.
// Transport and certificate failures still belong to the browser's error view.
function hasHttpDocument(info, httpStatusDomain) {
    return !!info && info.errorDomain === httpStatusDomain
        && typeof info.errorCode === "number" && info.errorCode >= 400 && info.errorCode <= 599
        && info.isErrorPage !== true;
}
