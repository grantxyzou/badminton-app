package com.motioncraft.bpm;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.provider.CalendarContract;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * "Add to calendar" (docs/plans/add-to-calendar.md): hands a filled-in event
 * to the calendar app's own New Event screen, and the person taps Save there.
 * An INSERT intent needs no calendar permission — this app writes nothing.
 * Registered in {@link MainActivity}; the iPhone twin is BpmCalendarPlugin.swift.
 */
@CapacitorPlugin(name = "BpmCalendar")
public class BpmCalendarPlugin extends Plugin {

    @PluginMethod
    public void addEvent(PluginCall call) {
        String title = call.getString("title");
        Double startMs = call.getDouble("startMs");
        Double endMs = call.getDouble("endMs");
        if (title == null || startMs == null || endMs == null || endMs <= startMs) {
            call.reject("title, startMs and endMs are required");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_INSERT)
            .setData(CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.Events.TITLE, title)
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, startMs.longValue())
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endMs.longValue());
        String location = call.getString("location");
        if (location != null && !location.isEmpty()) {
            intent.putExtra(CalendarContract.Events.EVENT_LOCATION, location);
        }
        String url = call.getString("url");
        if (url != null && !url.isEmpty()) {
            intent.putExtra(CalendarContract.Events.DESCRIPTION, url);
        }
        JSObject result = new JSObject();
        try {
            getActivity().startActivity(intent);
            // The calendar app does not report back whether it was saved.
            result.put("outcome", "shown");
        } catch (ActivityNotFoundException e) {
            result.put("outcome", "no_calendar");
        }
        call.resolve(result);
    }
}
