# Copies the optional streaming engine helper into the app bundle when it has
# been built. Absence is normal and must not fail the shell build.
if(EXISTS ${KINO_ENGINE_BINARY})
  file(COPY ${KINO_ENGINE_BINARY} DESTINATION ${KINO_ENGINE_DESTINATION})
  message(STATUS "Bundled the Kino streaming engine")
else()
  file(REMOVE ${KINO_ENGINE_DESTINATION}/kino-stream-engine)
  message(STATUS "No streaming engine built; torrent sources will be unavailable")
endif()
