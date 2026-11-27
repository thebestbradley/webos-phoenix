# webOS Phoenix VMs: the nyx GPS module, which reads NMEA from the port in
# /etc/location/gpsConfig.conf (nyx-conf: a virtio serial port, fed on a Mac
# by the host's own position, tools/vm-location; scripts/vm.sh and
# scripts/make-utm.sh add the port). Without the module the location
# service's GPS handler has no source at all.
NYX_MODULES_REQUIRED:append:phoenix-vm-arm64 = ";NYXMOD_OW_GPS;"
