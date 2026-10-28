package ru.memo7.artel.ui.screens.course

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
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
import ru.memo7.artel.data.api.CourseLessonDto
import ru.memo7.artel.data.api.CourseLessonsResponse
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.BentoCard
import ru.memo7.artel.ui.components.PillBadge
import ru.memo7.artel.ui.components.ScreenTitle
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.theme.ArtelShapes
import ru.memo7.artel.ui.theme.Cheese
import ru.memo7.artel.ui.theme.Tomato

class CourseViewModel(private val repository: ArtelRepository) : ViewModel() {

    private val _state = MutableStateFlow<UiState<CourseLessonsResponse>>(UiState.Loading)
    val state: StateFlow<UiState<CourseLessonsResponse>> = _state.asStateFlow()

    init {
        repository.cachedCourseLessons?.let { _state.value = UiState.Success(it) }
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            when (val result = repository.courseLessons()) {
                is ApiResult.Success -> _state.value = UiState.Success(result.data)
                is ApiResult.Failure ->
                    if (_state.value !is UiState.Success) _state.value = UiState.Error(result.error.message ?: "Ошибка")
            }
        }
    }
}

/** Бейдж и длительность урока. */
internal fun lessonBadge(lesson: CourseLessonDto): Pair<String, Boolean> =
    if (lesson.kind == "intro") "вступление" to true else "неделя ${lesson.weekNo ?: "?"}" to false

internal fun formatDuration(ms: Long): String {
    if (ms <= 0) return ""
    val totalMin = ((ms + 59_999) / 60_000).toInt()
    val h = totalMin / 60
    val m = totalMin % 60
    return if (h > 0) "$h ч $m мин" else "$m мин"
}

/** Course list: уроки I2N Challenge с summary и болью. */
@Composable
fun CourseScreen(
    container: AppContainer,
    onOpenLesson: (String) -> Unit,
    onBack: () -> Unit,
) {
    val vm: CourseViewModel = viewModel(
        factory = viewModelFactory { initializer { CourseViewModel(container.repository) } }
    )
    val state by vm.state.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Назад")
            }
            Spacer(Modifier.width(4.dp))
            Text("Курс", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            IconButton(onClick = vm::refresh) {
                Icon(Icons.Rounded.Refresh, contentDescription = "Обновить")
            }
        }
        StateContainer(
            state = state,
            onRetry = vm::refresh,
            emptyCheck = { it.lessons.isEmpty() },
            emptyMessage = "Уроки не найдены",
            emptyHint = "Импортируйте транскрипции на сервере: course-import",
        ) { data ->
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item { ScreenTitle("I2N #8", accentWord = "поток 6 ·") }
                items(data.lessons, key = { it.slug }) { lesson ->
                    LessonCard(lesson = lesson, onClick = { onOpenLesson(lesson.slug) })
                }
            }
        }
    }
}

@Composable
private fun LessonCard(lesson: CourseLessonDto, onClick: () -> Unit) {
    val (badge, isIntro) = lessonBadge(lesson)
    BentoCard(modifier = Modifier.fillMaxWidth(), onClick = onClick) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                PillBadge(text = badge, tint = if (isIntro) Tomato else Cheese)
                val duration = formatDuration(lesson.durationMs)
                if (duration.isNotEmpty()) {
                    Spacer(Modifier.width(8.dp))
                    Text(
                        duration,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(lesson.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (lesson.summary.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    lesson.summary,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (lesson.pain.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    "Боль: ${lesson.pain}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
