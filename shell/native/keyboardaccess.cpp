// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "keyboardaccess.h"

#include <QCoreApplication>
#include <QDateTime>
#include <QKeyEvent>
#include <QTimerEvent>
#include <QWindow>
#include <iterator>

namespace {

bool isModifierKey(int key)
{
    switch (key) {
    case Qt::Key_Shift:
    case Qt::Key_Control:
    case Qt::Key_Alt:
    case Qt::Key_AltGr:
    case Qt::Key_Meta:
    case Qt::Key_Super_L:
    case Qt::Key_Super_R:
        return true;
    default:
        return false;
    }
}

} // namespace

KeyboardAccess::KeyboardAccess(QObject *parent)
    : QObject(parent)
{
    if (QCoreApplication::instance())
        QCoreApplication::instance()->installEventFilter(this);
}

KeyboardAccess::~KeyboardAccess()
{
    if (QCoreApplication::instance())
        QCoreApplication::instance()->removeEventFilter(this);
}

#define KA_SETTER(name, member, type)              \
    void KeyboardAccess::name(type v)              \
    {                                              \
        if (member == v)                           \
            return;                                \
        member = v;                                \
        emit settingsChanged();                    \
    }

KA_SETTER(setSlowKeysDelay, m_slowDelay, int)
KA_SETTER(setBounceKeys, m_bounce, bool)
KA_SETTER(setBounceKeysDelay, m_bounceDelay, int)
KA_SETTER(setRepeatDelay, m_repeatDelay, int)
KA_SETTER(setRepeatInterval, m_repeatInterval, int)
#undef KA_SETTER

void KeyboardAccess::setStickyKeys(bool on)
{
    if (m_sticky == on)
        return;
    m_sticky = on;
    if (!on)
        clearModifiers();
    emit settingsChanged();
}

void KeyboardAccess::setSlowKeys(bool on)
{
    if (m_slow == on)
        return;
    m_slow = on;
    if (!on) {
        m_slowTimer.stop();
        m_slowKey = 0;
    }
    emit settingsChanged();
}

void KeyboardAccess::setCustomRepeat(bool on)
{
    if (m_customRepeat == on)
        return;
    m_customRepeat = on;
    if (!on)
        stopRepeat();
    emit settingsChanged();
}

void KeyboardAccess::clearModifiers()
{
    if (!m_latched && !m_locked)
        return;
    m_latched = {};
    m_locked = {};
    emit modifiersChanged();
}

Qt::KeyboardModifier KeyboardAccess::modifierFor(int key)
{
    switch (key) {
    case Qt::Key_Shift: return Qt::ShiftModifier;
    case Qt::Key_Control: return Qt::ControlModifier;
    case Qt::Key_Alt:
    case Qt::Key_AltGr: return Qt::AltModifier;
    case Qt::Key_Meta:
    case Qt::Key_Super_L:
    case Qt::Key_Super_R: return Qt::MetaModifier;
    default: return Qt::NoModifier;
    }
}

void KeyboardAccess::send(QWindow *window, QEvent::Type type, int key, Qt::KeyboardModifiers mods, const QString &text,
                          bool autoRepeat, quint32 scanCode, quint32 virtualKey, quint32 nativeMods)
{
    if (!window)
        return;
    QString t = text;
    // A latched Shift capitalises the letter as a held one would.
    if ((mods & Qt::ShiftModifier) && t.size() == 1 && t.at(0).isLetter())
        t = t.toUpper();
    QKeyEvent ev(type, key, mods, scanCode, virtualKey, nativeMods, t, autoRepeat);
    ++m_sending;
    QCoreApplication::sendEvent(window, &ev);
    --m_sending;
}

