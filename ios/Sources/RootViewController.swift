import UIKit
import WebKit

/// Loads the built web app from the bundle and serves it from there.
///
/// The scheme is `glowlab://app/index.html`. A custom scheme is not a secure
/// context, which is the one architectural fact that changes how the app behaves
/// inside the wrapper: no SubtleCrypto and no service worker. Both are already
/// handled in the web layer — `src/engine/sha256.ts` computes the same digests
/// in JS, and `src/main.tsx` registers the worker inside a try/catch — so the
/// app boots and its own lock still opens. What that trade really costs is
/// written up in IOS_ALTSTORE.md rather than hidden here.
final class RootViewController: UIViewController {
    static let scheme = "glowlab"
    static let entry = "index.html"

    private var webView: WKWebView!
    private let handler = BundleSchemeHandler()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = GlowLabChrome.background

        let config = WKWebViewConfiguration()
        // Set before the view is created: WebKit will not accept a scheme
        // handler on a configuration that already has a web view attached.
        config.setURLSchemeHandler(handler, forURLScheme: Self.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // Her records are the point of the app. This store is the app's own
        // container and is not the browser's evictable website data.
        config.websiteDataStore = .default()

        let web = WKWebView(frame: view.bounds, configuration: config)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.isOpaque = true
        web.backgroundColor = GlowLabChrome.background
        web.scrollView.backgroundColor = GlowLabChrome.background
        // viewport-fit=cover plus env(safe-area-inset-*) in the CSS is what
        // positions the tab bar; the web view itself has to reach the edges.
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = true
        web.navigationDelegate = self
        web.uiDelegate = self
        if #available(iOS 16.4, *) {
            // Only for anyone who opens the wrapper through Safari to debug it.
            web.isInspectable = true
        }
        view.addSubview(web)
        webView = web

        guard handler.hasBundle else {
            showMissingBundle()
            return
        }
        if let url = handler.entryURL {
            webView.load(URLRequest(url: url))
        } else {
            showMissingBundle()
        }
    }

    private func showMissingBundle() {
        let label = UILabel()
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = GlowLabChrome.foreground
        label.backgroundColor = GlowLabChrome.background
        label.text = "Glow Lab ships its own copy of the app inside the bundle, and that copy is not here.\n\nRun  npm run build  and then  npm run ios:prepare  before building again."
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: view.layoutMarginsGuide.leadingAnchor, constant: 24)
        ])
    }
}

/// The colours the page paints before its own CSS arrives, so there is no white
/// flash on launch. Hard-coded because the wrapper cannot read a CSS variable
/// from a document it has not loaded yet.
enum GlowLabChrome {
    static let background = UIColor(red: 8.0 / 255.0, green: 7.0 / 255.0, blue: 10.0 / 255.0, alpha: 1)
    static let foreground = UIColor(red: 238.0 / 255.0, green: 232.0 / 255.0, blue: 235.0 / 255.0, alpha: 1)
}

extension RootViewController: WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showMissingBundle()
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 preferences: WKWebpagePreferences,
                 decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        // A download is an `<a download>` she tapped — the CSV export, the full
        // backup, a saved reference sheet. A WKWebView has no download manager,
        // so this hands it to the system and we pick it up in the download
        // delegate below.
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download, preferences)
            return
        }
        if navigationAction.navigationType == .linkActivated,
           let url = navigationAction.request.url,
           let scheme = url.scheme,
           scheme != Self.scheme {
            // Anything that is not the bundled app goes to Safari, so a link to
            // a tutorial or a product page opens as a real browser tab and she
            // sees where she has gone. The wrapper itself never fetches it.
            _ = UIApplication.shared.open(url)
            decisionHandler(.cancel, preferences)
            return
        }
        decisionHandler(.allow, preferences)
    }

    /// Answering `.download` above only hands the request to WebKit. The
    /// download arrives here, and it has no delegate until we give it one —
    /// without this the CSV export and the backup file are accepted, never
    /// written, and nothing says so.
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse response: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    // MARK: - WKDownloadDelegate

    func download(_ download: WKDownload,
                  decideDestinationUsing response: URLResponse,
                  suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let name = suggestedFilename.isEmpty ? "glow-lab-export" : suggestedFilename
        let target = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        // Written to the app's temporary directory, then offered to her through
        // the share sheet so she chooses where it goes — Files, a note, a
        // quick-transfer. Nothing is uploaded anywhere.
        completionHandler(target)
    }

    func downloadDidFinishDownloading(_ download: WKDownload) {
        guard let url = download.destinationURL else { return }
        DispatchQueue.main.async {
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = self.view
            sheet.popoverPresentationController?.sourceRect = CGRect(x: self.view.bounds.midX,
                                                                     y: self.view.bounds.maxY,
                                                                     width: 1, height: 1)
            self.present(sheet, animated: true)
        }
    }

    // MARK: - what is deliberately not here
    //
    // No `runOpenPanelWith` override and no media-capture permission delegate.
    // `<input type="file" capture>` is served by WebKit's own picker using the
    // two usage strings in Info.plist, and live camera through getUserMedia is
    // not available at all on a non-secure scheme — the web layer already falls
    // back to the picker, and inventing native code for a path that cannot run
    // would be the kind of claim this project does not make.
}

