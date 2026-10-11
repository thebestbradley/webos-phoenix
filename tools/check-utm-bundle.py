#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Checks a UTM virtual machine (a .utm bundle, as scripts/make-utm.sh makes
# them) against what UTM reads, and prints the QEMU command UTM builds from
# it. UTM can't run here, so this follows its source (Apache-2.0,
# https://github.com/utmapp/UTM), written down from UTM 5.0.6 (Configuration/
# at tag v5.0.6, September 2026) and checked against 4.0.0, 4.5.4 and 4.7.5,
# whose required keys are the same (newer keys are optional):
#
#   - the bundle: config.plist and Data/ (Configuration/UTMConfiguration.swift:
#     load(from:), dataDirectoryName; save(to:) deletes any file in Data/ that
#     no setting names, cleanupAllFiles);
#   - each key's decoder: Configuration/UTMQemuConfiguration*.swift and
#     UTMConfigurationInfo.swift, init(from:): which keys must be there, their
#     types, and the enumerations' values (Configuration/QEMUConstant.swift,
#     QEMUConstantGenerated.swift);
#   - the QEMU command: Configuration/UTMQemuConfiguration+Arguments.swift
#     (generatedArguments, then the user's arguments split as
#     parsedUserArguments splits them), for an ARM64 "virt" machine.
#
#   check-utm-bundle.py BUNDLE                   check it; exit 1 on a fault
#   check-utm-bundle.py BUNDLE --qemu HOST       also print the QEMU command,
#                                                one argument a line
#   check-utm-bundle.py --config PLIST --qemu HOST   a config.plist alone
#
# HOST: macos (Apple silicon: HVF), ios (UTM with JIT, sideloaded: JIT
# through a debugger, so split-wx), ios-se (UTM SE: the threaded
# interpreter, no USB sharing).

import os
import plistlib
import re
import sys
import uuid

# ---- What UTM decodes ------------------------------------------------------
# (key, type, required); a type is bool, int, str, "uuid", a list of allowed
# strings (an enumeration), a dict schema, or ("list", schema).
INFO = [("Name", str, True), ("IconCustom", bool, True), ("Icon", str, False), ("Notes", str, False),
        ("UUID", "uuid", True)]
# QEMUTarget_aarch64 and QEMUCPU_aarch64 (QEMUConstantGenerated.swift) are
# long; these are the values this project writes.
SYSTEM = [("Architecture", ["aarch64"], True), ("Target", ["virt"], True),
          ("CPU", ["default", "host", "max", "cortex-a72", "cortex-a76", "neoverse-n1"], True),
          ("CPUFlagsAdd", ("list", str), True), ("CPUFlagsRemove", ("list", str), True),
          ("CPUCount", int, True), ("ForceMulticore", bool, True), ("MemorySize", int, True),
          ("JITCacheSize", int, True)]
QEMU = [("DebugLog", bool, True), ("UEFIBoot", bool, True), ("RNGDevice", bool, True), ("BalloonDevice", bool, True),
        ("TPMDevice", bool, True), ("Hypervisor", bool, True), ("TSO", bool, False), ("RTCLocalTime", bool, True),
        ("PS2Controller", bool, True), ("MachinePropertyOverride", str, False),
        ("AdditionalArguments", ("list", str), True)]
INPUT = [("UsbBusSupport", ["Disabled", "2.0", "3.0"], True), ("UsbSharing", bool, True),
         ("MaximumUsbShare", int, True)]
SHARING = [("DirectoryShareMode", ["None", "WebDAV", "VirtFS"], True), ("DirectoryShareReadOnly", bool, True),
           ("ClipboardSharing", bool, True)]
SCALER = ["Linear", "Nearest"]
DISPLAY = [("Hardware", str, True), ("VgaRamMib", int, False), ("DynamicResolution", bool, True),
           ("UpscalingFilter", SCALER, True), ("DownscalingFilter", SCALER, True), ("NativeResolution", bool, True)]
