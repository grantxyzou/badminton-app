import WidgetKit
import SwiftUI
import AppIntents

// Keeping score from the widget (docs/plans/native-widgets.md, "Keeping score
// from the widget"; drawn on the Native page of the design canvas). Nothing
// here touches the network: the score lives on the phone until Save game
// opens Add a game with it. The rules are a port of lib/scoreRules.ts — the
// spec — and `__tests__/score-rules.test.ts` is what this port is held to.
//
// Two sizes. The medium is the court-side scorer; the large (WidgetScoreLarge
// on the canvas, 2026-10-25) is the same scorer with digits readable from the
// far court, a full-width Undo, and the evening so far: every game finished
// on this phone today, saved or not.

// MARK: - Rules (lib/scoreRules.ts)

enum ScoreSide: String, Codable {
    case a, b

    /// Two neutral sides, so whoever holds the phone can keep score for any
    /// court (Grant, 2026-10-23: not "Us" and "Them"; 2026-10-24: "A side" and "B side", not colours).
    var name: String { self == .a ? "A side" : "B side" }
}

struct Score: Codable, Equatable {
    var a: Int
    var b: Int
    static let zero = Score(a: 0, b: 0)
}

enum ScoreRules {
    static let gameTo = 21
    static let winBy = 2
    static let cap = 30
    static let intervalAt = 11

    private static func winsAt(_ score: Int, _ other: Int) -> Bool {
        score >= cap || (score >= gameTo && score - other >= winBy)
    }

    static func winner(_ s: Score) -> ScoreSide? {
        if winsAt(s.a, s.b) { return .a }
        if winsAt(s.b, s.a) { return .b }
        return nil
    }

    static func isOver(_ s: Score) -> Bool { winner(s) != nil }

    /// The side one rally from winning, while the game is live.
    static func gamePoint(_ s: Score) -> ScoreSide? {
        if isOver(s) { return nil }
        if winsAt(s.a + 1, s.b) { return .a }
        if winsAt(s.b + 1, s.a) { return .b }
        return nil
    }

    /// Level at 20 or above: "20 all", never deuce.
    static func allAt(_ s: Score) -> Int? {
        !isOver(s) && s.a == s.b && s.a >= gameTo - 1 ? s.a : nil
    }

    static func nextPointWins(_ s: Score) -> Bool { allAt(s) == cap - 1 }

    static func add(_ s: Score, _ side: ScoreSide) -> Score {
        if isOver(s) { return s }
        return side == .a ? Score(a: s.a + 1, b: s.b) : Score(a: s.a, b: s.b + 1)
    }

    /// The leading side reaching 11 for the first time.
    static func reachedInterval(_ prev: Score, _ next: Score) -> Bool {
        max(prev.a, prev.b) < intervalAt && max(next.a, next.b) == intervalAt
    }
}

// MARK: - The game, in the App Group

/// Points in order; the score is folded from them so Undo is a pop.
struct ScoreGame: Codable {
    var gameNo: Int
    var points: [ScoreSide]
    var startedAt: Date

    var score: Score { points.reduce(Score.zero) { ScoreRules.add($0, $1) } }
    var serving: ScoreSide? { points.last }
    var isOver: Bool { ScoreRules.isOver(score) }

    /// Did the last point bring on the interval?
    var atInterval: Bool {
        guard !points.isEmpty else { return false }
        let before = points.dropLast().reduce(Score.zero) { ScoreRules.add($0, $1) }
        return ScoreRules.reachedInterval(before, score)
    }
}

/// A game finished tonight, kept on the phone so the large size can list the
/// evening and "Next game" never loses one. `saved` flips when Add a game logs
/// it (the app's plugin edits this list with JSONSerialization, so the fields
/// are plain numbers and booleans — `finishedAt` is seconds since 1970, not a
/// Date). Cleared at midnight by the read, and on sign-out with the rest.
struct FinishedGame: Codable, Equatable {
    var gameNo: Int
    var a: Int
    var b: Int
    var finishedAt: TimeInterval
    var saved: Bool

    var score: Score { Score(a: a, b: b) }
    var winner: ScoreSide? { ScoreRules.winner(score) }
}

enum ScoreStore {
    /// The game in play (or just finished).
    static let gameKey = "score.game"
    /// Before the list (2026-10-25) one finished game could wait here for Save
    /// game. Read once more and folded into `tonight`, never written again.
    static let legacyPendingKey = "score.pending"
    static let tonightKey = "score.gamesTonight"

