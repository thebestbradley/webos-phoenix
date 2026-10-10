// Phoenix compat overlay: the message viewer's original depends.js plus
// the files its message view needs that the release left out, so "Open
// Email in New Card" (MailApp.openNewCard, mail/source/MailApp.js:634-641,
// which opens this window with {message}) shows the message:
// - ../mail/source/HtmlView.js: DivHtmlView, the kind MessageDisplay
//   shows the body in (mail/source/MessageDisplay.js:146). Without it the
//   window threw "Failed to find a constructor for kind [DivHtmlView]" and
//   stayed blank; the mail window's depends.js lists it.
// - ../mail/source/phoenix-compat.js and ../css/phoenix-compat.css, as in
//   the mail window (mail/depends.js): the message view's fixes (see those
//   files).
// Nothing else is changed.
//
// @@@LICENSE
//
//      Copyright (c) 2010-2013 LG Electronics, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// LICENSE@@@

enyo.depends
    (
        "../controls/",
        "../util/CachedFile.js",
        "$enyo-lib/printdialog/",
        "$enyo-lib/contactsui/",
        "../util/util.js",
        "../facades/Email.js",
        "../facades/Folder.js", /* FIXME move to Controls depends for move to folder dialog */
        "../mail/source/MessagePane.js",
        "../mail/source/HtmlView.js", // Phoenix: see above
        "../mail/source/MessageDisplay.js",
        "../mail/source/MessageLoader.js",
        "../mail/source/phoenix-compat.js", // Phoenix: see above
        "source/EmailViewerWindow.js",
        "../css/mail.css",
        "../css/overrides.css",
        "../css/phoenix-compat.css" // Phoenix: see above
    );
