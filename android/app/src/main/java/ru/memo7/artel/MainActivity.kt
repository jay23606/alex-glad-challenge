package ru.memo7.artel

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.data.Session
import ru.memo7.artel.ui.AppViewModel
import ru.memo7.artel.ui.ArtelRoot
import ru.memo7.artel.ui.components.LoadingBox
import ru.memo7.artel.ui.screens.connect.ConnectScreen
import ru.memo7.artel.ui.theme.ArtelTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val container = (application as ArtelApp).container
            val appViewModel: AppViewModel = viewModel(
                factory = viewModelFactory { initializer { AppViewModel(container.credentialsStore, container.session) } }
            )
            val appState by appViewModel.state.collectAsStateWithLifecycle()
            ArtelTheme(themeMode = appState.theme) {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    AnimatedContent(
                        targetState = appState.session,
                        transitionSpec = { fadeIn(tween(260)) togetherWith fadeOut(tween(180)) },
                        contentKey = { it::class },
                        label = "session",
                    ) { session ->
                        when (session) {
                            is Session.Loading -> Splash()
                            is Session.Disconnected -> ConnectScreen(container)
                            is Session.Connected -> ArtelRoot(container)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Splash() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center,
    ) {
        LoadingBox(Modifier.fillMaxSize())
    }
}