    private static var defaults: UserDefaults? { BPMWidgetStore.defaults }

    static var game: ScoreGame? {
        get {
            guard let data = defaults?.data(forKey: gameKey) else { return nil }
            return try? JSONDecoder().decode(ScoreGame.self, from: data)
        }
        set {
            if let game = newValue, let data = try? JSONEncoder().encode(game) {
                defaults?.set(data, forKey: gameKey)
            } else {
                defaults?.removeObject(forKey: gameKey)
            }
        }
    }

    /// Tonight's finished games, oldest first. Yesterday's are dropped on read.
    static var tonight: [FinishedGame] {
        get {
            var list: [FinishedGame] = []
            if let data = defaults?.data(forKey: tonightKey),
               let decoded = try? JSONDecoder().decode([FinishedGame].self, from: data) {
                list = decoded
            }
            if let data = defaults?.data(forKey: legacyPendingKey),
               let parked = try? JSONDecoder().decode(ScoreGame.self, from: data) {
                let s = parked.score
                list.append(FinishedGame(gameNo: parked.gameNo, a: s.a, b: s.b,
                                         finishedAt: parked.startedAt.timeIntervalSince1970, saved: false))
                // Persist the fold BEFORE the legacy key goes, or a read-only
                // caller shows the game once and loses it.
                if let data = try? JSONEncoder().encode(list) { defaults?.set(data, forKey: tonightKey) }
                defaults?.removeObject(forKey: legacyPendingKey)
            }
            return list
                .filter { Calendar.current.isDateInToday(Date(timeIntervalSince1970: $0.finishedAt)) }
                .sorted { $0.gameNo < $1.gameNo }
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) { defaults?.set(data, forKey: tonightKey) }
        }
    }

    /// The newest finished game not yet logged — what the medium's idle row
    /// offers to save.
    static var pending: FinishedGame? { tonight.last { !$0.saved } }

    /// A finished game leaves the court for the list, unless it is there already.
    static func park(_ done: ScoreGame) {
        guard done.isOver else { return }
        var list = tonight
        guard !list.contains(where: { $0.gameNo == done.gameNo }) else { return }
        let s = done.score
        list.append(FinishedGame(gameNo: done.gameNo, a: s.a, b: s.b, finishedAt: Date().timeIntervalSince1970, saved: false))
        tonight = list
    }

    /// "Game 3 tonight": one more than the last game started today.
    static func nextGameNo() -> Int {
        var last = tonight.map(\.gameNo).max() ?? 0
        if let g = game, Calendar.current.isDateInToday(g.startedAt) { last = max(last, g.gameNo) }
        return last + 1
    }

    /// Start the next game; a finished one still on screen is parked, not lost.
    static func startNext() {
        if let done = game, done.isOver { park(done) }
        game = ScoreGame(gameNo: nextGameNo(), points: [], startedAt: Date())
    }

    static func discardPending() {
        var list = tonight
        guard let i = list.lastIndex(where: { !$0.saved }) else { return }
        list.remove(at: i)
        tonight = list
    }

    static func clearAll() {
        for key in [gameKey, legacyPendingKey, tonightKey] { defaults?.removeObject(forKey: key) }
    }

    static func reload() {
        WidgetCenter.shared.reloadTimelines(ofKind: BPMScoreWidget.kind)
    }
}

// MARK: - Intents: every tap runs on the phone, no network

struct StartGameIntent: AppIntent {
    static let title: LocalizedStringResource = "Start keeping score"
    static let isDiscoverable: Bool = false

    func perform() async throws -> some IntentResult {
        ScoreStore.startNext()
        ScoreStore.reload()
        return .result()
    }
}

struct PointIntent: AppIntent {
    static let title: LocalizedStringResource = "A point"
    static let isDiscoverable: Bool = false

    @Parameter(title: "Side")
    var side: String

    init() { side = "a" }
    init(side: ScoreSide) { self.side = side.rawValue }

    func perform() async throws -> some IntentResult {
        guard var game = ScoreStore.game, !game.isOver, let s = ScoreSide(rawValue: side) else { return .result() }
        game.points.append(s)
        ScoreStore.game = game
        ScoreStore.reload()
        return .result()
    }
}

