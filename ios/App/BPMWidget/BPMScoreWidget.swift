import WidgetKit
import SwiftUI
import AppIntents

// Keeping score from the widget (docs/plans/native-widgets.md, "Keeping score
// from the widget"; drawn on the Native page of the design canvas). Nothing
// here touches the network: the score lives on the phone until Save game
// opens Add a game with it. The rules are a port of lib/scoreRules.ts — the
// spec — and `__tests__/score-rules.test.ts` is what this port is held to.

// MARK: - Rules (lib/scoreRules.ts)

enum ScoreSide: String, Codable {
    case a, b

    /// Two neutral sides, so whoever holds the phone can keep score for any
    /// court (Grant, 2026-10-23: not "Us" and "Them").
    var name: String { self == .a ? "Green" : "Blue" }
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

enum ScoreStore {
    /// The game in play (or just finished).
    static let gameKey = "score.game"
    /// A finished game waiting for Save game — "Next game" parks it here.
    static let pendingKey = "score.pending"
    static let gamesTonightKey = "score.gamesTonight"

    private static var defaults: UserDefaults? { BPMWidgetStore.defaults }

    static func load(_ key: String) -> ScoreGame? {
        guard let data = defaults?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(ScoreGame.self, from: data)
    }

    static func save(_ game: ScoreGame?, _ key: String) {
        if let game = game, let data = try? JSONEncoder().encode(game) {
            defaults?.set(data, forKey: key)
        } else {
            defaults?.removeObject(forKey: key)
        }
    }

    static var game: ScoreGame? {
        get { load(gameKey) }
        set { save(newValue, gameKey) }
    }

    static var pending: ScoreGame? {
        get { load(pendingKey) }
        set { save(newValue, pendingKey) }
    }

    /// "Game 3 tonight": counted from the first game started today.
    static func nextGameNo() -> Int {
        let last = game ?? pending
        if let last = last, Calendar.current.isDateInToday(last.startedAt) { return last.gameNo + 1 }
        return 1
    }

    static func clearAll() {
        for key in [gameKey, pendingKey, gamesTonightKey] { defaults?.removeObject(forKey: key) }
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
        // A finished game still on screen is parked, not lost.
        if let done = ScoreStore.game, done.isOver, ScoreStore.pending == nil { ScoreStore.pending = done }
        ScoreStore.game = ScoreGame(gameNo: ScoreStore.nextGameNo(), points: [], startedAt: Date())
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

/// "Next game" keeps the finished one waiting to save and starts 0–0.
struct NextGameIntent: AppIntent {
    static let title: LocalizedStringResource = "Next game"
    static let isDiscoverable: Bool = false

    func perform() async throws -> some IntentResult {
        if let done = ScoreStore.game, done.isOver { ScoreStore.pending = done }
        ScoreStore.game = ScoreGame(gameNo: ScoreStore.nextGameNo(), points: [], startedAt: Date())
        ScoreStore.reload()
        return .result()
    }
}

struct DiscardGameIntent: AppIntent {
    static let title: LocalizedStringResource = "Discard this game"
    static let isDiscoverable: Bool = false

    @Parameter(title: "The parked game, not the one in play")
    var pending: Bool

    init() { pending = false }
    init(pending: Bool) { self.pending = pending }

    func perform() async throws -> some IntentResult {
        if pending { ScoreStore.pending = nil } else { ScoreStore.game = nil }
        ScoreStore.reload()
        return .result()
    }
}

// MARK: - Timeline: nothing to fetch, so one entry that the taps redraw

struct ScoreEntry: TimelineEntry {
    let date: Date
    let game: ScoreGame?
    let pending: ScoreGame?
    let nextGameNo: Int
}

struct ScoreProvider: TimelineProvider {
    func placeholder(in context: Context) -> ScoreEntry {
        ScoreEntry(date: Date(), game: ScoreGame(gameNo: 3, points: [.a, .a, .b, .a, .b, .a], startedAt: Date()), pending: nil, nextGameNo: 3)
    }

    func getSnapshot(in context: Context, completion: @escaping (ScoreEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : current())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ScoreEntry>) -> Void) {
        completion(Timeline(entries: [current()], policy: .never))
    }

    private func current() -> ScoreEntry {
        ScoreEntry(date: Date(), game: ScoreStore.game, pending: ScoreStore.pending, nextGameNo: ScoreStore.nextGameNo())
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

    var body: some View {
        let p = WidgetPalette.make(scheme)
        let gamePoint = entry.game.map { ScoreRules.gamePoint($0.score) } ?? nil
        content(p, gamePoint: gamePoint)
            .padding(16)
            .containerBackground(for: .widget) {
                ZStack {
                    p.background
                    // Game point changes the whole widget: an amber wash and rim,
                    // the one moment worth seeing from across the court.
                    if gamePoint != nil {
                        p.amber.opacity(0.18)
                        RoundedRectangle(cornerRadius: 22).strokeBorder(p.amber.opacity(0.7), lineWidth: 1.5).padding(1)
                    }
                }
            }
    }

    @ViewBuilder
    private func content(_ p: WidgetPalette, gamePoint: ScoreSide?) -> some View {
        if let game = entry.game, !game.isOver {
            playing(game, p, gamePoint: gamePoint)
        } else if let game = entry.game {
            over(game, p)
        } else {
            idle(p)
        }
    }

    // Between games — one tap to start.
    private func idle(_ p: WidgetPalette) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Header(p: p, trailing: "Score")
            Spacer(minLength: 0)
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Keep score").font(.system(size: 18, weight: .bold)).foregroundStyle(p.primary)
                    Text("Game \(entry.nextGameNo) tonight · to \(ScoreRules.gameTo)").font(.system(size: 12)).foregroundStyle(p.secondary)
                }
                Spacer(minLength: 0)
                Button(intent: StartGameIntent()) {
                    Label("Start", systemImage: "play.fill").font(.system(size: 11, weight: .bold))
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .foregroundStyle(Color(red: 0.02, green: 0.18, blue: 0.09))
                        .background(Capsule().fill(p.green))
                }
                .buttonStyle(.plain)
            }
            if let pending = entry.pending {
                HStack(spacing: 8) {
                    Text("Game \(pending.gameNo) · \(pending.score.a)–\(pending.score.b) not saved")
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
            HStack(spacing: 6) {
                Image(systemName: "figure.badminton").font(.system(size: 11, weight: .bold)).foregroundStyle(p.green).widgetAccentable()
                Text("BPM").font(.system(size: 11, weight: .bold)).foregroundStyle(p.secondary)
                Spacer(minLength: 4)
                statusBadge(game, p, gamePoint: gamePoint)
            }
            HStack(spacing: 8) {
                sideTile(.a, s.a, p, serving: game.serving == .a, gamePoint: gamePoint == .a)
                sideTile(.b, s.b, p, serving: game.serving == .b, gamePoint: gamePoint == .b)
                Button(intent: UndoPointIntent()) {
                    VStack(spacing: 4) {
                        Image(systemName: "arrow.uturn.backward").font(.system(size: 18)).foregroundStyle(p.secondary)
                        Text("Undo").font(.system(size: 10)).foregroundStyle(p.muted)
                    }
                    .frame(width: 44, maxHeight: .infinity)
                }
                .buttonStyle(.plain)
                .disabled(game.points.isEmpty)
            }
        }
    }

