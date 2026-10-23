package ru.memo7.artel.core

/** Standard UI state machine used by every screen. */
sealed interface UiState<out T> {
    data object Loading : UiState<Nothing>
    data class Error(val message: String) : UiState<Nothing>
    data class Success<T>(val data: T) : UiState<T>
}

inline fun <T, R> UiState<T>.mapData(transform: (T) -> R): UiState<R> = when (this) {
    is UiState.Loading -> UiState.Loading
    is UiState.Error -> this
    is UiState.Success -> UiState.Success(transform(data))
}
