package ru.memo7.artel.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import ru.memo7.artel.data.CredentialsStore
import ru.memo7.artel.data.Session
import ru.memo7.artel.data.SessionManager
import ru.memo7.artel.data.ThemeMode

data class AppState(
    val session: Session = Session.Loading,
    val theme: ThemeMode = ThemeMode.SYSTEM,
)

/** Root state: session gate + theme preference. */
class AppViewModel(
    private val store: CredentialsStore,
    sessionManager: SessionManager,
) : ViewModel() {

    val state: StateFlow<AppState> =
        combine(sessionManager.session, store.settings) { session, settings ->
            AppState(session, settings.theme)
        }.stateIn(viewModelScope, SharingStarted.Eagerly, AppState())

    fun setTheme(mode: ThemeMode) {
        viewModelScope.launch { store.setTheme(mode) }
    }
}
