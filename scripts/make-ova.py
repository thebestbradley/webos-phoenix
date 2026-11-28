#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Write an OVA (OVF 1.0, DSP0243) around a stream-optimized VMDK, for
# scripts/make-vm-packages.sh's "ova" target: the descriptor first in the
# tar (DSP0243 section 5.3: the .ovf, then the .mf, then the files in the
# order the References list them), a SHA256 manifest, EFI firmware for
# VMware's importers (vmw:Config firmware, as Workstation and ovftool
# write it), AHCI (x86-64) or NVMe (arm64) and e1000e, which the VM kernel
# builds in or as a module (phoenix-vm-hypervisors.cfg).
#
#   make-ova.py --vmdk FILE --capacity BYTES --name NAME --label LABEL
#               --arch arm64|x86-64 --cpus N --memory MIB --out FILE.ova

import argparse
import hashlib
import io
import os
import tarfile
from xml.sax.saxutils import escape, quoteattr

ap = argparse.ArgumentParser()
for a in ("vmdk", "capacity", "name", "label", "arch", "cpus", "memory", "out"):
    ap.add_argument("--" + a, required=True)
o = ap.parse_args()

disk = "phoenix-disk1.vmdk"
size = os.path.getsize(o.vmdk)
# CIM_OperatingSystem: 36 "LINUX" (no 64-bit Linux id names an ARM CPU);
# the importer's own guest type goes beside it.
vbox_os = "Linux_arm64" if o.arch == "arm64" else "Linux_64"
vmw_os = "arm-other6xlinux-64" if o.arch == "arm64" else "other6xlinux-64"
# The disk's controller. x86-64: AHCI, which every importer and every
# PC firmware knows. arm64: NVMe, as the .vmx has it: the arm64 OVA's
# importer is VMware Fusion on Apple silicon, and the arm64 UEFI of QEMU,
# UTM and Proxmox (edk2's ArmVirtQemu, AAVMF) has no AHCI driver, so a disk
# on AHCI is not even offered to boot there (tools/test-make-vm-packages.py
# --boot, 28 November 2026: "map: No mapping found").
if o.arch == "arm64":
    ctl_type, ctl_name, ctl_desc = "vmware.nvme.controller", "nvmeController0", "NVMe controller"
else:
    ctl_type, ctl_name, ctl_desc = "AHCI", "sataController0", "SATA controller"
