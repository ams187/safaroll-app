import ActivityKit
import ExpoModulesCore
import OneSignalLiveActivities

public final class LiveActivityControlModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LiveActivityControl")

    // Snapshot synchronously: a later login must not have its new activities
    // included while the old account's asynchronous dismissal is finishing.
    Function("endAll") { () -> Void in
      let activities = Activity<DefaultLiveActivityAttributes>.activities
      Task {
        for activity in activities {
          await activity.end(nil, dismissalPolicy: .immediate)
        }
      }
    }
  }
}
