package cloud.jarvis.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.room.*
import kotlinx.coroutines.flow.first
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private val Context.settings by preferencesDataStore("jarvis")
data class Credentials(val server: String, val deviceId: String, val token: String, val refreshToken: String? = null)
class CredentialStore(private val context: Context) {
    suspend fun backgroundEnabled(): Boolean = context.settings.data.first()[booleanPreferencesKey("background")] ?: false
    suspend fun setBackground(enabled: Boolean) { context.settings.edit { it[booleanPreferencesKey("background")] = enabled } }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("jarvis-device", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("jarvis-device", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        return Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray()), Base64.NO_WRAP)
    }
    private fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
        return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)))
    }
    suspend fun save(value: Credentials) {
        context.settings.edit {
            it[stringPreferencesKey("server")] = value.server
            it[stringPreferencesKey("device")] = value.deviceId
            it[stringPreferencesKey("token")] = encrypt(value.token)
            if (value.refreshToken != null) it[stringPreferencesKey("refresh_enc")] = encrypt(value.refreshToken) else it.remove(stringPreferencesKey("refresh_enc"))
            it.remove(stringPreferencesKey("refresh"))
        }
    }
    suspend fun load(): Credentials? {
        val p = context.settings.data.first()
        val encrypted = p[stringPreferencesKey("token")] ?: return null
        val bytes = Base64.decode(encrypted, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
        val refresh = p[stringPreferencesKey("refresh_enc")]?.let { runCatching { decrypt(it) }.getOrNull() } ?: p[stringPreferencesKey("refresh")]
        return Credentials(p[stringPreferencesKey("server")] ?: return null, p[stringPreferencesKey("device")] ?: return null, String(cipher.doFinal(bytes.copyOfRange(12, bytes.size))), refresh)
    }
}
@Entity(tableName = "snapshots") data class Snapshot(@PrimaryKey val key: String, val json: String, val savedAt: Long)
@Dao interface SnapshotDao {
    @Query("SELECT * FROM snapshots") suspend fun all(): List<Snapshot>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun put(snapshot: Snapshot)
    @Query("DELETE FROM snapshots") suspend fun clear()
}
@Database(entities = [Snapshot::class], version = 1, exportSchema = false)
abstract class CacheDatabase : RoomDatabase() { abstract fun snapshots(): SnapshotDao }
