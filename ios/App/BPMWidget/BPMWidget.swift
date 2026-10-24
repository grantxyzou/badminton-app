import WidgetKit
import SwiftUI
import AppIntents

// The home-screen and lock-screen widgets (docs/plans/native-widgets.md).
// Drawn on the Native page of the design canvas: small is the week, medium
// adds the balance, large adds your level; the lock screen keeps the amount
// private until Face ID.

@main
struct BPMWidgets: WidgetBundle {
    var body: some Widget {
        BPMWeekWidget()
        BPMLockWidget()
        BPMScoreWidget()
    }
}

// MARK: - Timeline

struct BPMEntry: TimelineEntry {
    enum Kind {
        case ready
        /// No pass, or the server no longer knows it: "Open BPM and sign in".
        case signedOut
    }

    let date: Date
    let state: Kind
    let snapshot: WidgetSnapshot?
    /// The snapshot is the cached one: the last read failed.
    let stale: Bool
    let undoOffered: Bool
    let failure: WidgetFailure?
}

struct BPMProvider: TimelineProvider {
    func placeholder(in context: Context) -> BPMEntry {
        BPMEntry(date: Date(), state: .ready, snapshot: .preview, stale: false, undoOffered: false, failure: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (BPMEntry) -> Void) {
        if context.isPreview {
            completion(placeholder(in: context))
            return
        }
        Task { completion(await load()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<BPMEntry>) -> Void) {
        Task {
            let entry = await load()
            completion(Timeline(entries: [entry], policy: .after(nextRefresh(for: entry.snapshot))))
        }
    }

    private func load() async -> BPMEntry {
        let now = Date()
        do {
            let snapshot = try await BPMWidgetAPI.fetchSnapshot()
            return BPMEntry(date: now, state: .ready, snapshot: snapshot, stale: false,
                            undoOffered: BPMWidgetStore.undoOffered && snapshot.session?.me != "out",
                            failure: BPMWidgetStore.recentFailure)
        } catch WidgetAPIError.signedOut {
            BPMWidgetStore.forgetSnapshot()
            return BPMEntry(date: now, state: .signedOut, snapshot: nil, stale: false, undoOffered: false, failure: nil)
        } catch {
            // Keep what it last showed, honestly dated, rather than a confident zero.
            return BPMEntry(date: now, state: .ready, snapshot: BPMWidgetStore.cachedSnapshot(), stale: true,
                            undoOffered: false, failure: BPMWidgetStore.recentFailure)
        }
    }

    /// Every 30 minutes, every 15 on the day of a session. iPhone treats this
    /// as a request, not a promise; the app also asks for a redraw whenever it
    /// goes to the background.
    private func nextRefresh(for snapshot: WidgetSnapshot?) -> Date {
        if let start = snapshot?.session.flatMap({ WidgetDates.parse($0.datetime) }),
           abs(start.timeIntervalSinceNow) < 24 * 3600 {
            return Date().addingTimeInterval(15 * 60)
        }
        return Date().addingTimeInterval(30 * 60)
    }
}

// MARK: - The week's status, decided once for every size

enum WeekStatus {
    case noSession
    case settled
    case inSession
    case waitlist(position: Int?)
    case join
    case joinWaitlist
    case notOpen
    case closed

    init(_ s: WidgetSnapshot.Session?) {
        guard let s = s else { self = .noSession; return }
        if s.me == "in" { self = .inSession; return }
        if s.me == "waitlist" { self = .waitlist(position: s.waitlistPosition); return }
        if s.settled { self = .settled; return }
        if !s.signupOpen { self = .notOpen; return }
        if s.closed { self = .closed; return }
        self = s.inCount >= s.max ? .joinWaitlist : .join
    }
}

enum WidgetDates {
    private static let zone = TimeZone(identifier: "America/Vancouver") ?? .current

    static func parse(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso)
    }

    private static func format(_ date: Date, _ pattern: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = zone
        f.dateFormat = pattern
        return f.string(from: date)
    }

    /// "Thu, Oct 23"
    static func day(_ iso: String) -> String {
        guard let d = parse(iso) else { return "" }
        return format(d, "EEE, MMM d")
    }

    /// "Thu 7 PM", "Thu 7:30 PM"
    static func shortDayTime(_ iso: String) -> String {
        guard let d = parse(iso) else { return "" }
        return format(d, "EEE") + " " + time(iso)
    }

    /// "7 PM", "7:30 PM"
    static func time(_ iso: String) -> String {
        guard let d = parse(iso) else { return "" }
        return format(d, Calendar.current.component(.minute, from: d) == 0 ? "h a" : "h:mm a")
    }

    /// "Oct 15"
    static func monthDay(_ iso: String) -> String {
        guard let d = parse(iso) else { return "" }
        return format(d, "MMM d")
    }

    /// "9:38 PM"
    static func clock(_ date: Date) -> String {
        format(date, "h:mm a")
    }
}

func money(_ amount: Double) -> String {
    amount.rounded() == amount ? String(format: "$%.0f", amount) : String(format: "$%.2f", amount)
}

// MARK: - Palette: dark by default, light with the phone, one accent when tinted

struct WidgetPalette {
    let primary: Color
    let secondary: Color
    let muted: Color
    let green: Color
    let amber: Color
    let blue: Color
    let track: Color
    let rule: Color
    let background: LinearGradient
    /// Text on a green fill (the Join / Start / Save chips) and on an amber one
    /// (the game-point badge): dark on the bright dark-mode tints, white on the
    /// deeper light-mode ones — dark-on-#16a34a did not pass.
    let onGreen: Color
    let onAmber: Color
    /// A solid badge in the text colour, and the text to put on it: the ground's
    /// own colour, so it reads in both modes (it was navy-on-navy in light).
    var badge: Color { primary.opacity(0.92) }
    let onBadge: Color