/// Serves files out of `Bundle.main/www`, and only out of that directory.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {

    private let root: URL?

    override init() {
        if let resources = Bundle.main.resourceURL {
            let candidate = resources.appendingPathComponent("www", isDirectory: true)
            var isDir: ObjCBool = false
            if FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDir), isDir.boolValue {
                root = candidate
            } else {
                root = nil
            }
        } else {
            root = nil
        }
        super.init()
    }

    var hasBundle: Bool { root != nil }

    var entryURL: URL? {
        guard hasBundle else { return nil }
        return URL(string: "\(RootViewController.scheme)://app/\(RootViewController.entry)")
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let requestURL = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(BundleSchemeError.badRequest)
            return
        }
        guard urlSchemeTask.request.httpMethod == "GET" || urlSchemeTask.request.httpMethod == "HEAD" else {
            // The app never makes one; the only writes are into IndexedDB.
            urlSchemeTask.didFailWithError(BundleSchemeError.methodNotAllowed)
            return
        }
        guard let file = resolve(requestURL) else {
            respond(urlSchemeTask, status: 404, mime: "text/plain; charset=utf-8", body: Data("Not in the bundle.".utf8))
            return
        }
        guard let data = try? Data(contentsOf: file) else {
            respond(urlSchemeTask, status: 500, mime: "text/plain; charset=utf-8", body: Data("Unreadable.".utf8))
            return
        }
        respond(urlSchemeTask, status: 200, mime: Self.mime(for: file), body: urlSchemeTask.request.httpMethod == "HEAD" ? Data() : data)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    /// `/` and `/anything-without-a-dot` fall back to index.html because the app
    /// is a single document with a hash router; a missing asset stays a 404 so
    /// the console says so instead of silently serving HTML with a .js name.
    private func resolve(_ url: URL) -> URL? {
        guard let root else { return nil }
        let path = url.path.isEmpty || url.path == "/" ? RootViewController.entry : String(url.path.dropFirst())
        if path.isEmpty { return nil }
        let candidate = root.appendingPathComponent(path).standardizedFileURL
        // Containment, checked after standardizing so `../../` cannot climb out
        // of the bundle directory.
        guard candidate.path.hasPrefix(root.standardizedFileURL.path + "/") || candidate.path == root.standardizedFileURL.path else {
            return nil
        }
        var isDir: ObjCBool = false
        if FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDir), !isDir.boolValue {
            return candidate
        }
        if path.contains(".") { return nil }
        let index = root.appendingPathComponent(RootViewController.entry).standardizedFileURL
        return FileManager.default.fileExists(atPath: index.path) ? index : nil
    }

    private func respond(_ task: WKURLSchemeTask, status: Int, mime: String, body: Data) {
        let headers = [
            "Content-Type": mime,
            "Content-Length": String(body.count),
            // The bundle is the only source; a fresh copy costs nothing and a
            // stale one is impossible, because it cannot change while installed.
            "Cache-Control": "no-cache"
        ]
        guard let response = HTTPURLResponse(url: task.request.url ?? URL(string: "glowlab://app/")!,
                                             statusCode: status,
                                             httpVersion: "HTTP/1.1",
                                             headerFields: headers) else {
            task.didFailWithError(BundleSchemeError.badRequest)
            return
        }
        task.didReceive(response)
        if !body.isEmpty { task.didReceive(body) }
        task.didFinish()
    }

    private static func mime(for file: URL) -> String {
        switch file.pathExtension.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json"
        case "webmanifest": return "application/manifest+json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "gif": return "image/gif"
        case "ico": return "image/x-icon"
        case "mp4": return "video/mp4"
        case "webm": return "video/webm"
        case "mp3": return "audio/mpeg"
        case "m4a": return "audio/mp4"
        case "wav": return "audio/wav"
        case "txt": return "text/plain; charset=utf-8"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        default: return "application/octet-stream"
        }
    }
}

enum BundleSchemeError: LocalizedError {
    case badRequest
    case methodNotAllowed

    var errorDescription: String? {
        switch self {
        case .badRequest: return "The wrapper could not work out what the page asked for."
        case .methodNotAllowed: return "Glow Lab only reads its own bundle; it never sends a request off the device."
        }
    }
}
