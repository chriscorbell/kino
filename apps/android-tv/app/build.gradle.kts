plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

dependencyLocking { lockAllConfigurations() }

val tokenSource = rootProject.file("../../packages/design-tokens/src/tokens.css")
val generatedTokens = layout.buildDirectory.dir("generated/kinoTokens")
val generateDesignTokens by
    tasks.registering {
        inputs.file(tokenSource)
        outputs.dir(generatedTokens)
        doLast {
            val colors =
                Regex("--kino-([a-z-]+):\\s*(#[0-9a-fA-F]{6});")
                    .findAll(tokenSource.readText())
                    .joinToString("\n") { match ->
                        val name =
                            match.groupValues[1].split('-').joinToString("") {
                                it.replaceFirstChar(Char::uppercase)
                            }
                        "    val $name = Color(0xFF${match.groupValues[2].drop(1)})"
                    }
            val output = generatedTokens.get().file("app/kino/tv/KinoColors.kt").asFile
            output.parentFile.mkdirs()
            output.writeText(
                """
            |// Generated from packages/design-tokens/src/tokens.css.
            |package app.kino.tv
            |import androidx.compose.ui.graphics.Color
            |internal object KinoColors {
            |$colors
            |}
            |"""
                    .trimMargin()
            )
        }
    }

// Kino's version lives in the root package.json, shared with the desktop shell
// and the web client, so a release tag names one version everywhere.
val kinoVersion: String =
    (groovy.json.JsonSlurper().parse(rootProject.file("../../package.json")) as Map<*, *>)["version"]
        as String

// Android refuses to install a lower versionCode over a higher one. Each
// release step gets room for 99 pre-releases, and a final release sorts after
// every pre-release of the same version: 0.2.0-beta.3 is 20003, 0.2.0 is 20099.
fun kinoVersionCode(version: String): Int {
    val match = Regex("""^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z-]+\.(\d+))?$""").matchEntire(version)
        ?: error("Kino version $version must be MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-label.N")
    val (major, minor, patch, prerelease) = match.destructured
    val step = if (prerelease.isEmpty()) 99 else prerelease.toInt()
    require(minor.toInt() < 100 && patch.toInt() < 100 && step in 1..99) {
        "Kino version $version does not fit the versionCode scheme"
    }
    return major.toInt() * 1_000_000 + minor.toInt() * 10_000 + patch.toInt() * 100 + step
}

