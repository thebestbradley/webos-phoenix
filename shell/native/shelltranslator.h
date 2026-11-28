// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The shell's strings in the device's language: a QTranslator with
// phoenix-shell_<language>.qm installed for `language` (a BCP 47 tag,
// "de-DE", or Qt's "de_DE"), and the engine's qsTr() bindings evaluated
// again, so the shell changes language at once.
//
// luna-sysmgr looked its strings up with LOCALIZED() in the locale's
// strings.json (luna-sysmgr-common Src/base/Localization.cpp:57-106,
// loaded for LocalePreferences::locale()) and made the UI locale Qt's
// default (QLocale::setDefault, LocalePreferences.cpp:602); it restarted
// to take a new language (ProcessKiller::localeChanged, luna-sysmgr
// Src/Main.cpp:919). Phoenix's QML uses qsTr() (Qt's LOCALIZED()), and
// follows the change live instead. The .qm files are built from
// shell/i18n/*.ts into the plugin's resources (:/phoenix/i18n); a language
// without one falls back as QTranslator does ("de_AT" -> "de"), and to the
// English in the source.

#pragma once

#include <QObject>
#include <QString>
#include <QTranslator>
#include <QtQml/qqmlregistration.h>

#include <memory>

class ShellTranslator : public QObject
{
    Q_OBJECT
    QML_ELEMENT

    // The device's language ("de-DE"); "" is English, the source's.
    Q_PROPERTY(QString language READ language WRITE setLanguage NOTIFY languageChanged)
    // Where the .qm files are: the plugin's own by default.
    Q_PROPERTY(QString directory READ directory WRITE setDirectory NOTIFY languageChanged)
    // The translation in use: its file's language ("de"), "" for none.
    Q_PROPERTY(QString loadedLanguage READ loadedLanguage NOTIFY loadedChanged)

public:
    explicit ShellTranslator(QObject *parent = nullptr);
    ~ShellTranslator() override;

    QString language() const { return m_language; }
    void setLanguage(const QString &language);
    QString directory() const { return m_directory; }
    void setDirectory(const QString &directory);
    QString loadedLanguage() const { return m_loaded; }

signals:
    void languageChanged();
    void loadedChanged();

private:
    void reload();

    QString m_language;
    QString m_directory;
    QString m_loaded;
    std::unique_ptr<QTranslator> m_translator;
};