    static func make(_ scheme: ColorScheme) -> WidgetPalette {
        if scheme == .light {
            return WidgetPalette(
                primary: Color(red: 0.06, green: 0.09, blue: 0.16),
                secondary: Color(red: 0.28, green: 0.33, blue: 0.41),
                muted: Color(red: 0.39, green: 0.45, blue: 0.55),
                green: Color(red: 0.09, green: 0.64, blue: 0.29),
                amber: Color(red: 0.71, green: 0.33, blue: 0.04),
                blue: Color(red: 0.15, green: 0.39, blue: 0.92),
                track: Color.black.opacity(0.1),
                rule: Color.black.opacity(0.08),
                background: LinearGradient(colors: [.white, Color(red: 0.95, green: 0.96, blue: 0.96)],
                                           startPoint: .topLeading, endPoint: .bottomTrailing),
                onGreen: .white,
                onAmber: .white,
                onBadge: .white)
        }
        return WidgetPalette(
            primary: .white,
            secondary: Color.white.opacity(0.65),
            muted: Color.white.opacity(0.5),
            green: Color(red: 0.29, green: 0.87, blue: 0.5),
            amber: Color(red: 0.98, green: 0.75, blue: 0.14),
            blue: Color(red: 0.38, green: 0.65, blue: 0.98),
            track: Color.white.opacity(0.12),
            rule: Color.white.opacity(0.08),
            background: LinearGradient(colors: [Color(red: 0.11, green: 0.10, blue: 0.10),
                                                Color(red: 0.06, green: 0.06, blue: 0.06)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing),
            onGreen: Color(red: 0.02, green: 0.18, blue: 0.09),
            onAmber: Color(red: 0.23, green: 0.13, blue: 0.01),
            onBadge: Color(red: 0.06, green: 0.09, blue: 0.16))
    }
}

/// Where a tap lands. The widget names a tab, never a path
/// (`widgetOpenTarget` in lib/widgetBridge.ts).
enum WidgetLink {
    static let home = URL(string: "bpm://open?tab=home")!
    static let stats = URL(string: "bpm://open?tab=skills")!
    static let stringing = URL(string: "bpm://open?tab=stringing")!
}

// MARK: - Pieces shared by every size

struct Header: View {
    let p: WidgetPalette
    var trailing: String? = nil

