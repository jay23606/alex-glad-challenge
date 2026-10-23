package ru.memo7.artel.core.network

/** Typed API failure surfaced to ViewModels. */
sealed class ApiError(message: String) : Exception(message) {
    class Network(cause: Throwable) : ApiError("Сервер недоступен: ${cause.message ?: "нет соединения"}")
    class Unauthorized : ApiError("Неверный токен доступа")
    class Server(val code: Int, body: String) : ApiError("Ошибка сервера ($code): ${body.ifBlank { "нет описания" }}")
    class BadResponse(message: String) : ApiError(message)
}

/** Result of a repository call. */
sealed interface ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>
    data class Failure(val error: ApiError) : ApiResult<Nothing>
}

inline fun <T, R> ApiResult<T>.map(transform: (T) -> R): ApiResult<R> = when (this) {
    is ApiResult.Success -> ApiResult.Success(transform(data))
    is ApiResult.Failure -> this
}
