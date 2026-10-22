import AppIntents
import WidgetKit

/// "Join" on the widget (docs/plans/native-widgets.md). Runs without opening
/// the app; the server re-enters Home's own sign-up route, so it meets the
/// same rules. WidgetKit redraws the widget when `perform` returns, from the
/// snapshot the server answered with — never from a guess.
struct JoinSessionIntent: AppIntent {
    static let title: LocalizedStringResource = "Join this week's session"
    static let isDiscoverable: Bool = false

    @Parameter(title: "Join the waitlist")
    var waitlist: Bool

    init() {
        self.waitlist = false
    }

    init(waitlist: Bool) {
        self.waitlist = waitlist
    }

    func perform() async throws -> some IntentResult {
        do {
            try await BPMWidgetAPI.join(waitlist: waitlist)
            BPMWidgetStore.clearFailure()
            BPMWidgetStore.offerUndo()
        } catch WidgetAPIError.signedOut {
            BPMWidgetStore.forgetSnapshot()
        } catch {
            BPMWidgetStore.noteFailure(.join)
            BPMWidgetStore.withdrawUndo()
        }
        return .result()
    }
}

/// "Undo" — offered for a few minutes after a Join from the widget, because a
/// widget is easy to brush with a thumb. It is the ordinary cancel.
struct UndoJoinIntent: AppIntent {
    static let title: LocalizedStringResource = "Give my spot back"
    static let isDiscoverable: Bool = false

    init() {}

    func perform() async throws -> some IntentResult {
        do {
            try await BPMWidgetAPI.undo()
            BPMWidgetStore.clearFailure()
        } catch WidgetAPIError.signedOut {
            BPMWidgetStore.forgetSnapshot()
        } catch {
            // A late-cancel window, or no network: the app explains, the widget
            // only says it could not.
            BPMWidgetStore.noteFailure(.undo)
        }
        BPMWidgetStore.withdrawUndo()
        return .result()
    }
}
