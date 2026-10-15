# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Phoenix.Native: the few things the shell needs that QML cannot do. Built
# for the simulator and the device; needs only Qt Quick.

# QTP0001: Qt 6.5's resource prefix (:/qt/qml/). The module has C++ types
# only, no QML files, and is imported from the build tree, so nothing moves.
qt_policy(SET QTP0001 NEW)
qt_add_qml_module(phoenix-native
    URI Phoenix.Native
    VERSION 1.0
    PLUGIN_TARGET phoenix-native
    OUTPUT_DIRECTORY ${PHOENIX_QML_BUILD_DIR}/Phoenix/Native
    SOURCES keyinjector.h keyinjector.cpp keytext.h fonttools.h fonttools.cpp hidpi.h hidpi.cpp deviceconfig.h deviceconfig.cpp
            childprocess.h dictation.h dictation.cpp imagetools.h imagetools.cpp systemkeys.h systemkeys.cpp
            useractivity.h useractivity.cpp memorymonitor.h memorymonitor.cpp
            keyboardaccess.h keyboardaccess.cpp cornermask.h cornermask.cpp
            localmodels.h localmodels.cpp speech.h speech.cpp
            renderinfo.h renderinfo.cpp
)
# Network: the Assistant's model downloads and llama-server's health check.
find_package(Qt6 REQUIRED COMPONENTS Network)
# RenderInfo asks the scene graph's QRhi (rhi/qrhi.h) which device draws.
# QRhi's headers come with Qt's private ones, a package of their own from
# Qt 6.9 (6.8 makes the target with Qt6::Gui).
if(Qt6_VERSION VERSION_GREATER_EQUAL 6.9)
    find_package(Qt6 REQUIRED COMPONENTS GuiPrivate)
endif()
target_link_libraries(phoenix-native PRIVATE Qt6::Quick Qt6::Gui Qt6::GuiPrivate Qt6::Network)
# Dictation records with Qt Multimedia; without it the keyboard has no microphone.
find_package(Qt6 QUIET COMPONENTS Multimedia)
if(TARGET Qt6::Multimedia)
    target_link_libraries(phoenix-native PRIVATE Qt6::Multimedia)
    target_compile_definitions(phoenix-native PRIVATE PHOENIX_HAVE_MULTIMEDIA)
    message(STATUS "Phoenix.Native: dictation enabled (Qt Multimedia found)")
else()
    message(STATUS "Phoenix.Native: Qt Multimedia not found; no dictation")
endif()

# A plugin library, so on the device it goes with Qt's own QML modules
# (meta-phoenix passes QT6_INSTALL_QMLDIR), which are on every import path.
set(PHOENIX_NATIVE_QML_DIR "${PHOENIX_DATA_DIR}/qml" CACHE STRING "Install location of compiled QML modules")
install(TARGETS phoenix-native
    LIBRARY DESTINATION ${PHOENIX_NATIVE_QML_DIR}/Phoenix/Native)
install(FILES
    ${PHOENIX_QML_BUILD_DIR}/Phoenix/Native/qmldir
    ${PHOENIX_QML_BUILD_DIR}/Phoenix/Native/phoenix-native.qmltypes
    DESTINATION ${PHOENIX_NATIVE_QML_DIR}/Phoenix/Native)
