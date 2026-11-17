package com.motioncraft.bpm;

import android.app.Activity;
import android.graphics.Rect;
import android.view.View;

import androidx.annotation.OptIn;
import androidx.core.content.ContextCompat;
import androidx.core.util.Consumer;
import androidx.window.area.WindowAreaCapability;
import androidx.window.area.WindowAreaController;
import androidx.window.area.WindowAreaInfo;
import androidx.window.core.ExperimentalWindowApi;
import androidx.window.java.area.WindowAreaControllerCallbackAdapter;
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

import java.util.List;

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
 * <p>It also answers whether the phone can show a second view on its OUTER
 * screen while the app stays on the inner one ({@code getDualScreen()},
 * docs/plans/outer-screen-scoreboard.md, step 1). Jetpack WindowManager's
 * window-area API says so per operation: dual-screen mode is
 * {@code OPERATION_PRESENT_ON_AREA}, rear display mode (the whole app moves out,
 * the inner screen goes dark) is {@code OPERATION_TRANSFER_ACTIVITY_TO_AREA}.
 * Google documents dual-screen mode only for the Pixel Fold and Samsung only
 * rear display mode, so the plan asks the phone. A probe: it only reads, and
 * nothing is shown on the outer screen.
 *
 * Registered in {@link MainActivity}; the iPhone twin is BpmFoldPlugin.swift
 * (which has no {@code getDualScreen}, so the page shows nothing there).
 */
@CapacitorPlugin(name = "BpmFold")
// The window-area API is experimental in androidx.window 1.3.0; the opt-in
// covers the probe's fields and methods (lint reads it, nothing at runtime).
@OptIn(markerClass = ExperimentalWindowApi.class)
public class BpmFoldPlugin extends Plugin {

    private WindowInfoTrackerCallbackAdapter tracker;
    private final Consumer<WindowLayoutInfo> onLayout = this::accept;
    private JSObject last;

    private WindowAreaControllerCallbackAdapter areas;
    private final Consumer<List<WindowAreaInfo>> onAreas = this::acceptAreas;
    /** {@code unknown} until the first answer, then one of the four statuses. */
    private String dualScreen = "unknown";
    private String rearDisplay = "unknown";
    /** A rear-facing window area exists at all: false on a phone with one screen. */
    private boolean outerScreen = false;

    @Override
    public void load() {
        Activity activity = getActivity();
        if (activity == null) return;
        tracker = new WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(activity));
        tracker.addWindowLayoutInfoListener(activity, ContextCompat.getMainExecutor(activity), onLayout);
        startAreaProbe(activity);
    }

    /**
     * The window-area API is marked experimental in androidx.window 1.3.0
     * (every class carries {@code @ExperimentalWindowApi}), hence the class's
     * opt-in. A device without the window-area extension throws or reports nothing;
     * either way it is {@code unsupported}, never a crash of the app.
     */
    private void startAreaProbe(Activity activity) {
        try {
            areas = new WindowAreaControllerCallbackAdapter(WindowAreaController.getOrCreate());
            areas.addWindowAreaInfoListListener(ContextCompat.getMainExecutor(activity), onAreas);
        } catch (Throwable t) {
            areas = null;
            dualScreen = "unsupported";
            rearDisplay = "unsupported";
            outerScreen = false;
        }
    }

    private void acceptAreas(List<WindowAreaInfo> infos) {
        String dual = "unsupported";
        String rear = "unsupported";
        boolean found = false;
        try {
            for (WindowAreaInfo info : infos) {
                if (!WindowAreaInfo.Type.TYPE_REAR_FACING.equals(info.getType())) continue;
                found = true;
                dual = statusOf(info.getCapability(WindowAreaCapability.Operation.OPERATION_PRESENT_ON_AREA));
                rear = statusOf(info.getCapability(WindowAreaCapability.Operation.OPERATION_TRANSFER_ACTIVITY_TO_AREA));
                break;
            }
        } catch (Throwable t) {
            dual = "unsupported";
            rear = "unsupported";
        }
        dualScreen = dual;
        rearDisplay = rear;
        outerScreen = found;
    }

    private static String statusOf(WindowAreaCapability capability) {
        if (capability == null) return "unsupported";
        WindowAreaCapability.Status status = capability.getStatus();
        if (WindowAreaCapability.Status.WINDOW_AREA_STATUS_AVAILABLE.equals(status)) return "available";
        if (WindowAreaCapability.Status.WINDOW_AREA_STATUS_ACTIVE.equals(status)) return "active";
        if (WindowAreaCapability.Status.WINDOW_AREA_STATUS_UNAVAILABLE.equals(status)) return "unavailable";
        if (WindowAreaCapability.Status.WINDOW_AREA_STATUS_UNSUPPORTED.equals(status)) return "unsupported";
        return "unknown";
    }

    /**
     * {@code { outerScreen, dualScreen, rearDisplay }}: whether the phone has a
     * rear-facing screen at all, then each mode {@code available},
     * {@code unavailable} (supported, not now: usually the phone is not open
     * flat), {@code active}, {@code unsupported} or {@code unknown} (asked
     * before the first answer arrived).
     */
    @PluginMethod
    public void getDualScreen(PluginCall call) {
        JSObject out = new JSObject();
        out.put("outerScreen", outerScreen);
        out.put("dualScreen", dualScreen);
        out.put("rearDisplay", rearDisplay);
        call.resolve(out);
    }

    @Override
    protected void handleOnDestroy() {
        if (tracker != null) tracker.removeWindowLayoutInfoListener(onLayout);
        tracker = null;
        stopAreaProbe();
    }

    private void stopAreaProbe() {
        if (areas != null) areas.removeWindowAreaInfoListListener(onAreas);
        areas = null;
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
