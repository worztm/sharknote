package app.sharknote.mobile

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** One todo: text plus optional due/alarm epoch millis (0 = unset). */
data class Todo(
    val id: Long,
    var text: String,
    var done: Boolean,
    var dueAt: Long,
    var alarmAt: Long,
    var createdAt: Long,
    var alarmFired: Boolean = false,
)

/**
 * Todos live in one encrypted JSON file, mirroring NoteStore's approach.
 * Alarm scheduling is owned by AlarmScheduler; this class only persists.
 */
class TodoStore(context: Context) {
    private val file = File(context.filesDir, "todos.json")
    private val items = mutableListOf<Todo>()
    private var nextId = 1L

    init {
        if (file.exists()) {
            val raw = file.readBytes()
            val json = NoteCrypto.decrypt(raw) ?: raw
            runCatching {
                val arr = JSONArray(json.toString(Charsets.UTF_8))
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    items.add(
                        Todo(
                            id = o.getLong("id"),
                            text = o.getString("text"),
                            done = o.getBoolean("done"),
                            dueAt = o.getLong("dueAt"),
                            alarmAt = o.getLong("alarmAt"),
                            createdAt = o.getLong("createdAt"),
                            alarmFired = if (o.has("alarmFired")) o.getBoolean("alarmFired") else false,
                        )
                    )
                    if (o.getLong("id") >= nextId) nextId = o.getLong("id") + 1
                }
            }
        }
    }

    /** Open todos first (by alarm/due), then completed. */
    val all: List<Todo>
        get() = items.sortedWith(
            compareBy<Todo> { it.done }
                .thenByDescending { if (it.dueAt > 0) -it.dueAt else if (it.alarmAt > 0) -it.alarmAt else 0L }
                .thenByDescending { it.createdAt }
        )

    fun pendingAlarms(now: Long): List<Todo> =
        items.filter { !it.done && it.alarmAt > 0 && it.alarmAt <= now }

    fun get(id: Long): Todo? = items.find { it.id == id }

    fun create(text: String, dueAt: Long, alarmAt: Long): Todo {
        val t = Todo(nextId++, text.trim(), false, dueAt, alarmAt, System.currentTimeMillis())
        items.add(t)
        save()
        return t
    }

    fun setDone(id: Long, done: Boolean) {
        items.find { it.id == id }?.let { it.done = done; save() }
    }

    /** The alarm went off: auto-complete the todo (issue: done on delivery). */
    fun markAlarmDone(id: Long) {
        items.find { it.id == id }?.let { it.done = true; it.alarmFired = true; save() }
    }

    /** User moved the alarm: reopen the todo and clear the fired state. */
    fun reschedule(id: Long, alarmAt: Long) {
        items.find { it.id == id }?.let {
            it.alarmAt = alarmAt; it.done = false; it.alarmFired = false; save()
        }
    }

    fun delete(id: Long) {
        items.removeAll { it.id == id }
        save()
    }

    private fun save() {
        val arr = JSONArray()
        items.forEach { t ->
            arr.put(JSONObject().apply {
                put("id", t.id); put("text", t.text); put("done", t.done)
                put("dueAt", t.dueAt); put("alarmAt", t.alarmAt); put("createdAt", t.createdAt)
                put("alarmFired", t.alarmFired)
            })
        }
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeBytes(NoteCrypto.encrypt(arr.toString().toByteArray()))
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }
}
