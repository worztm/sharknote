package app.sharknote.mobile

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** One note: a title and plain-text content. */
data class Note(
    val id: Long,
    var title: String,
    var content: String,
    var starred: Boolean,
    var updatedAt: Long,
)

/**
 * Notes live in one JSON file under app-private storage. The desktop app uses
 * SQLite + a vault folder; on phones the vault model does not fit the sandbox,
 * so v1 ships notes in a single portable file the user can back up.
 */
class NoteStore(context: Context) {
    private val file = File(context.filesDir, "notes.json")
    private val notes = mutableListOf<Note>()
    private var nextId = 1L

    init {
        if (file.exists()) {
            val raw = file.readBytes()
            // Transparent migration: plaintext files from <=0.3.0 are read,
            // then rewritten encrypted on the first save.
            val json = NoteCrypto.decrypt(raw) ?: raw
            runCatching {
                val arr = JSONArray(json.toString(Charsets.UTF_8))
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    notes.add(
                        Note(
                            id = o.getLong("id"),
                            title = o.getString("title"),
                            content = o.getString("content"),
                            starred = o.getBoolean("starred"),
                            updatedAt = o.getLong("updatedAt"),
                        )
                    )
                    if (o.getLong("id") >= nextId) nextId = o.getLong("id") + 1
                }
            }
        }
    }

    val all: List<Note>
        get() = notes.sortedWith(compareByDescending<Note> { it.starred }.thenByDescending { it.updatedAt })

    fun get(id: Long): Note? = notes.find { it.id == id }

    fun create(title: String): Note {
        val n = Note(nextId++, title, "", false, System.currentTimeMillis())
        notes.add(n)
        save()
        return n
    }

    fun update(id: Long, title: String? = null, content: String? = null) {
        notes.find { it.id == id }?.let {
            if (title != null) it.title = title
            if (content != null) it.content = content
            it.updatedAt = System.currentTimeMillis()
            save()
        }
    }

    fun toggleStar(id: Long) {
        notes.find { it.id == id }?.let { it.starred = !it.starred; save() }
    }

    fun delete(id: Long) {
        notes.removeAll { it.id == id }
        save()
    }

    fun search(q: String): List<Note> {
        if (q.isBlank()) return all
        return all.filter { it.title.contains(q, true) || it.content.contains(q, true) }
    }

    private fun save() {
        val arr = JSONArray()
        notes.forEach { n ->
            arr.put(JSONObject().apply {
                put("id", n.id); put("title", n.title); put("content", n.content)
                put("starred", n.starred); put("updatedAt", n.updatedAt)
            })
        }
        // Atomic write: temp file + rename, encrypted at rest.
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeBytes(NoteCrypto.encrypt(arr.toString().toByteArray()))
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }
}
