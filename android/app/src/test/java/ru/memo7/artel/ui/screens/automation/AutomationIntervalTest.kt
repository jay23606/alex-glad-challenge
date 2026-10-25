package ru.memo7.artel.ui.screens.automation

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Интервалы автоматизации (AutomationScreen): nearestPreset — только для
 * отображения, intervalToSave — исходное значение не переписывается молча.
 */
class AutomationIntervalTest {

    @Test
    fun `preset value selects itself`() {
        assertEquals(5, nearestPreset(5))
        assertEquals(60, nearestPreset(60))
        assertEquals(1440, nearestPreset(1440))
    }

    @Test
    fun `legacy value between presets rounds up for display`() {
        assertEquals(5, nearestPreset(1))
        assertEquals(180, nearestPreset(90))
    }

    @Test
    fun `huge legacy value clamps to the last preset`() {
        assertEquals(1440, nearestPreset(10080))
    }

    @Test
    fun `no-op save keeps the stored interval unchanged`() {
        assertEquals(10080, intervalToSave(ruleIntervalMinutes = 10080, pickedPreset = null))
    }

    @Test
    fun `user picked preset is sent as is`() {
        assertEquals(60, intervalToSave(ruleIntervalMinutes = 10080, pickedPreset = 60))
    }
}
