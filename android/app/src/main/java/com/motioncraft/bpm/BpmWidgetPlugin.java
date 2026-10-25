package com.motioncraft.bpm;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The app's side of the home-screen widget (docs/plans/native-widgets.md).
 *
 * The widget draws outside the WebView and cannot read its cookies, so the
 * web app (lib/widgetBridge.ts) mints the widget's own pass and hands it here.
 * Registered in {@link MainActivity}; the iPhone twin is BpmWidgetPlugin.swift.
 */
@CapacitorPlugin(name = "BpmWidget")
public class BpmWidgetPlugin extends Plugin {

    @PluginMethod
    public void setSession(PluginCall call) {
        String token = call.getString("token");
        String baseUrl = call.getString("baseUrl");
        if (token == null || token.isEmpty() || baseUrl == null || !baseUrl.startsWith("https://")) {
            call.reject("token and an https baseUrl are required");
            return;
        }
        String expiresAt = call.getString("expiresAt", "");
        BpmWidgetStore.setSession(getContext(), token, expiresAt == null ? "" : expiresAt, baseUrl);
        BpmWidgetProvider.refreshAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        BpmWidgetStore.clear(getContext());
        BpmWidgetProvider.redrawAll(getContext());
        // Sign-out forgets the score widget's game too — a shared phone.
        BpmScoreStore.clear(getContext());
        BpmScoreWidgetProvider.redrawAll(getContext());
        call.resolve();
    }

    /** Add a game saved the score the widget was holding (lib/gameIntent.ts) —
     *  which one, when the app says (a and b); -1 means it did not. */
    @PluginMethod
    public void scoreSaved(PluginCall call) {
        Integer a = call.getInt("a");
        Integer b = call.getInt("b");
        boolean known = a != null && b != null;
        BpmScoreStore.gameSaved(getContext(), known ? a : -1, known ? b : -1);
        BpmScoreWidgetProvider.redrawAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void reload(PluginCall call) {
        BpmWidgetProvider.refreshAll(getContext());
        call.resolve();
    }
}
