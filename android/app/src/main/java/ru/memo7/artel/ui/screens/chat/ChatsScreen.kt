package ru.memo7.artel.ui.screens.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.draw.clip
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
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.memo7.artel.core.UiState
import ru.memo7.artel.core.network.ApiResult
import ru.memo7.artel.data.ArtelRepository
import ru.memo7.artel.data.api.ChatSessionCreatedResponse
import ru.memo7.artel.data.api.ChatSessionListItemDto
import ru.memo7.artel.data.api.ChatSessionsResponse
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.ScreenTitle
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.theme.ArtelShapes

/** Ровно те стратегии, что поддерживает сервер (chatSessionCreateSchema.strategy). */
internal val CHAT_STRATEGY_OPTIONS = listOf(
    "full" to "Вся история",
    "sliding" to "Скользящее окно",
    "sticky" to "Стойкие факты",
    "branching" to "Ветвление",
)

internal fun strategyLabel(strategy: String): String =
    CHAT_STRATEGY_OPTIONS.firstOrNull { it.first == strategy }?.second ?: strategy

/** Шапка нового чата: как на сервере (создание по умолчанию full, memory off). */
internal fun canCreateChat(strategy: String, system: String?): Boolean =
    CHAT_STRATEGY_OPTIONS.any { it.first == strategy } && (system ?: "").length <= 2000

class ChatsViewModel(private val repository: ArtelRepository) : ViewModel() {

    private val _state = MutableStateFlow<UiState<ChatSessionsResponse>>(UiState.Loading)
    val state: StateFlow<UiState<ChatSessionsResponse>> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            when (val result = repository.chatSessions()) {
                is ApiResult.Success -> _state.value = UiState.Success(result.data)
                is ApiResult.Failure ->
                    if (_state.value !is UiState.Success) {
                        _state.value = UiState.Error(result.error.message ?: "Не удалось загрузить чаты")
                    }
            }
        }
    }

    fun create(strategy: String, system: String?, onResult: (ApiResult<ChatSessionCreatedResponse>) -> Unit) {
        viewModelScope.launch {
            onResult(repository.createChatSession(strategy, system))
            refresh()
        }
    }
}

/** Список чатов рабочей области (web /chat): выбор существующего или создание нового. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChatsScreen(
    container: AppContainer,
    onBack: () -> Unit,
    onOpenSession: (String) -> Unit,
) {
    val vm: ChatsViewModel = viewModel(
        factory = viewModelFactory { initializer { ChatsViewModel(container.repository) } }
    )
    val state by vm.state.collectAsStateWithLifecycle()
    var showCreateDialog by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var createError by remember { mutableStateOf<String?>(null) }
    var strategy by remember { mutableStateOf("full") }
    var systemPrompt by remember { mutableStateOf("") }

    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 8.dp, end = 20.dp, top = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Назад")
            }
            ScreenTitle(text = "Чаты", modifier = Modifier.weight(1f))
        }
        Text(
            "Диалоги с LLM рабочей области — те же сессии, что на сайте.",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 20.dp),
        )

        StateContainer(
            state = state,
            onRetry = vm::refresh,
            emptyCheck = { it.sessions.isEmpty() },
            emptyMessage = "Чатов пока нет",
            emptyHint = "Создайте первый чат кнопкой ниже",
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) { data ->
            ChatSessionsList(
                sessions = data.sessions,
                onOpenSession = onOpenSession,
                modifier = Modifier.fillMaxSize(),
            )
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surface)
                .padding(horizontal = 16.dp, vertical = 12.dp),
        ) {
            Button(
                onClick = { showCreateDialog = true },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = ArtelShapes.pill,
            ) {
                Icon(Icons.Rounded.Add, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Новый чат", fontWeight = FontWeight.SemiBold)
            }
        }
    }

    if (showCreateDialog) {
        AlertDialog(
            onDismissRequest = { if (!creating) showCreateDialog = false },
            title = { Text("Новый чат") },
            text = {
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(
                        "Стратегия памяти",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        CHAT_STRATEGY_OPTIONS.forEach { (value, label) ->
                            FilterChip(
                                selected = strategy == value,
                                onClick = { strategy = value },
                                label = {
                                    Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                },
                            )
                        }
                    }
                    OutlinedTextField(
                        value = systemPrompt,
                        onValueChange = { systemPrompt = it.take(2000) },
                        label = { Text("Системный промпт (необязательно)") },
                        modifier = Modifier.fillMaxWidth(),
                        maxLines = 3,
                    )
                    if (createError != null) {
                        Text(
                            createError ?: "",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            },
            confirmButton = {
                if (creating) {
                    CircularProgressIndicator(
                        modifier = Modifier
                            .padding(end = 16.dp)
                            .height(24.dp)
                            .width(24.dp),
                        strokeWidth = 2.dp,
                    )
                } else {
                    TextButton(
                        onClick = {
                            if (!canCreateChat(strategy, systemPrompt)) return@TextButton
                            createError = null
                            creating = true
                            vm.create(strategy, systemPrompt.ifBlank { null }) { result ->
                                creating = false
                                when (result) {
                                    is ApiResult.Success -> {
                                        showCreateDialog = false
                                        systemPrompt = ""
                                        onOpenSession(result.data.id)
                                    }
                                    is ApiResult.Failure ->
                                        createError = result.error.message ?: "Не удалось создать чат"
                                }
                            }
                        },
                        enabled = canCreateChat(strategy, systemPrompt),
                    ) {
                        Text("Создать", fontWeight = FontWeight.SemiBold)
                    }
                }
            },
            dismissButton = {
                if (!creating) {
                    TextButton(onClick = { showCreateDialog = false }) { Text("Отмена") }
                }
            },
        )
    }
}

@Composable
private fun ChatSessionsList(
    sessions: List<ChatSessionListItemDto>,
    onOpenSession: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier,
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        items(sessions, key = { it.id }) { session ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(ArtelShapes.tile)
                    .background(MaterialTheme.colorScheme.surface)
                    .clickable { onOpenSession(session.id) }
                    .padding(16.dp),
            ) {
                Text(
                    "Чат ${session.id.takeLast(6)}",
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(
                    modifier = Modifier.padding(top = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        strategyLabel(session.strategy),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Text(
                        pluralMessages(session.messageCount),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (!session.system.isNullOrBlank()) {
                    Text(
                        session.system,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

/** Русское множественное число для реплик: 1 реплика / 2 реплики / 5 реплик. */
internal fun pluralMessages(n: Int): String {
    val mod100 = n % 100
    val form = when {
        mod100 in 11..14 -> "реплик"
        mod100 % 10 == 1 -> "реплика"
        mod100 % 10 in 2..4 -> "реплики"
        else -> "реплик"
    }
    return "$n $form"
}
