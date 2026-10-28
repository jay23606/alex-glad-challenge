package ru.memo7.artel.data

import org.junit.Assert.assertEquals
import org.junit.Test

/** Один контракт нормализации для token-клиента и login-клиента. */
class NormalizeBaseUrlTest {

    @Test
    fun `adds http scheme and trailing slash`() {
        assertEquals("http://10.0.2.2:3000/", normalizeBaseUrl("10.0.2.2:3000"))
    }

    @Test
    fun `keeps https and path prefix`() {
        assertEquals(
            "https://artel.example.com/api/",
            normalizeBaseUrl(" https://artel.example.com/api/ "),
        )
    }

    @Test
    fun `keeps existing trailing slash single`() {
        assertEquals("http://127.0.0.1:3000/", normalizeBaseUrl("http://127.0.0.1:3000/"))
    }
}
