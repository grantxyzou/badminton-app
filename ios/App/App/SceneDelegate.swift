import UIKit
import Capacitor
import AppShortcutsPlugin

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // MainViewController, not CAPBridgeViewController: it registers the
        // in-app plugins (BpmWidget, docs/plans/native-widgets.md). This file
        // builds the window in code, so Main.storyboard's class is never read.
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        // A long-press shortcut that LAUNCHED the app (lib/appShortcuts.ts).
        // The plugin holds the click until the web app's listener attaches.
        if let shortcutItem = connectionOptions.shortcutItem {
            postShortcut(shortcutItem)
        }

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    // A long-press shortcut tapped while the app was already running.
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        postShortcut(shortcutItem)
        completionHandler(true)
    }

    private func postShortcut(_ shortcutItem: UIApplicationShortcutItem) {
        NotificationCenter.default.post(
            name: NSNotification.Name(AppShortcutsPlugin.notificationName),
            object: nil,
            userInfo: [AppShortcutsPlugin.userInfoShortcutItemKey: shortcutItem]
        )
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
