package com.motioncraft.bpm;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The home-screen widget (docs/plans/native-widgets.md), Android's shape of the
 * iPhone one: resizable, with the week at 2 × 2, the balance added at 4 × 2
 * and your level at 4 × 3 (large only, as on iPhone).
 *
 * Join and Undo are broadcasts back to this receiver, which calls the server
 * and redraws from the snapshot it answers with — "Signed up" only after the
 * server said yes. Every tap that opens the app names a TAB through
 * `bpm://open?tab=` (lib/widgetBridge.ts `widgetOpenTarget`), never a path.
 */
public class BpmWidgetProvider extends AppWidgetProvider {

    static final String ACTION_JOIN = "com.motioncraft.bpm.widget.JOIN";
    static final String ACTION_UNDO = "com.motioncraft.bpm.widget.UNDO";
    static final String ACTION_REFRESH = "com.motioncraft.bpm.widget.REFRESH";
    static final String EXTRA_WAITLIST = "waitlist";

    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private static final TimeZone ZONE = TimeZone.getTimeZone("America/Vancouver");

    // ── Lifecycle ──

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        refresh(context, goAsync());
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        // Resized: redraw from what it already has, at the new size.
        draw(context, manager, id, BpmWidgetStore.cachedSnapshot(context), false);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (ACTION_JOIN.equals(action)) {
            final boolean waitlist = intent.getBooleanExtra(EXTRA_WAITLIST, false);
            final PendingResult pending = goAsync();
            IO.execute(() -> {
                try {
                    BpmWidgetStore.join(context, waitlist);
                    BpmWidgetStore.clearFailure(context);
                    BpmWidgetStore.offerUndo(context);
                } catch (BpmWidgetStore.SignedOutException e) {
                    BpmWidgetStore.forgetSnapshot(context);
                } catch (Exception e) {
                    BpmWidgetStore.noteFailure(context, BpmWidgetStore.FAILURE_JOIN);
                    BpmWidgetStore.withdrawUndo(context);
                }
                drawAll(context, BpmWidgetStore.cachedSnapshot(context), false);
                pending.finish();
            });
            return;
        }
        if (ACTION_UNDO.equals(action)) {
            final PendingResult pending = goAsync();
            IO.execute(() -> {
                try {
                    BpmWidgetStore.undo(context);
                    BpmWidgetStore.clearFailure(context);
                } catch (BpmWidgetStore.SignedOutException e) {
                    BpmWidgetStore.forgetSnapshot(context);
                } catch (Exception e) {
                    // A late-cancel window, or no network: the app explains.
                    BpmWidgetStore.noteFailure(context, BpmWidgetStore.FAILURE_UNDO);
                }
                BpmWidgetStore.withdrawUndo(context);
                drawAll(context, BpmWidgetStore.cachedSnapshot(context), false);
                pending.finish();
            });
            return;
        }
        if (ACTION_REFRESH.equals(action)) {
            refresh(context, goAsync());
            return;
        }
        super.onReceive(context, intent);
    }

    /** Fetch, keep, draw. A failed read draws the cached snapshot, dated. */
    private static void refresh(Context context, PendingResult pending) {
        IO.execute(() -> {
            JSONObject snapshot;
            boolean stale = false;
            try {
                snapshot = BpmWidgetStore.fetchSnapshot(context);
            } catch (BpmWidgetStore.SignedOutException e) {
                BpmWidgetStore.forgetSnapshot(context);
                snapshot = null;
            } catch (Exception e) {
                snapshot = BpmWidgetStore.cachedSnapshot(context);
                stale = true;
            }
            drawAll(context, snapshot, stale);
            if (pending != null) pending.finish();
        });
    }

    /** From the app (BpmWidgetPlugin): fetch and redraw every placed widget. */
    static void refreshAll(Context context) {
        Intent intent = new Intent(context, BpmWidgetProvider.class).setAction(ACTION_REFRESH);
        context.sendBroadcast(intent);
    }

    /** From the app's sign-out: draw what is stored (nothing), no fetch. */
    static void redrawAll(Context context) {
        drawAll(context, BpmWidgetStore.cachedSnapshot(context), false);
    }

    private static void drawAll(Context context, JSONObject snapshot, boolean stale) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, BpmWidgetProvider.class));
        for (int id : ids) draw(context, manager, id, snapshot, stale);
    }

    // ── Drawing ──

    private enum Size { SMALL, MEDIUM, LARGE }

    private static Size sizeOf(AppWidgetManager manager, int id) {
        Bundle o = manager.getAppWidgetOptions(id);
        int w = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        int h = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        if (w < 200) return Size.SMALL;
        if (h >= 220) return Size.LARGE;
        return Size.MEDIUM;
    }

    private static void draw(Context context, AppWidgetManager manager, int id, JSONObject snapshot, boolean stale) {
        RemoteViews views;
        if (snapshot == null || !BpmWidgetStore.hasPass(context)) {
            views = new RemoteViews(context.getPackageName(), R.layout.widget_bpm_signed_out);
            views.setOnClickPendingIntent(R.id.bpm_root, open(context, "home", 0));
        } else {
            Size size = sizeOf(manager, id);
            if (size == Size.SMALL) views = small(context, snapshot);
            else views = wide(context, snapshot, stale, size == Size.LARGE);
        }
        manager.updateAppWidget(id, views);
    }

    private static RemoteViews small(Context context, JSONObject snap) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_bpm_small);
        JSONObject s = snap.optJSONObject("session");
        if (s == null) {
            v.setTextViewText(R.id.bpm_small_label, "");
            v.setTextViewText(R.id.bpm_small_date, "No session this week");
            v.setViewVisibility(R.id.bpm_small_count, View.GONE);
            v.setViewVisibility(R.id.bpm_fill, View.GONE);
        } else {
            Status status = Status.of(s);
            v.setTextViewText(R.id.bpm_small_label, status.smallLabel(s).toUpperCase(Locale.US));
            v.setTextColor(R.id.bpm_small_label, context.getColor(status.labelColor()));
            v.setTextViewText(R.id.bpm_small_date, day(s.optString("datetime")));
            v.setTextViewText(R.id.bpm_small_count, time(s.optString("datetime")) + " · " + s.optInt("inCount") + " signed up");
            v.setViewVisibility(R.id.bpm_small_count, View.VISIBLE);
            v.setViewVisibility(R.id.bpm_fill, View.VISIBLE);
            v.setProgressBar(R.id.bpm_fill, Math.max(s.optInt("max"), 1), s.optInt("inCount"), false);
        }
        v.setOnClickPendingIntent(R.id.bpm_root, open(context, "home", 0));
        return v;
    }

    private static RemoteViews wide(Context context, JSONObject snap, boolean stale, boolean large) {
        RemoteViews v = new RemoteViews(context.getPackageName(), large ? R.layout.widget_bpm_large : R.layout.widget_bpm_medium);
        JSONObject s = snap.optJSONObject("session");
        String failure = BpmWidgetStore.recentFailure(context);
        boolean undo = BpmWidgetStore.undoOffered(context);

        // Header: when it is old, say so; otherwise the session's day and time.
        String trailing = updatedLabel(snap, stale);
        if (trailing == null && s != null && !large) trailing = day(s.optString("datetime")) + " · " + time(s.optString("datetime"));
        v.setTextViewText(R.id.bpm_header_trailing, trailing == null ? "" : trailing);

        if (large) {
            v.setTextViewText(R.id.bpm_date_line, s == null ? "" : day(s.optString("datetime")) + "  " + timeRange(s));
            v.setViewVisibility(R.id.bpm_date_line, s == null ? View.GONE : View.VISIBLE);
        }

        // The week.
        v.setViewVisibility(R.id.bpm_join, View.GONE);
        v.setViewVisibility(R.id.bpm_undo, View.GONE);
        if (failure != null) {
            v.setTextViewText(R.id.bpm_headline, BpmWidgetStore.FAILURE_JOIN.equals(failure) ? "Couldn't join" : "Couldn't undo");
            v.setTextViewText(R.id.bpm_count, "Tap to finish in BPM");
        } else if (s == null) {
            v.setTextViewText(R.id.bpm_headline, "No session this week");
            v.setTextViewText(R.id.bpm_count, "");
        } else {
            Status status = Status.of(s);
            v.setTextViewText(R.id.bpm_headline, status.headline(s));
            v.setTextViewText(R.id.bpm_count, countLine(s));
            if (status == Status.JOIN || status == Status.JOIN_WAITLIST) {
                boolean full = status == Status.JOIN_WAITLIST;
                v.setViewVisibility(R.id.bpm_join, View.VISIBLE);
                v.setTextViewText(R.id.bpm_join, full ? "Join waitlist" : "Join");
                v.setInt(R.id.bpm_join, "setBackgroundResource", full ? R.drawable.widget_bpm_join_waitlist : R.drawable.widget_bpm_join);
                v.setTextColor(R.id.bpm_join, context.getColor(full ? R.color.bpm_widget_amber : R.color.bpm_widget_on_green));
                v.setOnClickPendingIntent(R.id.bpm_join, action(context, ACTION_JOIN, full, full ? 2 : 1));
            }
            if (status == Status.IN && undo) {
                v.setViewVisibility(R.id.bpm_undo, View.VISIBLE);
                v.setOnClickPendingIntent(R.id.bpm_undo, action(context, ACTION_UNDO, false, 3));
            }
        }
        if (s != null) {
            v.setViewVisibility(R.id.bpm_fill, View.VISIBLE);
            v.setProgressBar(R.id.bpm_fill, Math.max(s.optInt("max"), 1), s.optInt("inCount"), false);
        } else {
            v.setViewVisibility(R.id.bpm_fill, View.GONE);
        }
        v.setOnClickPendingIntent(R.id.bpm_week_area, open(context, "home", 10));

        // The balance.
        JSONObject owed = snap.optJSONObject("owed");
        double total = owed == null ? 0 : owed.optDouble("total", 0);
        // Nothing owed is "All paid", never "Owed $0".
        boolean paidUp = total <= 0;
        v.setViewVisibility(R.id.bpm_balance_label, paidUp ? View.GONE : View.VISIBLE);
        v.setViewVisibility(R.id.bpm_balance_amount, paidUp ? View.GONE : View.VISIBLE);
        v.setViewVisibility(R.id.bpm_balance_paid, paidUp ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.bpm_balance_amount, money(total));
        v.setTextColor(R.id.bpm_balance_amount, context.getColor(R.color.bpm_widget_amber));
        v.setOnClickPendingIntent(R.id.bpm_balance_area, open(context, "home", 11));

        // Your level — the large size only (Grant, 2026-10-22).
        if (large) {
            JSONObject level = snap.optJSONObject("level");
            if (level == null) {
                v.setTextViewText(R.id.bpm_level_value, "—");
                v.setTextViewText(R.id.bpm_level_phase, "");
                v.setTextViewText(R.id.bpm_level_trend, "Check in on Stats to see your level here.");
            } else {
                v.setTextViewText(R.id.bpm_level_value, String.format(Locale.US, "%.1f", level.optDouble("overall")));
                v.setTextViewText(R.id.bpm_level_phase, level.optString("phaseLabel", ""));
                v.setTextViewText(R.id.bpm_level_trend, trendLine(level));
            }
            v.setOnClickPendingIntent(R.id.bpm_level_area, open(context, "skills", 12));
            stringing(context, v, snap.optJSONObject("stringing"));
        }
        return v;
    }

    // ── Stringing: the racket on the bench, or the strings wearing in ──

    private static final int[] STRING_STEPS = {
        R.id.bpm_string_step1, R.id.bpm_string_step2, R.id.bpm_string_step3, R.id.bpm_string_step4,
    };

    /**
     * The large widget's third section, the twin of BPMWidget.swift's
     * StringingBlock. A live job shows the player's four-step track; otherwise
     * the restring bar fills by DATE against the club's interval (time, not
     * sessions — we cannot know when they play outside BPM), and the advice is
     * "consider", never "overdue". Absent (never strung, nothing on the bench)
     * hides the section rather than explaining itself.
     */
    private static void stringing(Context context, RemoteViews v, JSONObject stringing) {
        boolean show = stringing != null;
        v.setViewVisibility(R.id.bpm_string_divider, show ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.bpm_string_area, show ? View.VISIBLE : View.GONE);
        if (!show) return;
        v.setOnClickPendingIntent(R.id.bpm_string_area, open(context, "stringing", 13));
        JSONObject job = stringing.optJSONObject("job");
        v.setViewVisibility(R.id.bpm_string_wear, View.GONE);
        v.setViewVisibility(R.id.bpm_string_wear_due, View.GONE);
        if (job != null) {
            v.setTextViewText(R.id.bpm_string_label, "STRINGING");
            v.setTextViewText(R.id.bpm_string_status, stageLine(job));
            boolean ready = "ready_for_you".equals(job.optString("stage"));
            v.setTextColor(R.id.bpm_string_status, context.getColor(ready ? R.color.bpm_widget_green : R.color.bpm_widget_secondary));
            v.setTextViewText(R.id.bpm_string_line,
                job.optString("racketLabel") + " · " + job.optString("stringLabel") + " · " + job.optInt("tensionMains") + " lb");
            v.setViewVisibility(R.id.bpm_string_steps, View.VISIBLE);
            int reached = Math.min(job.optInt("stageIndex"), 3);
            for (int i = 0; i < STRING_STEPS.length; i++) {
                v.setInt(STRING_STEPS[i], "setBackgroundResource", i <= reached ? R.drawable.widget_bpm_step_on : R.drawable.widget_bpm_step_off);
            }
            return;
        }
        boolean due = stringing.optBoolean("due");
        int weeks = stringing.optInt("weeksSince", 0);
        int after = Math.max(stringing.optInt("afterWeeks", 8), 1);
        v.setTextViewText(R.id.bpm_string_label, "YOUR STRINGS");
        v.setTextViewText(R.id.bpm_string_status, due ? "Time to restring" : "Fresh");
        v.setTextColor(R.id.bpm_string_status, context.getColor(due ? R.color.bpm_widget_amber : R.color.bpm_widget_secondary));
        String since = "Strung " + monthDay(stringing.optString("lastStrungAt")) + " · " + weeks + (weeks == 1 ? " week ago" : " weeks ago");
        v.setTextViewText(R.id.bpm_string_line, due ? since + "\nConsider a restring for a better feel." : since);
        v.setViewVisibility(R.id.bpm_string_steps, View.GONE);
        int bar = due ? R.id.bpm_string_wear_due : R.id.bpm_string_wear;
        v.setViewVisibility(bar, View.VISIBLE);
        v.setProgressBar(bar, after, Math.min(weeks, after), false);
    }

    /** The stage in the player's words — the same four Home's track uses. */
    private static String stageLine(JSONObject job) {
        switch (job.optString("stage")) {
            case "awaiting_dropoff": return "Drop it off";
            case "with_stringer": return "With the stringer";
            case "being_strung": return "Being strung";
            case "ready_for_you":
                return job.isNull("readyBy") ? "Ready" : "Ready · " + monthDay(job.optString("readyBy") + "T12:00:00Z");
            default: return "";
        }
    }

    // ── The week's status, decided once ──

    private enum Status {
        NONE, SETTLED, IN, WAITLIST, JOIN, JOIN_WAITLIST, NOT_OPEN, CLOSED;

        static Status of(JSONObject s) {
            String me = s.optString("me");
            if ("in".equals(me)) return IN;
            if ("waitlist".equals(me)) return WAITLIST;
            if (s.optBoolean("settled")) return SETTLED;
            if (!s.optBoolean("signupOpen", true)) return NOT_OPEN;
            if (s.optBoolean("closed")) return CLOSED;
            return s.optInt("inCount") >= s.optInt("max") ? JOIN_WAITLIST : JOIN;
        }

        String headline(JSONObject s) {
            switch (this) {
                case IN: return "✓ Signed up";
                case WAITLIST: return position(s) == null ? "On the waitlist" : "Waitlist · " + position(s);
                case JOIN: return "Open now";
                case JOIN_WAITLIST: return "Full";
                case NOT_OPEN: return "Not open yet";
                case CLOSED: return "Sign-ups closed";
                case SETTLED: return "Played";
                default: return "No session this week";
            }
        }

        String smallLabel(JSONObject s) {
            switch (this) {
                case IN: return "Signed up";
                case WAITLIST: return position(s) == null ? "Waitlist" : "Waitlist · " + position(s);
                case JOIN: return "Sign-ups open";
                case JOIN_WAITLIST: return "Full · waitlist open";
                case NOT_OPEN: return "Not open yet";
                case CLOSED: return "Sign-ups closed";
                case SETTLED: return "Played";
                default: return "";
            }
        }

        int labelColor() {
            switch (this) {
                case IN: case JOIN: return R.color.bpm_widget_green;
                case WAITLIST: case JOIN_WAITLIST: return R.color.bpm_widget_amber;
                default: return R.color.bpm_widget_muted;
            }
        }

        private static String position(JSONObject s) {
            return s.isNull("waitlistPosition") ? null : BpmWidgetProvider.ordinal(s.optInt("waitlistPosition"));
        }
    }

    // ── Text ──

    private static String countLine(JSONObject s) {
        int in = s.optInt("inCount");
        int max = s.optInt("max");
        int waiting = s.optInt("waitingCount");
        if (waiting > 0 && in >= max) return in + " signed up · " + waiting + " waiting";
        int left = Math.max(max - in, 0);
        return in + " signed up" + (left > 0 ? " · " + left + (left == 1 ? " spot left" : " spots left") : "");
    }

    private static String trendLine(JSONObject level) {
        StringBuilder out = new StringBuilder();
        if (!level.isNull("delta") && !level.isNull("prevAt")) {
            double delta = level.optDouble("delta");
            if (Math.abs(delta) >= 0.05) {
                out.append(delta > 0 ? "Up " : "Down ")
                    .append(String.format(Locale.US, "%.1f", Math.abs(delta)))
                    .append(" since ").append(monthDay(level.optString("prevAt")));
            }
        }
        if (!level.isNull("workOn")) {
            if (out.length() > 0) out.append(" · ");
            out.append("work on ").append(level.optString("workOn").toLowerCase(Locale.US));
        }
        // No sparkline here: RemoteViews offers no canvas to draw one on, so
        // Android says the trend in words (the iPhone widget draws the line).
        if (out.length() == 0) out.append("Check in again to see it move");
        return out.toString();
    }

    private static String updatedLabel(JSONObject snap, boolean stale) {
        if (!stale) return null;
        Date at = parse(snap.optString("generatedAt"));
        if (at == null || System.currentTimeMillis() - at.getTime() < 15 * 60 * 1000L) return null;
        return "Updated " + format(at, "h:mm a");
    }

    private static String timeRange(JSONObject s) {
        String start = time(s.optString("datetime"));
        if (s.isNull("endDatetime")) return start;
        return start.replace(" PM", "").replace(" AM", "") + "–" + time(s.optString("endDatetime"));
    }

    static String money(double amount) {
        return Math.rint(amount) == amount ? String.format(Locale.US, "$%.0f", amount) : String.format(Locale.US, "$%.2f", amount);
    }

    static String ordinal(int n) {
        int tens = n % 100;
        String suffix = tens >= 11 && tens <= 13 ? "th" : n % 10 == 1 ? "st" : n % 10 == 2 ? "nd" : n % 10 == 3 ? "rd" : "th";
        return n + suffix;
    }

    // ── Dates, in Vancouver time like the app ──

    private static final String[] ISO_PATTERNS = {
        "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
        "yyyy-MM-dd'T'HH:mm:ssXXX",
    };

    static Date parse(String iso) {
        if (iso == null || iso.isEmpty()) return null;
        for (String pattern : ISO_PATTERNS) {
            SimpleDateFormat f = new SimpleDateFormat(pattern, Locale.US);
            try {
                return f.parse(iso);
            } catch (ParseException ignored) {
                // try the next shape
            }
        }
        return null;
    }

    private static String format(Date date, String pattern) {
        SimpleDateFormat f = new SimpleDateFormat(pattern, Locale.US);
        f.setTimeZone(ZONE);
        return f.format(date);
    }

    static String day(String iso) {
        Date d = parse(iso);
        return d == null ? "" : format(d, "EEE, MMM d");
    }

    static String time(String iso) {
        Date d = parse(iso);
        if (d == null) return "";
        Calendar c = Calendar.getInstance(ZONE);
        c.setTime(d);
        return format(d, c.get(Calendar.MINUTE) == 0 ? "h a" : "h:mm a");
    }

    static String monthDay(String iso) {
        Date d = parse(iso);
        return d == null ? "" : format(d, "MMM d");
    }

    // ── Taps ──

    /** Open the app on a tab (`bpm://open?tab=`, routed in place by NativeBridge). */
    private static PendingIntent open(Context context, String tab, int requestCode) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("bpm://open?tab=" + tab));
        intent.setPackage(context.getPackageName());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent action(Context context, String action, boolean waitlist, int requestCode) {
        Intent intent = new Intent(context, BpmWidgetProvider.class).setAction(action).putExtra(EXTRA_WAITLIST, waitlist);
        return PendingIntent.getBroadcast(context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
