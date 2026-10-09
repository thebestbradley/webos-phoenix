# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# phoenix-tts, the Assistant's voice: Kitten TTS on ONNX Runtime (src/main.cpp,
# docs/AI-AND-MCP.md Speech). Plain C++17; ONNX Runtime and the sound
# libraries (PulseAudio, ALSA) are loaded at run time, so it builds
# everywhere and says what is missing where it runs.
#
#   phoenix-tts   the program the shell's Speech and the device's
#                 org.webosphoenix.tts run for each answer (phoenix-sim and
#                 the device)
#   tts-test      its tests: numbers and words, the dictionary's phonemes,
#                 Kitten's symbols, the voices file; with the model
#                 (PHOENIX_TTS_MODEL, tools/get-kitten.py) speech, checked
#                 for length and loudness
#
# Standalone: cmake -S services/tts -B build-tts && cmake --build build-tts

cmake_minimum_required(VERSION 3.16)
project(phoenix-tts VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
include(GNUInstallDirs)
find_package(Threads REQUIRED)

add_library(phoenix-tts-core STATIC
    src/phonemes.cpp src/phonemes.h
    src/kitten.cpp src/kitten.h
    src/audio.cpp src/audio.h
    ../common/json.cpp ../common/json.h)
target_include_directories(phoenix-tts-core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src ${CMAKE_CURRENT_SOURCE_DIR}/../common
                                            PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/vendor/onnxruntime)
target_link_libraries(phoenix-tts-core PUBLIC ${CMAKE_DL_LIBS} Threads::Threads)
if(APPLE)
    target_link_libraries(phoenix-tts-core PUBLIC "-framework AudioToolbox" "-framework CoreFoundation")
endif()

add_executable(phoenix-tts src/main.cpp)
target_link_libraries(phoenix-tts PRIVATE phoenix-tts-core)
# Beside phoenix-sim in the build tree, where the simulator looks for it
# (and for its model, in kitten/ there).
set_target_properties(phoenix-tts PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
install(TARGETS phoenix-tts RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})

add_executable(tts-test tests/tts_test.cpp)
target_link_libraries(tts-test PRIVATE phoenix-tts-core)
set_target_properties(tts-test PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
target_compile_definitions(tts-test PRIVATE PHOENIX_TTS_DIR="${CMAKE_BINARY_DIR}/kitten")
