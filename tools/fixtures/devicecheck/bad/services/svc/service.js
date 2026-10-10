// Fixture: a Node service with what the image checks catch.
"use strict";
var Service = require("webos-service");
var fs = require("fs");
var pad = require("left-pad");          // not in the image
var helper = require("./lib/missing");   // not in the tree
var service = new Service("org.example.svc");
// Not in its role's outbound list, and its perm file lacks notification.operation.
service.call("luna://com.webos.notification/createToast", { message: "hi" }, function () {});
fs.readFileSync("/etc/phoenix/example.json");
