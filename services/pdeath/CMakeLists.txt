# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# phoenix-pdeath: runs a program that ends when its parent dies (pdeath.c).
# The Assistant service starts llama-server through it on a device
# (meta-phoenix's phoenix-pdeath recipe); phoenix-sim's build has it too, for
# the tests (apps/assistant/service/node-device.test.ts). Linux only.
#
# Standalone: cmake -S services/pdeath -B build-pdeath && cmake --build build-pdeath

cmake_minimum_required(VERSION 3.16)
project(phoenix-pdeath VERSION 0.1.0 LANGUAGES C)
include(GNUInstallDirs)

add_executable(phoenix-pdeath pdeath.c)
install(TARGETS phoenix-pdeath RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
