package ru.memo7.artel

import android.app.Application
import ru.memo7.artel.di.AppContainer

class ArtelApp : Application() {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
