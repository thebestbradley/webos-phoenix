// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phoenix VM Location: this Mac's position (Core Location) as a GPS for
// webOS Phoenix VMs. It serves NMEA sentences on 127.0.0.1 (port 45570 by
// default); scripts/vm.sh and scripts/make-utm.sh give each VM a virtio
// serial port (org.webosphoenix.gps.0) whose QEMU end connects here, and the
// image's nyx GPS module reads it (/etc/location/gpsConfig.conf). docs/MAPS.md,
// "Where the position comes from".
//
//   Phoenix VM Location.app/Contents/MacOS/vm-location [--port N] [--fixed LAT,LON[,ACCURACY]] [--verbose]
//
// --fixed: send that position instead of asking Core Location (no
// permission needed). Without a fix nothing is sent, and the VM's network
// handler answers instead (by IP address).
//
// Each second: $GPGGA, then $GPRMC 300 ms later. nyx reads a port in
// chunks and parses only the first sentence of each chunk, so the
// sentences are sent apart; it also reports GGA's HDOP field as the
// accuracy in metres, so that field carries Core Location's horizontal
// accuracy (1 to 99.9).

import AppKit
import CoreLocation
import Foundation
import Network

struct Fix {
    var latitude: Double
    var longitude: Double
    var altitude: Double
    var accuracy: Double
    var speed: Double      // m/s, -1 unknown
    var course: Double     // degrees, -1 unknown
}

func checksum(_ body: String) -> String {
    var x: UInt8 = 0
    for b in body.utf8 { x ^= b }
    return String(format: "%02X", x)
}

func sentence(_ body: String) -> String { "$\(body)*\(checksum(body))\r\n" }

func coordinate(_ value: Double, degreesWidth: Int, positive: String, negative: String) -> (String, String) {
    let a = abs(value)
    let degrees = Int(a)
    let minutes = (a - Double(degrees)) * 60
    let text = String(format: "%0\(degreesWidth)d%08.5f", degrees, minutes)
    return (text, value >= 0 ? positive : negative)
}

func nmea(_ fix: Fix, at date: Date) -> [String] {
    let utc = TimeZone(identifier: "UTC")!
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = utc
    let c = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second, .nanosecond], from: date)
    let time = String(format: "%02d%02d%02d.%02d", c.hour!, c.minute!, c.second!, c.nanosecond! / 10_000_000)
    let day = String(format: "%02d%02d%02d", c.day!, c.month!, c.year! % 100)
    let (lat, ns) = coordinate(fix.latitude, degreesWidth: 2, positive: "N", negative: "S")
    let (lon, ew) = coordinate(fix.longitude, degreesWidth: 3, positive: "E", negative: "W")
    let hdop = String(format: "%.1f", min(99.9, max(1.0, fix.accuracy)))
    let gga = "GPGGA,\(time),\(lat),\(ns),\(lon),\(ew),1,08,\(hdop),\(String(format: "%.1f", fix.altitude)),M,0.0,M,,"
    let knots = fix.speed >= 0 ? String(format: "%.1f", fix.speed / 0.514444) : "0.0"
    let course = fix.course >= 0 ? String(format: "%.1f", fix.course) : ""
    let rmc = "GPRMC,\(time),A,\(lat),\(ns),\(lon),\(ew),\(knots),\(course),\(day),,,A"
    return [sentence(gga), sentence(rmc)]
}

final class Feed: NSObject, CLLocationManagerDelegate {
    let port: UInt16
    let fixed: Fix?
    let verbose: Bool
    let manager = CLLocationManager()
    var fix: Fix?
    var listener: NWListener?
    var clients: [ObjectIdentifier: NWConnection] = [:]
    let queue = DispatchQueue(label: "org.webosphoenix.vm-location")

    init(port: UInt16, fixed: Fix?, verbose: Bool) {
        self.port = port
        self.fixed = fixed
        self.verbose = verbose
        self.fix = fixed
        super.init()
    }

    func log(_ text: String) {
        FileHandle.standardError.write(("vm-location: " + text + "\n").data(using: .utf8)!)
    }

