package ru.memo7.artel.ui.screens.gamification

import org.junit.Assert.assertEquals
import org.junit.Test

/** Подписи типов XP-событий (GamificationScreen.eventLabel). */
class EventLabelTest {

    @Test
    fun `known event types are labeled`() {
        assertEquals("Публикация поста", eventLabel("post_published"))
        assertEquals("Задача выполнена", eventLabel("todo_completed"))
        assertEquals("Элемент проекта", eventLabel("workspace_item"))
        assertEquals("Прогон автоматизации", eventLabel("automation_run"))
        assertEquals("Обращение к ассистенту", eventLabel("assistant_used"))
        assertEquals("Обращение в поддержку", eventLabel("support_ticket"))
        assertEquals("XP за игру: победа", eventLabel("tg_game_win"))
        assertEquals("XP за игру: участие", eventLabel("tg_game_play"))
    }

    @Test
    fun `unknown event type falls back to raw value`() {
        assertEquals("mystery", eventLabel("mystery"))
    }
}
