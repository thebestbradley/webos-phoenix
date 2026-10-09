// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// simfonts-test: the fontconfig setup phoenix-sim makes for colour emoji
// (SimFonts, assets/fonts/noto-color-emoji/50-phoenix-emoji.conf), checked
// through Qt's own font matching, on Linux:
// - emoji in the shell's text font come from Noto Color Emoji, and
// - the generic families (the default font, sans-serif, serif, monospace)
//   stay text fonts. The rule once bound the emoji font as strongly as the
//   family asked for, which made it the best match for a generic family:
//   default text got the emoji font's bitmap digits, and on Qt 6.4 styled
//   text (outline, raised) with them aborted in QFontEngineFT::loadGlyph.
//
//   build/simfonts-test

#include "simfonts.h"

#include <QDir>
#include <QFile>
#include <QFont>
#include <QFontDatabase>
#include <QFontInfo>
#include <QGuiApplication>
#include <QRawFont>
#include <QSet>
#include <QTemporaryDir>
#include <QTextLayout>
#include <cstdio>

static int failures = 0;
static void check(bool ok, const QString &what)
{
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", qPrintable(what));
    if (!ok)
        ++failures;
}

static const QString kEmoji = QStringLiteral("Noto Color Emoji");

// The families of the fonts that draw text in font, in order.
static QStringList drawnWith(const QFont &font, const QString &text)
{
    QTextLayout layout(text, font);
    layout.beginLayout();
    layout.createLine();
    layout.endLayout();
    QStringList families;
    for (const QGlyphRun &run : layout.glyphRuns())
        families.append(run.rawFont().familyName());
    return families;
}

int main(int argc, char **argv)
{
    const QDir assets(QStringLiteral(PHOENIX_REPO_DIR "/shell/assets/fonts"));
    QTemporaryDir tmp;
    const QString conf = SimFonts::writeEmojiFontConfig(assets.filePath(QStringLiteral("noto-color-emoji")), tmp.path());
    check(!conf.isEmpty() && QFile::exists(conf), QStringLiteral("the configuration is written"));
    check(SimFonts::writeEmojiFontConfig(tmp.path(), tmp.path()).isEmpty(), QStringLiteral("... and not for a folder without the font"));
    check(SimFonts::writeEmojiFontConfig(assets.filePath(QStringLiteral("noto-color-emoji")), tmp.path()) == conf,
          QStringLiteral("... the same file for the same font folder"));
    if (conf.isEmpty())
        return 1;
    qputenv("FONTCONFIG_FILE", QFile::encodeName(conf));
    if (qEnvironmentVariableIsEmpty("QT_QPA_PLATFORM"))
        qputenv("QT_QPA_PLATFORM", "offscreen");
    QGuiApplication app(argc, argv);
    // As the shell does (Theme.qml): Open Sans and the emoji font loaded.
    QFontDatabase::addApplicationFont(assets.filePath(QStringLiteral("open-sans/OpenSans-Regular.ttf")));
    QFontDatabase::addApplicationFont(assets.filePath(QStringLiteral("noto-color-emoji/NotoColorEmoji.ttf")));

    const QStringList generic = { QGuiApplication::font().family(), QStringLiteral("sans-serif"),
                                  QStringLiteral("serif"), QStringLiteral("monospace") };
    for (const QString &family : generic) {
        const QFont font(family);
        check(QFontInfo(font).family() != kEmoji,
              QStringLiteral("\"%1\" is a text font (%2)").arg(family, QFontInfo(font).family()));
        const QStringList digits = drawnWith(font, QStringLiteral("Hello 0123456789"));
        check(!digits.contains(kEmoji), QStringLiteral("... its letters and digits are not the emoji font's (%1)")
                                            .arg(QStringList(QSet<QString>(digits.begin(), digits.end()).values()).join(QStringLiteral(", "))));
    }

    const QFont openSans(QStringLiteral("Open Sans"));
    const QStringList text = drawnWith(openSans, QStringLiteral("Hi 0123456789"));
    check(text == QStringList { QStringLiteral("Open Sans") },
          QStringLiteral("the shell's text font draws its text (%1)").arg(text.join(QStringLiteral(", "))));
    const QStringList emoji = drawnWith(openSans, QStringLiteral("Hi \U0001F600 \U0001F44D\U0001F3FD"));
    check(emoji.contains(kEmoji), QStringLiteral("... and its emoji come from Noto Color Emoji (%1)").arg(emoji.join(QStringLiteral(", "))));

    std::printf("%s\n", failures ? "FAILED" : "all passed");
    return failures ? 1 : 0;
}
