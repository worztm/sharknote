package app.sharknote.mobile

import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/**
 * Custom nav icons drawn as vectors: the core material-icons set has no
 * notes/graph/eye glyphs, and pulling in material-icons-extended would bloat
 * the APK (minification is off). Notes is the Material "description" glyph;
 * graph and eye are hand-built.
 */
val NotesIcon: ImageVector by lazy {
    ImageVector.Builder(
        name = "Notes", defaultWidth = 24.dp, defaultHeight = 24.dp,
        viewportWidth = 24f, viewportHeight = 24f,
    ).apply {
        addPath(
            pathData = addPathNodes("M14,2L6,2c-1.1,0 -2,0.9 -2,2l0,16c0,1.1 0.9,2 2,2l12,0c1.1,0 2,-0.9 2,-2L20,8l-6,-6zM16,18L8,18v-2h8v2zM16,14L8,14v-2h8v2zM13,9L13,3.5L18.5,9L13,9z"),
            fill = SolidColor(androidx.compose.ui.graphics.Color.Black),
            pathFillType = PathFillType.NonZero,
        )
    }.build()
}

val GraphIcon: ImageVector by lazy {
    ImageVector.Builder(
        name = "Graph", defaultWidth = 24.dp, defaultHeight = 24.dp,
        viewportWidth = 24f, viewportHeight = 24f,
    ).apply {
        // edges first (stroked), nodes on top (filled)
        addPath(
            pathData = addPathNodes("M12,4.5 L5.5,17.5 M12,4.5 L18.5,17.5 M5.5,17.5 L18.5,17.5"),
            stroke = SolidColor(androidx.compose.ui.graphics.Color.Black),
            strokeLineWidth = 1.6f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
        addPath(
            pathData = addPathNodes(
                "M9.4,4.5a2.6,2.6 0 1,0 5.2,0a2.6,2.6 0 1,0 -5.2,0Z" +
                    "M2.9,17.5a2.6,2.6 0 1,0 5.2,0a2.6,2.6 0 1,0 -5.2,0Z" +
                    "M15.9,17.5a2.6,2.6 0 1,0 5.2,0a2.6,2.6 0 1,0 -5.2,0Z",
            ),
            fill = SolidColor(androidx.compose.ui.graphics.Color.Black),
            pathFillType = PathFillType.NonZero,
        )
    }.build()
}

val CrosshairIcon: ImageVector by lazy {
    ImageVector.Builder(
        name = "Crosshair", defaultWidth = 24.dp, defaultHeight = 24.dp,
        viewportWidth = 24f, viewportHeight = 24f,
    ).apply {
        addPath(
            pathData = addPathNodes("M12,2 L12,6 M12,18 L12,22 M2,12 L6,12 M18,12 L22,12"),
            stroke = SolidColor(androidx.compose.ui.graphics.Color.Black),
            strokeLineWidth = 1.8f,
            strokeLineCap = StrokeCap.Round,
        )
        addPath(
            pathData = addPathNodes("M7,12a5,5 0 1,0 10,0a5,5 0 1,0 -10,0Z"),
            stroke = SolidColor(androidx.compose.ui.graphics.Color.Black),
            strokeLineWidth = 1.8f,
        )
    }.build()
}

val EyeIcon: ImageVector by lazy {
    ImageVector.Builder(
        name = "Eye", defaultWidth = 24.dp, defaultHeight = 24.dp,
        viewportWidth = 24f, viewportHeight = 24f,
    ).apply {
        addPath(
            pathData = addPathNodes("M12,4.5C7,4.5 2.7,7.6 1,12c1.7,4.4 6,7.5 11,7.5s9.3,-3.1 11,-7.5c-1.7,-4.4 -6,-7.5 -11,-7.5zM12,17c-2.8,0 -5,-2.2 -5,-5s2.2,-5 5,-5 5,2.2 5,5 -2.2,5 -5,5zM12,9c-1.7,0 -3,1.3 -3,3s1.3,3 3,3 3,-1.3 3,-3 -1.3,-3 -3,-3z"),
            fill = SolidColor(androidx.compose.ui.graphics.Color.Black),
            pathFillType = PathFillType.NonZero,
        )
    }.build()
}