DRIVE = [("ImageName", str, False), ("ReadOnly", bool, False),
         ("ImageType", ["None", "Disk", "CD", "BIOS", "LinuxKernel", "LinuxInitrd", "LinuxDTB"], True),
         ("Interface", ["None", "IDE", "SCSI", "SD", "MTD", "Floppy", "PFlash", "VirtIO", "NVMe", "USB"], True),
         ("InterfaceVersion", int, False), ("Identifier", str, True)]
PORT = [("Protocol", ["TCP", "UDP"], True), ("HostAddress", str, False), ("HostPort", int, True),
        ("GuestAddress", str, False), ("GuestPort", int, True)]
NETWORK = [("Mode", ["Emulated", "Shared", "Host", "Bridged"], True), ("Hardware", str, True), ("MacAddress", str, True),
           ("IsolateFromHost", bool, True), ("PortForward", ("list", PORT), True), ("BridgeInterface", str, False),
           ("VlanGuestAddress", str, False), ("VlanGuestAddressIPv6", str, False), ("VlanHostAddress", str, False),
           ("VlanHostAddressIPv6", str, False), ("VlanDhcpStartAddress", str, False), ("VlanDhcpEndAddress", str, False),
           ("VlanDhcpDomain", str, False), ("VlanDnsServerAddress", str, False), ("VlanDnsServerAddressIPv6", str, False),
           ("VlanDnsSearchDomain", str, False), ("HostNetUuid", "uuid", False)]
TERMINAL = [("Theme", str, False), ("ForegroundColor", str, False), ("BackgroundColor", str, False), ("Font", str, True),
            ("FontSize", int, True), ("ResizeCommand", str, False), ("CursorBlink", bool, False)]
# "Ptty" decodes on macOS only (QEMUSerialMode is #if os(macOS) there).
SERIAL = [("Mode", ["Terminal", "TcpClient", "TcpServer"], True), ("Target", ["Auto", "Manual", "GDB", "Monitor"], True),
          ("Terminal", TERMINAL, False), ("Hardware", str, False), ("TcpHostAddress", str, False), ("TcpPort", int, False),
          ("WaitForConnection", bool, False), ("RemoteConnectionAllowed", bool, False)]
SOUND = [("Hardware", str, True)]
TOP = [("Backend", ["QEMU"], True), ("ConfigurationVersion", int, True), ("Information", INFO, True),
       ("System", SYSTEM, True), ("QEMU", QEMU, True), ("Input", INPUT, True), ("Sharing", SHARING, True),
       ("Display", ("list", DISPLAY), True), ("Drive", ("list", DRIVE), True), ("Network", ("list", NETWORK), True),
       ("Serial", ("list", SERIAL), True), ("Sound", ("list", SOUND), True)]
# UTMConfiguration.swift: oldestVersion and currentVersion, 4 from UTM 4.0 to 5.0.6.
VERSIONS = (4, 4)


def check_value(path, value, kind, faults):
    if kind is bool:
        ok = isinstance(value, bool)
    elif kind is int:
        ok = isinstance(value, int) and not isinstance(value, bool)
    elif kind is str:
        ok = isinstance(value, str)
    elif kind == "uuid":
        ok = isinstance(value, str)
        if ok:
            try:
                uuid.UUID(value)
            except ValueError:
                ok = False
    elif isinstance(kind, list) and all(isinstance(k, str) for k in kind):
        ok = isinstance(value, str) and value in kind
        if not ok:
            faults.append("%s: %r is not one of %s" % (path, value, ", ".join(kind)))
            return
    elif isinstance(kind, tuple) and kind[0] == "list":
        if not isinstance(value, list):
            faults.append("%s: not an array" % path)
            return
        for i, item in enumerate(value):
            check_value("%s[%d]" % (path, i), item, kind[1], faults)
        return
    elif isinstance(kind, list):
        if not isinstance(value, dict):
            faults.append("%s: not a dictionary" % path)
            return
        for key, sub, required in kind:
            if key in value:
                check_value("%s.%s" % (path, key), value[key], sub, faults)
            elif required:
                faults.append("%s.%s: missing (UTM's decoder requires it)" % (path, key))
        return
    else:
        raise AssertionError(kind)
    if not ok:
        faults.append("%s: %r is not a %s" % (path, value, getattr(kind, "__name__", kind)))


