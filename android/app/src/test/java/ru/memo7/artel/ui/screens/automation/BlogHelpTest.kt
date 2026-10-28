package ru.memo7.artel.ui.screens.automation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BlogHelpTest {

    @Test
    fun `cheat sheet covers the five steps`() {
        assertEquals(5, blogHelpSteps.size)
        assertEquals("Выберите блог", blogHelpSteps.first().title)
        assertEquals("Проверьте результат", blogHelpSteps.last().title)
        assertTrue(blogHelpSteps.any { it.text.contains("«Блоги» → «Настройки»") })
        assertTrue(blogHelpSteps.any { it.text.contains("черновиком") })
    }

    @Test
    fun `telegram step uses the bot command`() {
        val step = blogHelpSteps.first { it.title.contains("Telegram") }
        assertTrue(step.text.startsWith(BLOG_POST_COMMAND))
        assertTrue(step.text.contains("/блоги"))
    }

    @Test
    fun `web settings url appends the page to the saved base url`() {
        assertEquals(
            "https://artel.example.com/api/blog/settings",
            blogSettingsUrl("https://artel.example.com/api/"),
        )
        assertEquals(
            "http://10.0.2.2:3000/blog/settings",
            blogSettingsUrl("10.0.2.2:3000"),
        )
    }

    @Test
    fun `web settings url is absent without a saved server`() {
        assertNull(blogSettingsUrl(null))
        assertNull(blogSettingsUrl("   "))
    }
}
