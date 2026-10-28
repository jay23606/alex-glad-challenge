package ru.memo7.artel.ui.screens.assistant

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CornerSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
import ru.memo7.artel.data.ArtelRepository
import ru.memo7.artel.core.network.ApiResult
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.ScreenTitle
import ru.memo7.artel.ui.theme.ArtelShapes

data class ChatMessage(
    val id: Long,
    val fromUser: Boolean,
    val text: String,
    val isError: Boolean = false,
    val pending: Boolean = false,
)

data class AssistantUiState(
    val messages: List<ChatMessage> = emptyList(),
    val busy: Boolean = false,
)

/** Клиентский предел вопроса — как на сервере (assistantSchema.message.max(2000)). */
private const val MAX_INPUT_LENGTH = 2000

class AssistantViewModel(private val repository: ArtelRepository) : ViewModel() {

    private val _state = MutableStateFlow(AssistantUiState())
    val state: StateFlow<AssistantUiState> = _state.asStateFlow()

    private var nextId = 1L

    fun send(text: String) {
        val trimmed = text.trim()
        // Лимит сервера: assistantSchema.message.max(2000) в web/lib/shared/forms.ts.
        if (trimmed.isEmpty() || trimmed.length > MAX_INPUT_LENGTH || _state.value.busy) return
        val userMessage = ChatMessage(id = nextId++, fromUser = true, text = trimmed)
        val pending = ChatMessage(id = nextId++, fromUser = false, text = "Думаю…", pending = true)
        _state.update { it.copy(messages = it.messages + userMessage + pending, busy = true) }

        viewModelScope.launch {
            val (answer, isError) = when (val result = repository.askAssistant(trimmed)) {
                is ApiResult.Success -> result.data.answer to false
                is ApiResult.Failure -> "Не удалось получить ответ: ${result.error.message}" to true
            }
            _state.update { current ->
                current.copy(
                    busy = false,
                    messages = current.messages.map {
                        if (it.id == pending.id)
                            it.copy(text = answer, isError = isError, pending = false)
                        else it
                    },
                )
            }
        }
    }
}

/** Assistant: chat-like interface over POST /api/assistant. */
@Composable
fun AssistantScreen(container: AppContainer) {
    val vm: AssistantViewModel = viewModel(
        factory = viewModelFactory { initializer { AssistantViewModel(container.repository) } }
    )
    val state by vm.state.collectAsStateWithLifecycle()
    var input by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(state.messages.size) {
        if (state.messages.isNotEmpty()) {
            listState.animateScrollToItem(state.messages.lastIndex)
        }
    }

    Column(Modifier.fillMaxSize()) {
        ScreenTitle("Ассистент", accentWord = "ИИ")
        Text(
            "Спросите о проектах, задачах и автоматизации — ассистент отвечает на данных сервера.",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 20.dp),
        )
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(state.messages, key = { it.id }) { message ->
                ChatBubble(message, modifier = Modifier.animateItem())
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
                onValueChange = { input = it.take(MAX_INPUT_LENGTH) },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Ваш вопрос…") },
                shape = ArtelShapes.pill,
                maxLines = 4,
                supportingText = {
                    Text(
                        "${input.length} / $MAX_INPUT_LENGTH",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (input.length >= MAX_INPUT_LENGTH) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                },
            )
            IconButton(
                onClick = {
                    vm.send(input)
                    input = ""
                },
                enabled = !state.busy && input.isNotBlank() && input.length <= MAX_INPUT_LENGTH,
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
                    )
                )
                .background(bubbleColor)
                .padding(horizontal = 16.dp, vertical = 10.dp)
        ) {
            Text(
                message.text,
                color = textColor,
                style = MaterialTheme.typography.bodyLarge,
                textAlign = if (message.pending) TextAlign.Center else TextAlign.Start,
            )
        }
    }
}
