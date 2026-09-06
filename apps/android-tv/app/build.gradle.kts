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

android {
    namespace = "app.kino.tv"
    compileSdk = 36
    defaultConfig {
        applicationId = "app.kino.tv"
        minSdk = 28
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-dev"
        ndk { abiFilters += "arm64-v8a" }
        testInstrumentationRunner = "app.kino.tv.ShieldTestRunner"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
    kotlinOptions { jvmTarget = "21" }
    sourceSets["main"].jniLibs.srcDirs(
        "../../../build/android-core/jniLibs",
        // Media3's FFmpeg audio renderer, built by scripts/build-android.py.
        "../../../build/android-ffmpeg/jniLibs",
    )
    sourceSets["main"].java.srcDirs(generatedTokens, "../../../build/android-ffmpeg/java")
    sourceSets["androidTest"].assets.srcDir("../../../build/android-fixtures")
    packaging {
        resources.merges +=
            setOf("META-INF/AL2.0", "META-INF/LGPL2.1", "META-INF/LICENSE", "META-INF/NOTICE")
    }
}

tasks.named("preBuild") { dependsOn(generateDesignTokens) }

dependencies {
    implementation(files("../../../build/android-core/classes.jar"))
    implementation("pro.streem.pbandk:pbandk-runtime-android:0.16.0")
    implementation("org.jetbrains.kotlin:kotlin-reflect:2.2.20")
    implementation(platform("androidx.compose:compose-bom:2025.09.01"))
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.animation:animation")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.tv:tv-material:1.0.1")
    implementation("io.coil-kt.coil3:coil-compose:3.3.0")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.3.0")
    implementation("androidx.media3:media3-exoplayer:1.9.3")
    implementation("androidx.media3:media3-exoplayer-hls:1.9.3")
    implementation("androidx.media3:media3-exoplayer-dash:1.9.3")
    implementation("androidx.media3:media3-ui:1.9.3")
    implementation("androidx.media3:media3-effect:1.9.3")
    implementation("androidx.media3:media3-session:1.9.3")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
