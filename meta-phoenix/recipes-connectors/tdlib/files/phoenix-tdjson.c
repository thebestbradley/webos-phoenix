/*
 * Copyright (c) 2026 webOS Phoenix contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * phoenix-tdjson: TDLib's JSON interface (td/telegram/td_json_client.h:
 * td_create_client_id, td_send, td_receive, td_execute) on standard input
 * and output, one line each, for the Unofficial Telegram account
 * (apps/telegram/service/lib/td.js), which the connector kit starts as a
 * system helper (device.ts HELPERS: /usr/bin/phoenix-tdjson --dir <its
 * folder>). Node then needs no native addon.
 *
 * In, one command per line:
 *   C <extra>             a new TDLib client; answered
 *                         {"@type":"phoenix.client","client_id":N,"@extra":"<extra>"}
 *   S <client_id> <json>  td_send(client_id, json); TDLib answers through td_receive
 *   E <extra> <json>      td_execute(json); answered
 *                         {"@type":"phoenix.executed","@extra":"<extra>","result":<json>}
 * Out: what td_receive gives (each with "@client_id"), and the answers above;
 * first {"@type":"phoenix.ready","data_dir":"<dir>"}, the folder the
 * clients' databases go under. <extra> is digits and letters only.
 *
 * td_receive is called from one thread only, td_send and td_execute from
 * the reading one: TDLib allows both (td_json_client.h).
 */

#include <td/telegram/td_json_client.h>

#include <ctype.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static pthread_mutex_t out_lock = PTHREAD_MUTEX_INITIALIZER;

static void emit(const char *a, const char *b, const char *c) {
    pthread_mutex_lock(&out_lock);
    fputs(a, stdout);
    if (b) fputs(b, stdout);
    if (c) fputs(c, stdout);
    fputc('\n', stdout);
    fflush(stdout);
    pthread_mutex_unlock(&out_lock);
}

static void *receive_loop(void *unused) {
    (void)unused;
    for (;;) {
        const char *r = td_receive(30.0);
        if (r) emit(r, NULL, NULL);
    }
    return NULL;
}

/* <extra> as the caller wrote it, if it is only letters and digits. */
static int word(const char *s, size_t n) {
    if (n == 0 || n > 64) return 0;
    for (size_t i = 0; i < n; i++)
        if (!isalnum((unsigned char)s[i])) return 0;
    return 1;
}

int main(int argc, char **argv) {
    const char *dir = ".";
    for (int i = 1; i + 1 < argc; i++)
        if (strcmp(argv[i], "--dir") == 0) dir = argv[++i];
    for (const char *p = dir; *p; p++)
        if (*p == '"' || *p == '\\' || (unsigned char)*p < 0x20) { fprintf(stderr, "phoenix-tdjson: bad --dir\n"); return 2; }

    td_execute("{\"@type\":\"setLogVerbosityLevel\",\"new_verbosity_level\":1}");
    td_execute("{\"@type\":\"setLogStream\",\"log_stream\":{\"@type\":\"logStreamEmpty\"}}");

    pthread_t receiver;
    if (pthread_create(&receiver, NULL, receive_loop, NULL) != 0) return 1;
    emit("{\"@type\":\"phoenix.ready\",\"data_dir\":\"", dir, "\"}");

    char *line = NULL;
    size_t cap = 0;
    ssize_t len;
    char buf[160];
    while ((len = getline(&line, &cap, stdin)) >= 0) {
        while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r')) line[--len] = 0;
        if (len < 2 || line[1] != ' ') continue;
        if (line[0] == 'C' && word(line + 2, (size_t)len - 2)) {
            int id = td_create_client_id();
            snprintf(buf, sizeof buf, "{\"@type\":\"phoenix.client\",\"client_id\":%d,\"@extra\":\"%s\"}", id, line + 2);
            emit(buf, NULL, NULL);
        } else if (line[0] == 'S') {
            char *end = NULL;
            long id = strtol(line + 2, &end, 10);
            if (end && *end == ' ' && id > 0) td_send((int)id, end + 1);
        } else if (line[0] == 'E') {
            char *sp = strchr(line + 2, ' ');
            if (!sp || !word(line + 2, (size_t)(sp - line - 2))) continue;
            *sp = 0;
            const char *r = td_execute(sp + 1);
            snprintf(buf, sizeof buf, "{\"@type\":\"phoenix.executed\",\"@extra\":\"%s\",\"result\":", line + 2);
            emit(buf, r ? r : "null", "}");
        }
    }
    /* Standard input closed: the service went away. TDLib's clients close with the process. */
    free(line);
    return 0;
}
