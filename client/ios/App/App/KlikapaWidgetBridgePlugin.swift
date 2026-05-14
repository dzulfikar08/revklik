import Capacitor
import Foundation

@objc(KlikapaWidgetBridgePlugin)
public class KlikapaWidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "KlikapaWidgetBridgePlugin"
  public let jsName = "KlikapaWidgetBridge"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "saveWidgetData", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "clearWidgetData", returnType: CAPPluginReturnPromise),
  ]

  let suiteName = "group.app.klikapa.mobile"

  @objc func saveWidgetData(_ call: CAPPluginCall) {
    guard let data = call.options as? [String: Any],
          let defaults = UserDefaults(suiteName: suiteName) else {
      call.reject("Invalid data or suite")
      return
    }
    defaults.set(data["siteName"], forKey: "siteName")
    defaults.set(data["visitors"], forKey: "visitors")
    defaults.set(data["pageviews"], forKey: "pageviews")
    defaults.set(data["trend"], forKey: "trend")
    if let sparkline = data["sparkline"] as? [Int] {
      defaults.set(sparkline, forKey: "sparkline")
    }
    defaults.set(data["updatedAt"], forKey: "updatedAt")
    call.resolve()
  }

  @objc func clearWidgetData(_ call: CAPPluginCall) {
    if let defaults = UserDefaults(suiteName: suiteName) {
      defaults.removeObject(forKey: "siteName")
      defaults.removeObject(forKey: "visitors")
      defaults.removeObject(forKey: "pageviews")
      defaults.removeObject(forKey: "trend")
      defaults.removeObject(forKey: "sparkline")
      defaults.removeObject(forKey: "updatedAt")
    }
    call.resolve()
  }
}
