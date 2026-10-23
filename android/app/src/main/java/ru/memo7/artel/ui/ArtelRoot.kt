package ru.memo7.artel.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Chat
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import ru.memo7.artel.di.AppContainer
import ru.memo7.artel.ui.screens.assistant.AssistantScreen
import ru.memo7.artel.ui.screens.automation.AutomationScreen
import ru.memo7.artel.ui.screens.calendar.CalendarScreen
import ru.memo7.artel.ui.screens.dashboard.DashboardScreen
import ru.memo7.artel.ui.screens.notifications.NotificationsScreen
import ru.memo7.artel.ui.screens.projects.ProjectDetailScreen
import ru.memo7.artel.ui.screens.projects.ProjectsScreen
import ru.memo7.artel.ui.screens.settings.SettingsScreen
import ru.memo7.artel.ui.screens.support.SupportScreen

object Routes {
    const val DASHBOARD = "dashboard"
    const val PROJECTS = "projects"
    const val AUTOMATION = "automation"
    const val CALENDAR = "calendar"
    const val ASSISTANT = "assistant"
    const val NOTIFICATIONS = "notifications"
    const val SUPPORT = "support"
    const val SETTINGS = "settings"
    const val PROJECT_DETAIL = "project/{projectId}"
    fun projectDetail(id: Long) = "project/$id"
}

private data class BottomItem(val route: String, val label: String, val icon: ImageVector)

private val bottomItems = listOf(
    BottomItem(Routes.DASHBOARD, "Главная", Icons.Rounded.Home),
    BottomItem(Routes.PROJECTS, "Проекты", Icons.Rounded.Folder),
    BottomItem(Routes.AUTOMATION, "Автоматизация", Icons.Rounded.Bolt),
    BottomItem(Routes.CALENDAR, "Календарь", Icons.Rounded.CalendarMonth),
    BottomItem(Routes.ASSISTANT, "Ассистент", Icons.AutoMirrored.Rounded.Chat),
)

/** Main app shell: content NavHost + labeled bottom navigation. */
@Composable
fun ArtelRoot(container: AppContainer) {
    val navController: NavHostController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val showBottomBar = bottomItems.any { it.route == currentRoute }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            AnimatedVisibility(
                visible = showBottomBar,
                enter = slideInVertically(initialOffsetY = { it }) ,
                exit = slideOutVertically(targetOffsetY = { it }),
            ) {
                NavigationBar(
                    containerColor = MaterialTheme.colorScheme.surface,
                    tonalElevation = 0.dp,
                    modifier = Modifier.clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)),
                ) {
                    bottomItems.forEach { item ->
                        val selected = currentRoute == item.route
                        NavigationBarItem(
                            selected = selected,
                            onClick = {
                                navController.navigate(item.route) {
                                    popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(item.icon, contentDescription = item.label) },
                            label = { Text(item.label, style = MaterialTheme.typography.labelMedium) },
                            alwaysShowLabel = true,
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = MaterialTheme.colorScheme.primary,
                                selectedTextColor = MaterialTheme.colorScheme.primary,
                                indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                                unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            ),
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = Routes.DASHBOARD,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            enterTransition = { fadeIn(tween(240)) + slideInHorizontally(tween(240)) { it / 20 } },
            exitTransition = { fadeOut(tween(180)) },
            popEnterTransition = { fadeIn(tween(240)) + slideInHorizontally(tween(240)) { -it / 20 } },
            popExitTransition = { fadeOut(tween(180)) },
        ) {
            composable(Routes.DASHBOARD) {
                DashboardScreen(
                    container = container,
                    onOpenNotifications = { navController.navigate(Routes.NOTIFICATIONS) },
                    onOpenSettings = { navController.navigate(Routes.SETTINGS) },
                    onOpenSupport = { navController.navigate(Routes.SUPPORT) },
                    onOpenProjects = { navController.navigate(Routes.PROJECTS) },
                )
            }
            composable(Routes.PROJECTS) {
                ProjectsScreen(
                    container = container,
                    onOpenProject = { id -> navController.navigate(Routes.projectDetail(id)) },
                )
            }
            composable(Routes.AUTOMATION) { AutomationScreen(container) }
            composable(Routes.CALENDAR) { CalendarScreen(container) }
            composable(Routes.ASSISTANT) { AssistantScreen(container) }
            composable(Routes.NOTIFICATIONS) {
                NotificationsScreen(container, onBack = { navController.popBackStack() })
            }
            composable(Routes.SUPPORT) {
                SupportScreen(container, onBack = { navController.popBackStack() })
            }
            composable(Routes.SETTINGS) {
                SettingsScreen(container, onBack = { navController.popBackStack() })
            }
            composable(
                route = Routes.PROJECT_DETAIL,
                arguments = listOf(navArgument("projectId") { type = NavType.LongType }),
            ) { entry ->
                val projectId = entry.arguments?.getLong("projectId") ?: 0L
                ProjectDetailScreen(
                    container = container,
                    projectId = projectId,
                    onBack = { navController.popBackStack() },
                )
            }
        }
    }
}
