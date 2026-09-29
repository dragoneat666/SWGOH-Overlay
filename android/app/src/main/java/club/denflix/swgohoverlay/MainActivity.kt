package club.denflix.swgohoverlay

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AlertDialog

class MainActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val prefs = Prefs(this)
        prefs.lastOpenedAtMillis.let { lastOpened ->
            val now = System.currentTimeMillis()
            if (lastOpened != 0L && now - lastOpened > 24 * 60 * 60 * 1000L) {
                AlertDialog.Builder(this)
                    .setTitle("Reset squad tracking?")
                    .setMessage("It's been a while since this was last open - reset which squads have already been marked used this round?")
                    .setPositiveButton("Reset") { _, _ -> prefs.clearUsedSquads() }
                    .setNegativeButton("Keep as-is", null)
                    .show()
            }
        }
        prefs.lastOpenedAtMillis = System.currentTimeMillis()

        findViewById<android.widget.Button>(R.id.btnOpenOverlay).setOnClickListener {
            if (!prefs.isConfigured()) {
                AlertDialog.Builder(this)
                    .setTitle("Set up first")
                    .setMessage("Enter your ally code and backend connection details in Settings before opening the overlay.")
                    .setPositiveButton("Go to Settings") { _, _ ->
                        startActivity(Intent(this, SettingsActivity::class.java))
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
                return@setOnClickListener
            }

            if (!Settings.canDrawOverlays(this)) {
                AlertDialog.Builder(this)
                    .setMessage(R.string.overlay_permission_needed)
                    .setPositiveButton("OK") { _, _ ->
                        val intent = Intent(
                            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:$packageName")
                        )
                        startActivity(intent)
                    }
                    .show()
                return@setOnClickListener
            }

            startOverlayService()
            // Try to bring SWGoH to the foreground too. If it's not
            // installed, this silently no-ops and the user just switches
            // to it themselves - see README for why this isn't hard-required.
            packageManager.getLaunchIntentForPackage("com.ea.game.starwarscapital_row")
                ?.let { startActivity(it) }
            moveTaskToBack(true)
        }

        findViewById<android.widget.Button>(R.id.btnSettings).setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
    }

    private fun startOverlayService() {
        val intent = Intent(this, OverlayService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }
}
