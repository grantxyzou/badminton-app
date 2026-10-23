package com.motioncraft.bpm;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * The score widget's game, on the phone (docs/plans/native-widgets.md,
 * "Keeping score from the widget"). Nothing here reaches the server: points
 * are kept in order so Undo is a pop, and the score is folded from them. The
 * iPhone twin is `ScoreStore` in BPMScoreWidget.swift.
 */
final class BpmScoreStore {
    private static final String PREFS = "bpm_score";
    /** The game in play, or just finished. */
    private static final String KEY_GAME = "game";
    /** A finished game waiting for Save game — "Next game" parks it here. */
    private static final String KEY_PENDING = "pending";

    private BpmScoreStore() {}

    /** Points in order ('a' / 'b'); the score is folded from them. */
    static final class Game {
        int gameNo;
        StringBuilder points = new StringBuilder();
        long startedAt;

        int a() {
            int n = 0;
            for (int i = 0; i < points.length(); i++) if (points.charAt(i) == 'a') n++;
            return n;
        }

        int b() {
            return points.length() - a();
        }

        boolean isOver() {
            return ScoreRules.isOver(a(), b());
        }

        /** 'a', 'b' or NONE before the first point: whoever won the last rally. */
        char serving() {
            return points.length() == 0 ? ScoreRules.NONE : points.charAt(points.length() - 1);
        }

        /** Did the last point bring on the interval? */
        boolean atInterval() {
            if (points.length() == 0) return false;
            char last = points.charAt(points.length() - 1);
            int a = a(), b = b();
            int prevA = last == 'a' ? a - 1 : a;
            int prevB = last == 'b' ? b - 1 : b;
            return ScoreRules.reachedInterval(prevA, prevB, a, b);
        }

        JSONObject toJson() {
            JSONObject o = new JSONObject();
            try {
                o.put("gameNo", gameNo).put("points", points.toString()).put("startedAt", startedAt);
            } catch (JSONException ignored) {
                // Only ints and strings go in; this cannot throw in practice.
            }
            return o;
        }

        static Game fromJson(String raw) {
            if (raw == null) return null;
            try {
                JSONObject o = new JSONObject(raw);
                Game g = new Game();
                g.gameNo = o.optInt("gameNo", 1);
                g.points = new StringBuilder(o.optString("points", ""));
                g.startedAt = o.optLong("startedAt", 0L);
                return g;
            } catch (JSONException e) {
                return null;
            }
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static Game game(Context context) {
        return Game.fromJson(prefs(context).getString(KEY_GAME, null));
    }

    static void setGame(Context context, Game game) {
        SharedPreferences.Editor e = prefs(context).edit();
        if (game == null) e.remove(KEY_GAME); else e.putString(KEY_GAME, game.toJson().toString());
        e.apply();
    }

    static Game pending(Context context) {
        return Game.fromJson(prefs(context).getString(KEY_PENDING, null));
    }

    static void setPending(Context context, Game game) {
        SharedPreferences.Editor e = prefs(context).edit();
        if (game == null) e.remove(KEY_PENDING); else e.putString(KEY_PENDING, game.toJson().toString());
        e.apply();
    }

    /** "Game 3 tonight": counted from the first game started today. */
    static int nextGameNo(Context context) {
        Game last = game(context);
        if (last == null) last = pending(context);
        if (last == null) return 1;
        Calendar then = Calendar.getInstance();
        then.setTimeInMillis(last.startedAt);
        Calendar now = Calendar.getInstance();
        boolean today = then.get(Calendar.YEAR) == now.get(Calendar.YEAR)
            && then.get(Calendar.DAY_OF_YEAR) == now.get(Calendar.DAY_OF_YEAR);
        return today ? last.gameNo + 1 : 1;
    }

    static Game start(Context context) {
        Game done = game(context);
        // A finished game still on screen is parked, not lost.
        if (done != null && done.isOver() && pending(context) == null) setPending(context, done);
        Game g = new Game();
        g.gameNo = nextGameNo(context);
        g.startedAt = System.currentTimeMillis();
        setGame(context, g);
        return g;
    }

    /** Add a game logged the score the widget was holding (lib/gameIntent.ts). */
    static void gameSaved(Context context) {
        setPending(context, null);
        Game g = game(context);
        if (g != null && g.isOver()) setGame(context, null);
    }

    static void clear(Context context) {
        prefs(context).edit().clear().apply();
    }
}
