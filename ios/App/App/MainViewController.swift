import UIKit
import Capacitor

/// The app's one view controller: Capacitor's bridge, plus the plugins that
/// live in this project rather than in a package. `Main.storyboard` names this
/// class; Capacitor finds packaged plugins on its own, but an in-app plugin has
/// to be registered here.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        // The home-screen widget's pass and redraws (docs/plans/native-widgets.md).
        bridge?.registerPluginInstance(BpmWidgetPlugin())
    }
}
