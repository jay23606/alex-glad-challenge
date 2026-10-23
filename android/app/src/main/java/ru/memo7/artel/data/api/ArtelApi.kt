package ru.memo7.artel.data.api

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Query

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

    @PATCH("api/workspace/items")
    suspend fun patchItem(@Body body: PatchItemRequest): Response<OkResponse>

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

    @GET("api/calendar")
    suspend fun calendar(@Query("days") days: Int = 30): CalendarResponse

    @POST("api/calendar/sync")
    suspend fun calendarSync(): Response<CalendarSyncResponse>

    @POST("api/assistant")
    suspend fun assistant(@Body body: AssistantRequest): AssistantResponse

    @GET("api/support/faq")
    suspend fun faq(@Query("q") query: String): FaqResponse

    @POST("api/support/tickets")
    suspend fun createTicket(@Body body: CreateTicketRequest): Response<CreatedIdResponse>
}
