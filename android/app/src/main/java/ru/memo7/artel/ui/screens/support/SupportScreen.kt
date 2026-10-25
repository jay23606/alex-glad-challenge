package ru.memo7.artel.ui.screens.support

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Button
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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.memo7.artel.core.network.ApiResult
import ru.memo7.artel.data.ArtelRepository
import ru.memo7.artel.data.api.FaqItemDto
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.PillBadge
import ru.memo7.artel.ui.theme.ArtelShapes

data class SupportUiState(
    val query: String = "",
    val results: List<FaqItemDto> = emptyList(),
    val searching: Boolean = false,
    val searched: Boolean = false,
    val searchError: String? = null,
    val ticketBusy: Boolean = false,
    val ticketDone: Long? = null,
    val ticketError: String? = null,
)

class SupportViewModel(private val repository: ArtelRepository) : ViewModel() {

    private val _state = MutableStateFlow(SupportUiState())
    val state: StateFlow<SupportUiState> = _state.asStateFlow()

    private var searchJob: Job? = null

    fun onQueryChange(value: String) {
        _state.update { it.copy(query = value) }
        searchJob?.cancel()
        if (value.isBlank()) {
            _state.update { it.copy(results = emptyList(), searched = false, searching = false, searchError = null) }
            return
        }
        searchJob = viewModelScope.launch {
            delay(350) // debounce typing
            search(value.trim())
        }
    }

    /** Повтор последнего FAQ-запроса после ошибки — без debounce. */
    fun retrySearch() {
        searchJob?.cancel()
        val query = _state.value.query.trim()
        if (query.isNotEmpty()) viewModelScope.launch { search(query) }
    }

    private suspend fun search(query: String) {
        _state.update { it.copy(searching = true, searchError = null) }
        try {
            when (val result = repository.faq(query)) {
                is ApiResult.Success -> _state.update {
                    it.copy(results = result.data.results, searched = true, searchError = null)
                }
                is ApiResult.Failure -> _state.update {
                    // Ошибка запроса — не «ничего не найдено»: показываем её отдельно.
                    it.copy(
                        results = emptyList(),
                        searched = true,
                        searchError = result.error.message ?: "Не удалось выполнить поиск",
                    )
                }
            }
        } finally {
            // Сбрасываем флаг даже при отмене (новый запрос вытеснил текущий) —
            // иначе поиск навсегда остаётся в «Ищем…».
            _state.update { it.copy(searching = false) }
        }
    }

    fun createTicket(subject: String, body: String, contact: String?) {
        if (_state.value.ticketBusy) return
        _state.update { it.copy(ticketBusy = true, ticketError = null) }
        viewModelScope.launch {
            when (val result = repository.createTicket(subject, body, contact)) {
                is ApiResult.Success -> _state.update {
                    it.copy(ticketBusy = false, ticketDone = result.data.id, ticketError = null)
                }
                is ApiResult.Failure -> _state.update {
                    it.copy(ticketBusy = false, ticketError = result.error.message ?: "Не удалось создать обращение")
                }
            }
        }
    }

    fun resetTicketResult() = _state.update { it.copy(ticketDone = null, ticketError = null) }
}

/** Support: FAQ search (debounced) + ticket form. */
@Composable
fun SupportScreen(container: AppContainer, onBack: () -> Unit) {
    val vm: SupportViewModel = viewModel(
        factory = viewModelFactory { initializer { SupportViewModel(container.repository) } }
    )
    val state by vm.state.collectAsStateWithLifecycle()

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 32.dp),
    ) {
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 8.dp, end = 20.dp, top = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Назад")
                }
                Text("Поддержка", style = MaterialTheme.typography.displaySmall)
            }
        }
        item {
            OutlinedTextField(
                value = state.query,
                onValueChange = vm::onQueryChange,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 8.dp),
                placeholder = { Text("Поиск по базе знаний…") },
                leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
                singleLine = true,
                shape = ArtelShapes.pill,
            )
        }
        when {
            state.searching -> item {
                Text(
                    "Ищем…",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp),
                )
            }
            state.searchError != null -> item {
                Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
                    Text(
                        "Не удалось выполнить поиск: ${state.searchError}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error,
                    )
                    TextButton(onClick = vm::retrySearch) {
                        Text("Повторить")
                    }
                }
            }
            state.searched && state.results.isEmpty() -> item {
                Text(
                    "Ничего не найдено — задайте вопрос через обращение ниже.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp),
                )
            }
            else -> items(state.results, key = { it.question }) { faq ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 6.dp)
                        .background(MaterialTheme.colorScheme.surface, ArtelShapes.tile)
                        .padding(16.dp),
                ) {
                    Text(faq.question, style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        faq.answer,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        PillBadge(
                            text = "релевантность %.2f".format(faq.score),
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }
        }
        item { TicketSection(vm, state) }
    }
}

@Composable
private fun TicketSection(vm: SupportViewModel, state: SupportUiState) {
    var subject by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var contact by remember { mutableStateOf("") }
    var formVisible by remember { mutableStateOf(false) }

    Column(Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) {
        Text("Не нашли ответ?", style = MaterialTheme.typography.titleLarge)
        Text(
            "Создайте обращение — команда поддержки ответит вам.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(12.dp))
        if (!formVisible) {
            Button(onClick = { formVisible = true }, shape = ArtelShapes.pill) {
                Text("Создать обращение")
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = subject,
                    onValueChange = { subject = it },
                    label = { Text("Тема") },
                    singleLine = true,
                    shape = ArtelShapes.chip,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = body,
                    onValueChange = { body = it },
                    label = { Text("Что случилось?") },
                    shape = ArtelShapes.chip,
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3,
                )
                OutlinedTextField(
                    value = contact,
                    onValueChange = { contact = it },
                    label = { Text("Контакт для ответа (необязательно)") },
                    singleLine = true,
                    shape = ArtelShapes.chip,
                    modifier = Modifier.fillMaxWidth(),
                )
                state.ticketError?.let { error ->
                    Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                }
                state.ticketDone?.let { id ->
                    Text(
                        "Обращение №$id создано. Спасибо!",
                        color = MaterialTheme.colorScheme.secondary,
                        style = MaterialTheme.typography.titleMedium,
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = {
                            vm.createTicket(subject.trim(), body.trim(), contact.trim().ifBlank { null })
                        },
                        enabled = !state.ticketBusy && subject.isNotBlank() && body.isNotBlank(),
                        shape = ArtelShapes.pill,
                    ) {
                        Text(if (state.ticketBusy) "Отправляем…" else "Отправить")
                    }
                    TextButton(
                        onClick = {
                            formVisible = false
                            vm.resetTicketResult()
                        },
                    ) { Text("Свернуть") }
                }
            }
        }
    }
}
