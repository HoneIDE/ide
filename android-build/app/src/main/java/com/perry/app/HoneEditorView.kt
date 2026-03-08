package com.perry.app

import android.content.Context
import android.graphics.Canvas
import android.view.View

/**
 * Custom View for the Hone editor surface.
 * Delegates all drawing to native Rust code via JNI.
 */
class HoneEditorView(context: Context) : View(context) {
    /** Pointer to the Rust EditorView struct. */
    var nativeHandle: Long = 0L

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (nativeHandle != 0L) {
            nativeDrawEditor(nativeHandle, canvas)
        }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (nativeHandle != 0L) {
            nativeOnSizeChanged(nativeHandle, w.toFloat(), h.toFloat())
        }
    }

    private external fun nativeDrawEditor(handle: Long, canvas: Canvas)
    private external fun nativeOnSizeChanged(handle: Long, widthPx: Float, heightPx: Float)
}
