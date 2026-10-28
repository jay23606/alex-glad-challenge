package ru.memo7.artel.ui.screens.connect

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Валидация и человекочитаемые ошибки экрана входа. */
class ConnectRulesTest {

    @Test
    fun `validate asks for server address`() {
        assertEquals("Введите адрес сервера", ConnectRules.validate("   ", "password"))
    }

    @Test
    fun `validate asks for password`() {
        assertEquals("Введите пароль", ConnectRules.validate("http://10.0.2.2:3000", "  "))
    }

    @Test
    fun `validate trims correct input`() {
        assertNull(ConnectRules.validate("  https://artel.example.com  ", " password "))
    }

    @Test
    fun `cleartext failure explains https requirement`() {
        val message = "Cleartext HTTP traffic to artel.example.com not permitted"
        assertEquals(
            "Сервер требует защищённое соединение: release-сборка подключается только по https://",
            ConnectRules.describeConnectFailure(message),
        )
    }

    @Test
    fun `unresolved host explains address check`() {
        val message = "Unable to resolve host \"artel.example.com\": No address associated with hostname"
        assertEquals(
            "Не удаётся найти сервер по адресу — проверьте адрес",
            ConnectRules.describeConnectFailure(message),
        )
    }

    @Test
    fun `connect timeout explains address and network`() {
        val message = "failed to connect to /10.0.2.2 (port 3000) from /10.0.2.15 (port 41378) after 15000ms"
        assertEquals(
            "Сервер не отвечает — проверьте адрес и сеть",
            ConnectRules.describeConnectFailure(message),
        )
    }

    @Test
    fun `connection refused maps to same hint`() {
        assertEquals(
            "Сервер не отвечает — проверьте адрес и сеть",
            ConnectRules.describeConnectFailure("Failed to connect to server/192.168.1.50:3000"),
        )
    }

    @Test
    fun `other failure keeps original text`() {
        assertEquals(
            "Сервер недоступен: java.net.SocketException: Broken pipe",
            ConnectRules.describeConnectFailure("java.net.SocketException: Broken pipe"),
        )
    }

    @Test
    fun `null message falls back`() {
        assertEquals("Сервер недоступен: нет соединения", ConnectRules.describeConnectFailure(null))
    }
}
