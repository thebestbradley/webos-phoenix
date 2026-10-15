// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-l2cap ADDRESS PSM
//
// Opens a Bluetooth L2CAP channel (connection-oriented, SOCK_SEQPACKET: one
// read is one packet) to ADDRESS (AA:BB:CC:DD:EE:FF, a BR/EDR device
// already paired) on PSM (decimal or 0x hex), and relays its packets over
// the standard streams, each as a two-byte big-endian length and that many
// bytes: what comes on standard input is sent, what the device sends comes
// out on standard output. A zero-length frame on standard output says the
// channel is open. It ends when either side closes: exit status 0; 1 when
// the channel cannot be opened (the reason on standard error); 2 for bad
// arguments.
//
// The accessories service (services/accessories/service.js) runs it for the
// AirPods' control channel (PSM 0x1001, docs/ACCESSORIES.md): Node has no
// Bluetooth sockets, and BlueZ's D-Bus profile API would hand the same
// socket over D-Bus, which Node cannot take without a native module.
//
// The socket's address is the kernel's (include/net/bluetooth/l2cap.h,
// struct sockaddr_l2; AF_BLUETOOTH 31, BTPROTO_L2CAP 0, the PSM and the
// address little-endian, the address's bytes in reverse), written out here
// so it builds without BlueZ's headers. Linux only.

#include <errno.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#ifndef AF_BLUETOOTH
#define AF_BLUETOOTH 31
#endif
#define BTPROTO_L2CAP 0

struct phoenix_sockaddr_l2 {
    sa_family_t l2_family;
    uint16_t l2_psm;
    uint8_t l2_bdaddr[6];
    uint16_t l2_cid;
    uint8_t l2_bdaddr_type;
};

#define MAX_PACKET 65535

static int parseAddress(const char *s, uint8_t out[6])
{
    unsigned int b[6];
    char tail;
    if (sscanf(s, "%2x:%2x:%2x:%2x:%2x:%2x%c", &b[0], &b[1], &b[2], &b[3], &b[4], &b[5], &tail) != 6)
        return -1;
    for (int i = 0; i < 6; ++i)
        out[i] = (uint8_t)b[5 - i];
    return 0;
}

static int writeAll(int fd, const uint8_t *p, size_t n)
{
    while (n > 0) {
        ssize_t w = write(fd, p, n);
        if (w < 0) {
            if (errno == EINTR)
                continue;
            return -1;
        }
        p += w;
        n -= (size_t)w;
    }
    return 0;
}

static int frameOut(const uint8_t *p, size_t n)
{
    uint8_t head[2] = { (uint8_t)(n >> 8), (uint8_t)(n & 0xff) };
    return writeAll(STDOUT_FILENO, head, 2) == 0 && writeAll(STDOUT_FILENO, p, n) == 0 ? 0 : -1;
}

int main(int argc, char **argv)
{
    if (argc != 3) {
        fprintf(stderr, "usage: phoenix-l2cap ADDRESS PSM\n");
        return 2;
    }
    struct phoenix_sockaddr_l2 addr;
    memset(&addr, 0, sizeof addr);
    addr.l2_family = AF_BLUETOOTH;
    char *end = NULL;
    long psm = strtol(argv[2], &end, 0);
    if (parseAddress(argv[1], addr.l2_bdaddr) != 0 || !end || *end || psm <= 0 || psm > 0xffff) {
        fprintf(stderr, "phoenix-l2cap: bad address or PSM\n");
        return 2;
    }
    // Little-endian on the wire and in the kernel's struct.
    uint8_t le[2] = { (uint8_t)(psm & 0xff), (uint8_t)(psm >> 8) };
    memcpy(&addr.l2_psm, le, 2);

    int sock = socket(AF_BLUETOOTH, SOCK_SEQPACKET, BTPROTO_L2CAP);
    if (sock < 0) {
        fprintf(stderr, "phoenix-l2cap: socket: %s\n", strerror(errno));
        return 1;
    }
    if (connect(sock, (struct sockaddr *)&addr, sizeof addr) != 0) {
        fprintf(stderr, "phoenix-l2cap: connect: %s\n", strerror(errno));
        close(sock);
        return 1;
    }
    if (frameOut(NULL, 0) != 0)
        return 0;

    static uint8_t buf[MAX_PACKET];
    static uint8_t in[2 + MAX_PACKET];
    size_t have = 0;
    struct pollfd fds[2] = { { sock, POLLIN, 0 }, { STDIN_FILENO, POLLIN, 0 } };
    for (;;) {
        if (poll(fds, 2, -1) < 0) {
            if (errno == EINTR)
                continue;
            break;
        }
        if (fds[0].revents & (POLLIN | POLLHUP | POLLERR)) {
            ssize_t n = recv(sock, buf, sizeof buf, 0);
            if (n <= 0)
                break;
            if (frameOut(buf, (size_t)n) != 0)
                break;
        }
        if (fds[1].revents & (POLLIN | POLLHUP | POLLERR)) {
            ssize_t n = read(STDIN_FILENO, in + have, sizeof in - have);
            if (n <= 0)
                break;
            have += (size_t)n;
            // Each whole frame is one packet.
            for (;;) {
                if (have < 2)
                    break;
                size_t len = ((size_t)in[0] << 8) | in[1];
                if (have < 2 + len)
                    break;
                if (len > 0 && send(sock, in + 2, len, 0) < 0) {
                    fprintf(stderr, "phoenix-l2cap: send: %s\n", strerror(errno));
                    close(sock);
                    return 1;
                }
                memmove(in, in + 2 + len, have - 2 - len);
                have -= 2 + len;
            }
        }
    }
    close(sock);
    return 0;
}
