package ru.memo7.artel.ui.screens.projects

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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.TaskAlt
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import ru.memo7.artel.core.UiState
import ru.memo7.artel.core.network.ApiResult
import ru.memo7.artel.data.ArtelRepository
import ru.memo7.artel.data.api.CreateItemRequest
import ru.memo7.artel.data.api.WorkspaceItemDto
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.PillBadge
import ru.memo7.artel.ui.components.ScreenTitle
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.theme.ArtelShapes
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

data class ProjectDetailUiState(
    val items: List<WorkspaceItemDto> = emptyList(),
)

sealed interface CreateItemState {
    data object Idle : CreateItemState
    data object Busy : CreateItemState
    data class Failure(val message: String) : CreateItemState
    data object Done : CreateItemState
}

class ProjectDetailViewModel(
    private val repository: ArtelRepository,
    private val projectId: Long,
) : ViewModel() {

    private val _state = MutableStateFlow<UiState<ProjectDetailUiState>>(UiState.Loading)
    val state: StateFlow<UiState<ProjectDetailUiState>> = _state.asStateFlow()

    private val _createState = MutableStateFlow<CreateItemState>(CreateItemState.Idle)
    val createState: StateFlow<CreateItemState> = _createState.asStateFlow()

    /** Одноразовые сообщения для snackbar-хоста; канал не теряет повторы. */
    private val _messages = Channel<String>(Channel.BUFFERED)
    val messages = _messages.receiveAsFlow()

    /** Items with a pending toggle PATCH: повторный тап игнорируется до ответа. */
    private val pendingToggles = mutableSetOf<Long>()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            when (val result = repository.items(projectId)) {
                is ApiResult.Success -> _state.value = UiState.Success(ProjectDetailUiState(result.data.items))
                is ApiResult.Failure -> {
                    val message = result.error.message ?: "Ошибка"
                    // Экран с данными не роняем из-за транзиентного сбоя обновления.
                    if (_state.value is UiState.Success) {
                        _messages.send("Не удалось обновить: $message")
                    } else {
                        _state.value = UiState.Error(message)
                    }
                }
            }
        }
    }

    fun toggleDone(item: WorkspaceItemDto, done: Boolean) {
        // Guard: повторный тап, пока PATCH в полёте, игнорируем — иначе ответы
        // могут примениться не по порядку.
        synchronized(pendingToggles) {
            if (item.id in pendingToggles) return
            pendingToggles += item.id
        }
        // Optimistic update; on failure roll back and show the error, on
        // success re-read the list (сервер по умолчанию скрывает done).
        applyDone(item.id, done)
        viewModelScope.launch {
            try {
                when (val result = repository.setItemDone(item.id, done)) {
                    is ApiResult.Success -> refresh()
                    is ApiResult.Failure -> {
                        applyDone(item.id, !done)
                        _messages.send(result.error.message ?: "Не удалось обновить запись")
                    }
                }
            } finally {
                synchronized(pendingToggles) { pendingToggles -= item.id }
            }
        }
    }

    private fun applyDone(id: Long, done: Boolean) {
        val current = _state.value as? UiState.Success ?: return
        _state.value = current.copy(
            data = current.data.copy(
                items = current.data.items.map { if (it.id == id) it.copy(done = done) else it }
            )
        )
    }

    fun createItem(title: String, kind: String, body: String, url: String?, dueAt: String?) {
        if (_createState.value is CreateItemState.Busy) return
        _createState.value = CreateItemState.Busy
        viewModelScope.launch {
            _createState.value = when (
                val result = repository.createItem(
                    CreateItemRequest(
                        projectId = projectId,
                        title = title,
                        kind = kind,
                        body = body.ifBlank { null },
                        url = url?.takeIf { it.isNotBlank() },
                        dueAt = dueAt?.takeIf { it.isNotBlank() },
                    )
                )
            ) {
                is ApiResult.Success -> { refresh(); CreateItemState.Done }
                is ApiResult.Failure -> CreateItemState.Failure(result.error.message ?: "Не удалось создать запись")
            }
        }
    }

    fun resetCreateState() { _createState.value = CreateItemState.Idle }
}

private val ruDayFormat = DateTimeFormatter.ofPattern("d MMMM, EEEE", Locale("ru"))

internal fun parseApiDate(raw: String?): LocalDateTime? {
    if (raw.isNullOrBlank()) return null
    // ISO со смещением: «настенное» время берём как есть (паритет с web).
    runCatching { OffsetDateTime.parse(raw) }.getOrNull()?.let { return it.toLocalDateTime() }
    // ISO-local без зоны — как есть.
    runCatching { LocalDateTime.parse(raw) }.getOrNull()?.let { return it }
    // SQLite datetime('now') хранит UTC «yyyy-MM-dd HH:mm:ss» (пробел вместо
    // ISO 'T') — приводим момент к локальной зоне устройства.
    return runCatching {
        LocalDateTime.parse(raw.take(19).replace(' ', 'T'))
            .atOffset(ZoneOffset.UTC)
            .atZoneSameInstant(ZoneId.systemDefault())
            .toLocalDateTime()
    }.getOrNull()
}

internal fun formatRuDate(raw: String?): String =
    parseApiDate(raw)?.format(ruDayFormat) ?: raw.orEmpty()

