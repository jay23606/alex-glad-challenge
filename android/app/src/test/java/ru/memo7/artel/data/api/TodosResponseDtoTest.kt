package ru.memo7.artel.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import ru.memo7.artel.core.network.ApiFactory

/**
 * Plain JVM unit-тест контракта TodosResponse (GET /api/todos): поля snake_case
 * (scheduled_at/day_of_week/interval_hours/created_at) обязаны маппиться в camelCase,
 * recurring у разовых задач — null.
 */
class TodosResponseDtoTest {

    private val json = ApiFactory.json

    @Test
    fun `todos decode from snake_case payload`() {
        val payload = """
            {"todos":[
              {"id":7,"text":"Разовая задача","scheduled_at":"2026-10-26T18:00","recurring":null,
               "day_of_week":null,"interval_hours":null,"status":"pending","created_at":"2026-10-25 15:51:58"},
              {"id":8,"text":"Каждое утро","recurring":"daily","status":"done","created_at":"2026-10-25 10:00:00"},
              {"id":9,"text":"По вторникам","recurring":"weekly","day_of_week":2,"status":"pending","created_at":"2026-10-25 10:00:00"},
              {"id":10,"text":"Каждые 3 часа","recurring":"hourly","interval_hours":3,"status":"dismissed","created_at":"2026-10-25 10:00:00"}
            ]}
        """.trimIndent()

        val response = json.decodeFromString<TodosResponse>(payload)

        assertEquals(4, response.todos.size)

        val oneOff = response.todos[0]
        assertEquals(7L, oneOff.id)
        assertEquals("Разовая задача", oneOff.text)
        assertEquals("2026-10-26T18:00", oneOff.scheduledAt)
        assertNull("recurring у разовой задачи обязан быть null", oneOff.recurring)
        assertNull(oneOff.dayOfWeek)
        assertNull(oneOff.intervalHours)
        assertEquals("pending", oneOff.status)
        assertEquals("2026-10-25 15:51:58", oneOff.createdAt)

        assertEquals("daily", response.todos[1].recurring)
        assertEquals("done", response.todos[1].status)
        assertEquals(2, response.todos[2].dayOfWeek)
        assertEquals(3, response.todos[3].intervalHours)
        assertEquals("dismissed", response.todos[3].status)
    }

    @Test
    fun `add request serializes camelCase interval and omits nulls`() {
        val request = TodoAddRequest(text = "Раз в 2 часа", recurring = "hourly", intervalHours = 2)

        val encoded = json.encodeToString(TodoAddRequest.serializer(), request)

        // Схема сервера (todoAddSchema) ждёт intervalHours; null-поля не кодируются.
        assertEquals(
            """{"text":"Раз в 2 часа","recurring":"hourly","intervalHours":2}""",
            encoded,
        )

        val withoutRecurrence = json.encodeToString(
            TodoAddRequest.serializer(),
            TodoAddRequest(text = "Разовая"),
        )
        assertEquals("""{"text":"Разовая"}""", withoutRecurrence)
    }
}
