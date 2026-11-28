#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# nbd-serve.py: serve a disk image over NBD with the guest's writes kept in
# memory, so phoenix-vz can boot a build where it was built, with nothing
# downloaded and the image left as built:
#
#   (builder)  python3 nbd-serve.py IMAGE [--port 10809]
#   (Mac)      ssh -N -L 10809:127.0.0.1:10809 builder &
#              phoenix-vz --disk nbd://127.0.0.1:10809/phoenix --efi vm.nvram
#
# Listens on 127.0.0.1 only. The image is opened read only; writes land in
# 4 KiB blocks in memory and are gone when the server stops. Fixed newstyle
# handshake, simple replies, one client at a time; nothing beyond Python's
# standard library.

import argparse
import os
import socket
import struct
import sys

NBDMAGIC = 0x4E42444D41474943
IHAVEOPT = 0x49484156454F5054
REPLYMAGIC = 0x3E889045565A9
REQ_MAGIC = 0x25609513
SIMPLE_REPLY = 0x67446698

OPT_EXPORT_NAME, OPT_ABORT, OPT_INFO, OPT_GO = 1, 2, 6, 7
REP_ACK, REP_INFO, REP_ERR_UNSUP = 1, 3, (1 << 31) + 1
# HAS_FLAGS, SEND_FLUSH, SEND_TRIM, SEND_WRITE_ZEROES
TX_FLAGS = 0x01 | 0x04 | 0x20 | 0x40
CMD_READ, CMD_WRITE, CMD_DISC, CMD_FLUSH, CMD_TRIM, CMD_WZ = 0, 1, 2, 3, 4, 6
EINVAL = 22
BLK = 4096


def recv(s, n):
    b = bytearray()
    while len(b) < n:
        c = s.recv(n - len(b))
        if not c:
            raise EOFError
        b += c
    return bytes(b)


class Disk:
    def __init__(self, path):
        self.fd = os.open(path, os.O_RDONLY)
        self.size = os.fstat(self.fd).st_size
        self.over = {}

    def base(self, i):
        b = os.pread(self.fd, BLK, i * BLK)
        return b + bytes(BLK - len(b))

    def read(self, off, n):
        out = bytearray()
        end = off + n
        while off < end:
            i, o = divmod(off, BLK)
            take = min(BLK - o, end - off)
            blk = self.over.get(i)
            if blk is None:
                # read straight through for runs with no written blocks
                j = i
                while (j + 1) * BLK < end and (j + 1) not in self.over:
                    j += 1
                if j > i:
                    run = (j + 1) * BLK - off
                    take = min(run, end - off)
                    b = os.pread(self.fd, take, off)
                    out += b + bytes(take - len(b))
                    off += take
                    continue
                blk = self.base(i)
            out += blk[o:o + take]
            off += take
        return bytes(out)

    def write(self, off, data):
        p = 0
        while p < len(data):
            i, o = divmod(off + p, BLK)
            take = min(BLK - o, len(data) - p)
            blk = self.over.get(i)
            if blk is None:
                blk = bytearray(self.base(i))
                self.over[i] = blk
            blk[o:o + take] = data[p:p + take]
            p += take


def options(s, disk):
    s.sendall(struct.pack(">QQH", NBDMAGIC, IHAVEOPT, 0x3))
    cflags, = struct.unpack(">I", recv(s, 4))
    nozero = cflags & 0x2

    def reply(opt, typ, data=b""):
        s.sendall(struct.pack(">QIII", REPLYMAGIC, opt, typ, len(data)) + data)

    while True:
        magic, opt, ln = struct.unpack(">QII", recv(s, 16))
        data = recv(s, ln) if ln else b""
        if magic != IHAVEOPT:
            raise EOFError
        if opt == OPT_EXPORT_NAME:
            s.sendall(struct.pack(">QH", disk.size, TX_FLAGS) + (b"" if nozero else bytes(124)))
            return
        if opt in (OPT_INFO, OPT_GO):
            reply(opt, REP_INFO, struct.pack(">HQH", 0, disk.size, TX_FLAGS))
            reply(opt, REP_ACK)
            if opt == OPT_GO:
                return
            continue
        if opt == OPT_ABORT:
            reply(opt, REP_ACK)
            raise EOFError
        reply(opt, REP_ERR_UNSUP)


def transmit(s, disk, stats):
    while True:
        magic, flags, typ, handle, off, ln = struct.unpack(">IHHQQI", recv(s, 28))
        if magic != REQ_MAGIC:
            raise EOFError
        err = 0
        payload = b""
        if typ == CMD_WRITE:
            data = recv(s, ln)
            if off + ln > disk.size:
                err = EINVAL
            else:
                disk.write(off, data)
                stats["w"] += ln
        elif typ == CMD_READ:
            if off + ln > disk.size:
                err = EINVAL
            else:
                payload = disk.read(off, ln)
                stats["r"] += ln
        elif typ == CMD_DISC:
            return
        elif typ in (CMD_TRIM, CMD_WZ):
            if typ == CMD_WZ and off + ln <= disk.size:
                disk.write(off, bytes(ln))
        elif typ != CMD_FLUSH:
            err = EINVAL
        s.sendall(struct.pack(">IIQ", SIMPLE_REPLY, err, handle) + payload)


def main():
    ap = argparse.ArgumentParser(description="serve IMAGE over NBD, writes in memory")
    ap.add_argument("image")
    ap.add_argument("--port", type=int, default=10809)
    a = ap.parse_args()
    disk = Disk(a.image)
    ls = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    ls.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    ls.bind(("127.0.0.1", a.port))
    ls.listen(1)
    print(f"nbd-serve: {a.image} ({disk.size} bytes) on 127.0.0.1:{a.port}", file=sys.stderr, flush=True)
    while True:
        c, _ = ls.accept()
        c.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        stats = {"r": 0, "w": 0}
        try:
            options(c, disk)
            print("nbd-serve: client connected", file=sys.stderr, flush=True)
            transmit(c, disk, stats)
        except (EOFError, ConnectionError):
            pass
        finally:
            c.close()
            print(f"nbd-serve: client gone (read {stats['r'] >> 20} MiB, wrote {stats['w'] >> 20} MiB, "
                  f"{len(disk.over)} blocks in memory)", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
