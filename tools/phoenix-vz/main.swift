// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-vz: run the Phoenix VM image under Apple's Virtualization
// framework (the engine of UTM's Apple backend, Tart and VirtualBuddy),
// headless, for the image regression suite and quick checks
// (docs/VIRTUALIZATION.md in 2.0, "phoenix-vz"). Needs nothing installed:
// build it with tools/phoenix-vz/build.sh (swiftc, then an ad hoc signature
// with the virtualization entitlement).
//
//   phoenix-vz --disk DISK.img [--efi NVRAM] [--kernel Image --cmdline "..."]
//              [--cpus N] [--memory MIB] [--size WxH] [--serial FILE]
//              [--shots DIR] [--every SECONDS] [--seconds N] [--window]
//
// --disk     a raw disk: the A/B disk (.wic, make-vm-packages.sh raw) or,
//            with --kernel, the kernel-boot ext4. It is written to: give
//            it a copy (an APFS clone costs nothing: cp -c).
// --efi FILE boot through EFI firmware (VZEFIBootLoader); FILE is the EFI
//            variable store, made if missing. The default when --kernel
//            is not given.
// --kernel   boot this arm64 Image directly (VZLinuxBootLoader), with
//            --cmdline (default: root=/dev/vda rw rootwait console=hvc0
//            phoenix.device=pinetab2).
// --size     the virtio-gpu screen (default 1280x800)
// --serial   the console (hvc0) to this file (default: stdout)
// --shots    write a PNG of the screen to DIR every --every seconds
//            (default 15) and at the end
// --seconds  stop the VM after N seconds (default: run until it stops)
// --window   show the screen in a window instead of off screen

import AppKit
import Foundation
import Virtualization

func fail(_ s: String) -> Never {
    FileHandle.standardError.write(("phoenix-vz: " + s + "\n").data(using: .utf8)!)
    exit(1)
}
func note(_ s: String) {
    FileHandle.standardError.write(("phoenix-vz: " + s + "\n").data(using: .utf8)!)
}

struct Options {
    var disk = ""
    var efi: String?
    var kernel: String?
    var cmdline = "root=/dev/vda rw rootwait console=hvc0 phoenix.device=pinetab2"
    var cpus = 4
    var memory: UInt64 = 4096
    var width = 1280, height = 800
    var serial: String?
    var shots: String?
    var every = 15.0
    var seconds: Double?
    var window = false
}

func parse() -> Options {
    var o = Options()
    var a = Array(CommandLine.arguments.dropFirst())
    func next(_ flag: String) -> String {
        if a.isEmpty { fail("\(flag) needs a value") }
        return a.removeFirst()
    }
    while !a.isEmpty {
        let f = a.removeFirst()
        switch f {
        case "--disk": o.disk = next(f)
        case "--efi": o.efi = next(f)
        case "--kernel": o.kernel = next(f)
        case "--cmdline": o.cmdline = next(f)
        case "--cpus": o.cpus = Int(next(f)) ?? 0
        case "--memory": o.memory = UInt64(next(f)) ?? 0
        case "--size":
            let p = next(f).split(separator: "x").compactMap { Int($0) }
            if p.count != 2 { fail("--size wants WxH") }
            o.width = p[0]; o.height = p[1]
        case "--serial": o.serial = next(f)
        case "--shots": o.shots = next(f)
        case "--every": o.every = Double(next(f)) ?? 15
        case "--seconds": o.seconds = Double(next(f))
        case "--window": o.window = true
        case "-h", "--help":
            print("phoenix-vz --disk DISK [--efi NVRAM | --kernel Image --cmdline ...] [--cpus N] [--memory MIB] [--size WxH] [--serial FILE] [--shots DIR] [--every S] [--seconds N] [--window]")
            exit(0)
        default: fail("unknown option \(f)")
        }
    }
    if o.disk.isEmpty { fail("--disk is required") }
    if o.cpus < 1 || o.memory < 512 { fail("bad --cpus or --memory") }
    if o.kernel == nil && o.efi == nil { o.efi = o.disk + ".nvram" }
    return o
}

