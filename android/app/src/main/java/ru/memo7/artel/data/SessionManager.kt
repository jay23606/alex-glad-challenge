package ru.memo7.artel.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** Application-level session state derived from stored credentials. */
sealed interface Session {
    data object Loading : Session
    data object Disconnected : Session
    data class Connected(val credentials: Credentials) : Session
}

/**
 * Single source of truth for "is the app connected to a server".
 */
class SessionManager(private val store: CredentialsStore) {

    val session: Flow<Session> = store.settings.map { settings ->
        when (val credentials = settings.credentials) {
            null -> Session.Disconnected
            else -> Session.Connected(credentials)
        }
    }
}
