#!/bin/sh
# Read-only: never installs, remounts, changes routing, or displays credentials.
# The TLS check opens one connection to each provider and sends no API key.
printf 'Kernel / CPU\n'
uname -srm
printf '\nNode\n'
/usr/bin/node --version 2>/dev/null || node --version 2>/dev/null || printf 'node not found\n'
printf '\nMemory\n'
sed -n '/^MemTotal:/p; /^MemAvailable:/p' /proc/meminfo
printf '\nWritable storage\n'
df -k /var/opt
printf '\nUplink\n'
if [ -r /run/mgu-uplink/lease.json ]; then printf 'Lease present\n'; else printf 'No lease\n'; fi
printf '\nApp group\n'
grep '^tm_oap_app:' /etc/group || printf 'tm_oap_app group not found\n'
printf '\nRoot helper\n'
if [ -S /run/mgu-ai-root/root.sock ]; then ls -l /run/mgu-ai-root/root.sock; else printf 'Socket not present\n'; fi
if [ -f /var/opt/mgu-ai-root/token ]; then printf 'Root access provisioned\n'; else printf 'Root access not provisioned\n'; fi
printf '\nProvider TLS (old Node certificate lists can fail here; then place a CA bundle at <data dir>/ca.pem)\n'
/usr/bin/node -e '
var https = require("https"), dns = require("dns"), fs = require("fs");
var lookup;
try {
    var servers = JSON.parse(fs.readFileSync("/run/mgu-uplink/lease.json", "utf8")).dns;
    var resolver = new dns.Resolver(); resolver.setServers(servers);
    lookup = function (host, options, done) {
        if (typeof options === "function") done = options;
        resolver.resolve4(host, function (e, a) { if (e) done(e); else done(null, a[0], 4); });
    };
} catch (e) { console.log("  (no uplink lease: using the system resolver)"); }
["api.anthropic.com", "api.openai.com"].forEach(function (host) {
    var request = https.request({ host: host, port: 443, method: "GET", path: "/", lookup: lookup }, function (res) {
        console.log("  " + host + ": TLS ok, HTTP " + res.statusCode + ", " + res.socket.getProtocol());
        res.resume();
    });
    request.setTimeout(15000, function () { request.destroy(new Error("timed out")); });
    request.on("error", function (e) { console.log("  " + host + ": FAILED - " + (e.code || e.message)); });
    request.end();
});
' 2>&1 || printf '  node could not run the TLS check\n'
