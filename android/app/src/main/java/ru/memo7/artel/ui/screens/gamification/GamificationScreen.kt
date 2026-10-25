package ru.memo7.artel.ui.screens.gamification

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
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
import ru.memo7.artel.core.network.ApiResult
import ru.memo7.artel.data.ArtelRepository
import ru.memo7.artel.data.api.AchievementDto
import ru.memo7.artel.data.api.GamificationEventDto
import ru.memo7.artel.data.api.GamificationResponse
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.BentoCard
import ru.memo7.artel.ui.components.LevelRing
import ru.memo7.artel.ui.components.PillBadge
import ru.memo7.artel.ui.components.RingCaption
import ru.memo7.artel.ui.components.SectionTitle
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.screens.projects.parseApiDate
import ru.memo7.artel.ui.theme.ArtelShapes
import ru.memo7.artel.ui.theme.Cheese
import ru.memo7.artel.ui.theme.Tomato
import java.time.format.DateTimeFormatter
import java.util.Locale

class GamificationViewModel(private val repository: ArtelRepository) : ViewModel() {

    private val _state = MutableStateFlow<UiState<GamificationResponse>>(UiState.Loading)
    val state: StateFlow<UiState<GamificationResponse>> = _state.asStateFlow()

    init {
        repository.cachedGamification?.let { _state.value = UiState.Success(it) }
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            when (val result = repository.gamification()) {
                is ApiResult.Success -> _state.value = UiState.Success(result.data)
                is ApiResult.Failure ->
                    if (_state.value !is UiState.Success) _state.value = UiState.Error(result.error.message ?: "Ошибка")
            }
        }
    }
}

/** Геймификация: XP/уровень/серия, достижения и журнал очков (parity /gamification). */
@Composable
fun GamificationScreen(container: AppContainer, onBack: () -> Unit) {
    val vm: GamificationViewModel = viewModel(
        factory = viewModelFactory { initializer { GamificationViewModel(container.repository) } }
    )
    val state by vm.state.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 8.dp, end = 16.dp, top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Назад")
            }
            Column(Modifier.weight(1f)) {
                Text("Геймификация", style = MaterialTheme.typography.displaySmall)
                Text(
                    "Очки за действия, уровни и серии",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        StateContainer(
            state = state,
            onRetry = vm::refresh,
            modifier = Modifier.fillMaxSize(),
        ) { data ->
            GamificationContent(data)
        }
    }
}

@Composable
private fun GamificationContent(data: GamificationResponse) {
    val stats = data.stats
    val unlocked = data.achievements.count { it.unlocked }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        // Статы: кольцо уровня + серия — как на дашборде.
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
            ) {
                Box(Modifier.padding(16.dp)) {
                    LevelRing(
                        // levelProgress — доля 0..1 с сервера
                        progress = stats.levelProgress.toFloat().coerceIn(0f, 1f),
                        modifier = Modifier.align(Alignment.Center),
                        size = 156.dp,
                    ) {
                        RingCaption(stats.level, stats.xp, stats.nextLevelXp)
                    }
                }
            }
            BentoCard(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxSize(),
                tint = Color.Transparent,
            ) {
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
                        Text("🔥", fontSize = 30.sp)
                        Spacer(Modifier.weight(1f))
                        Text(
                            "${stats.streak}",
                            style = MaterialTheme.typography.displayMedium,
                            color = Color(0xFF2A0E05),
                        )
                        Text(
                            "дней подряд · рекорд ${stats.bestStreak}",
                            style = MaterialTheme.typography.labelMedium,
                            color = Color(0xFF2A0E05).copy(alpha = 0.75f),
                        )
                    }
                }
            }
        }

        // Достижения
        SectionTitle(
            "Достижения · $unlocked из ${data.achievements.size}",
            dotColor = MaterialTheme.colorScheme.secondary,
        )
        if (data.achievements.isEmpty()) {
            BentoCard(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
                Text(
                    "Достижений пока нет — действия открывают их автоматически.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(18.dp),
                )
            }
        } else {
            Column(
                modifier = Modifier.padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                data.achievements.forEach { achievement ->
                    AchievementRow(achievement)
                }
            }
        }

        // Журнал очков
        SectionTitle("Журнал очков")
        if (data.events.isEmpty()) {
            BentoCard(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
                Text(
                    "Действий пока нет.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(18.dp),
                )
            }
        } else {
            BentoCard(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
                Column(Modifier.padding(horizontal = 18.dp, vertical = 12.dp)) {
                    data.events.forEachIndexed { index, event ->
                        EventRow(event)
                        if (index < data.events.lastIndex) {
                            Spacer(Modifier.height(10.dp))
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun AchievementRow(achievement: AchievementDto, modifier: Modifier = Modifier) {
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
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(ArtelShapes.tile)
            .background(tint.copy(alpha = if (achievement.unlocked) 1f else 0.5f))
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                (if (achievement.unlocked) "🏆 " else "🔒 ") + achievement.title,
                style = MaterialTheme.typography.titleMedium,
                color = onTint,
            )
            Text(
                achievement.description,
                style = MaterialTheme.typography.labelMedium,
                color = onTint,
            )
        }
        PillBadge(
            text = if (achievement.unlocked) "получено" else "в процессе",
            tint = if (achievement.unlocked) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.background,
            containerColor = if (achievement.unlocked) MaterialTheme.colorScheme.onSecondary else MaterialTheme.colorScheme.onBackground,
        )
    }
}

@Composable
private fun EventRow(event: GamificationEventDto, modifier: Modifier = Modifier) {
    Row(modifier = modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(eventLabel(event.type), style = MaterialTheme.typography.bodyMedium)
            Text(
                formatEventDate(event.createdAt),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            "+${event.points}",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.secondary,
        )
    }
}

/** Русские подписи типов XP-событий — как EVENT_LABEL на web /gamification. */
internal fun eventLabel(type: String): String = when (type) {
    "post_published" -> "Публикация поста"
    "todo_completed" -> "Задача выполнена"
    "workspace_item" -> "Элемент проекта"
    "automation_run" -> "Прогон автоматизации"
    "assistant_used" -> "Обращение к ассистенту"
    "support_ticket" -> "Обращение в поддержку"
    "tg_game_win" -> "XP за игру: победа"
    "tg_game_play" -> "XP за игру: участие"
    else -> type
}

private val journalDateFormat = DateTimeFormatter.ofPattern("d MMMM yyyy, HH:mm", Locale("ru"))

/** Дата события журнала — через общий parseApiDate; неразбираемое показываем как есть. */
internal fun formatEventDate(raw: String?): String {
    if (raw.isNullOrBlank()) return ""
    return parseApiDate(raw)?.format(journalDateFormat) ?: raw
}
