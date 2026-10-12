package club.denflix.swgohoverlay

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import kotlin.concurrent.thread

class SettingsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        val prefs = Prefs(this)

        val inputAllyCode = findViewById<EditText>(R.id.inputAllyCode)
        val inputApiBaseUrl = findViewById<EditText>(R.id.inputApiBaseUrl)
        val inputApiToken = findViewById<EditText>(R.id.inputApiToken)
        val status = findViewById<TextView>(R.id.connectionStatus)
        val btnSave = findViewById<Button>(R.id.btnSave)

        inputAllyCode.setText(prefs.allyCode)
        inputApiBaseUrl.setText(prefs.apiBaseUrl)
        inputApiToken.setText(prefs.apiToken)

        // Saves, then checks each piece in turn so a problem points at the
        // field that's wrong: server reachable + token accepted, units
        // library present, and the ally code's roster pulls.
        btnSave.setOnClickListener {
            prefs.allyCode = inputAllyCode.text.toString()
            prefs.apiBaseUrl = inputApiBaseUrl.text.toString()
            prefs.apiToken = inputApiToken.text.toString()
            inputAllyCode.setText(prefs.allyCode)
            inputApiBaseUrl.setText(prefs.apiBaseUrl)

            btnSave.isEnabled = false
            status.text = "Saved. Checking the connection…"
            thread {
                val api = ApiClient(prefs)
                val lines = mutableListOf<String>()
                try {
                    api.checkAuth()
                    lines += "✓ Server reachable and token accepted"
                    val (units, json) = api.fetchUnits()
                    prefs.unitsCacheJson = json
                    lines += if (units.isEmpty()) "⚠ No units yet - run Units → Import from game in the web app"
                    else "✓ ${units.size} units in the library"
                    if (prefs.allyCode.length == 9) {
                        try {
                            val owned = api.fetchOwnedDefinitionIds(prefs.allyCode)
                            prefs.ownedDefinitionIds = owned
                            lines += "✓ Roster loaded: ${owned.size} units"
                        } catch (e: Exception) {
                            lines += "✗ Roster: ${e.message}"
                        }
                    } else {
                        lines += "⚠ Ally code should be 9 digits"
                    }
                } catch (e: Exception) {
                    lines += "✗ ${e.message}"
                }
                runOnUiThread {
                    if (!isFinishing) {
                        status.text = lines.joinToString("\n")
                        btnSave.isEnabled = true
                    }
                }
            }
        }

        findViewById<Button>(R.id.btnResetSquads).setOnClickListener {
            prefs.clearUsedSquads()
            Toast.makeText(this, "Used-squad tracking reset", Toast.LENGTH_SHORT).show()
        }
    }
}
