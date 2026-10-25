package com.motioncraft.bpm;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;

/**
 * The score widget's game, on the phone (docs/plans/native-widgets.md,
 * "Keeping score from the widget"). Nothing here reaches the server: points
 * are kept in order so Undo is a pop, and the score is folded from them. A
 * finished game goes into tonight's list, saved or not, so the large size can
 * show the evening and "Next game" never loses one. The iPhone twin is
 * `ScoreStore` in BPMScoreWidget.swift.
 */
final class BpmScoreStore {
    private static final String PREFS = "bpm_score";
    /** The game in play, or just finished. */
    private static final String KEY_GAME = "game";
    /** Before the list (2026-10-25) one finished game could wait here for Save
     *  game. Read once more and folded into the list, never written again. */
    private static final String KEY_LEGACY_PENDING = "pending";
    private static final String KEY_TONIGHT = "tonight";

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

    /** A game finished tonight; `saved` flips when Add a game logs it. */
    static final class Finished {
        int gameNo;
        int a;
        int b;
        long finishedAt;
        boolean saved;

        char winner() {
            return ScoreRules.winner(a, b);
        }

        JSONObject toJson() {
            JSONObject o = new JSONObject();
            try {
                o.put("gameNo", gameNo).put("a", a).put("b", b).put("finishedAt", finishedAt).put("saved", saved);
            } catch (JSONException ignored) {
                // Numbers and a boolean; this cannot throw in practice.
            }
            return o;
        }

        static Finished fromJson(JSONObject o) {
            Finished f = new Finished();
            f.gameNo = o.optInt("gameNo", 0);
            f.a = o.optInt("a", 0);
            f.b = o.optInt("b", 0);
            f.finishedAt = o.optLong("finishedAt", 0L);
            f.saved = o.optBoolean("saved", false);
            return f;
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

    /** Tonight's finished games, oldest first. Yesterday's are dropped on read. */
    static List<Finished> tonight(Context context) {
        List<Finished> list = new ArrayList<>();
        String raw = prefs(context).getString(KEY_TONIGHT, null);
        if (raw != null) {
            try {
                JSONArray arr = new JSONArray(raw);
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.optJSONObject(i);
                    if (o != null) list.add(Finished.fromJson(o));
                }
            } catch (JSONException e) {
                // An unreadable list is an empty one; the next game rewrites it.
            }
        }
        Game parked = Game.fromJson(prefs(context).getString(KEY_LEGACY_PENDING, null));
        if (parked != null) {
            Finished f = new Finished();
            f.gameNo = parked.gameNo;
            f.a = parked.a();
            f.b = parked.b();
            f.finishedAt = parked.startedAt;
            f.saved = false;
            list.add(f);
            prefs(context).edit().remove(KEY_LEGACY_PENDING).apply();
        }
        List<Finished> today = new ArrayList<>();
        for (Finished f : list) if (isToday(f.finishedAt)) today.add(f);
        Collections.sort(today, (x, y) -> Integer.compare(x.gameNo, y.gameNo));
        return today;
    }

    static void setTonight(Context context, List<Finished> list) {
        JSONArray arr = new JSONArray();
        for (Finished f : list) arr.put(f.toJson());
        prefs(context).edit().putString(KEY_TONIGHT, arr.toString()).apply();
    }

    /** The newest finished game not yet logged — what the 4 × 2's idle row offers to save. */
    static Finished pending(Context context) {
        List<Finished> list = tonight(context);
        for (int i = list.size() - 1; i >= 0; i--) if (!list.get(i).saved) return list.get(i);
        return null;
    }

    /** A finished game leaves the court for the list, unless it is there already. */
    static void park(Context context, Game done) {
        if (done == null || !done.isOver()) return;
        List<Finished> list = tonight(context);
        for (Finished f : list) if (f.gameNo == done.gameNo) return;
        Finished f = new Finished();
        f.gameNo = done.gameNo;
        f.a = done.a();
        f.b = done.b();
        f.finishedAt = System.currentTimeMillis();
        f.saved = false;
        list.add(f);
        setTonight(context, list);
    }

    /** "Game 3 tonight": one more than the last game started today. */
    static int nextGameNo(Context context) {
        int last = 0;
        for (Finished f : tonight(context)) last = Math.max(last, f.gameNo);
        Game g = game(context);
        if (g != null && isToday(g.startedAt)) last = Math.max(last, g.gameNo);
        return last + 1;
    }

    /** Start the next game; a finished one still on screen is parked, not lost. */
    static Game startNext(Context context) {
        park(context, game(context));
        Game g = new Game();
        g.gameNo = nextGameNo(context);
        g.startedAt = System.currentTimeMillis();
        setGame(context, g);
        return g;
    }

    static void discardPending(Context context) {
        List<Finished> list = tonight(context);
        for (int i = list.size() - 1; i >= 0; i--) {
            if (!list.get(i).saved) {
                list.remove(i);
                setTonight(context, list);
                return;
            }
        }
    }

    /**
     * Add a game logged a score the widget was holding (lib/gameIntent.ts). The
     * app says WHICH when it knows (a and b; -1 for unknown): the finished game
     * still on screen leaves the court for the list as saved, else the newest
     * unsaved game with that score is marked.
     */
    static void gameSaved(Context context, int a, int b) {
        boolean known = a >= 0 && b >= 0;
        List<Finished> list = tonight(context);
        Game g = game(context);
        if (g != null && g.isOver() && (!known || (g.a() == a && g.b() == b))) {
            for (int i = list.size() - 1; i >= 0; i--) if (list.get(i).gameNo == g.gameNo) list.remove(i);
            Finished f = new Finished();
            f.gameNo = g.gameNo;
            f.a = g.a();
            f.b = g.b();
            f.finishedAt = System.currentTimeMillis();
            f.saved = true;
            list.add(f);
            setGame(context, null);
            setTonight(context, list);
            return;
        }
        for (int i = list.size() - 1; i >= 0; i--) {
            Finished f = list.get(i);
            if (!f.saved && (!known || (f.a == a && f.b == b))) {
                f.saved = true;
                setTonight(context, list);
                return;
            }
        }
    }

    static void clear(Context context) {
        prefs(context).edit().clear().apply();
    }

    private static boolean isToday(long ms) {
        Calendar then = Calendar.getInstance();
        then.setTimeInMillis(ms);
        Calendar now = Calendar.getInstance();
        return then.get(Calendar.YEAR) == now.get(Calendar.YEAR)
            && then.get(Calendar.DAY_OF_YEAR) == now.get(Calendar.DAY_OF_YEAR);
    }
}
