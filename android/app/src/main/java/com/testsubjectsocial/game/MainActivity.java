package com.testsubjectsocial.game;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Full-screen landscape game activity.
 *
 * Starts the in-app {@link GameServer} and shows the game in a WebView at
 * http://127.0.0.1:8765/. Inside the game, back acts as Esc (pause / back).
 * Online play goes through Epic Online Services ({@link EosBridge}).
 */
public class MainActivity extends Activity {
    private static final String HOME = "http://127.0.0.1:" + GameServer.PORT + "/";

    private GameServer server;
    private WebView web;

    /** Methods the game page can call as window.AndroidBridge.<name>(). */
    public final class Bridge {
        @JavascriptInterface
        public void quit() { runOnUiThread(MainActivity.this::finish); }

        /** Crisp system haptic: "tick" (lightest), "click" or "heavy". */
        @JavascriptInterface
        public void haptic(String kind) { haptics.predefined(kind); }

        /** Shaped vibration: comma-separated timings (ms) and amplitudes (0-255). */
        @JavascriptInterface
        public void vibrate(String timingsCsv, String amplitudesCsv) { haptics.waveform(timingsCsv, amplitudesCsv); }
    }

    private Haptics haptics;
    private EosBridge eos;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        haptics = new Haptics(this);
        server = new GameServer(getAssets());
        server.start(); // if the port is taken, an earlier instance is still serving

        // Lets the PC inspect the game over USB debugging (chrome://inspect) — only
        // reachable through adb, so it has no effect for normal players.
        WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // settings + commendations
        s.setMediaPlaybackRequiresUserGesture(false); // game audio from the first frame
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        eos = new EosBridge(this, web);
        web.addJavascriptInterface(eos, "AndroidEOS");
        setContentView(web);
        enterImmersive();
        // Optional start path for testing over adb: am start ... --es path "?game=chisel"
        String path = getIntent().getStringExtra("path");
        web.loadUrl(path != null ? HOME + path : HOME);
    }

    /** Hide status and navigation bars (swipe from an edge to show them briefly). */
    @SuppressWarnings("deprecation")
    private void enterImmersive() {
        // Draw under the camera cutout too; otherwise Android shifts the whole
        // app away from the cutout side and the game ends up off-centre.
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersive();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        // Behave like Esc (pause / back in menus).
        web.evaluateJavascript(
                "window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',key:'Escape'}));"
                        + "setTimeout(function(){window.dispatchEvent(new KeyboardEvent('keyup',{code:'Escape',key:'Escape'}));},80);",
                null);
    }

    /**
     * Leaving the app (home button, app switcher, screen off): tell the game to
     * mute its audio and pause the current round, then freeze the WebView's
     * JavaScript timers so nothing keeps running in the background.
     */
    @Override
    protected void onPause() {
        super.onPause();
        web.evaluateJavascript("window.__onAppPause && window.__onAppPause();", ignored -> web.pauseTimers());
        web.onPause();
        eos.setForeground(false);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.resumeTimers();
        web.onResume();
        eos.setForeground(true);
        web.evaluateJavascript("window.__onAppResume && window.__onAppResume();", null);
        enterImmersive();
    }

    @Override
    protected void onDestroy() {
        eos.destroy();
        web.destroy();
        server.stop();
        super.onDestroy();
    }
}
