package app.sharknote.mobile

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * App settings, mirroring the desktop Settings model (lib/settings.ts).
 * Vault path and .md extension are desktop-only concepts, so they are not
 * carried over; everything else maps 1:1.
 */
data class SharkSettings(
    val theme: String = "dark",            // dark | light
    val accent: String = "violet",         // violet | sky | emerald | amber | rose
    val graphTheme: String = "crimson",    // crimson | violet | ocean | forest | amber
    val editorFontSize: Float = 16f,       // sp
    val autosaveDelay: Int = 800,          // ms
    val confirmDelete: Boolean = true,
    val defaultView: String = "edit",      // edit | preview
)

class SettingsStore(context: Context) {
    private val file = File(context.filesDir, "settings.json")

    fun load(): SharkSettings {
        if (!file.exists()) return SharkSettings()
        return runCatching {
            val o = JSONObject(file.readText())
            SharkSettings(
                theme = o.optString("theme", "dark"),
                accent = o.optString("accent", "violet"),
                graphTheme = o.optString("graphTheme", "crimson"),
                editorFontSize = o.optDouble("editorFontSize", 16.0).toFloat(),
                autosaveDelay = o.optInt("autosaveDelay", 800),
                confirmDelete = o.optBoolean("confirmDelete", true),
                defaultView = o.optString("defaultView", "edit"),
            )
        }.getOrElse { SharkSettings() }
    }

    fun save(s: SharkSettings) {
        runCatching {
            file.writeText(
                JSONObject().apply {
                    put("theme", s.theme); put("accent", s.accent)
                    put("graphTheme", s.graphTheme); put("editorFontSize", s.editorFontSize.toDouble())
                    put("autosaveDelay", s.autosaveDelay); put("confirmDelete", s.confirmDelete)
                    put("defaultView", s.defaultView)
                }.toString()
            )
        }
    }
}
