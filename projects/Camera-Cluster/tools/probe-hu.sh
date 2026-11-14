#!/bin/sh
# Read-only checks for Camera Cluster, to run on the head unit over SSH as root
# when the owner decides to go on the car. Never installs, writes, restarts or
# asks the camera unit for anything. NOT RUN YET: written offline.
#
#   sh probe-hu.sh > probe.txt 2>&1
CATALOG=/etc/oap/someip/someip-interfaces.json

printf 'Firmware / kernel\n'
uname -srm
cat /etc/os-release 2>/dev/null | sed -n '1,4p'

printf '\n1. Camera interface the app declares (ICAM2Proxy) in the SOME/IP catalog\n'
if [ -r "$CATALOG" ]; then
    /usr/bin/node -e '
        var c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        var text = JSON.stringify(c);
        ["cameraproxy.ICAM2Proxy", "cameraproxy.CameraProxy", "de.bmw.dass.XView3D"].forEach(function (n) {
            console.log("  " + n + ": " + (text.indexOf(n) >= 0 ? "listed" : "NOT listed"));
        });
        ["clientAttach", "clientDetach", "changeState", "currentState", "DR_ACTIVE", "MODE_MOSAIK", "CLIENT_INDIRECT"].forEach(function (n) {
            console.log("  " + n + ": " + (text.indexOf("\"" + n + "\"") >= 0 ? "listed" : "NOT listed"));
        });
    ' "$CATALOG" 2>&1 || printf '  node could not read the catalog\n'
else
    printf '  catalog not readable: %s\n' "$CATALOG"
fi

printf '\n2. Camera services and the media bus\n'
for unit in icam2proxy dasvideo avbstreamhandler ufipc_daemon; do
    printf '  %s: %s\n' "$unit" "$(systemctl is-active "$unit" 2>/dev/null || echo unknown)"
done
printf '  media-bus stream names mentioning avb_streaming (configuration files only):\n'
grep -rhoE 'media_transport\.avb_streaming\.[0-9]+' /etc /opt 2>/dev/null | sort -u | sed 's/^/    /' | head -40
printf '  AVB bridge library:\n'
ls -l /usr/lib*/libias-media_transport-avb_ufipc_bridge.so* 2>/dev/null | sed 's/^/    /' || true

printf '\n3. Users and groups the feed service runs with\n'
id hmi_5000 2>&1 | sed 's/^/  /'
for group in mgu_ufipc tm_oap_app video; do
    grep "^$group:" /etc/group | sed 's/^/  /' || printf '  group %s not found\n' "$group"
done
ls -l /dev/dri/renderD128 2>&1 | sed 's/^/  /'

printf '\n4. Cluster renderer and this tool\n'
for path in /dev/shm/cluster-render/render.sock /dev/shm/camera-cluster-feed/ctl.sock; do
    if [ -S "$path" ]; then ls -l "$path" | sed 's/^/  /'; else printf '  %s: not present\n' "$path"; fi
done
ls -d /var/opt/cluster-render/current /var/opt/camera-cluster-feed/current /var/opt/waze-on-cluster/current 2>/dev/null | sed 's/^/  installed: /'
for unit in cluster-render camera-cluster-feed; do
    printf '  %s.service: %s\n' "$unit" "$(systemctl is-active "$unit" 2>/dev/null || echo unknown)"
done

printf '\n5. Feed log, last lines (after a try in the app)\n'
tail -n 40 /var/opt/camera-cluster-feed/log/camera-feed.log 2>/dev/null | sed 's/^/  /' || printf '  no log yet\n'
