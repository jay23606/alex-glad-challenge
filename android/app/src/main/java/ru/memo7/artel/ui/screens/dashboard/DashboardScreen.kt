package ru.memo7.artel.ui.screens.dashboard

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Chat
import androidx.compose.material.icons.rounded.Checklist
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.SupportAgent
import androidx.compose.material.icons.rounded.TaskAlt
import androidx.compose.material3.Button
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import ru.memo7.artel.core.UiState
import ru.memo7.artel.data.ArtelRepository
import ru.memo7.artel.data.api.BootstrapResponse
import ru.memo7.artel.data.api.GamificationDto
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.BentoCard
import ru.memo7.artel.ui.components.LevelRing
import ru.memo7.artel.ui.components.RingCaption
import ru.memo7.artel.ui.components.PillBadge
import ru.memo7.artel.ui.components.ScreenTitle
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.components.isCompactLayout
import ru.memo7.artel.ui.components.rememberPressScale
import ru.memo7.artel.ui.theme.ArtelShapes
import ru.memo7.artel.ui.theme.Cheese
import ru.memo7.artel.ui.theme.Tomato

class DashboardViewModel(private val repository: ArtelRepository) : ViewModel() {

    private val _state = MutableStateFlow<UiState<BootstrapResponse>>(UiState.Loading)
    val state: StateFlow<UiState<BootstrapResponse>> = _state.asStateFlow()

    init {
        repository.cachedBootstrap?.let { _state.value = UiState.Success(it) }
        refresh()
    }

    fun refresh() {
        _state.value = _state.value // keep painted cache while loading
        viewModelScope.launch {
            when (val result = repository.bootstrap()) {
                is ru.memo7.artel.core.network.ApiResult.Success ->
                    _state.value = UiState.Success(result.data)
                is ru.memo7.artel.core.network.ApiResult.Failure ->
                    if (_state.value !is UiState.Success) _state.value = UiState.Error(result.error.message ?: "Ошибка")
            }
        }
    }
}

/** Home: gamification bento, counts, quick access to notifications/support. */
@Composable
fun DashboardScreen(
    container: AppContainer,
    onOpenNotifications: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenSupport: () -> Unit,
    onOpenProjects: () -> Unit,
    onOpenGamification: () -> Unit,
    onOpenTodos: () -> Unit,
    onOpenChat: () -> Unit,
) {
    val vm: DashboardViewModel = viewModel(
        factory = viewModelFactory { initializer { DashboardViewModel(container.repository) } }
    )
    val state by vm.state.collectAsStateWithLifecycle()

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 8.dp, top = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "Артель",
                    style = MaterialTheme.typography.displayLarge,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(
                    "Рабочее пространство",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            val unread = (state as? UiState.Success)?.data?.notifications?.unread ?: 0
            IconButton(onClick = onOpenNotifications) {
                BadgedBox(badge = {
                    if (unread > 0) Badge(containerColor = MaterialTheme.colorScheme.secondary) {
                        Text(unread.toString(), color = MaterialTheme.colorScheme.onSecondary)
                    }
                }) {
                    Icon(Icons.Rounded.Notifications, contentDescription = "Уведомления")
                }
            }
            IconButton(onClick = onOpenSettings) {
                Icon(Icons.Rounded.Settings, contentDescription = "Настройки")
            }
        }

        StateContainer(
            state = state,
            onRetry = vm::refresh,
            modifier = Modifier.fillMaxSize(),
        ) { data ->
            DashboardContent(
                data = data,
                onOpenNotifications = onOpenNotifications,
                onOpenSupport = onOpenSupport,
                onOpenProjects = onOpenProjects,
                onOpenGamification = onOpenGamification,
                onOpenTodos = onOpenTodos,
                onOpenChat = onOpenChat,
            )
        }
    }
}

