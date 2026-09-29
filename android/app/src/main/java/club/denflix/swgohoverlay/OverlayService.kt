package club.denflix.swgohoverlay

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat

/**
 * The floating bubble + expandable panel. This is a first-pass shell:
 * bubble show/hide and internal Home / TeamSelect / CounterResults
 * navigation all work, but the actual data behind Team Select and Counter
 * Results is hardcoded/placeholder for now - the real "call the backend,
 * populate this from your roster + the counters lookup" wiring is a TODO,
 * same as the automatic screenshot-based team detection (see
 * IconMatcher.kt). Manual team selection (tap which team you're facing)
 * is the intended first working version - see docs/ARCHITECTURE.md.
 */
class OverlayService : Service() {

    private lateinit var windowManager: WindowManager
    private lateinit var prefs: Prefs

    private var bubbleView: View? = null
    private var panelView: View? = null
    private var panelVisible = false

    // Which internal overlay screen is showing, so re-expanding the panel
    // (after a collapse) returns to where you left off instead of resetting
    // to Home every time.
    private enum class Screen { HOME, TEAM_SELECT, COUNTER_RESULTS }
    private var currentScreen = Screen.HOME

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        prefs = Prefs(this)
        startForegroundWithNotification()
        showBubble()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        bubbleView?.let { runCatching { windowManager.removeView(it) } }
        panelView?.let { runCatching { windowManager.removeView(it) } }
    }

    private fun startForegroundWithNotification() {
        val channelId = "swgoh_overlay_service"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId, "SWGOH Overlay", NotificationManager.IMPORTANCE_MIN
            )
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
        val notification: Notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("SWGOH Overlay is running")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setOngoing(true)
            .build()
        startForeground(1, notification)
    }

    private fun overlayWindowType(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

    // --- Bubble (collapsed state) ---------------------------------------

    private fun showBubble() {
        if (bubbleView != null) return

        val inflater = LayoutInflater.from(this)
        val view = inflater.inflate(R.layout.overlay_bubble, null)

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayWindowType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        )
        params.gravity = Gravity.TOP or Gravity.START
        params.x = prefs.bubbleX
        params.y = prefs.bubbleY

        // Simple tap-to-toggle. Dragging to reposition is only meant to
        // happen from the Settings > Move Bubble flow (see
        // SettingsActivity.kt TODO), not during normal use, so no drag
        // handling lives here.
        view.setOnTouchListener(object : View.OnTouchListener {
            private var downTime = 0L
            override fun onTouch(v: View, event: MotionEvent): Boolean {
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> downTime = System.currentTimeMillis()
                    MotionEvent.ACTION_UP -> {
                        if (System.currentTimeMillis() - downTime < 250) {
                            togglePanel()
                        }
                    }
                }
                return true
            }
        })

        windowManager.addView(view, params)
        bubbleView = view
    }

    // --- Expandable panel -------------------------------------------------

    private fun togglePanel() {
        if (panelVisible) {
            hidePanel()
        } else {
            showPanel()
        }
    }

    private fun showPanel() {
        if (panelView == null) {
            val inflater = LayoutInflater.from(this)
            val view = inflater.inflate(R.layout.overlay_panel, null)

            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayWindowType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT
            )
            params.gravity = Gravity.TOP or Gravity.START
            params.x = prefs.bubbleX
            params.y = prefs.bubbleY + 80

            windowManager.addView(view, params)
            panelView = view

            wireHomeScreen(view)
        }

        renderCurrentScreen()
        panelView?.visibility = View.VISIBLE
        panelVisible = true
    }

    private fun hidePanel() {
        panelView?.visibility = View.GONE
        panelVisible = false
    }

    private fun renderCurrentScreen() {
        val view = panelView ?: return
        view.findViewById<View>(R.id.screenHome).visibility =
            if (currentScreen == Screen.HOME) View.VISIBLE else View.GONE
        view.findViewById<View>(R.id.screenTeamSelect).visibility =
            if (currentScreen == Screen.TEAM_SELECT) View.VISIBLE else View.GONE
        view.findViewById<View>(R.id.screenCounterResults).visibility =
            if (currentScreen == Screen.COUNTER_RESULTS) View.VISIBLE else View.GONE

        if (currentScreen == Screen.HOME) {
            val usedList = view.findViewById<TextView>(R.id.usedSquadsList)
            usedList.text = if (prefs.usedSquadsRaw.isBlank()) "(none yet)" else prefs.usedSquadsRaw
        }
    }

    private fun wireHomeScreen(view: View) {
        view.findViewById<View>(R.id.btnScan).setOnClickListener {
            showTeamSelect()
        }
    }

    /**
     * TODO: this currently shows a hardcoded 2-team placeholder. Replace
     * with either (a) manual squad entry per team, pulled from
     * ApiClient.fetchUnits(), or (b) automatic detection via IconMatcher
     * once that's implemented - see docs/ARCHITECTURE.md on why manual
     * comes first.
     */
    private fun showTeamSelect() {
        val view = panelView ?: return
        val container = view.findViewById<LinearLayout>(R.id.teamSelectButtons)
        container.removeAllViews()

        listOf("Team 1", "Team 2").forEachIndexed { index, label ->
            val btn = android.widget.Button(this)
            btn.text = label
            btn.setOnClickListener { showCounterResults(index) }
            container.addView(btn)
        }

        currentScreen = Screen.TEAM_SELECT
        renderCurrentScreen()
    }

    /**
     * TODO: replace placeholder text with a real ApiClient.lookupCounters()
     * call (needs to run off the main thread) and render each recommended
     * squad's portraits (base image + live ring composite, per
     * docs/ARCHITECTURE.md) instead of plain text rows.
     */
    private fun showCounterResults(teamIndex: Int) {
        val view = panelView ?: return
        val container = view.findViewById<LinearLayout>(R.id.counterResultsList)
        container.removeAllViews()

        listOf("Squad A", "Squad B", "Squad C").forEach { squadLabel ->
            val row = TextView(this)
            row.text = squadLabel
            row.setPadding(0, 8, 0, 8)
            row.setTextColor(0xFFFFFFFF.toInt())
            row.setOnClickListener {
                markSquadUsed(squadLabel)
                currentScreen = Screen.HOME
                renderCurrentScreen()
            }
            container.addView(row)
        }

        currentScreen = Screen.COUNTER_RESULTS
        renderCurrentScreen()
    }

    private fun markSquadUsed(squadLabel: String) {
        val existing = prefs.usedSquadsRaw
        prefs.usedSquadsRaw = if (existing.isBlank()) squadLabel else "$existing, $squadLabel"
        // TODO: this should remove that squad's specific unit ids from the
        // pool considered on future counter lookups this round, not just
        // display them - needs the real ApiClient-backed roster/units data
        // to do that; placeholder just records the label for now.
    }
}
