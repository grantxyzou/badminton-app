import Foundation

/// What the widget knows and how it asks for more (docs/plans/native-widgets.md).
///
/// The app hands the widget a pass through `BpmWidgetPlugin.swift`, which
/// writes the SAME keys into the same App Group. Change a key in both places
/// or the widget reads nothing.
enum BPMWidgetStore {
    static let appGroup = "group.com.motioncraft.bpm"
    static let tokenKey = "widget.token"
    static let expiresKey = "widget.expiresAt"
    static let baseUrlKey = "widget.baseUrl"
    static let snapshotKey = "widget.snapshot"
    static let undoUntilKey = "widget.undoUntil"
    static let failureKey = "widget.failure"
    static let failureAtKey = "widget.failureAt"

    static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static var token: String? {
        guard let t = defaults?.string(forKey: tokenKey), !t.isEmpty else { return nil }
        return t
    }

    static var baseUrl: URL? {
        guard let s = defaults?.string(forKey: baseUrlKey) else { return nil }
        return URL(string: s)
    }

    // MARK: The last snapshot, shown under its "Updated" time when a read fails

    static func cachedSnapshot() -> WidgetSnapshot? {
        guard let data = defaults?.data(forKey: snapshotKey) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    static func save(_ snapshot: WidgetSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults?.set(data, forKey: snapshotKey)
    }

    static func forgetSnapshot() {
        defaults?.removeObject(forKey: snapshotKey)
    }

    // MARK: Undo, for a few minutes after a Join from the widget

    static func offerUndo(for seconds: TimeInterval = 5 * 60) {
        defaults?.set(Date().addingTimeInterval(seconds).timeIntervalSince1970, forKey: undoUntilKey)
    }

    static func withdrawUndo() {
        defaults?.removeObject(forKey: undoUntilKey)
    }

    static var undoOffered: Bool {
        guard let until = defaults?.double(forKey: undoUntilKey), until > 0 else { return false }
        return Date().timeIntervalSince1970 < until
    }

    // MARK: The last thing a tap could not do — never a silent fail

    static func noteFailure(_ failure: WidgetFailure) {
        defaults?.set(failure.rawValue, forKey: failureKey)
        defaults?.set(Date().timeIntervalSince1970, forKey: failureAtKey)
    }

    static func clearFailure() {
        defaults?.removeObject(forKey: failureKey)
        defaults?.removeObject(forKey: failureAtKey)
    }

    /// A failure is shown for ten minutes, then the widget goes back to the week.
    static var recentFailure: WidgetFailure? {
        guard let raw = defaults?.string(forKey: failureKey),
              let at = defaults?.double(forKey: failureAtKey),
              Date().timeIntervalSince1970 - at < 10 * 60
        else { return nil }
        return WidgetFailure(rawValue: raw)
    }
}

enum WidgetFailure: String {
    case join
    case undo
}

/// `GET /api/widget` — `lib/widget.ts` `WidgetSnapshot`, field for field.
struct WidgetSnapshot: Codable {
    struct Session: Codable {
        let id: String
        let datetime: String
        let endDatetime: String?
        let signupOpen: Bool
        let deadline: String?
        let closed: Bool
        let settled: Bool
        let max: Int
        let inCount: Int
        let waitingCount: Int
        /// "in", "waitlist" or "out".
        let me: String
        let waitlistPosition: Int?
    }

    struct Owed: Codable {
        let total: Double
        let lines: Int
        let since: String?
    }

    struct Level: Codable {
        let overall: Double
        let phase: String?
        let phaseLabel: String?
        let prevOverall: Double?
        let prevAt: String?
        let delta: Double?
        let history: [Double]
        let workOn: String?
    }

    /// `lib/widget.ts` `WidgetStringing`: the player's stage, never the
    /// bench status, and no price.
    struct Stringing: Codable {
        struct Job: Codable {
            let id: String
            let jobNo: String
            let racketLabel: String
            let stringLabel: String
            let tensionMains: Int
            let tensionCrosses: Int
            let stage: String
            let stageIndex: Int
            let readyBy: String?
        }

        let job: Job?
        let lastStrungAt: String?
        let weeksSince: Int?
        let due: Bool
        let afterWeeks: Int
    }

    let v: Int
    let name: String
    let generatedAt: String
    let session: Session?
    let owed: Owed
    let level: Level?
    /// Absent on a server that predates it: the section simply does not draw.
    let stringing: Stringing?
}

enum WidgetAPIError: Error {
    /// No pass, an expired one, or a member no longer on the roster.
    case signedOut
    /// The server said no (sign-ups closed, full, a late-cancel window…).
    case refused(status: Int, error: String?)
    case network
}

/// The three calls the widget makes, each with its own pass.
enum BPMWidgetAPI {
    private struct ActionResponse: Decodable {
        let ok: Bool?
        let snapshot: WidgetSnapshot?
        let error: String?
    }

    private struct ErrorBody: Decodable {
        let error: String?
    }

    private static func request(_ path: String, method: String, body: [String: Any]? = nil) throws -> URLRequest {
        guard let token = BPMWidgetStore.token, let base = BPMWidgetStore.baseUrl else {
            throw WidgetAPIError.signedOut
        }
        var req = URLRequest(url: base.appendingPathComponent(path), timeoutInterval: 15)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let body = body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return req
    }

    private static func send(_ req: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw WidgetAPIError.network
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw WidgetAPIError.signedOut }
        guard (200..<300).contains(status) else {
            let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
            throw WidgetAPIError.refused(status: status, error: body?.error)
        }
        return data
    }

    static func fetchSnapshot() async throws -> WidgetSnapshot {
        let data = try await send(try request("api/widget", method: "GET"))
        let snapshot = try JSONDecoder().decode(WidgetSnapshot.self, from: data)
        BPMWidgetStore.save(snapshot)
        return snapshot
    }

    static func join(waitlist: Bool) async throws {
        let data = try await send(try request("api/widget/join", method: "POST", body: ["waitlist": waitlist]))
        if let snapshot = try? JSONDecoder().decode(ActionResponse.self, from: data).snapshot {
            BPMWidgetStore.save(snapshot)
        }
    }

    static func undo() async throws {
        let data = try await send(try request("api/widget/join", method: "DELETE", body: [:]))
        if let snapshot = try? JSONDecoder().decode(ActionResponse.self, from: data).snapshot {
            BPMWidgetStore.save(snapshot)
        }
    }
}
