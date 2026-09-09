cmake_minimum_required(VERSION 3.24)
if(NOT DEFINED CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type")
endif()
project(SseNativeQt LANGUAGES CXX)

if(NOT WIN32 OR NOT MSVC OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "The native Qt bridge requires Windows x64 and MSVC.")
endif()
if(CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_CONFIGURATION_TYPES Release CACHE STRING "Supported configuration" FORCE)
elseif(CMAKE_BUILD_TYPE AND NOT CMAKE_BUILD_TYPE STREQUAL "Release")
  message(FATAL_ERROR "Only a Release build can bind the supported Qt product runtime.")
else()
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_MSVC_RUNTIME_LIBRARY MultiThreadedDLL)
find_package(Qt6 6.9.2 EXACT REQUIRED COMPONENTS Core Gui Widgets)
find_program(NODE_EXECUTABLE NAMES node REQUIRED)

file(GLOB_RECURSE identity_inputs CONFIGURE_DEPENDS
  "${CMAKE_CURRENT_SOURCE_DIR}/*.cpp" "${CMAKE_CURRENT_SOURCE_DIR}/*.h"
  "${CMAKE_CURRENT_SOURCE_DIR}/scripts/*.mjs")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${identity_inputs}
  "${CMAKE_CURRENT_SOURCE_DIR}/compatibility.json"
  "${CMAKE_CURRENT_SOURCE_DIR}/third_party/nlohmann/json.hpp"
  "${CMAKE_CURRENT_SOURCE_DIR}/third_party/nlohmann/LICENSE.MIT"
  "${CMAKE_CURRENT_SOURCE_DIR}/third_party/nlohmann/UPSTREAM.json"
  "${CMAKE_CURRENT_SOURCE_DIR}/THIRD_PARTY.md"
  "${CMAKE_CURRENT_SOURCE_DIR}/../../profiles/2025/profile.json"
  "${CMAKE_CURRENT_SOURCE_DIR}/../../profiles/2025/page-objects.json")
execute_process(COMMAND "${NODE_EXECUTABLE}"
  "${CMAKE_CURRENT_SOURCE_DIR}/scripts/generate-config.mjs" "${CMAKE_CURRENT_BINARY_DIR}/generated"
  COMMAND_ERROR_IS_FATAL ANY)