func configuration(_ o: Options) throws -> VZVirtualMachineConfiguration {
    let c = VZVirtualMachineConfiguration()
    c.cpuCount = min(o.cpus, VZVirtualMachineConfiguration.maximumAllowedCPUCount)
    c.memorySize = o.memory * 1024 * 1024
    c.platform = VZGenericPlatformConfiguration()

    if let k = o.kernel {
        let b = VZLinuxBootLoader(kernelURL: URL(fileURLWithPath: k))
        b.commandLine = o.cmdline
        c.bootLoader = b
    } else {
        let url = URL(fileURLWithPath: o.efi!)
        let store: VZEFIVariableStore
        if FileManager.default.fileExists(atPath: url.path) {
            store = VZEFIVariableStore(url: url)
        } else {
            store = try VZEFIVariableStore(creatingVariableStoreAt: url)
        }
        let b = VZEFIBootLoader()
        b.variableStore = store
        c.bootLoader = b
    }

    let disk = try VZDiskImageStorageDeviceAttachment(url: URL(fileURLWithPath: o.disk), readOnly: false)
    c.storageDevices = [VZVirtioBlockDeviceConfiguration(attachment: disk)]

    let net = VZVirtioNetworkDeviceConfiguration()
    net.attachment = VZNATNetworkDeviceAttachment()
    c.networkDevices = [net]

    let gpu = VZVirtioGraphicsDeviceConfiguration()
    gpu.scanouts = [VZVirtioGraphicsScanoutConfiguration(widthInPixels: o.width, heightInPixels: o.height)]
    c.graphicsDevices = [gpu]

    c.keyboards = [VZUSBKeyboardConfiguration()]
    c.pointingDevices = [VZUSBScreenCoordinatePointingDeviceConfiguration()]

    let sound = VZVirtioSoundDeviceConfiguration()
    let out = VZVirtioSoundDeviceOutputStreamConfiguration()
    out.sink = VZHostAudioOutputStreamSink()
    sound.streams = [out]
    c.audioDevices = [sound]

    let console = VZVirtioConsoleDeviceSerialPortConfiguration()
    let w: FileHandle
    if let s = o.serial {
        FileManager.default.createFile(atPath: s, contents: nil)
        guard let h = FileHandle(forWritingAtPath: s) else { fail("can't write \(s)") }
        w = h
    } else {
        w = FileHandle.standardOutput
    }
    console.attachment = VZFileHandleSerialPortAttachment(fileHandleForReading: nil, fileHandleForWriting: w)
    c.serialPorts = [console]

    c.entropyDevices = [VZVirtioEntropyDeviceConfiguration()]
    c.memoryBalloonDevices = [VZVirtioTraditionalMemoryBalloonDeviceConfiguration()]
    try c.validate()
    return c
}

final class Runner: NSObject, NSApplicationDelegate, VZVirtualMachineDelegate {
    let o: Options
    var vm: VZVirtualMachine!
    var window: NSWindow!
    var view: VZVirtualMachineView!
    var shot = 0
    let started = Date()

    init(_ o: Options) { self.o = o }

    func applicationDidFinishLaunching(_ n: Notification) {
        do {
            vm = VZVirtualMachine(configuration: try configuration(o))
        } catch {
            fail("configuration: \(error.localizedDescription)")
        }
        vm.delegate = self
        view = VZVirtualMachineView(frame: NSRect(x: 0, y: 0, width: o.width / 2, height: o.height / 2))
        view.virtualMachine = vm
        view.capturesSystemKeys = true
        if #available(macOS 14.0, *) { view.automaticallyReconfiguresDisplay = o.window }
        let origin = o.window ? NSPoint(x: 80, y: 80) : NSPoint(x: -20000, y: -20000)
        window = NSWindow(contentRect: NSRect(origin: origin, size: view.frame.size),
                          styleMask: o.window ? [.titled, .closable, .resizable] : [.borderless],
                          backing: .buffered, defer: false)
        window.title = "phoenix-vz"
        window.contentView = view
        window.orderFront(nil)
        vm.start { r in
            if case .failure(let e) = r { fail("start: \(e.localizedDescription)") }
            note("started (\(self.o.kernel == nil ? "EFI" : "kernel") boot, \(self.o.width)x\(self.o.height))")
        }
        if let d = o.shots {
            try? FileManager.default.createDirectory(atPath: d, withIntermediateDirectories: true)
            Timer.scheduledTimer(withTimeInterval: o.every, repeats: true) { _ in self.capture() }
        }
        if let s = o.seconds {
            Timer.scheduledTimer(withTimeInterval: s, repeats: false) { _ in self.finish("time limit") }
        }
        signal(SIGINT, SIG_IGN)
        let src = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
        src.setEventHandler { self.finish("interrupted") }
        src.resume()
        objc_setAssociatedObject(self, "sigint", src, .OBJC_ASSOCIATION_RETAIN)
    }

    // The screen as a PNG, from the view's own drawing. (If that comes out
    // blank for the Metal-backed view, the next step is ScreenCaptureKit on
    // this window, which needs Screen Recording permission once.)
    func capture() {
        guard let d = o.shots else { return }
        shot += 1
        let t = Int(Date().timeIntervalSince(started))
        let path = String(format: "%@/shot-%03d-%04ds.png", d, shot, t)
        var data: Data?
        if let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
            view.cacheDisplay(in: view.bounds, to: rep)
            data = rep.representation(using: .png, properties: [:])
        }
        if let data = data {
            try? data.write(to: URL(fileURLWithPath: path))
            note("screenshot \(path)")
        }
    }

    func finish(_ why: String) {
        capture()
        note("stopping: \(why)")
        if vm.canRequestStop { try? vm.requestStop() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
            if self.vm.state != .stopped && self.vm.canStop {
                self.vm.stop { _ in exit(0) }
            } else {
                exit(0)
            }
        }
    }

    func guestDidStop(_ vm: VZVirtualMachine) { note("guest stopped"); exit(0) }
    func virtualMachine(_ vm: VZVirtualMachine, didStopWithError e: Error) { fail("stopped with error: \(e.localizedDescription)") }
}

let options = parse()
let app = NSApplication.shared
app.setActivationPolicy(options.window ? .regular : .accessory)
let runner = Runner(options)
app.delegate = runner
app.run()
