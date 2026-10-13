package club.denflix.swgohoverlay

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
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

            // Android 13+ hides the "overlay running" notification (and its
            // Stop button) unless notifications are allowed. Asking is
            // optional - the overlay starts whatever the answer, and once
            // someone has said no Android stops showing the prompt.
            if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                return@setOnClickListener
            }
            launchOverlay()
        }

        findViewById<android.widget.Button>(R.id.btnSettings).setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
    }

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { launchOverlay() }

    private fun launchOverlay() {
        startOverlayService()
        // Open the game too (declared in the manifest's <queries> so Android
        // lets us see it). Without it, just get out of the way.
        val game = packageManager.getLaunchIntentForPackage(SWGOH_PACKAGE)
        if (game != null) {
            startActivity(game)
        } else {
            android.widget.Toast.makeText(this, "SWGOH isn't installed - the overlay is running.", android.widget.Toast.LENGTH_LONG).show()
        }
        moveTaskToBack(true)
    }

    companion object {
        /** Star Wars: Galaxy of Heroes on Google Play. */
        const val SWGOH_PACKAGE = "com.ea.game.starwarscapital_row"
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
