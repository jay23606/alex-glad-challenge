package ru.memo7.artel.ui.screens.todos

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Чистая валидация формы задачи (TodosScreen.canSubmitTodo). */
class CanSubmitTodoTest {

    @Test
    fun `blank text is rejected`() {
        assertFalse(canSubmitTodo("", "", 1))
        assertFalse(canSubmitTodo("   ", "", 1))
    }

    @Test
    fun `text at the 500 char boundary is accepted`() {
        assertTrue(canSubmitTodo("a".repeat(500), "", 1))
    }

    @Test
    fun `text beyond the limit is rejected`() {
        assertFalse(canSubmitTodo("a".repeat(501), "", 1))
    }

    @Test
    fun `hourly interval within bounds is accepted`() {
        assertTrue(canSubmitTodo("текст", "hourly", 1))
        assertTrue(canSubmitTodo("текст", "hourly", 168))
    }

    @Test
    fun `hourly interval out of bounds is rejected`() {
        assertFalse(canSubmitTodo("текст", "hourly", 0))
        assertFalse(canSubmitTodo("текст", "hourly", 169))
    }

    @Test
    fun `one-off todo ignores interval`() {
        assertTrue(canSubmitTodo("текст", "", 0))
        assertTrue(canSubmitTodo("текст", "daily", 169))
    }
}