android {
    namespace = "app.kino.tv"
    compileSdk = 36
    defaultConfig {
        applicationId = "app.kino.tv"
        minSdk = 28
        targetSdk = 36
        versionCode = kinoVersionCode(kinoVersion)
        versionName = kinoVersion
        val coreRevision =
            Regex("(?m)^REVISION = \"([a-f0-9]{40})\"")
                .find(rootProject.file("../../scripts/build-android.py").readText())!!
                .groupValues[1]
        buildConfigField("String", "CORE_REVISION", "\"$coreRevision\"")
        ndk { abiFilters += "arm64-v8a" }
        testInstrumentationRunner = "app.kino.tv.ShieldTestRunner"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    signingConfigs {
        // The release workflow supplies Kino's release key through these variables. Without
        // them, as on every development machine and in CI, release builds use the machine's
        // development key, so a local build can never pass for an official one.
        System.getenv("KINO_ANDROID_KEYSTORE")?.let { keystore ->
            create("kinoRelease") {
                storeFile = file(keystore)
                storePassword = System.getenv("KINO_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KINO_ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("KINO_ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig =
                signingConfigs.findByName("kinoRelease") ?: signingConfigs.getByName("debug")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        create("benchmark") {
            initWith(getByName("release"))
            // The instrumentation APK is always development signed and must match its target.
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += "release"
            proguardFiles("benchmark-rules.pro")
        }
    }
    testBuildType = "benchmark"
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
    kotlinOptions { jvmTarget = "21" }
    sourceSets["main"].jniLibs.srcDirs(
        // Media3's FFmpeg audio renderer, built by scripts/build-android.py.
        "../../../build/android-ffmpeg/jniLibs",
        // The torrent engine, an executable the app runs; built by scripts/build-android.py.
        "../../../build/android-engine/jniLibs",
    )
    sourceSets["main"].java.srcDirs(generatedTokens, "../../../build/android-ffmpeg/java")
    // The license index scripts/android-notices.mjs collects, packaged as assets/licenses.
    sourceSets["main"].assets.srcDir("../../../build/android-notices")
    sourceSets["androidTest"].assets.srcDir("../../../build/android-fixtures")
    sourceSets["release"].jniLibs.srcDir("../../../build/android-core/jniLibs")
    sourceSets["debug"].jniLibs.srcDir("../../../build/android-core/jniLibs")
    sourceSets["benchmark"].jniLibs.srcDir("../../../build/android-core-test/jniLibs")
    sourceSets["benchmark"].java.srcDir("src/debug/java")
    sourceSets["benchmark"].manifest.srcFile("src/debug/AndroidManifest.xml")
    packaging {
        // Android only extracts native libraries to disk when asked, and the torrent engine has to
        // exist there to be executed.
        jniLibs.useLegacyPackaging = true
        resources.merges +=
            setOf("META-INF/AL2.0", "META-INF/LGPL2.1", "META-INF/LICENSE", "META-INF/NOTICE")
    }
}

// A gradle-only build with that directory missing would still succeed and
// ship an APK without the surround decoders, and every AC-3, E-AC-3, DTS, and
// TrueHD source would then fail on the Shield as an unplayable audio format.
val requireFfmpegRenderer by
    tasks.registering {
        val library = file("../../../build/android-ffmpeg/jniLibs/arm64-v8a/libffmpegJNI.so")
        doLast {
            check(library.exists()) {
                "Missing $library. Run `pnpm android:build`, which builds Media3's FFmpeg audio " +
                    "renderer before Gradle; a Gradle-only build would omit the surround decoders."
            }
        }
    }

// Without the index the app would ship its dependencies with no license texts at all.
val requireLicenseNotices by
    tasks.registering {
        val manifest = file("../../../build/android-notices/licenses/manifest.json")
        doLast {
            check(manifest.exists()) {
                "Missing $manifest. Run `pnpm android:build`, which collects the license " +
                    "notices the APK must carry before Gradle runs."
            }
        }
    }

// Without the engine every torrent source would fail at play time instead of at build time.
val requireStreamEngine by
    tasks.registering {
        val engine = file("../../../build/android-engine/jniLibs/arm64-v8a/libkino_stream_engine.so")
        doLast {
            check(engine.exists()) {
                "Missing $engine. Run `pnpm android:build`, which builds the torrent engine " +
                    "before Gradle."
            }
        }
    }

tasks.named("preBuild") {
    dependsOn(generateDesignTokens, requireFfmpegRenderer, requireLicenseNotices, requireStreamEngine)
}

dependencies {
    implementation(files("../../../build/android-core/classes.jar"))
    implementation("pro.streem.pbandk:pbandk-runtime-android:0.16.0")
    implementation("org.jetbrains.kotlin:kotlin-reflect:2.2.20")
    implementation(platform("androidx.compose:compose-bom:2026.03.01"))
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.animation:animation")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.tv:tv-material:1.0.1")
    implementation("io.coil-kt.coil3:coil-compose:3.3.0")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.3.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.media3:media3-exoplayer:1.9.3")
    implementation("androidx.media3:media3-exoplayer-hls:1.9.3")
    implementation("androidx.media3:media3-exoplayer-dash:1.9.3")
    implementation("androidx.media3:media3-ui:1.9.3")
    implementation("androidx.media3:media3-effect:1.9.3")
    implementation("androidx.media3:media3-session:1.9.3")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
