# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

cmake_minimum_required(VERSION 3.16)
project(phoenix-shell VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

option(PHOENIX_BUILD_SIM "Build the desktop simulator" ON)

include(GNUInstallDirs)
set(PHOENIX_DATA_DIR "${CMAKE_INSTALL_DATADIR}/phoenix" CACHE STRING "Install location of QML and assets")

find_package(Qt6 6.4 REQUIRED COMPONENTS Gui Qml Quick)

# Compiled QML modules (Phoenix.Native) are written here, beside the source
# QML the simulator loads, and installed next to the QML on the device.
set(PHOENIX_QML_BUILD_DIR "${CMAKE_CURRENT_BINARY_DIR}/qml")
add_subdirectory(native)

if(PHOENIX_BUILD_SIM)
    # Qt WebEngine runs the web apps (original webOS apps, Settings, ...).
    # Without it the simulator still runs, with placeholder apps only.
    find_package(Qt6 6.4 QUIET COMPONENTS WebEngineQuick)
    # The Terminal's PTY core (and its tests, pty-test), shared with the
    # device's org.webosphoenix.pty service.
    add_subdirectory(../services/pty ${CMAKE_CURRENT_BINARY_DIR}/pty)
    add_executable(phoenix-sim sim/main.cpp sim/rootfs.cpp sim/rootfs.h sim/simsettings.h sim/simpty.cpp sim/simpty.h)
    target_link_libraries(phoenix-sim PRIVATE Qt6::Gui Qt6::Qml Qt6::Quick phoenix-pty-core)
    if(TARGET Qt6::WebEngineQuick)
        target_link_libraries(phoenix-sim PRIVATE Qt6::WebEngineQuick)
        target_compile_definitions(phoenix-sim PRIVATE PHOENIX_HAVE_WEBENGINE)
        message(STATUS "phoenix-sim: web apps enabled (Qt WebEngine found)")
    else()
        message(WARNING "phoenix-sim: Qt WebEngine not found; web apps disabled")
    endif()
    # Run straight from the build tree against the source QML and apps.
    get_filename_component(PHOENIX_REPO_DIR "${CMAKE_CURRENT_SOURCE_DIR}/.." ABSOLUTE)
    target_compile_definitions(phoenix-sim PRIVATE
        PHOENIX_QML_DIR="${CMAKE_CURRENT_SOURCE_DIR}/qml"
        PHOENIX_QML_BUILD_DIR="${PHOENIX_QML_BUILD_DIR}"
        PHOENIX_REPO_DIR="${PHOENIX_REPO_DIR}")
    install(TARGETS phoenix-sim RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
endif()

# Phoenix web apps (React + TypeScript in ../apps): `npm ci` when the lock
# file changes or node_modules is missing, then `npm run build` on every build, writing apps/<name>/dist/
# where phoenix-sim and tools/serve-rootfs.py pick them up. Needs Node.js 20+.
# Off by default for device builds (meta-phoenix sets PHOENIX_BUILD_SIM=OFF).
option(PHOENIX_BUILD_APPS "Build the web apps in apps/ with npm" ${PHOENIX_BUILD_SIM})
if(PHOENIX_BUILD_APPS)
    get_filename_component(PHOENIX_APPS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../apps" ABSOLUTE)
    find_program(PHOENIX_NPM npm)
    if(PHOENIX_NPM AND EXISTS "${PHOENIX_APPS_DIR}/package.json")
        # The stamp is npm's own record of the install, inside node_modules:
        # when node_modules is deleted (or was never installed) it is
        # missing, so `npm ci` runs again, not only when the lock changes.
        set(_npm_stamp "${PHOENIX_APPS_DIR}/node_modules/.package-lock.json")
        add_custom_command(
            OUTPUT "${_npm_stamp}"
            COMMAND "${PHOENIX_NPM}" ci --no-audit --no-fund
            COMMAND "${CMAKE_COMMAND}" -E touch "${_npm_stamp}"
            DEPENDS "${PHOENIX_APPS_DIR}/package.json" "${PHOENIX_APPS_DIR}/package-lock.json"
            WORKING_DIRECTORY "${PHOENIX_APPS_DIR}"
            COMMENT "Installing web app dependencies (npm ci in apps/)"
            USES_TERMINAL VERBATIM)
        add_custom_target(phoenix-apps ALL
            COMMAND "${PHOENIX_NPM}" run build
            DEPENDS "${_npm_stamp}"
            WORKING_DIRECTORY "${PHOENIX_APPS_DIR}"
            COMMENT "Building the web apps (npm run build in apps/)"
            USES_TERMINAL VERBATIM)
        message(STATUS "phoenix-apps: web apps will be built with ${PHOENIX_NPM}")
    else()
        message(WARNING "phoenix-apps: npm not found; the Phoenix web apps (Settings, ...) will not be "
                        "built. Install Node.js 20+ or run `npm ci && npm run build` in apps/ yourself.")
    endif()
endif()

# QML modules and the Open webOS artwork keep their relative layout, so
# Theme.asset() resolves the same way in the tree and on the device.
install(DIRECTORY qml/ DESTINATION ${PHOENIX_DATA_DIR}/qml)
install(DIRECTORY assets/ DESTINATION ${PHOENIX_DATA_DIR}/assets)
# The Prelude stand-in, where the web apps find it too
# (runtime/phoenix-runtime.js aliasPreludeFonts).
install(DIRECTORY assets/fonts/open-sans/ DESTINATION ${CMAKE_INSTALL_DATADIR}/fonts/open-sans
        FILES_MATCHING PATTERN "*.ttf")
