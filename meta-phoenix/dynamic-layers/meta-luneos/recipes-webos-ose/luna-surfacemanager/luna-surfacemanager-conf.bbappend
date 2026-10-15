# LuneOS's recipe adds 99-virtualbox-mouse.rules for every QEMU machine
# (SRC_URI:append:qemuall, meta-luneos/recipes-webos-ose/luna-surfacemanager/
# luna-surfacemanager-conf.bb:16, 27-30) but ships the file for qemux86 alone,
# so phoenix-vm-arm64 (a qemuall machine) stopped the parse. Ours is the same
# rule, LuneOS's line as is (MIT): it names VirtualBox's mouse device, which
# VirtualBox on Apple silicon gives an arm64 guest too; elsewhere it matches
# nothing.
FILESEXTRAPATHS:prepend := "${THISDIR}/${PN}:"