    var body: some View {
        HStack(spacing: 6) {
            BPMMark(p: p)
            Text("BPM").font(.system(size: 11, weight: .bold)).foregroundStyle(p.secondary)
            Spacer(minLength: 4)
            if let trailing = trailing {
                Text(trailing).font(.system(size: 11)).foregroundStyle(p.muted).lineLimit(1)
            }
        }
    }
}

struct FillBar: View {
    let fraction: Double
    let p: WidgetPalette
    var color: Color? = nil

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(p.track)
                Capsule().fill(color ?? p.green).frame(width: geo.size.width * min(max(fraction, 0), 1)).widgetAccentable()
            }
        }
        .frame(height: 5)
    }
}

/// The BPM mark: the shuttle from public/brand/bpm-logo.svg, drawn as paths so
/// it needs no asset in the extension's catalog and takes the accent tint.
/// Grant, 2026-10-24: "I want BPM and logo to get implemented".
struct BPMMark: View {
    let p: WidgetPalette
    var size: CGFloat = 16

    var body: some View {
        Canvas { ctx, box in
            let k = box.height / 36
            let ox = (box.width - 28 * k) / 2 - 6 * k
            func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * k, y: y * k) }
            var strings = Path()
            for tip in [(11.0, 6.0), (15.0, 5.0), (20.0, 4.0), (25.0, 5.0), (29.0, 6.0)] {
                strings.move(to: pt(20, 30)); strings.addLine(to: pt(tip.0, tip.1))
            }
            ctx.stroke(strings, with: .color(p.green), style: StrokeStyle(lineWidth: 1.7 * k, lineCap: .round))
            var rim = Path()
            rim.move(to: pt(11, 6)); rim.addQuadCurve(to: pt(29, 6), control: pt(20, 2))
            ctx.stroke(rim, with: .color(p.green.opacity(0.55)), style: StrokeStyle(lineWidth: 1.7 * k, lineCap: .round))
            let cork = Path(ellipseIn: CGRect(x: ox + 15.5 * k, y: 27.4 * k, width: 9 * k, height: 5.2 * k))
            ctx.fill(cork, with: .color(p.green))
        }
        .frame(width: size * 28 / 36, height: size)
        .widgetAccentable()
    }
}

struct SectionLabel: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text.uppercased()).font(.system(size: 10, weight: .bold)).tracking(0.8).foregroundStyle(color)
    }
}

/// The week: the big status line, the count, the bar — and the Join, Undo or
/// failure line where one applies.
struct WeekBlock: View {
    let entry: BPMEntry
    let p: WidgetPalette
    var big: Bool = true
    var showsActions: Bool = true

    private var session: WidgetSnapshot.Session? { entry.snapshot?.session }

    var body: some View {
        let status = WeekStatus(session)
        VStack(alignment: .leading, spacing: 6) {
            headline(status)
            countLine(status)
            if let s = session {
                FillBar(fraction: s.max > 0 ? Double(s.inCount) / Double(s.max) : 0, p: p)
            }
        }
    }

