package app.sharknote.mobile

import android.content.Context
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** One attachment copied into app storage and linked to a note. */
data class Attachment(
    val id: Long,
    val noteId: Long,
    val filename: String,
    val stored: String, // random token + extension on disk
    val size: Long,
    val mime: String,
)

/**
 * Attachments persist as an encrypted index (attachments.json) plus copied
 * payload files under filesDir/attachments/. Payload names are random tokens,
 * never user filenames, matching the desktop design. 100 MB cap per file.
 */
class AttachmentStore(context: Context) {
    private val dir = File(context.filesDir, "attachments").apply { mkdirs() }
    private val file = File(context.filesDir, "attachments.json")
    private val items = mutableListOf<Attachment>()
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
                        Attachment(
                            id = o.getLong("id"), noteId = o.getLong("noteId"),
                            filename = o.getString("filename"), stored = o.getString("stored"),
                            size = o.getLong("size"), mime = o.getString("mime"),
                        )
                    )
                    if (o.getLong("id") >= nextId) nextId = o.getLong("id") + 1
                }
            }
        }
    }

    fun forNote(noteId: Long): List<Attachment> = items.filter { it.noteId == noteId }

    /** Copies [uri]'s content into storage. Returns null on failure/oversize. */
    fun attach(context: Context, noteId: Long, uri: Uri): Attachment? {
        val resolver = context.contentResolver
        val name = queryName(context, uri) ?: "file"
        val ext = name.substringAfterLast('.', "").lowercase().take(12)
        val rnd = java.security.SecureRandom()
        val rndBytes = ByteArray(8).also { rnd.nextBytes(it) }
        val token = rndBytes.joinToString("") { "%02x".format(it) } +
            if (ext.isEmpty()) "" else ".$ext"
        val dst = File(dir, token)
        return try {
            var oversize = false
            resolver.openInputStream(uri)?.use { input ->
                dst.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > MAX_SIZE) { oversize = true; break }
                        out.write(buf, 0, n)
                    }
                }
            }
            if (oversize) {
                dst.delete()
                return null
            }
            val a = Attachment(
                id = nextId++, noteId = noteId, filename = name, stored = token,
                size = dst.length(),
                mime = MimeTypeMap.getSingleton()
                    .getMimeTypeFromExtension(ext.removePrefix(".")) ?: "application/octet-stream",
            )
            items.add(a)
            save()
            a
        } catch (e: Exception) {
            dst.delete()
            null
        }
    }

    fun remove(context: Context, id: Long) {
        items.find { it.id == id }?.let {
            File(dir, it.stored).delete()
            items.remove(it)
            save()
        }
    }

    /** Note deleted: drop rows + payloads. */
    fun purgeNote(noteId: Long) {
        val gone = items.filter { it.noteId == noteId }
        if (gone.isEmpty()) return
        gone.forEach { File(dir, it.stored).delete() }
        items.removeAll(gone.toSet())
        save()
    }

    fun fileFor(a: Attachment): File = File(dir, a.stored)

    fun shareUri(context: Context, a: Attachment): Uri = FileProvider.getUriForFile(
        context, context.packageName + ".fileprovider", fileFor(a)
    )

    private fun queryName(context: Context, uri: Uri): String? {
        val proj = arrayOf(android.provider.OpenableColumns.DISPLAY_NAME)
        context.contentResolver.query(uri, proj, null, null, null)?.use {
            if (it.moveToFirst()) return it.getString(0)
        }
        return uri.lastPathSegment?.substringAfterLast('/')
    }

    private fun save() {
        val arr = JSONArray()
        items.forEach { a ->
            arr.put(JSONObject().apply {
                put("id", a.id); put("noteId", a.noteId); put("filename", a.filename)
                put("stored", a.stored); put("size", a.size); put("mime", a.mime)
            })
        }
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeBytes(NoteCrypto.encrypt(arr.toString().toByteArray()))
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
    }

    companion object { const val MAX_SIZE = 100L * 1024 * 1024 }
}
