package ru.memo7.artel.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.memo7.artel.core.network.ApiFactory

/**
 * Plain JVM unit-тест контракта GamificationDto: сервер отдаёт levelProgress
 * как долю 0..1, и DTO обязан декодировать её в Double (не Float/Int).
 */
class GamificationDtoTest {

    private val json = ApiFactory.json

    @Test
    fun `levelProgress decodes to Double fraction`() {
        val payload =
            """
            {"xp":1705,"level":5,"levelProgress":0.11666666666666667,"nextLevelXp":2500,"streak":2,"bestStreak":2,"achievements":[]}
            """.trimIndent()

        val dto = json.decodeFromString<GamificationDto>(payload)

        // Уровень 5: floor = 100·4² = 1600, next = 100·5² = 2500 → 105/900.
        assertEquals(105.0 / 900.0, dto.levelProgress, 1e-12)
        assertTrue("levelProgress обязан попадать в 0..1", dto.levelProgress in 0.0..1.0)

        assertEquals(1705, dto.xp)
        assertEquals(5, dto.level)
        assertEquals(2500, dto.nextLevelXp)
        assertEquals(2, dto.streak)
        assertEquals(2, dto.bestStreak)
        assertTrue(dto.achievements.isEmpty())
    }

    @Test
    fun `levelProgress zero after level-up decodes from integer JSON literal`() {
        // На границе уровня сервер отдаёт 0 как целочисленный литерал JSON.
        val payload =
            """
            {"xp":1600,"level":5,"levelProgress":0,"nextLevelXp":2500,"streak":0,"bestStreak":0,"achievements":[]}
            """.trimIndent()

        val dto = json.decodeFromString<GamificationDto>(payload)

        assertEquals(0.0, dto.levelProgress, 0.0)
    }
}
