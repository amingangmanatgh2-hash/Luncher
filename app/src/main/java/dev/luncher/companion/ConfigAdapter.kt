package dev.luncher.companion

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import dev.luncher.companion.databinding.ItemConfigBinding
import dev.luncher.companion.databinding.ItemSectionBinding
import dev.luncher.companion.databinding.ItemSubscriptionBinding

/**
 * One list, three row kinds.
 *
 * Sections and subscriptions live in the same RecyclerView as configs so the
 * empty state, scrolling and item animations are handled once instead of three
 * times across nested containers.
 */
class ConfigAdapter(
    private val onOpen: (Config) -> Unit,
    private val onCopyLink: (String) -> Unit,
    private val onDelete: (Config) -> Unit,
    private val onRefreshSub: (Subscription) -> Unit,
    private val onDeleteSub: (Subscription) -> Unit,
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    sealed class Row {
        data class Section(val title: String) : Row()
        data class SubItem(val sub: Subscription, val count: Int) : Row()
        data class ConfigItem(val config: Config) : Row()
    }

    private val rows = mutableListOf<Row>()

    fun submit(configs: List<Config>, subs: List<Subscription>, localTitle: String, subTitle: String) {
        val next = mutableListOf<Row>()
        if (subs.isNotEmpty()) {
            next.add(Row.Section(subTitle))
            for (s in subs) next.add(Row.SubItem(s, configs.count { it.subId == s.id }))
        }
        if (configs.isNotEmpty()) {
            next.add(Row.Section(localTitle))
            for (c in configs) next.add(Row.ConfigItem(c))
        }
        rows.clear()
        rows.addAll(next)
        notifyDataSetChanged()
    }

    override fun getItemCount(): Int = rows.size

    override fun getItemViewType(position: Int): Int = when (rows[position]) {
        is Row.Section -> 0
        is Row.SubItem -> 1
        is Row.ConfigItem -> 2
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)
        return when (viewType) {
            0 -> SectionHolder(ItemSectionBinding.inflate(inflater, parent, false))
            1 -> SubHolder(ItemSubscriptionBinding.inflate(inflater, parent, false))
            else -> ConfigHolder(ItemConfigBinding.inflate(inflater, parent, false))
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        when (val row = rows[position]) {
            is Row.Section -> (holder as SectionHolder).bind(row.title)
            is Row.SubItem -> (holder as SubHolder).bind(row.sub, row.count)
            is Row.ConfigItem -> (holder as ConfigHolder).bind(row.config)
        }
    }

    inner class SectionHolder(private val b: ItemSectionBinding) : RecyclerView.ViewHolder(b.root) {
        fun bind(title: String) { b.sectionTitle.text = title }
    }

    inner class SubHolder(private val b: ItemSubscriptionBinding) : RecyclerView.ViewHolder(b.root) {
        fun bind(sub: Subscription, count: Int) {
            val ctx = b.root.context
            b.subName.text = sub.name
            b.subUrl.text = sub.url
            b.subRefresh.setOnClickListener { onRefreshSub(sub) }
            b.subCopy.setOnClickListener { onCopyLink(sub.url) }
            b.subDelete.setOnClickListener { onDeleteSub(sub) }
            b.subName.contentDescription = ctx.getString(R.string.configs_count, count)
        }
    }

    inner class ConfigHolder(private val b: ItemConfigBinding) : RecyclerView.ViewHolder(b.root) {
        fun bind(config: Config) {
            b.itemName.text = config.name
            b.itemProtocol.text = config.protocol.uppercase()
            b.itemPreview.text = config.link
            b.itemOpen.setOnClickListener { onOpen(config) }
            b.itemCopy.setOnClickListener { onCopyLink(config.link) }
            b.itemDelete.setOnClickListener { onDelete(config) }
        }
    }
}
