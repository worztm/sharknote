package app.sharknote.mobile

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.IconButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

/** Obsidian-style [[wiki link]] target extraction, mirroring links.go. */
private val wikiLinkRE = Regex("""\[\[([^\[\]]+)\]\]""")

fun linkTargets(content: String): List<String> =
    wikiLinkRE.findAll(content).map { m ->
        m.groupValues[1]
            .substringBefore('|')   // alias
            .substringBefore('#')   // section anchor
            .trim()
    }.filter { it.isNotBlank() }.toList()

/** A live body in the force simulation (d3-force style). */
private class SimNode(val id: Long, val title: String) {
    var x = 0f; var y = 0f
    var vx = 0f; var vy = 0f
    var fx: Float? = null; var fy: Float? = null   // pinned while dragging
    var degree = 0
}

/**
 * Interactive force-directed note graph: notes are nodes, resolved
 * [[wiki links]] are edges. Continuous physics (charge + link springs +
 * gravity), drag nodes to move them, drag empty space to pan, pinch to zoom,
 * tap a node to open the note.
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

        val nodes = remember(dataVersion) {
            notes.mapIndexed { i, n ->
                SimNode(n.id, n.title.ifBlank { "Untitled" }).apply {
                    val r = 40f * sqrt(i + 0.5f)
                    val a = (i + 0.5) * 2.399963  // golden angle, d3's phyllotaxis
                    x = r * cos(a).toFloat(); y = r * sin(a).toFloat()
                }
            }
        }
        val edges = remember(dataVersion) {
            val titleToId = notes.associate { it.title.lowercase() to it.id }
            val idx = notes.withIndex().associate { (i, nt) -> nt.id to i }
            notes.flatMap { src ->
                linkTargets(src.content).mapNotNull { t ->
                    val dst = titleToId[t.lowercase()]
                    if (dst != null && dst != src.id) Pair(idx[src.id]!!, idx[dst]!!) else null
                }
            }.distinct()
        }
        remember(dataVersion) {
            nodes.forEach { it.degree = 0 }
            edges.forEach { (s, t) -> nodes[s].degree++; nodes[t].degree++ }
        }

        var alpha by remember { mutableFloatStateOf(1f) }
        var frame by remember { mutableIntStateOf(0) }
        var scale by remember { mutableFloatStateOf(1f) }
        var pan by remember { mutableStateOf(Offset.Zero) }
        var dragging by remember { mutableStateOf(false) }
        var fitted by remember { mutableStateOf(false) }
        var canvasSize by remember { mutableStateOf(IntSize.Zero) }
        var lastTapMs by remember { mutableLongStateOf(0L) }
        var recenterTick by remember { mutableIntStateOf(0) }
        val textMeasurer = rememberTextMeasurer()

        LaunchedEffect(recenterTick) {
            // re-arm the tracking camera; it re-fits every frame until settled
            if (canvasSize.width > 0) { fitted = false; alpha = max(alpha, 0.3f) }
        }

        LaunchedEffect(dataVersion) { alpha = 1f; fitted = false }

        // Physics loop: runs while the simulation is hot or a node is held.
        LaunchedEffect(dataVersion) {
            while (true) {
                if (alpha > 0.004f || dragging) {
                    stepSim(nodes, edges, alpha)
                    alpha = if (dragging) max(alpha, 0.3f) else alpha * 0.985f
                    frame++
                    // camera tracks the graph until it settles, so a flung
                    // node springs back into frame instead of off-screen
                    if (!fitted && canvasSize.width > 0) {
                        fitToView(nodes, canvasSize) { s, p -> scale = s; pan = p }
                        if (alpha <= 0.05f && !dragging) fitted = true
                    }
                }
                delay(16)
            }
        }

        Canvas(
            Modifier.fillMaxSize().statusBarsPadding()
                .onSizeChanged { canvasSize = it }
                .pointerInput(dataVersion) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        val c = Offset(size.width / 2f, size.height / 2f)
                        fun toWorld(p: Offset) = (p - c - pan) / scale
                        fun radiusOf(n: SimNode) = (9f + n.degree * 2.5f) * scale
                        val hit = nodes.lastOrNull {
                            val s = Offset(c.x + it.x * scale + pan.x, c.y + it.y * scale + pan.y)
                            hypot(down.position.x - s.x, down.position.y - s.y) <= radiusOf(it) + 14f
                        }
                        var dragNode = hit
                        if (dragNode != null) {
                            dragging = true
                            dragNode.fx = toWorld(down.position).x
                            dragNode.fy = toWorld(down.position).y
                        }
                        var moved = false
                        var last = down.position
                        var lastCentroid = down.position
                        var lastSpan = 0f
                        while (true) {
                            val event = awaitPointerEvent()
                            val pressed = event.changes.filter { it.pressed }
                            if (pressed.isEmpty()) break
                            if (pressed.size >= 2) {
                                // pinch: zoom around the centroid + pan with it
                                dragNode?.let { it.fx = null; it.fy = null }; dragNode = null; dragging = false
                                val p0 = pressed[0].position; val p1 = pressed[1].position
                                val centroid = (p0 + p1) / 2f
                                val span = hypot(p1.x - p0.x, p1.y - p0.y)
                                if (lastSpan > 0f && span > 0f) {
                                    scale = (scale * span / lastSpan).coerceIn(0.3f, 5f)
                                    pan += centroid - lastCentroid
                                }
                                lastCentroid = centroid; lastSpan = span
                                moved = true
                            } else {
                                val ch = pressed.first()
                                val d = ch.position - last
                                if (hypot(d.x, d.y) > viewConfiguration.touchSlop * 0.5f) moved = true
                                last = ch.position
                                if (dragNode != null) {
                                    val w = toWorld(ch.position)
                                    dragNode.fx = w.x; dragNode.fy = w.y
                                    if (alpha < 0.3f) alpha = 0.3f
                                } else {
                                    pan = Offset(pan.x + d.x, pan.y + d.y)
                                }
                            }
                            pressed.forEach { it.consume() }
                        }
                        dragNode?.let { it.fx = null; it.fy = null }
                        dragging = false
                        if (!moved && hit != null) onOpen(hit.id)
                        if (!moved && hit == null) {
                            // double-tap empty space: re-fit the graph to the viewport
                            val now = System.currentTimeMillis()
                            if (now - lastTapMs < 500) recenterTick++
                            lastTapMs = now
                        }
                    }
                }
        ) {
            val _f = frame  // state read: redraw each physics tick
            val cx = size.width / 2f + pan.x
            val cy = size.height / 2f + pan.y
            val edgeColor = Color.hsv(hue, 0.75f, if (sh.isLight) 0.75f else 0.9f).copy(alpha = 0.5f)
            val nodeColor = Color.hsv(hue, 0.7f, if (sh.isLight) 0.8f else 1f)
            val hubColor = sh.accent

            edges.forEach { (s, t) ->
                drawLine(
                    edgeColor,
                    Offset(cx + nodes[s].x * scale, cy + nodes[s].y * scale),
                    Offset(cx + nodes[t].x * scale, cy + nodes[t].y * scale),
                    strokeWidth = 1.6f,
                )
            }
            nodes.forEach { nd ->
                val c = Offset(cx + nd.x * scale, cy + nd.y * scale)
                val r = 9f + nd.degree * 2.5f
                drawCircle(nodeColor.copy(alpha = 0.16f), radius = r + 9f, center = c)
                drawCircle(if (nd.degree > 0) hubColor else nodeColor, radius = r, center = c)
                val layout = textMeasurer.measure(
                    text = nd.title,
                    style = TextStyle(color = sh.text2, fontSize = 12.sp),
                    maxLines = 1, overflow = TextOverflow.Ellipsis, softWrap = false,
                )
                drawText(layout, topLeft = Offset(c.x - layout.size.width / 2f, c.y + r + 6f))
            }
        }

        Column(Modifier.fillMaxSize().statusBarsPadding().padding(top = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Graph", color = sh.text1, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text(
                "${notes.size} notes · ${edges.size} link${if (edges.size == 1) "" else "s"} · drag nodes, pinch zoom, tap nodes to open",
                color = sh.text2, fontSize = 11.sp,
            )
        }

        // Explicit recenter: frames the whole graph, no gesture timing needed.
        Surface(
            shape = CircleShape, color = sh.surface3,
            modifier = Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(end = 16.dp, bottom = 88.dp),
        ) {
            IconButton(onClick = { recenterTick++ }) {
                Icon(CrosshairIcon, "recenter", tint = sh.text1, modifier = Modifier.size(22.dp))
            }
        }
    }
}

/** One d3-style tick: charge repulsion, link springs, center gravity. */
private fun stepSim(nodes: List<SimNode>, edges: List<Pair<Int, Int>>, alpha: Float) {
    val repulsion = 2400f
    val linkDist = 120f
    val linkK = 0.08f
    val gravity = 0.04f
    for (i in nodes.indices) {
        val a = nodes[i]
        for (j in i + 1 until nodes.size) {
            val b = nodes[j]
            var dx = b.x - a.x; var dy = b.y - a.y
            var d2 = dx * dx + dy * dy
            if (d2 < 1f) {
                dx = Math.random().toFloat() - 0.5f; dy = Math.random().toFloat() - 0.5f
                d2 = dx * dx + dy * dy + 0.01f
            }
            val d = sqrt(d2)
            val f = repulsion * alpha / d2
            val fx = dx / d * f; val fy = dy / d * f
            a.vx -= fx; a.vy -= fy
            b.vx += fx; b.vy += fy
        }
    }
    for ((s, t) in edges) {
        val a = nodes[s]; val b = nodes[t]
        val dx = b.x - a.x; val dy = b.y - a.y
        val d = hypot(dx, dy).coerceAtLeast(1f)
        val f = (d - linkDist) * linkK * alpha
        val fx = dx / d * f; val fy = dy / d * f
        a.vx += fx; a.vy += fy
        b.vx -= fx; b.vy -= fy
    }
    for (n in nodes) {
        n.vx -= n.x * gravity * alpha
        n.vy -= n.y * gravity * alpha
        n.vx *= 0.6f; n.vy *= 0.6f
        val fx = n.fx; val fy = n.fy
        if (fx != null && fy != null) { n.x = fx; n.y = fy; n.vx = 0f; n.vy = 0f }
        else { n.x += n.vx; n.y += n.vy }
    }
}

/** Zoom/pan so the whole settled graph sits inside the viewport. */
private fun fitToView(
    nodes: List<SimNode>,
    size: IntSize,
    apply: (Float, Offset) -> Unit,
) {
    val minX = nodes.minOf { it.x }; val maxX = nodes.maxOf { it.x }
    val minY = nodes.minOf { it.y }; val maxY = nodes.maxOf { it.y }
    val bw = (maxX - minX).coerceAtLeast(1f) + 80f
    val bh = (maxY - minY).coerceAtLeast(1f) + 120f
    val s = minOf(size.width * 0.9f / bw, size.height * 0.75f / bh).coerceIn(0.15f, 2.2f)
    val bcx = (minX + maxX) / 2f; val bcy = (minY + maxY) / 2f
    apply(s, Offset(-bcx * s, -bcy * s))
}
