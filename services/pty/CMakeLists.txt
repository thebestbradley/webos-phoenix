# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# org.webosphoenix.pty, the Terminal's PTY service (docs/TERMINAL.md).
#
#   phoenix-pty-core   the PTY core (forkpty, UTF-8 chunks, flow control);
#                      phoenix-sim links it too (shell/sim/simpty.cpp)
#   phoenix-pty        the Luna service, when luna-service2 and GLib are
#                      found (the device; meta-phoenix's phoenix-pty recipe)
#   pty-test           tests of the core and of the service's methods over a
#                      luna-service2 stand-in (../common/ls2stub), when GLib is
#                      found; phoenix-sim's build runs them in CI
#
# Standalone: cmake -S services/pty -B build-pty && cmake --build build-pty

cmake_minimum_required(VERSION 3.16)
project(phoenix-pty VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
include(GNUInstallDirs)
find_package(PkgConfig QUIET)

add_library(phoenix-pty-core STATIC src/ptycore.cpp src/ptycore.h ../common/json.cpp ../common/json.h)
target_include_directories(phoenix-pty-core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src ${CMAKE_CURRENT_SOURCE_DIR}/../common)
set_target_properties(phoenix-pty-core PROPERTIES POSITION_INDEPENDENT_CODE ON)
# forkpty: libutil on glibc before 2.34 and the BSDs; part of libSystem on macOS.
if(NOT APPLE)
    find_library(PHOENIX_LIBUTIL util)
    if(PHOENIX_LIBUTIL)
        target_link_libraries(phoenix-pty-core PUBLIC ${PHOENIX_LIBUTIL})
    endif()
endif()

if(PKG_CONFIG_FOUND)
    pkg_check_modules(PHOENIX_GLIB QUIET IMPORTED_TARGET glib-2.0)
    pkg_check_modules(PHOENIX_LS2 QUIET IMPORTED_TARGET luna-service2)
endif()

if(PHOENIX_LS2_FOUND AND PHOENIX_GLIB_FOUND)
    add_executable(phoenix-pty src/main.cpp src/service.cpp src/service.h)
    target_link_libraries(phoenix-pty PRIVATE phoenix-pty-core PkgConfig::PHOENIX_LS2 PkgConfig::PHOENIX_GLIB)
    install(TARGETS phoenix-pty RUNTIME DESTINATION ${CMAKE_INSTALL_SBINDIR})
    # luna-service2 role, permissions, API groups and the hub's service file.
    set(_ls2 ${CMAKE_INSTALL_DATADIR}/luna-service2)
    install(FILES sysbus/org.webosphoenix.pty.role.json DESTINATION ${_ls2}/roles.d)
    install(FILES sysbus/org.webosphoenix.pty.perm.json DESTINATION ${_ls2}/client-permissions.d)
    install(FILES sysbus/org.webosphoenix.pty.api.json DESTINATION ${_ls2}/api-permissions.d)
    install(FILES sysbus/org.webosphoenix.pty.groups.json DESTINATION ${_ls2}/groups.d)
    install(FILES sysbus/org.webosphoenix.pty.manifest.json DESTINATION ${_ls2}/manifests.d)
    install(FILES sysbus/org.webosphoenix.pty.service DESTINATION ${_ls2}/services.d)
    set(PHOENIX_PTY_SYSTEMD_UNITDIR "lib/systemd/system" CACHE STRING "Where the systemd unit goes (meta-phoenix passes systemd_system_unitdir)")
    install(FILES systemd/phoenix-pty.service DESTINATION ${PHOENIX_PTY_SYSTEMD_UNITDIR})
    message(STATUS "phoenix-pty: building the Luna service")
endif()

option(PHOENIX_PTY_TESTS "Build pty-test (the core and the service over a luna-service2 stand-in)" ON)
if(PHOENIX_GLIB_FOUND AND PHOENIX_PTY_TESTS)
    add_executable(pty-test tests/pty_test.cpp src/service.cpp src/service.h
                   ../common/ls2stub/ls2stub.cpp ../common/ls2stub/luna-service2/lunaservice.h)
    target_include_directories(pty-test PRIVATE ../common/ls2stub)
    target_link_libraries(pty-test PRIVATE phoenix-pty-core PkgConfig::PHOENIX_GLIB)
endif()