@Composable
private fun DashboardContent(
    data: BootstrapResponse,
    onOpenNotifications: () -> Unit,
    onOpenSupport: () -> Unit,
    onOpenProjects: () -> Unit,
    onOpenGamification: () -> Unit,
    onOpenTodos: () -> Unit,
    onOpenChat: () -> Unit,
) {
    val game = data.gamification
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        // Asymmetric bento row: ring + streak
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .height(210.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            BentoCard(
                modifier = Modifier
                    .weight(1.45f)
                    .fillMaxSize(),
                tint = MaterialTheme.colorScheme.surface,
                onClick = onOpenGamification,
            ) {
                Box(Modifier.padding(16.dp)) {
                    LevelRing(
                        // levelProgress — уже доля 0..1 с сервера
                        progress = game.levelProgress.toFloat().coerceIn(0f, 1f),
                        modifier = Modifier.align(Alignment.Center),
                        size = 156.dp,
                    ) {
                        RingCaption(game.level, game.xp, game.nextLevelXp)
                    }
                }
            }
            BentoCard(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxSize(),
                tint = Color.Transparent,
            ) {
                val firePulse = rememberInfiniteTransition(label = "fire")
                val fireScale by firePulse.animateFloat(
                    initialValue = 1f,
                    targetValue = 1.18f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(650),
                        repeatMode = androidx.compose.animation.core.RepeatMode.Reverse,
                    ),
                    label = "fireScale",
                )
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(
                            brush = Brush.linearGradient(listOf(Tomato, Cheese)),
                            shape = ArtelShapes.hero,
                        )
                        .padding(16.dp)
                ) {
                    Column {
                        Text(
                            "🔥",
                            fontSize = 30.sp,
                            modifier = Modifier.graphicsLayer {
                                scaleX = fireScale
                                scaleY = fireScale
                            },
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            "${game.streak}",
                            style = MaterialTheme.typography.displayMedium,
                            color = Color(0xFF2A0E05),
                        )
                        Text(
                            "дней подряд · рекорд ${game.bestStreak}",
                            style = MaterialTheme.typography.labelMedium,
                            color = Color(0xFF2A0E05).copy(alpha = 0.75f),
                        )
                    }
                }
            }
        }

        // Counts row: projects / tasks / notifications
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            CountTile(
                modifier = Modifier.weight(1f),
                icon = Icons.Rounded.Folder,
                value = data.counts.projects,
                label = pluralRu(data.counts.projects, "проект", "проекта", "проектов"),
                tint = MaterialTheme.colorScheme.primary,
                onClick = onOpenProjects,
            )
            CountTile(
                modifier = Modifier.weight(1f),
                icon = Icons.Rounded.TaskAlt,
                value = data.counts.openTasks,
                label = pluralRu(data.counts.openTasks, "задача", "задачи", "задач"),
                tint = MaterialTheme.colorScheme.secondary,
                onClick = onOpenProjects,
            )
            CountTile(
                modifier = Modifier.weight(1f),
                icon = Icons.Rounded.Notifications,
                value = data.notifications.unread,
                label = pluralRu(data.notifications.unread, "новое", "новых", "новых"),
                tint = MaterialTheme.colorScheme.tertiary,
                onClick = onOpenNotifications,
            )
        }

        // Achievements
        if (game.achievements.isNotEmpty()) {
            Column {
                Text(
                    "Достижения",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    game.achievements.forEach { achievement ->
                        val tint = if (achievement.unlocked) {
                            MaterialTheme.colorScheme.secondary
                        } else {
                            MaterialTheme.colorScheme.surfaceVariant
                        }
                        val onTint = if (achievement.unlocked) {
                            MaterialTheme.colorScheme.onSecondary
                        } else {
                            MaterialTheme.colorScheme.onBackground
                        }
                        val interactionSource = remember { MutableInteractionSource() }
                        val scale = rememberPressScale(interactionSource, pressedScale = 0.92f)
                        Column(
                            modifier = Modifier
                                .graphicsLayer { scaleX = scale; scaleY = scale }
                                .clip(ArtelShapes.tile)
                                .background(tint)
                                .clickable(
                                    interactionSource = interactionSource,
                                    indication = LocalIndication.current,
                                    onClick = onOpenGamification,
                                )
                                .padding(horizontal = 14.dp, vertical = 10.dp)
                                .width(150.dp),
                        ) {
                            Text(
                                (if (achievement.unlocked) "🏆 " else "🔒 ") + achievement.title,
                                style = MaterialTheme.typography.titleMedium,
                                color = onTint,
                                maxLines = if (isCompactLayout()) 3 else 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                achievement.description,
                                style = MaterialTheme.typography.labelMedium,
                                color = onTint,
                                maxLines = 2,
                            )
                            PillBadge(
                                text = if (achievement.unlocked) "получено" else "в процессе",
                                tint = if (achievement.unlocked) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.background,
                                containerColor = if (achievement.unlocked) MaterialTheme.colorScheme.onSecondary else MaterialTheme.colorScheme.onBackground,
                                modifier = Modifier.padding(top = 6.dp),
                            )
                        }
                    }
                }
            }
        }

        // Chat quick action
        BentoCard(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
            onClick = onOpenChat,
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(18.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.AutoMirrored.Rounded.Chat,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.tertiary,
                )
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Чат", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Диалоги с LLM рабочей области — те же сессии, что на сайте",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Button(onClick = onOpenChat, shape = ArtelShapes.pill) {
                    Text("Открыть", fontWeight = FontWeight.SemiBold)
                }
            }
        }

        // Todos quick action
        BentoCard(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
            onClick = onOpenTodos,
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(18.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Rounded.Checklist,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                )
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Задачи", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Повторяющиеся напоминания и разовые задачи",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Button(onClick = onOpenTodos, shape = ArtelShapes.pill) {
                    Text("Открыть", fontWeight = FontWeight.SemiBold)
                }
            }
        }

        // Support quick action
        BentoCard(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
            onClick = onOpenSupport,
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(18.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Rounded.SupportAgent,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.secondary,
                )
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Нужна помощь?", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "База знаний и обращения в поддержку",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Button(onClick = onOpenSupport, shape = ArtelShapes.pill) {
                    Text("Открыть", fontWeight = FontWeight.SemiBold)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}

/** Русское множественное число: 1 проект / 2 проекта / 5 проектов; 11–14 → many. */
internal fun pluralRu(n: Int, one: String, few: String, many: String): String {
    val mod100 = n % 100
    return when {
        mod100 in 11..14 -> many
        mod100 % 10 == 1 -> one
        mod100 % 10 in 2..4 -> few
        else -> many
    }
}

@Composable
private fun CountTile(
    modifier: Modifier,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    value: Int,
    label: String,
    tint: Color,
    onClick: () -> Unit,
) {
    // Компактный экран/крупный шрифт: выше и две строки подписи, чтобы «2 проекта» влезало целиком (#128).
    // 142dp = 28 padding + 34 иконка + 39 значение + 39 две строки (все lineHeight ×1.3) + 2dp запас.
    val compact = isCompactLayout()
    BentoCard(modifier = modifier.height(if (compact) 142.dp else 120.dp), onClick = onClick) {
        Column(Modifier.padding(14.dp)) {
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(ArtelShapes.chip)
                    .background(tint.copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.weight(1f))
            Text(
                value.toString(),
                style = MaterialTheme.typography.displaySmall,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Text(
                label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = if (compact) 2 else 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
