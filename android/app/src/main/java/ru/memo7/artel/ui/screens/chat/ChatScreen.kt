package ru.memo7.artel.ui.screens.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CornerSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.RestartAlt
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.style.TextAlign
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
import ru.memo7.artel.data.api.ChatSessionDto
import ru.memo7.artel.data.api.ChatStreamEvent
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.screens.assistant.ChatMessage
import ru.memo7.artel.ui.theme.ArtelShapes

/** Клиентский предел сообщения — как на сервере (chatSendSchema.text.max(8000)). */
internal const val MAX_CHAT_INPUT_LENGTH = 8000

data class ChatUiState(
    val load: UiState<ChatSessionDto> = UiState.Loading,
    val messages: List<ChatMessage> = emptyList(),
    val busy: Boolean = false,
    val notice: String? = null,
)

class ChatViewModel(
    private val repository: ArtelRepository,
    private val sessionId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(ChatUiState())
    val state: StateFlow<ChatUiState> = _state.asStateFlow()

    private var nextId = 1L

    init {
        load()
    }

    fun load() {
        _state.update { it.copy(load = UiState.Loading, messages = emptyList(), notice = null) }
        viewModelScope.launch {
            when (val result = repository.chatSession(sessionId)) {
                is ApiResult.Success -> _state.value = ChatUiState(
                    load = UiState.Success(result.data.session),
                    messages = result.data.session.messages
                        .filter { it.role != "system" }
                        .map {
                            ChatMessage(
                                id = nextId++,
                                fromUser = it.role == "user",
                                text = it.content,
                            )
                        },
                )
                is ApiResult.Failure ->
                    _state.update {
                        it.copy(load = UiState.Error(result.error.message ?: "Не удалось загрузить чат"))
                    }
            }
        }
    }

    fun send(text: String) {
        val trimmed = text.trim()
        if (_state.value.busy || trimmed.isEmpty() || trimmed.length > MAX_CHAT_INPUT_LENGTH) return
        val userMessage = ChatMessage(id = nextId++, fromUser = true, text = trimmed)
        val assistantMessage = ChatMessage(id = nextId++, fromUser = false, text = "", pending = true)
        _state.update {
            it.copy(
                messages = it.messages + userMessage + assistantMessage,
                busy = true,
                notice = null,
            )
        }

        viewModelScope.launch {
            var accumulated = ""
            var streamAnswer: String? = null
            var streamFailure: String? = null
            val streamResult = repository.chatStream(sessionId, trimmed) { event ->
                when (event) {
                    is ChatStreamEvent.Token -> {
                        accumulated += event.delta
                        replaceMessage(assistantMessage.id) { it.copy(text = accumulated) }
                    }
                    is ChatStreamEvent.Done -> {
                        streamAnswer = event.answer ?: accumulated
                    }
                    is ChatStreamEvent.Failure -> streamFailure = event.message
                }
            }
            val (finalText, isError) = when {
                streamFailure != null -> streamFailure.orEmpty() to true
                streamResult is ApiResult.Failure -> {
                    val reason = (streamResult as ApiResult.Failure).error.message
                    val text = if (reason != null) "Не удалось получить ответ: $reason" else "Не удалось получить ответ"
                    text to true
                }
                else -> (streamAnswer ?: accumulated).ifBlank { "Пустой ответ сервера" } to false
            }
            replaceMessage(assistantMessage.id) { it.copy(text = finalText, isError = isError, pending = false) }
            _state.update { it.copy(busy = false) }
        }
    }

    /** «Остановить»: обрываем сокет, сервер по req.signal глушит LLM; partial остаётся в пузыре. */
    fun stop() {
        repository.cancelChatStream()
    }

    /** PATCH reset:true — сервер чистит историю и usage; локально перечитываем сессию. */
    fun reset() {
        if (_state.value.busy) return
        viewModelScope.launch {
            when (val result = repository.resetChatSession(sessionId)) {
                is ApiResult.Success -> _state.update {
                    it.copy(
                        messages = emptyList(),
                        load = UiState.Success(result.data.session),
                        notice = "История очищена",
                    )
                }
                is ApiResult.Failure -> _state.update {
                    it.copy(notice = result.error.message ?: "Не удалось очистить историю")
                }
            }
        }
    }

    private fun replaceMessage(id: Long, transform: (ChatMessage) -> ChatMessage) {
        _state.update { current ->
            current.copy(messages = current.messages.map { if (it.id == id) transform(it) else it })
        }
    }
}

