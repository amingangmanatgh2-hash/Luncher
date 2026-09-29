package com.dlck.lnch.utils

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities

object Network {

    /** Best-effort connectivity check used to show an offline state instead of a timeout. */
    fun isOnline(context: Context): Boolean = runCatching {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = manager.activeNetwork ?: return false
        val caps = manager.getNetworkCapabilities(network) ?: return false
        caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            (
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ||
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
                )
    }.getOrDefault(true) // if we cannot tell, let the request try and fail properly
}
