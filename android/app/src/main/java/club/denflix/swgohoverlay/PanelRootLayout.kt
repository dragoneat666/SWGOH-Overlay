package club.denflix.swgohoverlay

import android.content.Context
import android.util.AttributeSet
import android.view.KeyEvent
import android.widget.FrameLayout

/** Root of the overlay panel. The panel window takes keyboard focus while
 * open (so the search box can be typed into), which means it also gets the
 * Back key - this hands Back to OverlayService to close the panel. */
class PanelRootLayout @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : FrameLayout(context, attrs) {

    var onBack: (() -> Unit)? = null

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP) onBack?.invoke()
            return true
        }
        return super.dispatchKeyEvent(event)
    }
}
