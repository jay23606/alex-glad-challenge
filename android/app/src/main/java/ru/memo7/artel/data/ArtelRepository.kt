package ru.memo7.artel.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit
import retrofit2.HttpException
import ru.memo7.artel.core.network.ApiError
import ru.memo7.artel.core.network.ApiFactory
import ru.memo7.artel.core.network.ApiResult
import ru.memo7.artel.data.api.ArtelApi
import ru.memo7.artel.data.api.AssistantRequest
import ru.memo7.artel.data.api.AssistantResponse
import ru.memo7.artel.data.api.AutomationConfigureRequest
import ru.memo7.artel.data.api.AutomationResponse
import ru.memo7.artel.data.api.AutomationRunRequest
import ru.memo7.artel.data.api.AutomationRunResponse
import ru.memo7.artel.data.api.BlogStyleRequest
import ru.memo7.artel.data.api.BootstrapResponse
import ru.memo7.artel.data.api.CalendarResponse
import ru.memo7.artel.data.api.CalendarSyncResponse
import ru.memo7.artel.data.api.ChatCreateRequest
import ru.memo7.artel.data.api.ChatResetRequest
import ru.memo7.artel.data.api.ChatSessionCreatedResponse
import ru.memo7.artel.data.api.ChatSessionResponse
import ru.memo7.artel.data.api.ChatSendRequest
import ru.memo7.artel.data.api.ChatSessionsResponse
import ru.memo7.artel.data.api.ChatSseParser
import ru.memo7.artel.data.api.ChatStreamEvent
import ru.memo7.artel.data.api.CreateItemRequest
import ru.memo7.artel.data.api.CreateProjectRequest
import ru.memo7.artel.data.api.CreateTicketRequest
import ru.memo7.artel.data.api.CreatedIdResponse
import ru.memo7.artel.data.api.ErrorResponse
import ru.memo7.artel.data.api.FaqResponse
import ru.memo7.artel.data.api.GamificationResponse
import ru.memo7.artel.data.api.ItemsResponse
import ru.memo7.artel.data.api.NotificationActionRequest
import ru.memo7.artel.data.api.NotificationsResponse
import ru.memo7.artel.data.api.OkResponse
import ru.memo7.artel.data.api.PatchItemRequest
import ru.memo7.artel.data.api.ProjectsResponse
import ru.memo7.artel.data.api.TodoActionRequest
import ru.memo7.artel.data.api.TodoAddRequest
import ru.memo7.artel.data.api.TodosResponse

/**
 * Single repository over the web API. Resolves the Retrofit client from the
 * credentials currently stored in DataStore and keeps a small in-memory cache
 * of the last successful reads so screens can paint instantly on re-entry.
 */
class ArtelRepository(private val store: CredentialsStore) {

    @Volatile private var apiHolder: Pair<Credentials, ArtelApi>? = null

    /** Last successful payloads, keyed by endpoint. Invalidated on writes. */
    @Volatile var cachedBootstrap: BootstrapResponse? = null
        private set
    @Volatile var cachedProjects: ProjectsResponse? = null
        private set
    @Volatile var cachedNotifications: NotificationsResponse? = null
        private set
    @Volatile var cachedAutomation: AutomationResponse? = null
        private set
    @Volatile var cachedCalendar: CalendarResponse? = null
        private set
    @Volatile var cachedGamification: GamificationResponse? = null
        private set
    @Volatile var cachedTodos: TodosResponse? = null
        private set

    private suspend fun api(): Pair<Credentials, ArtelApi> {
        val credentials = store.settings.first().credentials
            ?: throw ApiError.BadResponse("Нет сохранённого подключения к серверу")
        apiHolder?.let { (known, api) -> if (known == credentials) return known to api }
        val fresh = ApiFactory.create(credentials)
        apiHolder = credentials to fresh
        return credentials to fresh
    }

