package ru.memo7.artel.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import ru.memo7.artel.core.network.ApiFactory

/**
 * Plain JVM unit-тест контракта AutomationRuleDto: сервер отдаёт blogSlug=null
 * для осиротевших правил (web /api/automation) — ответ обязан декодироваться
 * целиком, а stylePreset — приходить 'default'|'antonov' с дефолтом 'default'.
 */
class AutomationDtoTest {

    private val json = ApiFactory.json

    @Test
    fun `rule with null blogSlug and explicit stylePreset decodes`() {
        val payload = """
            {
              "ok": true,
              "rules": [
                {
                  "blogId": 99,
                  "blogSlug": null,
                  "blogName": "#99",
                  "stylePreset": "antonov",
                  "enabled": false,
                  "intervalMinutes": 1440,
                  "autoPublish": false,
                  "lastRunAt": null,
                  "nextRunAt": null
                }
              ],
              "runs": []
            }
            """.trimIndent()

        val dto = json.decodeFromString<AutomationResponse>(payload)

        val rule = dto.rules.single()
        assertNull("blogSlug осиротевшего правила обязан быть null", rule.blogSlug)
        assertEquals("antonov", rule.stylePreset)
        assertEquals(1440, rule.intervalMinutes)
        assertEquals(99L, rule.blogId)
        assertEquals("#99", rule.blogName)
    }

    @Test
    fun `rule without stylePreset defaults to default and keeps slug`() {
        val payload = """
            {
              "ok": true,
              "rules": [
                {
                  "blogId": 1,
                  "blogSlug": "main",
                  "blogName": "Главный",
                  "enabled": true,
                  "intervalMinutes": 60,
                  "autoPublish": true
                }
              ],
              "runs": []
            }
            """.trimIndent()

        val dto = json.decodeFromString<AutomationResponse>(payload)

        val rule = dto.rules.single()
        assertEquals("main", rule.blogSlug)
        assertEquals("default", rule.stylePreset)
        assertEquals(60, rule.intervalMinutes)
    }

    @Test
    fun `BlogStyleRequest encodes stylePreset for PATCH api-blogs-slug`() {
        val encoded = json.encodeToString(BlogStyleRequest.serializer(), BlogStyleRequest("antonov"))

        assertEquals("""{"stylePreset":"antonov"}""", encoded)
    }
}
