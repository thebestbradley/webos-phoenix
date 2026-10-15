# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# phoenix-l2cap: a Bluetooth L2CAP channel on standard input and output
# (l2cap.c), for the accessories service's AirPods control channel
# (docs/ACCESSORIES.md). meta-phoenix's phoenix-l2cap recipe builds it for
# a device; Linux only.
#
# Standalone: cmake -S services/l2cap -B build-l2cap && cmake --build build-l2cap

cmake_minimum_required(VERSION 3.16)
project(phoenix-l2cap VERSION 0.1.0 LANGUAGES C)
include(GNUInstallDirs)

add_executable(phoenix-l2cap l2cap.c)
target_compile_options(phoenix-l2cap PRIVATE -Wall -Wextra)
install(TARGETS phoenix-l2cap RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
