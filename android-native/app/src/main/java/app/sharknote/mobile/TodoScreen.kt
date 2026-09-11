package app.sharknote.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Calendar

/**
 * Todos tab: quick-add with alarm presets (the phone-appropriate equivalent
 * of the desktop datetime pickers), check off, delete. Alarms go through
 * AlarmScheduler so they fire even with the app closed.
 */
@Composable
fun TodoScreen(store: TodoStore, dataVersion: Int, onMutate: () -> Unit) {
    val sh = LocalShark.current
    val context = LocalContext.current
    var text by remember { mutableStateOf("") }
    var alarmChoice by remember { mutableStateOf(0L) } // epoch millis, 0 = none
    val todos = remember(dataVersion) { store.all }

    fun add() {
        val t = text.trim()
        if (t.isEmpty()) return
        val now = System.currentTimeMillis()
        val created = store.create(t, 0, alarmChoice)
        if (alarmChoice > now) AlarmScheduler.schedule(context, created)
        text = ""; alarmChoice = 0
        onMutate()
    }

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 12.dp)) {
            Text("Todos", color = sh.text1, fontSize = 26.sp, fontWeight = FontWeight.Bold)
            Text("reminders work with the app closed", color = sh.text2, fontSize = 13.sp)
            Spacer(Modifier.height(14.dp))
            Row(
                Modifier.fillMaxWidth().height(46.dp).background(sh.surface2, RoundedCornerShape(13.dp)),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BasicTextField(
                    value = text, onValueChange = { text = it }, singleLine = true,
                    textStyle = TextStyle(color = sh.text1, fontSize = 15.sp),
                    cursorBrush = SolidColor(sh.accent),
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done),
                    keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { add() }),
                    modifier = Modifier.weight(1f).padding(horizontal = 14.dp, vertical = 12.dp),
                    decorationBox = { inner -> if (text.isEmpty()) Text("Add a todo…", color = sh.text2, fontSize = 15.sp) else inner() },
                )
                Icon(
                    Icons.Filled.Add, "add", tint = sh.accent,
                    modifier = Modifier.padding(end = 14.dp).size(22.dp).clickable { add() },
                )
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AlarmChip("No alarm", alarmChoice == 0L) { alarmChoice = 0 }
                AlarmChip("In 1 hour", alarmChoice in (now()..now() + 3_600_000L) && alarmChoice > 0) {
                    alarmChoice = now() + 3_600_000L
                }
                AlarmChip("Tonight 8pm", alarmChoice == tonightAt(20, 0)) { alarmChoice = tonightAt(20, 0) }
                AlarmChip("Tomorrow 9am", alarmChoice == tomorrowAt(9, 0)) { alarmChoice = tomorrowAt(9, 0) }
            }
            if (alarmChoice > 0) {
                Spacer(Modifier.height(6.dp))
                Text(
                    "Alarm: " + java.text.SimpleDateFormat("EEE h:mm a", java.util.Locale.getDefault())
                        .format(java.util.Date(alarmChoice)),
                    color = sh.accent, fontSize = 12.sp,
                )
            }
        }

        LazyColumn(
            Modifier.fillMaxSize().padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(bottom = 150.dp),
        ) {
            items(todos.filter { !it.done }, key = { it.id }) { t ->
                TodoRow(
                    t, sh,
                    onToggle = {
                        store.setDone(t.id, true)
                        AlarmScheduler.cancel(context, t.id)
                        onMutate()
                    },
                    onDelete = { store.delete(t.id); AlarmScheduler.cancel(context, t.id); onMutate() },
                )
            }
            val done = todos.filter { it.done }
            if (done.isNotEmpty()) {
                item(key = "done-hdr") {
                    Text("Done", color = sh.text2, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(start = 8.dp, top = 10.dp))
                }
                items(done, key = { it.id }) { t ->
                    TodoRow(
                        t, sh,
                        onToggle = { store.setDone(t.id, false); onMutate() },
                        onDelete = { store.delete(t.id); onMutate() },
                    )
                }
            }
            if (todos.isEmpty()) {
                item {
                    Column(Modifier.fillMaxWidth().padding(top = 80.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Nothing to do", color = sh.text1, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(6.dp))
                        Text("Add a todo above; pick an alarm and Sharknote will remind you.",
                            color = sh.text2, fontSize = 13.sp)
                    }
                }
            }
        }
    }
}

private fun now() = System.currentTimeMillis()

private fun tonightAt(hour: Int, minute: Int): Long {
    val c = Calendar.getInstance()
    c.set(Calendar.HOUR_OF_DAY, hour); c.set(Calendar.MINUTE, minute); c.set(Calendar.SECOND, 0)
    if (c.timeInMillis <= System.currentTimeMillis()) c.add(Calendar.DAY_OF_YEAR, 1)
    return c.timeInMillis
}

private fun tomorrowAt(hour: Int, minute: Int): Long {
    val c = Calendar.getInstance()
    c.add(Calendar.DAY_OF_YEAR, 1)
    c.set(Calendar.HOUR_OF_DAY, hour); c.set(Calendar.MINUTE, minute); c.set(Calendar.SECOND, 0)
    return c.timeInMillis
}

@Composable
private fun AlarmChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val sh = LocalShark.current
    Text(
        label,
        color = if (selected) sh.accent else sh.text2,
        fontSize = 12.sp,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(if (selected) sh.accent.copy(alpha = 0.14f) else sh.surface2)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 7.dp),
    )
}

@Composable
private fun TodoRow(t: Todo, sh: SharkPalette, onToggle: () -> Unit, onDelete: () -> Unit) {
    val fmt = remember { java.text.SimpleDateFormat("EEE h:mm a", java.util.Locale.getDefault()) }
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(sh.surface2)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            if (t.done) Icons.Filled.Check else ClockIcon,
            null,
            tint = if (t.done) sh.accent else sh.text2,
            modifier = Modifier.size(20.dp).clickable(onClick = onToggle),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                t.text, color = if (t.done) sh.text2.copy(alpha = 0.6f) else sh.text1,
                fontSize = 14.5.sp, fontWeight = FontWeight.Medium,
            )
            if (t.alarmAt > 0 && !t.done) {
                Text("alarm " + fmt.format(java.util.Date(t.alarmAt)), color = sh.text2, fontSize = 11.sp)
            }
        }
        Icon(
            Icons.Filled.Delete, "delete", tint = Color(0xFFF87171).copy(alpha = 0.8f),
            modifier = Modifier.size(18.dp).clickable(onClick = onDelete),
        )
    }
}
