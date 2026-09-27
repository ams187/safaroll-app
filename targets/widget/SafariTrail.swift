import SwiftUI

/// Shared by the Lock Screen and expanded Island; progress comes from OneSignal.
struct SafariTrail: View {
    let found: Int
    let total: Int
    var onDark = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var count: Int { max(0, min(total, 30)) }
    private var progress: Double { total > 0 ? min(1, max(0, Double(found) / Double(total))) : 0 }

    private func point(_ fraction: Double, width: CGFloat) -> CGPoint {
        CGPoint(x: 22 + max(0, width - 44) * fraction,
                y: 48 - 18 * sin(.pi * fraction))
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .topLeading) {
                // Stable identities let SwiftUI interpolate between remote updates.
                ForEach(0..<41, id: \.self) { index in
                    let fraction = Double(index) / 40
                    Circle()
                        .fill(onDark ? Color("$accent") : Color("$widgetTitle"))
                        .opacity(fraction <= progress ? 0.85 : 0.22)
                        .frame(width: 2.5, height: 2.5)
                        .position(point(fraction, width: geometry.size.width))
                }
                ForEach(0..<count, id: \.self) { index in
                    let reached = index < found
                    Circle()
                        .fill(reached ? Color("$accent") : (onDark ? Color("$widgetInk") : Color("$widgetBackground")))
                        .frame(width: count > 12 ? 6 : 10, height: count > 12 ? 6 : 10)
                        .overlay(Circle().strokeBorder(Color("$widgetTitle"), lineWidth: 1.5))
                        .position(point(Double(index + 1) / Double(max(1, count)), width: geometry.size.width))
                }
                Image(systemName: "flag.checkered")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(progress >= 1 ? Color("$accent") : (onDark ? Color.white.opacity(0.6) : Color("$widgetInk").opacity(0.5)))
                    .position(x: geometry.size.width - 20, y: 14)
                Image("guepard-activity")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 38, height: 38)
                    .position(x: point(progress, width: geometry.size.width).x,
                              y: point(progress, width: geometry.size.width).y - 20)
            }
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.65), value: found)
        }
        .frame(height: 56)
        // The adjacent counter already announces the same progress.
        .accessibilityHidden(true)
    }
}
