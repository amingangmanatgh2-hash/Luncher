package com.dlck.lnch.ui.launcher

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import com.dlck.lnch.ui.theme.ClockTextStyle
import com.dlck.lnch.utils.JalaliDate
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Live clock + date.
 *
 * It recomposes once per minute (not per second) so an idle home screen costs virtually no CPU.
 */
@Composable
fun ClockWidget(
    showClock: Boolean,
    showDate: Boolean,
    use24Hour: Boolean,
    persianDate: Boolean,
    contentColor: Color,
    onClockClick: () -> Unit,
    onDateClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }

    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            // Sleep exactly until the next minute boundary.
            val millisIntoMinute = now % 60_000L
            delay(60_000L - millisIntoMinute + 50L)
        }
    }

    val locale = Locale.getDefault()
    val calendar = remember(now) { Calendar.getInstance().apply { timeInMillis = now } }

    val timeText = remember(now, use24Hour, locale) {
        val pattern = if (use24Hour) "HH:mm" else "h:mm a"
        SimpleDateFormat(pattern, locale).format(Date(now))
    }

    val dateText = remember(now, persianDate, locale) {
        if (persianDate) {
            JalaliDate.formatPersian(calendar)
        } else {
            SimpleDateFormat("EEEE, d MMMM", locale).format(Date(now))
        }
    }

    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dpCompat()),
    ) {
        if (showClock) {
            Text(
                text = timeText,
                style = ClockTextStyle,
                color = contentColor,
                textAlign = TextAlign.Center,
                modifier = Modifier.clickable(onClick = onClockClick),
            )
        }
        if (showDate) {
            Text(
                text = dateText,
                style = MaterialTheme.typography.titleSmall,
                color = contentColor.copy(alpha = 0.85f),
                textAlign = TextAlign.Center,
                modifier = Modifier.clickable(onClick = onDateClick),
            )
        }
    }
}

private fun Int.dpCompat() = androidx.compose.ui.unit.Dp(this.toFloat())
