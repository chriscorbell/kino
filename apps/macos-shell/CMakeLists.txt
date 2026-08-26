cmake_minimum_required(VERSION 3.25)

project(Kino VERSION 0.1.0 LANGUAGES CXX OBJCXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_ARCHITECTURES arm64 CACHE STRING "macOS build architecture")
set(CMAKE_OSX_DEPLOYMENT_TARGET 26.0 CACHE STRING "Minimum macOS version")
set(CMAKE_AUTOMOC ON)

find_package(PkgConfig REQUIRED)
find_package(
  Qt6 6.8
  REQUIRED COMPONENTS
    Core
    Concurrent
    Gui
    Qml
    Quick
    QuickControls2
    WebChannel
    WebEngineQuick
)
pkg_check_modules(MPV REQUIRED IMPORTED_TARGET mpv)
find_library(FOUNDATION_FRAMEWORK Foundation REQUIRED)
find_library(IOKIT_FRAMEWORK IOKit REQUIRED)
find_library(MEDIAPLAYER_FRAMEWORK MediaPlayer REQUIRED)
find_library(SECURITY_FRAMEWORK Security REQUIRED)

qt_standard_project_setup(REQUIRES 6.8)

set(KINO_ICON ${CMAKE_CURRENT_SOURCE_DIR}/resources/Kino.icns)
set_source_files_properties(${KINO_ICON} PROPERTIES MACOSX_PACKAGE_LOCATION Resources)

qt_add_executable(
  Kino
  MACOSX_BUNDLE
  ${KINO_ICON}
  src/logging.cpp
  src/main.cpp
  src/mpvitem.cpp
  src/nowplaying.mm
  src/playbackprobe.cpp
  src/powerguard.cpp
  src/securestore.cpp
)

qt_add_qml_module(
  Kino
  URI KinoShell
  VERSION 1.0
  QML_FILES qml/Main.qml qml/Probe.qml
  SOURCES
    src/mpvitem.h
    src/nowplaying.h
    src/securestore.h
)

target_include_directories(Kino PRIVATE src)
target_link_libraries(
  Kino
  PRIVATE
    PkgConfig::MPV
    ${FOUNDATION_FRAMEWORK}
    ${IOKIT_FRAMEWORK}
    ${MEDIAPLAYER_FRAMEWORK}
    ${SECURITY_FRAMEWORK}
    Qt6::Concurrent
    Qt6::Core
    Qt6::Gui
    Qt6::Qml
    Qt6::Quick
    Qt6::QuickControls2
    Qt6::WebChannel
    Qt6::WebEngineQuick
)

set_target_properties(
  Kino
  PROPERTIES
    MACOSX_BUNDLE_BUNDLE_NAME Kino
    MACOSX_BUNDLE_BUNDLE_VERSION ${PROJECT_VERSION}
    MACOSX_BUNDLE_GUI_IDENTIFIER com.chriscorbell.kino
    MACOSX_BUNDLE_ICON_FILE Kino.icns
    MACOSX_BUNDLE_INFO_PLIST ${CMAKE_CURRENT_SOURCE_DIR}/Info.plist.in
    MACOSX_BUNDLE_SHORT_VERSION_STRING ${PROJECT_VERSION}
    OUTPUT_NAME Kino
)

set(KINO_REPOSITORY_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../..)
set(KINO_WEB_DIST ${KINO_REPOSITORY_ROOT}/apps/desktop/dist)
find_program(PNPM_EXECUTABLE pnpm REQUIRED)

add_custom_target(
  kino_web_ui
  COMMAND ${PNPM_EXECUTABLE} --filter @kino/desktop build
  WORKING_DIRECTORY ${KINO_REPOSITORY_ROOT}
  COMMENT "Building Kino web UI"
)
add_dependencies(Kino kino_web_ui)

add_custom_target(
  kino_package_ui ALL
  COMMAND ${CMAKE_COMMAND} -E remove_directory "$<TARGET_FILE_DIR:Kino>/../Resources/ui"
  COMMAND ${CMAKE_COMMAND} -E copy_directory "${KINO_WEB_DIST}" "$<TARGET_FILE_DIR:Kino>/../Resources/ui"
  COMMENT "Packaging Kino web UI"
)
add_dependencies(kino_package_ui Kino kino_web_ui)