    @ViewBuilder private func headline(_ status: WeekStatus) -> some View {
        let size: CGFloat = big ? 20 : 18
        if showsActions, let failure = entry.failure {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.circle").foregroundStyle(p.amber)
                Text(failure == .join ? "Couldn't join" : "Couldn't undo")
                    .font(.system(size: 18, weight: .bold)).foregroundStyle(p.primary).lineLimit(1)
            }
        } else {
            switch status {
            case .inSession:
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(p.green).widgetAccentable()
                    Text("Signed up").font(.system(size: size + 2, weight: .bold)).foregroundStyle(p.primary)
                }
            case .waitlist(let position):
                HStack(spacing: 6) {
                    Image(systemName: "hourglass").foregroundStyle(p.amber)
                    Text(position.map { "Waitlist · \(ordinal($0))" } ?? "On the waitlist")
                        .font(.system(size: size, weight: .bold)).foregroundStyle(p.primary).lineLimit(1)
                }
            case .join, .joinWaitlist:
                HStack(spacing: 8) {
                    Text(status.isFull ? "Full" : "Open now")
                        .font(.system(size: size, weight: .bold)).foregroundStyle(p.primary).lineLimit(1)
                    if showsActions {
                        Button(intent: JoinSessionIntent(waitlist: status.isFull)) {
                            Text(status.isFull ? "Join waitlist" : "Join")
                                .font(.system(size: 11, weight: .bold))
                                .padding(.horizontal, 10).padding(.vertical, 3)
                                .foregroundStyle(status.isFull ? p.amber : p.onGreen)
                                .background(Capsule().fill(status.isFull ? p.amber.opacity(0.18) : p.green))
                        }
                        .buttonStyle(.plain)
                        .widgetAccentable()
                    }
                }
            case .notOpen:
                HStack(spacing: 6) {
                    Image(systemName: "clock").foregroundStyle(p.secondary)
                    Text("Not open yet").font(.system(size: size, weight: .bold)).foregroundStyle(p.primary).lineLimit(1)
                }
            case .closed:
                Text("Sign-ups closed").font(.system(size: size, weight: .bold)).foregroundStyle(p.primary).lineLimit(1)
            case .settled:
                Text("Played").font(.system(size: size, weight: .bold)).foregroundStyle(p.primary)
            case .noSession:
                Text("No session this week").font(.system(size: 17, weight: .bold)).foregroundStyle(p.secondary)
            }
        }
    }

    @ViewBuilder private func countLine(_ status: WeekStatus) -> some View {
        if let s = session {
            if showsActions, entry.failure != nil {
                Text("Tap to finish in BPM").font(.system(size: 12)).foregroundStyle(p.secondary)
            } else if showsActions, entry.undoOffered, case .inSession = status {
                HStack(spacing: 4) {
                    Text("\(s.inCount) signed up ·").font(.system(size: 12)).foregroundStyle(p.secondary)
                    Button(intent: UndoJoinIntent()) {
                        Text("Undo").font(.system(size: 12, weight: .semibold)).underline().foregroundStyle(p.primary)
                    }
                    .buttonStyle(.plain)
                }
            } else if s.waitingCount > 0 && s.inCount >= s.max {
                Text("\(s.inCount) signed up · \(s.waitingCount) waiting").font(.system(size: 12)).foregroundStyle(p.secondary)
            } else {
                let left = max(s.max - s.inCount, 0)
                Text("\(s.inCount) signed up" + (left > 0 ? " · \(left) spot\(left == 1 ? "" : "s") left" : ""))
                    .font(.system(size: 12)).foregroundStyle(p.secondary).lineLimit(1)
            }
        }
    }
}

extension WeekStatus {
    var isFull: Bool {
        if case .joinWaitlist = self { return true }
        return false
    }
}

func ordinal(_ n: Int) -> String {
    let tens = n % 100
    let suffix = (11...13).contains(tens) ? "th" : (n % 10 == 1 ? "st" : n % 10 == 2 ? "nd" : n % 10 == 3 ? "rd" : "th")
    return "\(n)\(suffix)"
}

struct PaidUp: View {
    let p: WidgetPalette

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 13))
            Text("All paid").font(.system(size: 12, weight: .semibold))
        }
        .foregroundStyle(p.green)
        .lineLimit(1)
    }
}

struct BalanceBlock: View {
    let owed: WidgetSnapshot.Owed
    let p: WidgetPalette

    var body: some View {
        // Quiet on purpose (Grant, on the canvas: "this side looks busy"): a
        // label and the amount, no line, no date, so the week reads first.
        // Nothing owed is "All paid", never "Owed $0".
        if owed.total <= 0 {
            PaidUp(p: p)
        } else {
            VStack(alignment: .trailing, spacing: 2) {
                SectionLabel(text: "Owed", color: p.muted)
                Text(money(owed.total))
                    .font(.system(size: 20, weight: .bold, design: .monospaced))
                    .foregroundStyle(p.amber)
                    .minimumScaleFactor(0.7).lineLimit(1)
            }
        }
    }
}

