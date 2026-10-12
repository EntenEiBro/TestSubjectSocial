package com.testsubjectsocial.game;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Online play through Epic Online Services for the Godot game (the twin of
 * eos_bridge.py on Windows; see godot/src/net/eos_link.gd).
 *
 * The EOS SDK (libEOSSDK.so + its Java helper from the EOS AAR) and the JNI
 * glue (libtss_eos.so, ../android/app/src/main/cpp/tss_eos.c, which binds to
 * this exact class and method names) do the work. This class starts them on
 * the first call, ticks the SDK on the main thread and queues its events;
 * the game collects them every frame with poll(). The product IDs come from
 * assets/eos/eos_config.json, packed into the plugin at build time.
 */
final class EosBridge {
    private static final String TAG = "TSS-EOS";
    private static final long TICK_MS = 4;

    private final Activity activity;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Object lock = new Object();
    private JSONArray pending = new JSONArray();

    private boolean started;
    private boolean running;
    private volatile String state = "idle";   // idle | starting | ready | error | unavailable
    private volatile String user, code, message;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            nativeTick();
            main.postDelayed(this, TICK_MS);
        }
    };

    EosBridge(Activity activity) {
        this.activity = activity;
    }

    // ------------------------------------------------------------ for the game

    String status() {
        ensureStarted();
        JSONObject o = new JSONObject();
        try {
            o.put("state", state);
            o.put("user", user == null ? JSONObject.NULL : user);
            o.put("code", code == null ? JSONObject.NULL : code);
            o.put("message", message == null ? JSONObject.NULL : message);
        } catch (JSONException ignored) { }
        return o.toString();
    }

    void host() { ensureStarted(); main.post(() -> { if (running) nativeHost(); }); }

    void join(String roomCode) { ensureStarted(); main.post(() -> { if (running) nativeJoin(roomCode); }); }

    /** batch: [[peer, channel, mode, text], ...] - everything the game sent in one frame. */
    void send(String batchJson) {
        final JSONArray batch;
        try { batch = new JSONArray(batchJson); } catch (JSONException e) { return; }
        main.post(() -> {
            if (!running) return;
            for (int i = 0; i < batch.length(); i++) {
                JSONArray m = batch.optJSONArray(i);
                if (m == null) continue;
                byte[] data = m.optString(3).getBytes(StandardCharsets.UTF_8);
                nativeSend(m.optString(0), m.optInt(1), m.optInt(2), data);
            }
        });
    }

    void stop() {
        code = null;
        main.post(() -> { if (running) nativeStop(); });
    }

    /** Events since the last call as a JSON array ("" when there are none). */
    String poll() {
        synchronized (lock) {
            if (pending.length() == 0) return "";
            String out = pending.toString();
            pending = new JSONArray();
            return out;
        }
    }

    // ------------------------------------------------------------ lifecycle

    void setForeground(boolean foreground) { main.post(() -> { if (running) nativeSetForeground(foreground); }); }

    void destroy() {
        main.post(() -> {
            if (!running) return;
            nativeStop();
            nativeTick();
            running = false;
        });
    }

    private synchronized void ensureStarted() {
        if (started) return;
        started = true;
        state = "starting";
        main.post(this::start);
    }

    private void start() {
        JSONObject cfg = readConfig();
        if (cfg == null) { unavailable("online play is not included in this build"); return; }
        try {
            System.loadLibrary("EOSSDK");
            System.loadLibrary("tss_eos");
            // The SDK's Java helper needs the activity (by reflection, so this compiles without the SDK).
            Class.forName("com.epicgames.mobile.eossdk.EOSSDK").getMethod("init", Activity.class).invoke(null, activity);
        } catch (Throwable t) {
            Log.w(TAG, "EOS SDK not available", t);
            unavailable("online play is not included in this build");
            return;
        }
        running = nativeInit(cfg.optString("productName", "Test Subject Social"), cfg.optString("productVersion", "1.0"),
                cfg.optString("productId"), cfg.optString("sandboxId"), cfg.optString("deploymentId"),
                cfg.optString("clientId"), cfg.optString("clientSecret"), activity.getFilesDir().getAbsolutePath());
        if (!running) {
            if (!"error".equals(state)) { state = "error"; message = "EOS could not start"; }
            return;
        }
        main.post(tick);
    }

    private void unavailable(String why) {
        message = why;
        state = "unavailable";
    }

    private JSONObject readConfig() {
        try (InputStream in = activity.getAssets().open("eos/eos_config.json")) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            for (int r; (r = in.read(buf)) > 0; ) bos.write(buf, 0, r);
            return new JSONObject(bos.toString("UTF-8"));
        } catch (Exception e) {
            return null;
        }
    }

    // ------------------------------------------------------------ from native

    /**
     * Called by tss_eos.c (main thread). Meaning of the fields per type:
     * ready (peer = our user id), hosted (text = room code), joined (peer = host),
     * peer-open / peer-closed (peer, num = reason), msg (peer, channel, data),
     * error (peer = operation, num = EOS result code, text = message).
     */
    @SuppressWarnings("unused")
    private void onEvent(String type, String peer, int channel, byte[] data, int num, String text) {
        JSONObject e = new JSONObject();
        try {
            e.put("type", type);
            switch (type) {
                case "ready":
                    user = peer; state = "ready"; message = null;
                    e.put("user", peer);
                    break;
                case "hosted":
                    code = text;
                    e.put("code", text);
                    break;
                case "joined":
                    e.put("host", peer);
                    break;
                case "msg":
                    e.put("peer", peer);
                    e.put("ch", channel);
                    e.put("data", new String(data, StandardCharsets.UTF_8));
                    break;
                case "error":
                    if ("login".equals(peer) || "init".equals(peer)) { state = "error"; message = text + " (" + num + ")"; }
                    e.put("op", peer);
                    e.put("code", num);
                    e.put("message", text);
                    break;
                default: // peer-open, peer-closed
                    e.put("peer", peer);
                    e.put("reason", num);
                    break;
            }
        } catch (JSONException ignored) { }
        synchronized (lock) { pending.put(e); }
    }

    private native boolean nativeInit(String productName, String productVersion, String productId, String sandboxId,
                                      String deploymentId, String clientId, String clientSecret, String dir);
    private native void nativeTick();
    private native void nativeHost();
    private native void nativeJoin(String roomCode);
    private native void nativeSend(String peer, int channel, int mode, byte[] data);
    private native void nativeStop();
    private native void nativeSetForeground(boolean foreground);
}
