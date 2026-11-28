# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The A/B layout's files that are made at build time (docs/PLATFORM-CLIENT.md,
# "System updates"): GRUB's environment block (phoenix-grubenv.bb) and its
# reading (the tests, tools/test-rauc-slots.py). Standard library only.

GRUBENV_SIZE = 1024
GRUBENV_HEADER = "# GRUB Environment Block\n"


def grubenv(values):
    """GRUB's environment block (grub-editenv's format: a header line, one
    NAME=value line each, '#' up to 1024 bytes) with VALUES in their order.
    Raises ValueError for a name or value GRUB could not read back, or a
    block over 1024 bytes."""
    text = GRUBENV_HEADER
    for name, value in values.items():
        if not name or not all(c.isalnum() or c == "_" for c in name):
            raise ValueError("grubenv: bad name %r" % name)
        value = str(value)
        if "\n" in value or "\\" in value:
            raise ValueError("grubenv: %s's value has a newline or backslash" % name)
        text += "%s=%s\n" % (name, value)
    data = text.encode("utf-8")
    if len(data) > GRUBENV_SIZE:
        raise ValueError("grubenv: %d bytes, more than %d" % (len(data), GRUBENV_SIZE))
    return data + b"#" * (GRUBENV_SIZE - len(data))


def read_grubenv(data):
    """{NAME: value} from a GRUB environment block (bytes)."""
    if len(data) != GRUBENV_SIZE or not data.startswith(GRUBENV_HEADER.encode()):
        raise ValueError("not a GRUB environment block")
    out = {}
    for line in data.decode("utf-8").split("\n")[1:]:
        if line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        out[name] = value
    return out
