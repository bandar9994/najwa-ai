// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

package com.bandaraltariqi.najwa;

import android.annotation.SuppressLint;
import android.app.Presentation;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
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
import java.nio.ByteBuffer;
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
 *
 * It's shown on a screen of its own that nobody sees (a private virtual
 * display), so the phone draws pages with its graphics chip exactly like
 * Chrome, and screenshots are what was really drawn. (Drawing a web view into
 * a picture by hand misses effects like blur and layered parts, so pages
 * looked broken.) If that screen can't be made, it sits behind the app.
 */
@CapacitorPlugin(name = "Browse")
public class BrowsePlugin extends Plugin {

    private static final int WIDTH_DP = 400;
    private static final int HEIGHT_DP = 860;

    private WebView view;
    private PluginCall loading;
    // Its own screen, and the latest picture drawn on it.
    private ImageReader reader;
    private VirtualDisplay screen;
    private Presentation stage;
    private Image frame;  // the latest picture drawn on it (kept, converted only for a screenshot)
    private int frameWidth;
    private int frameHeight;

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

    // Keeps the latest picture drawn on the browser's own screen.
    private void keepFrame(ImageReader r) {
        try {
            Image img = r.acquireLatestImage();
            if (img == null) return;
            if (frame != null) frame.close();
            frame = img;
        } catch (Exception ignored) {
            // keep the previous picture
        }
    }

    // The kept picture as a bitmap, or null.
    private Bitmap frameBitmap() {
        if (frame == null) return null;
        try {
            Image.Plane plane = frame.getPlanes()[0];
            int pixel = plane.getPixelStride();
            int padding = plane.getRowStride() - pixel * frameWidth;
            ByteBuffer buffer = plane.getBuffer();
            buffer.rewind();
            Bitmap padded = Bitmap.createBitmap(frameWidth + padding / pixel, frameHeight, Bitmap.Config.ARGB_8888);
            padded.copyPixelsFromBuffer(buffer);
            if (padding == 0) return padded;
            Bitmap exact = Bitmap.createBitmap(padded, 0, 0, frameWidth, frameHeight);
            padded.recycle();
            return exact;
        } catch (Exception e) {
            return null;
        }
    }

    // The browser's own screen: returns the context to make the web view in,
    // or null if this phone can't make one.
    private Context makeScreen() {
        try {
            DisplayMetrics dm = getContext().getResources().getDisplayMetrics();
            int width = Math.round(WIDTH_DP * dm.density);
            int height = Math.round(HEIGHT_DP * dm.density);
            frameWidth = width;
            frameHeight = height;
            reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 3);
            reader.setOnImageAvailableListener(this::keepFrame, new Handler(Looper.getMainLooper()));
            DisplayManager displays = (DisplayManager) getContext().getSystemService(Context.DISPLAY_SERVICE);
            screen = displays.createVirtualDisplay("Najwa AI browser", width, height, dm.densityDpi, reader.getSurface(),
                DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY);
            stage = new Presentation(getActivity(), screen.getDisplay());
            // It never takes the keyboard or touches from the app.
            stage.getWindow().addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE);
            return stage.getContext();
        } catch (Exception e) {
            removeScreen();
            return null;
        }
    }

    private void removeScreen() {
        if (stage != null) {
            try {
                stage.dismiss();
            } catch (Exception ignored) {
                // already gone
            }
        }
        stage = null;
        if (screen != null) screen.release();
        screen = null;
        if (frame != null) frame.close();
        frame = null;
        if (reader != null) reader.close();
        reader = null;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void make() {
        if (view != null) return;
        Context screenContext = makeScreen();
        WebView w = new WebView(screenContext != null ? screenContext : getContext());
        WebSettings s = w.getSettings();
        // Look like Chrome: some sites serve apps' web views ("wv") a different page.
        s.setUserAgentString(s.getUserAgentString().replace("; wv)", ")"));
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
        boolean shown = false;
        if (stage != null) {
            try {
                stage.setContentView(w, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                stage.show();
                shown = true;
            } catch (Exception e) {
                removeScreen();
            }
        }
        if (!shown) {
            // Behind the app's own view: drawn and running, but out of sight.
            float density = getContext().getResources().getDisplayMetrics().density;
            ViewGroup.LayoutParams size = new ViewGroup.LayoutParams((int) (WIDTH_DP * density), (int) (HEIGHT_DP * density));
            View app = getBridge().getWebView();
            ViewGroup parent = (ViewGroup) app.getParent();
            parent.addView(w, 0, size);
        }
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
                // What was really drawn on the browser's own screen.
                Bitmap full = frameBitmap();
                if (full == null) {
                    full = Bitmap.createBitmap(view.getWidth(), view.getHeight(), Bitmap.Config.ARGB_8888);
                    view.draw(new Canvas(full));
                }
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
        if (view == null) {
            removeScreen();
            return;
        }
        WebView w = view;
        view = null;
        w.stopLoading();
        ViewGroup parent = (ViewGroup) w.getParent();
        if (parent != null) parent.removeView(w);
        w.destroy();
        removeScreen();
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