/// Your level against yourself — the "Your skills" rule: no club figure here.
struct LevelBlock: View {
    let level: WidgetSnapshot.Level
    let p: WidgetPalette

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                SectionLabel(text: "Your level", color: p.muted)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(String(format: "%.1f", level.overall))
                        .font(.system(size: 28, weight: .bold, design: .monospaced)).foregroundStyle(p.primary)
                    Text("of 5").font(.system(size: 12)).foregroundStyle(p.muted)
                }
                if let label = level.phaseLabel {
                    Text(label).font(.system(size: 12, weight: .semibold)).foregroundStyle(p.blue).widgetAccentable()
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Sparkline(values: level.history, color: p.blue, track: p.rule)
                    .frame(height: 40)
                Text(trendLine).font(.system(size: 12)).foregroundStyle(p.secondary).lineLimit(2)
            }
        }
    }

    private var trendLine: String {
        var parts: [String] = []
        if let delta = level.delta, let at = level.prevAt, abs(delta) >= 0.05 {
            parts.append("\(delta > 0 ? "Up" : "Down") \(String(format: "%.1f", abs(delta))) since \(WidgetDates.monthDay(at))")
        }
        if let workOn = level.workOn {
            parts.append("work on \(workOn.lowercased())")
        }
        return parts.isEmpty ? "Check in again to see it move" : parts.joined(separator: " · ")
    }
}

/// The large widget's third section: the racket on the bench, or the strings
/// wearing in. Four steps, as the player's track on Home (drop off, with the
/// stringer, being strung, ready); the restring bar fills by date against the
/// club's interval, and the advice is "consider", never "overdue".
struct StringingBlock: View {
    let stringing: WidgetSnapshot.Stringing
    let p: WidgetPalette

    private static let steps = ["Dropped off", "With the stringer", "Being strung", "Ready"]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let job = stringing.job {
                HStack(alignment: .firstTextBaseline) {
                    SectionLabel(text: "Stringing", color: p.muted)
                    Spacer(minLength: 4)
                    Text(stageLine(job)).font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(job.stage == "ready_for_you" ? p.green : p.secondary).lineLimit(1)
                }
                Text("\(job.racketLabel) · \(job.stringLabel) · \(job.tensionMains) lb").font(.system(size: 13)).foregroundStyle(p.primary).lineLimit(1)
                HStack(spacing: 4) {
                    ForEach(0..<4, id: \.self) { i in
                        Capsule().fill(i <= min(job.stageIndex, 3) ? p.green : p.track).frame(height: 4).widgetAccentable()
                    }
                }
            } else {
                HStack(alignment: .firstTextBaseline) {
                    SectionLabel(text: "Your strings", color: p.muted)
                    Spacer(minLength: 4)
                    Text(stringing.due ? "Time to restring" : "Fresh").font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(stringing.due ? p.amber : p.secondary)
                }
                Text(sinceLine).font(.system(size: 12)).foregroundStyle(p.secondary).lineLimit(2)
                FillBar(fraction: wear, p: p, color: stringing.due ? p.amber : p.green)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func stageLine(_ job: WidgetSnapshot.Stringing.Job) -> String {
        switch job.stage {
        case "awaiting_dropoff": return "Drop it off"
        case "with_stringer": return "With the stringer"
        case "being_strung": return "Being strung"
        case "ready_for_you": return job.readyBy.map { "Ready · \(WidgetDates.monthDay($0 + "T12:00:00Z"))" } ?? "Ready"
        default: return ""
        }
    }

    private var sinceLine: String {
        guard let at = stringing.lastStrungAt, let weeks = stringing.weeksSince else { return "" }
        let since = "Strung \(WidgetDates.monthDay(at)) · \(weeks) week\(weeks == 1 ? "" : "s") ago"
        return stringing.due ? since + "\nConsider a restring for a better feel." : since
    }

    private var wear: Double {
        guard let weeks = stringing.weeksSince, stringing.afterWeeks > 0 else { return 0 }
        return min(1, Double(weeks) / Double(stringing.afterWeeks))
    }
}

struct Sparkline: View {
    let values: [Double]
    let color: Color
    let track: Color

