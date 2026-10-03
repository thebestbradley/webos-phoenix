// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "hidpi.h"

#include <QDir>
#include <QFileInfo>
#include <QImageReader>
#include <QRegularExpression>

namespace {

// The file behind a URL, or "" for URLs that are not files.
QString pathOf(const QUrl &url)
{
    if (url.isLocalFile())
        return url.toLocalFile();
    if (url.scheme() == QLatin1String("qrc"))
        return QLatin1Char(':') + url.path();
    return QString();
}

QUrl urlOf(const QUrl &like, const QString &path)
{
    if (like.scheme() == QLatin1String("qrc")) {
        QUrl u(like);
        u.setPath(path.mid(1));
        return u;
    }
    return QUrl::fromLocalFile(path);
}

QString factorName(qreal k)
{
    return QLatin1Char('@') + QString::number(k) + QLatin1Char('x');
}

// "name.png" -> "name@2x.png"
QString variantPath(const QString &path, qreal k)
{
    const QFileInfo fi(path);
    const QString suffix = fi.completeSuffix().isEmpty() ? QString() : QLatin1Char('.') + fi.suffix();
    const QString base = path.left(path.size() - suffix.size());
    return base + factorName(k) + suffix;
}

} // namespace

const QList<qreal> &HiDpi::factors()
{
    static const QList<qreal> f { 1.5, 2, 3, 4 };
    return f;
}

QUrl HiDpi::variant(const QUrl &url, qreal scale) const
{
    if (!(scale > 1))
        return url;
    const QString path = pathOf(url);
    if (path.isEmpty() || path.endsWith(QLatin1Char('/')))
        return url;
    const QString key = url.toString() + QLatin1Char('|') + QString::number(scale);
    const auto hit = m_variants.constFind(key);
    if (hit != m_variants.constEnd())
        return *hit;

    QString best;       // smallest k >= scale
    QString largest;    // largest k available
    for (qreal k : factors()) {
        const QString p = variantPath(path, k);
        if (!QFileInfo::exists(p))
            continue;
        largest = p;
        if (best.isEmpty() && k >= scale)
            best = p;
    }
    const QString chosen = !best.isEmpty() ? best : largest;
    const QUrl result = chosen.isEmpty() ? url : urlOf(url, chosen);
    m_variants.insert(key, result);
    return result;
}

qreal HiDpi::variantScale(const QUrl &url) const
{
    static const QRegularExpression re(QStringLiteral("@(\\d+(?:\\.\\d+)?)x\\.[^./]+$"));
    const auto m = re.match(url.path());
    if (!m.hasMatch())
        return 1;
    const qreal k = m.captured(1).toDouble();
    return k > 0 ? k : 1;
}

qreal HiDpi::borderScale(const QUrl &url) const
{
    // Qt's own test: '@', one digit, 'x', '.'.
    const QString path = url.path();
    const int at = path.lastIndexOf(QLatin1Char('@'));
    const bool qtRatio = at > 0 && at + 3 < path.size() && path.at(at + 1).isDigit()
        && path.at(at + 2) == QLatin1Char('x') && path.at(at + 3) == QLatin1Char('.');
    return qtRatio ? 1 : variantScale(url);
}

QSize HiDpi::imageSize(const QUrl &url) const
{
    const QString path = pathOf(url);
    if (path.isEmpty())
        return QSize(-1, -1);
    const auto hit = m_sizes.constFind(path);
    if (hit != m_sizes.constEnd())
        return *hit;
    QImageReader reader(path);
    QSize s = reader.size();
    if (!s.isValid())
        s = QSize(-1, -1);
    m_sizes.insert(path, s);
    return s;
}

QUrl HiDpi::icon(const QUrl &url, qreal pixels, const QUrl &large) const
{
    const QString path = pathOf(url);
    if (path.isEmpty())
        return url;
    const QSize own = imageSize(url);
    const int ownSide = qMax(own.width(), own.height());
    if (ownSide >= pixels)
        return url;

    // icon.png's siblings: icon-256x256.png, icon-256.png, icon@2x.png,
    // beside it or in a twin directory.
    QStringList candidates = m_siblings.value(path);
    if (!m_siblings.contains(path)) {
        const QFileInfo fi(path);
        const QString stem = fi.completeBaseName();
        const QRegularExpression re(QLatin1Char('^') + QRegularExpression::escape(stem)
            + QStringLiteral("(?:-\\d+(?:x\\d+)?|@\\d+(?:\\.\\d+)?x)\\.")
            + QRegularExpression::escape(fi.suffix()) + QLatin1Char('$'));
        for (const QString &dirPath : siblingDirs(fi.absolutePath())) {
            const QDir dir(dirPath);
            const QStringList names = dir.entryList({ stem + QStringLiteral("*.") + fi.suffix() }, QDir::Files);
            for (const QString &name : names)
                if (re.match(name).hasMatch())
                    candidates.append(dir.filePath(name));
        }
        m_siblings.insert(path, candidates);
    }
    const QString largePath = pathOf(large);
    if (!largePath.isEmpty() && largePath != path && !candidates.contains(largePath))
        candidates.prepend(largePath);

    QString best;
    int bestSide = 0;
    QString biggest;
    int biggestSide = ownSide;
    for (const QString &c : candidates) {
        const QSize s = imageSize(urlOf(url, c));
        const int side = qMax(s.width(), s.height());
        if (side <= 0)
            continue;
        if (side >= pixels && (best.isEmpty() || side < bestSide)) {
            best = c;
            bestSide = side;
        }
        if (side > biggestSide) {
            biggest = c;
            biggestSide = side;
        }
    }
    if (!best.isEmpty())
        return urlOf(url, best);
    if (!biggest.isEmpty())
        return urlOf(url, biggest);
    return url;
}

void HiDpi::addTwinDirectory(const QString &dir, const QString &twin)
{
    const QString d = QDir::cleanPath(dir);
    const QString t = QDir::cleanPath(twin);
    if (d.isEmpty() || t.isEmpty() || d == t || m_twins.contains({ d, t }))
        return;
    m_twins.append({ d, t });
    m_siblings.clear();
}

QStringList HiDpi::siblingDirs(const QString &dir) const
{
    QStringList dirs { dir };
    const QString d = QDir::cleanPath(dir);
    for (const auto &twin : m_twins) {
        QString other;
        if (d == twin.first)
            other = twin.second;
        else if (d.startsWith(twin.first + QLatin1Char('/')))
            other = twin.second + d.mid(twin.first.size());
        if (!other.isEmpty() && !dirs.contains(other) && QFileInfo(other).isDir())
            dirs.append(other);
    }
    return dirs;
}