def check_config(config):
    faults = []
    check_value("config", config, TOP, faults)
    v = config.get("ConfigurationVersion")
    if isinstance(v, int) and not VERSIONS[0] <= v <= VERSIONS[1]:
        faults.append("ConfigurationVersion %d: UTM 4.0 to 5.0.6 read %d to %d" % (v, VERSIONS[0], VERSIONS[1]))
    if not faults:
        info = config["Information"]
        if info["IconCustom"] and "Icon" not in info:
            faults.append("Information.Icon: a custom icon needs its file name")
        user = parse_user_arguments(config["QEMU"]["AdditionalArguments"])
        for i, arg in enumerate(user):
            if arg in ("-append", "-global", "-device", "-machine", "-kernel") and i + 1 >= len(user):
                faults.append("QEMU.AdditionalArguments: %s has no value" % arg)
        if user.count("-append") > 1:
            faults.append("QEMU.AdditionalArguments: -append twice")
    return faults


def check_bundle(bundle):
    faults = []
    plist = os.path.join(bundle, "config.plist")
    if not bundle.rstrip("/").endswith(".utm"):
        faults.append("%s: UTM takes a folder whose name ends in .utm (ConcreteVirtualMachine.isVirtualMachine)" % bundle)
    try:
        with open(plist, "rb") as f:
            config = plistlib.load(f)
    except (OSError, plistlib.InvalidFileException, ValueError) as e:
        return None, ["config.plist: %s" % e]
    faults += check_config(config)
    data = os.path.join(bundle, "Data")
    named = set()
    for i, d in enumerate(config.get("Drive", [])):
        name = d.get("ImageName") if isinstance(d, dict) else None
        if name is None:
            continue
        named.add(name)
        if "/" in name or not os.path.isfile(os.path.join(data, name)):
            faults.append("Drive[%d]: Data/%s is not there" % (i, name))
    info = config.get("Information", {})
    if isinstance(info, dict) and info.get("IconCustom") and info.get("Icon"):
        named.add(info["Icon"])
    if os.path.isdir(data):
        # UTM's own files there (UTMQemuConfigurationQEMU.saveData) are kept too.
        kept = named | {"debug.log", "efi_vars.fd", "tpmdata", "vmstate"}
        for f in sorted(os.listdir(data)):
            if f not in kept and not f.startswith("."):
                faults.append("Data/%s: no setting names it, so UTM deletes it when it saves the settings" % f)
    else:
        faults.append("Data/: missing")
    return config, faults


# ---- The QEMU command ------------------------------------------------------
# parsedUserArguments: each argument split at white space, except inside
# double quotes; an argument wholly in quotes loses them.
USER_ARG = re.compile(r'((?:[^"\s]*"[^"]*"[^"\s]*)+|[^"\s]+)')


def parse_user_arguments(args):
    out = []
    for a in args:
        for m in USER_ARG.finditer(a):
            f = m.group(1)
            if len(f) >= 2 and f[0] == '"' and f[-1] == '"':
                f = f[1:-1]
            out.append(f)
    return out


HOSTS = {
    # hypervisor: hasHypervisorSupport; split_wx: WITH_JIT without the
    # dynamic-codesigning entitlement (machineArguments); usb_sharing:
    # WITH_USB (usbArguments); gl: glBackend
    "macos": {"hypervisor": True, "split_wx": False, "usb_sharing": True, "gl": "es", "ios": False},
    "ios": {"hypervisor": False, "split_wx": True, "usb_sharing": True, "gl": "on", "ios": True},
    "ios-se": {"hypervisor": False, "split_wx": False, "usb_sharing": False, "gl": "on", "ios": True},
}


