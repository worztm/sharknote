package app.sharknote.mobile

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * AES-GCM encryption backed by a non-exportable key in the Android Keystore
 * (hardware-backed / StrongBox where available). Notes at rest are therefore
 * unreadable from a pulled backup, a forensic image, or any non-root file
 * access — the key never leaves the secure element and cannot be extracted
 * even with the app's private directory in hand.
 *
 * File format: "SNK1" magic + 12-byte GCM IV + ciphertext+tag.
 */
object NoteCrypto {
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "sharknote_notes_key"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val IV_LEN = 12
    private const val TAG_LEN_BITS = 128
    private const val MAGIC = "SNK1"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as SecretKey?)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build()
            )
            generateKey()
        }
    }

    fun encrypt(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val iv = cipher.iv
        val body = cipher.doFinal(plain)
        return MAGIC.toByteArray() + iv + body
    }

    /** Returns plaintext bytes, or null when [data] is not a SNK1 blob. */
    fun decrypt(data: ByteArray): ByteArray? {
        val magic = MAGIC.toByteArray()
        if (data.size <= magic.size + IV_LEN) return null
        if (!data.copyOfRange(0, magic.size).contentEquals(magic)) return null
        return runCatching {
            val iv = data.copyOfRange(magic.size, magic.size + IV_LEN)
            val body = data.copyOfRange(magic.size + IV_LEN, data.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_LEN_BITS, iv))
            cipher.doFinal(body)
        }.getOrNull()
    }

    fun isEncrypted(data: ByteArray): Boolean =
        data.size > MAGIC.length && data.copyOfRange(0, MAGIC.length).contentEquals(MAGIC.toByteArray())
}
