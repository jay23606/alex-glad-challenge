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
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
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
import ru.memo7.artel.data.api.CourseLessonResponse
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.BentoCard
import ru.memo7.artel.ui.components.PillBadge
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.theme.ArtelShapes
import ru.memo7.artel.ui.theme.Cheese
import ru.memo7.artel.ui.theme.Tomato

class CourseDetailViewModel(
    private val repository: ArtelRepository,
    private val slug: String,
) : ViewModel() {

    private val _state = MutableStateFlow<UiState<CourseLessonResponse>>(UiState.Loading)
    val state: StateFlow<UiState<CourseLessonResponse>> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            when (val result = repository.courseLesson(slug)) {
                is ApiResult.Success -> _state.value = UiState.Success(result.data)
                is ApiResult.Failure ->
                    if (_state.value !is UiState.Success) _state.value = UiState.Error(result.error.message ?: "Ошибка")
            }
        }
    }
}

internal fun formatTs(ms: Long): String {
    val totalSec = ms / 1000
    val h = totalSec / 3600
    val m = (totalSec % 3600) / 60
    val s = totalSec % 60
    val mm = m.toString().padStart(2, '0')
    val ss = s.toString().padStart(2, '0')
    return if (h > 0) "$h:$mm:$ss" else "$mm:$ss"
}

/** Course detail: зачем/боль, ключевые выдержки и полная транскрипция по секциям. */
@Composable
fun CourseDetailScreen(
    container: AppContainer,
    slug: String,
    onBack: () -> Unit,
) {
    val vm: CourseDetailViewModel = viewModel(
        key = "course-detail-$slug",
        factory = viewModelFactory { initializer { CourseDetailViewModel(container.repository, slug) } }
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
            Text("Урок", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            IconButton(onClick = vm::refresh) {
                Icon(Icons.Rounded.Refresh, contentDescription = "Обновить")
            }
        }
        StateContainer(state = state, onRetry = vm::refresh) { data ->
            val lesson = data.lesson
            val (badge, isIntro) = lessonBadge(lesson)
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
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
                }
                item {
                    Text(lesson.title, style = MaterialTheme.typography.headlineSmall)
                }
                if (lesson.summary.isNotEmpty() || lesson.why.isNotEmpty() || lesson.pain.isNotEmpty()) {
                    item {
                        BentoCard(modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(18.dp)) {
                                if (lesson.summary.isNotEmpty()) {
                                    Text(lesson.summary, style = MaterialTheme.typography.bodyMedium)
                                }
                                if (lesson.why.isNotEmpty()) {
                                    Spacer(Modifier.height(8.dp))
                                    Text("Зачем смотреть", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                                    Text(lesson.why, style = MaterialTheme.typography.bodyMedium)
                                }
                                if (lesson.pain.isNotEmpty()) {
                                    Spacer(Modifier.height(8.dp))
                                    Text("Какую боль закрывает", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                                    Text(lesson.pain, style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                    }
                }
                if (data.excerpts.isNotEmpty()) {
                    item {
                        Text(
                            "Ключевые выдержки · ${data.excerpts.size}",
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                    items(data.excerpts, key = { "ex-${it.idx}" }) { excerpt ->
                        BentoCard(modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(18.dp)) {
                                Text(
                                    "«${excerpt.quote}»",
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.Medium,
                                )
                                Spacer(Modifier.height(6.dp))
                                Text(
                                    excerpt.explanation,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
                if (data.sections.isNotEmpty()) {
                    item {
                        Text(
                            "Полная транскрипция · ${data.sections.size} секций",
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                    items(data.sections, key = { "sec-${it.idx}" }) { section ->
                        BentoCard(modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(18.dp)) {
                                Text(
                                    "${formatTs(section.startMs)} — ${formatTs(section.endMs)}",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.primary,
                                    fontStyle = FontStyle.Italic,
                                )
                                Spacer(Modifier.height(6.dp))
                                Text(section.text, style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                }
            }
        }
    }
}