bool KeyboardAccess::deliverPress(QWindow *window, QKeyEvent *key)
{
    // key is either the keyboard's own event (false: let it go on, unless
    // sticky modifiers change it) or one slow keys held back (always sent).
    const bool heldBack = !key->spontaneous();
    const int code = key->key();
    Qt::KeyboardModifiers mods = key->modifiers();
    bool sent = false;

    if (m_sticky) {
        if (isModifierKey(code)) {
            m_modifierDown = code;
            m_otherSinceModifier = false;
        } else {
            if (m_modifierDown)
                m_otherSinceModifier = true;
            const Qt::KeyboardModifiers extra = m_latched | m_locked;
            if (extra) {
                mods |= extra;
                send(window, QEvent::KeyPress, code, mods, key->text(), false,
                     key->nativeScanCode(), key->nativeVirtualKey(), key->nativeModifiers());
                m_stickyPressed.insert(code);
                m_stickyMods = mods;
                sent = true;
                if (m_latched) {
                    m_latched = {};
                    emit modifiersChanged();
                }
            }
        }
    }
    if (!sent && heldBack) {
        send(window, QEvent::KeyPress, code, mods, key->text(), false,
             key->nativeScanCode(), key->nativeVirtualKey(), key->nativeModifiers());
        sent = true;
    }

    if (m_customRepeat && m_repeatDelay > 0 && !isModifierKey(code)) {
        m_repeatWindow = window;
        m_repeatKey = code;
        m_repeatMods = mods;
        m_repeatText = key->text();
        m_repeatScan = key->nativeScanCode();
        m_repeatVirtual = key->nativeVirtualKey();
        m_repeatNativeMods = key->nativeModifiers();
        // Precise: a key's repeat is timing the user feels; a coarse timer
        // may be coalesced (macOS defers a background process's timers).
        m_repeatTimer.start(m_repeatDelay, Qt::PreciseTimer, this);
    }
    return sent;
}

bool KeyboardAccess::deliverRelease(QWindow *window, QKeyEvent *key)
{
    const int code = key->key();
    if (code == m_repeatKey)
        stopRepeat();

    if (m_sticky && isModifierKey(code)) {
        if (m_modifierDown == code && !m_otherSinceModifier) {
            // On its own: latch it; again: lock it; again: let it go.
            const Qt::KeyboardModifier mod = modifierFor(code);
            if (m_locked & mod) {
                m_locked &= ~mod;
            } else if (m_latched & mod) {
                m_latched &= ~mod;
                m_locked |= mod;
            } else {
                m_latched |= mod;
            }
            emit modifiersChanged();
        }
        m_modifierDown = 0;
        return false;
    }
    if (m_stickyPressed.remove(code)) {
        send(window, QEvent::KeyRelease, code, m_stickyMods, key->text(), false,
             key->nativeScanCode(), key->nativeVirtualKey(), key->nativeModifiers());
        return true;
    }
    return false;
}

void KeyboardAccess::stopRepeat()
{
    m_repeatTimer.stop();
    m_repeatKey = 0;
}

void KeyboardAccess::setLayout(const QString &l)
{
    const QString v = l == QLatin1String("qwertz") || l == QLatin1String("azerty") ? l : QStringLiteral("auto");
    if (v == m_layout)
        return;
    m_layout = v;
    emit settingsChanged();
}

void KeyboardAccess::setKeyRemap(const QVariantMap &m)
{
    if (m == m_remap)
        return;
    m_remap = m;
    m_remapHeld = {};
    m_remapDown.clear();
    emit settingsChanged();
}

namespace {
// keyRemap's names for the keys it remaps, and the Qt keys of its targets.
QString remapName(int key)
{
    switch (key) {
    case Qt::Key_CapsLock: return QStringLiteral("capslock");
    case Qt::Key_Control: return QStringLiteral("control");
    case Qt::Key_Alt: return QStringLiteral("alt");
    case Qt::Key_Meta:
    case Qt::Key_Super_L:
    case Qt::Key_Super_R: return QStringLiteral("meta");
    default: return QString();
    }
}
int remapKey(const QString &target)
{
    if (target == QLatin1String("capslock")) return Qt::Key_CapsLock;
    if (target == QLatin1String("control")) return Qt::Key_Control;
    if (target == QLatin1String("alt")) return Qt::Key_Alt;
    if (target == QLatin1String("meta")) return Qt::Key_Meta;
    if (target == QLatin1String("escape")) return Qt::Key_Escape;
    return 0;
}
// evdev KEY_KEYBOARD (374) + 8: the TouchPad keyboard's keyboard key.
constexpr quint32 kKeyboardKeyScanCode = 382;

// What a US keyboard's keys type, by key: the unshifted character of the
// key a shifted one came from ("!" is the 1 key).
QChar usBase(QChar c)
{
    static const QString shifted = QStringLiteral("!@#$%^&*()_+{}|:\"~<>?");
    static const QString base = QStringLiteral("1234567890-=[]\\;'`,./");
    const int i = shifted.indexOf(c);
    return i >= 0 ? base.at(i) : c.toLower();
}
} // namespace

