# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "Boot menu of the Phoenix VM's EFI disk"
DESCRIPTION = "systemd-boot's loader.conf and one loader entry per form \
factor for phoenix-vm-arm64's EFI disk (files/wic/phoenix-vm-efi.wks.in), \
so a developer chooses tablet or phone at boot without editing anything \
(docs/VIRTUALIZATION.md, X1). Deployed only: wic copies the files to the \
EFI system partition through IMAGE_BOOT_FILES."
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

COMPATIBLE_MACHINE = "phoenix-vm-arm64"

inherit deploy nopackages

# One entry per item, "name:device:WxH", the first the default. The device
# is a phoenix-device-config profile (phoenix.device=, as scripts/vm.sh
# passes it), and the size is the screen the kernel asks the hypervisor's
# display for (video=), matching that device's panel.
PHOENIX_VM_BOOT_ENTRIES ?= "tablet:pinetab2:1280x800 phone:pinephonepro:720x1440"
PHOENIX_VM_BOOT_TIMEOUT ?= "3"
# console=tty0 last, so the screen is /dev/console; the PL011 (QEMU,
# libvirt), hvc0 (Apple Virtualization's only console) and the firmware's
# ACPI SPCR serial still get the kernel's log.
PHOENIX_VM_BOOT_ARGS ?= "root=PARTLABEL=phoenix-root rootwait rw console=ttyAMA0 console=hvc0 console=tty0"

do_configure[noexec] = "1"
do_install[noexec] = "1"
do_compile[vardeps] += "PHOENIX_VM_BOOT_ENTRIES PHOENIX_VM_BOOT_TIMEOUT PHOENIX_VM_BOOT_ARGS KERNEL_IMAGETYPE"

python do_compile() {
    import os
    out = os.path.join(d.getVar('B'), 'phoenix-vm-boot')
    entries = os.path.join(out, 'entries')
    bb.utils.mkdirhier(entries)
    items = d.getVar('PHOENIX_VM_BOOT_ENTRIES').split()
    if not items:
        bb.fatal('PHOENIX_VM_BOOT_ENTRIES is empty')
    kernel = d.getVar('KERNEL_IMAGETYPE')
    args = d.getVar('PHOENIX_VM_BOOT_ARGS')
    for n, item in enumerate(items):
        try:
            name, device, size = item.split(':')
        except ValueError:
            bb.fatal('PHOENIX_VM_BOOT_ENTRIES item %r is not name:device:WxH' % item)
        with open(os.path.join(entries, 'phoenix-%s.conf' % name), 'w') as f:
            f.write('title   webOS Phoenix (%s)\n' % name)
            f.write('sort-key %02d-phoenix\n' % n)
            f.write('linux   /phoenix/%s\n' % kernel)
            f.write('options %s phoenix.device=%s video=%s\n' % (args, device, size))
    default = items[0].split(':')[0]
    with open(os.path.join(out, 'loader.conf'), 'w') as f:
        f.write('default phoenix-%s.conf\n' % default)
        f.write('timeout %s\n' % d.getVar('PHOENIX_VM_BOOT_TIMEOUT'))
        f.write('console-mode keep\n')
        f.write('editor yes\n')
}

do_deploy() {
    install -d ${DEPLOYDIR}/phoenix-vm-boot/entries
    install -m 0644 ${B}/phoenix-vm-boot/loader.conf ${DEPLOYDIR}/phoenix-vm-boot/
    install -m 0644 ${B}/phoenix-vm-boot/entries/*.conf ${DEPLOYDIR}/phoenix-vm-boot/entries/
}
addtask deploy after do_compile before do_build
