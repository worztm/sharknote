package app.sharknote.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Todos tab. Alarm/due pickers are the real Material 3 DatePickerDialog +
 * TimePicker (material3 1.4.0, already in the local gradle cache — no new
 * dependency). Reminders are fired by AlarmManager notifications from
 * AlarmScheduler.kt: androidx.core NotificationCompat over the system
 * notification channel, i.e. genuine Android notifications, not in-app
 * banners.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodoScreen(store: TodoStore, dataVersion: Int, onMutate: () -> Unit) {
    val sh = LocalShark.current
    val context = LocalContext.current
    var text by remember { mutableStateOf("") }
    var alarmAt by remember { mutableStateOf(0L) } // epoch ms, 0 = none
    var dueAt by remember { mutableStateOf(0L) }   // epoch ms, 0 = none
    // "pick-alarm-date" | "pick-due-date" | "pick-alarm-time:<utcMillis>"
    var picking by remember { mutableStateOf<String?>(null) }
    val todos = remember(dataVersion) { store.all }
    val timeFmt = remember { SimpleDateFormat("EEE h:mm a", Locale.getDefault()) }
    val dateFmt = remember { SimpleDateFormat("EEE, MMM d", Locale.getDefault()) }

    fun add() {
        val t = text.trim()
        if (t.isEmpty()) return
        val created = store.create(t, dueAt, alarmAt)
        if (alarmAt > System.currentTimeMillis()) AlarmScheduler.schedule(context, created)
        text = ""; alarmAt = 0; dueAt = 0
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
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { add() }),
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
                AlarmChip("No alarm", alarmAt == 0L) { alarmAt = 0 }
                AlarmChip("Tonight 8pm", alarmAt == tonightAt(20, 0)) { alarmAt = tonightAt(20, 0) }
                AlarmChip("Tomorrow 9am", alarmAt == tomorrowAt(9, 0)) { alarmAt = tomorrowAt(9, 0) }
                AlarmChip("Pick time…", false) { picking = "pick-alarm-date" }
                AlarmChip("Due date…", false) { picking = "pick-due-date" }
            }
            if (alarmAt > 0 || dueAt > 0) {
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (alarmAt > 0) WhenPill("Alarm · ${timeFmt.format(Date(alarmAt))}", sh) { alarmAt = 0 }
                    if (dueAt > 0) WhenPill("Due · ${dateFmt.format(Date(dueAt))}", sh) { dueAt = 0 }
                }
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
                        Text("Add a todo above; set an alarm and Sharknote will remind you.",
                            color = sh.text2, fontSize = 13.sp)
                    }
                }
            }
        }
    }

    // --- Material 3 date picker (shared by alarm + due flows) -------------
    val pickingState = picking
    if (pickingState == "pick-alarm-date" || pickingState == "pick-due-date") {
        val dateState = rememberDatePickerState()
        DatePickerDialog(
            onDismissRequest = { picking = null },
            confirmButton = {
                TextButton(onClick = {
                    val d = dateState.selectedDateMillis
                    if (d == null) { picking = null; return@TextButton }
                    if (pickingState == "pick-due-date") {
                        dueAt = utcMidnightToLocal(d)
                        picking = null
                    } else {
                        picking = "pick-alarm-time:$d"
                    }
                }) { Text(if (pickingState == "pick-due-date") "Set" else "Next", color = sh.accent) }
            },
            dismissButton = { TextButton(onClick = { picking = null }) { Text("Cancel", color = sh.text2) } },
        ) {
            DatePicker(state = dateState)
        }
    }

    // --- Material 3 time clock for the alarm (after the date was picked) --
    if (pickingState != null && pickingState.startsWith("pick-alarm-time:")) {
        val dayUtc = pickingState.substringAfter(':').toLongOrNull() ?: 0L
        AlarmTimeDialog(dayUtc, onSet = { millis -> alarmAt = millis; picking = null },
            onCancel = { picking = null })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AlarmTimeDialog(dayUtcMillis: Long, onSet: (Long) -> Unit, onCancel: () -> Unit) {
    val sh = LocalShark.current
    val context = LocalContext.current
    val dayCal = Calendar.getInstance().apply { timeInMillis = utcMidnightToLocal(dayUtcMillis) }
    val isToday = Calendar.getInstance().get(Calendar.DAY_OF_YEAR) == dayCal.get(Calendar.DAY_OF_YEAR) &&
        Calendar.getInstance().get(Calendar.YEAR) == dayCal.get(Calendar.YEAR)
    // Sensible default instead of a blank dial: now+30m (rounded to 5) if the
    // picked day is today, else 9:00.
    val defaultCal = Calendar.getInstance().apply {
        if (isToday) {
            add(Calendar.MINUTE, 30)
            set(Calendar.MINUTE, (get(Calendar.MINUTE) / 5) * 5)
        } else set(Calendar.HOUR_OF_DAY, 9)
        set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }
    val timeState = rememberTimePickerState(
        initialHour = defaultCal.get(Calendar.HOUR_OF_DAY),
        initialMinute = defaultCal.get(Calendar.MINUTE),
        is24Hour = android.text.format.DateFormat.is24HourFormat(context),
    )
    val previewFmt = remember { SimpleDateFormat("h:mm a", Locale.getDefault()) }
    val preview = Calendar.getInstance().apply {
        set(dayCal.get(Calendar.YEAR), dayCal.get(Calendar.MONTH), dayCal.get(Calendar.DAY_OF_MONTH),
            timeState.hour, timeState.minute, 0)
    }.time
    AlertDialog(
        onDismissRequest = onCancel,
        containerColor = sh.surface2,
        title = {
            Column {
                Text("Alarm time", color = sh.text1, fontWeight = FontWeight.SemiBold)
                Text(
                    (if (isToday) "Today · " else dayCal.getTime().let { SimpleDateFormat("EEE, MMM d", Locale.getDefault()).format(it) } + " · ") +
                        previewFmt.format(preview),
                    color = sh.accent, fontSize = 14.sp,
                )
            }
        },
        text = {
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                // Quick-set row first: most reminders are "in a bit" or "tonight".
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AlarmChip("+10 min", false) {
                        val c = Calendar.getInstance().apply { add(Calendar.MINUTE, 10) }
                        timeState.hour = c.get(Calendar.HOUR_OF_DAY); timeState.minute = c.get(Calendar.MINUTE)
                    }
                    AlarmChip("+1 h", false) {
                        val c = Calendar.getInstance().apply { add(Calendar.HOUR_OF_DAY, 1) }
                        timeState.hour = c.get(Calendar.HOUR_OF_DAY); timeState.minute = c.get(Calendar.MINUTE)
                    }
                    AlarmChip("8 pm", false) { timeState.hour = 20; timeState.minute = 0 }
                    AlarmChip("9 am", false) { timeState.hour = 9; timeState.minute = 0 }
                }
                Spacer(Modifier.height(10.dp))
                TimePicker(state = timeState)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val cal = Calendar.getInstance().apply {
                    set(
                        dayCal.get(Calendar.YEAR), dayCal.get(Calendar.MONTH), dayCal.get(Calendar.DAY_OF_MONTH),
                        timeState.hour, timeState.minute, 0,
                    )
                    set(Calendar.MILLISECOND, 0)
                    if (timeInMillis < System.currentTimeMillis()) add(Calendar.DAY_OF_YEAR, 1)
                }
                onSet(cal.timeInMillis)
            }) { Text("Set alarm", color = sh.accent) }
        },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel", color = sh.text2) } },
    )
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
private fun WhenPill(label: String, sh: SharkPalette, onClear: () -> Unit) {
    Row(
        Modifier.clip(RoundedCornerShape(50)).background(sh.accent.copy(alpha = 0.12f))
            .padding(start = 12.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = sh.accent, fontSize = 12.sp)
        Spacer(Modifier.width(6.dp))
        Icon(Icons.Filled.Close, "clear", tint = sh.accent, modifier = Modifier.size(13.dp).clickable(onClick = onClear))
    }
}