QString KeyboardAccess::remapTarget(int key) const
{
    const QString name = remapName(key);
    if (name.isEmpty())
        return QString();
    const QString t = m_remap.value(name).toString();
    return t.isEmpty() || t == name ? QString() : t;
}

// The modifiers of keys remapped to something else: their own no longer count.
Qt::KeyboardModifiers KeyboardAccess::strippedModifiers() const
{
    Qt::KeyboardModifiers m;
    if (!remapTarget(Qt::Key_Control).isEmpty()) m |= Qt::ControlModifier;
    if (!remapTarget(Qt::Key_Alt).isEmpty()) m |= Qt::AltModifier;
    if (!remapTarget(Qt::Key_Meta).isEmpty()) m |= Qt::MetaModifier;
    return m;
}

bool KeyboardAccess::translate(const QString &layout, int key, bool shift, int *outKey, QString *outText)
{
    Q_UNUSED(key);
    // The key's place: its unshifted US character.
    const QChar base = outText->size() == 1 ? usBase(outText->at(0)) : QChar();
    if (base.isNull())
        return false;
    // [US base, unshifted, shifted] for the keys the layout moves.
    struct Entry { char16_t us; char16_t plain; char16_t shifted; };
    static const Entry qwertz[] = {
        { u'y', u'z', u'Z' }, { u'z', u'y', u'Y' },
        { u';', u'\u00f6', u'\u00d6' }, { u'\'', u'\u00e4', u'\u00c4' }, { u'[', u'\u00fc', u'\u00dc' },
        { u'-', u'\u00df', u'?' }, { u']', u'+', u'*' }, { u'\\', u'#', u'\'' }, { u'/', u'-', u'_' },
        { u',', u',', u';' }, { u'.', u'.', u':' }, { u'`', u'^', u'\u00b0' }, { u'=', u'\u00b4', u'`' },
        { u'1', u'1', u'!' }, { u'2', u'2', u'"' }, { u'3', u'3', u'\u00a7' }, { u'4', u'4', u'$' },
        { u'5', u'5', u'%' }, { u'6', u'6', u'&' }, { u'7', u'7', u'/' }, { u'8', u'8', u'(' },
        { u'9', u'9', u')' }, { u'0', u'0', u'=' },
    };
    static const Entry azerty[] = {
        { u'q', u'a', u'A' }, { u'a', u'q', u'Q' }, { u'w', u'z', u'Z' }, { u'z', u'w', u'W' },
        { u';', u'm', u'M' }, { u'm', u',', u'?' }, { u',', u';', u'.' }, { u'.', u':', u'/' },
        { u'/', u'!', u'\u00a7' }, { u'\'', u'\u00f9', u'%' }, { u'[', u'^', u'\u00a8' }, { u']', u'$', u'\u00a3' },
        { u'\\', u'*', u'\u00b5' }, { u'-', u')', u'\u00b0' }, { u'=', u'=', u'+' }, { u'`', u'\u00b2', u'\u00b2' },
        { u'1', u'&', u'1' }, { u'2', u'\u00e9', u'2' }, { u'3', u'"', u'3' }, { u'4', u'\'', u'4' },
        { u'5', u'(', u'5' }, { u'6', u'-', u'6' }, { u'7', u'\u00e8', u'7' }, { u'8', u'_', u'8' },
        { u'9', u'\u00e7', u'9' }, { u'0', u'\u00e0', u'0' },
    };
    const Entry *table = nullptr;
    size_t n = 0;
    if (layout == QLatin1String("qwertz")) { table = qwertz; n = std::size(qwertz); }
    else if (layout == QLatin1String("azerty")) { table = azerty; n = std::size(azerty); }
    for (size_t i = 0; table && i < n; ++i) {
        if (table[i].us != base.unicode())
            continue;
        const QChar c(shift ? table[i].shifted : table[i].plain);
        *outText = QString(c);
        // Qt's key for a character: a letter's capital (Key_A, Key_Odiaeresis).
        const QChar upper = c.toUpper();
        *outKey = c.isLetter() && upper.unicode() < 0x100 ? upper.unicode() : c.unicode();
        return true;
    }
    return false;
}

