// Fixture: the parts of phoenix-runtime.js the checkers read.
(function (global) {
    var serviceAliases = {
        "com.palm.systemservice": "com.webos.service.systemservice"
    };

    function installDevice() {
        var b = new global.PalmServiceBridge();
        b.call("luna://org.example.nowhere/add", "{}");
    }
})(this);
