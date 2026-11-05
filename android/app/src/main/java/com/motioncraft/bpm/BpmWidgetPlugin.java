package com.motioncraft.bpm;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * The app's side of the home-screen widget (docs/plans/native-widgets.md).
 *
 * The widget draws outside the WebView and cannot read its cookies, so the
 * web app (lib/widgetBridge.ts) mints the widget's own pass and hands it here.
 * Registered in {@link MainActivity}; the iPhone twin is BpmWidgetPlugin.swift.
 */
@CapacitorPlugin(name = "BpmWidget")
public class BpmWidgetPlugin extends Plugin {

    /**
     * The app's own hosts. Any https address was accepted until 2026-11-05
     * (audit): the pass is a credential, and only the app's own server should
     * ever be handed one. motioncraft-bpm.com is the domain the app is moving
     * to, allowed ahead so the move does not switch widgets off until the next
     * store build. BpmWidgetPlugin.swift holds the same list, and
     * __tests__/native-shell-projects.test.ts pins both to capacitor.config.ts.
     */
    static final Set<String> ALLOWED_HOSTS = new HashSet<>(Arrays.asList(
        "bpm.grantzou.com", "vnext-badminton-app.azurewebsites.net", "motioncraft-bpm.com"));
    static final String ALLOWED_HOST_SUFFIX = ".motioncraft-bpm.com";

    /** Parsed, never a string prefix: https://bpm.grantzou.com.evil.example starts with the right text. */
    static boolean isAllowedBaseUrl(String raw) {
        if (raw == null) return false;
        try {
            URI uri = new URI(raw);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null || !scheme.equalsIgnoreCase("https")) return false;
            host = host.toLowerCase(Locale.ROOT);
            return ALLOWED_HOSTS.contains(host) || host.endsWith(ALLOWED_HOST_SUFFIX);
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void setSession(PluginCall call) {
        String token = call.getString("token");
        String baseUrl = call.getString("baseUrl");
        if (token == null || token.isEmpty() || !isAllowedBaseUrl(baseUrl)) {
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
