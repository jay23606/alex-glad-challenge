package ru.memo7.artel.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.CornerBasedShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import ru.memo7.artel.data.ThemeMode

private val DarkColors = darkColorScheme(
    primary = Tomato,
    onPrimary = Color(0xFF2A0E05),
    primaryContainer = TomatoContainer,
    onPrimaryContainer = TomatoOnContainer,
    secondary = Basil,
    onSecondary = Color(0xFF12200A),
    secondaryContainer = BasilContainer,
    onSecondaryContainer = BasilOnContainer,
    tertiary = Cheese,
    onTertiary = Color(0xFF2A1A02),
    tertiaryContainer = CheeseContainer,
    onTertiaryContainer = CheeseOnContainer,
    error = Berry,
    onError = Color(0xFF2A0A10),
    background = OvenBg,
    onBackground = OvenOnBg,
    surface = OvenSurface,
    onSurface = OvenOnBg,
    surfaceVariant = OvenSurfaceHigh,
    onSurfaceVariant = OvenOnBgDim,
    surfaceContainer = OvenSurface,
    surfaceContainerHigh = OvenSurfaceHigh,
    surfaceContainerHighest = OvenSurfaceHigh,
    outline = OvenOutline,
    outlineVariant = OvenOutline,
)

private val LightColors = lightColorScheme(
    primary = TomatoDeep,
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = TomatoContainerLight,
    onPrimaryContainer = TomatoOnContainerLight,
    secondary = BasilDeep,
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = BasilContainerLight,
    onSecondaryContainer = BasilOnContainerLight,
    tertiary = CheeseDeep,
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = CheeseContainerLight,
    onTertiaryContainer = CheeseOnContainerLight,
    error = Color(0xFFC62F48),
    onError = Color(0xFFFFFFFF),
    background = PaperBg,
    onBackground = PaperOnBg,
    surface = PaperSurface,
    onSurface = PaperOnBg,
    surfaceVariant = PaperSurfaceHigh,
    onSurfaceVariant = PaperOnBgDim,
    surfaceContainer = PaperSurface,
    surfaceContainerHigh = PaperSurfaceHigh,
    surfaceContainerHighest = PaperSurfaceHigh,
    outline = PaperOutline,
    outlineVariant = PaperOutline,
)

/** Signature shape vocabulary: large rounded corners, deliberate asymmetry for heroes. */
object ArtelShapes {
    val card: CornerBasedShape = RoundedCornerShape(28.dp)
    val tile: CornerBasedShape = RoundedCornerShape(24.dp)
    val chip: CornerBasedShape = RoundedCornerShape(12.dp)
    val pill: CornerBasedShape = RoundedCornerShape(percent = 50)

    /** Asymmetric «кусок пиццы»: один угол резко меньше остальных. */
    val hero: CornerBasedShape = RoundedCornerShape(
        topStart = 32.dp, topEnd = 32.dp, bottomEnd = 32.dp, bottomStart = 12.dp,
    )
}

@Composable
fun ArtelTheme(themeMode: ThemeMode, content: @Composable () -> Unit) {
    val dark = when (themeMode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.DARK -> true
        ThemeMode.LIGHT -> false
    }
    MaterialTheme(
        colorScheme = if (dark) DarkColors else LightColors,
        typography = ArtelTypography,
        shapes = MaterialTheme.shapes.copy(
            small = ArtelShapes.chip,
            medium = ArtelShapes.tile,
            large = ArtelShapes.card,
            extraLarge = RoundedCornerShape(32.dp),
        ),
        content = content,
    )
}
