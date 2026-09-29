// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The in-process bus behind the luna-service2 stand-in (see lunaservice.h).

#include "luna-service2/lunaservice.h"

#include <cstring>
#include <map>

struct LSHandle
{
    std::string name;
    std::map<std::string, LSMethod> methods;
    void *data = nullptr;
    LSCancelFunction cancel = nullptr;
    void *cancelCtx = nullptr;
};

struct LSMessage
{
    std::string method, payload, appId, service, token;
    bool subscription = false;
    int refs = 1;
    std::vector<std::string> replies;
};

void LSErrorInit(LSError *e) { std::memset(e, 0, sizeof *e); }
void LSErrorFree(LSError *e) { g_free(e->message); std::memset(e, 0, sizeof *e); }
void LSErrorPrint(LSError *e, FILE *out) { std::fprintf(out, "LSError %d: %s\n", e->error_code, e->message ? e->message : ""); }

bool LSRegister(const char *name, LSHandle **sh, LSError *)
{
    *sh = new LSHandle;
    (*sh)->name = name;
    return true;
}

bool LSUnregister(LSHandle *sh, LSError *)
{
    delete sh;
    return true;
}

bool LSRegisterCategory(LSHandle *sh, const char *, LSMethod *methods, LSSignal *, LSProperty *, LSError *)
{
    for (LSMethod *m = methods; m && m->name; ++m)
        sh->methods[m->name] = *m;
    return true;
}

bool LSCategorySetData(LSHandle *sh, const char *, void *data, LSError *) { sh->data = data; return true; }
bool LSGmainAttach(LSHandle *, GMainLoop *, LSError *) { return true; }

const char *LSMessageGetPayload(LSMessage *m) { return m->payload.c_str(); }
const char *LSMessageGetApplicationID(LSMessage *m) { return m->appId.empty() ? nullptr : m->appId.c_str(); }
const char *LSMessageGetSenderServiceName(LSMessage *m) { return m->service.empty() ? nullptr : m->service.c_str(); }
const char *LSMessageGetUniqueToken(LSMessage *m) { return m->token.c_str(); }
bool LSMessageIsSubscription(LSMessage *m) { return m->subscription; }
void LSMessageRef(LSMessage *m) { ++m->refs; }
void LSMessageUnref(LSMessage *m) { if (--m->refs == 0) delete m; }

bool LSMessageReply(LSHandle *, LSMessage *m, const char *payload, LSError *)
{
    m->replies.push_back(payload);
    return true;
}

bool LSSubscriptionAdd(LSHandle *, const char *, LSMessage *, LSError *) { return true; }

bool LSSubscriptionSetCancelFunction(LSHandle *sh, LSCancelFunction f, void *ctx, LSError *)
{
    sh->cancel = f;
    sh->cancelCtx = ctx;
    return true;
}

namespace ls2stub {

LSMessage *call(LSHandle *sh, const std::string &method, const std::string &payload,
                const std::string &appId, const std::string &service)
{
    static unsigned next = 1;
    auto *m = new LSMessage;
    m->method = method;
    m->payload = payload;
    m->appId = appId;
    m->service = service;
    m->token = "tok" + std::to_string(next++);
    // luna-service2 treats "subscribe": true in the payload as a subscription.
    m->subscription = payload.find("\"subscribe\":true") != std::string::npos;
    auto it = sh->methods.find(method);
    if (it == sh->methods.end())
        m->replies.push_back("{\"returnValue\":false,\"errorText\":\"Unknown method\"}");
    else
        it->second.function(sh, m, sh->data);
    return m;
}

const std::vector<std::string> &replies(LSMessage *m) { return m->replies; }

void cancel(LSHandle *sh, LSMessage *m)
{
    if (sh->cancel)
        sh->cancel(sh, m, sh->cancelCtx);
}

void release(LSMessage *m) { LSMessageUnref(m); }

} // namespace ls2stub
