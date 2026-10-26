// Чистый парсер SSE-стрима POST /api/chat/[sessionId] (web): безымянные события
// `data: <JSON>` через `\n\n`; конец потока = закрытие соединения сервером
// (сентинела [DONE] нет). Пользователь потока кормит буфер после каждого чанка.
package ru.memo7.artel.data.api

import ru.memo7.artel.core.network.ApiFactory

/** Событие стрима чата в терминах клиента. */
sealed interface ChatStreamEvent {
    /** Очередной фрагмент текста ответа. */
    data class Token(val delta: String) : ChatStreamEvent

    /** Ответ завершён: канонический текст и счётчик токенов. */
    data class Done(val answer: String?, val usage: ChatUsageDto?) : ChatStreamEvent

    /** Ошибка, сообщённая сервером внутри стрима. */
    data class Failure(val message: String) : ChatStreamEvent
}

/**
 * Feed-based парсер: [drain] разбирает и удаляет из буфера все ПОЛНЫЕ блоки
 * (`...\n\n`), оставляя хвост недописанного события нетронутым. Буфер ожидается
 * в `\n`-нормализованном виде (OkHttp readUtf8Line уже срезает `\r`).
 */
object ChatSseParser {

    fun drain(buffer: StringBuilder, onEvent: (ChatStreamEvent) -> Unit) {
        var index = buffer.indexOf(BLOCK_SEPARATOR)
        while (index >= 0) {
            val block = buffer.substring(0, index)
            buffer.delete(0, index + BLOCK_SEPARATOR.length)
            eventPayload(block)?.let { payload -> decode(payload)?.let(onEvent) }
            index = buffer.indexOf(BLOCK_SEPARATOR)
        }
    }

    /** `data:`-строки блока, склеенные через `\n` (многострочный JSON не встречается, но валиден). */
    private fun eventPayload(block: String): String? {
        val data = block
            .lineSequence()
            .filter { it.startsWith("data:") }
            .joinToString("\n") { it.removePrefix("data:").trim() }
        return data.ifEmpty { null }
    }

    /** Битый/чужой payload молча пропускается: стрим не должен ронять экран. */
    private fun decode(payload: String): ChatStreamEvent? = runCatching {
        val event = ApiFactory.json.decodeFromString(ChatSseEventDto.serializer(), payload)
        when (event.type) {
            "token" -> ChatStreamEvent.Token(event.delta ?: "")
            "done" -> ChatStreamEvent.Done(event.answer, event.usage)
            "error" -> ChatStreamEvent.Failure(event.message ?: "Ответ сервера не описал ошибку")
            else -> null
        }
    }.getOrNull()

    private const val BLOCK_SEPARATOR = "\n\n"
}