struct UndoPointIntent: AppIntent {
    static let title: LocalizedStringResource = "Take back the last point"
    static let isDiscoverable: Bool = false

    func perform() async throws -> some IntentResult {
        guard var game = ScoreStore.game, !game.points.isEmpty else { return .result() }
        game.points.removeLast()
        ScoreStore.game = game
        ScoreStore.reload()
        return .result()
    }
}

/// "Next game" keeps the finished one in tonight's list and starts 0–0.
struct NextGameIntent: AppIntent {
    static let title: LocalizedStringResource = "Next game"
    static let isDiscoverable: Bool = false

    func perform() async throws -> some IntentResult {
        ScoreStore.startNext()
        ScoreStore.reload()
        return .result()
    }
}

struct DiscardGameIntent: AppIntent {
    static let title: LocalizedStringResource = "Discard this game"
    static let isDiscoverable: Bool = false

    @Parameter(title: "The newest unsaved game in the list, not the one on screen")
    var pending: Bool

    init() { pending = false }
    init(pending: Bool) { self.pending = pending }

    func perform() async throws -> some IntentResult {
        if pending { ScoreStore.discardPending() } else { ScoreStore.game = nil }
        ScoreStore.reload()
        return .result()
    }
}

// MARK: - Timeline: nothing to fetch, so one entry that the taps redraw

struct ScoreEntry: TimelineEntry {
    let date: Date
    let game: ScoreGame?
    let tonight: [FinishedGame]
    let nextGameNo: Int

    var pending: FinishedGame? { tonight.last { !$0.saved } }
}

struct ScoreProvider: TimelineProvider {
    func placeholder(in context: Context) -> ScoreEntry {
        let now = Date().timeIntervalSince1970
        return ScoreEntry(
            date: Date(),
            game: ScoreGame(gameNo: 3, points: [.a, .a, .b, .a, .b, .a], startedAt: Date()),
            tonight: [FinishedGame(gameNo: 1, a: 21, b: 15, finishedAt: now, saved: true),
                      FinishedGame(gameNo: 2, a: 19, b: 21, finishedAt: now, saved: false)],
            nextGameNo: 4)
    }

    func getSnapshot(in context: Context, completion: @escaping (ScoreEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : current())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ScoreEntry>) -> Void) {
        completion(Timeline(entries: [current()], policy: .never))
    }

    private func current() -> ScoreEntry {
        ScoreEntry(date: Date(), game: ScoreStore.game, tonight: ScoreStore.tonight, nextGameNo: ScoreStore.nextGameNo())
    }
}

// MARK: - The widget

enum ScoreLink {
    /// Save game: Add a game opens with the score already in
    /// (lib/widgetBridge.ts `widgetOpenTarget`, lib/gameIntent.ts).
    static func save(_ s: Score) -> URL {
        URL(string: "bpm://open?tab=skills&game=\(s.a)-\(s.b)")!
    }
}

struct BPMScoreView: View {
    let entry: ScoreEntry
    @Environment(\.colorScheme) private var scheme
    @Environment(\.widgetFamily) private var family

    private var large: Bool { family == .systemLarge }

    var body: some View {
        let p = WidgetPalette.make(scheme)
        let gamePoint = entry.game.map { ScoreRules.gamePoint($0.score) } ?? nil
        content(p, gamePoint: gamePoint)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .containerBackground(for: .widget) {
                ZStack {
                    p.background
                    // Game point changes the whole widget: an amber wash (no rim —
                    // the widget draws no strokes), the one moment worth seeing
                    // from across the court.
                    if gamePoint != nil {
                        p.amber.opacity(0.18)
                    }
                }
            }
    }

    @ViewBuilder
    private func content(_ p: WidgetPalette, gamePoint: ScoreSide?) -> some View {
        if let game = entry.game, !game.isOver {
            if large { largePlaying(game, p, gamePoint: gamePoint) } else { playing(game, p, gamePoint: gamePoint) }
        } else if let game = entry.game {
            if large { largeOver(game, p) } else { over(game, p) }
        } else {
            if large { largeIdle(p) } else { idle(p) }
        }
    }

    // MARK: Medium

