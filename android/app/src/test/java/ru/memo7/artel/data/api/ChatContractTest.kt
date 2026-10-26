// Контракт chat DTO против реального JSON web API (аналог AuthApiContractTest).
package ru.memo7.artel.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import ru.memo7.artel.core.network.ApiFactory

class ChatContractTest {

    private val json = ApiFactory.json

    @Test
    fun `session decode с сообщениями и usage`() {
        val response = json.decodeFromString(
            ChatSessionResponse.serializer(),
            """{"session":{"id":"s-abc","strategy":"sliding","system":"ты друх","windowSize":10,
                "usage":{"prompt_tokens":11,"completion_tokens":22,"total_tokens":33},
                "messages":[{"role":"user","content":"ку","ts":"2026"}, {"role":"assistant","content":"прив"}],
                "futureField":42}}""",
        )
        val session = response.session
        assertEquals("s-abc", session.id)
        assertEquals("sliding", session.strategy)
        assertEquals("ты друх", session.system)
        assertEquals(33, session.usage?.total_tokens)
        assertEquals(2, session.messages.size)
        assertEquals("ку", session.messages[0].content)
    }

    @Test
    fun `sessions list decode`() {
        val response = json.decodeFromString(
            ChatSessionsResponse.serializer(),
            """{"sessions":[
                {"id":"s-one","strategy":"full","messageCount":4,"updatedAt":"t"},
                {"id":"s-two","strategy":"branching","memoryEnabled":true,"messageCount":0}]}""",
        )
        assertEquals(2, response.sessions.size)
        assertNull(response.sessions[0].system)
        assertFalse(response.sessions[0].memoryEnabled)
        assertEquals("s-two", response.sessions[1].id)
    }

    @Test
    fun `send request omit llm when null`() {
        val encoded = json.encodeToString(ChatSendRequest.serializer(), ChatSendRequest(text = "ку"))
        assertEquals("""{"text":"ку"}""", encoded)
        assertFalse(encoded.contains("llm"))
    }

    @Test
    fun `create request with system`() {
        val encoded = json.encodeToString(
            ChatCreateRequest.serializer(),
            ChatCreateRequest(strategy = "branching", system = " slippery"),
        )
        assertEquals("""{"strategy":"branching","system":" slippery"}""", encoded)
    }
}