/** Диалог сессии чата (web /chat/[sessionId]): стрим токенов, стоп-генерация, сброс. */
@Composable
fun ChatScreen(
    container: AppContainer,
    sessionId: String,
    onBack: () -> Unit,
) {
    val vm: ChatViewModel = viewModel(
        factory = viewModelFactory { initializer { ChatViewModel(container.repository, sessionId) } }
    )
    val state by vm.state.collectAsStateWithLifecycle()
    var input by remember { mutableStateOf("") }
    var confirmReset by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    LaunchedEffect(state.messages.size, state.messages.lastOrNull()?.text) {
        if (state.messages.isNotEmpty()) {
            listState.animateScrollToItem(state.messages.lastIndex)
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 8.dp, end = 12.dp, top = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Назад")
            }
            Column(Modifier.weight(1f)) {
                Text(
                    "Чат",
                    style = MaterialTheme.typography.titleLarge,
                )
                val session = (state.load as? UiState.Success)?.data
                Text(
                    buildString {
                        if (session != null) append(strategyLabel(session.strategy))
                        session?.usage?.let { append(" · ${it.total_tokens} токенов") }
                    },
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(
                onClick = { confirmReset = true },
                enabled = !state.busy && state.load is UiState.Success,
            ) {
                Icon(Icons.Rounded.RestartAlt, contentDescription = "Сбросить историю")
            }
        }
        if (state.notice != null) {
            Text(
                state.notice ?: "",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
            )
        }

        StateContainer(
            state = state.load,
            onRetry = vm::load,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) { session ->
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(state.messages, key = { it.id }) { message ->
                    ChatBubble(message, modifier = Modifier.animateItem())
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surface)
                .padding(horizontal = 16.dp, vertical = 10.dp)
                .imePadding(),
            verticalAlignment = Alignment.Bottom,
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it.take(MAX_CHAT_INPUT_LENGTH) },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Сообщение…") },
                shape = ArtelShapes.pill,
                maxLines = 4,
                supportingText = {
                    Text(
                        "${input.length} / $MAX_CHAT_INPUT_LENGTH",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (input.length >= MAX_CHAT_INPUT_LENGTH) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                },
            )
            if (state.busy) {
                IconButton(onClick = vm::stop) {
                    Icon(Icons.Rounded.Stop, contentDescription = "Остановить генерацию")
                }
            } else {
                IconButton(
                    onClick = {
                        vm.send(input)
                        input = ""
                    },
                    enabled = input.isNotBlank() && input.length <= MAX_CHAT_INPUT_LENGTH,
                ) {
                    Icon(
                        Icons.AutoMirrored.Rounded.Send,
                        contentDescription = "Отправить",
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }

    if (confirmReset) {
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            title = { Text("Сбросить историю?") },
            text = { Text("История сообщений и счётчик токенов будут очищены. Системный промпт останется.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmReset = false
                        vm.reset()
                    },
                ) { Text("Сбросить") }
            },
            dismissButton = {
                TextButton(onClick = { confirmReset = false }) { Text("Отмена") }
            },
        )
    }
}

@Composable
private fun ChatBubble(message: ChatMessage, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = if (message.fromUser) Arrangement.End else Arrangement.Start,
    ) {
        val bubbleColor = when {
            message.fromUser -> MaterialTheme.colorScheme.primary
            message.isError -> MaterialTheme.colorScheme.errorContainer
            else -> MaterialTheme.colorScheme.surface
        }
        val textColor = when {
            message.fromUser -> MaterialTheme.colorScheme.onPrimary
            message.isError -> MaterialTheme.colorScheme.onErrorContainer
            else -> MaterialTheme.colorScheme.onSurface
        }
        Box(
            modifier = Modifier
                .widthIn(max = 300.dp)
                .clip(
                    MaterialTheme.shapes.extraLarge.copy(
                        bottomEnd = if (message.fromUser) CornerSize(6.dp) else CornerSize(28.dp),
                        bottomStart = if (!message.fromUser) CornerSize(6.dp) else CornerSize(28.dp),
                    ),
                )
                .background(bubbleColor)
                .padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            if (message.pending && message.text.isEmpty()) {
                Text(
                    "Думаю…",
                    color = textColor,
                    style = MaterialTheme.typography.bodyLarge,
                    textAlign = TextAlign.Center,
                )
            } else {
                Text(
                    message.text,
                    color = textColor,
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
        }
    }
}
