package ru.memo7.artel.ui.screens.calendar

import android.content.ClipData
import android.content.Context
import android.content.Intent
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
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ru.memo7.artel.core.UiState
import ru.memo7.artel.core.network.ApiResult
import ru.memo7.artel.data.ArtelRepository
import ru.memo7.artel.data.api.CalendarEventDto
import ru.memo7.artel.data.api.CalendarResponse
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.PillBadge
import ru.memo7.artel.ui.components.ScreenTitle
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.screens.projects.parseApiDate
import ru.memo7.artel.ui.theme.ArtelShapes
import java.io.File
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Горизонт экспорта .ics — тот же, что у GET /api/calendar по умолчанию. */
private const val ICS_EXPORT_DAYS = 30

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

    private val _exporting = MutableStateFlow(false)
    val exporting: StateFlow<Boolean> = _exporting.asStateFlow()

    /** Готовый к шэрингу файл; UI расходует его после ACTION_SEND. */
    private val _shareFile = MutableStateFlow<File?>(null)
    val shareFile: StateFlow<File?> = _shareFile.asStateFlow()

    /** Одноразовые сообщения для snackbar-хоста; канал не теряет повторы. */
    private val _messages = Channel<String>(Channel.BUFFERED)
    val messages = _messages.receiveAsFlow()

    init {
        repository.cachedCalendar?.let { cached -> _state.value = UiState.Success(cached.toUi()) }
        refresh()
    }

    /** Локальный refresh: GET /api/calendar, к Google sync отношения не имеет. */
    fun refresh() {
        viewModelScope.launch {
            when (val result = repository.calendar()) {
                is ApiResult.Success -> _state.value = UiState.Success(result.data.toUi())
                is ApiResult.Failure ->
                    if (_state.value is UiState.Success) {
                        _messages.send("Не удалось обновить: ${result.error.message ?: "нет соединения"}")
                    } else {
                        _state.value = UiState.Error(result.error.message ?: "Ошибка")
                    }
            }
        }
    }

    /** Google sync: POST /api/calendar/sync; разрешён только при настроенном Google. */
    fun syncWithGoogle() {
        if (_syncing.value) return
        val googleConfigured = (_state.value as? UiState.Success)?.data?.googleConfigured == true
        if (!googleConfigured) return
        _syncing.value = true
        viewModelScope.launch {
            _messages.send(
                when (val result = repository.syncCalendar()) {
                    is ApiResult.Success -> "Синхронизировано событий: ${result.data.synced}"
                    is ApiResult.Failure -> "Синхронизация не удалась: ${result.error.message ?: "нет соединения"}"
                }
            )
            _syncing.value = false
            refresh()
        }
    }

    /**
     * Экспорт .ics: скачивает календарь и пишет файл в cache/exports. Токен
     * остаётся внутри репозитория — в URI, имени файла и сообщениях его нет.
     */
    fun exportIcs(cacheDir: File) {
        if (_exporting.value) return
        _exporting.value = true
        viewModelScope.launch {
            val message = when (val result = repository.downloadCalendarIcs(ICS_EXPORT_DAYS)) {
                is ApiResult.Success -> withContext(Dispatchers.IO) {
                    try {
                        val file = writeIcsFile(cacheDir, result.data)
                        _shareFile.value = file
                        "Экспорт готов: ${file.name}"
                    } catch (e: Exception) {
                        "Не удалось сохранить файл: ${e.message ?: "ошибка записи"}"
                    }
                }
                is ApiResult.Failure -> "Не удалось экспортировать календарь: ${result.error.message ?: "нет соединения"}"
            }
            _messages.send(message)
            _exporting.value = false
        }
    }

    fun consumeShareFile() { _shareFile.value = null }

    /** ACTION_SEND не открылся (нет приложения для .ics) — сообщаем вместо «готово». */
    fun shareFailed() {
        viewModelScope.launch {
            _messages.send("Не удалось открыть экспорт: нет приложения для .ics")
        }
    }

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

