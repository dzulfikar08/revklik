import WidgetKit
import SwiftUI

struct WidgetEntry: TimelineEntry {
  let date: Date
  let siteName: String
  let visitors: Int
  let pageviews: Int
  let trend: Int
  let sparkline: [Int]
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> WidgetEntry {
    WidgetEntry(date: Date(), siteName: "KlikApa", visitors: 1234, pageviews: 5678, trend: 12, sparkline: [10, 20, 15, 30, 25, 40, 35])
  }

  func getSnapshot(in context: Context, completion: @escaping (WidgetEntry) -> Void) {
    let entry = readEntry()
    completion(entry)
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<WidgetEntry>) -> Void) {
    let entry = readEntry()
    let nextUpdate = Calendar.current.date(byAdding: .hour, value: 1, to: Date())!
    completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
  }

  private func readEntry() -> WidgetEntry {
    let defaults = UserDefaults(suiteName: "group.app.klikapa.mobile")
    let visitors = defaults?.integer(forKey: "visitors") ?? 0
    let siteName = defaults?.string(forKey: "siteName") ?? "KlikApa"
    if visitors == 0 {
      return WidgetEntry(date: Date(), siteName: siteName, visitors: 0, pageviews: 0, trend: 0, sparkline: [])
    }
    return WidgetEntry(
      date: Date(),
      siteName: siteName,
      visitors: visitors,
      pageviews: defaults?.integer(forKey: "pageviews") ?? 0,
      trend: defaults?.integer(forKey: "trend") ?? 0,
      sparkline: defaults?.array(forKey: "sparkline") as? [Int] ?? []
    )
  }
}

struct KlikApaWidgetEntryView: View {
  var entry: WidgetEntry
  @Environment(\.widgetFamily) var family

  var body: some View {
    ZStack {
      Color(red: 0.039, green: 0.039, blue: 0.039)
      if family == .systemSmall {
        smallView
      } else {
        mediumView
      }
    }
  }

  var smallView: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text("k")
          .font(.system(size: 14, weight: .bold))
          .foregroundColor(Color(red: 0.83, green: 0.53, blue: 0.16))
        Spacer()
      }
      Spacer()
      Text(entry.visitors.formatted())
        .font(.system(size: 28, weight: .bold))
        .foregroundColor(.white)
      Text("visitors")
        .font(.system(size: 11))
        .foregroundColor(.gray)
    }
    .padding()
  }

  var mediumView: some View {
    HStack {
      VStack(alignment: .leading, spacing: 4) {
        HStack {
          Text("k")
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(Color(red: 0.83, green: 0.53, blue: 0.16))
          Text(entry.siteName)
            .font(.system(size: 11))
            .foregroundColor(.gray)
          Spacer()
        }
        Spacer()
        HStack(spacing: 20) {
          VStack(alignment: .leading) {
            Text(entry.visitors.formatted())
              .font(.system(size: 24, weight: .bold))
              .foregroundColor(.white)
            Text("visitors")
              .font(.system(size: 10))
              .foregroundColor(.gray)
          }
          VStack(alignment: .leading) {
            Text(entry.pageviews.formatted())
              .font(.system(size: 24, weight: .bold))
              .foregroundColor(.white)
            Text("pageviews")
              .font(.system(size: 10))
              .foregroundColor(.gray)
          }
          if entry.trend != 0 {
            VStack(alignment: .leading) {
              Text("\(entry.trend > 0 ? "+" : "")\(entry.trend)%")
                .font(.system(size: 24, weight: .bold))
                .foregroundColor(entry.trend > 0 ? .green : .red)
              Text("trend")
                .font(.system(size: 10))
                .foregroundColor(.gray)
            }
          }
        }
      }
      .padding()
    }
  }
}

struct KlikApaWidget: Widget {
  let kind = "KlikApaWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in
      KlikApaWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("KlikApa Stats")
    .description("Quick view of your analytics stats.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
