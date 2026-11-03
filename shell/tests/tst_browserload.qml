// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
import QtQuick
import QtTest
import "../qml/Phoenix/Sim/BrowserLoad.js" as BrowserLoad

TestCase {
    name: "BrowserHTTPDocuments"
    function test_providerResponseIsVisible() {
        verify(BrowserLoad.hasHttpDocument({errorDomain: 7, errorCode: 403, isErrorPage: false}, 7));
        verify(BrowserLoad.hasHttpDocument({errorDomain: 7, errorCode: 429}, 7));
        verify(BrowserLoad.hasHttpDocument({errorDomain: 7, errorCode: 503}, 7));
    }
    function test_connectionAndCertificateFailuresStayErrors() {
        verify(!BrowserLoad.hasHttpDocument({errorDomain: 3, errorCode: -202}, 7));
        verify(!BrowserLoad.hasHttpDocument({errorDomain: 2, errorCode: -105}, 7));
        verify(!BrowserLoad.hasHttpDocument({errorDomain: 7, errorCode: 403, isErrorPage: true}, 7));
        verify(!BrowserLoad.hasHttpDocument({errorDomain: 7, errorCode: -3}, 7));
        verify(!BrowserLoad.hasHttpDocument(null, 7));
    }
}
