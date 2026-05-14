package app.klikapa.mobile.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

public class KlikApaWidgetProvider extends AppWidgetProvider {

  private static final String PREFS_NAME = "klikapa_widget_prefs";

  @Override
  public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    String siteName = prefs.getString("siteName", "KlikApa");
    int visitors = prefs.getInt("visitors", 0);
    int pageviews = prefs.getInt("pageviews", 0);
    int trend = prefs.getInt("trend", 0);

    for (int widgetId : appWidgetIds) {
      RemoteViews views = new RemoteViews(context.getPackageName(),
        appWidgetManager.getAppWidgetInfo(widgetId) != null
          && appWidgetManager.getAppWidgetInfo(widgetId).minWidth > 200
            ? R.layout.widget_medium : R.layout.widget_small);

      views.setTextViewText(R.id.widgetVisitors, String.format("%,d", visitors));
      views.setTextViewText(R.id.widgetLabel, "visitors");

      if (pageviews > 0) {
        views.setTextViewText(R.id.widgetPageviews, String.format("%,d", pageviews));
      }

      // Tap opens the app
      Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
      if (intent != null) {
        PendingIntent pi = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.widgetRoot, pi);
      }

      appWidgetManager.updateAppWidget(widgetId, views);
    }
  }
}
