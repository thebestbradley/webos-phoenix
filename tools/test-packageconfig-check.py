#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# scripts/packageconfig-check.py without bitbake: which recipes it finds in a
# layer (conf files' :pn- lines, bbappends that set PACKAGECONFIG), the
# comparison against a recipe's flags, and meta-phoenix's own list.
#
#   python3 tools/test-packageconfig-check.py

import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(REPO, "scripts", "packageconfig-check.py")
spec = importlib.util.spec_from_file_location("packageconfig_check", SCRIPT)
pc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pc)


def layer(files):
    d = tempfile.mkdtemp(prefix="pkgconf-layer-")
    for rel, text in files.items():
        path = os.path.join(d, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(text)
    return d


class Recipes(unittest.TestCase):
    def test_conf_pn_lines(self):
        d = layer({
            "conf/machine/tab.conf": 'PACKAGECONFIG:append:pn-mesa = " panfrost libclc"\n',
            "conf/machine/phone.conf": 'PACKAGECONFIG:append:pn-mesa = " freedreno"\n'
                                       'PACKAGECONFIG:remove:pn-pulseaudio = "x11"\n',
            "conf/machine/include/mobile.inc": 'PACKAGECONFIG_MEDIA:pn-webruntime = ""\n',
        })
        self.assertEqual(pc.recipes(d), {
            "mesa": ["conf/machine/phone.conf", "conf/machine/tab.conf"],
            "pulseaudio": ["conf/machine/phone.conf"],
            "webruntime": ["conf/machine/include/mobile.inc"],
        })

    def test_ignores_comments_flags_and_variables(self):
        d = layer({
            "conf/machine/a.conf": '# PACKAGECONFIG:append:pn-mesa = " kmsro"\n'
                                   'PARALLEL_MAKE:pn-tdlib = "-j 2"\n'
                                   'PACKAGECONFIG:append:pn-mksnapshot-cross-${TARGET_ARCH} = " x"\n',
        })
        self.assertEqual(pc.recipes(d), {})

    def test_bbappends(self):
        d = layer({
            "recipes-multimedia/mpg123/mpg123_%.bbappend": 'PACKAGECONFIG:class-native = ""\n',
            "recipes-graphics/mesa/mesa.bbappend": 'PACKAGECONFIG:append = " lima"\n',
            "recipes-core/foo/foo_1.2.bbappend": 'PACKAGECONFIG[bar] = "--with-bar,--without-bar"\n',
            "recipes-core/baz/baz.bbappend": 'SRC_URI += "file://x.patch"\n',
        })
        self.assertEqual(pc.recipes(d), {
            "mesa": ["recipes-graphics/mesa/mesa.bbappend"],
            "mpg123": ["recipes-multimedia/mpg123/mpg123_%.bbappend"],
        })

    def test_meta_phoenix(self):
        found = pc.recipes(os.path.join(REPO, "meta-phoenix"))
        self.assertIn("mesa", found)
        self.assertIn("conf/machine/pinetab2.conf", found["mesa"])


class Invalid(unittest.TestCase):
    def test_kmsro_on_mesa_26(self):
        flags = {"panfrost": "", "libclc": "-Dmesa-clc=system", "gallium": "", "doc": "x"}
        self.assertEqual(pc.invalid(" gallium panfrost kmsro", flags), ["kmsro"])
        self.assertEqual(pc.invalid("gallium panfrost libclc", flags), [])
        self.assertEqual(pc.invalid("", flags), [])


class Command(unittest.TestCase):
    def run_script(self, *args):
        return subprocess.run([sys.executable, SCRIPT, *args], capture_output=True, text=True)

    def test_list(self):
        r = self.run_script("--list", os.path.join(REPO, "meta-phoenix"))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertRegex(r.stdout, r"(?m)^mesa\t.*conf/machine/pinetab2\.conf")

    def test_usage(self):
        self.assertEqual(self.run_script().returncode, 2)
        self.assertEqual(self.run_script("/nonexistent").returncode, 2)

    def test_needs_bitbake(self):
        env = dict(os.environ, PATH="/usr/bin:/bin")
        r = subprocess.run([sys.executable, SCRIPT, os.path.join(REPO, "meta-phoenix")],
                           capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 2)
        self.assertIn("no bitbake on PATH", r.stderr)


if __name__ == "__main__":
    unittest.main()
