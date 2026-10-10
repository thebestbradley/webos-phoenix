# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# phoenix-keyboard: the Phoenix keyboard as the device's input method
# (GAPS V5), a Maliit input method plugin for maliit-server
# (maliit-framework-webos), installed beside webOS OSE's own keyboard in
# /usr/lib/maliit/plugins as libphoenix-keyboard.so. It shows the shell's
# own keyboard QML (Phoenix/Keyboard/MaliitKeyboard.qml around
# Phoenix/Shell/VirtualKeyboard.qml); docs/HARDWARE.md, "The keyboard as
# the input method".
#
# Maliit's plugin API comes from maliit-framework-webos's headers and
# libmaliit-plugins (the device: its recipe installs both; meta-phoenix's
# phoenix-keyboard recipe builds this against them). Where they are not
# installed (the simulator's computers, CI) the plugin is built against a
# stand-in for the part of the API it uses (maliit-stub/), with its tests:
#
#   phoenix-keyboard          the plugin (libphoenix-keyboard.so)
#   keyboard-test             the plugin over a fake Maliit host, loading the
#                             shell's QML (stand-in builds only)
#   phoenix-keyboard-realapi  with -DPHOENIX_MALIIT_SOURCE_DIR=<a checkout of
#                             webosose/maliit-framework-webos>: the plugin's
#                             sources compiled against the real headers too,
#                             so the stand-in cannot drift from them (every
#                             reimplemented method is marked override)
#
# Standalone: cmake -S services/keyboard -B build-keyboard -DCMAKE_PREFIX_PATH=<Qt>
#             && cmake --build build-keyboard