/** Пишет байты .ics в cacheDir/exports/artel-<date>.ics и подчищает прошлые экспорты. */
private fun writeIcsFile(cacheDir: File, bytes: ByteArray): File {
    val dir = File(cacheDir, "exports").apply { mkdirs() }
    val file = File(dir, "artel-${LocalDate.now()}.ics")
    // Старые выгрузки не копим: оставляем только текущий файл (в имени нет токена).
    dir.listFiles { f -> f.name.startsWith("artel-") && f.name.endsWith(".ics") && f != file }
        ?.forEach { it.delete() }
    file.writeBytes(bytes)
    return file
}

/** Отдаёт файл через FileProvider + ACTION_SEND; false — если шэринг не открылся. */
private fun shareIcsFile(context: Context, file: File): Boolean {
    val uri = runCatching {
        FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    }.getOrNull() ?: return false
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/calendar"
        putExtra(Intent.EXTRA_STREAM, uri)
        clipData = ClipData.newRawUri(file.name, uri)
        flags = Intent.FLAG_GRANT_READ_URI_PERMISSION
    }
    return runCatching { context.startActivity(Intent.createChooser(send, "Экспорт календаря")) }
        .isSuccess
}

/** Calendar: events grouped by day, local refresh, Google sync and .ics export. */
@Composable
fun CalendarScreen(container: AppContainer) {
    val vm: CalendarViewModel = viewModel(
        factory = viewModelFactory { initializer { CalendarViewModel(container.repository) } }
    )
    val state by vm.state.collectAsStateWithLifecycle()
    val syncing by vm.syncing.collectAsStateWithLifecycle()
    val exporting by vm.exporting.collectAsStateWithLifecycle()
    val shareFile by vm.shareFile.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(Unit) {
        vm.messages.collect { message ->
            snackbarHostState.showSnackbar(message = message, withDismissAction = true)
        }
    }
    LaunchedEffect(shareFile) {
        val file = shareFile ?: return@LaunchedEffect
        if (!shareIcsFile(context, file)) vm.shareFailed()
        vm.consumeShareFile()
    }

    Scaffold(
        containerColor = Color.Transparent,
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 20.dp, end = 8.dp, top = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    ScreenTitle("Календарь")
                }
                IconButton(onClick = { vm.exportIcs(context.cacheDir) }, enabled = !exporting) {
                    if (exporting) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Rounded.Share, contentDescription = "Экспорт календаря (.ics)")
                    }
                }
                IconButton(onClick = vm::refresh) {
                    Icon(Icons.Rounded.Refresh, contentDescription = "Обновить список")
                }
            }
            val googleConfigured = (state as? UiState.Success)?.data?.googleConfigured ?: false
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 20.dp, end = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = if (googleConfigured) {
                        "Google Календарь подключён"
                    } else {
                        "Google не настроен на сервере — синхронизация недоступна"
                    },
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = vm::syncWithGoogle, enabled = googleConfigured && !syncing) {
                    Text(if (syncing) "Синхронизация…" else "Синхронизировать")
                }
            }
            StateContainer(
                state = state,
                onRetry = vm::refresh,
                emptyCheck = { it.groups.isEmpty() },
                emptyMessage = "Событий нет",
                emptyHint = "События берутся из задач и напоминаний; с подключённым Google добавятся после синхронизации",
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
}

@Composable
private fun EventCard(event: CalendarEventDto, modifier: Modifier = Modifier) {
    val sourceTint = when (event.source.lowercase()) {
        "workspace" -> MaterialTheme.colorScheme.primary
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
        PillBadge(text = sourceLabel(event.source), tint = sourceTint)
    }
}

/** Русские подписи источников; неизвестное показываем как есть. */
internal fun sourceLabel(source: String): String = when (source.lowercase()) {
    "workspace" -> "Задача"
    "todo" -> "Напоминание"
    else -> source
}
