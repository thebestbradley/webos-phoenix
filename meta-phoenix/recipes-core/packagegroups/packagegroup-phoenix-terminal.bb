# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "Shells and command-line tools for the Phoenix Terminal"
DESCRIPTION = "What the Terminal app (apps/terminal, org.webosphoenix.pty) \
needs to be a usable Linux terminal: bash (the default shell) and zsh (a \
choice in the app's Preferences), the usual tools, and the xterm-256color \
terminfo entry xterm.js implements (docs/TERMINAL.md)."
LICENSE = "Apache-2.0"

inherit packagegroup

# bash, coreutils, less, openssh and ncurses are in OE-core; zsh, nano,
# vim, tmux, htop and the DejaVu fonts in meta-oe, which webOS OSE's
# layers include. fish is not packaged here: it needs a Rust toolchain
# since fish 4, and the app offers it only where it is installed.
#
# OpenSSH's client side for the Terminal (ssh, scp, sftp, ssh-keygen), and
# its sftp-server, the SFTP subsystem an SSH server runs, so a Phoenix
# device is an SFTP server wherever it runs one: a development image's
# Dropbear (webos_image.bbclass), which runs OpenSSH's sftp-server for
# "sftp", and the Developer Mode SSH server to come (docs/TERMINAL.md T4).
# sftp-server is a program sshd or Dropbear starts for a signed-in user;
# it opens no port of its own. (The drives' SFTP client is Phoenix's own
# JavaScript, apps/connectors/drives/service/lib/ssh: it needs none of these.)
RDEPENDS:${PN} = " \
    bash \
    zsh \
    coreutils \
    less \
    nano \
    vim-tiny \
    tmux \
    htop \
    procps \
    openssh-ssh \
    openssh-scp \
    openssh-sftp \
    openssh-keygen \
    openssh-sftp-server \
    curl \
    ncurses-terminfo-base \
    ttf-dejavu-sans-mono \
"