    private suspend fun <T> call(block: suspend (ArtelApi) -> T): ApiResult<T> =
        withContext(Dispatchers.IO) {
            var usedToken: String? = null
            try {
                val (credentials, api) = api()
                usedToken = credentials.token
                ApiResult.Success(block(api))
            } catch (e: CancellationException) {
                // Отмена (например, запрос вытеснен новым поиском) — не сетевая ошибка.
                throw e
            } catch (e: HttpException) {
                // Только если сессия всё ещё та, которой шёл запрос: поздний 401
                // от старого запроса не должен разлогинить после повторного входа.
                if (e.code() == 401) usedToken?.let { store.clearTokenIf(it) }
                ApiResult.Failure(e.toApiError())
            } catch (e: ApiError.Unauthorized) {
                // requireSuccess тоже бросает Unauthorized, но внутри block — до call не «доходит мимо».
                usedToken?.let { store.clearTokenIf(it) }
                ApiResult.Failure(e)
            } catch (e: ApiError) {
                ApiResult.Failure(e)
            } catch (e: java.io.IOException) {
                ApiResult.Failure(ApiError.Network(e))
            } catch (e: Exception) {
                ApiResult.Failure(ApiError.Network(e))
            }
        }

    private fun HttpException.toApiError(): ApiError {
        val body = try {
            response()?.errorBody()?.string().orEmpty()
        } catch (_: Exception) {
            ""
        }
        val message = runCatching {
            ApiFactory.json.decodeFromString(ErrorResponse.serializer(), body).error
        }.getOrNull()
        return when (code()) {
            401 -> ApiError.Unauthorized()
            else -> ApiError.Server(code(), message ?: body.take(200))
        }
    }

    /* ---------- Reads ---------- */

    suspend fun bootstrap(): ApiResult<BootstrapResponse> = call { api ->
        api.bootstrap().also { cachedBootstrap = it }
    }

    suspend fun projects(): ApiResult<ProjectsResponse> = call { api ->
        api.projects().also { cachedProjects = it }
    }

    suspend fun items(projectId: Long): ApiResult<ItemsResponse> = call { api ->
        api.items(projectId)
    }

    suspend fun notifications(): ApiResult<NotificationsResponse> = call { api ->
        api.notifications().also { cachedNotifications = it }
    }

    suspend fun automation(): ApiResult<AutomationResponse> = call { api ->
        api.automation().also { cachedAutomation = it }
    }

    suspend fun calendar(days: Int = 30): ApiResult<CalendarResponse> = call { api ->
        api.calendar(days).also { cachedCalendar = it }
    }

    suspend fun faq(query: String): ApiResult<FaqResponse> = call { api ->
        api.faq(query)
    }

    suspend fun gamification(limit: Int = 30): ApiResult<GamificationResponse> = call { api ->
        api.gamification(limit).also { cachedGamification = it }
    }

    suspend fun todos(): ApiResult<TodosResponse> = call { api ->
        api.todos().also { cachedTodos = it }
    }

    /* ---------- Writes ---------- */

    suspend fun createProject(name: String, description: String?, color: String?): ApiResult<CreatedIdResponse> =
        call { api ->
            val response = api.createProject(CreateProjectRequest(name, description?.takeIf { it.isNotBlank() }, color))
            requireSuccess(response, "Не удалось создать проект")
        }

    suspend fun createItem(request: CreateItemRequest): ApiResult<CreatedIdResponse> =
        call { api ->
            val response = api.createItem(request)
            requireSuccess(response, "Не удалось создать запись")
        }

    suspend fun setItemDone(id: Long, done: Boolean): ApiResult<OkResponse> =
        call { api ->
            // PATCH /api/workspace/items/[id]; id остаётся в body — требует схема.
            val response = api.patchItem(id, PatchItemRequest(id, done))
            requireSuccess(response, "Не удалось обновить запись")
        }

    suspend fun markAllNotificationsRead(): ApiResult<OkResponse> =
        call { api ->
            val response = api.notificationAction(NotificationActionRequest(action = "markAllRead"))
            requireSuccess(response, "Не удалось отметить уведомления")
        }.also { result -> if (result is ApiResult.Success) cachedNotifications = null }

