package com.motioncraft.bpm;

import android.app.Activity;
import android.graphics.Rect;
import android.view.View;

import androidx.core.content.ContextCompat;
import androidx.core.util.Consumer;
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter;
import androidx.window.layout.DisplayFeature;
import androidx.window.layout.FoldingFeature;
import androidx.window.layout.WindowInfoTracker;
import androidx.window.layout.WindowLayoutInfo;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Where the fold is (docs/plans/foldable-layout.md, step 3).
 *
 * Jetpack WindowManager reports a foldable's hinge as a {@link FoldingFeature}
 * on every layout change: HALF_OPENED while the phone is partly open, FLAT
 * when it is open all the way, and its bounds in window pixels. This plugin
 * turns that into the shape {@code lib/fold.ts} reads — {@code posture}
 * ({@code folded} / {@code flat}, the web Device Posture API's words) and the
 * fold's rectangle in the WebView's CSS pixels — pushes every change to the
 * page as a {@code foldChanged} event, and answers {@code getFold()} with the
 * last one. A phone with no folding feature is {@code flat}.
 *
 * Registered in {@link MainActivity}; the iPhone twin is BpmFoldPlugin.swift.
 */
@CapacitorPlugin(name = "BpmFold")
public class BpmFoldPlugin extends Plugin {

    private WindowInfoTrackerCallbackAdapter tracker;
    private final Consumer<WindowLayoutInfo> onLayout = this::accept;
    private JSObject last;

    @Override
    public void load() {
        Activity activity = getActivity();
        if (activity == null) return;
        tracker = new WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(activity));
        tracker.addWindowLayoutInfoListener(activity, ContextCompat.getMainExecutor(activity), onLayout);
    }

    @Override
    protected void handleOnDestroy() {
        if (tracker != null) tracker.removeWindowLayoutInfoListener(onLayout);
        tracker = null;
    }

    @PluginMethod
    public void getFold(PluginCall call) {
        if (last == null) {
            JSObject unknown = new JSObject();
            unknown.put("posture", "unknown");
            call.resolve(unknown);
            return;
        }
        call.resolve(last);
    }

    private void accept(WindowLayoutInfo info) {
        FoldingFeature fold = null;
        for (DisplayFeature feature : info.getDisplayFeatures()) {
            if (feature instanceof FoldingFeature) {
                fold = (FoldingFeature) feature;
                break;
            }
        }
        JSObject next = new JSObject();
        if (fold == null || fold.getState() == FoldingFeature.State.FLAT) {
            next.put("posture", "flat");
            next.put("fold", JSObject.NULL);
        } else {
            next.put("posture", "folded");
            next.put("fold", toCss(fold.getBounds()));
        }
        last = next;
        notifyListeners("foldChanged", next);
    }

    /** Window pixels → the WebView's CSS pixels: shift by where the WebView sits, then divide by density. */
    private JSObject toCss(Rect bounds) {
        float density = getContext().getResources().getDisplayMetrics().density;
        int[] origin = new int[] {0, 0};
        View web = getBridge() != null ? getBridge().getWebView() : null;
        if (web != null) web.getLocationInWindow(origin);
        JSObject rect = new JSObject();
        rect.put("x", (bounds.left - origin[0]) / density);
        rect.put("y", (bounds.top - origin[1]) / density);
        rect.put("width", bounds.width() / density);
        rect.put("height", bounds.height() / density);
        return rect;
    }
}
