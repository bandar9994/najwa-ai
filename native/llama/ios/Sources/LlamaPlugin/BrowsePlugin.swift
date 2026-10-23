// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

import Capacitor
import Foundation
import UIKit
import WebKit

/**
 * The phone's browser for models ("Let models use a browser"): a web view of
 * the app's own, hidden behind the app, that the model drives with scripts
 * (see src/browser-native.js and src/browser-scripted.js). Same plugin name
 * and methods as the Android BrowsePlugin.java.
 *
 * open() makes it; load({url}) resolves when the page has loaded, or rejects
 * saying why; stop() stops loading; eval({js}) resolves with {value}, the
 * script's result as text; snapshot() resolves with {data}, a JPEG (base64);
 * close() removes it.
 *
 * It keeps nothing: its cookies and storage are in memory only, and gone
 * when it's closed. Only web pages (http, https) open in it; it can't use
 * the camera or microphone, and a link that would open a new window opens
 * in it instead.
 */
@objc(BrowsePlugin)
public class BrowsePlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate, WKUIDelegate {
    public let identifier = "BrowsePlugin"
    public let jsName = "Browse"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "eval", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "snapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise)
    ]

    // Only touched on the main thread.
    private var web: WKWebView?
    private var loading: CAPPluginCall?

    private func isWeb(_ url: URL?) -> Bool {
        let scheme = url?.scheme?.lowercased()
        return scheme == "http" || scheme == "https"
    }

    private func make() -> WKWebView? {
        if let web = web { return web }
        // Behind the app's own view: drawn and running, but out of sight.
        guard let window = bridge?.viewController?.view.window else { return nil }
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.mediaTypesRequiringUserActionForPlayback = .all
        config.allowsInlineMediaPlayback = false
        let w = WKWebView(frame: CGRect(x: 0, y: 0, width: 400, height: 860), configuration: config)
        w.navigationDelegate = self
        w.uiDelegate = self
        w.isUserInteractionEnabled = false
        w.accessibilityElementsHidden = true
        window.insertSubview(w, at: 0)
        web = w
        return w
    }

    private func finishLoad(_ error: String?) {
        guard let call = loading else { return }
        loading = nil
        if let error = error {
            call.reject(error)
        } else {
            call.resolve(["url": web?.url?.absoluteString ?? ""])
        }
    }

    @objc func open(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.make() == nil {
                call.reject("Couldn't start the browser.")
            } else {
                call.resolve()
            }
        }
    }

    @objc func load(_ call: CAPPluginCall) {
        guard let url = URL(string: call.getString("url") ?? ""), isWeb(url) else {
            call.reject("Only http and https pages can be opened.")
            return
        }
        DispatchQueue.main.async {
            guard let web = self.make() else {
                call.reject("Couldn't start the browser.")
                return
            }
            self.loading?.reject("Another page was opened.")
            self.loading = call
            web.load(URLRequest(url: url, timeoutInterval: 25))
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.web?.stopLoading()
            self.finishLoad("Stopped.")
            call.resolve()
        }
    }

    @objc func eval(_ call: CAPPluginCall) {
        let js = call.getString("js") ?? ""
        DispatchQueue.main.async {
            guard let web = self.web else {
                call.reject("No page is open.")
                return
            }
            web.evaluateJavaScript(js) { result, error in
                if let error = error {
                    call.reject(error.localizedDescription)
                } else if let text = result as? String {
                    call.resolve(["value": text])
                } else {
                    call.resolve(["value": NSNull()])
                }
            }
        }
    }

    @objc func snapshot(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let web = self.web else {
                call.reject("No page is open.")
                return
            }
            let config = WKSnapshotConfiguration()
            config.snapshotWidth = NSNumber(value: 512) // points: about 1,000-1,500 pixels wide
            web.takeSnapshot(with: config) { image, error in
                guard let jpeg = image?.jpegData(compressionQuality: 0.7) else {
                    call.reject(error?.localizedDescription ?? "Couldn't take the screenshot.")
                    return
                }
                call.resolve(["data": jpeg.base64EncodedString()])
            }
        }
    }

    private func remove() {
        finishLoad("The browser was closed.")
        guard let web = web else { return }
        self.web = nil
        web.stopLoading()
        web.navigationDelegate = nil
        web.uiDelegate = nil
        web.removeFromSuperview()
    }

    @objc func close(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.remove()
            call.resolve()
        }
    }

    // MARK: - WKNavigationDelegate

    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard isWeb(navigationAction.request.url) else {
            decisionHandler(.cancel)
            return
        }
        // A link meant for a new window opens here.
        if navigationAction.targetFrame == nil {
            webView.load(navigationAction.request)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    public func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        // No downloads: only what a web view can show.
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .cancel)
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        finishLoad(nil)
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        failed(error)
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        failed(error)
    }

    private func failed(_ error: Error) {
        let e = error as NSError
        // A page that replaced itself (a redirect, a new link) isn't a failure.
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        finishLoad(e.localizedDescription)
    }

    // MARK: - WKUIDelegate

    public func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                        for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if isWeb(navigationAction.request.url) { webView.load(navigationAction.request) }
        return nil
    }

    @available(iOS 15.0, *)
    public func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                        initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                        decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.deny)
    }
}
