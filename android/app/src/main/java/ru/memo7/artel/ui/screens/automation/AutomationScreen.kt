package ru.memo7.artel.ui.screens.automation

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import ru.memo7.artel.data.api.AutomationResponse
import ru.memo7.artel.data.api.AutomationRuleDto
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.PillBadge
import ru.memo7.artel.ui.components.ScreenTitle
import ru.memo7.artel.ui.components.SectionTitle
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.theme.ArtelShapes
import ru.memo7.artel.ui.screens.projects.formatRuDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

class AutomationViewModel(private val repository: ArtelRepository) : ViewModel() {

    private val _state = MutableStateFlow<UiState<AutomationResponse>>(UiState.Loading)
    val state: StateFlow<UiState<AutomationResponse>> = _state.asStateFlow()

    /** blogId of the rule currently being executed, if any. */
    private val _running = MutableStateFlow<Long?>(null)
    val running: StateFlow<Long?> = _running.asStateFlow()

    /** Одноразовые сообщения для snackbar-хоста; канал не теряет повторы. */
    private val _messages = Channel<String>(Channel.BUFFERED)
    val messages = _messages.receiveAsFlow()

    init {
        repository.cachedAutomation?.let { _state.value = UiState.Success(it) }
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            when (val result = repository.automation()) {
                is ApiResult.Success -> _state.value = UiState.Success(result.data)
                is ApiResult.Failure ->
                    if (_state.value !is UiState.Success) _state.value = UiState.Error(result.error.message ?: "Ошибка")
            }
        }
    }

    fun runNow(blogId: Long) {
        if (_running.value != null) return
        _running.value = blogId
        viewModelScope.launch {
            val message = when (val result = repository.runAutomation(blogId)) {
                is ApiResult.Success -> "Запуск: ${result.data.message}"
                is ApiResult.Failure -> "Ошибка запуска: ${result.error.message}"
            }
            _running.value = null
            _messages.send(message)
            refresh()
        }
    }

    fun configure(rule: AutomationRuleDto, enabled: Boolean, intervalMinutes: Int, autoPublish: Boolean) {
        viewModelScope.launch {
            val message = when (
                val result = repository.configureAutomation(rule.blogId, enabled, intervalMinutes, autoPublish)
            ) {
                is ApiResult.Success -> "Настройки «${rule.blogName}» сохранены"
                is ApiResult.Failure -> "Ошибка сохранения: ${result.error.message}"
            }
            _messages.send(message)
            refresh()
        }
    }

    /** Смена стиля публикаций; доступна только для правил с привязанным блогом. */
    fun setStylePreset(rule: AutomationRuleDto, preset: String) {
        val slug = rule.blogSlug ?: return
        viewModelScope.launch {
            val message = when (val result = repository.setStylePreset(slug, preset)) {
                is ApiResult.Success -> "Стиль «${rule.blogName}» сохранён"
                is ApiResult.Failure -> "Ошибка сохранения: ${result.error.message}"
            }
            _messages.send(message)
            refresh()
        }
    }
}

/** Automation rules with switches, interval editing and recent runs. */
@Composable
fun AutomationScreen(container: AppContainer) {
    val vm: AutomationViewModel = viewModel(
        factory = viewModelFactory { initializer { AutomationViewModel(container.repository) } }
    )
    val state by vm.state.collectAsStateWithLifecycle()
    val running by vm.running.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var editingRule by remember { mutableStateOf<AutomationRuleDto?>(null) }

    LaunchedEffect(Unit) {
        vm.messages.collect { message ->
            snackbarHostState.showSnackbar(message = message, withDismissAction = true)
        }
    }

    Scaffold(
        containerColor = Color.Transparent,
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            ScreenTitle("Автоматизация", accentWord = "Блоги")
            StateContainer(
                state = state,
                onRetry = vm::refresh,
                emptyCheck = { it.rules.isEmpty() },
                emptyMessage = "Правил нет",
                emptyHint = "Здесь появятся правила автопостинга ваших блогов",
            ) { data ->
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    items(data.rules, key = { it.blogId }) { rule ->
                        RuleCard(
                            rule = rule,
                            running = running == rule.blogId,
                            onRun = { vm.runNow(rule.blogId) },
                            onToggle = { enabled -> vm.configure(rule, enabled, rule.intervalMinutes, rule.autoPublish) },
                            onEdit = { editingRule = rule },
                            onStylePreset = { preset -> vm.setStylePreset(rule, preset) },
                            modifier = Modifier.animateItem(),
                        )
                    }
                    if (data.runs.isNotEmpty()) {
                        item(key = "runs-title") { SectionTitle("Последние запуски") }
                        items(data.runs, key = { "run-${it.id}" }) { run ->
                            RunRow(
                                status = run.status,
                                message = run.message,
                                startedAt = run.startedAt,
                                modifier = Modifier.animateItem(),
                            )
                        }
                    }
                }
            }
        }
    }

    editingRule?.let { rule ->
        ConfigureDialog(
            rule = rule,
            onDismiss = { editingRule = null },
            onSave = { enabled, interval, autoPublish ->
                vm.configure(rule, enabled, interval, autoPublish)
                editingRule = null
            },
        )
    }
}

