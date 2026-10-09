// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Colour emoji for the simulator on Linux (GAPS V6): a fontconfig
// configuration that adds the bundled Noto Color Emoji and its rule
// (assets/fonts/noto-color-emoji/50-phoenix-emoji.conf) to the system's, as
// a device installs them in /usr/share/fonts and /etc/fonts/conf.d.

#pragma once

#include <QString>

namespace SimFonts {

// Writes the configuration for the font folder emojiDir into confDir and
// returns its path, or "" when emojiDir has no font or it cannot be
// written. Each font folder (each checkout) gets a file of its own, written
// whole before it replaces the old one: simulators started from different
// checkouts at once never read another's, or one half written.
QString writeEmojiFontConfig(const QString &emojiDir, const QString &confDir);

}
