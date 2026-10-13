package club.denflix.swgohoverlay

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.text.Editable
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextWatcher
import android.text.style.StyleSpan
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The floating bubble + expandable panel (manual mode - see
 * docs/ARCHITECTURE.md on why manual team entry comes before screen
 * reading):
 *
 * 1. Tap the bubble, type an enemy unit (name or initials) and tap it.
 *    Leader first, then any other members you can see.
 * 2. The panel asks the backend's /api/counters/match for the closest known
 *    defense teams and shows the best one's counters, ranked, with the ones
 *    you can't field right now (unit already used this round, or not in your
 *    roster) dimmed and explained - see CounterRanking.
 * 3. "Use" marks a counter squad used for the round and closes the panel.
 *
 * Automatic screenshot-based team detection (IconMatcher.kt) plugs in later
 * by filling the same selection the search box fills.
 */
class OverlayService : Service() {

    companion object {
        const val ACTION_STOP = "club.denflix.swgohoverlay.STOP"
        const val ACTION_CAPTURE_GRANTED = "club.denflix.swgohoverlay.CAPTURE_GRANTED"
        const val ACTION_CAPTURE_DENIED = "club.denflix.swgohoverlay.CAPTURE_DENIED"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"
        private const val NOTIFICATION_ID = 1
        private const val CHANNEL_ID = "swgoh_overlay_service"
        private const val MATCH_DEBOUNCE_MS = 250L
        private const val STALE_SELECTION_MS = 90_000L
    }

    private lateinit var windowManager: WindowManager
    private lateinit var prefs: Prefs
    private lateinit var api: ApiClient
    private lateinit var ui: Context
    // A few threads so a slow roster pull (it goes out to the game's servers)
    // never holds up a counter lookup.
    private lateinit var executor: ExecutorService
    private val mainHandler = Handler(Looper.getMainLooper())
    private var destroyed = false

    private var bubbleView: View? = null
    private lateinit var bubbleParams: WindowManager.LayoutParams
    private var panelView: PanelRootLayout? = null
    private var panelShowing = false

    private lateinit var panelTitle: TextView
    private lateinit var searchInput: EditText
    private lateinit var selectedChips: ViewGroup
    private lateinit var contentScroll: ScrollView
    private lateinit var contentList: LinearLayout
    private lateinit var btnClear: View
    private lateinit var btnStop: View

    // --- State (main thread only) ------------------------------------------

    private var units: List<GameUnit> = emptyList()
    private var unitsError: String? = null
    private var owned: Set<String>? = null
    /** Your units' gear/relic (by game id), from the last roster pull. */
    private var levels: Map<String, UnitLevel> = emptyMap()
    /** The enemy leader of the squad picked from the last screen scan, and
     * its relic level if the badge could be read. Only applies while that
     * unit is still the selected leader. */
    private data class ScannedLeader(val unitId: Int, val relic: Int?)
    private var scannedLeader: ScannedLeader? = null
    /** Whether the "Probably too weak" counters are expanded. */
    private var showWeak = false
    private var rosterLoading = false
    /** Why the last roster pull didn't give a fresh roster (null = it did). */
    private var rosterError: String? = null
    private var rosterAttemptAtMillis = 0L
    private var knownTeams: List<Squad>? = null
    private var knownTeamsError: String? = null

    /** Units picked from the enemy team, leader first. */
    private val selected = mutableListOf<GameUnit>()
    private var query = ""
    private var lastAdded: String? = null
    private var hiddenAtMillis = 0L

    private var matches: List<TeamMatch>? = null
    private var matchError: String? = null
    private var focusedMatch = 0
    private var matchSeq = 0
    private val matchRunnable = Runnable { runMatch() }

    // Screen scan ("Scan screen"): capture -> server reads the squads ->
    // pick the squad (if several) -> identify unknown faces -> the squad
    // becomes `selected` and the normal counters view takes over.
    private var capturer: ScreenCapturer? = null
    private var scanActive = false
    private var scanAfterConsent = false
    private var scanBusy: String? = null
    private var scanError: String? = null
    private var scanResult: ScanResult? = null
    private var scanSquad: Int? = null
    /** Faces identified on the phone during this scan: (squad, slot) -> unit id. */
    private val scanTaught = mutableMapOf<Pair<Int, Int>, Int>()
    /** The face the search box is currently answering "who is this?" for. */
    private var identifying: Pair<Int, Int>? = null
    private val faceBitmaps = mutableMapOf<String, android.graphics.Bitmap?>()

    // --- Lifecycle -----------------------------------------------------------

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        prefs = Prefs(this)
        api = ApiClient(prefs)
        ui = ContextThemeWrapper(this, R.style.Theme_SWGOHOverlay)
        executor = Executors.newFixedThreadPool(3)
        startForegroundWithNotification()

