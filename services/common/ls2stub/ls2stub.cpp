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
    std::map<std::string, LSMethod> methods;        // "/category/method" ("/method" in "/")
    std::map<std::string, std::string> categoryOf;  // that key -> its category
    std::map<std::string, void *> data;             // category -> its data
    LSCancelFunction cancel = nullptr;
    void *cancelCtx = nullptr;
};

struct LSMessage
{
    std::string category, method, payload, appId, service, token;
    bool subscription = false;
    int refs = 1;
    std::vector<std::string> replies;
};

static std::string normalCategory(const char *category)
{
    std::string c = category ? category : "/";
    if (c.empty() || c[0] != '/')
        c = "/" + c;
    while (c.size() > 1 && c.back() == '/')
        c.pop_back();
    return c;
}

static std::string keyOf(const std::string &category, const std::string &method)
{
    return (category == "/" ? std::string() : category) + "/" + method;
}

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

bool LSRegisterCategory(LSHandle *sh, const char *category, LSMethod *methods, LSSignal *, LSProperty *, LSError *)
{
    const std::string c = normalCategory(category);
    for (LSMethod *m = methods; m && m->name; ++m) {
        sh->methods[keyOf(c, m->name)] = *m;
        sh->categoryOf[keyOf(c, m->name)] = c;
    }
    return true;
}

bool LSCategorySetData(LSHandle *sh, const char *category, void *data, LSError *)
{
    sh->data[normalCategory(category)] = data;
    return true;
}

bool LSGmainAttach(LSHandle *, GMainLoop *, LSError *) { return true; }

const char *LSMessageGetPayload(LSMessage *m) { return m->payload.c_str(); }
const char *LSMessageGetApplicationID(LSMessage *m) { return m->appId.empty() ? nullptr : m->appId.c_str(); }
const char *LSMessageGetSenderServiceName(LSMessage *m) { return m->service.empty() ? nullptr : m->service.c_str(); }
const char *LSMessageGetUniqueToken(LSMessage *m) { return m->token.c_str(); }
const char *LSMessageGetCategory(LSMessage *m) { return m->category.c_str(); }
const char *LSMessageGetMethod(LSMessage *m) { return m->method.c_str(); }
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
    // "open" is "/open"; "/control/status" a method in a category.
    const std::string key = method.empty() || method[0] != '/' ? "/" + method : method;
    const size_t slash = key.rfind('/');
    m->category = slash == 0 ? "/" : key.substr(0, slash);
    m->method = key.substr(slash + 1);
    m->payload = payload;
    m->appId = appId;
    m->service = service;
    m->token = "tok" + std::to_string(next++);
    // luna-service2 treats "subscribe": true in the payload as a subscription.
    m->subscription = payload.find("\"subscribe\":true") != std::string::npos;
    auto it = sh->methods.find(key);
    if (it == sh->methods.end())
        m->replies.push_back("{\"returnValue\":false,\"errorText\":\"Unknown method\"}");
    else
        it->second.function(sh, m, sh->data[sh->categoryOf[key]]);
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
