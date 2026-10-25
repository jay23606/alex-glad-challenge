package ru.memo7.artel.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.io.File

/** Visual theme preference. */
enum class ThemeMode { SYSTEM, DARK, LIGHT }

/** Server connection entered by the user. Never bundled with the app. */
data class Credentials(
    val baseUrl: String,
    val token: String,
) {
    /** Normalized origin with scheme and trailing slash, ready for Retrofit. */
    fun toRetrofitBaseUrl(): String = normalizeBaseUrl(baseUrl)
}

/** Single URL-normalization rules for both Retrofit clients (token and login). */
fun normalizeBaseUrl(baseUrl: String): String {
    var url = baseUrl.trim().trimEnd('/')
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = "http://$url"
    }
    return "$url/"
}

data class AppSettings(
    val credentials: Credentials?,
    val theme: ThemeMode,
)

/**
 * DataStore-backed storage for server URL, bearer token and theme choice.
 */
class CredentialsStore(file: File) {

    private val dataStore: DataStore<Preferences> =
        PreferenceDataStoreFactory.create(produceFile = { file })

    private object Keys {
        val serverUrl = stringPreferencesKey("server_url")
        val token = stringPreferencesKey("token")
        val theme = stringPreferencesKey("theme")
        val lastServerUrl = stringPreferencesKey("last_server_url")
    }

    val settings: Flow<AppSettings> = dataStore.data.map { prefs ->
        val url = prefs[Keys.serverUrl]
        val token = prefs[Keys.token]
        AppSettings(
            credentials = if (url.isNullOrBlank() || token.isNullOrBlank()) null else Credentials(url, token),
            theme = prefs[Keys.theme]?.let { stored ->
                ThemeMode.entries.firstOrNull { it.name == stored }
            } ?: ThemeMode.SYSTEM,
        )
    }

    /** Last URL that successfully connected — remembered even after logout. */
    val lastServerUrl: Flow<String?> = dataStore.data.map { prefs -> prefs[Keys.lastServerUrl] }

    suspend fun saveCredentials(credentials: Credentials) {
        dataStore.edit { prefs ->
            prefs[Keys.serverUrl] = credentials.baseUrl.trim()
            prefs[Keys.token] = credentials.token.trim()
            prefs[Keys.lastServerUrl] = credentials.baseUrl.trim()
        }
    }

    suspend fun clearCredentials() {
        dataStore.edit { prefs ->
            prefs.remove(Keys.serverUrl)
            prefs.remove(Keys.token)
        }
    }

    /** Истёкшая сессия: удаляем только токен, адрес сервера остаётся подставленным. */
    suspend fun clearToken() {
        dataStore.edit { prefs ->
            prefs.remove(Keys.token)
        }
    }

    /**
     * Удаляет токен, только если он всё ещё тот, с которым упал запрос.
     * Поздний 401 от старого in-flight запроса не должен стирать свежую сессию.
     */
    suspend fun clearTokenIf(token: String) {
        dataStore.edit { prefs ->
            if (prefs[Keys.token] == token) prefs.remove(Keys.token)
        }
    }

    suspend fun setTheme(mode: ThemeMode) {
        dataStore.edit { prefs -> prefs[Keys.theme] = mode.name }
    }
}