        loadCachedUnits()
        owned = prefs.ownedDefinitionIds
        levels = prefs.unitLevels
        showBubble()
        refreshUnits()
        refreshRoster()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopSelf()
            ACTION_CAPTURE_GRANTED -> onCaptureGranted(
                intent.getIntExtra(EXTRA_RESULT_CODE, 0),
                if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_RESULT_DATA),
            )
            ACTION_CAPTURE_DENIED -> {
                scanAfterConsent = false
                scanBusy = null
                scanError = "Screen capture wasn't allowed. Scan screen needs it to read the enemy squads - or type them in above instead."
                showPanel()
            }
        }
        // Not sticky: if Android kills the overlay, reopen it from the app
        // rather than having a bubble pop back up on its own later.
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        destroyed = true
        mainHandler.removeCallbacksAndMessages(null)
        executor.shutdownNow()
        capturer?.release()
        capturer = null
        if (panelShowing) panelView?.let { runCatching { windowManager.removeView(it) } }
        bubbleView?.let { runCatching { windowManager.removeView(it) } }
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // Rotating (SWGoH is landscape) can leave the bubble off-screen.
        bubbleView?.let {
            clampBubble()
            windowManager.updateViewLayout(it, bubbleParams)
        }
        if (panelShowing) panelView?.let { windowManager.updateViewLayout(it, panelLayoutParams()) }
    }

    /** Runs [work] on a background thread and hands the result (or the
     * error) back on the main thread. Every ApiClient call blocks, so they
     * all go through here. */
    private fun <T> runAsync(work: () -> T, onResult: (T?, Exception?) -> Unit) {
        executor.execute {
            val outcome: Pair<T?, Exception?> = try {
                work() to null
            } catch (e: Exception) {
                null to e
            }
            mainHandler.post { if (!destroyed) onResult(outcome.first, outcome.second) }
        }
    }

    private fun errorText(e: Exception?): String = e?.message ?: "Something went wrong"

    // --- Data ----------------------------------------------------------------

    private fun loadCachedUnits() {
        val json = prefs.unitsCacheJson
        if (json.isBlank()) return
        runCatching { units = ApiJson.parseUnits(JSONArray(json)) }
    }

    private fun refreshUnits() {
        runAsync({ api.fetchUnits() }) { result, err ->
            if (result != null) {
                units = result.first
                prefs.unitsCacheJson = result.second
                unitsError = null
            } else {
                unitsError = errorText(err)
            }
            render()
        }
    }

    private fun refreshRoster() {
        val allyCode = prefs.allyCode
        if (allyCode.isBlank() || rosterLoading) {
            render()
            return
        }
        rosterLoading = true
        rosterAttemptAtMillis = System.currentTimeMillis()
        render()
        runAsync({ api.fetchRoster(allyCode) }) { roster, err ->
            rosterLoading = false
            if (roster != null) {
                owned = roster.ownedDefinitionIds
                prefs.ownedDefinitionIds = roster.ownedDefinitionIds
                levels = roster.levels
                prefs.unitLevels = roster.levels
                prefs.rosterFetchedAtMillis = roster.pulledAtMillis(System.currentTimeMillis())
                rosterError = if (roster.stale) "the game didn't answer" else null
            } else {
                rosterError = errorText(err)
            }
            render()
        }
    }

    /** New units get unlocked between GAC rounds - re-pull an old copy when
     * the panel opens (not more often than RosterAge.RETRY_MS if that fails). */
    private fun refreshRosterIfOld() {
        val now = System.currentTimeMillis()
        if (prefs.allyCode.isBlank() || rosterLoading) return
        if (!RosterAge.isOld(prefs.rosterFetchedAtMillis, now)) return
        if (now - rosterAttemptAtMillis < RosterAge.RETRY_MS) return
        refreshRoster()
    }

    private fun rosterStatusText(): String {
        if (prefs.allyCode.isBlank()) return "No ally code in Settings - counters aren't checked against your roster."
        val ids = owned
            ?: return if (rosterLoading) "Loading your roster…" else "Roster didn't load (${rosterError ?: "unknown error"})."
        val age = RosterAge.describe(prefs.rosterFetchedAtMillis, System.currentTimeMillis())
        val base = "Roster: ${ids.size} units" + (age?.let { " · updated $it" } ?: "")
        return when {
            rosterLoading -> "$base · updating…"
            rosterError != null -> "$base · couldn't update ($rosterError)"
            else -> base
        }
    }

    private fun refreshKnownTeams() {
        runAsync({ api.fetchDefenderSquads() }) { teams, err ->
            if (teams != null) {
                knownTeams = teams
                knownTeamsError = null
            } else {
                knownTeamsError = errorText(err)
            }
            render()
        }
    }

    /** Re-run the match lookup shortly after the selection changes. */
    private fun scheduleMatch(immediate: Boolean = false) {
        matchSeq++
        matches = null
        matchError = null
        focusedMatch = 0
        mainHandler.removeCallbacks(matchRunnable)
        if (selected.isNotEmpty()) {
            mainHandler.postDelayed(matchRunnable, if (immediate) 0 else MATCH_DEBOUNCE_MS)
        }
        render()
    }

    private fun runMatch() {
        val seq = matchSeq
        val ids = selected.map { it.id }
        runAsync({ api.match(ids) }) { result, err ->
            if (seq != matchSeq) return@runAsync // selection changed since
            matches = result ?: emptyList()
            matchError = if (result == null) errorText(err) else null
            render()
        }
    }

    // --- Notification --------------------------------------------------------

    /** [capturing]: also declare screen capture (required while a
     * MediaProjection is running). */
    private fun startForegroundWithNotification(capturing: Boolean = false) {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.notification_channel), NotificationManager.IMPORTANCE_LOW)
        )
        val openApp = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, OverlayService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_text))
            .setContentIntent(openApp)
            .addAction(0, getString(R.string.stop_overlay), stop)
            .setOngoing(true)
            .build()
        var types = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        if (capturing) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, types)
    }

    // --- Screen scan -------------------------------------------------------

    private fun startScan() {
        scanActive = true
        scanBusy = null
        scanError = null
        scanResult = null
        scanSquad = null
        scanTaught.clear()
        identifying = null
        faceBitmaps.clear()
        scannedLeader = null
        showWeak = false
        selected.clear()
        if (::searchInput.isInitialized) searchInput.setText("")
        if (capturer == null) {
            // First scan this session: Android asks for screen-capture
            // consent (CaptureConsentActivity), then onCaptureGranted scans.
            scanAfterConsent = true
            hidePanel()
            startActivity(
                Intent(this, CaptureConsentActivity::class.java)
                    .addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK or
                            Intent.FLAG_ACTIVITY_NO_ANIMATION
                    )
            )
            return
        }
        captureAndScan()
    }

    private fun onCaptureGranted(resultCode: Int, data: Intent?) {
        if (data == null) return
        try {
            // Screen capture must be part of the foreground service before
            // the projection is created (Android 14+).
            startForegroundWithNotification(capturing = true)
            val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as android.media.projection.MediaProjectionManager
            val projection = manager.getMediaProjection(resultCode, data)
            capturer = ScreenCapturer(projection) {
                // Capture ended (screen locked, or stopped from the status bar).
                capturer = null
                if (!destroyed) runCatching { startForegroundWithNotification(capturing = false) }
            }
        } catch (e: Exception) {
            scanError = "Couldn't start screen capture (${e.message ?: e.javaClass.simpleName})."
            scanAfterConsent = false
            showPanel()
            return
        }
        if (scanAfterConsent) {
            scanAfterConsent = false
            captureAndScan()
        }
    }

    private fun captureAndScan() {
        val cap = capturer ?: return startScan()
        // Hide the overlay so it isn't in the picture.
        hidePanel()
        bubbleView?.visibility = View.INVISIBLE
        val (w, h) = screenSize()
        cap.capture(w, h, resources.displayMetrics.densityDpi) { bitmap ->
            bubbleView?.visibility = View.VISIBLE
            scanActive = true
            if (bitmap == null) {
                scanError = "Couldn't capture the screen - try Scan again."
                showPanel()
                return@capture
            }
            scanBusy = "Reading the screen…"
            showPanel()
            runAsync({
                val out = java.io.ByteArrayOutputStream()
                bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 92, out)
                bitmap.recycle()
                api.scanGac(out.toByteArray())
            }) { result, err ->
                scanBusy = null
                if (result == null) {
                    scanError = "Couldn't read the screen: ${errorText(err)}"
                } else {
                    scanResult = result
                    if (result.squads.size == 1) scanSquad = 0
                    finishScanIfReady()
                }
                render()
            }
        }
    }

    private fun scanUnitId(squad: Int, slot: Int): Int? =
        scanTaught[squad to slot] ?: scanResult?.squads?.getOrNull(squad)?.slots?.getOrNull(slot)?.unitId

    /** Once the chosen squad's faces are all known, hand it to the normal
     * counters view (same as typing the units in). */
    private fun finishScanIfReady() {
        val result = scanResult ?: return
        val index = scanSquad ?: return
        val squad = result.squads.getOrNull(index) ?: return
        val ids = squad.slots.indices.map { scanUnitId(index, it) }
        if (ids.any { it == null }) return
        val byId = units.associateBy { it.id }
        selected.clear()
        ids.distinct().forEach { id ->
            selected.add(byId[id] ?: GameUnit(id!!, null, "Unit #$id", false))
        }
        lastAdded = null
        scanActive = false
        identifying = null
        scannedLeader = ScannedLeader(ids[0]!!, squad.slots[0].relic)
        showWeak = false
        scheduleMatch(immediate = true)
    }

    private fun identifyScanFace(squad: Int, slot: Int, unit: GameUnit) {
        val face = scanResult?.squads?.getOrNull(squad)?.slots?.getOrNull(slot) ?: return
        runAsync({ api.addFace(unit.id, face.image, face.fingerprintJson) }) { _, err ->
            if (err != null) {
                Toast.makeText(this, "Couldn't save that: ${errorText(err)}", Toast.LENGTH_LONG).show()
                return@runAsync
            }
            scanTaught[squad to slot] = unit.id
            identifying = null
            if (::searchInput.isInitialized) {
                searchInput.setText("")
                // In landscape the keyboard would cover the next face's buttons.
                (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager)
                    .hideSoftInputFromWindow(searchInput.windowToken, 0)
            }
            Toast.makeText(this, "Saved - ${unit.name} will be recognized from now on", Toast.LENGTH_SHORT).show()
            finishScanIfReady()
            render()
        }
    }

    private fun endScan() {
        scanActive = false
        identifying = null
        scanResult = null
        render()
    }

    private fun faceBitmap(dataUrl: String): android.graphics.Bitmap? = faceBitmaps.getOrPut(dataUrl) {
        runCatching {
            val bytes = android.util.Base64.decode(dataUrl.substringAfter("base64,"), android.util.Base64.DEFAULT)
            android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }.getOrNull()
    }

    private fun faceView(dataUrl: String, sizeDp: Int) = android.widget.ImageView(ui).apply {
        setImageBitmap(faceBitmap(dataUrl))
        scaleType = android.widget.ImageView.ScaleType.CENTER_CROP
        layoutParams = LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp)).apply { marginEnd = dp(4) }
        clipToOutline = true
        outlineProvider = object : android.view.ViewOutlineProvider() {
            override fun getOutline(view: View, outline: android.graphics.Outline) {
                outline.setOval(0, 0, view.width, view.height)
            }
        }
    }

    private fun unitName(id: Int?): String = if (id == null) "?" else units.firstOrNull { it.id == id }?.name ?: "Unit #$id"

    // --- Geometry ------------------------------------------------------------

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).roundToInt()

    private fun screenSize(): Pair<Int, Int> =
        if (Build.VERSION.SDK_INT >= 30) {
            val b = windowManager.currentWindowMetrics.bounds
            b.width() to b.height()
        } else {
            resources.displayMetrics.widthPixels to resources.displayMetrics.heightPixels
        }

    /** Room for the panel: the screen minus visible system bars (and a
     * camera cutout). Overlay windows are laid out between the bars, so a
     * panel as tall as the whole screen gets its bottom cut off whenever
     * they show (they're usually hidden in the game). */
    private fun panelArea(): Pair<Int, Int> {
        val (w, h) = screenSize()
        if (Build.VERSION.SDK_INT < 30) return w to h
        val insets = windowManager.currentWindowMetrics.windowInsets
            .getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.displayCutout())
        return (w - insets.left - insets.right) to (h - insets.top - insets.bottom)
    }

    private fun bubbleSize(): Int = bubbleView?.width?.takeIf { it > 0 } ?: dp(52)

    private fun clampBubble() {
        val (w, h) = screenSize()
        bubbleParams.x = bubbleParams.x.coerceIn(0, max(0, w - bubbleSize()))
        bubbleParams.y = bubbleParams.y.coerceIn(0, max(0, h - bubbleSize()))
    }

    /** Panel sits beside the bubble when there's room (landscape), otherwise
     * below or above it (portrait). */
    private fun panelLayoutParams(): WindowManager.LayoutParams {
        val (sw, sh) = panelArea()
        val margin = dp(8)
        // A bit wider in landscape (SWGoH), where there's room beside the bubble.
        val w = min(if (sw > sh) dp(420) else dp(360), sw - 2 * margin)
        val h = min(dp(560), sh - 2 * margin)
        val b = bubbleSize()
        val bx = bubbleParams.x
        val by = bubbleParams.y

        var x: Int
        var y: Int
        when {
            sw - (bx + b) >= w + 2 * margin -> { x = bx + b + margin; y = by }
            bx >= w + 2 * margin -> { x = bx - w - margin; y = by }
            else -> {
                x = bx + b / 2 - w / 2
                y = if (sh - (by + b) >= h / 2) by + b + margin else by - h - margin
            }
        }
        x = x.coerceIn(margin, max(margin, sw - w - margin))
        y = y.coerceIn(margin, max(margin, sh - h - margin))

        return WindowManager.LayoutParams(
            w, h,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            // Focusable (no FLAG_NOT_FOCUSABLE) so the search box can be
            // typed into; NOT_TOUCH_MODAL so taps outside the panel still
            // reach the game.
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            this.x = x
            this.y = y
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING or
                WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN
        }
    }

    // --- Bubble ----------------------------------------------------------------

    private fun showBubble() {
        if (bubbleView != null) return
        val view = LayoutInflater.from(ui).inflate(R.layout.overlay_bubble, null)

        bubbleParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = prefs.bubbleX
            y = prefs.bubbleY
        }
        clampBubble()

        // Tap toggles the panel; drag moves the bubble (position remembered).
        val touchSlop = ViewConfiguration.get(this).scaledTouchSlop
        view.setOnTouchListener(object : View.OnTouchListener {
            private var startX = 0
            private var startY = 0
            private var downRawX = 0f
            private var downRawY = 0f
            private var dragging = false

            override fun onTouch(v: View, event: MotionEvent): Boolean {
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> {
                        startX = bubbleParams.x
                        startY = bubbleParams.y
                        downRawX = event.rawX
                        downRawY = event.rawY
                        dragging = false
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dx = event.rawX - downRawX
                        val dy = event.rawY - downRawY
                        if (!dragging && (abs(dx) > touchSlop || abs(dy) > touchSlop)) dragging = true
                        if (dragging) {
                            bubbleParams.x = startX + dx.roundToInt()
                            bubbleParams.y = startY + dy.roundToInt()
                            clampBubble()
                            windowManager.updateViewLayout(v, bubbleParams)
                        }
                    }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                        if (dragging) {
                            prefs.bubbleX = bubbleParams.x
                            prefs.bubbleY = bubbleParams.y
                            if (panelShowing) panelView?.let { windowManager.updateViewLayout(it, panelLayoutParams()) }
                        } else if (event.actionMasked == MotionEvent.ACTION_UP) {
                            v.performClick()
                            togglePanel()
                        }
                    }
                }
                return true
            }
        })

        windowManager.addView(view, bubbleParams)
        bubbleView = view
    }

    // --- Panel -------------------------------------------------------------

    private fun togglePanel() {
        if (panelShowing) hidePanel() else showPanel()
    }

    private fun showPanel() {
        val panel = panelView ?: createPanel().also { panelView = it }
        // Picks from a quick close-and-reopen are kept; after a longer break
        // you're almost certainly looking at a different enemy team.
        if (hiddenAtMillis > 0 && System.currentTimeMillis() - hiddenAtMillis > STALE_SELECTION_MS) {
            selected.clear()
            lastAdded = null
            searchInput.setText("")
        }
        if (!panelShowing) {
            windowManager.addView(panel, panelLayoutParams())
            panelShowing = true
        }
        // Pick up counters added in the web UI since last time.
        refreshKnownTeams()
        refreshRosterIfOld()
        if (units.isEmpty() || unitsError != null) refreshUnits()
        if (selected.isNotEmpty()) scheduleMatch(immediate = true) else render()
    }

    private fun hidePanel() {
        val panel = panelView ?: return
        if (!panelShowing) return
        (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(searchInput.windowToken, 0)
        windowManager.removeView(panel)
        panelShowing = false
        hiddenAtMillis = System.currentTimeMillis()
    }

    private fun createPanel(): PanelRootLayout {
        val panel = LayoutInflater.from(ui).inflate(R.layout.overlay_panel, null) as PanelRootLayout
        panel.onBack = { hidePanel() }

        panelTitle = panel.findViewById(R.id.panelTitle)
        searchInput = panel.findViewById(R.id.searchInput)
        selectedChips = panel.findViewById(R.id.selectedChips)
        contentScroll = panel.findViewById(R.id.contentScroll)
        contentList = panel.findViewById(R.id.contentList)
        btnClear = panel.findViewById(R.id.btnClear)

        panel.findViewById<View>(R.id.btnCollapse).setOnClickListener { hidePanel() }
        btnStop = panel.findViewById(R.id.btnStop)
        btnStop.setOnClickListener { stopSelf() }
        btnClear.setOnClickListener { clearSelection() }

        searchInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                query = s?.toString() ?: ""
                render()
            }
        })
        // Keyboard ✓ (or Enter) adds the top search result - the title bar
        // shows which one, since in landscape the keyboard covers the list.
        // The keyboard stays open so several units can be typed in a row.
        searchInput.setOnEditorActionListener { _, actionId, event ->
            val enterKey = actionId == EditorInfo.IME_NULL &&
                event?.keyCode == android.view.KeyEvent.KEYCODE_ENTER &&
                event.action == android.view.KeyEvent.ACTION_DOWN
            if (actionId == EditorInfo.IME_ACTION_DONE || enterKey) {
                currentSearchResults().firstOrNull()?.let { pickFromSearch(it) }
                true
            } else {
                false
            }
        }
        return panel
    }

    private fun clearSelection() {
        selected.clear()
        scannedLeader = null
        showWeak = false
        lastAdded = null
        if (::searchInput.isInitialized) searchInput.setText("")
        query = ""
        scheduleMatch()
    }

    /** A search result was tapped (or picked with the keyboard). */
    private fun pickFromSearch(unit: GameUnit) {
        val target = identifying
        if (target != null) identifyScanFace(target.first, target.second, unit) else addUnit(unit)
    }

    private fun addUnit(unit: GameUnit) {
        if (selected.none { it.id == unit.id }) selected.add(unit)
        lastAdded = unit.name
        searchInput.setText("") // triggers render via the TextWatcher
        scheduleMatch()
    }

    private fun currentSearchResults(): List<GameUnit> =
        UnitSearch.search(
            units, query,
            exclude = selected.map { it.id }.toSet(),
            kind = UnitSearch.kindFor(selected),
        )

    // --- Rendering -------------------------------------------------------------

    private fun render() {
        if (!panelShowing || panelView == null) return

        renderChips()
        renderTitle()
        btnClear.visibility = if (selected.isNotEmpty() || query.isNotBlank()) View.VISIBLE else View.GONE

        contentList.removeAllViews()
        when {
            query.isNotBlank() -> renderSearchResults()
            scanActive -> renderScan()
            selected.isNotEmpty() -> renderMatches()
            else -> renderHome()
        }
    }

    /** The title bar stays visible above the keyboard (which covers most of
     * a landscape screen), so it doubles as the "what will ✓ do" readout. */
    private fun renderTitle() {
        val (label, color) = when {
            identifying != null && query.isBlank() -> "Who is this? Type a name" to R.color.accent
            scanActive && query.isBlank() -> "Screen scan" to R.color.accent
            query.isNotBlank() -> {
                val top = currentSearchResults().firstOrNull()
                if (top != null) "✓ ${top.name}" to R.color.text else "No match" to R.color.danger
            }
            selected.isNotEmpty() && lastAdded != null -> "+ $lastAdded (${selected.size})" to R.color.accent
            selected.isNotEmpty() -> "Counters (${selected.size} picked)" to R.color.accent
            else -> getString(R.string.panel_title) to R.color.accent
        }
        panelTitle.text = label
        panelTitle.setTextColor(ContextCompat.getColor(ui, color))
        // Stop is only offered on the home view, leaving the title room to
        // show full unit names while you're picking.
        btnStop.visibility = if (query.isBlank() && selected.isEmpty()) View.VISIBLE else View.GONE
    }

    private fun renderChips() {
        selectedChips.removeAllViews()
        selectedChips.visibility = if (selected.isEmpty()) View.GONE else View.VISIBLE
        selected.forEachIndexed { i, unit ->
            val chip = text(
                if (i == 0) "★ ${unit.name}  ✕" else "${unit.name}  ✕",
                14f, if (i == 0) R.color.accent else R.color.text,
            ).apply {
                setBackgroundResource(if (i == 0) R.drawable.chip_leader_bg else R.drawable.chip_bg)
                setPadding(dp(12), dp(6), dp(10), dp(6))
                contentDescription = if (i == 0) "Leader ${unit.name}, tap to remove" else "${unit.name}, tap to remove, long-press to make leader"
                setOnClickListener {
                    selected.removeAt(i)
                    scheduleMatch()
                }
                setOnLongClickListener {
                    selected.removeAt(i)
                    selected.add(0, unit)
                    scheduleMatch()
                    true
                }
            }
            selectedChips.addView(chip, ViewGroup.MarginLayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ))
        }
    }

    private fun renderSearchResults() {
        if (units.isEmpty()) {
            addMessage(unitsError?.let { "Couldn't load units: $it" } ?: "Loading units…")
            return
        }
        val results = currentSearchResults()
        if (results.isEmpty()) {
            val kind = when (UnitSearch.kindFor(selected)) {
                UnitSearch.Kind.SHIPS -> "ships"
                UnitSearch.Kind.CHARACTERS -> "characters"
                UnitSearch.Kind.ALL -> "units"
            }
            addMessage("No $kind match \"${query.trim()}\".")
            return
        }
        if (identifying != null) addMessage("Tap who that face is.", small = true)
        else if (selected.isEmpty()) addMessage("Tap the enemy leader first.", small = true)
        results.forEach { unit ->
            val row = row {
                addView(text(unit.name, 15f, R.color.text), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                if (unit.isShip) addView(text("Ship", 12f, R.color.muted))
            }
            row.setOnClickListener { pickFromSearch(unit) }
            contentList.addView(row)
        }
    }

    private fun renderMatches() {
        addMessage("Tap a unit above to remove it · long-press to make it the leader.", small = true)

        val err = matchError
        val found = matches
        if (err != null) {
            addMessage("Couldn't look up counters: $err")
            addButton("Try again", accent = false) { scheduleMatch(immediate = true) }
            return
        }
        if (found == null) {
            addMessage("Finding counters…")
            return
        }
        if (found.isEmpty()) {
            addMessage("No saved team matches these units yet. Add the team and its counters in the web app.")
            return
        }

        val match = found[focusedMatch.coerceIn(0, found.size - 1)]
        val defender = match.defender
        val leaderName = defender.leader?.name ?: "Unknown"
        addHeading("vs $leaderName")
        addMessage(
            if (match.exact) "Exact team · ${defender.label}"
            else "${(match.score * 100).roundToInt()}% match - ${match.overlap} of its ${defender.units.size} units · ${defender.label}",
            small = true,
        )
        match.counters.mapNotNull { it.notes }.forEach { addNotes(it) }

        // The enemy leader's relic level - only known from a screen scan, and
        // only while the scanned leader is still the one selected.
        val scanned = scannedLeader?.takeIf { it.unitId == selected.firstOrNull()?.id }
        val theirRelic = scanned?.relic
        if (scanned != null) {
            addMessage(
                if (theirRelic != null) "Their leader: R$theirRelic · counters with a leader more than ${CounterRanking.MAX_RELIC_GAP} relic levels below are set aside."
                else "Their leader's relic level couldn't be read - nothing is set aside.",
                small = true,
            )
        }

        val ranked = CounterRanking.rank(match.counters, owned, prefs.getUsedSquads(), levels, theirRelic)
        if (ranked.isEmpty()) addMessage("No counters saved for this team.")
        val (weak, shown) = ranked.partition { it.availability == CounterRanking.Availability.TOO_WEAK }
        shown.forEach { addCounterRow(it, theirRelic) }
        if (weak.isNotEmpty()) {
            val toggle = row {
                addView(
                    text("Probably too weak (${weak.size})", 14f, R.color.muted, bold = true),
                    LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f),
                )
                addView(text(if (showWeak) "Hide" else "Show", 13f, R.color.link))
            }
            toggle.setOnClickListener {
                showWeak = !showWeak
                render()
            }
            contentList.addView(toggle)
            if (showWeak) weak.forEach { addCounterRow(it, theirRelic) }
        }

        val others = found.withIndex().filter { it.index != focusedMatch }
        if (others.isNotEmpty()) {
            addSection("Other close teams")
            others.forEach { (index, other) ->
                val row = row {
                    addView(
                        text(other.defender.leader?.name ?: "Unknown", 15f, R.color.text),
                        LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f),
                    )
                    addView(text(if (other.exact) "exact" else "${(other.score * 100).roundToInt()}%", 13f, R.color.muted))
                }
                row.setOnClickListener {
                    focusedMatch = index
                    render()
                    contentScroll.scrollTo(0, 0)
                }
                contentList.addView(row)
            }
        }
    }

    private fun addCounterRow(r: CounterRanking.Ranked, theirRelic: Int? = null) {
        val squad = r.counter.squad
        val row = LinearLayout(ui).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(4), dp(8), dp(4), dp(8))
            alpha = if (r.usable) 1f else 0.5f
        }
        row.addView(text("#${r.counter.rank}", 15f, R.color.accent, bold = true).apply {
            minWidth = dp(32)
        })

        val body = LinearLayout(ui).apply { orientation = LinearLayout.VERTICAL }
        val names = SpannableStringBuilder()
        squad.units.forEachIndexed { i, u ->
            if (i > 0) names.append(", ")
            val start = names.length
            names.append(u.name)
            if (i == 0) names.setSpan(StyleSpan(Typeface.BOLD), start, names.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        body.addView(text(names, 15f, R.color.text))
        val stats = listOfNotNull(r.counter.statsLabel, r.leaderLevel?.label?.let { "your lead $it" })
        if (stats.isNotEmpty()) body.addView(text(stats.joinToString(" · "), 13f, R.color.muted))
        r.counter.notes?.let { body.addView(text(it, 13f, R.color.muted, italic = true)) }
        when (r.availability) {
            CounterRanking.Availability.ALREADY_USED ->
                body.addView(text("Already used: ${r.blockers.joinToString { it.name }}", 13f, R.color.danger))
            CounterRanking.Availability.NOT_OWNED ->
                body.addView(text("Not in your roster: ${r.blockers.joinToString { it.name }}", 13f, R.color.danger))
            CounterRanking.Availability.TOO_WEAK ->
                body.addView(text(
                    "Probably too weak: your ${r.blockers.firstOrNull()?.name ?: "leader"} ${r.leaderLevel?.label ?: ""} vs their R${theirRelic ?: "?"}",
                    13f, R.color.danger,
                ))
            CounterRanking.Availability.AVAILABLE -> Unit
        }
        row.addView(body, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        if (r.usable) {
            row.addView(button("Use", accent = true) {
                prefs.addUsedSquad(UsedSquad(squad.label, squad.unitIds))
                Toast.makeText(this, "Marked used: ${squad.leader?.name ?: "squad"} team", Toast.LENGTH_SHORT).show()
                clearSelection()
                hidePanel()
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(36)).apply {
                marginStart = dp(8)
                gravity = Gravity.CENTER_VERTICAL
            })
        }
        contentList.addView(row)
    }

    private fun renderScan() {
        scanBusy?.let {
            addMessage(it)
            return
        }
        val scanAgain = { addButton("Scan again", accent = false) { startScan() } }
        scanError?.let {
            addMessage(it)
            scanAgain()
            addButton("Close", accent = false) { endScan() }
            return
        }
        val result = scanResult ?: return

        if (result.squads.isEmpty()) {
            addMessage(
                if (result.beaten > 0) "Every squad on screen is already beaten."
                else "No enemy squads found. Open an enemy territory (its list of squads) and scan again."
            )
            scanAgain()
            addButton("Close", accent = false) { endScan() }
            return
        }

        val chosen = scanSquad
        if (chosen == null) {
            addHeading("Which squad are you attacking?")
            result.squads.forEachIndexed { i, squad ->
                val row = LinearLayout(ui).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(8), dp(8), dp(8), dp(8))
                    setBackgroundResource(R.drawable.row_bg)
                    isClickable = true
                }
                val faces = LinearLayout(ui).apply { orientation = LinearLayout.HORIZONTAL }
                squad.slots.forEach { faces.addView(faceView(it.image, 36)) }
                row.addView(faces)
                row.addView(text(squad.slots.indices.joinToString(", ") { unitName(scanUnitId(i, it)) }, 13f, R.color.muted))
                row.setOnClickListener {
                    scanSquad = i
                    finishScanIfReady()
                    render()
                }
                contentList.addView(row)
            }
            scanAgain()
            return
        }

        val squad = result.squads[chosen]
        val faces = LinearLayout(ui).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(4), dp(4), dp(4), dp(4))
        }
        squad.slots.forEach { faces.addView(faceView(it.image, 40)) }
        contentList.addView(faces)

        val unknown = squad.slots.indices.filter { scanUnitId(chosen, it) == null }
        addMessage(
            if (unknown.size == 1) "1 face isn't recognized yet. Tell the app who it is once and it'll know from now on."
            else "${unknown.size} faces aren't recognized yet. Tell the app who they are once and it'll know from now on.",
            small = true,
        )
        unknown.forEach { k ->
            val slot = squad.slots[k]
            val block = LinearLayout(ui).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(dp(4), dp(10), dp(4), dp(6))
                gravity = Gravity.TOP
            }
            block.addView(faceView(slot.image, 52))
            val body = LinearLayout(ui).apply { orientation = LinearLayout.VERTICAL }
            body.addView(text(if (identifying == chosen to k) "Type a name above…" else "Who is this?", 14f, R.color.text, bold = true))
            slot.candidates.forEach { cand ->
                val name = cand.name ?: unitName(cand.unitId)
                body.addView(button("$name  ${(cand.score * 100).roundToInt()}%", accent = cand == slot.candidates.first()) {
                    identifyScanFace(chosen, k, units.firstOrNull { it.id == cand.unitId } ?: GameUnit(cand.unitId, null, name, false))
                }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(36)).apply { topMargin = dp(6) })
            }
            body.addView(button(if (slot.candidates.isEmpty()) "Search…" else "Someone else…", accent = false) {
                identifying = chosen to k
                searchInput.requestFocus()
                (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(searchInput, 0)
                render()
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(36)).apply { topMargin = dp(6) })
            block.addView(body, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(8) })
            contentList.addView(block)
        }
        if (result.squads.size > 1) {
            addButton("Pick a different squad", accent = false) {
                scanSquad = null
                identifying = null
                render()
            }
        }
        scanAgain()
    }

    private fun renderHome() {
        if (!prefs.isConfigured()) {
            addMessage("Open the SWGOH Overlay app's Settings and enter your server URL, token and ally code.")
        }
        addButton("Scan screen", accent = true) { startScan() }
        if (units.isEmpty()) {
            addMessage(unitsError?.let { "Couldn't load units: $it" } ?: "Loading units…")
        } else {
            addMessage("Open an enemy territory in GAC and scan it - or type the enemy units above.", small = true)
        }

        val rosterRow = row {
            addView(text(rosterStatusText(), 13f, R.color.muted), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            if (prefs.allyCode.isNotBlank()) addView(text("Refresh", 13f, R.color.link))
        }
        if (prefs.allyCode.isNotBlank()) rosterRow.setOnClickListener { refreshRoster() }
        contentList.addView(rosterRow)

        val used = prefs.getUsedSquads()
        if (used.isNotEmpty()) {
            addSection("Used this round (${used.size})")
            used.forEachIndexed { i, squad ->
                val row = row {
                    addView(text(squad.label, 14f, R.color.text), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                    addView(text("✕", 15f, R.color.muted).apply { setPadding(dp(10), 0, dp(4), 0) })
                }
                row.contentDescription = "Remove ${squad.label} from used squads"
                row.setOnClickListener {
                    prefs.removeUsedSquad(i)
                    render()
                }
                contentList.addView(row)
            }
            addButton("Reset round", accent = false) {
                prefs.clearUsedSquads()
                render()
            }
        }

        addSection("Saved defense teams")
        val teams = knownTeams
        when {
            teams == null && knownTeamsError != null -> addMessage("Couldn't load teams: $knownTeamsError")
            teams == null -> addMessage("Loading…")
            teams.isEmpty() -> addMessage("No counters saved yet - add some in the web app.")
            else -> teams.forEach { team ->
                val row = row {
                    val label = SpannableStringBuilder(team.leader?.name ?: "Unknown")
                    label.setSpan(StyleSpan(Typeface.BOLD), 0, label.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                    if (team.units.size > 1) label.append("  +${team.units.size - 1}")
                    addView(text(label, 15f, R.color.text), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                }
                row.setOnClickListener {
                    selected.clear()
                    selected.addAll(team.units)
                    scheduleMatch(immediate = true)
                }
                contentList.addView(row)
            }
        }
    }

    // --- View helpers ----------------------------------------------------------

    private fun text(
        value: CharSequence,
        sizeSp: Float,
        colorRes: Int,
        bold: Boolean = false,
        italic: Boolean = false,
    ) = TextView(ui).apply {
        text = value
        textSize = sizeSp
        setTextColor(ContextCompat.getColor(ui, colorRes))
        val style = when {
            bold && italic -> Typeface.BOLD_ITALIC
            bold -> Typeface.BOLD
            italic -> Typeface.ITALIC
            else -> Typeface.NORMAL
        }
        setTypeface(typeface, style)
    }

    private fun row(build: LinearLayout.() -> Unit) = LinearLayout(ui).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = dp(44)
        setPadding(dp(8), dp(6), dp(8), dp(6))
        setBackgroundResource(R.drawable.row_bg)
        isClickable = true
        build()
    }

    private fun button(label: String, accent: Boolean, onClick: () -> Unit) =
        text(label, 14f, if (accent) R.color.accent_text else R.color.text, bold = accent).apply {
            gravity = Gravity.CENTER
            setPadding(dp(14), 0, dp(14), 0)
            setBackgroundResource(if (accent) R.drawable.button_accent_bg else R.drawable.button_ghost_bg)
            setOnClickListener { onClick() }
        }

    private fun addButton(label: String, accent: Boolean, onClick: () -> Unit) {
        contentList.addView(button(label, accent, onClick), LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, dp(38)
        ).apply { topMargin = dp(6); bottomMargin = dp(4) })
    }

    private fun addMessage(message: String, small: Boolean = false) {
        contentList.addView(text(message, if (small) 13f else 14f, R.color.muted).apply {
            setPadding(dp(4), dp(4), dp(4), dp(4))
        })
    }

    private fun addHeading(title: String) {
        contentList.addView(text(title, 17f, R.color.text, bold = true).apply {
            setPadding(dp(4), dp(4), dp(4), 0)
        })
    }

    private fun addSection(title: String) {
        contentList.addView(text(title.uppercase(), 12f, R.color.muted, bold = true).apply {
            letterSpacing = 0.06f
            setPadding(dp(4), dp(14), dp(4), dp(4))
        })
    }

    private fun addNotes(notes: String) {
        contentList.addView(text(notes, 13f, R.color.muted, italic = true).apply {
            setPadding(dp(4), dp(2), dp(4), dp(2))
        })
    }
}
