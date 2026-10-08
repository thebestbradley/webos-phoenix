# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# phoenix-wakeword, the assistant's wake word spotter (src/wakeword.h,
# docs/AI-AND-MCP.md Voice). Plain C++17; libvosk is loaded at run time.
#
#   phoenix-wakeword   the program the shell's Dictation runs while it
#                      listens for "Hey Phoenix" (phoenix-sim and the device)
#   wakeword-test      its tests: the gate, the grammars and results without
#                      a model; with one (PHOENIX_WAKE_MODEL and
#                      PHOENIX_VOSK_LIBRARY, tools/get-wakeword.py) the
#                      recordings in tests/data
#
# Standalone: cmake -S services/wakeword -B build-wakeword && cmake --build build-wakeword

cmake_minimum_required(VERSION 3.16)
project(phoenix-wakeword VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
include(GNUInstallDirs)

add_library(phoenix-wakeword-core STATIC src/wakeword.cpp src/wakeword.h ../common/json.cpp ../common/json.h)
target_include_directories(phoenix-wakeword-core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src ${CMAKE_CURRENT_SOURCE_DIR}/../common)
target_link_libraries(phoenix-wakeword-core PUBLIC ${CMAKE_DL_LIBS})

add_executable(phoenix-wakeword src/main.cpp)
target_link_libraries(phoenix-wakeword PRIVATE phoenix-wakeword-core)
# Beside phoenix-sim in the build tree, where the simulator looks for it.
set_target_properties(phoenix-wakeword PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
install(TARGETS phoenix-wakeword RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})

add_executable(wakeword-test tests/wakeword_test.cpp)
target_link_libraries(wakeword-test PRIVATE phoenix-wakeword-core)
set_target_properties(wakeword-test PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
target_compile_definitions(wakeword-test PRIVATE PHOENIX_WAKE_DATA="${CMAKE_CURRENT_SOURCE_DIR}/tests/data"
                                                PHOENIX_WAKE_DIR="${CMAKE_BINARY_DIR}/wakeword")
