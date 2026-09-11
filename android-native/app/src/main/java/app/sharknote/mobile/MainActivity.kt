package app.sharknote.mobile

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Dark system bars: white status icons, no light strip under the nav bar.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        if (Build.VERSION.SDK_INT >= 33 &&
            androidx.core.content.ContextCompat.checkSelfPermission(
                this, android.Manifest.permission.POST_NOTIFICATIONS
            ) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            androidx.core.app.ActivityCompat.requestPermissions(
                this, arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 100
            )
        }
        val store = NoteStore(applicationContext)
        val settingsStore = SettingsStore(applicationContext)
        val todoStore = TodoStore(applicationContext)
        val attachStore = AttachmentStore(applicationContext)
        // Re-arm alarms that AlarmManager lost (reboot, force-stop).
        AlarmScheduler.rescheduleAll(this)
        // ColorOS doze kills broadcast delivery unless we're exempted; ask once.
        AlarmScheduler.requestIgnoreBatteryOptimizations(this)
        // Tapping a reminder notification opens straight into rescheduling it.
        val alarmTodoId = intent?.getLongExtra(AlarmScheduler.EXTRA_TODO_ID, -1L) ?: -1L
        setContent {
            AppRoot(store, settingsStore, todoStore, attachStore,
                rescheduleTodoId = if (alarmTodoId > 0) alarmTodoId else null)
        }
    }
}

private enum class Tab { Notes, Todos, Graph, Settings }

private sealed interface Screen {
    data object List : Screen
    data class Edit(val noteId: Long) : Screen
}

@Composable
private fun AppRoot(
    store: NoteStore, settingsStore: SettingsStore,
    todoStore: TodoStore, attachStore: AttachmentStore,
    rescheduleTodoId: Long? = null,
) {
    var settings by remember { mutableStateOf(settingsStore.load()) }
    var screen by remember { mutableStateOf<Screen>(Screen.List) }
    var tab by remember { mutableStateOf(if (rescheduleTodoId != null) Tab.Todos else Tab.Notes) }
    // bump after any mutation so list/graph re-read the store
    var dataVersion by remember { mutableIntStateOf(0) }

    val palette = paletteFor(settings)

    // Belt and braces for the keyboard: never let it pop up on entry.
    val focusManager = LocalFocusManager.current
    LaunchedEffect(Unit) { focusManager.clearFocus(true) }

    CompositionLocalProvider(LocalShark provides palette) {
        MaterialTheme(
            colorScheme = darkColorScheme(
                primary = palette.accent, background = palette.ink, surface = palette.surface2,
                surfaceVariant = palette.surface3, outline = palette.stroke,
                onSurface = palette.text1, onSurfaceVariant = palette.text2,
            )
        ) {
            Surface(Modifier.fillMaxSize(), color = palette.ink) {
                val s = screen
                if (s is Screen.Edit) {
                    EditorScreen(
                        store, attachStore, s.noteId, settings, dataVersion,
                        onClose = { screen = Screen.List; dataVersion++ },
                        onMutate = { dataVersion++ },
                    )
                } else {
                    // Box so the FAB floats above the content, bar above insets.
                    Box(Modifier.fillMaxSize()) {
                        when (tab) {
                            Tab.Notes -> NoteListScreen(store, attachStore, dataVersion, settings.confirmDelete, onOpen = { screen = Screen.Edit(it) }, onMutate = { dataVersion++ })
                            Tab.Todos -> TodoScreen(todoStore, dataVersion, rescheduleTodoId,
                                onMutate = { dataVersion++ })
                            Tab.Graph -> GraphScreen(store, dataVersion, settings.graphTheme, onOpen = { screen = Screen.Edit(it) })
                            Tab.Settings -> SettingsScreen(settings, onChange = { settings = it; settingsStore.save(it) })
                        }
                        if (tab == Tab.Notes) {
                            var createOpen by remember { mutableStateOf(false) }
                            FloatingActionButton(
                                onClick = { createOpen = true },
                                containerColor = palette.accent, contentColor = Color.White,
                                shape = CircleShape,
                                modifier = Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(bottom = 92.dp, end = 20.dp).size(56.dp),
                            ) {
                                Icon(Icons.Filled.Add, "new note", modifier = Modifier.size(26.dp))
                            }
                            if (createOpen) {
                                NewNoteDialog(onCancel = { createOpen = false }, onCreate = { title ->
                                    createOpen = false
                                    screen = Screen.Edit(store.create(title).id)
                                })
                            }
                        }
                        SharkBottomBar(tab = tab, onSelect = { tab = it; screen = Screen.List })
                    }
                }
            }
        }
    }
}

