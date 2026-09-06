package app.sharknote.mobile

import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Theme-aware colors. The desktop app ships dark + light themes and five accent
 * choices; the mobile palette mirrors them so settings changes apply live.
 */
data class SharkPalette(
    val ink: Color,
    val surface2: Color,
    val surface3: Color,
    val stroke: Color,
    val text1: Color,
    val text2: Color,
    val accent: Color,
    val isLight: Boolean,
)

val DarkPalette = SharkPalette(
    ink = Color(0xFF0B0B0F), surface2 = Color(0xFF141419), surface3 = Color(0xFF1D1D24),
    stroke = Color(0xFF27272E), text1 = Color(0xFFF2F2F5), text2 = Color(0xFF9B9BA5),
    accent = Color(0xFF8B5CF6), isLight = false,
)

val LightPalette = SharkPalette(
    ink = Color(0xFFFFFFFF), surface2 = Color(0xFFF4F4F6), surface3 = Color(0xFFEAEAEF),
    stroke = Color(0xFFDDDDDD), text1 = Color(0xFF18181B), text2 = Color(0xFF71717A),
    accent = Color(0xFF8B5CF6), isLight = true,
)

/** Accent names + hues shared with the desktop app (lib/settings.ts). */
val ACCENTS: List<Pair<String, Color>> = listOf(
    "violet" to Color(0xFF8B5CF6),
    "sky" to Color(0xFF0EA5E9),
    "emerald" to Color(0xFF10B981),
    "amber" to Color(0xFFF59E0B),
    "rose" to Color(0xFFF43F5E),
)

/** Graph themes shared with the desktop app (lib/graphThemes.ts). */
val GRAPH_THEMES: List<Pair<String, Float>> = listOf(
    "crimson" to 25f,
    "violet" to 292f,
    "ocean" to 210f,
    "forest" to 150f,
    "amber" to 55f,
)

fun paletteFor(s: SharkSettings): SharkPalette {
    val base = if (s.theme == "light") LightPalette else DarkPalette
    val accent = ACCENTS.firstOrNull { it.first == s.accent }?.second ?: base.accent
    return base.copy(accent = accent)
}

val LocalShark = compositionLocalOf { DarkPalette }
