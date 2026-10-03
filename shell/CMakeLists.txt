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
    add_executable(phoenix-sim sim/main.cpp sim/rootfs.cpp sim/rootfs.h sim/simsettings.h sim/simprocess.h sim/simpty.cpp sim/simpty.h sim/siminstaller.cpp sim/siminstaller.h sim/simsnapshots.cpp sim/simsnapshots.h)
    target_link_libraries(phoenix-sim PRIVATE Qt6::Gui Qt6::Qml Qt6::Quick phoenix-pty-core)
    if(TARGET Qt6::WebEngineQuick)
        # Network: the pages' HTTP proxy (RootfsSchemeHandler, /__phoenix/proxy).
        find_package(Qt6 6.4 REQUIRED COMPONENTS Network)
        target_link_libraries(phoenix-sim PRIVATE Qt6::WebEngineQuick Qt6::Network)
        target_compile_definitions(phoenix-sim PRIVATE PHOENIX_HAVE_WEBENGINE)
        message(STATUS "phoenix-sim: web apps enabled (Qt WebEngine found)")
    else()
        message(WARNING "phoenix-sim: Qt WebEngine not found; web apps disabled")
    endif()
    # Run straight from the build tree against the source QML and apps.
    get_filename_component(PHOENIX_REPO_DIR "${CMAKE_CURRENT_SOURCE_DIR}/.." ABSOLUTE)
    # The keyboard's dictation, without a microphone (CI: build/dictation-test).
    add_executable(dictation-test native/dictation_test.cpp native/dictation.cpp native/dictation.h)
    target_link_libraries(dictation-test PRIVATE Qt6::Core Qt6::Qml)
    # phoenix-sim's installed apps, without a window (CI: build/siminstaller-test).
    add_executable(siminstaller-test sim/siminstaller_test.cpp sim/rootfs.cpp sim/rootfs.h sim/siminstaller.cpp sim/siminstaller.h)
    target_link_libraries(siminstaller-test PRIVATE Qt6::Core)
    target_compile_definitions(siminstaller-test PRIVATE PHOENIX_REPO_DIR="${PHOENIX_REPO_DIR}")
    target_compile_definitions(phoenix-sim PRIVATE
        PHOENIX_QML_DIR="${CMAKE_CURRENT_SOURCE_DIR}/qml"
        PHOENIX_QML_BUILD_DIR="${PHOENIX_QML_BUILD_DIR}"
        PHOENIX_REPO_DIR="${PHOENIX_REPO_DIR}")
    install(TARGETS phoenix-sim RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
endif()

# Phoenix web apps (React + TypeScript in ../apps): `npm ci` when the lock
# file changes or node_modules is missing, then `npm run build` on every build, writing apps/<name>/dist/
# where phoenix-sim and tools/serve-rootfs.py pick them up. Needs Node.js 22
# or 24 (LTS); 20.19+ also works.
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

        # The Enact demos are npm projects of their own (Enact's CLI needs
        # the app's packages in its own node_modules; apps/enact-notes-*/
        # README.md). They take @phoenix/notes-core as built by phoenix-apps
        # (shared/notes-core/lib), copied in by their `npm ci`, which runs
        # again when the lock or notes-core's sources change.
        #
        # Enact's CLI only runs on Node's supported lines (20.12+, 22, 24+),
        # not on odd-numbered releases such as 23. With another Node the
        # demos are left out, with a warning, rather than failing the build.
        set(_enact_node_ok FALSE)
        find_program(PHOENIX_NODE node)
        if(PHOENIX_NODE)
            execute_process(COMMAND "${PHOENIX_NODE}" --version
                            OUTPUT_VARIABLE _node_version OUTPUT_STRIP_TRAILING_WHITESPACE)
            if(_node_version MATCHES "^v([0-9]+)\\.([0-9]+)")
                set(_node_major "${CMAKE_MATCH_1}")
                set(_node_minor "${CMAKE_MATCH_2}")
                if((_node_major EQUAL 20 AND _node_minor GREATER_EQUAL 12) OR _node_major EQUAL 22
                   OR _node_major GREATER_EQUAL 24)
                    set(_enact_node_ok TRUE)
                endif()
            endif()
        endif()
        set(_enact_apps enact-notes-limestone enact-notes-agate)
        if(NOT _enact_node_ok)
            set(_enact_apps "")
            message(WARNING "phoenix-apps: Node.js ${_node_version} is not one Enact's CLI supports "
                            "(20.12+, 22 or 24+), so the Enact demos (apps/enact-notes-*) are not built. "
                            "Install Node.js 22 or 24 LTS (macOS: `brew install node@22`), then run cmake again.")
        endif()
        file(GLOB _notes_core_src CONFIGURE_DEPENDS "${PHOENIX_APPS_DIR}/shared/notes-core/src/*.ts")
        foreach(_enact_app IN LISTS _enact_apps)
            set(_dir "${PHOENIX_APPS_DIR}/${_enact_app}")
            set(_stamp "${_dir}/node_modules/.package-lock.json")
            add_custom_command(
                OUTPUT "${_stamp}"
                COMMAND "${PHOENIX_NPM}" ci --no-audit --no-fund
                COMMAND "${CMAKE_COMMAND}" -E touch "${_stamp}"
                DEPENDS "${_dir}/package.json" "${_dir}/package-lock.json" ${_notes_core_src}
                WORKING_DIRECTORY "${_dir}"
                COMMENT "Installing ${_enact_app} dependencies (npm ci)"
                USES_TERMINAL VERBATIM)
            add_custom_target(phoenix-${_enact_app} ALL
                COMMAND "${PHOENIX_NPM}" run build
                DEPENDS "${_stamp}"
                WORKING_DIRECTORY "${_dir}"
                COMMENT "Building ${_enact_app} (enact pack)"
                USES_TERMINAL VERBATIM)
            # notes-core's lib/ must be built before `npm ci` copies it in.
            add_dependencies(phoenix-${_enact_app} phoenix-apps)
        endforeach()
    else()
        message(WARNING "phoenix-apps: npm not found; the Phoenix web apps (Settings, ...) will not be "
                        "built. Install Node.js 20+ or run `npm ci && npm run build` in apps/ yourself.")
    endif()

    # The Flutter demo (apps/flutter-notes) is a Flutter web build, made
    # when the Flutter SDK is installed (optional; its README.md) and again
    # when its sources change. The Ionic demo is one of the web apps above.
    find_program(PHOENIX_FLUTTER flutter)
    if(PHOENIX_FLUTTER)
        set(_flutter_dir "${PHOENIX_APPS_DIR}/flutter-notes")
        file(GLOB_RECURSE _flutter_src CONFIGURE_DEPENDS
             "${_flutter_dir}/lib/*.dart" "${_flutter_dir}/web/*" "${_flutter_dir}/fonts/*.ttf")
        add_custom_command(
            OUTPUT "${_flutter_dir}/dist/main.dart.js"
            COMMAND "${CMAKE_COMMAND}" -E env "FLUTTER=${PHOENIX_FLUTTER}" sh tool/build.sh
            DEPENDS ${_flutter_src} "${_flutter_dir}/pubspec.yaml" "${_flutter_dir}/pubspec.lock"
                    "${_flutter_dir}/tool/build.sh"
            WORKING_DIRECTORY "${_flutter_dir}"
            COMMENT "Building flutter-notes (flutter build web)"
            USES_TERMINAL VERBATIM)
        add_custom_target(phoenix-flutter-notes ALL DEPENDS "${_flutter_dir}/dist/main.dart.js")
        message(STATUS "phoenix-apps: the Flutter demo will be built with ${PHOENIX_FLUTTER}")
    else()
        message(STATUS "phoenix-apps: Flutter not found, so the Flutter demo (apps/flutter-notes) is not "
                       "built; the rest is. To build it, install Flutter (apps/flutter-notes/README.md).")
    endif()
endif()

# QML modules and the Open webOS artwork keep their relative layout, so
# Theme.asset() resolves the same way in the tree and on the device.
install(DIRECTORY qml/ DESTINATION ${PHOENIX_DATA_DIR}/qml)
install(DIRECTORY assets/ DESTINATION ${PHOENIX_DATA_DIR}/assets
        PATTERN "noto-color-emoji" EXCLUDE)
# The Prelude stand-in, where the web apps find it too
# (runtime/phoenix-runtime.js aliasPreludeFonts).
install(DIRECTORY assets/fonts/open-sans/ DESTINATION ${CMAKE_INSTALL_DATADIR}/fonts/open-sans
        FILES_MATCHING PATTERN "*.ttf")
# The colour emoji font (10 MB) once, in the system's fonts where the web
# runtime finds it through fontconfig; the shell's assets link to it.
install(DIRECTORY assets/fonts/noto-color-emoji/ DESTINATION ${CMAKE_INSTALL_DATADIR}/fonts/noto-color-emoji
        PATTERN "*.conf" EXCLUDE)
# ...and after the text fonts in fontconfig's order.
install(FILES assets/fonts/noto-color-emoji/50-phoenix-emoji.conf DESTINATION ${CMAKE_INSTALL_SYSCONFDIR}/fonts/conf.d)
install(CODE "file(CREATE_LINK ../../../fonts/noto-color-emoji
    \"\$ENV{DESTDIR}\${CMAKE_INSTALL_PREFIX}/${PHOENIX_DATA_DIR}/assets/fonts/noto-color-emoji\" SYMBOLIC)")
