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

qt_standard_project_setup(REQUIRES 6.8)

set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
  "${CMAKE_CURRENT_SOURCE_DIR}/../desktop/package.json"
  "${CMAKE_CURRENT_SOURCE_DIR}/../stream-engine/Cargo.toml"
  "${CMAKE_CURRENT_SOURCE_DIR}/../stream-engine/engine.lock")
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../desktop/package.json" KINO_DESKTOP_PACKAGE)
string(JSON KINO_CORE_VERSION GET "${KINO_DESKTOP_PACKAGE}" dependencies "@stremio/stremio-core-web")
file(STRINGS "${CMAKE_CURRENT_SOURCE_DIR}/../stream-engine/Cargo.toml" KINO_ENGINE_VERSION_LINE REGEX "^version = ")
string(REGEX REPLACE "^version = \"([^\"]+)\".*" "\\1" KINO_ENGINE_VERSION "${KINO_ENGINE_VERSION_LINE}")
file(STRINGS "${CMAKE_CURRENT_SOURCE_DIR}/../stream-engine/engine.lock" KINO_ENGINE_REVISION_LINE REGEX "^KINO_ENGINE_REVISION=")
string(REPLACE "KINO_ENGINE_REVISION=" "" KINO_ENGINE_REVISION "${KINO_ENGINE_REVISION_LINE}")
configure_file(cmake/DiagnosticBuildInfo.h.in generated/diagnosticbuildinfo.h @ONLY)

set(KINO_ICON ${CMAKE_CURRENT_SOURCE_DIR}/resources/Kino.icns)
set_source_files_properties(${KINO_ICON} PROPERTIES MACOSX_PACKAGE_LOCATION Resources)

qt_add_executable(
  Kino
  MACOSX_BUNDLE
  ${KINO_ICON}
  src/addonnetwork.cpp
  src/closecoordinator.cpp
  src/diagnostics.cpp
  src/externalnavigation.cpp
  src/logging.cpp
  src/main.cpp
  src/mpvitem.cpp
  src/nowplaying.mm
  src/playbackprobe.cpp
  src/powerguard.cpp
  src/securestore.cpp
  src/streamengine.cpp
)

