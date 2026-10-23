package ru.memo7.artel.di

import android.content.Context
import androidx.datastore.preferences.preferencesDataStoreFile
import ru.memo7.artel.data.ArtelRepository
import ru.memo7.artel.data.CredentialsStore
import ru.memo7.artel.data.SessionManager

/**
 * Manual dependency container. Lives as long as the process.
 */
class AppContainer(context: Context) {

    val credentialsStore: CredentialsStore = CredentialsStore(
        context.applicationContext.preferencesDataStoreFile("artel_settings")
    )

    val session: SessionManager = SessionManager(credentialsStore)

    val repository: ArtelRepository = ArtelRepository(credentialsStore)
}