    func start() {
        if fixed == nil {
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyBest
            manager.distanceFilter = kCLDistanceFilterNone
            manager.requestWhenInUseAuthorization()
            manager.startUpdatingLocation()
        }
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
        do {
            listener = try NWListener(using: parameters)
        } catch {
            log("cannot listen on 127.0.0.1:\(port): \(error)")
            exit(1)
        }
        listener?.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
        listener?.stateUpdateHandler = { [weak self] state in
            if case .failed(let error) = state {
                self?.log("listener failed: \(error)")
                exit(1)
            }
            if case .ready = state { self?.log("serving NMEA on 127.0.0.1:\(self?.port ?? 0)") }
        }
        listener?.start(queue: queue)
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 1, repeating: 1.0)
        timer.setEventHandler { [weak self] in self?.tick() }
        timer.resume()
        objc_setAssociatedObject(self, "timer", timer, .OBJC_ASSOCIATION_RETAIN)
    }

    func accept(_ connection: NWConnection) {
        let id = ObjectIdentifier(connection)
        clients[id] = connection
        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled:
                self?.queue.async { self?.clients[id] = nil }
            default: break
            }
        }
        // The guest never writes; read and drop, to see the end of the connection.
        func drain() {
            connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { _, _, done, error in
                if done || error != nil { connection.cancel() } else { drain() }
            }
        }
        connection.start(queue: queue)
        drain()
        if verbose { log("a VM connected (\(clients.count) now)") }
    }

    func tick() {
        guard let fix = fix, !clients.isEmpty else { return }
        let lines = nmea(fix, at: Date())
        if verbose { log(lines.joined().trimmingCharacters(in: .whitespacesAndNewlines)) }
        send(lines[0])
        queue.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.send(lines[1]) }
    }

    func send(_ line: String) {
        let data = line.data(using: .ascii)!
        for connection in clients.values {
            connection.send(content: data, completion: .contentProcessed { _ in })
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .denied, .restricted:
            log("Location Services are off for this app (System Settings > Privacy & Security > Location Services); VMs get no GPS fix")
        case .authorizedAlways, .authorized:
            manager.startUpdatingLocation()
        default: break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let l = locations.last else { return }
        let f = Fix(latitude: l.coordinate.latitude, longitude: l.coordinate.longitude,
                    altitude: l.verticalAccuracy >= 0 ? l.altitude : 0,
                    accuracy: l.horizontalAccuracy, speed: l.speed, course: l.course)
        queue.async { [weak self] in
            if self?.fix == nil { self?.log(String(format: "first fix, accuracy %.0f m", f.accuracy)) }
            self?.fix = f
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if verbose { log("Core Location: \(error.localizedDescription)") }
    }
}

var port: UInt16 = 45570
var fixed: Fix?
var verbose = false
var args = CommandLine.arguments.dropFirst()
while let a = args.popFirst() {
    switch a {
    case "--port":
        guard let v = args.popFirst(), let p = UInt16(v), p > 0 else { fatalError("--port N") }
        port = p
    case "--fixed":
        let parts = (args.popFirst() ?? "").split(separator: ",").compactMap { Double($0) }
        guard parts.count >= 2, abs(parts[0]) <= 90, abs(parts[1]) <= 180 else { fatalError("--fixed LAT,LON[,ACCURACY]") }
        fixed = Fix(latitude: parts[0], longitude: parts[1], altitude: 0, accuracy: parts.count > 2 ? parts[2] : 10, speed: -1, course: -1)
    case "--verbose":
        verbose = true
    case "-NSDocumentRevisionsDebugMode", "YES", "NO":
        break // Xcode's launch arguments
    default:
        if a.hasPrefix("-psn_") { break } // Finder's
        FileHandle.standardError.write("usage: vm-location [--port N] [--fixed LAT,LON[,ACCURACY]] [--verbose]\n".data(using: .utf8)!)
        exit(2)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let feed = Feed(port: port, fixed: fixed, verbose: verbose)
feed.start()
app.run()