add_library(sse-qt-read SHARED bridge.cpp)
add_executable(bridge-load bridge-load.cpp)
foreach(target IN ITEMS sse-qt-read bridge-load)
  target_compile_options(${target} PRIVATE /Zc:__cplusplus /permissive- /EHsc /utf-8 /W4)
  target_compile_definitions(${target} PRIVATE QT_NO_KEYWORDS)
  target_include_directories(${target} PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/generated" "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
  set_target_properties(${target} PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/bin")
endforeach()
target_link_libraries(sse-qt-read PRIVATE Qt6::Core Qt6::Gui Qt6::GuiPrivate Qt6::Widgets Advapi32 User32 Shell32)
target_link_libraries(bridge-load PRIVATE BCrypt User32 Version Ole32 OleAut32 Uiautomationcore)

add_custom_target(native-package ALL
  COMMAND "${NODE_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/scripts/package.mjs"
    "$<TARGET_FILE:bridge-load>" "$<TARGET_FILE:sse-qt-read>"
    "${CMAKE_CURRENT_BINARY_DIR}/generated/bridge-identity.h" "${CMAKE_CURRENT_BINARY_DIR}"
  DEPENDS bridge-load sse-qt-read VERBATIM)

option(SSE_QT_BUILD_TESTS "Build the owned synthetic Qt fixture and enable the native integration test" OFF)
if(SSE_QT_BUILD_TESTS)
  enable_testing()
  add_executable(bridge-stop-test bridge-load.cpp)
  target_compile_options(bridge-stop-test PRIVATE /Zc:__cplusplus /permissive- /EHsc /utf-8 /W4)
  target_compile_definitions(bridge-stop-test PRIVATE QT_NO_KEYWORDS SSE_NATIVE_STOP_TEST)
  target_include_directories(bridge-stop-test PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/generated" "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
  target_link_libraries(bridge-stop-test PRIVATE BCrypt User32 Version Ole32 OleAut32 Uiautomationcore)
  add_executable(bridge-stop-fixture tests/stop-fixture.cpp)
  target_compile_options(bridge-stop-fixture PRIVATE /Zc:__cplusplus /permissive- /EHsc /utf-8 /W4)
  target_include_directories(bridge-stop-fixture PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
  target_link_libraries(bridge-stop-fixture PRIVATE Qt6::Core Qt6::Gui Qt6::Widgets User32)
  set_target_properties(bridge-stop-test bridge-stop-fixture PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/bin")
  add_test(NAME native-desktop-stop COMMAND "${NODE_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../test/native-desktop-stop-integration.mjs"
    "${CMAKE_CURRENT_BINARY_DIR}/native-package.json" "$<TARGET_FILE:bridge-stop-test>"
    "$<TARGET_FILE:bridge-stop-fixture>" "$<TARGET_FILE_DIR:Qt6::Core>")
  set_tests_properties(native-desktop-stop PROPERTIES TIMEOUT 90 RUN_SERIAL TRUE)
  # A separate test executable enables the synthetic launch identity. It is never packaged.
  add_executable(bridge-start-test bridge-load.cpp)
  target_compile_options(bridge-start-test PRIVATE /Zc:__cplusplus /permissive- /EHsc /utf-8 /W4)
  target_compile_definitions(bridge-start-test PRIVATE QT_NO_KEYWORDS SSE_NATIVE_START_TEST)
  target_include_directories(bridge-start-test PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/generated" "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
  target_link_libraries(bridge-start-test PRIVATE BCrypt User32 Version Ole32 OleAut32 Uiautomationcore)
  add_executable(bridge-start-fixture tests/start-fixture.cpp tests/start-fixture.rc)
  target_compile_options(bridge-start-fixture PRIVATE /permissive- /EHsc /utf-8 /W4)
  target_include_directories(bridge-start-fixture PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
  target_link_libraries(bridge-start-fixture PRIVATE User32)
  set_target_properties(bridge-start-test bridge-start-fixture PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/bin")
  add_test(NAME native-desktop-start COMMAND "${NODE_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../test/native-desktop-start-integration.mjs"
    "${CMAKE_CURRENT_BINARY_DIR}/native-package.json" "$<TARGET_FILE:bridge-start-test>" "$<TARGET_FILE:bridge-start-fixture>")
  set_tests_properties(native-desktop-start PROPERTIES TIMEOUT 60 RUN_SERIAL TRUE)
  add_executable(bridge-fixture tests/fixture.cpp)
  set_target_properties(bridge-fixture PROPERTIES AUTOMOC ON RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/bin")
  target_compile_options(bridge-fixture PRIVATE /Zc:__cplusplus /permissive- /EHsc /utf-8 /W4)
  target_compile_definitions(bridge-fixture PRIVATE QT_NO_KEYWORDS)
  target_include_directories(bridge-fixture PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
  target_link_libraries(bridge-fixture PRIVATE Qt6::Core Qt6::Gui Qt6::Widgets User32)
  find_program(POWERSHELL_EXECUTABLE NAMES powershell REQUIRED)
  add_test(NAME native-qt-integration COMMAND "${POWERSHELL_EXECUTABLE}" -NoLogo -NoProfile -NonInteractive
    -ExecutionPolicy Bypass -File "${CMAKE_CURRENT_SOURCE_DIR}/../../test/qt-native-desktop.ps1"
    -PackageConfig "${CMAKE_CURRENT_BINARY_DIR}/native-package.json" -Fixture "$<TARGET_FILE:bridge-fixture>"
    -QtBin "$<TARGET_FILE_DIR:Qt6::Core>" -NodeExecutable "${NODE_EXECUTABLE}")
  set_tests_properties(native-qt-integration PROPERTIES TIMEOUT 60)
endif()
