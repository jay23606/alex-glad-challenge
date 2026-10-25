package ru.memo7.artel.ui.screens.todos

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextDecoration
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
import ru.memo7.artel.data.api.TodoDto
import ru.memo7.artel.data.api.TodosResponse
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.BentoCard
import ru.memo7.artel.ui.components.PillBadge
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.theme.ArtelShapes
import ru.memo7.artel.ui.theme.Berry

/** Повтор задачи в форме: NONE → разовая, остальные — значения API. */
enum class FormRecurring(val apiValue: String?) {
    NONE(null),
    DAILY("daily"),
    WEEKLY("weekly"),
    HOURLY("hourly"),
}

/** Форма добавления: текст ≤500, повтор, интервал 1–168 ч для hourly. */
data class TodoForm(
    val text: String = "",
    val recurring: FormRecurring = FormRecurring.NONE,
    val intervalHours: Int = 1,
) {
    val canSubmit: Boolean
        get() = canSubmitTodo(text, recurring.apiValue ?: "", intervalHours)
}

/** Чистая валидация формы: непустой текст ≤500; для hourly — интервал 1..168 ч. */
internal fun canSubmitTodo(text: String, recurring: String, intervalHours: Int): Boolean =
    text.isNotBlank() && text.length <= MAX_TEXT_LENGTH &&
        (recurring != FormRecurring.HOURLY.apiValue || intervalHours in 1..MAX_INTERVAL_HOURS)

class TodosViewModel(private val repository: ArtelRepository) : ViewModel() {

    private val _state = MutableStateFlow<UiState<TodosResponse>>(UiState.Loading)
    val state: StateFlow<UiState<TodosResponse>> = _state.asStateFlow()

    private val _form = MutableStateFlow(TodoForm())
    val form: StateFlow<TodoForm> = _form.asStateFlow()

    private val _formError = MutableStateFlow<String?>(null)
    val formError: StateFlow<String?> = _formError.asStateFlow()

    private val _actionError = MutableStateFlow<String?>(null)
    val actionError: StateFlow<String?> = _actionError.asStateFlow()

    private val _adding = MutableStateFlow(false)
    val adding: StateFlow<Boolean> = _adding.asStateFlow()

    init {
        repository.cachedTodos?.let { _state.value = UiState.Success(it) }
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            when (val result = repository.todos()) {
                is ApiResult.Success -> _state.value = UiState.Success(result.data)
                is ApiResult.Failure ->
                    if (_state.value !is UiState.Success) _state.value = UiState.Error(result.error.message ?: "Ошибка")
            }
        }
    }

    fun onTextChange(value: String) {
        _form.value = _form.value.copy(text = value.take(MAX_TEXT_LENGTH))
    }

    fun onRecurringChange(value: FormRecurring) {
        _form.value = _form.value.copy(recurring = value)
    }

    fun onIntervalChange(value: Int) {
        _form.value = _form.value.copy(intervalHours = value.coerceIn(1, 168))
    }

    fun add() {
        val current = _form.value
        if (_adding.value || !current.canSubmit) return
        _adding.value = true
        _formError.value = null
        viewModelScope.launch {
            when (val result = repository.addTodo(
                text = current.text,
                recurring = current.recurring.apiValue,
                intervalHours = if (current.recurring == FormRecurring.HOURLY) current.intervalHours else null,
            )) {
                is ApiResult.Success -> {
                    _form.value = TodoForm()
                    _adding.value = false
                    refresh()
                }
                is ApiResult.Failure -> {
                    _formError.value = result.error.message ?: "Не удалось добавить задачу"
                    _adding.value = false
                }
            }
        }
    }

    fun act(id: Long, action: String) {
        _actionError.value = null
        viewModelScope.launch {
            when (val result = repository.todoAction(id, action)) {
                is ApiResult.Success -> refresh()
                is ApiResult.Failure -> _actionError.value = result.error.message ?: "Не удалось обновить задачу"
            }
        }
    }
}

private const val MAX_TEXT_LENGTH = 500
private const val MAX_INTERVAL_HOURS = 168

