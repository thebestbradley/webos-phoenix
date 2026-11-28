// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "shelltranslator.h"

#include <QCoreApplication>
#include <QFileInfo>
#include <QLocale>
#include <QQmlEngine>

ShellTranslator::ShellTranslator(QObject *parent)
    : QObject(parent)
    , m_directory(QStringLiteral(":/phoenix/i18n"))
{
}

ShellTranslator::~ShellTranslator()
{
    if (m_translator)
        QCoreApplication::removeTranslator(m_translator.get());
}

void ShellTranslator::setLanguage(const QString &language)
{
    if (language == m_language)
        return;
    m_language = language;
    emit languageChanged();
    reload();
}

void ShellTranslator::setDirectory(const QString &directory)
{
    if (directory == m_directory)
        return;
    m_directory = directory;
    emit languageChanged();
    reload();
}

void ShellTranslator::reload()
{
    const QString tag = QString(m_language).replace(QLatin1Char('-'), QLatin1Char('_'));
    // The UI locale is Qt's default, as LocalePreferences made it
    // (QLocale::setDefault, LocalePreferences.cpp:602): Qt.locale() and
    // Number.toLocaleString() in the shell follow it.
    const QLocale locale = tag.isEmpty() ? QLocale(QLocale::English, QLocale::UnitedStates) : QLocale(tag);
    QLocale::setDefault(locale);

    std::unique_ptr<QTranslator> next;
    QString loaded;
    if (!tag.isEmpty()) {
        next = std::make_unique<QTranslator>();
        // phoenix-shell_de_DE.qm, then phoenix-shell_de.qm.
        if (next->load(locale, QStringLiteral("phoenix-shell"), QStringLiteral("_"), m_directory))
            loaded = QFileInfo(next->filePath()).completeBaseName().section(QLatin1Char('_'), 1);
        else
            next.reset();
    }
    if (m_translator)
        QCoreApplication::removeTranslator(m_translator.get());
    m_translator = std::move(next);
    if (m_translator)
        QCoreApplication::installTranslator(m_translator.get());

    if (QQmlEngine *engine = qmlEngine(this))
        engine->retranslate();
    if (loaded != m_loaded) {
        m_loaded = loaded;
        emit loadedChanged();
    }
}
