package com.testsubjectsocial.game;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

/**
 * Thin wrapper around the phone's vibration motor for the game's haptics.
 *
 * - predefined("tick" | "click" | "heavy") uses the system's tuned effects
 *   (Android 10+), which feel crisp on modern phones like the Pixel.
 * - waveform(...) plays shaped pulses with per-step strength when the motor
 *   supports amplitude control, otherwise plain on/off timings.
 *
 * All calls are cheap and safe to make from the WebView's bridge thread.
 */
final class Haptics {
    private final Vibrator vibrator;

    Haptics(Context context) {
        Vibrator v;
        if (Build.VERSION.SDK_INT >= 31) {
            VibratorManager vm = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            v = vm != null ? vm.getDefaultVibrator() : null;
        } else {
            v = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        }
        vibrator = (v != null && v.hasVibrator()) ? v : null;
    }

    void predefined(String kind) {
        if (vibrator == null) return;
        if (Build.VERSION.SDK_INT >= 29) {
            int effect = "heavy".equals(kind) ? VibrationEffect.EFFECT_HEAVY_CLICK
                    : "click".equals(kind) ? VibrationEffect.EFFECT_CLICK
                    : VibrationEffect.EFFECT_TICK;
            vibrator.vibrate(VibrationEffect.createPredefined(effect));
        } else {
            int ms = "heavy".equals(kind) ? 40 : "click".equals(kind) ? 20 : 10;
            oneShot(ms, 255);
        }
    }

    void waveform(String timingsCsv, String amplitudesCsv) {
        if (vibrator == null) return;
        long[] timings;
        int[] amps;
        try {
            String[] t = timingsCsv.split(","), a = amplitudesCsv.split(",");
            if (t.length == 0 || t.length != a.length || t.length > 32) return;
            timings = new long[t.length];
            amps = new int[a.length];
            for (int i = 0; i < t.length; i++) {
                timings[i] = Math.max(0, Math.min(2000, Long.parseLong(t[i].trim())));
                amps[i] = Math.max(0, Math.min(255, Integer.parseInt(a[i].trim())));
            }
        } catch (NumberFormatException e) {
            return;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            if (vibrator.hasAmplitudeControl()) {
                vibrator.vibrate(VibrationEffect.createWaveform(timings, amps, -1));
            } else {
                vibrator.vibrate(VibrationEffect.createWaveform(timings, -1));
            }
        } else {
            vibrateLegacy(timings);
        }
    }

    private void oneShot(int ms, int amplitude) {
        if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createOneShot(ms, amplitude));
        else vibrateLegacy(new long[] {0, ms});
    }

    @SuppressWarnings("deprecation")
    private void vibrateLegacy(long[] timings) {
        vibrator.vibrate(timings, -1);
    }
}
