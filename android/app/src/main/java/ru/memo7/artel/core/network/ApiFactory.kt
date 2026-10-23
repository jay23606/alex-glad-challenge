@file:OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)

package ru.memo7.artel.core.network

import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Response
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import ru.memo7.artel.data.api.ArtelApi
import java.util.concurrent.TimeUnit

/** Adds the bearer token from the current credentials to every /api request. */
private class AuthInterceptor(private val token: String) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request().newBuilder()
            .header("Authorization", "Bearer $token")
            .build()
        return chain.proceed(request)
    }
}

/**
 * Builds the Retrofit/OkHttp stack for the credentials entered by the user.
 * The client is rebuilt whenever credentials change (cheap, happens rarely).
 */
object ApiFactory {

    val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    fun create(credentials: ru.memo7.artel.data.Credentials): ArtelApi {
        val client = OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(credentials.token.trim()))
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()

        return Retrofit.Builder()
            .baseUrl(credentials.toRetrofitBaseUrl())
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ArtelApi::class.java)
    }
}
