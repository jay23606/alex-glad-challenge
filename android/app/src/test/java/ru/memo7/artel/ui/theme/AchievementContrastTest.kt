package ru.memo7.artel.ui.theme

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * WCAG AA (>= 4.5:1) для карточек достижений на реальных цветах темы (#120).
 * Чистая Kotlin-математика sRGB, без Android-фреймворка.
 */
class AchievementContrastTest {

    private fun linear(c: Float): Double {
        val v = c.toDouble()
        return if (v <= 0.04045) v / 12.92 else Math.pow((v + 0.055) / 1.055, 2.4)
    }

    private fun luminance(color: Color): Double =
        0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue)

    private fun ratio(a: Color, b: Color): Double {
        val la = luminance(a)
        val lb = luminance(b)
        return (maxOf(la, lb) + 0.05) / (minOf(la, lb) + 0.05)
    }

    /** Полупрозрачный [fg] с альфой [alpha] поверх непрозрачного [bg]. */
    private fun blend(fg: Color, alpha: Float, bg: Color): Color = Color(
        red = fg.red * alpha + bg.red * (1 - alpha),
        green = fg.green * alpha + bg.green * (1 - alpha),
        blue = fg.blue * alpha + bg.blue * (1 - alpha),
    )

    private val schemes = listOf(LightColors, DarkColors)

    @Test
    fun `unlocked title and description meet AA in both themes`() {
        for (colors in schemes) {
            assertTrue(ratio(colors.onSecondary, colors.secondary) >= 4.5)
        }
    }

    @Test
    fun `locked title and description meet AA on 50 percent surfaceVariant card`() {
        for (colors in schemes) {
            val card = blend(colors.surfaceVariant, 0.5f, colors.background)
            assertTrue(ratio(colors.onBackground, card) >= 4.5)
        }
    }

    @Test
    fun `achievement pills meet AA in both themes`() {
        for (colors in schemes) {
            // unlocked: content secondary on container onSecondary
            assertTrue(ratio(colors.secondary, colors.onSecondary) >= 4.5)
            // locked: content background on container onBackground
            assertTrue(ratio(colors.background, colors.onBackground) >= 4.5)
        }
    }
}
