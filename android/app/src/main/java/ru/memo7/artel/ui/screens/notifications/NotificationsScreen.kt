package ru.memo7.artel.ui.screens.notifications

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.DoneAll
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
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
import ru.memo7.artel.data.api.NotificationDto
import ru.memo7.artel.data.api.NotificationsResponse
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.screens.projects.formatRuDate
import ru.memo7.artel.ui.theme.ArtelShapes

class NotificationsViewModel(private val repository: ArtelRepository) : ViewModel() {

    private val _state = MutableStateFlow<UiState<NotificationsResponse>>(UiState.Loading)
    val state: StateFlow<UiState<NotificationsResponse>> = _state.asStateFlow()

    private val _marking = MutableStateFlow(false)
    val marking: StateFlow<Boolean> = _marking.asStateFlow()

    init {
        repository.cachedNotifications?.let { _state.value = UiState.Success(it) }
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            when (val result = repository.notifications()) {
                is ApiResult.Success -> _state.value = UiState.Success(result.data)
                is ApiResult.Failure ->
                    if (_state.value !is UiState.Success) _state.value = UiState.Error(result.error.message ?: "Ошибка")
            }
        }
    }

    fun markAllRead() {
        if (_marking.value) return
        _marking.value = true
        viewModelScope.launch {
            repository.markAllNotificationsRead()
            _marking.value = false
            refresh()
        }
    }

    /** Тап по уведомлению: markRead для одной записи, затем обновляем список. */
    fun markRead(id: Long) {
        viewModelScope.launch {
            repository.markNotificationRead(id)
            refresh()
        }
    }
}

/** Notifications: unread-first list and a mark-all-read action. */
@Composable
fun NotificationsScreen(container: AppContainer, onBack: () -> Unit) {
    val vm: NotificationsViewModel = viewModel(
        factory = viewModelFactory { initializer { NotificationsViewModel(container.repository) } }
    )
    val state by vm.state.collectAsStateWithLifecycle()
    val marking by vm.marking.collectAsStateWithLifecycle()
    val unread = (state as? UiState.Success)?.data?.unread ?: 0
    val context = LocalContext.current

    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 8.dp, end = 16.dp, top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Назад")
            }
            Column(Modifier.weight(1f)) {
                Text("Уведомления", style = MaterialTheme.typography.displaySmall)
                Text(
                    if (unread > 0) "Непрочитанных: $unread" else "Всё прочитано",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Button(
                onClick = vm::markAllRead,
                enabled = !marking && unread > 0,
                shape = ArtelShapes.pill,
            ) {
                Icon(Icons.Rounded.DoneAll, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("Прочитать все")
            }
        }
        StateContainer(
            state = state,
            onRetry = vm::refresh,
            emptyCheck = { it.notifications.isEmpty() },
            emptyMessage = "Уведомлений нет",
        ) { data ->
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(data.notifications, key = { it.id }) { notification ->
                    NotificationRow(
                        notification = notification,
                        onClick = {
                            openHref(context, notification.href)
                            vm.markRead(notification.id)
                        },
                        modifier = Modifier.animateItem(),
                    )
                }
            }
        }
    }
}

@Composable
private fun NotificationRow(notification: NotificationDto, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val unread = !notification.read
    val accent = if (unread) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outline
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(ArtelShapes.tile)
            .background(if (unread) MaterialTheme.colorScheme.surfaceContainerHigh else MaterialTheme.colorScheme.surface)
            .clickable(onClick = onClick)
            .padding(14.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            modifier = Modifier
                .padding(top = 6.dp)
                .size(10.dp)
                .clip(CircleShape)
                .background(accent)
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                notification.title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = if (unread) FontWeight.Bold else FontWeight.SemiBold,
            )
            Text(
                notification.body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                "${typeLabel(notification.type)} · ${formatRuDate(notification.createdAt)}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * Открывает http(s)-ссылку уведомления; битые, относительные и не-http(s)
 * href, как и неудачный запуск активити, молча игнорируются.
 */
private fun openHref(context: Context, href: String?) {
    val target = href?.trim().orEmpty()
    if (!target.startsWith("http://") && !target.startsWith("https://")) return
    val uri = runCatching { Uri.parse(target) }.getOrNull() ?: return
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
}

/** Подписи типов по реальному NotificationType сервера + legacy-фолбэки. */
internal fun typeLabel(type: String): String = when (type.lowercase()) {
    "post_published" -> "Публикация"
    "todo_due" -> "Напоминание"
    "automation" -> "Автоматизация"
    "system" -> "Система"
    "gamification" -> "Геймификация"
    "workspace" -> "Проекты"
    "support" -> "Поддержка"
    else -> type
}
