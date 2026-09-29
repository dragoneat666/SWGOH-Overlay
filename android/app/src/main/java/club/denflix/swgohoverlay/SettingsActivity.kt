package club.denflix.swgohoverlay

import android.os.Bundle
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        val prefs = Prefs(this)

        val inputAllyCode = findViewById<EditText>(R.id.inputAllyCode)
        val inputApiBaseUrl = findViewById<EditText>(R.id.inputApiBaseUrl)
        val inputApiToken = findViewById<EditText>(R.id.inputApiToken)

        inputAllyCode.setText(prefs.allyCode)
        inputApiBaseUrl.setText(prefs.apiBaseUrl)
        inputApiToken.setText(prefs.apiToken)

        findViewById<android.widget.Button>(R.id.btnSave).setOnClickListener {
            prefs.allyCode = inputAllyCode.text.toString().trim()
            prefs.apiBaseUrl = inputApiBaseUrl.text.toString().trim()
            prefs.apiToken = inputApiToken.text.toString().trim()
            Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show()
        }

        findViewById<android.widget.Button>(R.id.btnMoveBubble).setOnClickListener {
            // TODO: launch the bubble-placement flow - dim the screen, show
            // the draggable bubble, save prefs.bubbleX/bubbleY on "Done"
            // (top-right, per docs/ARCHITECTURE.md - avoids SWGoH's own
            // home button). Not yet implemented; OverlayService currently
            // just opens at the last saved (or default) position.
            Toast.makeText(this, "Bubble placement flow not implemented yet", Toast.LENGTH_SHORT).show()
        }

        findViewById<android.widget.Button>(R.id.btnResetSquads).setOnClickListener {
            prefs.clearUsedSquads()
            Toast.makeText(this, "Used-squad tracking reset", Toast.LENGTH_SHORT).show()
        }
    }
}