    suspend fun markNotificationRead(id: Long): ApiResult<Unit> =
        call { api ->
            val response = api.notificationAction(NotificationActionRequest(action = "markRead", id = id))
            requireSuccess(response, "Не удалось отметить уведомление")
            Unit
        }.also { result -> if (result is ApiResult.Success) cachedNotifications = null }

    suspend fun runAutomation(blogId: Long): ApiResult<AutomationRunResponse> =
        call { api ->
            val response = api.automationAction(AutomationRunRequest(blogId = blogId))
            requireSuccess(response, "Не удалось запустить правило")
        }.also { cachedAutomation = null }

    suspend fun configureAutomation(blogId: Long, enabled: Boolean, intervalMinutes: Int, autoPublish: Boolean): ApiResult<OkResponse> =
        call { api ->
            val response = api.automationConfigure(
                AutomationConfigureRequest(blogId = blogId, enabled = enabled, intervalMinutes = intervalMinutes, autoPublish = autoPublish)
            )
            requireSuccess(response, "Не удалось сохранить настройки")
        }.also { cachedAutomation = null }

    suspend fun setStylePreset(slug: String, preset: String): ApiResult<Unit> =
        call { api ->
            val response = api.setBlogStyle(slug, BlogStyleRequest(preset))
            requireSuccess(response, "Не удалось сохранить стиль")
            Unit
        }.also { result -> if (result is ApiResult.Success) cachedAutomation = null }

    suspend fun syncCalendar(): ApiResult<CalendarSyncResponse> =
        call { api ->
            val response = api.calendarSync()
            requireSuccess(response, "Не удалось синхронизировать календарь")
        }.also { cachedCalendar = null }

    /** ICS-фид /api/calendar/feed.ics — байты файла для шеринга; чтение на Dispatchers.IO внутри call. */
    suspend fun downloadCalendarIcs(days: Int = 30): ApiResult<ByteArray> = call { api ->
        requireSuccess(api.calendarIcs(days), "Не удалось скачать календарь").bytes()
    }

    suspend fun addTodo(text: String, recurring: String?, intervalHours: Int?): ApiResult<CreatedIdResponse> =
        call { api ->
            val response = api.addTodo(
                TodoAddRequest(text = text.trim(), recurring = recurring, intervalHours = intervalHours)
            )
            requireSuccess(response, "Не удалось добавить задачу")
        }.also { result -> if (result is ApiResult.Success) cachedTodos = null }

    suspend fun todoAction(id: Long, action: String): ApiResult<OkResponse> =
        call { api ->
            val response = api.todoAction(id, TodoActionRequest(action = action))
            requireSuccess(response, "Не удалось обновить задачу")
        }.also { result -> if (result is ApiResult.Success) cachedTodos = null }

    suspend fun askAssistant(message: String): ApiResult<AssistantResponse> = call { api ->
        api.assistant(AssistantRequest(message))
    }

    /* ---------- Chat ---------- */

    suspend fun chatSessions(): ApiResult<ChatSessionsResponse> = call { api ->
        api.chatSessions()
    }

    suspend fun createChatSession(strategy: String, system: String?): ApiResult<ChatSessionCreatedResponse> =
        call { api ->
            api.createChatSession(ChatCreateRequest(strategy = strategy, system = system?.takeIf { it.isNotBlank() }))
        }

    suspend fun chatSession(sessionId: String): ApiResult<ChatSessionResponse> = call { api ->
        api.chatSession(sessionId)
    }

    suspend fun resetChatSession(sessionId: String): ApiResult<ChatSessionResponse> = call { api ->
        api.patchChatSession(sessionId, ChatResetRequest(reset = true))
    }

    @Volatile private var chatStreamCall: Call? = null

