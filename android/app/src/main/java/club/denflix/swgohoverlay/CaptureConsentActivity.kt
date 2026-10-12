package club.denflix.swgohoverlay

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

/**
 * Invisible activity that shows Android's "Start recording or casting?"
 * screen-capture prompt (only an activity can) and hands the answer to
 * OverlayService. Shown once per overlay session - the first "Scan screen".
 */
class CaptureConsentActivity : AppCompatActivity() {

    private val consent = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val intent = Intent(this, OverlayService::class.java)
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            intent.action = OverlayService.ACTION_CAPTURE_GRANTED
            intent.putExtra(OverlayService.EXTRA_RESULT_CODE, result.resultCode)
            intent.putExtra(OverlayService.EXTRA_RESULT_DATA, result.data)
        } else {
            intent.action = OverlayService.ACTION_CAPTURE_DENIED
        }
        startService(intent)
        finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) {
            val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            // Android 14+ defaults the prompt to "Share one app" plus an app
            // picker; the overlay scans whatever is on screen, so ask for the
            // whole screen and skip that step.
            val request = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
            } else {
                manager.createScreenCaptureIntent()
            }
            consent.launch(request)
        }
    }
}
