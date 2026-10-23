package ru.memo7.artel.ui.screens.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Event
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import ru.memo7.artel.data.api.CalendarEventDto
import ru.memo7.artel.data.api.CalendarResponse
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.PillBadge
import ru.memo7.artel.ui.components.ScreenTitle
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.theme.ArtelShapes
import ru.memo7.artel.ui.screens.projects.parseApiDate
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

data class DayGroup(val day: LocalDate, val events: List<CalendarEventDto>)

data class CalendarUiState(
    val groups: List<DayGroup> = emptyList(),
    val googleConfigured: Boolean = false,
)

class CalendarViewModel(private val repository: ArtelRepository) : ViewModel() {

    private val _state = MutableStateFlow<UiState<CalendarUiState>>(UiState.Loading)
    val state: StateFlow<UiState<CalendarUiState>> = _state.asStateFlow()

    private val _syncing = MutableStateFlow(false)
    val syncing: StateFlow<Boolean> = _syncing.asStateFlow()

    private val _snack = MutableStateFlow<String?>(null)
    val snack: StateFlow<String?> = _snack.asStateFlow()

    init {
        repository.cachedCalendar?.let { cached -> _state.value = UiState.Success(cached.toUi()) }
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            when (val result = repository.calendar()) {
                is ApiResult.Success -> _state.value = UiState.Success(result.data.toUi())
                is ApiResult.Failure ->
                    if (_state.value !is UiState.Success) _state.value = UiState.Error(result.error.message ?: "Ошибка")
            }
        }
    }

    fun sync() {
        if (_syncing.value) return
        _syncing.value = true
        viewModelScope.launch {
            _snack.value = when (val result = repository.syncCalendar()) {
                is ApiResult.Success -> "Синхронизировано событий: ${result.data.synced}"
                is ApiResult.Failure -> "Синхронизация не удалась: ${result.error.message}"
            }
            _syncing.value = false
            refresh()
        }
    }

    fun consumeSnack() { _snack.value = null }

    private fun CalendarResponse.toUi(): CalendarUiState {
        val groups = events
            .mapNotNull { event -> parseApiDate(event.start)?.toLocalDate()?.let { it to event } }
            .groupBy({ it.first }, { it.second })
            .toSortedMap()
            .map { (day, list) -> DayGroup(day, list.sortedBy { it.start }) }
        return CalendarUiState(
            groups = groups,
            googleConfigured = googleConfigured,
        )
    }
}

/** Calendar: events grouped by day with source badges and Google sync. */
@Composable
fun CalendarScreen(container: AppContainer) {
    val vm: CalendarViewModel = viewModel(
        factory = viewModelFactory { initializer { CalendarViewModel(container.repository) } }
    )
    val state by vm.state.collectAsStateWithLifecycle()
    val syncing by vm.syncing.collectAsStateWithLifecycle()
    val snack by vm.snack.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 8.dp, top = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                ScreenTitle("Календарь")
            }
            IconButton(onClick = vm::sync, enabled = !syncing) {
                Icon(Icons.Rounded.Refresh, contentDescription = "Синхронизировать с Google")
            }
        }
        val googleOk = (state as? UiState.Success)?.data?.googleConfigured ?: false
        Text(
            text = if (googleOk) "Google Календарь подключён" else "Google не настроен — показаны локальные события",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 20.dp),
        )
        snack?.let { message ->
            Text(
                message,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.secondary,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
            )
        }
        StateContainer(
            state = state,
            onRetry = vm::refresh,
            emptyCheck = { it.groups.isEmpty() },
            emptyMessage = "Событий нет",
            emptyHint = "Нажмите ↻, чтобы подтянуть события из Google",
        ) { data ->
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                data.groups.forEach { group ->
                    item(key = "day-${group.day}") {
                        Text(
                            group.day.format(DateTimeFormatter.ofPattern("d MMMM yyyy, EEEE", Locale("ru"))),
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(top = 10.dp, bottom = 2.dp),
                        )
                    }
                    items(group.events, key = { it.uid }) { event ->
                        EventCard(event, modifier = Modifier.animateItem())
                    }
                }
            }
        }
    }
}

@Composable
private fun EventCard(event: CalendarEventDto, modifier: Modifier = Modifier) {
    val sourceTint = when (event.source.lowercase()) {
        "google" -> MaterialTheme.colorScheme.primary
        else -> MaterialTheme.colorScheme.secondary
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(ArtelShapes.tile)
            .background(MaterialTheme.colorScheme.surface)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(42.dp)
                .clip(ArtelShapes.chip)
                .background(sourceTint.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Rounded.Event, contentDescription = null, tint = sourceTint, modifier = Modifier.size(22.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(event.title, style = MaterialTheme.typography.titleMedium)
            val time = parseApiDate(event.start)?.format(DateTimeFormatter.ofPattern("HH:mm")) ?: ""
            val endTime = event.end?.let { parseApiDate(it)?.format(DateTimeFormatter.ofPattern("HH:mm")) }
            Text(
                if (endTime != null) "$time – $endTime" else time,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (event.description.isNotBlank()) {
                Text(
                    event.description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                )
            }
        }
        PillBadge(text = event.source, tint = sourceTint)
    }
}