    var body: some View {
        GeometryReader { geo in
            let pts = points(in: geo.size)
            ZStack {
                Path { path in
                    path.move(to: CGPoint(x: 0, y: geo.size.height - 0.5))
                    path.addLine(to: CGPoint(x: geo.size.width, y: geo.size.height - 0.5))
                }
                .stroke(track, lineWidth: 1)
                if pts.count > 1 {
                    Path { path in
                        path.move(to: pts[0])
                        for pt in pts.dropFirst() { path.addLine(to: pt) }
                    }
                    .stroke(color, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                    .widgetAccentable()
                }
                if let last = pts.last {
                    Circle().fill(color).frame(width: 8, height: 8).position(last).widgetAccentable()
                }
            }
        }
    }

    /// One to five, so the line's slope means the same thing week to week.
    private func points(in size: CGSize) -> [CGPoint] {
        guard !values.isEmpty else { return [] }
        let inset: CGFloat = 6
        let step = values.count > 1 ? (size.width - inset * 2) / CGFloat(values.count - 1) : 0
        return values.enumerated().map { i, v in
            let y = (1 - CGFloat((min(max(v, 1), 5) - 1) / 4)) * (size.height - inset * 2) + inset
            return CGPoint(x: inset + step * CGFloat(i), y: y)
        }
    }
}

/// A widget with one thing to say says it in the middle (Grant, on the canvas).
struct CenteredMessage: View {
    let text: String
    let p: WidgetPalette
    var bold = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Header(p: p)
            Spacer(minLength: 0)
            Text(text)
                .font(.system(size: bold ? 15 : 14, weight: bold ? .bold : .regular))
                .foregroundStyle(p.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, alignment: .center)
            Spacer(minLength: 0)
        }
    }
}

struct SignedOutView: View {
    let p: WidgetPalette

    var body: some View {
        CenteredMessage(text: "Open BPM and sign in to see your week here.", p: p)
    }
}

/// The read failed and there is nothing cached to show. Not "sign in": the
/// pass may be fine and the network not.
struct UnavailableView: View {
    let p: WidgetPalette

    var body: some View {
        CenteredMessage(text: "Couldn't load your week. Tap to open BPM.", p: p)
    }
}

// MARK: - The week widget: small, medium, large

