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

if(PHOENIX_BUILD_SIM)
    find_package(Qt6 6.4 REQUIRED COMPONENTS Gui Qml Quick)
    add_executable(phoenix-sim sim/main.cpp)
    target_link_libraries(phoenix-sim PRIVATE Qt6::Gui Qt6::Qml Qt6::Quick)
    # Run straight from the build tree against the source QML.
    target_compile_definitions(phoenix-sim PRIVATE PHOENIX_QML_DIR="${CMAKE_CURRENT_SOURCE_DIR}/qml")
    install(TARGETS phoenix-sim RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
endif()

# QML modules and the Open webOS artwork keep their relative layout, so
# Theme.asset() resolves the same way in the tree and on the device.
install(DIRECTORY qml/ DESTINATION ${PHOENIX_DATA_DIR}/qml)
install(DIRECTORY assets/ DESTINATION ${PHOENIX_DATA_DIR}/assets)
