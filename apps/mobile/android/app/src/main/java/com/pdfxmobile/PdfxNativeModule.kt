package com.pdfxmobile

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.pdfxmobile.specs.NativePdfxNativeSpec
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

/**
 * Image re-encoding for PDF compression, plus small file helpers. Every image
 * call resolves "" when the image should stay as it is (decode failure,
 * unsupported layout) so compression never fails because of one odd image.
 */
class PdfxNativeModule(reactContext: ReactApplicationContext) : NativePdfxNativeSpec(reactContext) {

  // One worker keeps peak memory to a single image at a time.
  private val executor = Executors.newSingleThreadExecutor()

  override fun getName() = NAME

  override fun reencodeJpeg(base64: String, maxDimension: Double, quality: Double, promise: Promise) {
    executor.execute {
      promise.resolve(safely { encodeJpeg(Base64.decode(base64, Base64.NO_WRAP), maxDimension.toInt(), quality) })
    }
  }

  override fun reencodeFlate(
    base64: String,
    width: Double,
    height: Double,
    colors: Double,
    predictor: Double,
    paletteBase64: String,
    paletteColors: Double,
    maxDimension: Double,
    quality: Double,
    promise: Promise,
  ) {
    executor.execute {
      promise.resolve(
        safely {
          val source =
            FlateImage(
              bytes = Base64.decode(base64, Base64.NO_WRAP),
              width = width.toInt(),
              height = height.toInt(),
              colors = colors.toInt(),
              predictor = predictor.toInt(),
              palette = if (paletteBase64.isEmpty()) null else Base64.decode(paletteBase64, Base64.NO_WRAP),
              paletteColors = paletteColors.toInt(),
            )
          val bitmap = FlateDecoder.decodeScaled(source, maxDimension.toInt())
          try {
            compressJpeg(bitmap, quality)
          } finally {
            bitmap.recycle()
          }
        },
      )
    }
  }

  override fun displayName(uri: String, promise: Promise) {
    val parsed = Uri.parse(uri)
    var name: String? = null
    if (parsed.scheme == "content") {
      try {
        reactApplicationContext.contentResolver
          .query(parsed, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
          ?.use { cursor -> if (cursor.moveToFirst()) name = cursor.getString(0) }
      } catch (_: Exception) {
        // Some providers refuse metadata queries; fall back to the path.
      }
    }
    promise.resolve(name ?: parsed.lastPathSegment ?: "document.pdf")
  }

  override fun invalidate() {
    executor.shutdown()
    super.invalidate()
  }

  private inline fun safely(block: () -> ByteArray?): String =
    try {
      block()?.let { Base64.encodeToString(it, Base64.NO_WRAP) } ?: ""
    } catch (_: Throwable) {
      "" // includes OutOfMemoryError on huge images: skip the image, keep going
    }

  private fun encodeJpeg(bytes: ByteArray, maxDimension: Int, quality: Double): ByteArray? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    val longest = maxOf(bounds.outWidth, bounds.outHeight)
    var sample = 1
    while (longest / (sample * 2) >= maxDimension) sample *= 2
    val decoded =
      BitmapFactory.decodeByteArray(
        bytes,
        0,
        bytes.size,
        BitmapFactory.Options().apply {
          inSampleSize = sample
          inPreferredConfig = Bitmap.Config.ARGB_8888
        },
      ) ?: return null // CMYK and other layouts Android cannot decode
    val (w, h) = FlateDecoder.scaledSize(bounds.outWidth, bounds.outHeight, maxDimension)
    val scaled =
      if (decoded.width == w && decoded.height == h) decoded
      else Bitmap.createScaledBitmap(decoded, w, h, true)
    try {
      return compressJpeg(scaled, quality)
    } finally {
      if (scaled !== decoded) scaled.recycle()
      decoded.recycle()
    }
  }

  private fun compressJpeg(bitmap: Bitmap, quality: Double): ByteArray {
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, (quality * 100).toInt().coerceIn(1, 100), out)
    return out.toByteArray()
  }

  companion object {
    const val NAME = NativePdfxNativeSpec.NAME
  }
}
