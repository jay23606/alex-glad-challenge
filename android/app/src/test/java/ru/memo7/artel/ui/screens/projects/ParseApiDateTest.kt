package ru.memo7.artel.ui.screens.projects

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * Plain JVM unit-тест parseApiDate: сервер хранит sqlite datetime('now')
 * «yyyy-MM-dd HH:mm:ss» в UTC — приводится к локальной зоне; ISO со смещением
 * и ISO-local берутся «настенным» временем как есть. Ожидания для UTC-дат
 * считаются от системной зоны, поэтому тест не зависит от машины/CI.
 */
class ParseApiDateTest {

    /** Момент UTC → локальное время на текущей машине (timezone-independent). */
    private fun utcToLocal(vararg parts: Int): LocalDateTime =
        LocalDateTime.of(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5])
            .atOffset(ZoneOffset.UTC)
            .atZoneSameInstant(ZoneId.systemDefault())
            .toLocalDateTime()

    @Test
    fun `sqlite datetime is utc and converts to local zone`() {
        assertEquals(
            utcToLocal(2026, 10, 25, 15, 52, 2),
            parseApiDate("2026-10-25 15:52:02"),
        )
    }

    @Test
    fun `sqlite datetime is truncated to seconds and converted`() {
        assertEquals(
            utcToLocal(2026, 1, 1, 0, 0, 0),
            parseApiDate("2026-01-01 00:00:00"),
        )
    }

    @Test
    fun `iso datetime with offset keeps wall time`() {
        assertEquals(
            LocalDateTime.of(2026, 10, 25, 15, 52, 2),
            parseApiDate("2026-10-25T15:52:02+03:00"),
        )
    }

    @Test
    fun `iso datetime without offset keeps wall time`() {
        assertEquals(
            LocalDateTime.of(2026, 10, 25, 15, 52, 0),
            parseApiDate("2026-10-25T15:52:00"),
        )
    }

    @Test
    fun `blank and malformed values return null`() {
        assertNull(parseApiDate(null))
        assertNull(parseApiDate(""))
        assertNull(parseApiDate("   "))
        assertNull(parseApiDate("not-a-date"))
    }
}
