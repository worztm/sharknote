package app.sharknote.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

val Ink = Color(0xFF0B0B0F)
val Surface2 = Color(0xFF141419)
val Surface3 = Color(0xFF1D1D24)
val Stroke = Color(0xFF27272E)
val Text1 = Color(0xFFF2F2F5)
val Text2 = Color(0xFF9B9BA5)
val Accent = Color(0xFF8B5CF6)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val store = NoteStore(applicationContext)
        setContent {
            MaterialTheme(
                darkColorScheme(
                    primary = Accent, background = Ink, surface = Surface2,
                    surfaceVariant = Surface3, outline = Stroke, onSurface = Text1, onSurfaceVariant = Text2,
                )
            ) {
                Surface(Modifier.fillMaxSize(), color = Ink) { AppRoot(store) }
            }
        }
    }
}

private sealed interface Screen {
    data object List : Screen
    data class Edit(val noteId: Long) : Screen
}

@Composable
private fun AppRoot(store: NoteStore) {
    var screen by remember { mutableStateOf<Screen>(Screen.List) }
    when (val s = screen) {
        Screen.List -> NoteListScreen(store, onOpen = { screen = Screen.Edit(it) })
        is Screen.Edit -> EditorScreen(store, s.noteId, onClose = { screen = Screen.List })
    }
}

@Composable
private fun NoteListScreen(store: NoteStore, onOpen: (Long) -> Unit) {
    var query by remember { mutableStateOf("") }
    var createOpen by remember { mutableStateOf(false) }
    var menuFor by remember { mutableStateOf<Long?>(null) }
    val notes = store.search(query)

    Box(Modifier.fillMaxSize().background(Ink)) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 12.dp)) {
                Text("Sharknote", color = Text1, fontSize = 26.sp, fontWeight = FontWeight.Bold)
                Text("your notes, offline", color = Text2, fontSize = 13.sp)
                Spacer(Modifier.height(14.dp))
                Row(
                    Modifier.fillMaxWidth().height(46.dp).background(Surface2, RoundedCornerShape(13.dp)),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.Search, null, tint = Text2, modifier = Modifier.padding(start = 14.dp).size(19.dp))
                    BasicTextField(
                        value = query, onValueChange = { query = it }, singleLine = true,
                        textStyle = TextStyle(color = Text1, fontSize = 15.sp),
                        cursorBrush = SolidColor(Accent),
                        modifier = Modifier.weight(1f).padding(horizontal = 10.dp, vertical = 12.dp),
                        decorationBox = { inner -> if (query.isEmpty()) Text("Search notes", color = Text2, fontSize = 15.sp) else inner() },
                    )
                }
            }
            LazyColumn(
                Modifier.fillMaxSize().padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(bottom = 110.dp),
            ) {
                items(notes, key = { it.id }) { n ->
                    NoteRow(
                        note = n,
                        onClick = { onOpen(n.id) },
                        onMenu = { menuFor = if (menuFor == n.id) null else n.id },
                        menuOpen = menuFor == n.id,
                        onStar = { store.toggleStar(n.id) },
                        onDelete = { store.delete(n.id); menuFor = null },
                    )
                }
                if (notes.isEmpty()) {
                    item {
                        Column(Modifier.fillMaxWidth().padding(top = 80.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("No notes yet", color = Text1, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                            Spacer(Modifier.height(6.dp))
                            Text("Tap + to write your first note", color = Text2, fontSize = 13.sp)
                        }
                    }
                }
            }
        }
        FloatingActionButton(
            onClick = { createOpen = true },
            containerColor = Accent, contentColor = Color.White,
            shape = CircleShape,
            modifier = Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(20.dp).size(60.dp),
        ) {
            Icon(Icons.Filled.Add, "new note", modifier = Modifier.size(28.dp))
        }
    }

    if (createOpen) {
        var t by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { createOpen = false },
            containerColor = Surface2,
            title = { Text("New note", color = Text1, fontWeight = FontWeight.SemiBold) },
            text = {
                BasicTextField(
                    value = t, onValueChange = { t = it }, singleLine = true,
                    textStyle = TextStyle(color = Text1, fontSize = 16.sp),
                    cursorBrush = SolidColor(Accent),
                    modifier = Modifier.fillMaxWidth().background(Surface3, RoundedCornerShape(10.dp)).padding(14.dp),
                    decorationBox = { inner -> if (t.isEmpty()) Text("Note title", color = Text2, fontSize = 16.sp) else inner() },
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val n = store.create(t.ifBlank { "Untitled" })
                    createOpen = false
                    onOpen(n.id)
                }) { Text("Create", color = Accent, fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = { TextButton(onClick = { createOpen = false }) { Text("Cancel", color = Text2) } },
        )
    }
}

