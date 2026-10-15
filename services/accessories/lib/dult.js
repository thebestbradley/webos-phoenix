// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Finding a tracker that is not yours: the "non-owner" GATT service of
// the IETF's Detecting Unwanted Location Trackers accessory protocol
// (draft-ietf-dult-accessory-protocol-00 §3.11-3.13; the same in
// draft-ledvina-apple-google-unwanted-trackers-03), which trackers of
// Apple's, Google's, Samsung's and Amazon's networks answer while they are
// separated from their owner. Google's Find Hub trackers ring through it
// too (Google's Find Hub Network accessory specification, "DULT": the
// Accessory Non-Owner service and its Sound_Start).
//
//   service         15190001-12F4-C226-88ED-2AC5579F2A85 (primary, GATT over LE)
//   characteristic  8E0C0001-1D68-FB92-BF61-48377421680E: commands are
//                   written to it, answers come as indications; every
//                   value little-endian (§3.11.1): a two-byte opcode, then
//                   its operands
//   Sound_Start 0x0300, Sound_Stop 0x0301; Command_Response 0x0302 {the
//   command's opcode, a status: 0x0000 success, 0x0001 invalid state,
//   0x0002 invalid configuration, 0x0003 invalid length, 0x0004 invalid
//   parameter, 0xFFFF invalid command}; Sound_Completed 0x0303 (the sound,
//   5 to 30 s long, 12 s recommended, has ended). The accessory
//   information opcodes (§3.12.1): Get_Manufacturer_Name 0x0004 (answer
//   0x0804, UTF-8, up to 64 bytes, maybe zero-padded), Get_Model_Name
//   0x0005 (0x0805), Get_Accessory_Category 0x0006 (0x0806).

"use strict";

var SERVICE = "15190001-12f4-c226-88ed-2ac5579f2a85";
var CHARACTERISTIC = "8e0c0001-1d68-fb92-bf61-48377421680e";
var OP = { soundStart: 0x0300, soundStop: 0x0301, commandResponse: 0x0302, soundCompleted: 0x0303,
           getManufacturerName: 0x0004, getModelName: 0x0005, getAccessoryCategory: 0x0006,
           manufacturerName: 0x0804, modelName: 0x0805, accessoryCategory: 0x0806 };
var STATUS = { 0x0000: "success", 0x0001: "invalidState", 0x0002: "invalidConfiguration", 0x0003: "invalidLength",
               0x0004: "invalidParam", 0xffff: "invalidCommand" };

function command(op) { return [op & 0xff, (op >> 8) & 0xff]; }

function text(bytes) {
    var end = bytes.indexOf(0);
    var b = end >= 0 ? bytes.slice(0, end) : bytes;
    try { return decodeURIComponent(b.map(function (c) { return "%" + (c < 16 ? "0" : "") + c.toString(16); }).join("")); }
    catch (e) { return ""; }
}

// One indication: {op: "commandResponse", command, status} |
// {op: "soundCompleted"} | {op: "manufacturerName" | "modelName", text} |
// {op: "accessoryCategory", category} | {op: "other", code}.
function parse(bytes) {
    var b = Array.prototype.slice.call(bytes || []);
    if (b.length < 2) return null;
    var op = b[0] | (b[1] << 8);
    if (op === OP.commandResponse && b.length >= 6)
        return { op: "commandResponse", command: b[2] | (b[3] << 8), status: STATUS[b[4] | (b[5] << 8)] || "reserved" };
    if (op === OP.soundCompleted) return { op: "soundCompleted" };
    if (op === OP.manufacturerName) return { op: "manufacturerName", text: text(b.slice(2)) };
    if (op === OP.modelName) return { op: "modelName", text: text(b.slice(2)) };
    if (op === OP.accessoryCategory) return { op: "accessoryCategory", category: b.length > 2 ? b[2] : -1 };
    return { op: "other", code: op };
}

module.exports = { SERVICE: SERVICE, CHARACTERISTIC: CHARACTERISTIC, OP: OP, command: command, parse: parse };
