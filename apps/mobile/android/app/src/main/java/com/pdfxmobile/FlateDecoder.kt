package com.pdfxmobile

import android.graphics.Bitmap
import java.io.ByteArrayInputStream
import java.io.DataInputStream
import java.util.zip.Inflater
import java.util.zip.InflaterInputStream
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class FlateImage(
  val bytes: ByteArray,
  val width: Int,
  val height: Int,
  val colors: Int,
  val predictor: Int,
  val palette: ByteArray?,
  val paletteColors: Int,
)

/**
 * Mirrors decodeFlateImage in @pdfx/core, but streams: rows are inflated,
 * unfiltered and box-averaged into the output one at a time, so only the
 * (already downscaled) result bitmap is ever held in memory.
 */
object FlateDecoder {

  fun scaledSize(width: Int, height: Int, maxDimension: Int): Pair<Int, Int> {
    val ratio = min(1.0, maxDimension.toDouble() / max(width, height))
    return Pair(max(1, (width * ratio).roundToInt()), max(1, (height * ratio).roundToInt()))
  }

  fun decodeScaled(src: FlateImage, maxDimension: Int): Bitmap {
    val width = src.width
    val height = src.height
    val colors = src.colors
    require(width > 0 && height > 0 && (colors == 1 || colors == 3))
    val (outW, outH) = scaledSize(width, height, maxDimension)

    val input = DataInputStream(InflaterInputStream(ByteArrayInputStream(src.bytes), inflaterFor(src.bytes)))
    val png = src.predictor >= 10
    val rowBytes = width * colors
    val raw = ByteArray(rowBytes)
    var row = IntArray(rowBytes)
    var prev = IntArray(rowBytes)

    val column = IntArray(width) { x -> (x.toLong() * outW / width).toInt() }
    val sumR = LongArray(outW)
    val sumG = LongArray(outW)
    val sumB = LongArray(outW)
    val count = IntArray(outW)
    val pixels = IntArray(outW * outH)
    var band = 0

    fun flush() {
      val base = band * outW
      for (ox in 0 until outW) {
        val n = max(1, count[ox])
        val r = (sumR[ox] / n).toInt()
        val g = (sumG[ox] / n).toInt()
        val b = (sumB[ox] / n).toInt()
        pixels[base + ox] = (0xff shl 24) or (r shl 16) or (g shl 8) or b
      }
      sumR.fill(0)
      sumG.fill(0)
      sumB.fill(0)
      count.fill(0)
    }

    input.use {
      for (y in 0 until height) {
        val type = if (png) it.readUnsignedByte() else 0
        it.readFully(raw) // throws EOFException on truncated data
        for (x in 0 until rowBytes) {
          val a = if (x >= colors) row[x - colors] else 0
          val b = prev[x]
          val c = if (x >= colors) prev[x - colors] else 0
          val pred =
            when (type) {
              1 -> a
              2 -> b
              3 -> (a + b) shr 1
              4 -> {
                val p = a + b - c
                val pa = abs(p - a)
                val pb = abs(p - b)
                val pc = abs(p - c)
                if (pa <= pb && pa <= pc) a else if (pb <= pc) b else c
              }
              else -> 0
            }
          row[x] = ((raw[x].toInt() and 0xff) + pred) and 0xff
        }

        val oy = (y.toLong() * outH / height).toInt()
        if (oy != band) {
          flush()
          band = oy
        }
        for (x in 0 until width) {
          var r: Int
          var g: Int
          var b: Int
          val palette = src.palette
          if (palette != null) {
            val at = row[x] * src.paletteColors
            r = palette.getOrElse(at) { 0 }.toInt() and 0xff
            if (src.paletteColors == 3) {
              g = palette.getOrElse(at + 1) { 0 }.toInt() and 0xff
              b = palette.getOrElse(at + 2) { 0 }.toInt() and 0xff
            } else {
              g = r
              b = r
            }
          } else if (colors == 3) {
            r = row[x * 3]
            g = row[x * 3 + 1]
            b = row[x * 3 + 2]
          } else {
            r = row[x]
            g = r
            b = r
          }
          val ox = column[x]
          sumR[ox] += r.toLong()
          sumG[ox] += g.toLong()
          sumB[ox] += b.toLong()
          count[ox]++
        }

        val swap = prev
        prev = row
        row = swap
      }
    }
    flush()
    return Bitmap.createBitmap(pixels, outW, outH, Bitmap.Config.ARGB_8888)
  }

  /** zlib-wrapped when the header checks out; some writers emit raw deflate. */
  private fun inflaterFor(bytes: ByteArray): Inflater {
    if (bytes.size >= 2) {
      val cmf = bytes[0].toInt() and 0xff
      val flg = bytes[1].toInt() and 0xff
      if (cmf and 0x0f == 8 && (cmf * 256 + flg) % 31 == 0) return Inflater(false)
    }
    return Inflater(true)
  }
}
