package app.sharknote.mobile

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/** Obsidian-style [[wiki link]] target extraction, mirroring links.go. */
private val wikiLinkRE = Regex("""\[\[([^\[\]]+)\]\]""")

fun linkTargets(content: String): List<String> =
    wikiLinkRE.findAll(content).map { m ->
        m.groupValues[1]
            .substringBefore('|')   // alias
            .substringBefore('#')   // section anchor
            .trim()
    }.filter { it.isNotBlank() }.toList()

private data class GNode(val id: Long, val title: String, var x: Float, var y: Float)

/**
 * Force-directed note graph, the mobile counterpart of the desktop GraphView:
 * every note is a node, every resolved [[wiki link]] is an edge. Tapping a
 * node opens the note.
 */
@Composable
fun GraphScreen(store: NoteStore, dataVersion: Int, graphTheme: String, onOpen: (Long) -> Unit) {
    val sh = LocalShark.current
    val notes = remember(dataVersion) { store.all }
    val hue = GRAPH_THEMES.firstOrNull { it.first == graphTheme }?.second ?: 25f

    Box(Modifier.fillMaxSize().background(sh.ink)) {
        if (notes.size < 2) {
            Column(
                Modifier.fillMaxSize().statusBarsPadding().padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Icon(GraphIcon, null, tint = sh.text2, modifier = Modifier.size(44.dp))
                Spacer(Modifier.height(14.dp))
                Text("Your graph is waiting", color = sh.text1, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(6.dp))
                Text(
                    "Write [[links]] between notes and they will appear here as connected nodes.",
                    color = sh.text2, fontSize = 13.sp, textAlign = TextAlign.Center, lineHeight = 19.sp,
                )
            }
            return@Box
        }

        // Build nodes + edges once per note-set change.
        val nodes: List<GNode> = remember(notes) {
            val n = notes.size
            notes.mapIndexed { i, note ->
                val a = 2.0 * Math.PI * i / n
                GNode(note.id, note.title.ifBlank { "Untitled" }, cos(a).toFloat(), sin(a).toFloat())
            }
        }
        val titleToId = remember(notes) { notes.associate { it.title.lowercase() to it.id } }
        val edges: List<Pair<Int, Int>> = remember(notes) {
            val idx = notes.withIndex().associate { (i, nt) -> nt.id to i }
            notes.flatMap { src ->
                linkTargets(src.content).mapNotNull { t ->
                    val dst = titleToId[t.lowercase()]
                    if (dst != null && dst != src.id) Pair(idx[src.id]!!, idx[dst]!!) else null
                }
            }.distinct()
        }

        // Run the simulation a fixed number of ticks, then freeze.
        var tick by remember { mutableIntStateOf(0) }
        LaunchedEffect(notes) {
            tick = 0
            val kRep = 6.0f
            val kSpring = 0.06f
            val rest = 0.9f
            while (tick < 260) {
                val damp = 1f - tick / 260f
                for (i in nodes.indices) for (j in i + 1 until nodes.size) {
                    val a = nodes[i]; val b = nodes[j]
                    var dx = a.x - b.x; var dy = a.y - b.y
                    var d = hypot(dx, dy).coerceAtLeast(0.01f)
                    val f = kRep / (d * d) * damp
                    dx /= d; dy /= d
                    a.x += dx * f; a.y += dy * f
                    b.x -= dx * f; b.y -= dy * f
                }
                for ((s, t) in edges) {
                    val a = nodes[s]; val b = nodes[t]
                    var dx = b.x - a.x; var dy = b.y - a.y
                    val d = hypot(dx, dy).coerceAtLeast(0.01f)
                    val f = (d - rest) * kSpring * damp
                    dx /= d; dy /= d
                    a.x += dx * f; a.y += dy * f
                    b.x -= dx * f; b.y -= dy * f
                }
                // weak gravity toward the origin keeps unlinked nodes from drifting off
                for (nd in nodes) { nd.x -= nd.x * 0.02f * damp; nd.y -= nd.y * 0.02f * damp }
                tick++
                if (tick % 4 == 0) kotlinx.coroutines.delay(16)
            }
            // auto-fit: rescale so the outermost node sits inside the viewport
            val maxR = nodes.maxOf { hypot(it.x, it.y) }.coerceAtLeast(0.01f)
            val fit = 0.82f / maxR
            nodes.forEach { it.x *= fit; it.y *= fit }
        }

        val degree = remember(edges) { IntArray(nodes.size).also { de -> edges.forEach { (s, t) -> de[s]++; de[t]++ } } }
        val textMeasurer = rememberTextMeasurer()

        Canvas(
            Modifier.fillMaxSize().statusBarsPadding()
                .pointerInput(nodes) {
                    detectTapGestures { off ->
                        // map tap to normalized coords and open nearest node
                        val cx = size.width / 2f; val cy = size.height / 2f
                        val scale = minOf(cx, cy) * 0.62f
                        var best = -1; var bestD = Float.MAX_VALUE
                        nodes.forEachIndexed { i, nd ->
                            val px = cx + nd.x * scale; val py = cy + nd.y * scale
                            val d = hypot(off.x - px, off.y - py)
                            if (d < bestD) { bestD = d; best = i }
                        }
                        if (best >= 0 && bestD < 48f) onOpen(nodes[best].id)
                    }
                }
        ) {
            val cx = size.width / 2f; val cy = size.height / 2f
            val scale = minOf(cx, cy) * 0.62f
            val edgeColor = Color.hsv(hue, 0.75f, if (sh.isLight) 0.75f else 0.9f).copy(alpha = 0.45f)
            val nodeColor = Color.hsv(hue, 0.7f, if (sh.isLight) 0.8f else 1f)
            val hubColor = sh.accent

            edges.forEach { (s, t) ->
                drawLine(
                    edgeColor,
                    Offset(cx + nodes[s].x * scale, cy + nodes[s].y * scale),
                    Offset(cx + nodes[t].x * scale, cy + nodes[t].y * scale),
                    strokeWidth = 2f,
                )
            }
            nodes.forEachIndexed { i, nd ->
                val c = Offset(cx + nd.x * scale, cy + nd.y * scale)
                val r = 10f + degree[i] * 3f
                drawCircle(nodeColor.copy(alpha = 0.18f), radius = r + 8f, center = c)
                drawCircle(if (degree[i] > 0) hubColor else nodeColor, radius = r, center = c)
                // label under the node
                val layout = textMeasurer.measure(
                    text = nd.title,
                    style = androidx.compose.ui.text.TextStyle(color = sh.text2, fontSize = 12.sp),
                    maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    softWrap = false,
                )
                drawText(layout, topLeft = Offset(c.x - layout.size.width / 2f, c.y + r + 6f))
            }
        }

        Column(Modifier.fillMaxSize().statusBarsPadding().padding(top = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Graph", color = sh.text1, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text(
                "${notes.size} notes · ${edges.size} links · tap a node to open",
                color = sh.text2, fontSize = 12.sp,
            )
        }
    }
}
