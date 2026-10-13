plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "club.denflix.swgohoverlay"
    compileSdk = 34

    defaultConfig {
        applicationId = "club.denflix.swgohoverlay"
        minSdk = 26
        targetSdk = 34
        versionCode = 9
        versionName = "0.7.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")

    // Backend HTTP calls
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // Plain-JVM unit tests (src/test). org.json ships inside Android itself,
    // but local tests run off-device and need the real library.
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