@Composable
private fun RuleCard(
    rule: AutomationRuleDto,
    running: Boolean,
    onRun: () -> Unit,
    onToggle: (Boolean) -> Unit,
    onEdit: () -> Unit,
    onStylePreset: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .animateContentSize()
            .clip(ArtelShapes.card)
            .background(MaterialTheme.colorScheme.surface)
            .padding(18.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(ArtelShapes.chip)
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Rounded.Bolt,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(22.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(rule.blogName, style = MaterialTheme.typography.titleMedium)
                if (rule.blogSlug != null) {
                    Text(
                        "/${rule.blogSlug}",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Switch(
                checked = rule.enabled,
                onCheckedChange = { _ -> onEdit() },
                colors = SwitchDefaults.colors(checkedTrackColor = MaterialTheme.colorScheme.secondary),
            )
        }
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PillBadge(
                text = "каждые ${rule.intervalMinutes} мин",
                tint = MaterialTheme.colorScheme.primary,
            )
            PillBadge(
                text = if (rule.autoPublish) "автопубликация" else "черновики",
                tint = MaterialTheme.colorScheme.secondary,
            )
            if (rule.enabled && rule.nextRunAt != null) {
                PillBadge(text = "далее ${formatRuDate(rule.nextRunAt)}", tint = MaterialTheme.colorScheme.tertiary)
            }
        }
        if (rule.blogSlug != null) {
            Spacer(Modifier.height(12.dp))
            Text(
                "Стиль публикаций",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(6.dp))
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                listOf("default" to "По умолчанию", "antonov" to "Антонов").forEachIndexed { index, (value, label) ->
                    SegmentedButton(
                        selected = rule.stylePreset == value,
                        onClick = { onStylePreset(value) },
                        shape = SegmentedButtonDefaults.itemShape(index = index, count = 2),
                    ) { Text(label, style = MaterialTheme.typography.labelMedium) }
                }
            }
        }
        rule.lastRunAt?.let { last ->
            Text(
                "Прошлый запуск: ${formatRuDate(last)}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(
                onClick = onRun,
                enabled = !running,
                shape = ArtelShapes.pill,
                modifier = Modifier.weight(1f),
            ) {
                Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(if (running) "Запускаем…" else "Запустить")
            }
            Button(
                onClick = onEdit,
                shape = ArtelShapes.pill,
                modifier = Modifier.weight(0.8f),
                colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                ),
            ) { Text("Настроить") }
        }
    }
}

@Composable
private fun RunRow(status: String, message: String, startedAt: String, modifier: Modifier = Modifier) {
    val tint = when (status.lowercase()) {
        "ok", "success", "done" -> MaterialTheme.colorScheme.secondary
        "error", "failed" -> MaterialTheme.colorScheme.error
        else -> MaterialTheme.colorScheme.tertiary
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(ArtelShapes.tile)
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Rounded.History,
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(message, style = MaterialTheme.typography.bodyMedium, maxLines = 2)
            Text(
                formatRuDate(startedAt),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        PillBadge(text = status, tint = tint)
    }
}

/** Интервалы как в web /automation: [5,30,60,180,360,720,1440] минут. */
private val intervalPresets = listOf(5, 30, 60, 180, 360, 720, 1440)

/** Значение вне пресетов (legacy-правило) — к ближайшему пресету вверх, только для отображения. */
internal fun nearestPreset(minutes: Int): Int =
    intervalPresets.firstOrNull { it >= minutes } ?: intervalPresets.last()

/** Что отправляем на сервер: выбор пользователя либо исходный интервал как есть. */
internal fun intervalToSave(ruleIntervalMinutes: Int, pickedPreset: Int?): Int =
    pickedPreset ?: ruleIntervalMinutes

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ConfigureDialog(
    rule: AutomationRuleDto,
    onDismiss: () -> Unit,
    onSave: (enabled: Boolean, intervalMinutes: Int, autoPublish: Boolean) -> Unit,
) {
    var enabled by remember { mutableStateOf(rule.enabled) }
    var autoPublish by remember { mutableStateOf(rule.autoPublish) }
    // null = пресеты не трогали: отправляем исходный intervalMinutes без округления.
    var pickedInterval by remember { mutableStateOf<Int?>(null) }
    val selectedInterval = pickedInterval ?: nearestPreset(rule.intervalMinutes)

    AlertDialog(
        onDismissRequest = onDismiss,
        shape = ArtelShapes.card,
        containerColor = MaterialTheme.colorScheme.surface,
        title = { Text("Правило «${rule.blogName}»") },
        text = {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Включено", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    Switch(checked = enabled, onCheckedChange = { enabled = it })
                }
                Text(
                    "Интервал запуска",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(6.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    intervalPresets.forEach { minutes ->
                        FilterChip(
                            selected = selectedInterval == minutes,
                            onClick = { pickedInterval = minutes },
                            label = { Text("$minutes мин") },
                        )
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Автопубликация", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "Если выключено — записи сохраняются черновиками",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(checked = autoPublish, onCheckedChange = { autoPublish = it })
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(enabled, intervalToSave(rule.intervalMinutes, pickedInterval), autoPublish) }) {
                Text("Сохранить")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Отмена") } },
    )
}