/** Project workspace: items list with done toggles and item creation. */
@Composable
fun ProjectDetailScreen(container: AppContainer, projectId: Long, onBack: () -> Unit) {
    val vm: ProjectDetailViewModel = viewModel(
        key = "project-$projectId",
        factory = viewModelFactory { initializer { ProjectDetailViewModel(container.repository, projectId) } }
    )
    val state by vm.state.collectAsStateWithLifecycle()
    val createState by vm.createState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var showCreate by remember { mutableStateOf(false) }

    LaunchedEffect(createState) {
        if (createState is CreateItemState.Done) {
            showCreate = false
            vm.resetCreateState()
        }
    }

    LaunchedEffect(Unit) {
        vm.messages.collect { message ->
            snackbarHostState.showSnackbar(message = message, withDismissAction = true)
        }
    }

    Scaffold(
        containerColor = Color.Transparent,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showCreate = true },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                shape = ArtelShapes.chip,
            ) {
                Icon(Icons.Rounded.Add, contentDescription = "Новая запись")
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 8.dp, end = 20.dp, top = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Назад")
                }
                ScreenTitle("Проект", modifier = Modifier.weight(1f))
            }
            StateContainer(
                state = state,
                onRetry = vm::refresh,
                emptyCheck = { it.items.isEmpty() },
                emptyMessage = "Записей пока нет",
                emptyHint = "Добавьте заметку, задачу или ссылку",
            ) { data ->
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 96.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(data.items, key = { it.id }) { item ->
                        ItemRow(
                            item = item,
                            onToggle = { done -> vm.toggleDone(item, done) },
                            modifier = Modifier.animateItem(),
                        )
                    }
                }
            }
        }
    }

    if (showCreate) {
        CreateItemDialog(
            createState = createState,
            onDismiss = { showCreate = false; vm.resetCreateState() },
            onCreate = { title, kind, body, url, dueAt -> vm.createItem(title, kind, body, url, dueAt) },
        )
    }
}

@Composable
private fun ItemRow(item: WorkspaceItemDto, onToggle: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(ArtelShapes.tile)
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 6.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val accent = when (item.kind) {
            "task" -> MaterialTheme.colorScheme.secondary
            "link" -> MaterialTheme.colorScheme.primary
            else -> MaterialTheme.colorScheme.tertiary
        }
        Box(
            modifier = Modifier
                .size(width = 6.dp, height = 44.dp)
                .clip(ArtelShapes.chip)
                .background(accent)
        )
        Spacer(Modifier.width(6.dp))
        Checkbox(
            checked = item.done,
            onCheckedChange = onToggle,
            colors = CheckboxDefaults.colors(checkedColor = accent),
        )
        Column(Modifier.weight(1f)) {
            Text(
                item.title,
                style = MaterialTheme.typography.titleMedium,
                color = if (item.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onBackground,
            )
            if (item.body.isNotBlank()) {
                Text(
                    item.body,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                )
            }
            item.url?.let { url ->
                Text(
                    url,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    maxLines = 1,
                )
            }
            item.dueAt?.let { due ->
                PillBadge(text = "Срок: ${formatRuDate(due)}", tint = accent, modifier = Modifier.padding(top = 4.dp))
            }
        }
        Spacer(Modifier.width(8.dp))
        Icon(
            when (item.kind) {
                "task" -> Icons.Rounded.TaskAlt
                "link" -> Icons.Rounded.Link
                else -> Icons.Rounded.Description
            },
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
    }
}

@Composable
private fun CreateItemDialog(
    createState: CreateItemState,
    onDismiss: () -> Unit,
    onCreate: (title: String, kind: String, body: String, url: String?, dueAt: String?) -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var url by remember { mutableStateOf("") }
    var dueAt by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf("note") }

    AlertDialog(
        onDismissRequest = onDismiss,
        shape = ArtelShapes.card,
        containerColor = MaterialTheme.colorScheme.surface,
        title = { Text("Новая запись", style = MaterialTheme.typography.titleLarge) },
        text = {
            Column {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    listOf("note" to "Заметка", "task" to "Задача", "link" to "Ссылка").forEachIndexed { index, (value, label) ->
                        SegmentedButton(
                            selected = kind == value,
                            onClick = { kind = value },
                            shape = SegmentedButtonDefaults.itemShape(index = index, count = 3),
                        ) { Text(label, style = MaterialTheme.typography.labelMedium) }
                    }
                }
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Заголовок") },
                    singleLine = true,
                    shape = ArtelShapes.chip,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = body,
                    onValueChange = { body = it },
                    label = { Text("Описание (необязательно)") },
                    shape = ArtelShapes.chip,
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                )
                if (kind == "link") {
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = url,
                        onValueChange = { url = it },
                        label = { Text("URL") },
                        placeholder = { Text("https://…") },
                        singleLine = true,
                        shape = ArtelShapes.chip,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = dueAt,
                    onValueChange = { dueAt = it },
                    label = { Text("Срок (необязательно)") },
                    placeholder = { Text("2026-11-01T15:00") },
                    singleLine = true,
                    shape = ArtelShapes.chip,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (createState is CreateItemState.Failure) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        createState.message,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        },
        confirmButton = {
            val busy = createState is CreateItemState.Busy
            TextButton(
                enabled = !busy && title.isNotBlank(),
                onClick = { onCreate(title.trim(), kind, body.trim(), url.trim(), dueAt.trim()) },
            ) { Text(if (busy) "Сохраняем…" else "Создать") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Отмена") } },
    )
}