def qemu_arguments(config, host, data_dir="Data", resources="<UTM's caches>/qemu"):
    h = HOSTS[host]
    sysc, q, inp = config["System"], config["QEMU"], config["Input"]
    displays, drives, networks = config["Display"], config["Drive"], config["Network"]
    serials, sound = config["Serial"], config["Sound"]
    vm_uuid = config["Information"]["UUID"]
    if sysc["Architecture"] != "aarch64" or sysc["Target"] != "virt":
        raise SystemExit("check-utm-bundle.py: only an ARM64 virt machine is modelled")
    hv = h["hypervisor"] and q["Hypervisor"]
    gl_display = any(d["Hardware"].endswith("-gl") or "-gl-" in d["Hardware"] for d in displays)
    # Settings' defaults (renderer, Vulkan and DirectX drivers: "Default"):
    # Vulkan (venus) and DirectX (neptune) are on for a GL display.
    vulkan = neptune = gl_display
    a = ["-L", resources, "-S"]
    # spiceArguments
    a += ["-spice", "unix=on,addr=%s.spice,disable-ticketing=on,image-compression=off,playback-compression=off,"
                    "streaming-video=off,gl=%s" % (vm_uuid, h["gl"] if gl_display else "off"),
          "-chardev", "spiceport,name=org.qemu.monitor.qmp.0,id=org.qemu.monitor.qmp",
          "-mon", "chardev=org.qemu.monitor.qmp,mode=control", "-nodefaults", "-vga", "none"]
    # networkArguments: "Emulated" is QEMU's user networking; on iOS every
    # mode is (vmnet is macOS's).
    for i, n in enumerate(networks):
        a += ["-device", "%s,mac=%s,netdev=net%d" % (n["Hardware"], n["MacAddress"], i)]
        if not h["ios"] and n["Mode"] in ("Shared", "Bridged", "Host"):
            a += ["-netdev", "vmnet-%s,id=net%d" % (n["Mode"].lower(), i)]
            continue
        nd = "user,id=net%d" % i
        if n["IsolateFromHost"]:
            nd += ",restrict=on"
        for p in n["PortForward"]:
            nd += ",hostfwd=%s:%s:%d-%s:%d" % (p["Protocol"].lower(), p.get("HostAddress", ""), p["HostPort"],
                                               p.get("GuestAddress", ""), p["GuestPort"])
        a += ["-netdev", nd]
    if not networks:
        a += ["-nic", "none"]
    # displayArguments
    if not displays:
        a += ["-nographic"]
    for d in displays:
        dev = d["Hardware"]
        if "VgaRamMib" in d:
            dev += ",vgamem_mb=%d" % d["VgaRamMib"]
        is_gl = d["Hardware"].endswith("-gl") or "-gl-" in d["Hardware"]
        if is_gl and vulkan:
            dev += ",hostmem=8G,blob=true,venus=true"
        if is_gl and neptune:
            dev += ",neptune=true"
        a += ["-device", dev]
    # serialArguments
    for i, s in enumerate(serials):
        if s["Mode"] == "Terminal":
            a += ["-chardev", "spiceport,id=term%d,name=com.utmapp.terminal.%d" % (i, i)]
        else:
            raise SystemExit("check-utm-bundle.py: only a built-in terminal serial is modelled")
        if s["Target"] == "Auto":
            a += ["-serial", "chardev:term%d" % i]
        elif s["Target"] == "Monitor":
            a += ["-mon", "chardev=term%d,mode=readline" % i]
        else:
            raise SystemExit("check-utm-bundle.py: serial target %s is not modelled" % s["Target"])
    # cpuArguments
    if sysc["CPU"] == "default":
        a += ["-cpu", "host" if hv else "cortex-a72"]
    else:
        a += ["-cpu", ",".join([sysc["CPU"]] + ["+" + f for f in sysc["CPUFlagsAdd"]]
                               + ["-" + f for f in sysc["CPUFlagsRemove"]])]
    n = sysc["CPUCount"]
    if n <= 0:
        raise SystemExit("check-utm-bundle.py: CPUCount 0 (the host's performance cores) is not modelled")
    a += ["-smp", "cpus=%d,sockets=1,cores=%d,threads=1" % (n, n)]
    # machineArguments, machineProperties (appendingDefaultPropertyName adds
    # a property only when the override does not name it)
    props = q.get("MachinePropertyOverride", "")

    def default_prop(props, name, value):
        return props if (name + "=") in props else props + ("," if props else "") + "%s=%s" % (name, value)
    if not hv:
        props = default_prop(props, "virtualization", "on")
    props = default_prop(props, "gic-version", "3")
    a += ["-machine", "virt" + ("," + props if props else "")]
    if hv:
        a += ["-accel", "hvf" + (",ipa-granule-size=0x1000" if vulkan else "")]
    else:
        tcg = "tcg"
        if sysc["ForceMulticore"]:
            tcg += ",thread=multi"
        tcg += ",tb-size=%d" % (sysc["JITCacheSize"] if sysc["JITCacheSize"] > 0 else sysc["MemorySize"] // 4)
        if h["split_wx"]:
            tcg += ",split-wx=on"
        a += ["-accel", tcg]
    # architectureArguments: UEFI's flash only without a kernel or BIOS drive
    if q["UEFIBoot"] and not any(d["ImageType"] in ("LinuxKernel", "BIOS") for d in drives):
        raise SystemExit("check-utm-bundle.py: UEFI boot is not modelled")
    a += ["-m", str(sysc["MemorySize"])]
    # soundArguments (the SPICE audio back end: iOS always; macOS unless its
    # Settings choose Core Audio)
    if not sound:
        a += ["-audio", "none"]
    a += ["-audiodev", "spice,id=audio0"]
    for s in sound:
        if "hda" in s["Hardware"]:
            a += ["-device", s["Hardware"], "-device", "hda-duplex,audiodev=audio0"]
        else:
            a += ["-device", s["Hardware"] + ",audiodev=audio0"]
    # usbArguments
    if inp["UsbBusSupport"] != "Disabled":
        a += ["-device", "nec-usb-xhci,id=usb-bus", "-device", "usb-tablet,bus=usb-bus.0"]
        if not q["PS2Controller"]:
            a += ["-device", "usb-mouse,bus=usb-bus.0", "-device", "usb-kbd,bus=usb-bus.0"]
        if h["usb_sharing"]:
            m = inp["MaximumUsbShare"]
            for i in range((m + 2) // 3):
                if inp["UsbBusSupport"] == "3.0":
                    a += ["-device", "qemu-xhci,id=usb-controller-%d" % i]
                else:
                    a += ["-device", "ich9-usb-ehci1,id=usb-controller-%d" % i]
                    for j in (1, 2, 3):
                        a += ["-device", "ich9-usb-uhci%d,masterbus=usb-controller-%d.0,firstport=%d,multifunction=on"
                              % (j, i, (j - 1) * 2)]
            for i in range(m):
                a += ["-chardev", "spicevmc,name=usbredir,id=usbredirchardev%d" % i,
                      "-device", "usb-redir,chardev=usbredirchardev%d,id=usbredirdev%d,bus=usb-controller-%d.0"
                      % (i, i, i // 3)]
    # drivesArguments
    boot = 0
    for d in drives:
        path = os.path.join(data_dir, d["ImageName"]) if "ImageName" in d else None
        if d["ImageType"] in ("Disk", "CD"):
            if d["Interface"] != "VirtIO" or d["ImageType"] != "Disk":
                raise SystemExit("check-utm-bundle.py: only a VirtIO disk is modelled")
            ident = d["Identifier"]
            a += ["-device", "virtio-blk-pci,drive=drive%s,serial=%s,bootindex=%d"
                  % (ident, ident.replace("-", "")[:20], boot)]
            boot += 1
            dr = "if=none,media=disk,id=drive%s" % ident
            dr += ",file.filename=" + (path.replace(",", ",,") if path else "<an empty file>")
            dr += ",file.locking=off,readonly=on" if d.get("ReadOnly", "ImageName" not in d) else \
                ",discard=unmap,detect-zeroes=unmap"
            a += ["-drive", dr]
        elif path:
            flag = {"BIOS": "-bios", "LinuxKernel": "-kernel", "LinuxInitrd": "-initrd", "LinuxDTB": "-dtb"}
            if d["ImageType"] in flag:
                a += [flag[d["ImageType"]], path]
    # sharingArguments: the guest agent's port always (aarch64 has agent support)
    a += ["-device", "virtio-serial", "-device", "virtserialport,chardev=org.qemu.guest_agent,name=org.qemu.guest_agent.0",
          "-chardev", "spiceport,name=org.qemu.guest_agent.0,id=org.qemu.guest_agent"]
    sh = config["Sharing"]
    if sh["ClipboardSharing"] or sh["DirectoryShareMode"] == "WebDAV" or any(d["DynamicResolution"] for d in displays):
        a += ["-device", "virtserialport,chardev=vdagent,name=com.redhat.spice.0",
              "-chardev", "spicevmc,id=vdagent,debug=0,name=vdagent"]
        if sh["DirectoryShareMode"] == "WebDAV":
            a += ["-device", "virtserialport,chardev=charchannel1,id=channel1,name=org.spice-space.webdav.0",
                  "-chardev", "spiceport,name=org.spice-space.webdav.0,id=charchannel1"]
    if sh["DirectoryShareMode"] == "VirtFS":
        raise SystemExit("check-utm-bundle.py: VirtFS sharing is not modelled")
    # miscArguments
    name = "".join(c for c in config["Information"]["Name"] if c.isalnum() or c.isspace())
    a += ["-name", name, "-uuid", vm_uuid]
    if q["RTCLocalTime"]:
        a += ["-rtc", "base=localtime"]
    if q["RNGDevice"]:
        a += ["-device", "virtio-rng-pci"]
    if q["BalloonDevice"]:
        a += ["-device", "virtio-balloon-pci"]
    if q["TPMDevice"]:
        raise SystemExit("check-utm-bundle.py: a TPM is not modelled")
    return a + parse_user_arguments(q["AdditionalArguments"])


def main(argv):
    args = argv[1:]
    host = None
    if "--qemu" in args:
        i = args.index("--qemu")
        if i + 1 >= len(args) or args[i + 1] not in HOSTS:
            sys.stderr.write("check-utm-bundle.py: --qemu %s\n" % "|".join(HOSTS))
            return 2
        host = args[i + 1]
        del args[i:i + 2]
    if len(args) == 2 and args[0] == "--config":
        with open(args[1], "rb") as f:
            config = plistlib.load(f)
        faults = check_config(config)
        data_dir = "Data"
    elif len(args) == 1:
        config, faults = check_bundle(args[0])
        data_dir = os.path.join(os.path.abspath(args[0]), "Data")
    else:
        sys.stderr.write("usage: check-utm-bundle.py BUNDLE [--qemu HOST] | --config PLIST [--qemu HOST]\n")
        return 2
    for f in faults:
        print("FAULT %s" % f, file=sys.stderr)
    if faults:
        return 1
    if host:
        for arg in qemu_arguments(config, host, data_dir):
            print(arg)
    else:
        print("check-utm-bundle.py: UTM 4.0 to 5.0.6 read it")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
