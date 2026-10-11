// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// simlaunch-test: phoenix-sim's --launch values (simlaunch.h): an app id
// alone, an app id with its launch params as JSON, and the values refused.
//
//   build/simlaunch-test

#include "simlaunch.h"

#include <cstdio>

static int failures = 0;
static void check(bool ok, const QString &what)
{
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", qPrintable(what));
    if (!ok)
        ++failures;
}

int main()
{
    SimLaunch l;
    QString error;

    check(parseSimLaunch(QStringLiteral("org.webosphoenix.settings"), &l, &error)
              && l.appId == QLatin1String("org.webosphoenix.settings") && l.params.isEmpty(),
          QStringLiteral("an app id alone: no params"));

    check(parseSimLaunch(QStringLiteral("com.palm.app.clock:{\"action\": \"edit\", \"key\": \"alarm1\"}"), &l, &error)
              && l.appId == QLatin1String("com.palm.app.clock")
              && l.params.value(QStringLiteral("action")).toString() == QLatin1String("edit")
              && l.params.value(QStringLiteral("key")).toString() == QLatin1String("alarm1"),
          QStringLiteral("appId:{json}: the app and its params"));

    check(parseSimLaunch(QStringLiteral("com.palm.app.email:{\"target\": \"mailto:someone@example.com\", \"n\": 2, \"nested\": {\"a\": [1, 2]}}"), &l, &error)
              && l.appId == QLatin1String("com.palm.app.email")
              && l.params.value(QStringLiteral("target")).toString() == QLatin1String("mailto:someone@example.com")
              && l.params.value(QStringLiteral("n")).toInt() == 2
              && l.params.value(QStringLiteral("nested")).toMap().value(QStringLiteral("a")).toList().size() == 2,
          QStringLiteral("a \":\" inside the params, numbers and nested objects"));

    check(parseSimLaunch(QStringLiteral("com.palm.app.calculator:{}"), &l, &error) && l.params.isEmpty(),
          QStringLiteral("empty params: as without"));

    bool ok = !parseSimLaunch(QStringLiteral("com.palm.app.clock:{\"action\": "), &l, &error);
    check(ok && error.contains(QLatin1String("JSON object")), QStringLiteral("broken JSON is refused: ") + error);
    ok = !parseSimLaunch(QStringLiteral("com.palm.app.clock:[1, 2]"), &l, &error);
    check(ok && error.contains(QLatin1String("not an object")), QStringLiteral("params that are not an object are refused: ") + error);
    check(!parseSimLaunch(QStringLiteral("com.palm.app.clock:\"edit\""), &l, &error),
          QStringLiteral("a string for params is refused"));
    check(!parseSimLaunch(QString(), &l, &error), QStringLiteral("an empty value is refused"));
    check(!parseSimLaunch(QStringLiteral("{\"id\": \"com.palm.app.clock\"}"), &l, &error),
          QStringLiteral("JSON without an app id before it is refused"));
    check(!parseSimLaunch(QStringLiteral("com.palm app"), &l, &error), QStringLiteral("an id with a space is refused"));

    std::printf(failures ? "\n%d check(s) failed\n" : "\nall passed\n", failures);
    return failures ? 1 : 0;
}
