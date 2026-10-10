# Fixture: the shell installs the font the apps' mount also installs.
install(DIRECTORY qml/ DESTINATION ${PHOENIX_DATA_DIR}/qml)
install(DIRECTORY assets/fonts/extra/ DESTINATION ${CMAKE_INSTALL_DATADIR}/fonts/extra
        FILES_MATCHING PATTERN "*.ttf")