@Composable
private fun BoxScope.SharkBottomBar(tab: Tab, onSelect: (Tab) -> Unit) {
    val sh = LocalShark.current
    NavigationBar(
        containerColor = sh.surface2,
        tonalElevation = 0.dp,
        modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth(),
    ) {
        NavigationBarItem(
            selected = tab == Tab.Notes, onClick = { onSelect(Tab.Notes) },
            icon = { Icon(NotesIcon, null, modifier = Modifier.size(22.dp)) },
            label = { Text("Notes", fontSize = 11.sp) },
            colors = navItemColors(sh),
        )
        NavigationBarItem(
            selected = tab == Tab.Todos, onClick = { onSelect(Tab.Todos) },
            icon = { Icon(Icons.Filled.Check, null, modifier = Modifier.size(22.dp)) },
            label = { Text("Todos", fontSize = 11.sp) },
            colors = navItemColors(sh),
        )
        NavigationBarItem(
            selected = tab == Tab.Graph, onClick = { onSelect(Tab.Graph) },
            icon = { Icon(GraphIcon, null, modifier = Modifier.size(22.dp)) },
            label = { Text("Graph", fontSize = 11.sp) },
            colors = navItemColors(sh),
        )
        NavigationBarItem(
            selected = tab == Tab.Settings, onClick = { onSelect(Tab.Settings) },
            icon = { Icon(Icons.Filled.Settings, null, modifier = Modifier.size(22.dp)) },
            label = { Text("Settings", fontSize = 11.sp) },
            colors = navItemColors(sh),
        )
    }
}

@Composable
private fun navItemColors(sh: SharkPalette) = NavigationBarItemDefaults.colors(
    selectedIconColor = sh.accent, selectedTextColor = sh.accent,
    indicatorColor = sh.accent.copy(alpha = 0.14f),
    unselectedIconColor = sh.text2, unselectedTextColor = sh.text2,
)

@Composable
private fun NewNoteDialog(onCancel: () -> Unit, onCreate: (String) -> Unit) {
    val sh = LocalShark.current
    var t by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onCancel,
        containerColor = sh.surface2,
        title = { Text("New note", color = sh.text1, fontWeight = FontWeight.SemiBold) },
        text = {
            BasicTextField(
                value = t, onValueChange = { t = it }, singleLine = true,
                textStyle = TextStyle(color = sh.text1, fontSize = 16.sp),
                cursorBrush = SolidColor(sh.accent),
                modifier = Modifier.fillMaxWidth().background(sh.surface3, RoundedCornerShape(10.dp)).padding(14.dp),
                decorationBox = { inner -> if (t.isEmpty()) Text("Note title", color = sh.text2, fontSize = 16.sp) else inner() },
            )
        },
        confirmButton = { TextButton(onClick = { onCreate(t.ifBlank { "Untitled" }) }) { Text("Create", color = sh.accent, fontWeight = FontWeight.SemiBold) } },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel", color = sh.text2) } },
    )
}

