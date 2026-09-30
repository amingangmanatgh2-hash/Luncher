package com.dlck.lnch

import com.dlck.lnch.data.prefs.FolderData
import com.dlck.lnch.utils.FolderOps
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Folder rules: unique ids, one folder per app, no empty leftovers, sane names. */
class FolderOpsTest {

    private val base = listOf(
        FolderData("f1", "Work", listOf("a/a", "b/b")),
        FolderData("f2", "Play", listOf("c/c")),
    )

    @Test
    fun `create appends a folder with a unique id`() {
        val result = FolderOps.create(base, "Media", listOf("d/d"), now = 100L)
        assertEquals(3, result.size)
        assertEquals("Media", result.last().name)
        assertEquals(listOf("d/d"), result.last().items)
        assertEquals(3, result.map { it.id }.distinct().size)
    }

    @Test
    fun `ids never collide even at the same millisecond`() {
        var folders = FolderOps.create(emptyList(), "One", now = 7L)
        folders = FolderOps.create(folders, "Two", now = 7L)
        folders = FolderOps.create(folders, "Three", now = 7L)
        assertEquals(3, folders.map { it.id }.distinct().size)
    }

    @Test
    fun `an app lives in exactly one folder`() {
        val moved = FolderOps.addApp(base, "f2", "a/a")
        assertEquals(listOf("b/b"), moved.first { it.id == "f1" }.items)
        assertEquals(listOf("c/c", "a/a"), moved.first { it.id == "f2" }.items)
    }

    @Test
    fun `adding twice does not duplicate`() {
        val once = FolderOps.addApp(base, "f1", "a/a")
        assertEquals(listOf("a/a", "b/b"), once.first { it.id == "f1" }.items)
    }

    @Test
    fun `remove takes the app out without touching the others`() {
        val result = FolderOps.removeApp(base, "f1", "a/a")
        assertEquals(listOf("b/b"), result.first { it.id == "f1" }.items)
        assertEquals(listOf("c/c"), result.first { it.id == "f2" }.items)
    }

    @Test
    fun `prune drops uninstalled apps and folders left empty`() {
        val result = FolderOps.prune(base, setOf("a/a"))
        assertEquals(1, result.size)
        assertEquals(listOf("a/a"), result.first().items)
    }

    @Test
    fun `names are trimmed, collapsed and bounded, never blank`() {
        assertEquals("My Apps", FolderOps.sanitizeName("  My   Apps  "))
        assertEquals("Folder", FolderOps.sanitizeName("   "))
        assertEquals(FolderOps.MAX_NAME_LENGTH, FolderOps.sanitizeName("x".repeat(99)).length)
    }

    @Test
    fun `folderOf finds the owner and rename keeps items`() {
        assertEquals("f1", FolderOps.folderOf(base, "b/b")?.id)
        assertNull(FolderOps.folderOf(base, "zz/zz"))
        val renamed = FolderOps.rename(base, "f1", "  Office ")
        assertEquals("Office", renamed.first().name)
        assertEquals(listOf("a/a", "b/b"), renamed.first().items)
    }

    @Test
    fun `delete removes only the requested folder`() {
        val result = FolderOps.delete(base, "f1")
        assertEquals(1, result.size)
        assertTrue(result.none { it.id == "f1" })
    }
}
