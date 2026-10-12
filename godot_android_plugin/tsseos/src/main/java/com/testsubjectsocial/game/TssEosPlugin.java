package com.testsubjectsocial.game;

import org.godotengine.godot.Godot;
import org.godotengine.godot.plugin.GodotPlugin;
import org.godotengine.godot.plugin.UsedByGodot;

/**
 * Godot plugin "TssEos": exposes EosBridge to GDScript as
 * Engine.get_singleton("TssEos") with status / host / join / send / stop / poll
 * (see godot/src/net/eos_link.gd).
 */
public class TssEosPlugin extends GodotPlugin {
    private EosBridge bridge;

    public TssEosPlugin(Godot godot) {
        super(godot);
    }

    @Override
    public String getPluginName() {
        return "TssEos";
    }

    private EosBridge bridge() {
        if (bridge == null) bridge = new EosBridge(getActivity());
        return bridge;
    }

    @UsedByGodot
    public String status() { return bridge().status(); }

    @UsedByGodot
    public void host() { bridge().host(); }

    @UsedByGodot
    public void join(String code) { bridge().join(code); }

    @UsedByGodot
    public void send(String batchJson) { bridge().send(batchJson); }

    @UsedByGodot
    public void stop() { bridge().stop(); }

    @UsedByGodot
    public String poll() { return bridge == null ? "" : bridge.poll(); }

    @Override
    public void onMainPause() {
        if (bridge != null) bridge.setForeground(false);
    }

    @Override
    public void onMainResume() {
        if (bridge != null) bridge.setForeground(true);
    }

    @Override
    public void onMainDestroy() {
        if (bridge != null) bridge.destroy();
    }
}