bool KeyboardAccess::eventFilter(QObject *watched, QEvent *event)
{
    const QEvent::Type type = event->type();
    if (type != QEvent::KeyPress && type != QEvent::KeyRelease)
        return false;
    // Once per key, at the window (it then goes to the focused item).
    auto *window = qobject_cast<QWindow *>(watched);
    if (!window || m_sending || !event->spontaneous())
        return false;
    auto *key = static_cast<QKeyEvent *>(event);
    int code = key->key();

    if (!m_hardwareKeySeen) {
        m_hardwareKeySeen = true;
        emit hardwareKeySeenChanged();
    }
    // (The keyboard key is not typing: the virtual keyboard it brings up
    // stays.)
    const bool keyboardKey = key->nativeScanCode() == kKeyboardKeyScanCode
                             || remapTarget(code) == QLatin1String("keyboard");
    if (type == QEvent::KeyPress && !key->isAutoRepeat() && !keyboardKey)
        emit hardwareKeyPressed(code);

    // ---- Settings > Hardware Keyboard: the keyboard key, remapped keys, layout.
    const bool press = type == QEvent::KeyPress;
    if (key->nativeScanCode() == kKeyboardKeyScanCode) {
        if (press && !key->isAutoRepeat())
            emit keyboardKeyPressed();
        return true;
    }
    const QString target = remapTarget(code);
    if (!target.isEmpty() || m_remapDown.contains(code)) {
        // A modifier or Caps Lock remapped: what it is now is sent instead.
        if (press && !key->isAutoRepeat())
            m_remapDown.insert(code);
        else if (!press && !key->isAutoRepeat())
            m_remapDown.remove(code);
        const QString to = target.isEmpty() ? QString() : target;
        const int toKey = remapKey(to);
        const Qt::KeyboardModifier toMod = modifierFor(toKey);
        if (toMod != Qt::NoModifier && !key->isAutoRepeat()) {
            if (press) m_remapHeld |= toMod; else m_remapHeld &= ~toMod;
        }
        if (to == QLatin1String("keyboard") && press && !key->isAutoRepeat())
            emit keyboardKeyPressed();
        if (toKey) {
            const Qt::KeyboardModifiers mods = (key->modifiers() & ~strippedModifiers()) | m_remapHeld;
            QKeyEvent mapped(type, toKey, mods, key->nativeScanCode(), key->nativeVirtualKey(),
                             key->nativeModifiers(), toKey == Qt::Key_Escape ? QStringLiteral("\x1b") : QString(),
                             key->isAutoRepeat());
            if (!filterKey(window, &mapped))
                send(window, type, toKey, mods, mapped.text(), key->isAutoRepeat(),
                     key->nativeScanCode(), key->nativeVirtualKey(), key->nativeModifiers());
        }
        return true;                       // "none", "keyboard": nothing typed
    }
    Qt::KeyboardModifiers mods = key->modifiers();
    QString text = key->text();
    bool changed = false;
    if (!m_remap.isEmpty()) {
        const Qt::KeyboardModifiers m = (mods & ~strippedModifiers()) | m_remapHeld;
        if (m != mods) {
            mods = m;
            changed = true;
            // A Ctrl or Meta that was not there types no text.
            if (mods & (Qt::ControlModifier | Qt::MetaModifier))
                text.clear();
        }
        // Caps Lock remapped away: the keyboard's own caps lock (xkb's)
        // still changes the letters; their case is Shift's alone.
        if (!remapTarget(Qt::Key_CapsLock).isEmpty() && text.size() == 1 && text.at(0).isLetter()) {
            const QString t = (mods & Qt::ShiftModifier) ? text.toUpper() : text.toLower();
            if (t != text) { text = t; changed = true; }
        }
    }
    if (m_layout != QLatin1String("auto") && !(mods & (Qt::ControlModifier | Qt::MetaModifier | Qt::AltModifier))) {
        int k = code;
        QString t = text;
        if (translate(m_layout, code, mods & Qt::ShiftModifier, &k, &t) && (k != code || t != text)) {
            // A letter keeps the case Caps Lock gave it.
            if (t.size() == 1 && t.at(0).isLetter() && text.size() == 1 && text.at(0).isUpper() != t.at(0).isUpper()
                && !(mods & Qt::ShiftModifier) && text.at(0).isLetter())
                t = text.at(0).isUpper() ? t.toUpper() : t.toLower();
            code = k;
            text = t;
            changed = true;
        }
    }
    if (changed) {
        QKeyEvent mapped(type, code, mods, key->nativeScanCode(), key->nativeVirtualKey(), key->nativeModifiers(),
                         text, key->isAutoRepeat());
        if (!filterKey(window, &mapped))
            send(window, type, code, mods, text, key->isAutoRepeat(),
                 key->nativeScanCode(), key->nativeVirtualKey(), key->nativeModifiers());
        return true;
    }
    return filterKey(window, key);
}