@Composable
private fun NoteListScreen(store: NoteStore, attachStore: AttachmentStore, dataVersion: Int, confirmDelete: Boolean, onOpen: (Long) -> Unit, onMutate: () -> Unit) {
    val sh = LocalShark.current
    var query by remember { mutableStateOf("") }
    var menuFor by remember { mutableStateOf<Long?>(null) }
    var pendingDelete by remember { mutableStateOf<Long?>(null) }
    val notes = remember(dataVersion, query) { store.search(query) }

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 12.dp)) {
            Text("Sharknote", color = sh.text1, fontSize = 26.sp, fontWeight = FontWeight.Bold)
            Text("your notes, offline", color = sh.text2, fontSize = 13.sp)
            Spacer(Modifier.height(14.dp))
            Row(
                Modifier.fillMaxWidth().height(46.dp).background(sh.surface2, RoundedCornerShape(13.dp)),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Search, null, tint = sh.text2, modifier = Modifier.padding(start = 14.dp).size(19.dp))
                BasicTextField(
                    value = query, onValueChange = { query = it }, singleLine = true,
                    textStyle = TextStyle(color = sh.text1, fontSize = 15.sp),
                    cursorBrush = SolidColor(sh.accent),
                    // keyboard only appears once the user actually taps the field
                    modifier = Modifier.weight(1f).padding(horizontal = 10.dp, vertical = 12.dp),
                    decorationBox = { inner -> if (query.isEmpty()) Text("Search notes", color = sh.text2, fontSize = 15.sp) else inner() },
                )
            }
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(bottom = 150.dp),
        ) {
            items(notes, key = { it.id }) { n ->
                NoteRow(
                    note = n,
                    onClick = { onOpen(n.id) },
                    onMenu = { menuFor = if (menuFor == n.id) null else n.id },
                    menuOpen = menuFor == n.id,
                    onStar = { store.toggleStar(n.id); menuFor = null; onMutate() },
                    onDelete = {
                        menuFor = null
                        if (confirmDelete) pendingDelete = n.id
                        else { store.delete(n.id); attachStore.purgeNote(n.id); onMutate() }
                    },
                )
            }
            if (notes.isEmpty()) {
                item {
                    Column(Modifier.fillMaxWidth().padding(top = 80.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(if (query.isBlank()) "No notes yet" else "No matches", color = sh.text1, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            if (query.isBlank()) "Tap + to write your first note" else "Nothing found for \"$query\"",
                            color = sh.text2, fontSize = 13.sp,
                        )
                    }
                }
            }
        }
    }

    // Delete confirmation mirrors desktop settings.confirmDelete
    val delId = pendingDelete
    if (delId != null) {
        val n = store.get(delId)
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            containerColor = sh.surface2,
            title = { Text("Delete note?", color = sh.text1, fontWeight = FontWeight.SemiBold) },
            text = { Text("\"${n?.title?.ifBlank { "Untitled" } ?: ""}\" will be removed. This cannot be undone.", color = sh.text2, fontSize = 14.sp) },
            confirmButton = {
                TextButton(onClick = { store.delete(delId); attachStore.purgeNote(delId); pendingDelete = null; onMutate() }) {
                    Text("Delete", color = Color(0xFFF87171), fontWeight = FontWeight.SemiBold)
                }
            },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text("Keep", color = sh.text2) } },
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
    val sh = LocalShark.current
    val fmt = remember { SimpleDateFormat("MMM d", Locale.getDefault()) }
    Box {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(sh.surface2).clickable(onClick = onClick).padding(16.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    note.title.ifBlank { "Untitled" },
                    color = sh.text1, fontSize = 15.5.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f), maxLines = 1,
                )
                if (note.starred) Icon(Icons.Filled.Star, null, tint = sh.accent, modifier = Modifier.size(16.dp))
                Icon(
                    Icons.Filled.MoreVert, "menu", tint = sh.text2,
                    modifier = Modifier.clickable(onClick = onMenu).size(20.dp),
                )
            }
            if (note.content.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(note.content.replace('\n', ' '), color = sh.text2, fontSize = 13.sp, maxLines = 2)
            }
            Spacer(Modifier.height(8.dp))
            Text(fmt.format(Date(note.updatedAt)), color = sh.text2.copy(alpha = 0.6f), fontSize = 11.sp)
        }
        if (menuOpen) {
            Row(
                Modifier.align(Alignment.TopEnd).padding(top = 44.dp, end = 8.dp)
                    .background(sh.surface3, RoundedCornerShape(10.dp)).padding(4.dp)
            ) {
                TextButton(onClick = onStar) {
                    Icon(Icons.Filled.Star, null, tint = if (note.starred) sh.accent else sh.text1, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp)); Text(if (note.starred) "Unstar" else "Star", color = sh.text1, fontSize = 13.sp)
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
private fun EditorScreen(store: NoteStore, attachStore: AttachmentStore, noteId: Long, settings: SharkSettings, dataVersion: Int, onClose: () -> Unit, onMutate: () -> Unit) {
    val sh = LocalShark.current
    val note = remember { store.get(noteId) } ?: run { onClose(); return }
    var title by remember { mutableStateOf(TextFieldValue(note.title)) }
    var content by remember { mutableStateOf(TextFieldValue(note.content)) }
    // Star must be local Compose state: reading store.get() inside the Icon
    // tint is not observable, so toggling never recomposed the button
    // (the "favorite does nothing" bug).
    var starred by remember { mutableStateOf(note.starred) }
    var preview by remember { mutableStateOf(settings.defaultView == "preview") }
    val fmt = remember { SimpleDateFormat("MMM d, h:mm a", Locale.getDefault()) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var attachments by remember(noteId) { mutableStateOf(attachStore.forNote(noteId)) }
    val pickMedia = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(10)
    ) { uris ->
        uris.forEach { uri ->
            scope.launch(Dispatchers.IO) {
                attachStore.attach(context, noteId, uri)
                attachments = attachStore.forNote(noteId)
            }
        }
    }

    fun save() {
        if (store.get(noteId) != null) store.update(noteId, title = title.text, content = content.text)
    }

    // Autosave with the configured delay, like the desktop editor.
    LaunchedEffect(title.text, content.text) {
        delay(settings.autosaveDelay.toLong())
        save()
    }

    Column(Modifier.fillMaxSize().background(sh.ink).statusBarsPadding().imePadding()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { save(); onClose() }) { Icon(Icons.Filled.ArrowBack, "back", tint = sh.text1) }
            Column(Modifier.weight(1f)) {
                Text(fmt.format(Date(note.updatedAt)), color = sh.text2, fontSize = 11.sp)
            }
            IconButton(onClick = { save(); starred = !starred; store.toggleStar(noteId); onMutate() }) {
                Icon(Icons.Filled.Star, "star", tint = if (starred) sh.accent else sh.text2)
            }
            IconButton(onClick = {
                pickMedia.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
            }) { Icon(PaperclipIcon, "attach", tint = sh.text2) }
            IconButton(onClick = { preview = !preview }) {
                Icon(if (preview) Icons.Filled.Edit else EyeIcon, "toggle preview", tint = if (preview) sh.accent else sh.text2)
            }
        }
        if (preview) {
            Column(
                Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 8.dp),
            ) {
                if (title.text.isNotBlank()) {
                    Text(title.text, color = sh.text1, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(10.dp))
                }
                if (content.text.isBlank()) {
                    Text("Nothing to preview", color = sh.text2, fontSize = 15.sp)
                } else {
                    Text(
                        content.text, color = sh.text1,
                        fontSize = settings.editorFontSize.sp, lineHeight = (settings.editorFontSize * 1.5f).sp,
                    )
                }
                Spacer(Modifier.height(120.dp))
            }
        } else {
            BasicTextField(
                value = title, onValueChange = { title = it }, singleLine = true,
                textStyle = TextStyle(color = sh.text1, fontSize = 24.sp, fontWeight = FontWeight.Bold),
                cursorBrush = SolidColor(sh.accent),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
            )
            Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
                BasicTextField(
                    value = content, onValueChange = { content = it },
                    textStyle = TextStyle(color = sh.text1, fontSize = settings.editorFontSize.sp, lineHeight = (settings.editorFontSize * 1.5f).sp),
                    cursorBrush = SolidColor(sh.accent),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
                    decorationBox = { inner ->
                        Column(Modifier.fillMaxSize()) {
                            if (content.text.isEmpty()) Text("Start writing...", color = sh.text2.copy(alpha = 0.6f), fontSize = settings.editorFontSize.sp)
                            inner()
                            AttachmentStrip(attachStore, attachments, noteId) { attachments = attachStore.forNote(noteId) }
                            Spacer(Modifier.height(120.dp))
                        }
                    },
                )
            }
        }
    }
}

