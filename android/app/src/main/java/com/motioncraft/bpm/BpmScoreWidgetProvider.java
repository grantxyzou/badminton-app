package com.motioncraft.bpm;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

import java.util.Locale;

/**
 * Keeping score from the widget (docs/plans/native-widgets.md). Every tap is a
 * broadcast to this receiver — sent only by its own PendingIntents, so it is
 * not exported — that moves the game in {@link BpmScoreStore} and redraws.
 * Nothing reaches the server until Save game, which opens Add a game with the
 * score (`bpm://open?tab=skills&game=21-18`, routed by lib/widgetBridge.ts).
 * The iPhone twin is BPMScoreWidget.swift.
 */
public class BpmScoreWidgetProvider extends AppWidgetProvider {

    static final String ACTION_START = "com.motioncraft.bpm.score.START";
    static final String ACTION_POINT = "com.motioncraft.bpm.score.POINT";
    static final String ACTION_UNDO = "com.motioncraft.bpm.score.UNDO";
    static final String ACTION_NEXT = "com.motioncraft.bpm.score.NEXT";
    static final String ACTION_DISCARD = "com.motioncraft.bpm.score.DISCARD";
    static final String EXTRA_SIDE = "side";
    static final String EXTRA_PENDING = "pending";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) draw(context, manager, id);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (ACTION_START.equals(action)) {
            BpmScoreStore.start(context);
        } else if (ACTION_POINT.equals(action)) {
            BpmScoreStore.Game g = BpmScoreStore.game(context);
            String side = intent.getStringExtra(EXTRA_SIDE);
            if (g != null && !g.isOver() && ("a".equals(side) || "b".equals(side))) {
                g.points.append(side.charAt(0));
                BpmScoreStore.setGame(context, g);
            }
        } else if (ACTION_UNDO.equals(action)) {
            BpmScoreStore.Game g = BpmScoreStore.game(context);
            if (g != null && g.points.length() > 0) {
                g.points.setLength(g.points.length() - 1);
                BpmScoreStore.setGame(context, g);
            }
        } else if (ACTION_NEXT.equals(action)) {
            // Keeps the finished one waiting to save and starts 0–0.
            BpmScoreStore.Game done = BpmScoreStore.game(context);
            if (done != null && done.isOver()) BpmScoreStore.setPending(context, done);
            BpmScoreStore.setGame(context, null);
            BpmScoreStore.start(context);
        } else if (ACTION_DISCARD.equals(action)) {
            if (intent.getBooleanExtra(EXTRA_PENDING, false)) BpmScoreStore.setPending(context, null);
            else BpmScoreStore.setGame(context, null);
        } else {
            super.onReceive(context, intent);
            return;
        }
        redrawAll(context);
    }

    static void redrawAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, BpmScoreWidgetProvider.class));
        for (int id : ids) draw(context, manager, id);
    }

    private static void draw(Context context, AppWidgetManager manager, int id) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_bpm_score);
        BpmScoreStore.Game game = BpmScoreStore.game(context);
        BpmScoreStore.Game pending = BpmScoreStore.pending(context);

        v.setViewVisibility(R.id.score_idle, View.GONE);
        v.setViewVisibility(R.id.score_play, View.GONE);
        v.setViewVisibility(R.id.score_over, View.GONE);
        v.setViewVisibility(R.id.score_badge, View.GONE);
        v.setViewVisibility(R.id.score_status, View.VISIBLE);
        v.setInt(R.id.score_root, "setBackgroundResource", R.drawable.widget_bpm_bg);

        if (game == null) {
            idle(context, v, pending);
        } else if (game.isOver()) {
            over(context, v, game);
        } else {
            playing(context, v, game);
        }
        manager.updateAppWidget(id, views(v));
    }

    private static RemoteViews views(RemoteViews v) {
        return v;
    }

    // Between games — one tap to start.
    private static void idle(Context context, RemoteViews v, BpmScoreStore.Game pending) {
        v.setViewVisibility(R.id.score_idle, View.VISIBLE);
        v.setTextViewText(R.id.score_status, "Score");
        v.setTextViewText(R.id.score_idle_sub, "Game " + BpmScoreStore.nextGameNo(context) + " tonight · to " + ScoreRules.GAME_TO);
        v.setOnClickPendingIntent(R.id.score_start, action(context, ACTION_START, null, false, 1));
        if (pending == null) {
            v.setViewVisibility(R.id.score_pending_row, View.GONE);
        } else {
            v.setViewVisibility(R.id.score_pending_row, View.VISIBLE);
            v.setTextViewText(R.id.score_pending_text, "Game " + pending.gameNo + " · " + pending.a() + "–" + pending.b() + " not saved");
            v.setOnClickPendingIntent(R.id.score_pending_save, save(context, pending.a(), pending.b(), 2));
            v.setOnClickPendingIntent(R.id.score_pending_discard, action(context, ACTION_DISCARD, null, true, 3));
        }
        v.setOnClickPendingIntent(R.id.score_root, open(context, 9));
    }

    // Playing — tap a side for its point. The rules keep count with you.
    private static void playing(Context context, RemoteViews v, BpmScoreStore.Game game) {
        int a = game.a(), b = game.b();
        char gp = ScoreRules.gamePoint(a, b);
        v.setViewVisibility(R.id.score_play, View.VISIBLE);

        // The header says what matters now, in the umpire's words.
        if (gp != ScoreRules.NONE) {
            badge(v, "⚡ GAME POINT · " + ScoreRules.sideName(gp).toUpperCase(Locale.US), R.drawable.widget_bpm_badge_amber, R.color.bpm_widget_on_amber, context);
            // Game point changes the whole widget: an amber wash and rim.
            v.setInt(R.id.score_root, "setBackgroundResource", R.drawable.widget_bpm_bg_amber);
        } else if (ScoreRules.nextPointWins(a, b)) {
            badge(v, "29 ALL · NEXT POINT WINS", R.drawable.widget_bpm_badge_light, R.color.bpm_widget_on_badge, context);
        } else if (ScoreRules.allAt(a, b) >= 0) {
            badge(v, ScoreRules.allAt(a, b) + " ALL · WIN BY TWO", R.drawable.widget_bpm_badge_light, R.color.bpm_widget_on_badge, context);
        } else if (game.atInterval()) {
            v.setTextViewText(R.id.score_status, "Interval");
        } else {
            v.setTextViewText(R.id.score_status, "Game " + game.gameNo + " · to " + ScoreRules.GAME_TO);
        }

        side(context, v, 'a', a, game.serving() == 'a', gp == 'a', R.id.score_side_a, R.id.score_a_pts, R.id.score_a_plus, R.id.score_a_serve, 4);
        side(context, v, 'b', b, game.serving() == 'b', gp == 'b', R.id.score_side_b, R.id.score_b_pts, R.id.score_b_plus, R.id.score_b_serve, 5);
        v.setOnClickPendingIntent(R.id.score_undo, action(context, ACTION_UNDO, null, false, 6));
        v.setInt(R.id.score_undo, "setAlpha", game.points.length() == 0 ? 90 : 255);
    }

    private static void side(Context context, RemoteViews v, char side, int points, boolean serving, boolean gamePoint,
                             int tileId, int ptsId, int plusId, int serveId, int requestCode) {
        v.setTextViewText(ptsId, String.valueOf(points));
        v.setTextColor(ptsId, context.getColor(gamePoint ? R.color.bpm_widget_amber : R.color.bpm_widget_primary));
        v.setTextViewText(plusId, gamePoint ? "+1 wins it" : "+1");
        v.setTextColor(plusId, context.getColor(gamePoint ? R.color.bpm_widget_amber : R.color.bpm_widget_muted));
        // The amber dot is who serves — it follows the last rally.
        v.setViewVisibility(serveId, serving ? View.VISIBLE : View.INVISIBLE);
        v.setInt(tileId, "setBackgroundResource", gamePoint ? R.drawable.widget_bpm_side_gamepoint
            : side == 'a' ? R.drawable.widget_bpm_side_green : R.drawable.widget_bpm_side_blue);
        v.setOnClickPendingIntent(tileId, action(context, ACTION_POINT, String.valueOf(side), false, requestCode));
    }

    private static void badge(RemoteViews v, String text, int bg, int textColor, Context context) {
        v.setViewVisibility(R.id.score_status, View.GONE);
        v.setViewVisibility(R.id.score_badge, View.VISIBLE);
        v.setTextViewText(R.id.score_badge, text);
        v.setInt(R.id.score_badge, "setBackgroundResource", bg);
        v.setTextColor(R.id.score_badge, context.getColor(textColor));
    }

    // Game over — save it, or start the next.
    private static void over(Context context, RemoteViews v, BpmScoreStore.Game game) {
        int a = game.a(), b = game.b();
        char w = ScoreRules.winner(a, b);
        v.setViewVisibility(R.id.score_over, View.VISIBLE);
        v.setTextViewText(R.id.score_status, "Game " + game.gameNo);
        v.setTextViewText(R.id.score_final, a + "–" + b);
        v.setTextViewText(R.id.score_winner, ScoreRules.sideName(w) + " wins");
        v.setTextColor(R.id.score_winner, context.getColor(w == 'a' ? R.color.bpm_widget_green : R.color.bpm_widget_blue));
        v.setOnClickPendingIntent(R.id.score_save, save(context, a, b, 7));
        v.setOnClickPendingIntent(R.id.score_next, action(context, ACTION_NEXT, null, false, 8));
        v.setOnClickPendingIntent(R.id.score_discard, action(context, ACTION_DISCARD, null, false, 10));
    }

    // ── Taps ──

    private static PendingIntent action(Context context, String action, String side, boolean pending, int requestCode) {
        Intent intent = new Intent(context, BpmScoreWidgetProvider.class).setAction(action).putExtra(EXTRA_PENDING, pending);
        if (side != null) intent.putExtra(EXTRA_SIDE, side);
        return PendingIntent.getBroadcast(context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Save game: Add a game opens with the score already in (lib/gameIntent.ts). */
    private static PendingIntent save(Context context, int a, int b, int requestCode) {
        return openUri(context, "bpm://open?tab=skills&game=" + a + "-" + b, requestCode);
    }

    private static PendingIntent open(Context context, int requestCode) {
        return openUri(context, "bpm://open?tab=skills", requestCode);
    }

    private static PendingIntent openUri(Context context, String uri, int requestCode) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
        intent.setPackage(context.getPackageName());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