    @ViewBuilder
    private func statusBadge(_ game: ScoreGame, _ p: WidgetPalette, gamePoint: ScoreSide?) -> some View {
        let s = game.score
        if let gp = gamePoint {
            badge("Game point · \(gp.name)", fill: p.amber, text: Color(red: 0.23, green: 0.13, blue: 0.01), icon: "bolt.fill")
        } else if ScoreRules.nextPointWins(s) {
            badge("29 all · next point wins", fill: p.badge, text: p.onBadge, icon: nil)
        } else if let at = ScoreRules.allAt(s) {
            badge("\(at) all · win by two", fill: p.badge, text: p.onBadge, icon: nil)
        } else if game.atInterval {
            Text("Interval").font(.system(size: 11, weight: .semibold)).foregroundStyle(p.secondary)
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

    /// Each half is a button: a tap adds a point to that side.
    private func sideTile(_ side: ScoreSide, _ points: Int, _ p: WidgetPalette, serving: Bool, gamePoint: Bool) -> some View {
        let tint = side == .a ? p.green : p.blue
        return Button(intent: PointIntent(side: side)) {
            ZStack(alignment: .topTrailing) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(side.name).font(.system(size: 11, weight: .semibold)).foregroundStyle(tint)
                    Text("\(points)").font(.system(size: 36, weight: .bold, design: .monospaced))
                        .foregroundStyle(gamePoint ? p.amber : p.primary).minimumScaleFactor(0.7).lineLimit(1)
                    Text(gamePoint ? "+1 wins it" : "+1").font(.system(size: 11, weight: .bold))
                        .foregroundStyle(gamePoint ? p.amber : p.muted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .padding(.horizontal, 12).padding(.vertical, 8)
                // The amber dot is who serves — it follows the last rally.
                if serving { Circle().fill(p.amber).frame(width: 8, height: 8).padding(8) }
            }
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(tint.opacity(0.14))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(gamePoint ? p.amber : tint.opacity(0.35), lineWidth: 1))
            )
        }
        .buttonStyle(.plain)
    }

    // Game over — save it, or start the next.
    private func over(_ game: ScoreGame, _ p: WidgetPalette) -> some View {
        let s = game.score
        let winner = ScoreRules.winner(s)
        return VStack(alignment: .leading, spacing: 10) {
            Header(p: p, trailing: "Game \(game.gameNo)")
            Spacer(minLength: 0)
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("\(s.a)–\(s.b)").font(.system(size: 28, weight: .bold, design: .monospaced)).foregroundStyle(p.primary)
                if let w = winner {
                    Text("\(w.name) wins").font(.system(size: 16, weight: .bold)).foregroundStyle(w == .a ? p.green : p.blue)
                }
            }
            HStack(spacing: 8) {
                Link(destination: ScoreLink.save(s)) {
                    Label("Save game", systemImage: "checkmark").font(.system(size: 11, weight: .bold))
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .foregroundStyle(Color(red: 0.02, green: 0.18, blue: 0.09))
                        .background(Capsule().fill(p.green))
                }
                Button(intent: NextGameIntent()) { ghost("Next game", p) }.buttonStyle(.plain)
                Button(intent: DiscardGameIntent(pending: false)) { ghost("Discard", p) }.buttonStyle(.plain)
            }
            Spacer(minLength: 0)
        }
    }

    private func ghost(_ text: String, _ p: WidgetPalette) -> some View {
        Text(text).font(.system(size: 11, weight: .bold))
            .padding(.horizontal, 10).padding(.vertical, 4)
            .foregroundStyle(p.secondary)
            .background(Capsule().strokeBorder(p.rule, lineWidth: 1).background(Capsule().fill(p.primary.opacity(0.06))))
    }
}

struct BPMScoreWidget: Widget {
    static let kind = "BPMScore"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: ScoreProvider()) { entry in
            BPMScoreView(entry: entry)
        }
        .configurationDisplayName("Keep score")
        .description("Tap a side for its point. Game point, 20 all and the interval are called for you; Save game logs it in BPM.")
        .supportedFamilies([.systemMedium])
    }
}