struct BPMWeekView: View {
    let entry: BPMEntry
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let p = WidgetPalette.make(scheme)
        Group {
            if entry.state == .signedOut {
                SignedOutView(p: p).widgetURL(WidgetLink.home)
            } else if entry.snapshot == nil {
                // A read failed and nothing is cached: say so, never "sign in".
                UnavailableView(p: p).widgetURL(WidgetLink.home)
            } else if let snap = entry.snapshot {
                switch family {
                case .systemSmall: small(snap, p)
                case .systemLarge: large(snap, p)
                default: medium(snap, p)
                }
            }
        }
        .containerBackground(for: .widget) { p.background }
    }

    private func updated(_ snap: WidgetSnapshot) -> String? {
        guard entry.stale, let at = WidgetDates.parse(snap.generatedAt) else { return nil }
        return Date().timeIntervalSince(at) > 15 * 60 ? "Updated \(WidgetDates.clock(at))" : nil
    }

    /// One tap target on iPhone, so one thing: are you in this week.
    private func small(_ snap: WidgetSnapshot, _ p: WidgetPalette) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Header(p: p)
            Spacer(minLength: 0)
            if let s = snap.session {
                SectionLabel(text: smallLabel(WeekStatus(s)), color: smallLabelColor(WeekStatus(s), p))
                Text(WidgetDates.day(s.datetime)).font(.system(size: 20, weight: .bold)).foregroundStyle(p.primary)
                    .minimumScaleFactor(0.8).lineLimit(1)
                Text("\(WidgetDates.time(s.datetime)) · \(s.inCount) signed up").font(.system(size: 12)).foregroundStyle(p.secondary)
                FillBar(fraction: s.max > 0 ? Double(s.inCount) / Double(s.max) : 0, p: p)
            } else {
                Text("No session this week").font(.system(size: 15, weight: .bold)).foregroundStyle(p.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer(minLength: 0)
            }
        }
        .widgetURL(WidgetLink.home)
    }

    private func smallLabel(_ status: WeekStatus) -> String {
        switch status {
        case .inSession: return "Signed up"
        case .waitlist(let pos): return pos.map { "Waitlist · \(ordinal($0))" } ?? "Waitlist"
        case .join: return "Sign-ups open"
        case .joinWaitlist: return "Full · waitlist open"
        case .notOpen: return "Not open yet"
        case .closed: return "Sign-ups closed"
        case .settled: return "Played"
        case .noSession: return ""
        }
    }

    private func smallLabelColor(_ status: WeekStatus, _ p: WidgetPalette) -> Color {
        switch status {
        case .inSession, .join: return p.green
        case .waitlist, .joinWaitlist: return p.amber
        default: return p.muted
        }
    }

    /// The week and the balance: two tap targets.
    private func medium(_ snap: WidgetSnapshot, _ p: WidgetPalette) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Header(p: p, trailing: updated(snap) ?? snap.session.map { "\(WidgetDates.day($0.datetime)) · \(WidgetDates.time($0.datetime))" })
            HStack(alignment: .center, spacing: 14) {
                Link(destination: WidgetLink.home) {
                    WeekBlock(entry: entry, p: p).frame(maxWidth: .infinity, alignment: .leading)
                }
                Link(destination: WidgetLink.home) {
                    BalanceBlock(owed: snap.owed, p: p).frame(width: 90, alignment: .trailing)
                }
            }
        }
    }

    /// The week with the money, then your level (Grant: level on the large size only).
    private func large(_ snap: WidgetSnapshot, _ p: WidgetPalette) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Header(p: p, trailing: updated(snap))
            // The money sits with the sign-up, as on the medium size (Grant, on
            // the canvas: "this should be part of the sign up section").
            HStack(alignment: .center, spacing: 14) {
                Link(destination: WidgetLink.home) {
                    VStack(alignment: .leading, spacing: 8) {
                        if let s = snap.session {
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text(WidgetDates.day(s.datetime)).font(.system(size: 20, weight: .bold)).foregroundStyle(p.primary)
                                Text(timeRange(s)).font(.system(size: 13)).foregroundStyle(p.secondary)
                            }
                        }
                        WeekBlock(entry: entry, p: p, big: false)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                Link(destination: WidgetLink.home) {
                    BalanceBlock(owed: snap.owed, p: p).frame(width: 90, alignment: .trailing)
                }
            }
            // The three sections share the height, a rule centred in each gap:
            // one spacer at the end left the bottom third empty (Grant's first
            // light-mode screenshot, 2026-10-24).
            Spacer(minLength: 0)
            Rectangle().fill(p.rule).frame(height: 1)
            Spacer(minLength: 0)
            Link(destination: WidgetLink.stats) {
                if let level = snap.level {
                    LevelBlock(level: level, p: p)
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        SectionLabel(text: "Your level", color: p.muted)
                        Text("Check in on Stats to see your level here.").font(.system(size: 13)).foregroundStyle(p.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            // Your racket (Grant, 2026-10-23): the job on the bench step by
            // step, or the strings wearing in by TIME since the restring. No
            // finished job, no section — the large widget closes the gap.
            if let stringing = snap.stringing {
                Spacer(minLength: 0)
                Rectangle().fill(p.rule).frame(height: 1)
                Spacer(minLength: 0)
                Link(destination: WidgetLink.stringing) {
                    StringingBlock(stringing: stringing, p: p)
                }
            } else {
                Spacer(minLength: 0)
            }
        }
    }

    private func timeRange(_ s: WidgetSnapshot.Session) -> String {
        guard let end = s.endDatetime else { return WidgetDates.time(s.datetime) }
        return "\(WidgetDates.time(s.datetime).replacingOccurrences(of: " PM", with: "").replacingOccurrences(of: " AM", with: ""))–\(WidgetDates.time(end))"
    }
}

struct BPMWeekWidget: Widget {
    let kind = "BPMWeek"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BPMProvider()) { entry in
            BPMWeekView(entry: entry)
        }
        .configurationDisplayName("This week")
        .description("Whether you're in on Thursday, how full it is, and what you owe.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

// MARK: - Lock screen: the session line, and the amount only after Face ID

struct BPMLockView: View {
    let entry: BPMEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            switch family {
            case .accessoryCircular: circular
            default: rectangular
            }
        }
        .containerBackground(for: .widget) { Color.clear }
        .widgetURL(WidgetLink.home)
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let s = entry.snapshot?.session {
                Label(WidgetDates.shortDayTime(s.datetime), systemImage: "figure.badminton")
                    .font(.system(size: 12, weight: .bold))
                Text(lockStatus(s)).font(.system(size: 14, weight: .semibold))
            } else if entry.state == .signedOut {
                Text("BPM").font(.system(size: 12, weight: .bold))
                Text("Open BPM to sign in").font(.system(size: 13))
            } else if entry.snapshot == nil {
                Text("BPM").font(.system(size: 12, weight: .bold))
                Text("Couldn't load").font(.system(size: 13))
            } else {
                Text("BPM").font(.system(size: 12, weight: .bold))
                Text("No session this week").font(.system(size: 13))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var circular: some View {
        VStack(spacing: 1) {
            if let owed = entry.snapshot?.owed {
                Text(owed.total > 0 ? "OWED" : "PAID").font(.system(size: 9, weight: .bold))
                if owed.total > 0 {
                    // Marked private: iPhone hides it on a locked phone.
                    Text(money(owed.total.rounded(.down)))
                        .font(.system(size: 14, weight: .bold, design: .monospaced))
                        .minimumScaleFactor(0.6)
                        .privacySensitive()
                } else {
                    Image(systemName: "checkmark").font(.system(size: 14, weight: .bold))
                }
            } else {
                Image(systemName: "figure.badminton").font(.system(size: 18))
            }
        }
    }

    private func lockStatus(_ s: WidgetSnapshot.Session) -> String {
        switch WeekStatus(s) {
        case .inSession: return "Signed up · \(s.inCount)/\(s.max)"
        case .waitlist(let pos): return pos.map { "Waitlist · \(ordinal($0))" } ?? "On the waitlist"
        case .join: return "Open · \(s.inCount)/\(s.max)"
        case .joinWaitlist: return "Full · \(s.waitingCount) waiting"
        case .notOpen: return "Not open yet"
        case .closed: return "Sign-ups closed"
        case .settled: return "Played"
        case .noSession: return ""
        }
    }
}

struct BPMLockWidget: Widget {
    let kind = "BPMLock"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BPMProvider()) { entry in
            BPMLockView(entry: entry)
        }
        .configurationDisplayName("This week")
        .description("Your spot on Thursday. What you owe shows once your phone is unlocked.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular])
    }
}

// MARK: - Preview data (the widget gallery)

extension WidgetSnapshot {
    static let preview = WidgetSnapshot(
        v: 1,
        name: "Lin",
        generatedAt: ISO8601DateFormatter().string(from: Date()),
        session: Session(id: "preview", datetime: ISO8601DateFormatter().string(from: Date().addingTimeInterval(2 * 86400)),
                         endDatetime: nil, signupOpen: true, deadline: nil, closed: false, settled: false,
                         max: 12, inCount: 9, waitingCount: 0, me: "in", waitlistPosition: nil),
        owed: Owed(total: 18.5, lines: 1, since: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-7 * 86400))),
        level: Level(overall: 3.1, phase: "switch", phaseLabel: "Intermediate", prevOverall: 2.7,
                     prevAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-28 * 86400)),
                     delta: 0.4, history: [2.3, 2.7, 3.1], workOn: "Net play"),
        stringing: Stringing(job: Stringing.Job(id: "j1", jobNo: "J-0042", racketLabel: "Astrox 88D Pro", stringLabel: "BG 80",
                                                tensionMains: 26, tensionCrosses: 28, stage: "being_strung", stageIndex: 2, readyBy: nil),
                             lastStrungAt: nil, weeksSince: nil, due: false, afterWeeks: 8))
}
