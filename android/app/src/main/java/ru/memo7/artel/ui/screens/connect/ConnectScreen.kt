package ru.memo7.artel.ui.screens.connect

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import retrofit2.HttpException
import ru.memo7.artel.core.network.ApiFactory
import ru.memo7.artel.data.Credentials
import ru.memo7.artel.data.CredentialsStore
import ru.memo7.artel.data.api.ErrorResponse
import ru.memo7.artel.data.api.LoginRequest
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.theme.ArtelShapes
import ru.memo7.artel.ui.theme.Cheese
import ru.memo7.artel.ui.theme.Tomato

data class ConnectUiState(
    val serverUrl: String = "",
    val password: String = "",
    val busy: Boolean = false,
    val error: String? = null,
)

class ConnectViewModel(
    private val store: CredentialsStore,
) : ViewModel() {

    private val _state = MutableStateFlow(ConnectUiState())
    val state: StateFlow<ConnectUiState> = _state.asStateFlow()

    init {
        // Последний успешный адрес подставляется всегда — и после logout/401 тоже.
        viewModelScope.launch {
            store.lastServerUrl.collect { url ->
                if (!url.isNullOrBlank()) {
                    _state.update { it.copy(serverUrl = it.serverUrl.ifBlank { url }) }
                }
            }
        }
    }

    fun onUrlChange(value: String) = _state.update { it.copy(serverUrl = value, error = null) }
    fun onPasswordChange(value: String) = _state.update { it.copy(password = value, error = null) }

    fun connect() {
        val current = _state.value
        if (current.busy) return
        ConnectRules.validate(current.serverUrl, current.password)?.let { error ->
            _state.update { it.copy(error = error) }
            return
        }
        val url = current.serverUrl.trim()
        val password = current.password.trim()
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            val token = login(url, password) ?: return@launch
            // Токен сохраняем только после успешного bootstrap — значит, подключение реально работает.
            val credentials = Credentials(url, token)
            if (!bootstrap(credentials)) return@launch
            store.saveCredentials(credentials)
            // ViewModel живёт в Activity-scope и переиспользуется после logout/401.
            // Без сброса следующий экран входа показал бы старый пароль и busy-спиннер.
            _state.value = ConnectUiState()
        }
    }

    /** POST api/mobile/login; при ошибке показывает сообщение и возвращает null. */
    private suspend fun login(url: String, password: String): String? {
        val authApi = try {
            ApiFactory.createAuth(url)
        } catch (e: IllegalArgumentException) {
            _state.update { it.copy(busy = false, error = "Некорректный адрес сервера") }
            return null
        }
        return try {
            val response = authApi.login(LoginRequest(password))
            if (!response.ok || response.token.isNullOrBlank()) {
                fail(response.error?.takeIf { it.isNotBlank() } ?: "Не удалось войти")
                null
            } else {
                response.token
            }
        } catch (e: HttpException) {
            fail(
                if (e.code() == 401) "Неверный пароль"
                else "Ошибка сервера (${e.code()}): ${e.errorText().ifBlank { "нет описания" }}"
            )
            null
        } catch (e: CancellationException) {
            throw e
        } catch (e: java.io.IOException) {
            fail(ConnectRules.describeConnectFailure(e.message))
            null
        } catch (e: Exception) {
            fail(ConnectRules.describeConnectFailure(e.message))
            null
        }
    }

    /** Проверяет подключение bootstrap-запросом; пароль нигде не сохраняется. */
    private suspend fun bootstrap(credentials: Credentials): Boolean = try {
        ApiFactory.create(credentials).bootstrap()
        true
    } catch (e: CancellationException) {
        throw e
    } catch (e: HttpException) {
        fail("Ошибка сервера (${e.code()}): ${e.errorText().ifBlank { "нет описания" }}")
        false
    } catch (e: java.io.IOException) {
        fail(ConnectRules.describeConnectFailure(e.message))
        false
    } catch (e: Exception) {
        fail(ConnectRules.describeConnectFailure(e.message))
        false
    }

    private fun fail(message: String) = _state.update { it.copy(busy = false, error = message) }

    private fun HttpException.errorText(): String {
        val body = try {
            response()?.errorBody()?.string().orEmpty()
        } catch (_: Exception) {
            ""
        }
        return runCatching {
            ApiFactory.json.decodeFromString(ErrorResponse.serializer(), body).error
        }.getOrNull() ?: body.take(200)
    }
}

/** Entry screen: the user types the server address (like a site URL) and the workspace password. */
@Composable
fun ConnectScreen(container: AppContainer) {
    val vm: ConnectViewModel = viewModel(
        factory = viewModelFactory {
            initializer { ConnectViewModel(container.credentialsStore) }
        }
    )
    val state by vm.state.collectAsStateWithLifecycle()
    val focusManager = LocalFocusManager.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .size(64.dp)
                .clip(ArtelShapes.hero)
                .background(
                    Brush.linearGradient(listOf(Tomato, Cheese))
                )
        ) {
            Icon(
                Icons.Rounded.Bolt,
                contentDescription = null,
                tint = Color(0xFF2A0E05),
                modifier = Modifier
                    .align(Alignment.Center)
                    .size(36.dp),
            )
        }
        Spacer(Modifier.height(20.dp))
        Text("Артель", style = MaterialTheme.typography.displayLarge, color = MaterialTheme.colorScheme.primary)
        Text(
            "Войдите в рабочее пространство",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(28.dp))

        OutlinedTextField(
            value = state.serverUrl,
            onValueChange = vm::onUrlChange,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Адрес сервера") },
            placeholder = { Text("https://artel.example.com") },
            singleLine = true,
            shape = ArtelShapes.chip,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next, keyboardType = KeyboardType.Uri),
        )
        Spacer(Modifier.height(12.dp))
        var showPassword by remember { mutableStateOf(false) }
        OutlinedTextField(
            value = state.password,
            onValueChange = vm::onPasswordChange,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Пароль") },
            singleLine = true,
            shape = ArtelShapes.chip,
            visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
            trailingIcon = {
                IconButton(onClick = { showPassword = !showPassword }) {
                    Icon(
                        if (showPassword) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility,
                        contentDescription = if (showPassword) "Скрыть пароль" else "Показать пароль",
                    )
                }
            },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done, keyboardType = KeyboardType.Password),
            keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus(); vm.connect() }),
        )

        AnimatedVisibility(visible = state.error != null) {
            Text(
                text = state.error.orEmpty(),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(top = 12.dp),
            )
        }

        Spacer(Modifier.height(24.dp))
        Button(
            onClick = { focusManager.clearFocus(); vm.connect() },
            enabled = !state.busy,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            shape = ArtelShapes.pill,
        ) {
            if (state.busy) {
                CircularProgressIndicator(
                    modifier = Modifier.size(22.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            } else {
                Text("Войти", style = MaterialTheme.typography.labelLarge)
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(
            "Пароль не сохраняется; на устройстве остаётся только сессия.",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
