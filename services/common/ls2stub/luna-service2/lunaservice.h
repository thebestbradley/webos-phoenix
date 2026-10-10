// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A stand-in for luna-service2's <luna-service2/lunaservice.h>, for testing
// the Phoenix services (services/pty, services/devices) off the device. It
// declares only the calls the service makes, with the signatures of
// webosose/luna-service2 (include/public/luna-service2/lunaservice.h), and
// ls2stub.cpp implements them as an in-process bus: a test calls a method
// as an app would and reads the replies. It is not luna-service2.

#pragma once

#include <glib.h>
#include <stdbool.h>
#include <stdio.h>

#include <string>
#include <vector>

typedef struct LSHandle LSHandle;
typedef struct LSMessage LSMessage;

typedef struct LSError {
    int error_code;
    char *message;
    const char *file;
    int line;
    const char *func;
} LSError;

typedef unsigned LSMethodFlags;
#define LUNA_METHOD_FLAGS_NONE 0u

typedef bool (*LSMethodFunction)(LSHandle *sh, LSMessage *msg, void *category_context);
typedef bool (*LSCancelFunction)(LSHandle *sh, LSMessage *msg, void *ctx);

typedef struct LSMethod {
    const char *name;
    LSMethodFunction function;
    LSMethodFlags flags;
} LSMethod;

typedef struct LSSignal LSSignal;
typedef struct LSProperty LSProperty;

void LSErrorInit(LSError *error);
void LSErrorFree(LSError *error);
void LSErrorPrint(LSError *error, FILE *out);

bool LSRegister(const char *name, LSHandle **sh, LSError *lserror);
bool LSUnregister(LSHandle *sh, LSError *lserror);
bool LSRegisterCategory(LSHandle *sh, const char *category, LSMethod *methods, LSSignal *signals,
                        LSProperty *properties, LSError *lserror);
bool LSCategorySetData(LSHandle *sh, const char *category, void *user_data, LSError *lserror);
bool LSGmainAttach(LSHandle *sh, GMainLoop *mainLoop, LSError *lserror);

const char *LSMessageGetPayload(LSMessage *message);
const char *LSMessageGetApplicationID(LSMessage *message);
const char *LSMessageGetSenderServiceName(LSMessage *message);
const char *LSMessageGetUniqueToken(LSMessage *message);
const char *LSMessageGetCategory(LSMessage *message);
const char *LSMessageGetMethod(LSMessage *message);
bool LSMessageIsSubscription(LSMessage *message);
void LSMessageRef(LSMessage *message);
void LSMessageUnref(LSMessage *message);
bool LSMessageReply(LSHandle *sh, LSMessage *message, const char *replyPayload, LSError *lserror);

bool LSSubscriptionAdd(LSHandle *sh, const char *key, LSMessage *message, LSError *lserror);
bool LSSubscriptionSetCancelFunction(LSHandle *sh, LSCancelFunction cancelFunction, void *ctx, LSError *lserror);
bool LSSignalSend(LSHandle *sh, const char *uri, const char *payload, LSError *lserror);

// ---- Test side (not in luna-service2) -------------------------------------------

namespace ls2stub {

// Call a method ("open", or "/category/method") on the handle as appId would (or a native service when
// appId is empty and service is set). Returns the message; its replies
// collect in replies(msg). The caller holds one reference: release().
LSMessage *call(LSHandle *sh, const std::string &method, const std::string &payload,
                const std::string &appId, const std::string &service = std::string());
const std::vector<std::string> &replies(LSMessage *msg);
// The caller cancels its subscription (the page went).
void cancel(LSHandle *sh, LSMessage *msg);
void release(LSMessage *msg);
// The signals a handle sent, "uri payload" each, oldest first.
std::vector<std::string> &signals(LSHandle *sh);

} // namespace ls2stub