/** Задачи: список, повтор, complete/dismiss/delete (parity /mcp/todos). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TodosScreen(container: AppContainer, onBack: () -> Unit) {
    val vm: TodosViewModel = viewModel(
        factory = viewModelFactory { initializer { TodosViewModel(container.repository) } }
    )
    val state by vm.state.collectAsStateWithLifecycle()
    val form by vm.form.collectAsStateWithLifecycle()
    val formError by vm.formError.collectAsStateWithLifecycle()
    val actionError by vm.actionError.collectAsStateWithLifecycle()
    val adding by vm.adding.collectAsStateWithLifecycle()

    var pendingDelete by remember { mutableStateOf<TodoDto?>(null) }
    pendingDelete?.let { todo ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            shape = ArtelShapes.card,
            containerColor = MaterialTheme.colorScheme.surface,
            title = { Text("Удалить задачу?") },
            text = { Text(todo.text) },
            confirmButton = {
                TextButton(onClick = {
                    vm.act(todo.id, "delete")
                    pendingDelete = null
                }) { Text("Удалить", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { pendingDelete = null }) { Text("Отмена") }
            },
        )
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 8.dp, end = 8.dp, top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Назад")
            }
            Column(Modifier.weight(1f)) {
                Text("Задачи", style = MaterialTheme.typography.displaySmall)
                Text(
                    "Повторяющиеся напоминания и разовые задачи",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = vm::refresh) {
                Icon(Icons.Rounded.Refresh, contentDescription = "Обновить")
            }
        }

        AddTodoForm(
            form = form,
            formError = formError,
            adding = adding,
            onTextChange = vm::onTextChange,
            onRecurringChange = vm::onRecurringChange,
            onIntervalChange = vm::onIntervalChange,
            onAdd = vm::add,
        )

        val error = actionError
        if (error != null) {
            BentoCard(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 6.dp),
            ) {
                Text(
                    error,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(14.dp),
                )
            }
        }

        StateContainer(
            state = state,
            onRetry = vm::refresh,
            modifier = Modifier.fillMaxSize(),
            emptyCheck = { it.todos.isEmpty() },
            emptyMessage = "Нет задач",
            emptyHint = "Добавьте первую задачу в форме выше",
        ) { data ->
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(data.todos, key = { it.id }) { todo ->
                    TodoRow(
                        todo = todo,
                        modifier = Modifier.animateItem(),
                        onComplete = { vm.act(todo.id, "complete") },
                        onDismiss = { vm.act(todo.id, "dismiss") },
                        onDelete = { pendingDelete = todo },
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AddTodoForm(
    form: TodoForm,
    formError: String?,
    adding: Boolean,
    onTextChange: (String) -> Unit,
    onRecurringChange: (FormRecurring) -> Unit,
    onIntervalChange: (Int) -> Unit,
    onAdd: () -> Unit,
) {
    BentoCard(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 6.dp),
    ) {
        Column(Modifier.padding(18.dp)) {
            OutlinedTextField(
                value = form.text,
                onValueChange = onTextChange,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Текст задачи") },
                placeholder = { Text("Текст задачи…") },
                singleLine = true,
                // Текст обрезается до MAX_TEXT_LENGTH в onTextChange, поэтому
                // состояние ошибки тут недостижимо — счётчик ниже показывает лимит.
            )
            Text(
                "${form.text.length}/$MAX_TEXT_LENGTH",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .align(Alignment.End)
                    .padding(top = 4.dp),
            )
            Text(
                "Повтор",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 10.dp),
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FormRecurring.entries.forEach { option ->
                    FilterChip(
                        selected = form.recurring == option,
                        onClick = { onRecurringChange(option) },
                        label = { Text(option.label) },
                    )
                }
            }
            if (form.recurring == FormRecurring.HOURLY) {
                Row(
                    modifier = Modifier.padding(top = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Каждые",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    IconButton(
                        onClick = { onIntervalChange(form.intervalHours - 1) },
                        enabled = form.intervalHours > 1,
                    ) {
                        Icon(Icons.Rounded.Remove, contentDescription = "Меньше")
                    }
                    Text("${form.intervalHours} ч", style = MaterialTheme.typography.titleMedium)
                    IconButton(
                        onClick = { onIntervalChange(form.intervalHours + 1) },
                        enabled = form.intervalHours < 168,
                    ) {
                        Icon(Icons.Rounded.Add, contentDescription = "Больше")
                    }
                }
            }
            if (formError != null) {
                Text(
                    formError,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
            Button(
                onClick = onAdd,
                enabled = !adding && form.canSubmit,
                shape = ArtelShapes.pill,
                modifier = Modifier
                    .align(Alignment.End)
                    .padding(top = 10.dp),
            ) {
                Text(if (adding) "Добавляем…" else "Добавить")
            }
        }
    }
}

@Composable
private fun TodoRow(
    todo: TodoDto,
    onComplete: () -> Unit,
    onDismiss: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val done = todo.status != "pending"
    BentoCard(modifier = modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    todo.text,
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onBackground,
                    textDecoration = if (done) TextDecoration.LineThrough else null,
                )
                recurringLabel(todo)?.let { badge ->
                    Text(
                        badge,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
                PillBadge(
                    text = statusLabel(todo.status),
                    tint = statusTint(todo.status),
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
            Row {
                IconButton(onClick = onComplete, enabled = todo.status != "done") {
                    Icon(Icons.Rounded.Check, contentDescription = "Выполнить", tint = MaterialTheme.colorScheme.secondary)
                }
                IconButton(onClick = onDismiss, enabled = todo.status != "dismissed") {
                    Icon(Icons.Rounded.Close, contentDescription = "Отменить", tint = MaterialTheme.colorScheme.primary)
                }
                IconButton(onClick = onDelete) {
                    Icon(Icons.Rounded.Delete, contentDescription = "Удалить", tint = Berry)
                }
            }
        }
    }
}

/** Русские подписи статуса. */
private fun statusLabel(status: String): String = when (status.lowercase()) {
    "done" -> "выполнена"
    "dismissed" -> "отклонена"
    else -> "ожидает"
}

@Composable
private fun statusTint(status: String): Color = when (status.lowercase()) {
    "done" -> MaterialTheme.colorScheme.secondary
    "dismissed" -> MaterialTheme.colorScheme.outline
    else -> MaterialTheme.colorScheme.primary
}

/** Бейдж повтора — логика recurringBadge с web /mcp/todos. */
private fun recurringLabel(todo: TodoDto): String? {
    if (todo.recurring == "daily") return "ежедневно"
    if (todo.recurring == "weekly") return "каждый ${weekDays[todo.dayOfWeek ?: 0]}"
    if (todo.recurring == "hourly") {
        return if (todo.intervalHours != null) "каждые ${todo.intervalHours}ч" else "ежечасно"
    }
    if (todo.scheduledAt != null) return "на ${todo.scheduledAt}"
    return null
}

// JS Date.getDay(): 0 = воскресенье.
private val weekDays = listOf("Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб")

/** Подписи опций повтора в форме. */
private val FormRecurring.label: String
    get() = when (this) {
        FormRecurring.NONE -> "Разово"
        FormRecurring.DAILY -> "Ежедневно"
        FormRecurring.WEEKLY -> "Еженедельно"
        FormRecurring.HOURLY -> "Каждый час"
    }