/** Thumbnails + files row rendered inside a note; taps open the media. */
@Composable
private fun ColumnScope.AttachmentStrip(
    store: AttachmentStore,
    attachments: List<Attachment>,
    noteId: Long,
    onChanged: () -> Unit,
) {
    if (attachments.isEmpty()) return
    val sh = LocalShark.current
    val context = LocalContext.current
    Spacer(Modifier.height(12.dp))
    Row(
        Modifier.padding(horizontal = 20.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Attachments", color = sh.text2, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.weight(1f))
    }
    Spacer(Modifier.height(6.dp))
    attachments.chunked(4).forEach { row ->
        Row(Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            row.forEach { a ->
                Box(
                    Modifier.size(72.dp).clip(RoundedCornerShape(10.dp)).background(sh.surface2)
                        .clickable { openAttachment(context, store, a) },
                ) {
                    if (a.mime.startsWith("image/")) {
                        val bmp = remember(a.id, attachments) {
                            runCatching {
                                android.graphics.BitmapFactory.decodeFile(store.fileFor(a).path)
                                    ?.asImageBitmap()
                            }.getOrNull()
                        }
                        if (bmp != null) {
                            Image(bitmap = bmp, contentDescription = a.filename,
                                modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                        }
                    } else {
                        Column(Modifier.fillMaxSize().padding(6.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Filled.PlayArrow, null, tint = sh.accent, modifier = Modifier.size(22.dp))
                            Text(a.filename.substringAfterLast('.').take(4), color = sh.text2, fontSize = 9.sp, maxLines = 1)
                        }
                    }
                    Icon(
                        Icons.Filled.Close, "remove", tint = Color.White,
                        modifier = Modifier.align(Alignment.TopEnd).padding(2.dp).size(16.dp)
                            .clip(CircleShape).background(Color.Black.copy(alpha = 0.55f))
                            .clickable { store.remove(context, a.id); onChanged() },
                    )
                }
            }
        }
        Spacer(Modifier.height(10.dp))
    }
}

private fun openAttachment(context: android.content.Context, store: AttachmentStore, a: Attachment) {
    val uri = store.shareUri(context, a)
    val view = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
        setDataAndType(uri, if (a.mime.isBlank()) "*/*" else a.mime)
        addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    runCatching { context.startActivity(view) }.onFailure {
        // No handler for direct open; fall back to the system share sheet.
        runCatching {
            context.startActivity(android.content.Intent.createChooser(
                android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                    type = if (a.mime.isBlank()) "*/*" else a.mime
                    putExtra(android.content.Intent.EXTRA_STREAM, uri)
                    addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }, null))
        }
    }
}
