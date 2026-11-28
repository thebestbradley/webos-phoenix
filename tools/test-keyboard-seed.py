#!/usr/bin/env python3
"""Exercise generated first-boot configuration, without launching services."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'meta-phoenix/recipes-webos/maliit-framework-webos/files/configure-phoenix-keyboard.py'
spec = importlib.util.spec_from_file_location('keyboard_seed', HELPER)
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)

OSE = r'''echo "[maliit]" >> $MALIIT_CONF_FILE
    echo "onscreen\\enabled= \\" >> $MALIIT_CONF_FILE
    echo "libplugin-global.so:, \\" >> $MALIIT_CONF_FILE
    echo "libplugin-chinese.so:chinese, \\" >> $MALIIT_CONF_FILE
    echo "libplugin-japanese.so:japanese" >> $MALIIT_CONF_FILE
'''
LUNEOS = '\n'.join('#' + line if 'onscreen' in line or 'echo "lib' in line else line for line in OSE.splitlines()) + '\n'


class KeyboardSeedTests(unittest.TestCase):
    def render(self, source):
        result = seed.configure(source)
        self.assertEqual(seed.configure(result), result)
        with tempfile.TemporaryDirectory() as d:
            output = Path(d) / 'server.conf'
            subprocess.run(['/bin/sh', '-c', result], check=True, env={**os.environ, 'MALIIT_CONF_FILE': str(output)})
            return output.read_text()

    def test_ose_keeps_existing_plugins_after_phoenix(self):
        self.assertEqual(self.render(OSE), '[maliit]\nonscreen\\active=libphoenix-keyboard.so:\nonscreen\\enabled=libphoenix-keyboard.so:, libplugin-global.so:, libplugin-chinese.so:chinese, libplugin-japanese.so:japanese\n')

    def test_luneos_does_not_enable_unshipped_legacy_plugins(self):
        self.assertEqual(self.render(LUNEOS), '[maliit]\nonscreen\\active=libphoenix-keyboard.so:\nonscreen\\enabled=libphoenix-keyboard.so:\n')

    def test_unknown_or_ambiguous_seeds_fail_without_mutation(self):
        for source in ['', OSE + OSE, OSE.replace('libplugin-global.so:', '$(touch /tmp/not-permitted)'), OSE.replace('    echo "libplugin-global.so:, \\\\" >> $MALIIT_CONF_FILE', 'unexpected command'), OSE + r'echo "onscreen\\active=old"']:
            with self.subTest(source=source), self.assertRaises(ValueError):
                seed.configure(source)

    def test_failed_cli_preserves_input(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'maliit-server.sh'
            p.write_text('unrecognized upstream format\n')
            result = subprocess.run(['python3', str(HELPER), str(p)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(p.read_text(), 'unrecognized upstream format\n')


if __name__ == '__main__':
    unittest.main()