bool KeyboardAccess::filterKey(QWindow *window, QKeyEvent *key)
{
    const QEvent::Type type = key->type();
    const int code = key->key();
    if (!m_sticky && !m_slow && !m_bounce && !m_customRepeat)
        return false;

    if (key->isAutoRepeat()) {
        // Ours replace the keyboard's; a key not (yet) counted does not repeat.
        if (m_customRepeat || m_bounced.contains(code) || (m_slow && code == m_slowKey))
            return true;
        if (type == QEvent::KeyPress && m_stickyPressed.contains(code)) {
            send(window, type, code, m_stickyMods, key->text(), true,
                 key->nativeScanCode(), key->nativeVirtualKey(), key->nativeModifiers());
            return true;
        }
        if (type == QEvent::KeyRelease && m_stickyPressed.contains(code))
            return true;
        return false;
    }

    if (type == QEvent::KeyPress) {
        if (m_bounce && code == m_lastReleasedKey
            && QDateTime::currentMSecsSinceEpoch() - m_lastReleaseTime < m_bounceDelay) {
            m_bounced.insert(code);
            emit keyIgnored(code);
            return true;
        }
        if (m_slow) {
            // Wait: it counts if still down after slowKeysDelay.
            m_slowTimer.start(m_slowDelay, Qt::PreciseTimer, this);
            m_slowWindow = window;
            m_slowKey = code;
            m_slowMods = key->modifiers();
            m_slowText = key->text();
            m_slowScan = key->nativeScanCode();
            m_slowVirtual = key->nativeVirtualKey();
            m_slowNativeMods = key->nativeModifiers();
            return true;
        }
        return deliverPress(window, key);
    }

    // KeyRelease
    if (m_bounced.remove(code))
        return true;
    m_lastReleasedKey = code;
    m_lastReleaseTime = QDateTime::currentMSecsSinceEpoch();
    if (m_slow) {
        if (code == m_slowKey) {
            // Let go too soon: it never happened.
            m_slowTimer.stop();
            m_slowKey = 0;
            emit keyIgnored(code);
            return true;
        }
        // Held long enough: its release goes on as usual.
        m_slowAccepted.remove(code);
    }
    return deliverRelease(window, key);
}

void KeyboardAccess::timerEvent(QTimerEvent *event)
{
    if (event->timerId() == m_slowTimer.timerId()) {
        m_slowTimer.stop();
        const int code = m_slowKey;
        m_slowKey = 0;
        if (!m_slowWindow || !code)
            return;
        m_slowAccepted.insert(code);
        // A stand-in for the press, not spontaneous: deliverPress sends it.
        QKeyEvent press(QEvent::KeyPress, code, m_slowMods, m_slowScan, m_slowVirtual, m_slowNativeMods,
                        m_slowText, false);
        deliverPress(m_slowWindow, &press);
        return;
    }
    if (event->timerId() == m_repeatTimer.timerId()) {
        if (!m_repeatWindow || !m_repeatKey) {
            stopRepeat();
            return;
        }
        m_repeatTimer.start(qMax(10, m_repeatInterval), Qt::PreciseTimer, this);
        send(m_repeatWindow, QEvent::KeyPress, m_repeatKey, m_repeatMods, m_repeatText, true,
             m_repeatScan, m_repeatVirtual, m_repeatNativeMods);
        return;
    }
    QObject::timerEvent(event);
}
