# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# phoenix-devices: LunaSysMgr's device services (com.palm.display,
# com.palm.keys, com.palm.vibrate, com.palm.ambientLightSensor), which
# webOS OSE does not have, over the kernel's backlight, evdev, force
# feedback / LED vibrator and IIO light sensor (docs/HARDWARE.md).
#
#   phoenix-devices-core  the logic and the hardware access (no bus)
#   phoenix-devices       the Luna service, when luna-service2 and GLib are
#                         found (the device; meta-phoenix's phoenix-devices recipe)
#   devices-test          tests of the logic, the hardware against a fake
#                         sysfs, and the service's methods over the
#                         luna-service2 stand-in (../common/ls2stub), when
#                         GLib is found; phoenix-sim's build runs them in CI
#
# Standalone: cmake -S services/devices -B build-devices && cmake --build build-devices

cmake_minimum_required(VERSION 3.16)
project(phoenix-devices VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
include(GNUInstallDirs)
find_package(PkgConfig QUIET)

add_library(phoenix-devices-core STATIC src/devicecore.cpp src/devicecore.h src/hardware.cpp src/hardware.h
            ../common/json.cpp ../common/json.h)
target_include_directories(phoenix-devices-core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src ${CMAKE_CURRENT_SOURCE_DIR}/../common)

if(PKG_CONFIG_FOUND)
    pkg_check_modules(PHOENIX_GLIB QUIET IMPORTED_TARGET glib-2.0)
    pkg_check_modules(PHOENIX_LS2 QUIET IMPORTED_TARGET luna-service2)
endif()

if(PHOENIX_LS2_FOUND AND PHOENIX_GLIB_FOUND)
    add_executable(phoenix-devices src/main.cpp src/service.cpp src/service.h)
    target_link_libraries(phoenix-devices PRIVATE phoenix-devices-core PkgConfig::PHOENIX_LS2 PkgConfig::PHOENIX_GLIB)
    install(TARGETS phoenix-devices RUNTIME DESTINATION ${CMAKE_INSTALL_SBINDIR})
    set(_ls2 ${CMAKE_INSTALL_DATADIR}/luna-service2)
    install(FILES sysbus/org.webosphoenix.devices.role.json DESTINATION ${_ls2}/roles.d)
    # Its own, and the shell's (luna-surfacemanager calls com.palm.display/phoenix).
    install(FILES sysbus/org.webosphoenix.devices.perm.json sysbus/org.webosphoenix.devices.shell.perm.json
            DESTINATION ${_ls2}/client-permissions.d)
    install(FILES sysbus/org.webosphoenix.devices.api.json DESTINATION ${_ls2}/api-permissions.d)
    install(FILES sysbus/org.webosphoenix.devices.groups.json DESTINATION ${_ls2}/groups.d)
    install(FILES sysbus/org.webosphoenix.devices.manifest.json DESTINATION ${_ls2}/manifests.d)
    install(FILES sysbus/org.webosphoenix.devices.service DESTINATION ${_ls2}/services.d)
    set(PHOENIX_DEVICES_SYSTEMD_UNITDIR "lib/systemd/system" CACHE STRING "Where the systemd unit goes (meta-phoenix passes systemd_system_unitdir)")
    install(FILES systemd/phoenix-devices.service DESTINATION ${PHOENIX_DEVICES_SYSTEMD_UNITDIR})
    message(STATUS "phoenix-devices: building the Luna service")
endif()

option(PHOENIX_DEVICES_TESTS "Build devices-test (the logic, a fake sysfs, the service over a luna-service2 stand-in)" ON)
if(PHOENIX_GLIB_FOUND AND PHOENIX_DEVICES_TESTS)
    add_executable(devices-test tests/devices_test.cpp src/service.cpp src/service.h
                   ../common/ls2stub/ls2stub.cpp ../common/ls2stub/luna-service2/lunaservice.h)
    target_include_directories(devices-test PRIVATE ../common/ls2stub)
    target_link_libraries(devices-test PRIVATE phoenix-devices-core PkgConfig::PHOENIX_GLIB)
endif()
