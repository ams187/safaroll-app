import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isIgnoredPath } from '@expo/fingerprint/build/utils/Path';

const patterns = readFileSync('.fingerprintignore', 'utf8').split('\n')
  .map(line => line.trim()).filter(line => line && !line.startsWith('#'));
const audio = 'node_modules/react-native-audio-api/';
for (const path of ['ios', 'ios/SafaRoll/Info.plist', 'android',
  `${audio}common/cpp/audioapi/external/iphoneos/libopus.a`,
  `${audio}common/cpp/audioapi/external/ffmpeg_ios/libavcodec.xcframework/Info.plist`]) {
  assert.ok(isIgnoredPath(path, patterns), `Generated file must be ignored: ${path}`);
}
for (const path of ['app.config.ts', 'plugins/with-widget-live-activities.js',
  'targets/widget/ExpeditionActivity.swift', 'modules/subject-lift/ios/SubjectLiftModule.swift',
  `${audio}package.json`, `${audio}RNAudioAPI.podspec`,
  `${audio}scripts/download-prebuilt-binaries.sh`,
  `${audio}common/cpp/audioapi/external/include_ffmpeg/libavcodec/avcodec.h`]) {
  assert.ok(!isIgnoredPath(path, patterns), `Native source must remain hashed: ${path}`);
}
console.log('Fingerprint exclusions: OK; native source protections retained.');
