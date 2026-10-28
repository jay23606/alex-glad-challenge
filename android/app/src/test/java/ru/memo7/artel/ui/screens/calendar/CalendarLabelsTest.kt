package ru.memo7.artel.ui.screens.calendar

import org.junit.Assert.assertEquals
import org.junit.Test

/** Подписи источников событий календаря (CalendarScreen.sourceLabel). */
class CalendarLabelsTest {

    @Test
    fun `workspace maps to task label`() {
        assertEquals("Задача", sourceLabel("workspace"))
    }

    @Test
    fun `todo maps to reminder label`() {
        assertEquals("Напоминание", sourceLabel("todo"))
    }

    @Test
    fun `matching is case insensitive`() {
        assertEquals("Задача", sourceLabel("Workspace"))
        assertEquals("Напоминание", sourceLabel("TODO"))
    }

    @Test
    fun `unknown source is shown as is`() {
        assertEquals("google", sourceLabel("google"))
    }
}
