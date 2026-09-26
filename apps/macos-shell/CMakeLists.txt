cmake_minimum_required(VERSION 3.25)

# Kino's version lives in the root package.json, shared with the TV app and the
# web client. CMake's project version takes only its numeric part; a
# pre-release suffix such as -beta.1 stays in KINO_RELEASE_VERSION below.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../../package.json" KINO_ROOT_PACKAGE)
string(JSON KINO_PACKAGE_VERSION GET "${KINO_ROOT_PACKAGE}" version)
string(REGEX MATCH "^[0-9]+\\.[0-9]+\\.[0-9]+" KINO_NUMERIC_VERSION "${KINO_PACKAGE_VERSION}")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
  "${CMAKE_CURRENT_SOURCE_DIR}/../../package.json")

project(Kino VERSION ${KINO_NUMERIC_VERSION} LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(APPLE)
  enable_language(OBJCXX)
  set(CMAKE_OSX_ARCHITECTURES arm64 CACHE STRING "macOS build architecture")
  set(CMAKE_OSX_DEPLOYMENT_TARGET 26.0 CACHE STRING "Minimum macOS version")
endif()
set(CMAKE_AUTOMOC ON)
if(MSVC)
  add_compile_options(/utf-8)
endif()
if(WIN32)
  # windows.h would otherwise define min and max over the standard library's.
  add_compile_definitions(NOMINMAX WIN32_LEAN_AND_MEAN)
endif()

find_package(
  Qt6 6.8
  REQUIRED COMPONENTS
    Core
    Concurrent
    Gui
    Network
    Qml
    Quick
    QuickControls2
    WebChannel
    WebEngineQuick
)
# libmpv 2.4 (mpv 0.40) renamed the subtitle outline options Kino pins for
# its caption style. An older library would reject them at startup.
add_library(kino_mpv INTERFACE)
if(WIN32)
  # Windows has no pkg-config. KINO_MPV_DIR holds libmpv's include directory
  # and an MSVC import library, which CI generates from the DLL's exports.
  set(KINO_MPV_DIR "" CACHE PATH "libmpv development files for Windows")
  find_path(KINO_MPV_INCLUDE_DIR mpv/client.h HINTS "${KINO_MPV_DIR}/include" REQUIRED)
  find_library(KINO_MPV_LIBRARY NAMES mpv libmpv HINTS "${KINO_MPV_DIR}" REQUIRED)
  file(STRINGS "${KINO_MPV_INCLUDE_DIR}/mpv/client.h" KINO_MPV_API_LINE
    REGEX "#define MPV_CLIENT_API_VERSION MPV_MAKE_VERSION")
  string(REGEX MATCH "\\(([0-9]+), *([0-9]+)\\)" KINO_MPV_API "${KINO_MPV_API_LINE}")
  if(CMAKE_MATCH_1 LESS 2 OR (CMAKE_MATCH_1 EQUAL 2 AND CMAKE_MATCH_2 LESS 4))
    message(FATAL_ERROR "Kino needs libmpv client API 2.4 or newer")
  endif()
  target_include_directories(kino_mpv INTERFACE "${KINO_MPV_INCLUDE_DIR}")
  target_link_libraries(kino_mpv INTERFACE "${KINO_MPV_LIBRARY}")
else()
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(MPV REQUIRED IMPORTED_TARGET mpv>=2.4)
  target_link_libraries(kino_mpv INTERFACE PkgConfig::MPV)
endif()

# Each system supplies Now Playing, the sleep notice, the power guard and
# display modes in files of its own behind the same headers. KINO_PLAYER_*
# is what every target that compiles the player item needs.
if(APPLE)
  find_library(APPKIT_FRAMEWORK AppKit REQUIRED)
  find_library(COREGRAPHICS_FRAMEWORK CoreGraphics REQUIRED)
  find_library(FOUNDATION_FRAMEWORK Foundation REQUIRED)
  find_library(IOKIT_FRAMEWORK IOKit REQUIRED)
  find_library(MEDIAPLAYER_FRAMEWORK MediaPlayer REQUIRED)
  set(KINO_PLAYER_PLATFORM_SOURCES src/displaymode_mac.mm src/powerguard_mac.cpp src/sleepobserver_mac.mm)
  set(KINO_PLAYER_PLATFORM_LIBRARIES ${APPKIT_FRAMEWORK} ${COREGRAPHICS_FRAMEWORK} ${IOKIT_FRAMEWORK})
  set(KINO_SHELL_PLATFORM_SOURCES src/nowplaying_mac.mm)
  set(KINO_SHELL_PLATFORM_LIBRARIES ${FOUNDATION_FRAMEWORK} ${MEDIAPLAYER_FRAMEWORK})
elseif(WIN32)
  set(KINO_PLAYER_PLATFORM_SOURCES src/displaymode_windows.cpp src/powerguard_windows.cpp
    src/sleepobserver_windows.cpp)
  set(KINO_PLAYER_PLATFORM_LIBRARIES user32)
  set(KINO_SHELL_PLATFORM_SOURCES src/nowplaying_windows.cpp)
  # C++/WinRT, for the System Media Transport Controls.
  set(KINO_SHELL_PLATFORM_LIBRARIES windowsapp)
else()
  find_package(Qt6 REQUIRED COMPONENTS DBus)
  set(KINO_PLAYER_PLATFORM_SOURCES src/displaymode_none.cpp src/powerguard_linux.cpp
    src/sleepobserver_linux.cpp)
  set(KINO_PLAYER_PLATFORM_LIBRARIES Qt6::DBus)
  set(KINO_SHELL_PLATFORM_SOURCES src/nowplaying_mpris.cpp)
  set(KINO_SHELL_PLATFORM_LIBRARIES Qt6::DBus)
endif()
set(KINO_PLAYER_SOURCES src/displaymode.cpp src/mpvitem.cpp src/platform.cpp src/tlsroots.cpp
  ${KINO_PLAYER_PLATFORM_SOURCES})
set(KINO_PLAYER_LIBRARIES kino_mpv Qt6::Concurrent Qt6::Network Qt6::Quick
  ${KINO_PLAYER_PLATFORM_LIBRARIES})

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
# The diagnostic summary names the build kind, so a report from a development
# build is never mistaken for one from a packaged release.
if(CMAKE_BUILD_TYPE STREQUAL "Release")
  set(KINO_BUILD_KIND "release")
else()
  set(KINO_BUILD_KIND "development")
endif()
configure_file(cmake/DiagnosticBuildInfo.h.in generated/diagnosticbuildinfo.h @ONLY)

if(NOT DEFINED KINO_RELEASE_VERSION)
  set(KINO_RELEASE_VERSION "${KINO_PACKAGE_VERSION}")
endif()

if(APPLE)
  set(KINO_ICON ${CMAKE_CURRENT_SOURCE_DIR}/resources/Kino.icns)
  set_source_files_properties(${KINO_ICON} PROPERTIES MACOSX_PACKAGE_LOCATION Resources)
elseif(WIN32)
  set(KINO_WINDOWS_ICON ${CMAKE_CURRENT_SOURCE_DIR}/resources/Kino.ico)
  configure_file(resources/Kino.rc.in generated/Kino.rc @ONLY)
  set(KINO_ICON ${CMAKE_CURRENT_BINARY_DIR}/generated/Kino.rc)
  set_source_files_properties(${KINO_ICON} PROPERTIES OBJECT_DEPENDS ${KINO_WINDOWS_ICON})
endif()

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
  src/nowplaying.cpp
  src/playbackprobe.cpp
  src/securestore.cpp
  src/singleinstance.cpp
  src/streamengine.cpp
  ${KINO_PLAYER_SOURCES}
  ${KINO_SHELL_PLATFORM_SOURCES}
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

target_compile_definitions(Kino PRIVATE KINO_VERSION="${KINO_RELEASE_VERSION}")
target_include_directories(Kino PRIVATE src "${CMAKE_CURRENT_BINARY_DIR}/generated")
target_link_libraries(
  Kino
  PRIVATE
    ${KINO_PLAYER_LIBRARIES}
    ${KINO_SHELL_PLATFORM_LIBRARIES}
    Qt6::Core
    Qt6::Gui
    Qt6::Qml
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
    WIN32_EXECUTABLE TRUE
)

set(KINO_REPOSITORY_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../..)
# A package build, such as the Flatpak, builds the web interface beforehand
# and points KINO_WEB_DIST at it instead of running pnpm inside its sandbox.
option(KINO_BUILD_WEB_UI "Build the web interface with pnpm as part of the shell" ON)
set(KINO_WEB_DIST ${KINO_REPOSITORY_ROOT}/apps/desktop/dist CACHE PATH "The built web interface")

if(KINO_BUILD_WEB_UI)
  find_program(PNPM_EXECUTABLE NAMES pnpm pnpm.cmd REQUIRED)
  add_custom_target(
    kino_web_ui
    COMMAND ${PNPM_EXECUTABLE} --filter @kino/desktop build
    WORKING_DIRECTORY ${KINO_REPOSITORY_ROOT}
    COMMENT "Building Kino web UI"
  )
else()
  add_custom_target(kino_web_ui)
endif()
add_dependencies(Kino kino_web_ui)

# Files beside the shell, where Platform::resourcePath looks for them: the app
# bundle's Resources on macOS, and the executable's directory in a build tree
# elsewhere.
if(APPLE)
  set(KINO_RESOURCE_DIR "$<TARGET_FILE_DIR:Kino>/../Resources")
else()
  set(KINO_RESOURCE_DIR "$<TARGET_FILE_DIR:Kino>")
endif()

add_custom_target(
  kino_package_ui ALL
  COMMAND ${CMAKE_COMMAND} -E remove_directory "${KINO_RESOURCE_DIR}/ui"
  COMMAND ${CMAKE_COMMAND} -E copy_directory "${KINO_WEB_DIST}" "${KINO_RESOURCE_DIR}/ui"
  COMMENT "Packaging Kino web UI"
)
add_dependencies(kino_package_ui Kino kino_web_ui)

# The streaming engine is optional. Build it with `pnpm engine:build`; without
# it Kino runs normally and reports torrent sources as unavailable.
set(KINO_ENGINE_BINARY
  ${KINO_REPOSITORY_ROOT}/build/engine-target/release/kino-stream-engine${CMAKE_EXECUTABLE_SUFFIX})
add_custom_target(
  kino_package_engine ALL
  COMMAND ${CMAKE_COMMAND}
    -DKINO_ENGINE_BINARY=${KINO_ENGINE_BINARY}
    -DKINO_ENGINE_DESTINATION=$<TARGET_FILE_DIR:Kino>
    -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/PackageEngine.cmake
  COMMENT "Packaging Kino streaming engine"
)
add_dependencies(kino_package_engine Kino)

# Linux installs follow the usual prefix layout, which Platform::resourcePath
# reads as share/kino beside the executable's directory.
if(UNIX AND NOT APPLE)
  include(GNUInstallDirs)
  install(TARGETS Kino RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
  install(DIRECTORY ${KINO_WEB_DIST}/ DESTINATION ${CMAKE_INSTALL_DATADIR}/kino/ui)
  if(EXISTS ${KINO_ENGINE_BINARY})
    install(PROGRAMS ${KINO_ENGINE_BINARY} DESTINATION ${CMAKE_INSTALL_BINDIR})
  endif()
endif()

include(CTest)
if(BUILD_TESTING)
  find_package(Qt6 6.8 REQUIRED COMPONENTS Test)
  qt_add_executable(kino_addonnetwork_probe tests/addonnetwork_probe.cpp src/addonnetwork.cpp)
  target_include_directories(kino_addonnetwork_probe PRIVATE src)
  target_link_libraries(kino_addonnetwork_probe PRIVATE Qt6::Network Qt6::Qml)
  add_test(NAME addon_redirects COMMAND ${NODE_EXECUTABLE}
    "${KINO_REPOSITORY_ROOT}/scripts/check-native-addon-redirects.mjs" $<TARGET_FILE:kino_addonnetwork_probe>)
  set_tests_properties(addon_redirects PROPERTIES TIMEOUT 30)
  qt_add_executable(kino_displaymode_test tests/displaymode_test.cpp src/displaymode.cpp)
  target_include_directories(kino_displaymode_test PRIVATE src)
  target_link_libraries(kino_displaymode_test PRIVATE Qt6::Gui Qt6::Test)
  add_test(NAME kino_displaymode_test COMMAND kino_displaymode_test)
  qt_add_executable(kino_externalnavigation_test tests/externalnavigation_test.cpp src/externalnavigation.cpp)
  target_include_directories(kino_externalnavigation_test PRIVATE src)
  target_link_libraries(kino_externalnavigation_test PRIVATE Qt6::Gui Qt6::Qml Qt6::Test)
  add_test(NAME external_navigation COMMAND kino_externalnavigation_test)
  set_tests_properties(external_navigation PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")
  qt_add_executable(kino_mpvitem_test tests/mpvitem_test.cpp ${KINO_PLAYER_SOURCES})
  target_include_directories(kino_mpvitem_test PRIVATE src)
  target_link_libraries(kino_mpvitem_test PRIVATE ${KINO_PLAYER_LIBRARIES} Qt6::Test)
  add_test(NAME mpvitem_properties COMMAND kino_mpvitem_test)
  set_tests_properties(mpvitem_properties PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")

  # These two interpose libmpv through dyld, so they run on macOS only.
  if(APPLE)
    # Interpose libmpv so startup fails the way a broken install would.
    add_library(kino_mpv_failure SHARED tests/mpv_failure.cpp)
    target_link_libraries(kino_mpv_failure PRIVATE kino_mpv)
    qt_add_executable(kino_mpvitem_unavailable_test tests/mpvitem_unavailable_test.cpp
      ${KINO_PLAYER_SOURCES})
    target_include_directories(kino_mpvitem_unavailable_test PRIVATE src)
    target_link_libraries(kino_mpvitem_unavailable_test
      PRIVATE kino_mpv_failure ${KINO_PLAYER_LIBRARIES} Qt6::Test)
    foreach(stage create initialize)
      add_test(NAME mpv_unavailable_${stage} COMMAND kino_mpvitem_unavailable_test)
      set_tests_properties(
        mpv_unavailable_${stage}
        PROPERTIES ENVIRONMENT "KINO_TEST_MPV_FAILURE=${stage}"
      )
    endforeach()

    # Interpose the real libmpv calls so wrong-context cleanup fails before UB.
    add_library(kino_render_lifetime_guard SHARED tests/render_lifetime_guard.cpp)
    target_link_libraries(kino_render_lifetime_guard PRIVATE kino_mpv "-framework OpenGL")
    target_compile_options(kino_render_lifetime_guard PRIVATE -Wno-deprecated-declarations)
    qt_add_executable(kino_render_lifetime_test tests/render_lifetime_test.cpp ${KINO_PLAYER_SOURCES})
    target_include_directories(kino_render_lifetime_test PRIVATE src)
    target_link_libraries(kino_render_lifetime_test
      PRIVATE kino_render_lifetime_guard ${KINO_PLAYER_LIBRARIES} Qt6::Test)
    add_test(NAME render_lifetime COMMAND kino_render_lifetime_test)
    set_tests_properties(
      render_lifetime
      PROPERTIES TIMEOUT 60
      ENVIRONMENT "QSG_RENDER_LOOP=basic;QSG_INFO=1;QT_LOGGING_RULES=qt.scenegraph.general=true"
    )
  endif()

  qt_add_executable(
    kino_logging_test
    tests/logging_test.cpp
    src/logging.cpp
    src/platform.cpp
    src/streamengine.cpp
    src/tlsroots.cpp
  )
  target_include_directories(kino_logging_test PRIVATE src)
  target_link_libraries(kino_logging_test PRIVATE Qt6::Concurrent Qt6::Core Qt6::Network Qt6::Qml)
  add_test(NAME diagnostic_logging COMMAND kino_logging_test)
  set_tests_properties(diagnostic_logging PROPERTIES TIMEOUT 30)

  qt_add_executable(kino_diagnostics_test tests/diagnostics_test.cpp src/diagnostics.cpp
    src/logging.cpp src/streamengine.cpp ${KINO_PLAYER_SOURCES})
  target_include_directories(kino_diagnostics_test PRIVATE src "${CMAKE_CURRENT_BINARY_DIR}/generated")
  target_link_libraries(kino_diagnostics_test PRIVATE ${KINO_PLAYER_LIBRARIES} Qt6::WebEngineCore Qt6::Test)
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

  qt_add_executable(kino_streamengine_test tests/streamengine_test.cpp src/platform.cpp
    src/streamengine.cpp src/tlsroots.cpp)
  target_include_directories(kino_streamengine_test PRIVATE src)
  target_link_libraries(kino_streamengine_test PRIVATE Qt6::Concurrent Qt6::Network Qt6::Qml Qt6::Test)

  qt_add_executable(kino_singleinstance_test tests/singleinstance_test.cpp src/singleinstance.cpp)
  target_include_directories(kino_singleinstance_test PRIVATE src)
  target_link_libraries(kino_singleinstance_test PRIVATE Qt6::Network Qt6::Test)
  add_test(NAME single_instance COMMAND kino_singleinstance_test)

  qt_add_executable(kino_tlsroots_test tests/tlsroots_test.cpp src/tlsroots.cpp)
  target_include_directories(kino_tlsroots_test PRIVATE src)
  target_link_libraries(kino_tlsroots_test PRIVATE Qt6::Concurrent Qt6::Network Qt6::Test)
  add_test(NAME tls_roots COMMAND kino_tlsroots_test)
  add_test(NAME engine_lifecycle COMMAND kino_streamengine_test)
  set_tests_properties(engine_lifecycle PROPERTIES TIMEOUT 15)

  # A private session bus stands in for the desktop's, so this needs dbus-daemon.
  if(UNIX AND NOT APPLE)
    qt_add_executable(kino_nowplaying_mpris_test tests/nowplaying_mpris_test.cpp src/nowplaying.cpp
      src/nowplaying_mpris.cpp)
    target_include_directories(kino_nowplaying_mpris_test PRIVATE src)
    target_link_libraries(kino_nowplaying_mpris_test PRIVATE Qt6::DBus Qt6::Qml Qt6::Test)
    add_test(NAME media_controls COMMAND kino_nowplaying_mpris_test)
  endif()
endif()
