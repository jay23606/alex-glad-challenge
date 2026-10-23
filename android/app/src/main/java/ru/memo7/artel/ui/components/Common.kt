package ru.memo7.artel.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import ru.memo7.artel.core.UiState
import ru.memo7.artel.ui.theme.ArtelShapes

/** Oversized screen header used across screens. */
@Composable
fun ScreenTitle(text: String, modifier: Modifier = Modifier, accentWord: String? = null) {
    Column(modifier = modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
        if (accentWord != null) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    text = accentWord,
                    style = MaterialTheme.typography.displayLarge,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(
                    text = " $text",
                    style = MaterialTheme.typography.displayLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        } else {
            Text(
                text = text,
                style = MaterialTheme.typography.displayLarge,
                color = MaterialTheme.colorScheme.onBackground,
            )
        }
    }
}

/** Animated press-down scale; share the [interactionSource] with the clickable. */
@Composable
fun rememberPressScale(
    interactionSource: InteractionSource,
    pressedScale: Float = 0.95f,
): Float {
    val isPressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (isPressed) pressedScale else 1f,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioMediumBouncy,
            stiffness = Spring.StiffnessMedium,
        ),
        label = "pressScale",
    )
    return scale
}

/**
 * Asymmetric bento tile: rounded 28dp block with a hairline border, optional
 * tint and a springy press-down feedback when clickable.
 */
@Composable
fun BentoCard(
    modifier: Modifier = Modifier,
    tint: Color? = null,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = ArtelShapes.card
    val styled = modifier
        .clip(shape)
        .background(tint ?: MaterialTheme.colorScheme.surface)
        .border(
            width = 1.dp,
            color = MaterialTheme.colorScheme.outline.copy(alpha = 0.45f),
            shape = shape,
        )
    if (onClick != null) {
        val interactionSource = remember { MutableInteractionSource() }
        val scale = rememberPressScale(interactionSource)
        Box(
            modifier = styled
                .graphicsLayer { scaleX = scale; scaleY = scale }
                .clickable(
                    interactionSource = interactionSource,
                    indication = LocalIndication.current,
                    onClick = onClick,
                ),
            contentAlignment = Alignment.TopStart,
        ) {
            Column(content = content)
        }
    } else {
        Column(modifier = styled, content = content)
    }
}

/** Section label with a small colored dot. */
@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier, dotColor: Color = MaterialTheme.colorScheme.secondary) {
    Row(modifier = modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(dotColor)
        )
        Spacer(Modifier.size(8.dp))
        Text(text, style = MaterialTheme.typography.titleMedium)
    }
}

/** Small pill badge. */
@Composable
fun PillBadge(text: String, tint: Color, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .clip(ArtelShapes.pill)
            .background(tint.copy(alpha = 0.16f))
            .padding(horizontal = 10.dp, vertical = 4.dp)
    ) {
        Text(text, style = MaterialTheme.typography.labelMedium, color = tint)
    }
}

/** Branded shimmer sweep drawn over skeleton blocks while content loads. */
@Composable
private fun shimmerBrush(): Brush {
    val transition = rememberInfiniteTransition(label = "shimmer")
    val translate by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1200f,
        animationSpec = infiniteRepeatable(tween(1100, easing = LinearEasing)),
        label = "shimmerTranslate",
    )
    val highlight = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.10f)
    return Brush.linearGradient(
        colors = listOf(Color.Transparent, highlight, Color.Transparent),
        start = Offset(translate - 400f, translate - 400f),
        end = Offset(translate, translate),
    )
}

@Composable
fun ShimmerBlock(width: Dp, height: Dp, modifier: Modifier = Modifier) {
    val shape = ArtelShapes.tile
    Box(
        modifier = modifier
            .size(width = width, height = height)
            .clip(shape)
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .background(shimmerBrush()),
    )
}

/** Full-area state: branded shimmer skeleton instead of a bare spinner. */
@Composable
fun LoadingBox(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxSize().padding(horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        ShimmerBlock(width = 180.dp, height = 20.dp)
        Spacer(Modifier.height(16.dp))
        ShimmerBlock(width = 280.dp, height = 120.dp)
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ShimmerBlock(width = 130.dp, height = 84.dp)
            ShimmerBlock(width = 130.dp, height = 84.dp)
        }
    }
}

/** Full-area state: error with retry. */
@Composable
fun ErrorBox(message: String, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Что-то сломалось", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(20.dp))
        Button(onClick = onRetry, shape = ArtelShapes.pill) {
            Text("Повторить")
        }
    }
}

/** Full-area state: empty data. */
@Composable
fun EmptyBox(message: String, modifier: Modifier = Modifier, hint: String? = null) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .size(56.dp)
                .clip(ArtelShapes.chip)
                .background(MaterialTheme.colorScheme.surfaceVariant)
        )
        Spacer(Modifier.height(16.dp))
        Text(message, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
        if (hint != null) {
            Spacer(Modifier.height(6.dp))
            Text(
                hint,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** AnimatedContent wrapper for loading/error/content transitions. */
@Composable
fun <T> StateContainer(
    state: UiState<T>,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
    emptyCheck: (T) -> Boolean = { false },
    emptyMessage: String = "Пока пусто",
    emptyHint: String? = null,
    content: @Composable (T) -> Unit,
) {
    AnimatedContent(
        targetState = state,
        modifier = modifier.fillMaxSize(),
        transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(160)) },
        contentKey = { it::class },
        label = "state",
    ) { current ->
        when (current) {
            is UiState.Loading -> LoadingBox()
            is UiState.Error -> ErrorBox(message = current.message, onRetry = onRetry)
            is UiState.Success ->
                if (emptyCheck(current.data)) {
                    EmptyBox(emptyMessage, hint = emptyHint)
                } else {
                    content(current.data)
                }
        }
    }
}
