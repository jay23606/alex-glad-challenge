package ru.memo7.artel.data.api

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.POST

/** POST api/mobile/login — вход по паролю рабочего пространства. */
interface ArtelAuthApi {

    @POST("api/mobile/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse
}

@Serializable
data class LoginRequest(
    val password: String,
)

/** 200 отдаёт session token; ошибки приходят статус-кодом с `{ error }` в теле. */
@Serializable
data class LoginResponse(
    val ok: Boolean,
    val token: String? = null,
    val expiresAt: Long? = null,
    val error: String? = null,
)
