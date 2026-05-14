package app.klikapa.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "KlikapaWidgetBridge")
public class KlikapaWidgetBridgePlugin extends Plugin {

  private static final String PREFS_NAME = "klikapa_widget_prefs";

  private SharedPreferences getPrefs() {
    return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
  }

  @PluginMethod
  public void saveWidgetData(PluginCall call) {
    try {
      SharedPreferences prefs = getPrefs();
      SharedPreferences.Editor editor = prefs.edit();
      editor.putString("siteName", call.getString("siteName", ""));
      editor.putInt("visitors", call.getInt("visitors", 0));
      editor.putInt("pageviews", call.getInt("pageviews", 0));
      editor.putInt("trend", call.getInt("trend", 0));

      JSONArray arr = call.getArray("sparkline");
      if (arr != null) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < arr.length(); i++) {
          if (i > 0) sb.append(",");
          sb.append(arr.optInt(i));
        }
        editor.putString("sparkline", sb.toString());
      }
      editor.putString("updatedAt", call.getString("updatedAt", ""));
      editor.apply();
      call.resolve();
    } catch (Exception e) {
      call.reject(e.getMessage());
    }
  }

  @PluginMethod
  public void clearWidgetData(PluginCall call) {
    getPrefs().edit().clear().apply();
    call.resolve();
  }
}
