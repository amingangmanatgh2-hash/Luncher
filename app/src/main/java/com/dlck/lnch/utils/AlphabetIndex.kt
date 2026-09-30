package com.dlck.lnch.utils

/**
 * Builds the A–Z (and آ–ی) index used by the app-drawer fast-scroll rail.
 *
 * Pure Kotlin so it can be unit-tested without Android: it turns an ordered list of app labels
 * into the sections the rail should display, each pointing at the first item of that letter.
 */
object AlphabetIndex {

    /** A rail entry: the bucket [letter] and the item [index] it should jump to. */
    data class Section(val letter: String, val index: Int)

    /** Bucket used for digits, symbols and anything we cannot classify. */
    const val OTHER = "#"

    /**
     * @param labels app labels in the exact order they appear in the grid.
     * @return one section per distinct leading letter, ordered by first appearance. A label whose
     *         bucket already appeared earlier (because the list is not strictly sorted, e.g. pinned
     *         apps float to the top) does not create a second section.
     */
    fun build(labels: List<String>): List<Section> {
        val seen = LinkedHashMap<String, Int>(labels.size.coerceAtLeast(1))
        labels.forEachIndexed { index, label ->
            val bucket = bucketOf(label)
            if (!seen.containsKey(bucket)) seen[bucket] = index
        }
        return seen.map { (letter, index) -> Section(letter, index) }
    }

    /** The rail bucket a single label belongs to. */
    fun bucketOf(label: String): String {
        val first = label.trim().firstOrNull { !it.isWhitespace() } ?: return OTHER
        val normalized = when (first) {
            'أ', 'إ', 'آ', 'ٱ' -> 'ا'
            'ي', 'ی', 'ئ' -> 'ی'
            'ك' -> 'ک'
            else -> first
        }
        return when {
            normalized.isDigit() -> OTHER
            normalized.isLetter() -> normalized.uppercaseChar().toString()
            else -> OTHER
        }
    }

    /**
     * Maps a vertical touch on a rail of [count] entries, [heightPx] tall, to an entry index.
     * Returns -1 when the rail is empty; otherwise always a valid, clamped index.
     */
    fun indexForOffset(y: Float, heightPx: Int, count: Int): Int {
        if (count <= 0 || heightPx <= 0) return -1
        val ratio = y / heightPx.toFloat()
        return (ratio * count).toInt().coerceIn(0, count - 1)
    }
}
