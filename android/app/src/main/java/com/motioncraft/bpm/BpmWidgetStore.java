package com.motioncraft.bpm;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * What the widget knows and how it asks for more (docs/plans/native-widgets.md).
 *
 * The app hands the widget a pass through {@link BpmWidgetPlugin}; it is kept
 * in this app's private preferences, which the widget (part of the same app on
 * Android) reads directly. The calls mirror the iPhone widget's
 * BPMWidgetStore.swift: GET /api/widget, and POST / DELETE /api/widget/join.
 */
final class BpmWidgetStore {
    private static final String PREFS = "bpm_widget";
    static final String KEY_TOKEN = "token";
    static final String KEY_EXPIRES = "expiresAt";
    static final String KEY_BASE_URL = "baseUrl";
    private static final String KEY_SNAPSHOT = "snapshot";
    private static final String KEY_UNDO_UNTIL = "undoUntil";
    private static final String KEY_FAILURE = "failure";
    private static final String KEY_FAILURE_AT = "failureAt";

    static final String FAILURE_JOIN = "join";
    static final String FAILURE_UNDO = "undo";

    /** No pass, an expired one, or a member no longer on the roster. */
    static final class SignedOutException extends Exception {
        private static final long serialVersionUID = 1L;
    }

    /** The server said no — sign-ups closed, full, a late-cancel window. */
    static final class RefusedException extends Exception {
        private static final long serialVersionUID = 1L;
        final int status;

        RefusedException(int status) {
            super("HTTP " + status);
            this.status = status;
        }
    }

    private BpmWidgetStore() {}

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void setSession(Context context, String token, String expiresAt, String baseUrl) {
        SharedPreferences p = prefs(context);
        SharedPreferences.Editor e = p.edit();
        // A different person on this phone: the last one's week must not show
        // for a moment under the new pass.
        if (!token.equals(p.getString(KEY_TOKEN, null))) e.remove(KEY_SNAPSHOT);
        e.putString(KEY_TOKEN, token).putString(KEY_EXPIRES, expiresAt).putString(KEY_BASE_URL, baseUrl).apply();
    }

    static void clear(Context context) {
        prefs(context).edit().clear().apply();
    }

    static boolean hasPass(Context context) {
        String token = prefs(context).getString(KEY_TOKEN, null);
        return token != null && !token.isEmpty();
    }

    // ── The last snapshot, shown under its "Updated" time when a read fails ──

    static JSONObject cachedSnapshot(Context context) {
        String raw = prefs(context).getString(KEY_SNAPSHOT, null);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (JSONException e) {
            return null;
        }
    }

    static void saveSnapshot(Context context, JSONObject snapshot) {
        prefs(context).edit().putString(KEY_SNAPSHOT, snapshot.toString()).apply();
    }

    static void forgetSnapshot(Context context) {
        prefs(context).edit().remove(KEY_SNAPSHOT).apply();
    }

    // ── Undo, for a few minutes after a Join from the widget ──

    static void offerUndo(Context context) {
        prefs(context).edit().putLong(KEY_UNDO_UNTIL, System.currentTimeMillis() + 5 * 60 * 1000L).apply();
    }

    static void withdrawUndo(Context context) {
        prefs(context).edit().remove(KEY_UNDO_UNTIL).apply();
    }

    static boolean undoOffered(Context context) {
        return System.currentTimeMillis() < prefs(context).getLong(KEY_UNDO_UNTIL, 0L);
    }

    // ── The last thing a tap could not do — never a silent fail ──

    static void noteFailure(Context context, String failure) {
        prefs(context).edit().putString(KEY_FAILURE, failure).putLong(KEY_FAILURE_AT, System.currentTimeMillis()).apply();
    }

    static void clearFailure(Context context) {
        prefs(context).edit().remove(KEY_FAILURE).remove(KEY_FAILURE_AT).apply();
    }

    /** Shown for ten minutes, then the widget goes back to the week. */
    static String recentFailure(Context context) {
        SharedPreferences p = prefs(context);
        String failure = p.getString(KEY_FAILURE, null);
        if (failure == null) return null;
        return System.currentTimeMillis() - p.getLong(KEY_FAILURE_AT, 0L) < 10 * 60 * 1000L ? failure : null;
    }

    // ── The three calls ──

    static JSONObject fetchSnapshot(Context context) throws IOException, SignedOutException, RefusedException {
        JSONObject snapshot = parse(send(context, "api/widget", "GET", null));
        saveSnapshot(context, snapshot);
        return snapshot;
    }

    static void join(Context context, boolean waitlist) throws IOException, SignedOutException, RefusedException {
        keepSnapshotFrom(context, send(context, "api/widget/join", "POST", "{\"waitlist\":" + waitlist + "}"));
    }

    static void undo(Context context) throws IOException, SignedOutException, RefusedException {
        keepSnapshotFrom(context, send(context, "api/widget/join", "DELETE", "{}"));
    }

    private static void keepSnapshotFrom(Context context, String body) {
        try {
            JSONObject snapshot = new JSONObject(body).optJSONObject("snapshot");
            if (snapshot != null) saveSnapshot(context, snapshot);
        } catch (JSONException ignored) {
            // The action landed; the next refresh redraws.
        }
    }

    private static JSONObject parse(String body) throws IOException {
        try {
            return new JSONObject(body);
        } catch (JSONException e) {
            throw new IOException("bad snapshot", e);
        }
    }

    private static String send(Context context, String path, String method, String body)
            throws IOException, SignedOutException, RefusedException {
        SharedPreferences p = prefs(context);
        String token = p.getString(KEY_TOKEN, null);
        String base = p.getString(KEY_BASE_URL, null);
        if (token == null || token.isEmpty() || base == null || !base.startsWith("https://")) {
            throw new SignedOutException();
        }
        URL url = URI.create(base.endsWith("/") ? base + path : base + "/" + path).toURL();
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        try {
            conn.setRequestMethod(method);
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setUseCaches(false);
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("Cache-Control", "no-store");
            if (body != null) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(body.getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = conn.getResponseCode();
            if (status == 401) throw new SignedOutException();
            if (status < 200 || status >= 300) throw new RefusedException(status);
            return read(conn.getInputStream());
        } finally {
            conn.disconnect();
        }
    }

    private static String read(InputStream in) throws IOException {
        try (InputStream stream = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = stream.read(buf)) != -1) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
