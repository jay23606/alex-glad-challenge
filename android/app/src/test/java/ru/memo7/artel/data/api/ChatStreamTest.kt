// Чистые тесты парсера SSE-стрима чата: без подмены сети — только строки и события.
package ru.memo7.artel.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatStreamTest {

    private fun drain(text: String): Pair<List<ChatStreamEvent>, String> {
        val buffer = StringBuilder(text)
        val events = mutableListOf<ChatStreamEvent>()
        ChatSseParser.drain(buffer) { events += it }
        return events to buffer.toString()
    }

    @Test
    fun `drain разбирает token done error последовательно`() {
        val (events, remainder) = drain(
            "data: {\"type\":\"token\",\"delta\":\"при\"}\n\n" +
                "data: {\"type\":\"done\",\"answer\":\"привет\",\"usage\":{\"prompt_tokens\":120,\"completion_tokens\":34,\"total_tokens\":154}}\n\n" +
                "data: {\"type\":\"error\",\"message\":\"ссессия оборвалась\"}\n\n",
        )
        assertEquals(
            listOf(
                ChatStreamEvent.Token("при"),
                ChatStreamEvent.Done("привет", ChatUsageDto(120, 34, 154)),
                ChatStreamEvent.Failure("ссессия оборвалась"),
            ),
            events,
        )
        assertEquals("", remainder)
    }

    @Test
    fun `дописывание чанков - незакрытое событие остаётся в буфере`() {
        val (first, remainder) = drain(
            "data: {\"type\":\"token\",\"delta\":\"при\"}\n\ndata: {\"type\":\"done\",",
        )
        assertEquals(listOf<ChatStreamEvent>(ChatStreamEvent.Token("при")), first)
        assertTrue(remainder.startsWith("data: {\"type\":\"done\","))

        val (second, empty) = drain(remainder + "\"answer\":\"привет\"}\n\n")
        assertEquals(listOf<ChatStreamEvent>(ChatStreamEvent.Done("привет", null)), second)
        assertEquals("", empty)
    }

    @Test
    fun `битый json пропускается, поток не падает`() {
        val (events, remainder) = drain(
            "data: точно не json\n\ndata: {\"type\":\"token\",\"delta\":\"ок\"}\n\n",
        )
        assertEquals(listOf<ChatStreamEvent>(ChatStreamEvent.Token("ок")), events)
        assertEquals("", remainder)
    }

    @Test
    fun `не-data строки и неизвестный тип события игнорируются`() {
        val (events, remainder) = drain(
            "event: tease\ndata: {\"type\":\"stage\",\"label\":\"думаю\"}\n\n" +
                ": keepalive\n\n" +
                "data: {\"type\":\"token\",\"delta\":\"привет\"}\n\n",
        )
        assertEquals(listOf<ChatStreamEvent>(ChatStreamEvent.Token("привет")), events)
        assertEquals("", remainder)
    }

    @Test
    fun `пробелы после data допускаются`() {
        val (events, remainder) = drain("data:   {\"type\":\"token\",\"delta\":\"ок\"}\n\n")
        assertEquals(listOf<ChatStreamEvent>(ChatStreamEvent.Token("ок")), events)
        assertEquals("", remainder)
    }
}
