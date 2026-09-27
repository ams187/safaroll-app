Pod::Spec.new do |s|
  s.name = 'LiveActivityControl'
  s.version = '1.0.0'
  s.summary = 'Local dismissal of SafaRoll OneSignal Live Activities.'
  s.description = s.summary
  s.author = ''
  s.homepage = 'https://docs.expo.dev/modules/'
  s.platforms = { :ios => '16.2' }
  s.swift_version = '5.9'
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'OneSignalXCFramework/OneSignalLiveActivities'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
