package ru.memo7.artel.ui.screens.projects

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ArrowForward
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.memo7.artel.core.UiState
import ru.memo7.artel.core.network.ApiResult
import ru.memo7.artel.data.ArtelRepository
import ru.memo7.artel.data.api.ProjectDto
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.components.PillBadge
import ru.memo7.artel.ui.components.ScreenTitle
import ru.memo7.artel.ui.components.StateContainer
import ru.memo7.artel.ui.theme.ArtelShapes
import ru.memo7.artel.ui.theme.Tomato

sealed interface CreateProjectState {
    data object Idle : CreateProjectState
    data object Busy : CreateProjectState
    data class Failure(val message: String) : CreateProjectState
    data object Done : CreateProjectState
}

data class ProjectsUiState(
    val projects: List<ProjectDto> = emptyList(),
)

class ProjectsViewModel(private val repository: ArtelRepository) : ViewModel() {

    private val _state = MutableStateFlow<UiState<ProjectsUiState>>(UiState.Loading)
    val state: StateFlow<UiState<ProjectsUiState>> = _state.asStateFlow()

    private val _createState = MutableStateFlow<CreateProjectState>(CreateProjectState.Idle)
    val createState: StateFlow<CreateProjectState> = _createState.asStateFlow()

    init {
        repository.cachedProjects?.let { cached ->
            _state.value = UiState.Success(ProjectsUiState(projects = cached.projects))
        }
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            when (val result = repository.projects()) {
                is ApiResult.Success -> _state.value =
                    UiState.Success(ProjectsUiState(projects = result.data.projects))
                is ApiResult.Failure ->
                    if (_state.value !is UiState.Success) _state.value = UiState.Error(result.error.message ?: "Ошибка")
            }
        }
    }

    fun createProject(name: String, description: String, color: String?) {
        if (_createState.value is CreateProjectState.Busy) return
        _createState.value = CreateProjectState.Busy
        viewModelScope.launch {
            _createState.value = when (val result = repository.createProject(name, description.ifBlank { null }, color)) {
                is ApiResult.Success -> {
                    refresh()
                    CreateProjectState.Done
                }
                is ApiResult.Failure -> CreateProjectState.Failure(result.error.message ?: "Не удалось создать проект")
            }
        }
    }

    fun resetCreateState() { _createState.value = CreateProjectState.Idle }
}

private val projectPalette = listOf(
    "#FF5A36", "#8FE36B", "#FFB443", "#FF6B81", "#4ECDC4", "#B98CFF",
)

/** Projects: bento list + creation dialog. */
@Composable
fun ProjectsScreen(container: AppContainer, onOpenProject: (Long) -> Unit) {
    val vm: ProjectsViewModel = viewModel(
        factory = viewModelFactory { initializer { ProjectsViewModel(container.repository) } }
    )
    val state by vm.state.collectAsStateWithLifecycle()
    val createState by vm.createState.collectAsStateWithLifecycle()
    var showCreate by remember { mutableStateOf(false) }

    LaunchedEffect(createState) {
        if (createState is CreateProjectState.Done) {
            showCreate = false
            vm.resetCreateState()
        }
    }

    Scaffold(
        containerColor = Color.Transparent,
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showCreate = true },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                shape = ArtelShapes.chip,
            ) {
                Icon(Icons.Rounded.Add, contentDescription = "Новый проект")
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding)) {
            ScreenTitle("Проекты", accentWord = "Мои")
            StateContainer(
                state = state,
                onRetry = vm::refresh,
                emptyCheck = { it.projects.isEmpty() },
                emptyMessage = "Проектов пока нет",
                emptyHint = "Нажмите «+», чтобы создать первый проект",
            ) { data ->
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(
                        start = 20.dp, end = 20.dp, top = 8.dp, bottom = 96.dp,
                    ),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    items(data.projects, key = { it.id }) { project ->
                        ProjectCard(
                            project = project,
                            onClick = { onOpenProject(project.id) },
                            modifier = Modifier.animateItem(),
                        )
                    }
                }
            }
        }
    }

    if (showCreate) {
        CreateProjectDialog(
            createState = createState,
            onDismiss = { showCreate = false; vm.resetCreateState() },
            onCreate = { name, description, color -> vm.createProject(name, description, color) },
        )
    }
}

@Composable
private fun ProjectCard(project: ProjectDto, onClick: () -> Unit, modifier: Modifier = Modifier) {
    BentoRow(project = project, onClick = onClick, modifier = modifier)
}

@Composable
private fun BentoRow(project: ProjectDto, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(ArtelShapes.card)
            .background(MaterialTheme.colorScheme.surface)
            .clickable(onClick = onClick)
            .padding(18.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val color = parseColor(project.color)
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(color.copy(alpha = 0.22f)),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                modifier = Modifier
                    .size(18.dp)
                    .clip(CircleShape)
                    .background(color)
            )
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(project.name, style = MaterialTheme.typography.titleMedium)
            if (!project.description.isNullOrBlank()) {
                Text(
                    project.description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                )
            }
            PillBadge(
                text = statusLabel(project.status),
                tint = statusTint(project.status),
                modifier = Modifier.padding(top = 6.dp),
            )
        }
        Icon(
            Icons.Rounded.ArrowForward,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun CreateProjectDialog(
    createState: CreateProjectState,
    onDismiss: () -> Unit,
    onCreate: (name: String, description: String, color: String?) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var selectedColor by remember { mutableStateOf<String?>(projectPalette.first()) }

    AlertDialog(
        onDismissRequest = onDismiss,
        shape = ArtelShapes.card,
        containerColor = MaterialTheme.colorScheme.surface,
        title = { Text("Новый проект", style = MaterialTheme.typography.titleLarge) },
        text = {
            Column {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Название") },
                    singleLine = true,
                    shape = ArtelShapes.chip,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text("Описание (необязательно)") },
                    shape = ArtelShapes.chip,
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                )
                Spacer(Modifier.height(14.dp))
                Text("Цвет", style = MaterialTheme.typography.labelLarge)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    projectPalette.forEach { hex ->
                        val tint = parseColor(hex)
                        Box(
                            modifier = Modifier
                                .size(34.dp)
                                .clip(CircleShape)
                                .background(tint)
                                .clickable { selectedColor = hex }
                                .padding(4.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (selectedColor == hex) {
                                Box(
                                    Modifier
                                        .size(26.dp)
                                        .clip(CircleShape)
                                        .background(MaterialTheme.colorScheme.surface)
                                )
                            }
                        }
                    }
                }
                if (createState is CreateProjectState.Failure) {
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
            val busy = createState is CreateProjectState.Busy
            TextButton(
                enabled = !busy && name.isNotBlank(),
                onClick = { onCreate(name.trim(), description.trim(), selectedColor) },
            ) { Text(if (busy) "Создаём…" else "Создать") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Отмена") }
        },
    )
}

internal fun parseColor(hex: String?): Color {
    if (hex.isNullOrBlank()) return Tomato
    return runCatching {
        val raw = hex.removePrefix("#")
        Color(android.graphics.Color.parseColor("#$raw"))
    }.getOrDefault(Tomato)
}

private fun statusLabel(status: String): String = when (status) {
    "active" -> "активен"
    "archived" -> "в архиве"
    else -> status
}

@Composable
private fun statusTint(status: String): Color = when (status) {
    "active" -> MaterialTheme.colorScheme.secondary
    "archived" -> MaterialTheme.colorScheme.tertiary
    else -> MaterialTheme.colorScheme.primary
}
