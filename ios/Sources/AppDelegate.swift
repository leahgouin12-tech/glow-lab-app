import UIKit

// THE GLOW LAB — iOS wrapper.
//
// It is one WKWebView that loads the built web app out of the app bundle. There
// is no native feature in here and nothing that talks to a server: everything
// she uses is the same React app, the same IndexedDB, the same switches.
//
// The reason to build it at all is where her records live. A Home Screen web app
// keeps its data in Safari's website store, which WebKit is free to reclaim;
// this container is the app's own, and it survives until the app is deleted.
// The cost is that a wrapper is not a browser: see IOS_ALTSTORE.md for which
// browser features behave differently, and what has not been verified on a
// device because nothing here could be compiled or installed on Windows.

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = RootViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