    /** Отмена активного SSE-стрима («Остановить»): сервер обрывает LLM через req.signal. */
    fun cancelChatStream() {
        chatStreamCall?.cancel()
    }

    /**
     * SSE-стрим ответа POST /api/chat/{sessionId}: безымянные события `data: <JSON>`,
     * разделитель `\n\n`, конец потока = закрытие соединения сервером.
     * Токены отдаются в [onEvent] по мере поступления; HTTP-ошибки маппятся как в [call].
     */
    suspend fun chatStream(sessionId: String, text: String, onEvent: (ChatStreamEvent) -> Unit): ApiResult<Unit> =
        withContext(Dispatchers.IO) {
            var usedToken: String? = null
            try {
                val (credentials, _) = api()
                usedToken = credentials.token
                val request = Request.Builder()
                    .url(credentials.toRetrofitBaseUrl() + "api/chat/" + sessionId)
                    .header("Authorization", "Bearer " + credentials.token.trim())
                    .post(
                        ApiFactory.json
                            .encodeToString(ChatSendRequest.serializer(), ChatSendRequest(text = text))
                            .toRequestBody("application/json".toMediaType()),
                    )
                    .build()
                // Стрим: connect как у обычных запросов, readTimeout = 0 — паузы генерации не обрываем.
                val call = OkHttpClient.Builder()
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .readTimeout(0, TimeUnit.MILLISECONDS)
                    .build()
                    .newCall(request)
                chatStreamCall = call
                call.execute().use { response ->
                    when {
                        response.code == 401 -> {
                            store.clearTokenIf(usedToken.orEmpty())
                            throw ApiError.Unauthorized()
                        }
                        !response.isSuccessful -> {
                            val raw = response.body?.string().orEmpty()
                            val message = runCatching {
                                ApiFactory.json.decodeFromString(ErrorResponse.serializer(), raw).error
                            }.getOrNull()
                            throw ApiError.Server(response.code, message ?: raw.take(200))
                        }
                    }
                    val source = response.body?.source() ?: throw ApiError.BadResponse("Пустой ответ сервера")
                    val buffer = StringBuilder()
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val line = source.readUtf8Line() ?: break
                        buffer.append(line).append('\n')
                        ChatSseParser.drain(buffer, onEvent)
                    }
                    ApiResult.Success(Unit)
                }
            } catch (e: CancellationException) {
                chatStreamCall?.cancel()
                throw e
            } catch (e: ApiError.Unauthorized) {
                usedToken?.let { store.clearTokenIf(it) }
                ApiResult.Failure(e)
            } catch (e: ApiError) {
                ApiResult.Failure(e)
            } catch (e: java.io.IOException) {
                // OkHttp cancel бьёт чтение сокета IOException("Canceled …") — это команда
                // «Остановить», а не сетевой сбой: незакрытый partial остаётся в UI.
                if (chatStreamCall?.isCanceled() == true) ApiResult.Success(Unit) else ApiResult.Failure(ApiError.Network(e))
            } catch (e: Exception) {
                ApiResult.Failure(ApiError.Network(e))
            }
        }

    suspend fun createTicket(subject: String, body: String, contact: String?): ApiResult<CreatedIdResponse> =
        call { api ->
            val response = api.createTicket(
                CreateTicketRequest(subject, body, contact?.takeIf { it.isNotBlank() })
            )
            requireSuccess(response, "Не удалось создать обращение")
        }

    private fun <T> requireSuccess(response: retrofit2.Response<T>, fallback: String): T {
        if (!response.isSuccessful) {
            val raw = response.errorBody()?.string().orEmpty()
            val message = runCatching {
                ApiFactory.json.decodeFromString(ErrorResponse.serializer(), raw).error
            }.getOrNull()
            throw when (response.code()) {
                401 -> ApiError.Unauthorized()
                else -> ApiError.Server(response.code(), message ?: raw.take(200).ifBlank { fallback })
            }
        }
        return response.body() ?: throw ApiError.BadResponse(fallback)
    }
}
