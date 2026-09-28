package app.kino.tv

import android.content.Context
import android.util.AttributeSet
import android.widget.TextView

/**
 * The controls' position text, which shows the time the remote is seeking to until the seek lands,
 * as the seek bar does. Media3 sets the playing position on it several times a second.
 */
class TvTimeText
@JvmOverloads
constructor(context: Context, attrs: AttributeSet? = null, defStyleAttr: Int = 0) :
    TextView(context, attrs, defStyleAttr) {
    private var preview: CharSequence? = null

    internal fun preview(text: CharSequence?) {
        preview = text
        if (text != null) super.setText(text, BufferType.NORMAL)
    }

    override fun setText(text: CharSequence?, type: BufferType?) {
        super.setText(preview ?: text, type)
    }
}
