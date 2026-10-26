package ru.memo7.artel.data.api

import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

/** Endpoints of the web API shared in the project contract. */
interface ArtelApi {

    @GET("api/mobile/bootstrap")
    suspend fun bootstrap(): BootstrapResponse

    @GET("api/workspace/projects")
    suspend fun projects(): ProjectsResponse

    @POST("api/workspace/projects")
    suspend fun createProject(@Body body: CreateProjectRequest): Response<CreatedIdResponse>

    @GET("api/workspace/items")
    suspend fun items(@Query("projectId") projectId: Long): ItemsResponse

    @POST("api/workspace/items")
    suspend fun createItem(@Body body: CreateItemRequest): Response<CreatedIdResponse>

    @PATCH("api/workspace/items/{id}")
    suspend fun patchItem(@Path("id") id: Long, @Body body: PatchItemRequest): Response<OkResponse>

    @GET("api/notifications")
    suspend fun notifications(): NotificationsResponse

    @POST("api/notifications")
    suspend fun notificationAction(@Body body: NotificationActionRequest): Response<OkResponse>

    @GET("api/automation")
    suspend fun automation(): AutomationResponse

    @POST("api/automation")
    suspend fun automationAction(@Body body: AutomationRunRequest): Response<AutomationRunResponse>

    @POST("api/automation")
    suspend fun automationConfigure(@Body body: AutomationConfigureRequest): Response<OkResponse>

    @PATCH("api/blogs/{slug}")
    suspend fun setBlogStyle(@Path("slug") slug: String, @Body body: BlogStyleRequest): Response<OkResponse>

    @GET("api/calendar")
    suspend fun calendar(@Query("days") days: Int = 30): CalendarResponse

    @Streaming
    @GET("api/calendar/feed.ics")
    suspend fun calendarIcs(@Query("days") days: Int = 30): Response<ResponseBody>

    @GET("api/gamification")
    suspend fun gamification(@Query("limit") limit: Int = 30): GamificationResponse

    @GET("api/todos")
    suspend fun todos(): TodosResponse

    @POST("api/todos")
    suspend fun addTodo(@Body body: TodoAddRequest): Response<CreatedIdResponse>

    @POST("api/todos/{id}")
    suspend fun todoAction(@Path("id") id: Long, @Body body: TodoActionRequest): Response<OkResponse>

    @POST("api/calendar/sync")
    suspend fun calendarSync(): Response<CalendarSyncResponse>

    @POST("api/assistant")
    suspend fun assistant(@Body body: AssistantRequest): AssistantResponse

    /* ---------- Chat ---------- */

    @GET("api/chat")
    suspend fun chatSessions(): ChatSessionsResponse

    @POST("api/chat")
    suspend fun createChatSession(@Body body: ChatCreateRequest): ChatSessionCreatedResponse

    @GET("api/chat/{sessionId}")
    suspend fun chatSession(@Path("sessionId") sessionId: String): ChatSessionResponse

    @PATCH("api/chat/{sessionId}")
    suspend fun patchChatSession(@Path("sessionId") sessionId: String, @Body body: ChatResetRequest): ChatSessionResponse

    @GET("api/support/faq")
    suspend fun faq(@Query("q") query: String): FaqResponse

    @POST("api/support/tickets")
    suspend fun createTicket(@Body body: CreateTicketRequest): Response<CreatedIdResponse>
}
