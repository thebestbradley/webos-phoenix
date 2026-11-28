// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The shell in the device's language and region (localeInfo): the dates
// and times in the locale's formats (LocaleFormat.js) with the 12 h / 24 h
// choice, the strings in the language (ShellTranslator and shell/i18n), and
// both following a change at once.

import QtQuick
import QtTest
import Phoenix.Shell
import Phoenix.Sim
import "../qml/Phoenix/Shell/LocaleFormat.js" as LF

Item {
    id: root
    width: 320
    height: 480

    Shell {
        id: shell
        anchors.fill: parent
        formFactor: "phone"
        source: SimWindowSource { id: windows }
        system: SimSystemStatus {
            id: status
            fixedTime: new Date(2009, 5, 6, 21, 41)
        }
    }

    function info(ui, fmt) {
        return { locales: fmt ? { UI: ui, FMT: fmt } : { UI: ui }, clock: "locale" };
    }

    TestCase {
        name: "Locale"
        when: windowShown

        readonly property var june6: new Date(2009, 5, 6, 21, 41)
        readonly property var morning: new Date(2009, 5, 6, 9, 5)

        function init() {
            status.localeInfo = null;
            status.twentyFourHour = false;
            status.fixedTime = june6;
            // The menu reads the time when it opens (DateElement).
            findChild(shell, "systemMenuDate").refresh();
            shell.unlock();
        }
        function cleanupTestCase() {
            status.localeInfo = null;
        }

        // ---- LocaleFormat.js ------------------------------------------------------

        function test_tags() {
            compare(LF.uiTag(null), "en-US");
            compare(LF.formatTag(null), "en-US");
            compare(LF.uiTag(info("de_de")), "de-DE");
            compare(LF.formatTag(info("de-DE")), "de-DE", "no FMT: the language's");
            compare(LF.formatTag(info("en-US", "de-DE")), "de-DE", "FMT: the region's");
            compare(LF.uiTag({ locales: { UI: "nonsense!" } }), "en-US");
            compare(LF.qtName("zh-Hant-TW"), "zh_Hant_TW");
            verify(LF.isRightToLeft("ar-SA"));
            verify(LF.isRightToLeft("he-IL"));
            verify(LF.isRightToLeft("ku-Arab-IQ"));
            verify(!LF.isRightToLeft("ku-Latn"));
            verify(!LF.isRightToLeft("de-DE"));
        }

        function test_clockPerLocale_data() {
            return [
                { tag: "en-US 12 h", locale: "en-US", h24: false, date: june6, text: "9:41" },
                { tag: "en-US 24 h", locale: "en-US", h24: true, date: june6, text: "21:41" },
                { tag: "en-US 24 h morning", locale: "en-US", h24: true, date: morning, text: "09:05" },
                { tag: "de-DE 24 h", locale: "de-DE", h24: true, date: morning, text: "09:05" },
                { tag: "de-DE 12 h", locale: "de-DE", h24: false, date: june6, text: "9:41" },
                { tag: "ko-KR 12 h (AM/PM first)", locale: "ko-KR", h24: false, date: june6, text: "9:41" },
                { tag: "fi-FI 24 h (a full stop)", locale: "fi-FI", h24: true, date: june6, text: "21.41" },
                { tag: "ar-SA 12 h (Arabic digits)", locale: "ar-SA", h24: false, date: june6, text: "٩:٤١" },
            ];
        }
        function test_clockPerLocale(data) {
            compare(LF.clock(data.date, data.locale, data.h24), data.text);
        }

        function test_datesPerLocale_data() {
            return [
                { tag: "en-US", locale: "en-US", short: "6/6/09", long: "Saturday, June 6, 2009", day: "Saturday, June 6" },
                // en-GB's long date has a comma after the day name in newer
                // CLDR (Qt 6.11) and none in the CLDR of Qt 6.8.1, the
                // device's: both are the region's own format.
                { tag: "en-GB", locale: "en-GB", short: "06/06/2009", long: ["Saturday, 6 June 2009", "Saturday 6 June 2009"],
                  day: ["Saturday, 6 June", "Saturday 6 June"] },
                { tag: "de-DE", locale: "de-DE", short: "06.06.09", long: "Samstag, 6. Juni 2009", day: "Samstag, 6. Juni" },
                { tag: "es-ES", locale: "es-ES", short: "6/6/09", long: "sábado, 6 de junio de 2009", day: "sábado, 6 de junio" },
                { tag: "ja-JP", locale: "ja-JP", short: "2009/06/06", long: "2009年6月6日土曜日", day: "6月6日土曜日" },
            ];
        }
        // One expected text, or the few a locale's CLDR versions give.
        function compareText(actual, expected, what) {
            if (Array.isArray(expected))
                verify(expected.indexOf(actual) >= 0, (what || "") + " \"" + actual + "\" is one of " + JSON.stringify(expected));
            else
                compare(actual, expected, what);
        }

        function test_datesPerLocale(data) {
            compareText(LF.shortDate(june6, data.locale), data.short);
            compareText(LF.longDate(june6, data.locale), data.long);
            compareText(LF.dayAndMonth(june6, data.locale), data.day);
        }

        function test_withoutYear() {
            compare(LF.withoutYear("dddd, MMMM d, yyyy"), "dddd, MMMM d");
            compare(LF.withoutYear("dddd, d 'de' MMMM 'de' yyyy"), "dddd, d 'de' MMMM");
            compare(LF.withoutYear("yyyy年M月d日dddd"), "M月d日dddd");
            compare(LF.withoutYear("yyyy년 MMMM d일 dddd"), "MMMM d일 dddd");
            compare(LF.withoutYear("dddd، d MMMM yyyy"), "dddd، d MMMM");
        }

        function test_latinDigits() {
            compare(LF.latinDigits("٩:٤١"), "9:41");
            compare(LF.latinDigits("۲۱:۰۵"), "21:05");
            compare(LF.latinDigits("9:41"), "9:41");
        }

        // ---- The shell's dates and times ----------------------------------------------

        // QA (cloud/qa-system-ui): under C.UTF-8 the bar's date was "6 06 2009"
        // and the menu's "Saturday, 6 June 2009", the host's; the lock
        // screen's English whatever the locale.
        function test_englishWithoutLocaleInfo() {
            var bar = findChild(shell, "statusBar");
            compare(bar.clockText, "9:41");
            compare(findChild(shell, "systemMenuDate").label, "Saturday, June 6, 2009");
            shell.lock();
            compare(bar.clockText, "6/6/09");
            compare(findChild(shell, "lockDate").text, "Saturday, June 6");
        }

        function test_germanDates() {
            status.localeInfo = info("de-DE");
            var bar = findChild(shell, "statusBar");
            compare(bar.clockText, "9:41");
            status.twentyFourHour = true;
            compare(bar.clockText, "21:41");
            compare(findChild(shell, "systemMenuDate").label, "Samstag, 6. Juni 2009");
            shell.lock();
            compare(bar.clockText, "06.06.09");
            compare(findChild(shell, "lockDate").text, "Samstag, 6. Juni");
        }

        // The region's formats with another language (Settings > Language &
        // Region: Region).
        function test_regionDecidesTheFormats() {
            status.localeInfo = info("en-US", "en-GB");
            compareText(findChild(shell, "systemMenuDate").label, ["Saturday, 6 June 2009", "Saturday 6 June 2009"],
                        "the region's (en-GB) date, not the language's (en-US: Saturday, June 6, 2009):");
            shell.lock();
            compareText(findChild(shell, "lockDate").text, ["Saturday, 6 June", "Saturday 6 June"]);
        }

        // The lock screen's clock is pictures of 0-9 and the colon: Arabic's
        // own digits are drawn with them, a full stop with the colon.
        function test_lockClockDigits() {
            shell.lock();
            var clock = findChild(shell, "lockClock");
            compare(clock.text, "9:41");
            status.localeInfo = info("ar-SA");
            compare(clock.text, "9:41");
            status.twentyFourHour = true;
            compare(clock.text, "21:41");
            status.localeInfo = info("fi-FI");
            compare(clock.text, "21.41");
            // Five pictures: two digits, the colon's, two digits.
            tryVerify(function() { return findChild(clock, "lockClockChar3") !== null; });
            compare(findChild(clock, "lockClockChar2").source.toString().indexOf("screen-lock-clock-colon") >= 0, true);
            compare(findChild(clock, "lockClockChar2").width, Theme.lockColonWidth);
        }

        function test_liveSwitching() {
            var bar = findChild(shell, "statusBar");
            var menuDate = findChild(shell, "systemMenuDate");
            shell.lock();
            var lockDate = findChild(shell, "lockDate");
            compare(lockDate.text, "Saturday, June 6");
            status.localeInfo = info("de-DE");
            compare(lockDate.text, "Samstag, 6. Juni");
            compare(bar.clockText, "06.06.09");
            compare(menuDate.label, "Samstag, 6. Juni 2009");
            status.localeInfo = info("fr-FR");
            compare(lockDate.text, "samedi 6 juin");
            compare(bar.clockText, "06/06/2009");
            status.localeInfo = info("en-US");
            compare(lockDate.text, "Saturday, June 6");
            compare(bar.clockText, "6/6/09");
        }

        function test_dockModeClocks() {
            var glass = findChild(shell, "glassClock");
            var flip = findChild(shell, "flipClock");
            verify(glass && flip);
            compare(glass.day, "Saturday, June 6, 2009");
            compare(flip.ampm, "PM");
            status.localeInfo = info("de-DE");
            compare(glass.day, "Samstag, 6. Juni 2009");
            compare(flip.month, Qt.locale("de_DE").standaloneMonthName(5, Locale.ShortFormat).toUpperCase());
            status.localeInfo = info("ko-KR");
            compare(flip.ampm, "오후");
        }

        // ---- The shell's strings ---------------------------------------------------

        function test_translations() {
            var airplane = findChild(shell, "systemMenuAirplane");
            compare(shell.translation, "");
            compare(airplane.label, "Turn on Airplane Mode");
            compare(shell.captureName(), "Card View");

            status.localeInfo = info("de-DE");
            compare(shell.translation, "de");
            compare(airplane.label, "Flugmodus einschalten");
            compare(shell.captureName(), "Kartenansicht");
            compare(findChild(shell, "systemMenuBattery").label.indexOf("Akku: "), 0);

            // Austrian German: the German translation.
            status.localeInfo = info("de-AT");
            compare(shell.translation, "de");

            status.localeInfo = info("ar-SA");
            compare(shell.translation, "ar");
            compare(airplane.label, "تشغيل وضع الطيران");
            verify(shell.rightToLeft);

            // A language with no translation: the English source.
            status.localeInfo = info("sv-SE");
            compare(shell.translation, "");
            compare(airplane.label, "Turn on Airplane Mode");
            verify(!shell.rightToLeft);

            status.localeInfo = info("en-US");
            compare(airplane.label, "Turn on Airplane Mode");
        }

        // The unlock panel's plural ("%n digit(s) entered") in Arabic's six
        // forms and German's two.
        function test_plurals() {
            status.localeInfo = info("de-DE");
            compare(qsTranslate("UnlockPanel", "%n digit(s) entered", "", 1), "1 Ziffer eingegeben");
            compare(qsTranslate("UnlockPanel", "%n digit(s) entered", "", 4), "4 Ziffern eingegeben");
            status.localeInfo = info("ar-SA");
            compare(qsTranslate("UnlockPanel", "%n digit(s) entered", "", 2), "تم إدخال رقمين");
            status.localeInfo = null;
            compare(qsTranslate("UnlockPanel", "%n digit(s) entered", "", 4), "4 digit(s) entered");
        }
    }
}
