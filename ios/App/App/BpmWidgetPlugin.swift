import Foundation
import Capacitor
import WidgetKit

/// The app's side of the home-screen widget (docs/plans/native-widgets.md).
///
/// The widget runs in its own process and cannot read the WebView's cookies,
/// so the web app (lib/widgetBridge.ts) mints the widget's own pass and hands
/// it here. It is kept in the App Group the widget extension shares with the
/// app — the only storage both can read — and every write asks WidgetKit to
/// redraw.
///
/// `BPMWidgetStore.swift` in the extension reads the same keys; change them in
/// both places or the widget reads nothing.
@objc(BpmWidgetPlugin)
public class BpmWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BpmWidgetPlugin"
    public let jsName = "BpmWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scoreSaved", returnType: CAPPluginReturnPromise),
    ]

    static let appGroup = "group.com.motioncraft.bpm"
    static let tokenKey = "widget.token"
    static let expiresKey = "widget.expiresAt"
    static let baseUrlKey = "widget.baseUrl"
    static let snapshotKey = "widget.snapshot"
    /// The score widget's game (BPMScoreWidget.swift `ScoreStore`): cleared on
    /// sign-out with the rest, and the parked game dropped once Add a game
    /// has logged it.
    static let scoreKeys = ["score.game", "score.pending", "score.gamesTonight"]
    static let scorePendingKey = "score.pending"

    private var store: UserDefaults? { UserDefaults(suiteName: Self.appGroup) }

    /// https anywhere, or plain http on localhost ITSELF — parsed, never a
    /// string prefix: `http://localhost.example.com` starts with
    /// `http://localhost` and is somebody else's server.
    static func isAllowedBaseUrl(_ raw: String) -> Bool {
        guard let url = URL(string: raw), let scheme = url.scheme?.lowercased() else { return false }
        if scheme == "https" { return true }
        return scheme == "http" && url.host?.lowercased() == "localhost"
    }

    @objc func setSession(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.isEmpty,
              let baseUrl = call.getString("baseUrl"), Self.isAllowedBaseUrl(baseUrl)
        else {
            call.reject("token and an https baseUrl are required")
            return
        }
        guard let store = store else {
            call.reject("App Group \(Self.appGroup) is not available")
            return
        }
        // A different person on this phone: the last one's week must not show
        // for a moment under the new pass.
        if store.string(forKey: Self.tokenKey) != token {
            store.removeObject(forKey: Self.snapshotKey)
        }
        store.set(token, forKey: Self.tokenKey)
        store.set(call.getString("expiresAt") ?? "", forKey: Self.expiresKey)
        store.set(baseUrl, forKey: Self.baseUrlKey)
        Self.reloadTimelines()
        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        if let store = store {
            for key in [Self.tokenKey, Self.expiresKey, Self.baseUrlKey, Self.snapshotKey] + Self.scoreKeys {
                store.removeObject(forKey: key)
            }
        }
        Self.reloadTimelines()
        call.resolve()
    }

    @objc func reload(_ call: CAPPluginCall) {
        Self.reloadTimelines()
        call.resolve()
    }

    /// Add a game logged the score the widget was holding (lib/gameIntent.ts).
    @objc func scoreSaved(_ call: CAPPluginCall) {
        store?.removeObject(forKey: Self.scorePendingKey)
        // A finished game still on screen is the one just saved too.
        if let store = store, let data = store.data(forKey: "score.game"),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let points = json["points"] as? [String] {
            var a = 0, b = 0
            for pt in points { if pt == "a" { a += 1 } else { b += 1 } }
            let over = a >= 30 || b >= 30 || (a >= 21 && a - b >= 2) || (b >= 21 && b - a >= 2)
            if over { store.removeObject(forKey: "score.game") }
        }
        Self.reloadTimelines()
        call.resolve()
    }

    static func reloadTimelines() {
        WidgetCenter.shared.reloadAllTimelines()
    }
}