find_program(NODE_EXECUTABLE node REQUIRED)
file(GLOB KINO_LOCALE_INPUTS CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/../desktop/src/locales/*.ts")
set(KINO_LOCALE_GENERATOR "${CMAKE_CURRENT_SOURCE_DIR}/../../scripts/generate-native-locale.mjs")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${KINO_LOCALE_INPUTS} "${KINO_LOCALE_GENERATOR}")
set(KINO_NATIVE_LOCALE "${CMAKE_CURRENT_BINARY_DIR}/generated/NativeLocale.js")
execute_process(
  COMMAND ${NODE_EXECUTABLE} "${KINO_LOCALE_GENERATOR}" "${KINO_NATIVE_LOCALE}"
  COMMAND_ERROR_IS_FATAL ANY
)
qt_add_resources(Kino kino_locale
  PREFIX "/kino"
  BASE "${CMAKE_CURRENT_BINARY_DIR}/generated"
  FILES "${KINO_NATIVE_LOCALE}"
)

qt_add_qml_module(
  Kino
  URI KinoShell
  VERSION 1.0
  QML_FILES qml/Main.qml qml/Probe.qml
  SOURCES
    src/addonnetwork.h
    src/closecoordinator.h
    src/diagnostics.h
    src/externalnavigation.h
    src/mpvitem.h
    src/nowplaying.h
    src/securestore.h
    src/streamengine.h
)

if(NOT DEFINED KINO_RELEASE_VERSION)
  set(KINO_RELEASE_VERSION "${PROJECT_VERSION}")
endif()
target_compile_definitions(Kino PRIVATE KINO_VERSION="${KINO_RELEASE_VERSION}")
target_include_directories(Kino PRIVATE src "${CMAKE_CURRENT_BINARY_DIR}/generated")
target_link_libraries(
  Kino
  PRIVATE
    PkgConfig::MPV
    ${FOUNDATION_FRAMEWORK}
    ${IOKIT_FRAMEWORK}
    ${MEDIAPLAYER_FRAMEWORK}
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

# The streaming engine is optional. Build it with `pnpm engine:build`; without
# it Kino runs normally and reports torrent sources as unavailable.
set(KINO_ENGINE_BINARY ${KINO_REPOSITORY_ROOT}/build/engine-target/release/kino-stream-engine)
add_custom_target(
  kino_package_engine ALL
  COMMAND ${CMAKE_COMMAND}
    -DKINO_ENGINE_BINARY=${KINO_ENGINE_BINARY}
    -DKINO_ENGINE_DESTINATION=$<TARGET_FILE_DIR:Kino>
    -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/PackageEngine.cmake
  COMMENT "Packaging Kino streaming engine"
)
add_dependencies(kino_package_engine Kino)

include(CTest)
if(BUILD_TESTING)
  find_package(Qt6 6.8 REQUIRED COMPONENTS Test)
  qt_add_executable(kino_addonnetwork_probe tests/addonnetwork_probe.cpp src/addonnetwork.cpp)
  target_include_directories(kino_addonnetwork_probe PRIVATE src)
  target_link_libraries(kino_addonnetwork_probe PRIVATE Qt6::Network Qt6::Qml)
  add_test(NAME addon_redirects COMMAND ${NODE_EXECUTABLE}
    "${KINO_REPOSITORY_ROOT}/scripts/check-native-addon-redirects.mjs" $<TARGET_FILE:kino_addonnetwork_probe>)
  set_tests_properties(addon_redirects PROPERTIES TIMEOUT 30)
  qt_add_executable(kino_externalnavigation_test tests/externalnavigation_test.cpp src/externalnavigation.cpp)
  target_include_directories(kino_externalnavigation_test PRIVATE src)
  target_link_libraries(kino_externalnavigation_test PRIVATE Qt6::Gui Qt6::Qml Qt6::Test)
  add_test(NAME external_navigation COMMAND kino_externalnavigation_test)
  set_tests_properties(external_navigation PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")
  qt_add_executable(
    kino_mpvitem_test
    tests/mpvitem_test.cpp
    src/mpvitem.cpp
    src/powerguard.cpp
  )
  target_include_directories(kino_mpvitem_test PRIVATE src)
  target_link_libraries(
    kino_mpvitem_test
    PRIVATE PkgConfig::MPV ${IOKIT_FRAMEWORK} Qt6::Quick Qt6::Test
  )
  add_test(NAME mpvitem_properties COMMAND kino_mpvitem_test)
  set_tests_properties(mpvitem_properties PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")

  # Interpose the real libmpv calls so wrong-context cleanup fails before UB.
  add_library(kino_render_lifetime_guard SHARED tests/render_lifetime_guard.cpp)
  target_link_libraries(kino_render_lifetime_guard PRIVATE PkgConfig::MPV "-framework OpenGL")
  target_compile_options(kino_render_lifetime_guard PRIVATE -Wno-deprecated-declarations)
  qt_add_executable(
    kino_render_lifetime_test
    tests/render_lifetime_test.cpp
    src/mpvitem.cpp
    src/powerguard.cpp
  )
  target_include_directories(kino_render_lifetime_test PRIVATE src)
  target_link_libraries(
    kino_render_lifetime_test
    PRIVATE kino_render_lifetime_guard PkgConfig::MPV ${IOKIT_FRAMEWORK} Qt6::Quick Qt6::Test
  )
  add_test(NAME render_lifetime COMMAND kino_render_lifetime_test)
  set_tests_properties(
    render_lifetime
    PROPERTIES TIMEOUT 60
    ENVIRONMENT "QSG_RENDER_LOOP=basic;QSG_INFO=1;QT_LOGGING_RULES=qt.scenegraph.general=true"
  )

  qt_add_executable(
    kino_logging_test
    tests/logging_test.cpp
    src/logging.cpp
    src/streamengine.cpp
  )
  target_include_directories(kino_logging_test PRIVATE src)
  target_link_libraries(kino_logging_test PRIVATE Qt6::Core Qt6::Qml)
  add_test(NAME diagnostic_logging COMMAND kino_logging_test)
  set_tests_properties(diagnostic_logging PROPERTIES TIMEOUT 30)

  qt_add_executable(kino_diagnostics_test
    tests/diagnostics_test.cpp src/diagnostics.cpp src/mpvitem.cpp src/powerguard.cpp
    src/streamengine.cpp src/logging.cpp)
  target_include_directories(kino_diagnostics_test PRIVATE src "${CMAKE_CURRENT_BINARY_DIR}/generated")
  target_link_libraries(kino_diagnostics_test PRIVATE PkgConfig::MPV ${IOKIT_FRAMEWORK}
    Qt6::Concurrent Qt6::Quick Qt6::WebEngineCore Qt6::Test)
  add_test(NAME diagnostic_summary COMMAND kino_diagnostics_test)
  set_tests_properties(diagnostic_summary PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")

  qt_add_executable(
    kino_closecoordinator_test
    tests/closecoordinator_test.cpp
    src/closecoordinator.cpp
  )
  target_include_directories(kino_closecoordinator_test PRIVATE src)
  target_link_libraries(kino_closecoordinator_test PRIVATE Qt6::Qml Qt6::Test)
  add_test(NAME ordered_shutdown COMMAND kino_closecoordinator_test)

  qt_add_executable(kino_streamengine_test tests/streamengine_test.cpp src/streamengine.cpp)
  target_include_directories(kino_streamengine_test PRIVATE src)
  target_link_libraries(kino_streamengine_test PRIVATE Qt6::Qml Qt6::Test)
  add_test(NAME engine_lifecycle COMMAND kino_streamengine_test)
  set_tests_properties(engine_lifecycle PROPERTIES TIMEOUT 15)
endif()