@Composable
private fun TodoRow(t: Todo, sh: SharkPalette, onToggle: () -> Unit, onDelete: () -> Unit) {
    val fmt = remember { SimpleDateFormat("MMM d", Locale.getDefault()) }
    val timeFmt = remember { SimpleDateFormat("h:mm a", Locale.getDefault()) }
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
            val parts = listOfNotNull(
                if (t.dueAt > 0) "due ${fmt.format(Date(t.dueAt))}" else null,
                if (t.alarmAt > 0 && !t.done) "alarm ${timeFmt.format(Date(t.alarmAt))}" else null,
            )
            if (parts.isNotEmpty()) {
                val overdue = !t.done && t.dueAt > 0 && t.dueAt < System.currentTimeMillis()
                Text(
                    parts.joinToString(" · ") + if (overdue) " · overdue" else "",
                    color = if (overdue) Color(0xFFF87171) else sh.text2, fontSize = 11.sp,
                )
            }
        }
        Icon(
            Icons.Filled.Delete, "delete", tint = Color(0xFFF87171).copy(alpha = 0.8f),
            modifier = Modifier.size(18.dp).clickable(onClick = onDelete),
        )
    }
}

/** The M3 date picker returns UTC midnight; land on 9am of that same calendar day locally. */
private fun utcMidnightToLocal(utcMillis: Long): Long {
    val utc = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { timeInMillis = utcMillis }
    return Calendar.getInstance().apply {
        clear()
        set(utc.get(Calendar.YEAR), utc.get(Calendar.MONTH), utc.get(Calendar.DAY_OF_MONTH), 9, 0, 0)
    }.timeInMillis
}

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
