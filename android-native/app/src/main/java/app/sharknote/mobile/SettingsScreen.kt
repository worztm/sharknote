package app.sharknote.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Settings screen mirroring the desktop SettingsDialog (minus vault path). */
@Composable
fun SettingsScreen(settings: SharkSettings, onChange: (SharkSettings) -> Unit) {
    val sh = LocalShark.current
    Column(
        Modifier.fillMaxSize().background(sh.ink).statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
    ) {
        Spacer(Modifier.height(14.dp))
        Text("Settings", color = sh.text1, fontSize = 26.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text("your notes, offline", color = sh.text2, fontSize = 13.sp)
        Spacer(Modifier.height(22.dp))

        Section("Appearance") {
            ChoiceRow(
                label = "Theme", hint = "Dark or light interface",
                options = listOf("dark" to "Dark", "light" to "Light"),
                selected = settings.theme,
                onPick = { onChange(settings.copy(theme = it)) },
            )
            Row(Modifier.fillMaxWidth().padding(vertical = 10.dp)) {
                Column(Modifier.weight(1f)) {
                    Text("Accent", color = sh.text1, fontSize = 15.sp)
                    Text(settings.accent.replaceFirstChar { it.uppercase() }, color = sh.text2, fontSize = 12.sp)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    ACCENTS.forEach { (name, color) ->
                        Box(
                            Modifier.size(28.dp).clip(CircleShape).background(color)
                                .clickable { onChange(settings.copy(accent = name)) },
                            contentAlignment = Alignment.Center,
                        ) {
                            if (settings.accent == name)
                                Icon(Icons.Filled.Check, null, tint = Color.White, modifier = Modifier.size(15.dp))
                        }
                    }
                }
            }
        }

        Section("Graph") {
            ChoiceRow(
                label = "Graph theme", hint = "Edge and node colors",
                options = GRAPH_THEMES.map { it.first to it.first.replaceFirstChar { c -> c.uppercase() } },
                selected = settings.graphTheme,
                onPick = { onChange(settings.copy(graphTheme = it)) },
            )
        }

        Section("Editor") {
            Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                Row(Modifier.fillMaxWidth()) {
                    Text("Font size", color = sh.text1, fontSize = 15.sp, modifier = Modifier.weight(1f))
                    Text("${settings.editorFontSize.toInt()} sp", color = sh.text2, fontSize = 13.sp)
                }
                Slider(
                    value = settings.editorFontSize, onValueChange = { onChange(settings.copy(editorFontSize = it)) },
                    valueRange = 12f..22f, steps = 19,
                    colors = SliderDefaults.colors(thumbColor = sh.accent, activeTrackColor = sh.accent),
                )
            }
            ChoiceRow(
                label = "Open notes in", hint = "How notes start when you open them",
                options = listOf("edit" to "Edit", "preview" to "Preview"),
                selected = settings.defaultView,
                onPick = { onChange(settings.copy(defaultView = it)) },
            )
            ChoiceRow(
                label = "Autosave", hint = "Delay before saving while you type",
                options = listOf("400" to "Fast", "800" to "Normal", "1500" to "Relaxed"),
                selected = settings.autosaveDelay.toString(),
                onPick = { onChange(settings.copy(autosaveDelay = it.toInt())) },
            )
        }

        Section("Safety") {
            Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Confirm before delete", color = sh.text1, fontSize = 15.sp)
                    Text("Ask once before a note is removed", color = sh.text2, fontSize = 12.sp)
                }
                Switch(
                    checked = settings.confirmDelete,
                    onCheckedChange = { onChange(settings.copy(confirmDelete = it)) },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = Color.White, checkedTrackColor = sh.accent,
                        uncheckedThumbColor = sh.text2, uncheckedTrackColor = sh.surface3,
                    ),
                )
            }
        }

        Section("About") {
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                Text("Version", color = sh.text1, fontSize = 15.sp, modifier = Modifier.weight(1f))
                Text("0.3.1 native", color = sh.text2, fontSize = 13.sp)
            }
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                Text("Storage", color = sh.text1, fontSize = 15.sp, modifier = Modifier.weight(1f))
                Text("On this device", color = sh.text2, fontSize = 13.sp)
            }
        }
        Spacer(Modifier.height(120.dp))
    }
}

@Composable
private fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    val sh = LocalShark.current
    Column(
        Modifier.fillMaxWidth().padding(bottom = 14.dp)
            .clip(RoundedCornerShape(14.dp)).background(sh.surface2).padding(16.dp),
    ) {
        Text(title.uppercase(), color = sh.text2, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.sp)
        Spacer(Modifier.height(6.dp))
        content()
    }
}

@Composable
private fun ChoiceRow(
    label: String,
    hint: String,
    options: List<Pair<String, String>>,
    selected: String,
    onPick: (String) -> Unit,
) {
    val sh = LocalShark.current
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Text(label, color = sh.text1, fontSize = 15.sp)
        Text(hint, color = sh.text2, fontSize = 12.sp)
        Spacer(Modifier.height(8.dp))
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.horizontalScroll(rememberScrollState()),
        ) {
            options.forEach { (value, display) ->
                val on = value == selected
                Box(
                    Modifier.clip(RoundedCornerShape(9.dp))
                        .background(if (on) sh.accent else sh.surface3)
                        .clickable { onPick(value) }
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                ) {
                    Text(display, color = if (on) Color.White else sh.text2, fontSize = 13.sp, maxLines = 1, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal)
                }
            }
        }
    }
}