cmake_minimum_required(VERSION 3.16)
project(phoenix-keyboard VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
include(GNUInstallDirs)

if(NOT TARGET Qt6::Quick)
    find_package(Qt6 6.8 REQUIRED COMPONENTS Gui Qml Quick)
endif()

get_filename_component(PHOENIX_REPO_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
set(PHOENIX_KEYBOARD_QML_DIR "${CMAKE_INSTALL_FULL_DATADIR}/phoenix/qml" CACHE STRING
    "Where the shell's QML is on the device (phoenix-shell installs it)")
set(PHOENIX_KEYBOARD_STATE_DIR "/var/lib/phoenix/keyboard" CACHE STRING
    "Where the keyboard keeps what it learned on the device")
set(PHOENIX_MALIIT_PLUGINS_DIR "${CMAKE_INSTALL_LIBDIR}/maliit/plugins" CACHE STRING
    "maliit-server's plugin directory (maliit-framework-webos.bb MALIIT_PLUGINS_DIR)")

# Maliit's headers and library: pkg-config's maliit-plugins
# (maliit-framework-webos src/maliit-plugins.pc.in), else by name.
option(PHOENIX_KEYBOARD_STUB "Build against the stand-in Maliit API even where the real one is installed" OFF)
find_package(PkgConfig QUIET)
if(PKG_CONFIG_FOUND AND NOT PHOENIX_KEYBOARD_STUB)
    pkg_check_modules(PHOENIX_MALIIT QUIET IMPORTED_TARGET maliit-plugins)
endif()
if(NOT PHOENIX_MALIIT_FOUND AND NOT PHOENIX_KEYBOARD_STUB)
    find_path(PHOENIX_MALIIT_INCLUDE_DIR maliit/plugins/inputmethodplugin.h)
    find_library(PHOENIX_MALIIT_LIBRARY maliit-plugins)
endif()

set(_sources phoenixkeyboardplugin.cpp phoenixkeyboardplugin.h phoenixinputmethod.cpp phoenixinputmethod.h
             ${PHOENIX_REPO_DIR}/shell/native/keytext.h)
add_library(phoenix-keyboard MODULE ${_sources})
target_include_directories(phoenix-keyboard PRIVATE ${PHOENIX_REPO_DIR}/shell/native)
target_link_libraries(phoenix-keyboard PRIVATE Qt6::Gui Qt6::Qml Qt6::Quick)
target_compile_definitions(phoenix-keyboard PRIVATE
    PHOENIX_KEYBOARD_QML_DIR="${PHOENIX_KEYBOARD_QML_DIR}"
    PHOENIX_KEYBOARD_STATE_DIR="${PHOENIX_KEYBOARD_STATE_DIR}")
# maliit-server loads every file in its plugin directory by its name
# (mimpluginmanager.cpp:95-113): libphoenix-keyboard.so, no version links.
set_target_properties(phoenix-keyboard PROPERTIES PREFIX "lib" OUTPUT_NAME "phoenix-keyboard")

if(PHOENIX_MALIIT_FOUND)
    target_link_libraries(phoenix-keyboard PRIVATE PkgConfig::PHOENIX_MALIIT)
    set(_maliit "maliit-framework-webos (pkg-config maliit-plugins)")
elseif(PHOENIX_MALIIT_INCLUDE_DIR AND PHOENIX_MALIIT_LIBRARY)
    target_include_directories(phoenix-keyboard PRIVATE ${PHOENIX_MALIIT_INCLUDE_DIR})
    target_link_libraries(phoenix-keyboard PRIVATE ${PHOENIX_MALIIT_LIBRARY})
    set(_maliit "maliit-framework-webos (${PHOENIX_MALIIT_LIBRARY})")
else()
    # The stand-in: the API's declarations, and the base class's defaults.
    add_library(phoenix-maliit-stub STATIC maliit-stub/maliitstub.cpp
                maliit-stub/maliit/namespace.h maliit-stub/maliit/plugins/inputmethodplugin.h
                maliit-stub/maliit/plugins/abstractinputmethod.h maliit-stub/maliit/plugins/abstractinputmethodhost.h)
    set_target_properties(phoenix-maliit-stub PROPERTIES POSITION_INDEPENDENT_CODE ON)
    target_include_directories(phoenix-maliit-stub PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/maliit-stub)
    target_link_libraries(phoenix-maliit-stub PUBLIC Qt6::Gui)
    target_link_libraries(phoenix-keyboard PRIVATE phoenix-maliit-stub)
    set(PHOENIX_KEYBOARD_STUB ON)
    set(_maliit "the stand-in API (maliit-stub; not for a device)")
endif()
message(STATUS "phoenix-keyboard: the Maliit plugin, against ${_maliit}")

install(TARGETS phoenix-keyboard LIBRARY DESTINATION ${PHOENIX_MALIIT_PLUGINS_DIR})
# What the keyboard may call on the bus, as maliit-server (MaliitKeyboard.qml).
install(FILES sysbus/com.webos.service.ime.phoenix.perm.json
        DESTINATION ${CMAKE_INSTALL_DATADIR}/luna-service2/client-permissions.d)

# The real API's check: the plugin compiled against maliit-framework-webos's
# own headers (a source checkout; nothing is linked).
set(PHOENIX_MALIIT_SOURCE_DIR "" CACHE PATH "A webosose/maliit-framework-webos checkout, to check the plugin against its headers")
if(PHOENIX_MALIIT_SOURCE_DIR)
    if(NOT EXISTS "${PHOENIX_MALIIT_SOURCE_DIR}/src/maliit/plugins/inputmethodplugin.h")
        message(FATAL_ERROR "PHOENIX_MALIIT_SOURCE_DIR: no src/maliit/plugins/inputmethodplugin.h in ${PHOENIX_MALIIT_SOURCE_DIR}")
    endif()
    add_library(phoenix-keyboard-realapi OBJECT ${_sources})
    target_include_directories(phoenix-keyboard-realapi PRIVATE ${PHOENIX_REPO_DIR}/shell/native
                               ${PHOENIX_MALIIT_SOURCE_DIR}/common ${PHOENIX_MALIIT_SOURCE_DIR}/src)
    target_link_libraries(phoenix-keyboard-realapi PRIVATE Qt6::Gui Qt6::Qml Qt6::Quick)
    message(STATUS "phoenix-keyboard: checking the plugin against ${PHOENIX_MALIIT_SOURCE_DIR}'s headers")
endif()

option(PHOENIX_KEYBOARD_TESTS "Build keyboard-test (the plugin over a fake Maliit host)" ON)
if(PHOENIX_KEYBOARD_STUB AND PHOENIX_KEYBOARD_TESTS)
    find_package(Qt6 6.8 QUIET COMPONENTS Test)
    if(TARGET Qt6::Test)
        add_executable(keyboard-test tests/keyboard_test.cpp ${_sources})
        target_include_directories(keyboard-test PRIVATE ${PHOENIX_REPO_DIR}/shell/native ${CMAKE_CURRENT_SOURCE_DIR})
        target_link_libraries(keyboard-test PRIVATE phoenix-maliit-stub Qt6::Gui Qt6::Qml Qt6::Quick Qt6::Test)
        # The shell's QML from the tree; Phoenix.Native from the build
        # (PHOENIX_QML_BUILD_DIR when built with the shell) and the device's
        # bus modules faked (shell/tests-device/fakes).
        if(NOT PHOENIX_QML_BUILD_DIR)
            set(PHOENIX_QML_BUILD_DIR "${PHOENIX_REPO_DIR}/build/qml")
        endif()
        target_compile_definitions(keyboard-test PRIVATE
            PHOENIX_KEYBOARD_QML_DIR="${PHOENIX_REPO_DIR}/shell/qml"
            PHOENIX_KEYBOARD_STATE_DIR="/nonexistent"
            PHOENIX_TEST_IMPORTS="${PHOENIX_QML_BUILD_DIR}:${PHOENIX_REPO_DIR}/shell/tests-device/fakes"
            PHOENIX_KEYBOARD_PLUGIN="$<TARGET_FILE:phoenix-keyboard>")
        add_dependencies(keyboard-test phoenix-keyboard)
        if(TARGET phoenix-native)
            add_dependencies(keyboard-test phoenix-native)
        endif()
    endif()
endif()
