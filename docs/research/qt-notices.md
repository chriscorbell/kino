Qt 6.11.2 license and attribution artifacts are available in `build/license-research/qt/bundles/`. `build/license-research/qt/bundle-manifest.json` maps each artifact to its Homebrew formula, exact Qt source revision, source URLs, byte count, and SHA256. This research supports issue #68.

The collection has 14 formula bundles totaling 3,070,501 bytes. It combines 173 artifacts from pinned Qt source repositories with 211 complete attribution pages from the official Qt 6.11.2 documentation. Every downloaded file and assembled bundle passed a SHA256 verification against the manifest on September 5, 2026. The underlying HTML and extracted text remain in `build/license-research/qt/upstream/` and `text/` for review.

The inspected app, `build/dist/Kino.app`, contains 54 Qt frameworks. Its plugin directory also contains code from Qt Image Formats, Qt Virtual Keyboard, Qt 3D, Qt Quick Timeline, and Qt SCXML. A framework-only inventory would miss those modules. `build/license-research/qt/plugin-origins.json` records the installed formula roots found by resolving the corresponding Qt plugin symlinks. The packaging implementation should determine which formula bundles it needs from the complete final app inventory.

| Formula           | Included upstream attribution groups | Third-party notices |
| ----------------- | ------------------------------------ | ------------------: |
| qtbase            | Core, D-Bus, GUI, Network, SQL       |                  51 |
| qtdeclarative     | QML, Quick, Quick Controls           |                   3 |
| qtimageformats    | Image Formats                        |                   2 |
| qtmultimedia      | Multimedia                           |                   7 |
| qtpositioning     | Positioning                          |                   3 |
| qtserialport      | No third-party group in the Qt index |                   0 |
| qtshadertools     | Shader Tools                         |                   2 |
| qtsvg             | SVG                                  |                   1 |
| qtwebchannel      | No third-party group in the Qt index |                   0 |
| qtwebengine       | PDF, WebEngine                       |                 135 |
| qt3d              | 3D                                   |                   4 |
| qtvirtualkeyboard | Virtual Keyboard                     |                   3 |
| qtquicktimeline   | No third-party group in the Qt index |                   0 |
| qtscxml           | No third-party group in the Qt index |                   0 |

Each formula bundle also contains the release's root license files and `LICENSES/` texts. The immutable source revisions and original filenames are recorded in `source-licenses.json`. For example, Qt Base was pinned to `ef55f427f2c8b410d34f8a7681020a3000cf6866`, Qt Declarative to `4e3399c26ec57246c08de019cfcbda8d23604cfa`, and Qt WebEngine to `a33fa2a897e5ee58e385b3f88dc247d99fca56db`. The source file SPDX identifiers determine which of those license texts apply to each file. [Qt Base source licenses](https://github.com/qt/qtbase/tree/ef55f427f2c8b410d34f8a7681020a3000cf6866/LICENSES), [Qt Declarative source licenses](https://github.com/qt/qtdeclarative/tree/4e3399c26ec57246c08de019cfcbda8d23604cfa/LICENSES), [Qt WebEngine source licenses](https://github.com/qt/qtwebengine/tree/a33fa2a897e5ee58e385b3f88dc247d99fca56db/LICENSES).

The installed `qtwebengine/6.11.2/LICENSE.Chromium` is a 1,481-byte Chromium BSD notice. It does not contain the notices for Chromium's dependencies. Qt explains that Chromium is compiled into WebEngine Core and that its component licenses also apply to redistribution. The official WebEngine attribution list supplies those notices. [Qt WebEngine licensing](https://doc.qt.io/qt-6/qtwebengine-licensing.html), [the pinned Chromium root notice](https://github.com/qt/qtwebengine/blob/a33fa2a897e5ee58e385b3f88dc247d99fca56db/LICENSE.Chromium).

The installed `qWebEngineChromiumVersion()` reports `140.0.7339.225`. The Qt WebEngine v6.11.2 source pins `qtwebengine-chromium` to `5170777d28bee1ce92cc693a0dbf2ad01492e5cf`; that revision's `chromium/chrome/VERSION` reports the same four version components. Both the pinned Chromium license and version file are in `build/license-research/qt/pinned/qtwebengine-chromium/`. [Qt WebEngine's pinned Chromium submodule](https://github.com/qt/qtwebengine/tree/a33fa2a897e5ee58e385b3f88dc247d99fca56db/src), [Chromium version at the pinned revision](https://github.com/qt/qtwebengine-chromium/blob/5170777d28bee1ce92cc693a0dbf2ad01492e5cf/chromium/chrome/VERSION).

Qt generates `chromium_attributions.qdoc` with the GN target `:QtWebEngineCore` and makes it a dependency of the documentation build. The source templates wrap each collected component's license text as a documentation page. This explains why enumerating registered Qt resources did not find a complete license resource in the installed library. The copied documentation provides 126 distinct WebEngine attribution pages and nine PDF pages. [Qt's attribution generation target](https://github.com/qt/qtwebengine/blob/a33fa2a897e5ee58e385b3f88dc247d99fca56db/src/core/api/CMakeLists.txt), [Qt's GN credits wrapper](https://github.com/qt/qtwebengine/blob/a33fa2a897e5ee58e385b3f88dc247d99fca56db/cmake/QtGnCredits.cmake), [Qt's attribution template](https://github.com/qt/qtwebengine/blob/a33fa2a897e5ee58e385b3f88dc247d99fca56db/src/core/doc/about_credits_entry.tmpl).

The published attribution index explicitly identifies Qt 6.11.2. These are module-wide lists, so they include optional components and code for other platforms. They are a conservative notice collection, not proof that every listed component is compiled into this Homebrew build. Separately linked Homebrew libraries still need the notices for their installed versions. `qtshadertools` is included as an available bundle, but the inspected framework/plugin inventory did not require it. [Qt's third-party attribution index](https://doc.qt.io/qt-6/licenses-used-in-qt.html).

For packaging, copy the required formula bundles and preserve their reviewed hashes. No runtime network request is needed to read them. When an installed Qt formula version changes, require a newly reviewed notice bundle instead of silently using these 6.11.2 files. The collection scripts in `build/license-research/qt/` retain the retrieval and assembly mechanism; they do not modify app code or packaging scripts.
