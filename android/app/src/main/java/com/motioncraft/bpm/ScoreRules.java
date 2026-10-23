package com.motioncraft.bpm;

/**
 * A game of badminton, for the score widget — a port of lib/scoreRules.ts,
 * which is the spec; `__tests__/score-rules.test.ts` is what this port is held
 * to. To 21, won by two, capped at 30; "game point" for the side one rally
 * from winning; "20 all", never deuce; "29 all" means the next point wins;
 * an interval when the leading side first reaches 11. Sides are 'a' (Green)
 * and 'b' (Blue). Pure.
 */
final class ScoreRules {
    static final int GAME_TO = 21;
    static final int WIN_BY = 2;
    static final int CAP = 30;
    static final int INTERVAL_AT = 11;

    static final char NONE = 0;

    private ScoreRules() {}

    private static boolean winsAt(int score, int other) {
        return score >= CAP || (score >= GAME_TO && score - other >= WIN_BY);
    }

    /** 'a', 'b', or NONE while the game is live. */
    static char winner(int a, int b) {
        if (winsAt(a, b)) return 'a';
        if (winsAt(b, a)) return 'b';
        return NONE;
    }

    static boolean isOver(int a, int b) {
        return winner(a, b) != NONE;
    }

    /** The side one rally from winning, or NONE. */
    static char gamePoint(int a, int b) {
        if (isOver(a, b)) return NONE;
        if (winsAt(a + 1, b)) return 'a';
        if (winsAt(b + 1, a)) return 'b';
        return NONE;
    }

    /** Level at 20 or above ("20 all"): that number, or -1. */
    static int allAt(int a, int b) {
        return !isOver(a, b) && a == b && a >= GAME_TO - 1 ? a : -1;
    }

    static boolean nextPointWins(int a, int b) {
        return allAt(a, b) == CAP - 1;
    }

    /** The leading side reaching 11 for the first time. */
    static boolean reachedInterval(int prevA, int prevB, int a, int b) {
        return Math.max(prevA, prevB) < INTERVAL_AT && Math.max(a, b) == INTERVAL_AT;
    }

    static String sideName(char side) {
        return side == 'a' ? "Green" : "Blue";
    }
}
