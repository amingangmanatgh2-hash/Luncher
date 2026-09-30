package com.dlck.lnch

import com.dlck.lnch.data.backup.BackupCodec
import com.dlck.lnch.data.backup.SettingsSnapshot
import com.dlck.lnch.data.prefs.AccentColor
import com.dlck.lnch.data.prefs.AppStateRepository
import com.dlck.lnch.data.prefs.DrawerSort
import com.dlck.lnch.data.prefs.FolderData
import com.dlck.lnch.data.prefs.GestureAction
import com.dlck.lnch.data.prefs.LauncherSettings
import com.dlck.lnch.data.prefs.ThemeMode
import com.dlck.lnch.data.prefs.UsageStat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A backup must round-trip exactly, tolerate junk, and never carry a credential. */
class BackupCodecTest {

    private val settings = LauncherSettings(
        themeMode = ThemeMode.DARK,
        accent = AccentColor.ROSE,
        drawerSort = DrawerSort.MOST_USED,
        gridColumns = 5,
        iconSizeDp = 64,
        persianDate = true,
        iconPack = "com.pack.one",
        showBadges = false,
        swipeUpAction = GestureAction.SETTINGS,
        doubleTapAction = GestureAction.NONE,
    )

    private val state = AppStateRepository.AppState(
        favorites = listOf("a/a", "b/b"),
        pinned = setOf("c/c"),
        hidden = setOf("d/d"),
        usage = mapOf("a/a" to UsageStat(launchCount = 3, lastLaunchedAt = 99L)),
        folders = listOf(FolderData("f1", "Work", listOf("a/a"))),
    )

    @Test
    fun `settings survive a round trip`() {
        val file = BackupCodec.build(settings, state, now = 1234L)
        val text = BackupCodec.encode(file)
        val decoded = BackupCodec.decode(text)
        assertNotNull(decoded)
        assertEquals(settings, BackupCodec.restore(decoded!!.settings, LauncherSettings()))
    }

    @Test
    fun `app state survives a round trip`() {
        val decoded = BackupCodec.decode(BackupCodec.encode(BackupCodec.build(settings, state, 1L)))!!
        assertEquals(listOf("a/a", "b/b"), decoded.favorites)
        assertEquals(listOf("c/c"), decoded.pinned)
        assertEquals(listOf("d/d"), decoded.hidden)
        assertEquals(1, decoded.folders.size)
        assertEquals("Work", decoded.folders.first().name)
        assertEquals(3, decoded.usage["a/a"]?.launchCount)
    }

    @Test
    fun `the export never contains a credential field`() {
        val text = BackupCodec.encode(BackupCodec.build(settings, state, 1L)).lowercase()
        assertFalse(text.contains("apikey"))
        assertFalse(text.contains("api_key"))
        assertFalse(text.contains("aiza"))
        assertFalse(text.contains("credential"))
    }

    @Test
    fun `junk and foreign json are rejected`() {
        assertNull(BackupCodec.decode("not json"))
        assertNull(BackupCodec.decode("<html>nope</html>"))
        assertNull(BackupCodec.decode("""{"format":99}"""))
    }

    @Test
    fun `unknown fields from a newer build are ignored`() {
        val text = """{"format":1,"favorites":["x/x"],"somethingNew":true}"""
        val decoded = BackupCodec.decode(text)
        assertNotNull(decoded)
        assertEquals(listOf("x/x"), decoded!!.favorites)
    }

    @Test
    fun `out-of-range values are clamped on restore`() {
        val snapshot = SettingsSnapshot(
            gridColumns = 99,
            iconSizeDp = 5,
            backgroundDim = 4f,
            favoritesRows = 0,
        )
        val restored = BackupCodec.restore(snapshot, LauncherSettings())
        assertEquals(6, restored.gridColumns)
        assertEquals(40, restored.iconSizeDp)
        assertEquals(0.9f, restored.backgroundDim, 0.001f)
        assertEquals(1, restored.favoritesRows)
    }

    @Test
    fun `an unreadable enum falls back to the current value`() {
        val snapshot = SettingsSnapshot(themeMode = "PLAID", accent = "OCTARINE")
        val current = LauncherSettings(themeMode = ThemeMode.LIGHT, accent = AccentColor.EMERALD)
        val restored = BackupCodec.restore(snapshot, current)
        assertEquals(ThemeMode.LIGHT, restored.themeMode)
        assertEquals(AccentColor.EMERALD, restored.accent)
    }

    @Test
    fun `the file carries a format version and a timestamp`() {
        val file = BackupCodec.build(settings, state, now = 555L)
        assertEquals(BackupCodec.FORMAT_VERSION, file.format)
        assertEquals(555L, file.createdAt)
        assertTrue(BackupCodec.encode(file).contains("\"format\""))
    }
}