ovf = f"""<?xml version="1.0" encoding="UTF-8"?>
<Envelope xmlns="http://schemas.dmtf.org/ovf/envelope/1"
    xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1"
    xmlns:rasd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_ResourceAllocationSettingData"
    xmlns:vssd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_VirtualSystemSettingData"
    xmlns:vmw="http://www.vmware.com/schema/ovf"
    xmlns:vbox="http://www.virtualbox.org/ovf/machine">
  <References>
    <File ovf:id="file1" ovf:href="{disk}" ovf:size="{size}"/>
  </References>
  <DiskSection>
    <Info>Virtual disks</Info>
    <Disk ovf:diskId="vmdisk1" ovf:fileRef="file1" ovf:capacity="{int(o.capacity)}" ovf:capacityAllocationUnits="byte"
        ovf:format="http://www.vmware.com/interfaces/specifications/vmdk.html#streamOptimized"/>
  </DiskSection>
  <NetworkSection>
    <Info>Logical networks</Info>
    <Network ovf:name="NAT"><Description>The VM's network</Description></Network>
  </NetworkSection>
  <VirtualSystem ovf:id={quoteattr("phoenix-" + o.name)}>
    <Info>{escape(o.label)}</Info>
    <Name>{escape(o.label)}</Name>
    <OperatingSystemSection ovf:id="36" vmw:osType="{vmw_os}">
      <Info>The guest: Linux ({o.arch})</Info>
      <Description>webOS Phoenix</Description>
      <vbox:OSType ovf:required="false">{vbox_os}</vbox:OSType>
    </OperatingSystemSection>
    <VirtualHardwareSection>
      <Info>Virtual hardware</Info>
      <System>
        <vssd:ElementName>Virtual Hardware Family</vssd:ElementName>
        <vssd:InstanceID>0</vssd:InstanceID>
        <vssd:VirtualSystemIdentifier>{escape("phoenix-" + o.name)}</vssd:VirtualSystemIdentifier>
        <vssd:VirtualSystemType>vmx-21</vssd:VirtualSystemType>
      </System>
      <Item>
        <rasd:AllocationUnits>hertz * 10^6</rasd:AllocationUnits>
        <rasd:Description>Number of virtual CPUs</rasd:Description>
        <rasd:ElementName>{int(o.cpus)} virtual CPUs</rasd:ElementName>
        <rasd:InstanceID>1</rasd:InstanceID>
        <rasd:ResourceType>3</rasd:ResourceType>
        <rasd:VirtualQuantity>{int(o.cpus)}</rasd:VirtualQuantity>
      </Item>
      <Item>
        <rasd:AllocationUnits>byte * 2^20</rasd:AllocationUnits>
        <rasd:Description>Memory size</rasd:Description>
        <rasd:ElementName>{int(o.memory)} MB of memory</rasd:ElementName>
        <rasd:InstanceID>2</rasd:InstanceID>
        <rasd:ResourceType>4</rasd:ResourceType>
        <rasd:VirtualQuantity>{int(o.memory)}</rasd:VirtualQuantity>
      </Item>
      <Item>
        <rasd:Address>0</rasd:Address>
        <rasd:Description>{ctl_desc}</rasd:Description>
        <rasd:ElementName>{ctl_name}</rasd:ElementName>
        <rasd:InstanceID>3</rasd:InstanceID>
        <rasd:ResourceSubType>{ctl_type}</rasd:ResourceSubType>
        <rasd:ResourceType>20</rasd:ResourceType>
      </Item>
      <Item>
        <rasd:AddressOnParent>0</rasd:AddressOnParent>
        <rasd:ElementName>disk0</rasd:ElementName>
        <rasd:HostResource>ovf:/disk/vmdisk1</rasd:HostResource>
        <rasd:InstanceID>4</rasd:InstanceID>
        <rasd:Parent>3</rasd:Parent>
        <rasd:ResourceType>17</rasd:ResourceType>
      </Item>
      <Item>
        <rasd:AutomaticAllocation>true</rasd:AutomaticAllocation>
        <rasd:Connection>NAT</rasd:Connection>
        <rasd:ElementName>ethernet0</rasd:ElementName>
        <rasd:InstanceID>5</rasd:InstanceID>
        <rasd:ResourceSubType>E1000e</rasd:ResourceSubType>
        <rasd:ResourceType>10</rasd:ResourceType>
      </Item>
      <Item ovf:required="false">
        <rasd:ElementName>usb</rasd:ElementName>
        <rasd:InstanceID>6</rasd:InstanceID>
        <rasd:ResourceSubType>vmware.usb.xhci</rasd:ResourceSubType>
        <rasd:ResourceType>23</rasd:ResourceType>
      </Item>
      <vmw:Config ovf:required="false" vmw:key="firmware" vmw:value="efi"/>
      <vmw:Config ovf:required="false" vmw:key="bootOptions.efiSecureBootEnabled" vmw:value="false"/>
    </VirtualHardwareSection>
  </VirtualSystem>
</Envelope>
"""
base = os.path.splitext(os.path.basename(o.out))[0]


def sha(path=None, data=None):
    h = hashlib.sha256()
    if data is not None:
        h.update(data)
    else:
        with open(path, "rb") as f:
            for b in iter(lambda: f.read(1 << 20), b""):
                h.update(b)
    return h.hexdigest()


ovf_bytes = ovf.encode()
mf = f"SHA256({base}.ovf)= {sha(data=ovf_bytes)}\nSHA256({disk})= {sha(o.vmdk)}\n".encode()
tmp = o.out + ".part"
with tarfile.open(tmp, "w", format=tarfile.USTAR_FORMAT) as t:
    for name, data in ((base + ".ovf", ovf_bytes), (base + ".mf", mf)):
        info = tarfile.TarInfo(name)
        info.size = len(data)
        info.mode = 0o644
        t.addfile(info, io.BytesIO(data))
    info = t.gettarinfo(o.vmdk, arcname=disk)
    info.uid = info.gid = 0
    info.uname = info.gname = ""
    info.mode = 0o644
    with open(o.vmdk, "rb") as f:
        t.addfile(info, f)
os.replace(tmp, o.out)
