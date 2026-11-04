import Foundation
import Capacitor
import UIKit

/// Where the fold is (docs/plans/foldable-layout.md, step 3).
///
/// On iPhone Duo, UIKit describes the hinge as a DIVISION reserved region on
/// any view it crosses — active only while the device is partly open, absent
/// when it is flat or closed (`UIView.reservedRegions(kind:options:)`, iOS 27).
/// This plugin reads it off the WebView and answers in the WebView's own
/// coordinates, which are the page's CSS pixels, so `lib/fold.ts` can lay the
/// courtside scoreboard out on either side of it.
///
/// `posture` is the web Device Posture API's vocabulary: `folded` while a
/// division is active, `flat` otherwise, `unknown` on iOS before 27 (the
/// region API does not exist there, and nothing folds). There is no event for
/// a region changing that reaches a WebView, so the page asks again while the
/// scoreboard is open (`NATIVE_FOLD_POLL_MS`).
///
/// BUILDS ONLY WITH XCODE 27.1 OR LATER (the iOS 27 SDK declares the region
/// API). That is the toolchain the Duo needs anyway — Apple: "Build your app
/// with the latest version of Xcode to use all of the available screen space
/// on iPhone Duo" — and `native/README.md` says so. Registered in
/// `MainViewController`; the Android twin is `BpmFoldPlugin.java`.
@objc(BpmFoldPlugin)
public class BpmFoldPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BpmFoldPlugin"
    public let jsName = "BpmFold"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getFold", returnType: CAPPluginReturnPromise),
    ]

    @objc func getFold(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let view = self.bridge?.webView else {
                call.resolve(["posture": "unknown"])
                return
            }
            if #available(iOS 27.0, *) {
                // Active regions only (the default): an inactive division is a
                // flat phone, which is what `flat` says.
                let divisions = view.reservedRegions(kind: .division, options: [])
                if let division = divisions.first {
                    let f = division.frame
                    call.resolve([
                        "posture": "folded",
                        "fold": ["x": f.minX, "y": f.minY, "width": f.width, "height": f.height],
                    ])
                } else {
                    call.resolve(["posture": "flat", "fold": NSNull()])
                }
            } else {
                call.resolve(["posture": "unknown"])
            }
        }
    }
}
