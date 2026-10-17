# Android verification

The Android client has three gates, in increasing cost. CI runs the first two;
the third needs a device or an emulator.

## 1. JVM unit tests (seconds)

```bash
apps/android/gradlew testDebugUnitTest
```

Covers provider-independent logic: server address normalisation, assistant content
projection, `jarvis://` deep-link parsing, notification targets and the
error-message mapping. These are the tests that pin the notification → deep link
→ screen contract without touching Android framework classes, so they run
everywhere.

## 2. Lint and instrumentation compile

```bash
apps/android/gradlew lintDebug assembleDebugAndroidTest
```

`lintDebug` is the static gate. `assembleDebugAndroidTest` proves the Compose UI
tests still compile; it does not run them.

## 3. Instrumentation on a device or emulator (minutes)

```bash
apps/android/gradlew connectedDebugAndroidTest
```

Runs the self-contained Compose suite (`DynamicV2Test`, `DynamicProtocolTest`,
`GalleryViewTest`, `SpaceTilesTest`, `TaskListTest`, `ProductApplicationsTest`,
`SemanticRestoreTest`, …). Three end-to-end tests (`M1EndToEndTest`,
`M2EndToEndTest`, `M3ApplicationsEndToEndTest`) drive a **real deployed stack**
and skip unless they receive instrumentation arguments:

```bash
apps/android/gradlew connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.server=http://10.0.2.2:8080 \
  -Pandroid.testInstrumentationRunnerArguments.pairingCode=<code> \
  -Pandroid.testInstrumentationRunnerArguments.agentToken=<token> \
  -Pandroid.testInstrumentationRunnerArguments.inputRun=<run id> \
  -Pandroid.testInstrumentationRunnerArguments.cancelRun=<run id>
```

### Headless emulator without a JDK 17 on the host

`gradle:8.11-jdk17` has everything the build needs except the SDK:

```bash
cd apps/android
docker run --rm -u "$(id -u):$(id -g)" \
  -e HOME=/home/gradle -e ANDROID_HOME=/opt/android-sdk -e ANDROID_SDK_ROOT=/opt/android-sdk \
  -v "$PWD/../..:/src" -v "$HOME/.gradle:/home/gradle/.gradle" -v "$HOME/.android:/home/gradle/.android" \
  -v "$PWD/../../.local/android-sdk:/opt/android-sdk" -w /src/apps/android \
  gradle:8.11-jdk17 gradle --no-daemon testDebugUnitTest lintDebug assembleDebugAndroidTest
```

For `connectedDebugAndroidTest`, start the emulator on the host and give the
container host networking so `adb` can reach it:

```bash
.local/android-sdk/emulator/emulator -avd jarvis-ci-phone -no-window -no-audio \
  -no-boot-anim -no-snapshot -gpu swiftshader_indirect &
# then add --network host -e ADB_SERVER_SOCKET=tcp:127.0.0.1:5037 to the command above
```

Two practical notes, both learned the hard way:

- Create the AVD with a phone profile (`avdmanager create avd -d pixel_6`). The
  profile-less default is 320×640, which makes layout assertions fail for reasons
  that have nothing to do with the app.
- Mount `$HOME/.android` into the container. Without it, every build uses a fresh
  debug keystore and `adb install -r` fails with
  `INSTALL_FAILED_UPDATE_INCOMPATIBLE` — silently, if you only look at the tail of
  the output.

### Manual walkthrough of the notification → result chain

1. Install the debug APK and log in against the deployed server
   (`http://10.0.2.2:8080` from an emulator).
2. Allow notifications when asked; the app subscribes to `notification.created`.
3. Fire the same target a notification would carry:
   `adb shell am start -a android.intent.action.VIEW -d "jarvis://task/<run id>"`
4. The task's Result screen must open with real data, and the header must not show
   any raw error body.
