# Android verification

The Android client has three gates, in increasing cost. CI runs the first two;
the third needs a device or an emulator.

## 1. JVM unit tests (seconds)

```bash
apps/android/gradlew testDebugUnitTest
```

Covers provider-independent logic: server address normalisation, assistant content
projection, `jarvis://` deep-link parsing, notification targets, the
error-message mapping, the four appearance palettes and the voice-call text
pipeline (Markdown sanitising, sentence boundaries, long-tail splitting). These
are the tests that pin the notification → deep link → screen contract without
touching Android framework classes, so they run everywhere.

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
`SemanticRestoreTest`, …). Three legacy end-to-end tests (`M1EndToEndTest`,
`M2EndToEndTest`, `M3ApplicationsEndToEndTest`) still target the pre-identity
pairing harness; they skip unless they receive instrumentation arguments and are
kept for historical harnesses. Current identity builds are exercised by the
self-contained suite plus the login/home or voice walkthroughs:

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


## 4. GitHub Release

Push a `v*` tag, or dispatch **Publish Android APK** with an existing tag. The
workflow builds the debug APK, runs `testDebugUnitTest` and `lintDebug`, verifies
the stable debug signing certificate, and attaches
`jarvis-<version>-android-debug.apk` plus `SHA256SUMS` to the GitHub Release.
The keystore is stored in the `ANDROID_DEBUG_KEYSTORE` repository secret so
releases remain upgrade-compatible; without it, a fork still builds but uses a
fresh debug key.

## 5. Voice call walkthrough on a device

The voice call uses the system `RecognitionService` and TTS engine. It needs
microphone permission and a device or emulator image with Chinese speech
services. On an emulator, start it with a real audio backend (`-audio default`);
`-no-audio` can make the audio HAL hang when TTS initialises.

1. Log in and open **语音通话** from the home hero, top-bar microphone or the
   Jarvis header.
2. Grant microphone access. The call greets, then shows **正在聆听** with the
   orb rings and a live level meter.
3. Say a short sentence. The partial transcript appears under the orb. After the
   silence timeout the turn is submitted automatically.
4. While Jarvis answers, the orb breathes and the answer is spoken sentence by
   sentence. Tap the orb to interrupt: playback stops, the server turn is
   cancelled and the call returns to listening.
5. Use **静音** to stop the microphone, **扬声器** to switch routing, **键盘** to
   type a turn, and **结束** to close the call. Ending with a real conversation
   opens that conversation in the chat screen.

If the device has no recognition service, the keyboard panel opens
automatically. If TTS is unavailable, the footer says so and replies stay as
subtitles.
