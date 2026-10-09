# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# llama.cpp's llama-server, the runner of the Assistant's on-device model
# (docs/AI-AND-MCP.md, "On-device models"; apps/assistant/service/lib/
# node-device.js llamaServer finds it on the PATH and starts it on
# 127.0.0.1 with the model the user chose, stopping it when idle).
# packagegroup-phoenix-assistant installs llama-cpp-server.
#
# The models are not in the image: Settings > Assistant downloads one
# (Qwen2.5 0.5B / 1.5B, Qwen3 4B; 0.5 to 2.5 GB, Apache-2.0) into
# /media/internal/.phoenix/models, offering only what fits the device's
# memory. Without llama-server Settings says it is not installed.
#
# License: llama.cpp and ggml are MIT (LICENSE); no other code is built in
# (no OpenSSL: the server listens on localhost only; no web UI: the
# prebuilt one would be downloaded while building).
#
# Built statically (ggml inside the program), like whisper-cpp, so the two
# recipes never install the same libggml files. Still to check on a
# device: the CPU backend's flags per MACHINE (GGML_NATIVE stays off when
# cross-compiling), the Vulkan or OpenCL backends on GPUs, and speed
# (docs/AI-AND-MCP.md, bench-llm).

SUMMARY = "llama.cpp: LLM inference in C/C++ (llama-server)"
HOMEPAGE = "https://github.com/ggml-org/llama.cpp"
SECTION = "libs"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://LICENSE;md5=223b26b3c1143120c87e2b13111d3e99"

# Release b11239 (2026-09-28), the build scripts/linux-setup.sh makes.
SRC_URI = "git://github.com/ggml-org/llama.cpp.git;protocol=https;branch=master"
SRCREV = "66e665c4276ee46f3ec9872dd7e5a496842bc44f"
LLAMA_BUILD_NUMBER = "11239"

S = "${WORKDIR}/git"

inherit cmake

EXTRA_OECMAKE = " \
    -DBUILD_SHARED_LIBS=OFF \
    -DGGML_NATIVE=OFF \
    -DLLAMA_BUILD_TESTS=OFF \
    -DLLAMA_BUILD_EXAMPLES=OFF \
    -DLLAMA_BUILD_TOOLS=ON \
    -DLLAMA_BUILD_SERVER=ON \
    -DLLAMA_BUILD_APP=OFF \
    -DLLAMA_BUILD_UI=OFF \
    -DLLAMA_USE_PREBUILT_UI=OFF \
    -DLLAMA_OPENSSL=OFF \
    -DLLAMA_BUILD_NUMBER=${LLAMA_BUILD_NUMBER} \
    -DLLAMA_BUILD_COMMIT=${@d.getVar('SRCREV')[:7]} \
"

# Only the server (and its tools' build stays out of the image).
OECMAKE_TARGET_COMPILE = "llama-server"
do_install() {
    install -d ${D}${bindir}
    install -m 0755 ${B}/bin/llama-server ${D}${bindir}/llama-server
}

PACKAGES =+ "${PN}-server"
FILES:${PN}-server = "${bindir}/llama-server"
ALLOW_EMPTY:${PN} = "1"