    // Between games — one tap to start.
    private func idle(_ p: WidgetPalette) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Header(p: p, trailing: "Score")
            Spacer(minLength: 0)
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Keep score").font(.system(size: 22, weight: .bold)).foregroundStyle(p.primary)
                    Text("Game \(entry.nextGameNo) tonight · to \(ScoreRules.gameTo)").font(.system(size: 13)).foregroundStyle(p.secondary)
                }
                Spacer(minLength: 0)
                startChip(p, size: 13)
            }
            if let pending = entry.pending {
                HStack(spacing: 8) {
                    Text("Game \(pending.gameNo) · \(pending.a)–\(pending.b) not saved")
                        .font(.system(size: 11)).foregroundStyle(p.muted).lineLimit(1)
                    Spacer(minLength: 0)
                    Link(destination: ScoreLink.save(pending.score)) {
                        Text("Save").font(.system(size: 11, weight: .bold)).foregroundStyle(p.green)
                    }
                    Button(intent: DiscardGameIntent(pending: true)) {
                        Text("Discard").font(.system(size: 11, weight: .bold)).foregroundStyle(p.muted)
                    }
                    .buttonStyle(.plain)
                }
            }
            Spacer(minLength: 0)
        }
        .widgetURL(WidgetLink.stats)
    }

    // Playing — tap a side for its point. The rules keep count with you.
    private func playing(_ game: ScoreGame, _ p: WidgetPalette, gamePoint: ScoreSide?) -> some View {
        let s = game.score
        return VStack(alignment: .leading, spacing: 8) {
            scoreHeader(game, p, gamePoint: gamePoint)
            HStack(spacing: 8) {
                sideTile(.a, s.a, p, serving: game.serving == .a, gamePoint: gamePoint == .a)
                sideTile(.b, s.b, p, serving: game.serving == .b, gamePoint: gamePoint == .b)
                Button(intent: UndoPointIntent()) {
                    VStack(spacing: 4) {
                        Image(systemName: "arrow.uturn.backward").font(.system(size: 18)).foregroundStyle(p.secondary)
                        Text("Undo").font(.system(size: 10)).foregroundStyle(p.muted)
                    }
                    .frame(width: 44).frame(maxHeight: .infinity)
                }
                .buttonStyle(.plain)
                .disabled(game.points.isEmpty)
            }
        }
    }

    // Game over — save it, or start the next.
    private func over(_ game: ScoreGame, _ p: WidgetPalette) -> some View {
        let s = game.score
        return VStack(alignment: .leading, spacing: 10) {
            Header(p: p, trailing: "Game \(game.gameNo)")
            Spacer(minLength: 0)
            result(s, p, digits: 36, words: 18)
            overChips(s, p)
            Spacer(minLength: 0)
        }
    }

    // MARK: Large — the court-side scoreboard, and the evening so far

    private func largePlaying(_ game: ScoreGame, _ p: WidgetPalette, gamePoint: ScoreSide?) -> some View {
        let s = game.score
        return VStack(alignment: .leading, spacing: 10) {
            scoreHeader(game, p, gamePoint: gamePoint)
            HStack(spacing: 10) {
                sideTile(.a, s.a, p, serving: game.serving == .a, gamePoint: gamePoint == .a, large: true)
                sideTile(.b, s.b, p, serving: game.serving == .b, gamePoint: gamePoint == .b, large: true)
            }
            .frame(maxHeight: .infinity)
            // Undo is a full-width row here, not a 44 pt corner: the thumb
            // that just scored a point should not have to aim.
            Button(intent: UndoPointIntent()) {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.uturn.backward").font(.system(size: 16, weight: .semibold))
                    Text("Undo last point").font(.system(size: 13, weight: .bold))
                }
                .foregroundStyle(p.secondary)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(RoundedRectangle(cornerRadius: 14).fill(p.primary.opacity(0.06)))
            }
            .buttonStyle(.plain)
            .disabled(game.points.isEmpty)
            .opacity(game.points.isEmpty ? 0.5 : 1)
        }
    }

    private func largeOver(_ game: ScoreGame, _ p: WidgetPalette) -> some View {
        let s = game.score
        // The game on screen is not in the list yet; the list is the rest of
        // the night.
        let earlier = entry.tonight.filter { $0.gameNo != game.gameNo }
        return VStack(alignment: .leading, spacing: 10) {
            Header(p: p, trailing: "Game \(game.gameNo)")
            result(s, p, digits: 48, words: 20).padding(.vertical, 2)
            overChips(s, p)
            rule(p)
            tonightList(earlier, p)
            Spacer(minLength: 0)
        }
    }

    private func largeIdle(_ p: WidgetPalette) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Header(p: p, trailing: "Score")
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Keep score").font(.system(size: 24, weight: .bold)).foregroundStyle(p.primary)
                    Text("Game \(entry.nextGameNo) tonight · to \(ScoreRules.gameTo)").font(.system(size: 13)).foregroundStyle(p.secondary)
                }
                Spacer(minLength: 0)
                startChip(p, size: 14)
            }
            .padding(.vertical, 2)
            rule(p)
            tonightList(entry.tonight, p)
            Spacer(minLength: 0)
            if let tally = tally(entry.tonight) {
                Text(tally).font(.system(size: 11)).foregroundStyle(p.muted)
            }
        }
        .widgetURL(WidgetLink.stats)
    }

    /// Every game finished on this phone tonight, saved or not. A "Not saved"
    /// row is a tap into Add a game with that score, exactly as Save game is.
    @ViewBuilder
    private func tonightList(_ games: [FinishedGame], _ p: WidgetPalette) -> some View {
        if games.isEmpty {
            Text("No games finished yet tonight").font(.system(size: 12)).foregroundStyle(p.muted)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(text: "Tonight", color: p.muted)
                ForEach(games.suffix(4), id: \.gameNo) { g in
                    if g.saved {
                        tonightRow(g, p)
                    } else {
                        Link(destination: ScoreLink.save(g.score)) { tonightRow(g, p) }
                    }
                }
            }
        }
    }

    private func tonightRow(_ g: FinishedGame, _ p: WidgetPalette) -> some View {
        HStack(spacing: 10) {
            Text("Game \(g.gameNo)").font(.system(size: 12)).foregroundStyle(p.secondary)
                .frame(width: 56, alignment: .leading)
            Text("\(g.a)–\(g.b)").font(.system(size: 12, weight: .bold, design: .monospaced)).foregroundStyle(p.primary)
                .frame(width: 56, alignment: .leading)
            if let w = g.winner {
                Text(w.name).font(.system(size: 12, weight: .semibold)).foregroundStyle(w == .a ? p.green : p.blue)
            }
            Spacer(minLength: 0)
            Text(g.saved ? "Saved" : "Not saved").font(.system(size: 11)).foregroundStyle(p.muted)
        }
        .lineLimit(1)
    }

    /// "A side 2 · B side 1 tonight".
    private func tally(_ games: [FinishedGame]) -> String? {
        guard !games.isEmpty else { return nil }
        let a = games.filter { $0.winner == .a }.count
        let b = games.filter { $0.winner == .b }.count
        return "A side \(a) · B side \(b) tonight"
    }

    private func rule(_ p: WidgetPalette) -> some View {
        Rectangle().fill(p.rule).frame(height: 1)
    }

    // MARK: Pieces both sizes share

    /// The header says what matters now, in the umpire's words.
    private func scoreHeader(_ game: ScoreGame, _ p: WidgetPalette, gamePoint: ScoreSide?) -> some View {
        HStack(spacing: 6) {
            BPMMark(p: p)
            Text("BPM").font(.system(size: 11, weight: .bold)).foregroundStyle(p.secondary)
            Spacer(minLength: 4)
            statusBadge(game, p, gamePoint: gamePoint)
        }
    }

    @ViewBuilder
    private func statusBadge(_ game: ScoreGame, _ p: WidgetPalette, gamePoint: ScoreSide?) -> some View {
        let s = game.score
        if let gp = gamePoint {
            badge("Game point · \(gp.name)", fill: p.amber, text: p.onAmber, icon: "bolt.fill")
        } else if ScoreRules.nextPointWins(s) {
            badge("29 all · next point wins", fill: p.badge, text: p.onBadge, icon: nil)
        } else if let at = ScoreRules.allAt(s) {
            badge("\(at) all · win by two", fill: p.badge, text: p.onBadge, icon: nil)
        } else if game.atInterval {
            // The large has room to say what the interval is also for.
            Text(large ? "Interval · change ends" : "Interval")
                .font(.system(size: 11, weight: .semibold)).foregroundStyle(large ? p.primary : p.secondary)
        } else {
            Text("Game \(game.gameNo) · to \(ScoreRules.gameTo)").font(.system(size: 11)).foregroundStyle(p.muted)
        }
    }

    private func badge(_ text: String, fill: Color, text textColor: Color, icon: String?) -> some View {
        HStack(spacing: 3) {
            if let icon = icon { Image(systemName: icon).font(.system(size: 9, weight: .bold)) }
            Text(text.uppercased()).font(.system(size: 9, weight: .heavy)).tracking(0.6)
        }
        .padding(.horizontal, 8).padding(.vertical, 3)
        .foregroundStyle(textColor)
        .background(Capsule().fill(fill))
        .lineLimit(1)
    }

    /// Each half is a button: a tap adds a point to that side. The large size
    /// draws the digits at 92 pt — readable from the far court.
    private func sideTile(_ side: ScoreSide, _ points: Int, _ p: WidgetPalette, serving: Bool, gamePoint: Bool, large: Bool = false) -> some View {
        let tint = side == .a ? p.green : p.blue
        return Button(intent: PointIntent(side: side)) {
            ZStack(alignment: .topTrailing) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(side.name).font(.system(size: large ? 13 : 12, weight: .semibold)).foregroundStyle(tint)
                    Text("\(points)").font(.system(size: large ? 92 : 44, weight: .bold, design: .monospaced))
                        .foregroundStyle(gamePoint ? p.amber : p.primary).minimumScaleFactor(0.5).lineLimit(1)
                    Text(gamePoint ? "+1 wins it" : "+1").font(.system(size: large ? 12 : 11, weight: .bold))
                        .foregroundStyle(gamePoint ? p.amber : p.muted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .padding(.horizontal, large ? 14 : 12).padding(.vertical, large ? 10 : 6)
                // The amber dot is who serves — it follows the last rally.
                if serving { Circle().fill(p.amber).frame(width: large ? 9 : 8, height: large ? 9 : 8).padding(large ? 10 : 8) }
            }
            // No stroke (Grant, on the canvas): the tint alone is the tile, and
            // game point turns it amber rather than outlining it.
            .background(RoundedRectangle(cornerRadius: large ? 16 : 14).fill((gamePoint ? p.amber : tint).opacity(gamePoint ? 0.22 : 0.14)))
        }
        .buttonStyle(.plain)
    }

    private func startChip(_ p: WidgetPalette, size: CGFloat) -> some View {
        Button(intent: StartGameIntent()) {
            Label("Start", systemImage: "play.fill").font(.system(size: size, weight: .bold))
                .padding(.horizontal, size > 13 ? 18 : 14).padding(.vertical, size > 13 ? 10 : 7)
                .foregroundStyle(p.onGreen)
                .background(Capsule().fill(p.green))
        }
        .buttonStyle(.plain)
    }

    private func result(_ s: Score, _ p: WidgetPalette, digits: CGFloat, words: CGFloat) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(s.a)–\(s.b)").font(.system(size: digits, weight: .bold, design: .monospaced)).foregroundStyle(p.primary)
            if let w = ScoreRules.winner(s) {
                Text("\(w.name) wins").font(.system(size: words, weight: .bold)).foregroundStyle(w == .a ? p.green : p.blue)
            }
        }
    }

    private func overChips(_ s: Score, _ p: WidgetPalette) -> some View {
        HStack(spacing: 8) {
            Link(destination: ScoreLink.save(s)) {
                Label("Save game", systemImage: "checkmark").font(.system(size: 12, weight: .bold))
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .foregroundStyle(p.onGreen)
                    .background(Capsule().fill(p.green))
            }
            Button(intent: NextGameIntent()) { ghost("Next game", p) }.buttonStyle(.plain)
            Button(intent: DiscardGameIntent(pending: false)) { ghost("Discard", p) }.buttonStyle(.plain)
        }
    }

    private func ghost(_ text: String, _ p: WidgetPalette) -> some View {
        Text(text).font(.system(size: 12, weight: .bold))
            .padding(.horizontal, 12).padding(.vertical, 6)
            .foregroundStyle(p.secondary)
            .background(Capsule().fill(p.primary.opacity(0.06)))
    }
}

struct BPMScoreWidget: Widget {
    static let kind = "BPMScore"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: ScoreProvider()) { entry in
            BPMScoreView(entry: entry)
        }
        .configurationDisplayName("Keep score")
        .description("Tap a side for its point. Game point, 20 all and the interval are called for you; Save game logs it in BPM. The large size lists tonight's games.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