@Composable
private fun NoteRow(
    note: Note,
    onClick: () -> Unit,
    onMenu: () -> Unit,
    menuOpen: Boolean,
    onStar: () -> Unit,
    onDelete: () -> Unit,
) {
    val fmt = remember { SimpleDateFormat("MMM d", Locale.getDefault()) }
    Box {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Surface2).clickable(onClick = onClick).padding(16.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    note.title.ifBlank { "Untitled" },
                    color = Text1, fontSize = 15.5.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f), maxLines = 1,
                )
                if (note.starred) Icon(Icons.Filled.Star, null, tint = Accent, modifier = Modifier.size(16.dp))
                Icon(
                    Icons.Filled.MoreVert, "menu", tint = Text2,
                    modifier = Modifier.clickable(onClick = onMenu).size(20.dp),
                )
            }
            if (note.content.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(note.content.replace('\n', ' '), color = Text2, fontSize = 13.sp, maxLines = 2)
            }
            Spacer(Modifier.height(8.dp))
            Text(fmt.format(Date(note.updatedAt)), color = Text2.copy(alpha = 0.6f), fontSize = 11.sp)
        }
        if (menuOpen) {
            Row(
                Modifier.align(Alignment.TopEnd).padding(top = 44.dp, end = 8.dp)
                    .background(Surface3, RoundedCornerShape(10.dp)).padding(4.dp)
            ) {
                TextButton(onClick = onStar) {
                    Icon(if (note.starred) Icons.Filled.Star else Icons.Filled.Star, null, tint = Text1, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp)); Text(if (note.starred) "Unstar" else "Star", color = Text1, fontSize = 13.sp)
                }
                TextButton(onClick = onDelete) {
                    Icon(Icons.Filled.Delete, null, tint = Color(0xFFF87171), modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp)); Text("Delete", color = Color(0xFFF87171), fontSize = 13.sp)
                }
            }
        }
    }
}

@Composable
private fun EditorScreen(store: NoteStore, noteId: Long, onClose: () -> Unit) {
    val note = remember { store.get(noteId) } ?: run { onClose(); return }
    var title by remember { mutableStateOf(TextFieldValue(note.title)) }
    var content by remember { mutableStateOf(TextFieldValue(note.content)) }
    val fmt = remember { SimpleDateFormat("MMM d, h:mm a", Locale.getDefault()) }

    Column(Modifier.fillMaxSize().background(Ink).statusBarsPadding().imePadding()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = {
                store.update(noteId, title = title.text, content = content.text)
                onClose()
            }) { Icon(Icons.Filled.ArrowBack, "back", tint = Text1) }
            Column(Modifier.weight(1f)) {
                Text(fmt.format(Date(note.updatedAt)), color = Text2, fontSize = 11.sp)
            }
            IconButton(onClick = {
                store.update(noteId, title = title.text, content = content.text)
                store.toggleStar(noteId)
            }) {
                Icon(
                    if (note.starred) Icons.Filled.Star else Icons.Filled.Star,
                    "star", tint = if (note.starred) Accent else Text2,
                )
            }
        }
        BasicTextField(
            value = title, onValueChange = { title = it }, singleLine = true,
            textStyle = TextStyle(color = Text1, fontSize = 24.sp, fontWeight = FontWeight.Bold),
            cursorBrush = SolidColor(Accent),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
        )
        BasicTextField(
            value = content, onValueChange = { content = it },
            textStyle = TextStyle(color = Text1, fontSize = 16.sp, lineHeight = 24.sp),
            cursorBrush = SolidColor(Accent),
            modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
            decorationBox = { inner ->
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    if (content.text.isEmpty()) Text("Start writing...", color = Text2.copy(alpha = 0.6f), fontSize = 16.sp)
                    inner()
                    Spacer(Modifier.height(120.dp))
                }
            },
        )
    }
}
