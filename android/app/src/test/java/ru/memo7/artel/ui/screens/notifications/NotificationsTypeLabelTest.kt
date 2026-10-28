package ru.memo7.artel.ui.screens.notifications

import org.junit.Assert.assertEquals
import org.junit.Test

/** Подписи типов уведомлений (NotificationsScreen.typeLabel). */
class NotificationsTypeLabelTest {

    @Test
    fun `server notification types are labeled`() {
        assertEquals("Публикация", typeLabel("post_published"))
        assertEquals("Напоминание", typeLabel("todo_due"))
        assertEquals("Автоматизация", typeLabel("automation"))
        assertEquals("Система", typeLabel("system"))
    }

    @Test
    fun `legacy fallback types are labeled`() {
        assertEquals("Геймификация", typeLabel("gamification"))
        assertEquals("Проекты", typeLabel("workspace"))
        assertEquals("Поддержка", typeLabel("support"))
    }

    @Test
    fun `matching ignores case`() {
        assertEquals("Система", typeLabel("SYSTEM"))
    }

    @Test
    fun `unknown type falls back to raw value`() {
        assertEquals("custom_kind", typeLabel("custom_kind"))
    }
}
