package ru.memo7.artel.ui.screens.dashboard

import org.junit.Assert.assertEquals
import org.junit.Test

/** Русская плюрализация счётчиков дашборда (DashboardScreen.pluralRu). */
class PluralRuTest {

    @Test
    fun `pluralRu picks one few many per russian rules`() {
        // n, one, few, many
        assertEquals("проектов", pluralRu(0, "проект", "проекта", "проектов"))
        assertEquals("проект", pluralRu(1, "проект", "проекта", "проектов"))
        assertEquals("проекта", pluralRu(2, "проект", "проекта", "проектов"))
        assertEquals("проекта", pluralRu(4, "проект", "проекта", "проектов"))
        assertEquals("проектов", pluralRu(5, "проект", "проекта", "проектов"))
        assertEquals("проектов", pluralRu(11, "проект", "проекта", "проектов"))
        assertEquals("проект", pluralRu(21, "проект", "проекта", "проектов"))
        assertEquals("проекта", pluralRu(22, "проект", "проекта", "проектов"))
        assertEquals("проектов", pluralRu(25, "проект", "проекта", "проектов"))
    }

    @Test
    fun `pluralRu handles teens and hundreds endings`() {
        assertEquals("задач", pluralRu(12, "задача", "задачи", "задач"))
        assertEquals("задач", pluralRu(14, "задача", "задачи", "задач"))
        assertEquals("задача", pluralRu(101, "задача", "задачи", "задач"))
        assertEquals("задачи", pluralRu(104, "задача", "задачи", "задач"))
        assertEquals("новых", pluralRu(111, "новое", "новых", "новых"))
    }
}
