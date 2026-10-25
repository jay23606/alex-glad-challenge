package ru.memo7.artel.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.memo7.artel.core.network.ApiFactory

/**
 * Plain JVM unit-тест контракта GamificationResponse (GET /api/gamification):
 * stats + achievements + events; levelProgress обязан декодироваться в Double.
 */
class GamificationResponseDtoTest {

    private val json = ApiFactory.json

    @Test
    fun `response decodes stats achievements and events`() {
        val payload = """
            {
              "ok": true,
              "stats": {"xp":1705,"level":5,"levelProgress":0.11666666666666667,"nextLevelXp":2500,"streak":2,"bestStreak":2},
              "achievements": [
                {"code":"first-task","title":"Первый шаг","description":"Выполните первую задачу","unlocked":true},
                {"code":"streak-7","title":"Неделя в огне","description":"Серия 7 дней","unlocked":false}
              ],
              "events": [
                {"id":12,"type":"todo_completed","points":10,"createdAt":"2026-10-25 15:51:58"},
                {"id":11,"type":"post_published","points":25,"createdAt":"2026-10-24 12:00:00"}
              ]
            }
        """.trimIndent()

        val response = json.decodeFromString<GamificationResponse>(payload)

        // levelProgress — Double-доля 0..1, не Float/Int/процент.
        assertEquals(105.0 / 900.0, response.stats.levelProgress, 1e-12)
        assertTrue("levelProgress обязан попадать в 0..1", response.stats.levelProgress in 0.0..1.0)
        assertEquals(1705, response.stats.xp)
        assertEquals(5, response.stats.level)

        assertEquals(2, response.achievements.size)
        assertEquals("first-task", response.achievements[0].code)
        assertTrue(response.achievements[0].unlocked)
        assertTrue(!response.achievements[1].unlocked)

        assertEquals(2, response.events.size)
        assertEquals("todo_completed", response.events[0].type)
        assertEquals(10, response.events[0].points)
        assertEquals("2026-10-25 15:51:58", response.events[0].createdAt)
    }

    @Test
    fun `integer levelProgress literal decodes to Double zero`() {
        // На границе уровня сервер отдаёт 0 как целочисленный литерал JSON.
        val payload = """
            {"stats":{"xp":1600,"level":5,"levelProgress":0,"nextLevelXp":2500,"streak":0,"bestStreak":0},"achievements":[],"events":[]}
        """.trimIndent()

        val response = json.decodeFromString<GamificationResponse>(payload)

        assertEquals(0.0, response.stats.levelProgress, 0.0)
        assertTrue(response.events.isEmpty())
        assertTrue(response.achievements.isEmpty())
    }
}
