plugins {
    id("com.android.application")
}

android {
    namespace = "cz.mega.mytubefeed"
    compileSdk = 34

    defaultConfig {
        applicationId = "cz.mega.mytubefeed"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    // Pevný podpisový klíč (aby šla aplikace aktualizovat přes starší verzi). Určeno pro osobní instalaci mimo Play Store.
    signingConfigs {
        create("release") {
            storeFile = file("mytubefeed.keystore")
            storePassword = "mytubefeed"
            keyAlias = "mytubefeed"
            keyPassword = "mytubefeed"
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}
