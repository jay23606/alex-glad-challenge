package ru.memo7.artel.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import ru.memo7.artel.core.network.ApiFactory

/** Контракт POST /api/mobile/login: 200-тело и error-тело. */
class AuthApiContractTest {

    private val json = ApiFactory.json

    @Test
    fun `login success decodes token and expiresAt`() {
        val response = json.decodeFromString(
            LoginResponse.serializer(),
            """{"ok":true,"token":"1760000000000.deadbeef","expiresAt":1760000000000}""",
        )

        assertEquals(true, response.ok)
        assertEquals("1760000000000.deadbeef", response.token)
        assertEquals(1_760_000_000_000L, response.expiresAt)
        assertNull(response.error)
    }

    @Test
    fun `error body keeps server message`() {
        val error = json.decodeFromString(
            ErrorResponse.serializer(),
            """{"ok":false,"error":"Неверный пароль"}""",
        )

        assertEquals("Неверный пароль", error.error)
    }

    @Test
    fun `login response without token keeps null`() {
        val response = json.decodeFromString(
            LoginResponse.serializer(),
            """{"ok":true,"expiresAt":1760000000000}""",
        )

        assertNull(response.token)
    }
}
