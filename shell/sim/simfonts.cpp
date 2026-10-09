// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "simfonts.h"

#include <QCryptographicHash>
#include <QDir>
#include <QSaveFile>

QString SimFonts::writeEmojiFontConfig(const QString &emojiDir, const QString &confDir)
{
    const QDir dir(emojiDir);
    if (!dir.exists(QStringLiteral("NotoColorEmoji.ttf")))
        return {};
    if (!QDir().mkpath(confDir))
        return {};
    const QByteArray id = QCryptographicHash::hash(dir.absolutePath().toUtf8(), QCryptographicHash::Sha1).toHex().left(12);
    QSaveFile conf(QDir(confDir).filePath(QStringLiteral("fonts-%1.conf").arg(QString::fromLatin1(id))));
    if (!conf.open(QIODevice::WriteOnly))
        return {};
    conf.write("<?xml version=\"1.0\"?>\n<!DOCTYPE fontconfig SYSTEM \"urn:fontconfig:fonts.dtd\">\n<fontconfig>\n"
               "  <include ignore_missing=\"yes\">/etc/fonts/fonts.conf</include>\n"
               "  <dir>" + dir.absolutePath().toHtmlEscaped().toUtf8() + "</dir>\n"
               "  <include ignore_missing=\"yes\">"
               + dir.absoluteFilePath(QStringLiteral("50-phoenix-emoji.conf")).toHtmlEscaped().toUtf8()
               + "</include>\n</fontconfig>\n");
    if (!conf.commit())
        return {};
    return conf.fileName();
}
