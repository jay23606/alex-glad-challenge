package ru.memo7.artel.ui.screens.connect

/** Чистые правила экрана входа — валидация и человекочитаемые ошибки подключения.
 *  Без Android-зависимостей, чтобы юнит-тесты гоняли их в plain JUnit. */
object ConnectRules {

    /** null — ввод корректен; иначе сообщение для экрана входа. */
    fun validate(serverUrl: String, password: String): String? {
        if (serverUrl.trim().isEmpty()) return "Введите адрес сервера"
        if (password.trim().isEmpty()) return "Введите пароль"
        return null
    }

    /** Технический текст сбоя подключения → понятное сообщение с подсказкой. */
    fun describeConnectFailure(message: String?): String {
        val text = message ?: return "Сервер недоступен: нет соединения"
        return when {
            "Cleartext HTTP traffic" in text ->
                "Сервер требует защищённое соединение: release-сборка подключается только по https://"
            "Unable to resolve host" in text ->
                "Не удаётся найти сервер по адресу — проверьте адрес"
            "failed to connect" in text.lowercase() ->
                "Сервер не отвечает — проверьте адрес и сеть"
            else -> "Сервер недоступен: $text"
        }
    }
}
