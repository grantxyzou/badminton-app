import Foundation
import Capacitor
import EventKit
import EventKitUI

/// "Add to calendar" (docs/plans/add-to-calendar.md): opens the system's own
/// New Event screen, filled in, and the person taps Add. Nothing is written
/// to a calendar without them seeing it.
///
/// iOS 17+ runs that editor out of process and needs no calendar access. The
/// app's floor is iOS 15, and before 17 the editor needs access first — so
/// there, and only there, the system asks once (`NSCalendarsUsageDescription`).
/// The web app's half is lib/addToCalendar.ts; Android's twin is
/// BpmCalendarPlugin.java.
@objc(BpmCalendarPlugin)
public class BpmCalendarPlugin: CAPPlugin, CAPBridgedPlugin, EKEventEditViewDelegate {
    public let identifier = "BpmCalendarPlugin"
    public let jsName = "BpmCalendar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "addEvent", returnType: CAPPluginReturnPromise),
    ]

    private let store = EKEventStore()
    /// The call the open editor answers when it closes.
    private var pending: CAPPluginCall?

    @objc func addEvent(_ call: CAPPluginCall) {
        guard let title = call.getString("title"),
              let startMs = call.getDouble("startMs"),
              let endMs = call.getDouble("endMs"), endMs > startMs else {
            call.reject("title, startMs and endMs are required")
            return
        }
        let present = { [weak self] in
            guard let self = self else { return }
            let event = EKEvent(eventStore: self.store)
            event.title = title
            event.startDate = Date(timeIntervalSince1970: startMs / 1000)
            event.endDate = Date(timeIntervalSince1970: endMs / 1000)
            event.location = call.getString("location")
            if let url = call.getString("url") { event.url = URL(string: url) }
            event.calendar = self.store.defaultCalendarForNewEvents
            DispatchQueue.main.async {
                guard let host = self.bridge?.viewController else {
                    call.reject("no view controller")
                    return
                }
                let editor = EKEventEditViewController()
                editor.eventStore = self.store
                editor.event = event
                editor.editViewDelegate = self
                self.pending = call
                host.present(editor, animated: true)
            }
        }
        if #available(iOS 17.0, *) {
            present()
        } else {
            store.requestAccess(to: .event) { granted, _ in
                if granted { present() } else { call.resolve(["outcome": "denied"]) }
            }
        }
    }

    public func eventEditViewController(_ controller: EKEventEditViewController,
                                        didCompleteWith action: EKEventEditViewAction) {
        controller.dismiss(animated: true)
        let outcome = action == .saved ? "saved" : "canceled"
        pending?.resolve(["outcome": outcome])
        pending = nil
    }
}
