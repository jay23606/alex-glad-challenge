package ru.memo7.artel.data.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/* ---------- Gamification / bootstrap ---------- */

@Serializable
data class AchievementDto(
    val code: String,
    val title: String,
    val description: String,
    val unlocked: Boolean,
)

@Serializable
data class GamificationDto(
    val xp: Int,
    val level: Int,
    // Сервер отдаёт долю прогресса до следующего уровня: 0..1
    @SerialName("levelProgress") val levelProgress: Double,
    @SerialName("nextLevelXp") val nextLevelXp: Int,
    val streak: Int,
    @SerialName("bestStreak") val bestStreak: Int,
    val achievements: List<AchievementDto> = emptyList(),
)

@Serializable
data class NotificationsSummaryDto(
    val unread: Int,
)

@Serializable
data class WorkspaceCountsDto(
    val projects: Int,
    @SerialName("openTasks") val openTasks: Int,
    @SerialName("enabledRules") val enabledRules: Int,
)

@Serializable
data class BootstrapResponse(
    val ok: Boolean,
    val app: String,
    val gamification: GamificationDto,
    val notifications: NotificationsSummaryDto,
    val counts: WorkspaceCountsDto,
)

@Serializable
data class GamificationEventDto(
    val id: Int,
    val type: String,
    val points: Int,
    @SerialName("createdAt") val createdAt: String,
)

/* ---------- Projects ---------- */

@Serializable
data class ProjectDto(
    val id: Long,
    val name: String,
    val description: String? = null,
    val color: String? = null,
    val status: String,
    @SerialName("createdAt") val createdAt: String,
)

@Serializable
data class ProjectsResponse(
    val ok: Boolean,
    val projects: List<ProjectDto> = emptyList(),
)

@Serializable
data class CreateProjectRequest(
    val name: String,
    val description: String? = null,
    val color: String? = null,
)

@Serializable
data class CreatedIdResponse(
    val ok: Boolean,
    val id: Long,
)

/* ---------- Workspace items ---------- */

@Serializable
data class WorkspaceItemDto(
    val id: Long,
    val projectId: Long,
    val folderId: Long? = null,
    val kind: String,
    val title: String,
    val body: String,
    val url: String? = null,
    val dueAt: String? = null,
    val done: Boolean,
    val createdAt: String,
)

@Serializable
data class ItemsResponse(
    val ok: Boolean,
    val items: List<WorkspaceItemDto> = emptyList(),
)

@Serializable
data class CreateItemRequest(
    val projectId: Long,
    val title: String,
    val kind: String = "note",
    val body: String? = null,
    val url: String? = null,
    val dueAt: String? = null,
    val folderId: Long? = null,
)

@Serializable
data class PatchItemRequest(
    val id: Long,
    val done: Boolean,
)

@Serializable
data class OkResponse(
    val ok: Boolean,
)

/* ---------- Notifications ---------- */

@Serializable
data class NotificationDto(
    val id: Long,
    val type: String,
    val title: String,
    val body: String,
    val href: String? = null,
    val read: Boolean,
    val createdAt: String,
)

@Serializable
data class NotificationsResponse(
    val ok: Boolean,
    val unread: Int,
    val notifications: List<NotificationDto> = emptyList(),
)

@Serializable
data class NotificationActionRequest(
    val action: String,
    val id: Long? = null,
)

/* ---------- Automation ---------- */

@Serializable
data class AutomationRuleDto(
    val blogId: Long,
    val blogSlug: String,
    val blogName: String,
    val enabled: Boolean,
    val intervalMinutes: Int,
    val autoPublish: Boolean,
    val lastRunAt: String? = null,
    val nextRunAt: String? = null,
)

@Serializable
data class AutomationRunDto(
    val id: Long,
    val blogId: Long,
    val status: String,
    val message: String,
    val startedAt: String,
    val finishedAt: String? = null,
)

@Serializable
data class AutomationResponse(
    val ok: Boolean,
    val rules: List<AutomationRuleDto> = emptyList(),
    val runs: List<AutomationRunDto> = emptyList(),
)

@Serializable
data class AutomationRunRequest(
    val action: String = "run",
    val blogId: Long,
)

@Serializable
data class AutomationRunResponse(
    val ok: Boolean,
    val status: String,
    val message: String,
)

@Serializable
data class AutomationConfigureRequest(
    val action: String = "configure",
    val blogId: Long,
    val enabled: Boolean,
    val intervalMinutes: Int,
    val autoPublish: Boolean,
)

/* ---------- Calendar ---------- */

@Serializable
data class CalendarEventDto(
    val uid: String,
    val title: String,
    val description: String,
    val start: String,
    val end: String? = null,
    val href: String? = null,
    val source: String,
)

@Serializable
data class CalendarResponse(
    val ok: Boolean,
    val googleConfigured: Boolean,
    val events: List<CalendarEventDto> = emptyList(),
)

@Serializable
data class CalendarSyncResponse(
    val ok: Boolean,
    val synced: Int,
)

/* ---------- Assistant ---------- */

@Serializable
data class AssistantRequest(
    val message: String,
)

@Serializable
data class AssistantResponse(
    val ok: Boolean,
    val answer: String,
)

/* ---------- Support ---------- */

@Serializable
data class FaqItemDto(
    val question: String,
    val answer: String,
    val score: Double,
)

@Serializable
data class FaqResponse(
    val ok: Boolean,
    val results: List<FaqItemDto> = emptyList(),
)

@Serializable
data class CreateTicketRequest(
    val subject: String,
    val body: String,
    val contact: String? = null,
)

/* ---------- Raw error body ---------- */

@Serializable
data class ErrorResponse(
    val error: String,
)
