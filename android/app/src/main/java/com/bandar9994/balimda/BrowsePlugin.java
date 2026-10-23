// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

package com.bandar9994.balimda;

import android.annotation.SuppressLint;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.net.Uri;
import android.net.http.SslError;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * The phone's browser for models ("Let models use a browser"): a web view of
 * the app's own, hidden behind the app, that the model drives with scripts
 * (see src/browser-native.js and src/browser-scripted.js).
 *
 * open() makes it; load({url}) resolves when the page has loaded, or rejects
 * saying why; stop() stops loading; eval({js}) resolves with {value}, the
 * script's result as text; snapshot() resolves with {data}, a JPEG (base64);
 * close() removes it.
 *
 * Only web pages (http, https) open in it. It can't download files, open other
 * windows (a link that would opens in it instead), or use the camera,
 * microphone or location.
 */
@CapacitorPlugin(name = "Browse")
public class BrowsePlugin extends Plugin {

    private WebView view;
    private PluginCall loading;

    private void finishLoad(String error) {
        PluginCall call = loading;
        loading = null;
        if (call == null) return;
        if (error == null) {
            JSObject out = new JSObject();
            out.put("url", view != null ? view.getUrl() : "");
            call.resolve(out);
        } else {
            call.reject(error);
        }
    }

    private static boolean isWeb(Uri uri) {
        String s = uri == null ? null : uri.getScheme();
        return "http".equals(s) || "https".equals(s);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void make() {
        if (view != null) return;
        WebView w = new WebView(getContext());
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setGeolocationEnabled(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        w.setDownloadListener((url, userAgent, contentDisposition, mimetype, length) -> { });
        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, false, false);
            }
        });
        w.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                return !isWeb(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                finishLoad(null);
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) finishLoad(String.valueOf(error.getDescription()));
            }

            @Override
            public void onReceivedSslError(WebView v, SslErrorHandler handler, SslError error) {
                handler.cancel();
                finishLoad("The website's security certificate isn't trusted, so it wasn't opened.");
            }
        });
        // Behind the app's own view: drawn and running, but out of sight.
        float density = getContext().getResources().getDisplayMetrics().density;
        ViewGroup.LayoutParams size = new ViewGroup.LayoutParams((int) (400 * density), (int) (860 * density));
        View app = getBridge().getWebView();
        ViewGroup parent = (ViewGroup) app.getParent();
        parent.addView(w, 0, size);
        w.setFocusable(false);
        w.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        view = w;
    }

    @PluginMethod
    public void open(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                make();
                call.resolve();
            } catch (Exception e) {
                call.reject("Couldn't start the browser: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void load(PluginCall call) {
        String url = call.getString("url", "");
        if (!isWeb(Uri.parse(url))) {
            call.reject("Only http and https pages can be opened.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            make();
            if (loading != null) loading.reject("Another page was opened.");
            loading = call;
            view.loadUrl(url);
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (view != null) view.stopLoading();
            finishLoad("Stopped.");
            call.resolve();
        });
    }

    @PluginMethod
    public void eval(PluginCall call) {
        String js = call.getString("js", "");
        getActivity().runOnUiThread(() -> {
            if (view == null) {
                call.reject("No page is open.");
                return;
            }
            view.evaluateJavascript(js, raw -> {
                JSObject out = new JSObject();
                try {
                    // The result comes as JSON: the scripts return text.
                    Object v = raw == null ? null : new JSONTokener(raw).nextValue();
                    out.put("value", v == null || v == JSONObject.NULL ? null : v.toString());
                } catch (Exception e) {
                    out.put("value", raw);
                }
                call.resolve(out);
            });
        });
    }

    @PluginMethod
    public void snapshot(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (view == null || view.getWidth() == 0 || view.getHeight() == 0) {
                call.reject("No page is open.");
                return;
            }
            try {
                Bitmap full = Bitmap.createBitmap(view.getWidth(), view.getHeight(), Bitmap.Config.ARGB_8888);
                view.draw(new Canvas(full));
                Bitmap small = full;
                if (full.getWidth() > 1024) {
                    small = Bitmap.createScaledBitmap(full, 1024, Math.round(full.getHeight() * 1024f / full.getWidth()), true);
                    full.recycle();
                }
                ByteArrayOutputStream jpeg = new ByteArrayOutputStream();
                small.compress(Bitmap.CompressFormat.JPEG, 70, jpeg);
                small.recycle();
                JSObject out = new JSObject();
                out.put("data", Base64.encodeToString(jpeg.toByteArray(), Base64.NO_WRAP));
                call.resolve(out);
            } catch (Exception e) {
                call.reject("Couldn't take the screenshot: " + e.getMessage());
            }
        });
    }

    private void remove() {
        finishLoad("The browser was closed.");
        if (view == null) return;
        WebView w = view;
        view = null;
        w.stopLoading();
        ViewGroup parent = (ViewGroup) w.getParent();
        if (parent != null) parent.removeView(w);
        w.destroy();
    }

    @PluginMethod
    public void close(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            remove();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (getActivity() != null) getActivity().runOnUiThread(this::remove);
    }
}
