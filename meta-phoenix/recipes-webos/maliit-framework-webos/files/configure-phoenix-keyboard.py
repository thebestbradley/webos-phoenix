#!/usr/bin/env python3
"""Seed Phoenix for both OSE's enabled list and LuneOS's commented list."""
import pathlib
import re
import sys


MARKER = '    # Phoenix keyboard defaults (generated at image install).'
ACTIVE = "    printf '%s\\n' 'onscreen\\active=libphoenix-keyboard.so:' >> \"$MALIIT_CONF_FILE\""
ECHO = r'echo "(?P<value>[^"\n]*)" >> (?:\$MALIIT_CONF_FILE|"\$MALIIT_CONF_FILE")[ \t]*'


def configure(text):
    if MARKER in text:
        if text.count(MARKER) == 1 and text.count(ACTIVE) == 1 and re.search(r"printf '%s\\n' 'onscreen\\enabled=libphoenix-keyboard\.so:[^'\n]*'", text):
            return text
        raise ValueError('inconsistent pre-existing Phoenix keyboard settings')
    header = re.compile(r'^[ \t]*(?P<comment>#[ \t]*)?' + ECHO + '$', re.M)
    matches = [m for m in header.finditer(text) if m['value'].startswith(r'onscreen\\enabled=')]
    if len(matches) != 1:
        raise ValueError('expected exactly one on-screen keyboard enabled-list seed')
    match = matches[0]
    if re.search(r'onscreen\\{1,2}active=', text):
        raise ValueError('unexpected existing active keyboard setting')
    end = match.end()
    plugins = ['libphoenix-keyboard.so:']
    if not match['comment']:
        value = match['value'].split('=', 1)[1]
        while True:
            continued = value.rstrip().endswith('\\\\')
            content = value.rstrip()[:-2] if continued else value
            for plugin in content.split(','):
                plugin = plugin.strip()
                if not plugin:
                    continue
                if not re.fullmatch(r'lib[A-Za-z0-9_.-]+\.so:[A-Za-z0-9_-]*', plugin):
                    raise ValueError('unrecognized enabled keyboard entry')
                if plugin not in plugins:
                    plugins.append(plugin)
            if not continued:
                break
            following = re.match(r'\n[ \t]*' + ECHO, text[end:])
            if not following:
                raise ValueError('unrecognized enabled keyboard continuation')
            value = following['value']
            end += following.end()
    # Commented legacy plugins stay disabled on LuneOS; active OSE plugins
    # remain selectable. printf avoids shell-specific echo backslash handling.
    enabled = "    printf '%s\\n' 'onscreen\\enabled=" + ', '.join(plugins) + "' >> \"$MALIIT_CONF_FILE\""
    return text[:match.start()] + '\n'.join([MARKER, ACTIVE, enabled]) + text[end:]


if __name__ == '__main__':
    path = pathlib.Path(sys.argv[1])
    try:
        result = configure(path.read_text())
    except ValueError as error:
        sys.exit('phoenix-keyboard: ' + str(error))
    path.write_text(result)
